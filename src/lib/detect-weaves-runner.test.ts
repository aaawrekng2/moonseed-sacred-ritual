import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_USERS_PER_RUN,
  runDetectWeaves,
  type DetectWeavesDeps,
  type RunRecordInput,
} from "./detect-weaves-runner.server";

type SlotCall = { minIntervalMs: number };

type FakeDeps = DetectWeavesDeps & {
  recordedRuns: RunRecordInput[];
  detectCalls: string[];
  alertCalls: string[];
  slotCalls: SlotCall[];
};

/**
 * Build a fully-stubbed dependency bag. Every test starts from
 * `acquired: true` slot acquisition so success-path tests don't have to
 * opt in; cooldown tests override `tryAcquireSlot` explicitly.
 */
function makeDeps(overrides: Partial<DetectWeavesDeps> = {}): FakeDeps {
  const recordedRuns: RunRecordInput[] = [];
  const detectCalls: string[] = [];
  const alertCalls: string[] = [];
  const slotCalls: SlotCall[] = [];

  const base: DetectWeavesDeps = {
    now: () => 1_000_000,
    recordRun: async (input) => {
      recordedRuns.push(input);
      return `run-${recordedRuns.length}`;
    },
    tryAcquireSlot: async (minIntervalMs) => {
      slotCalls.push({ minIntervalMs });
      return { acquired: true, retryAfterSeconds: 0 };
    },
    loadActivePatternUserIds: async () => ({ rows: [], error: null }),
    detectWeavesForUser: async (userId) => {
      detectCalls.push(userId);
      return { inserted: 0, existing: 0 };
    },
    evaluateAlerts: async (runId) => {
      alertCalls.push(runId);
    },
    log: { error: () => {} },
  };

  const merged: DetectWeavesDeps = { ...base, ...overrides };
  return Object.assign(merged, {
    recordedRuns,
    detectCalls,
    alertCalls,
    slotCalls,
  });
}

describe("runDetectWeaves auth", () => {
  it("returns 503 when DETECT_WEAVES_CRON_SECRET is not configured", async () => {
    const deps = makeDeps();
    const errorSpy = vi.fn();
    deps.log = { error: errorSpy };

    const res = await runDetectWeaves(
      deps,
      { cronSecret: undefined },
      "anything",
    );

    expect(res.status).toBe(503);
    expect(res.body).toBe("Server not configured");
    expect(deps.recordedRuns).toHaveLength(1);
    expect(deps.recordedRuns[0].status).toBe("refused");
    expect(deps.recordedRuns[0].message).toContain("not set");
    expect(errorSpy).toHaveBeenCalled();
    // 503 happens BEFORE the lock is taken — must not have hit the DB.
    expect(deps.slotCalls).toEqual([]);
    expect(deps.detectCalls).toEqual([]);
  });

  it("returns 503 when secret is empty string (treated as unset)", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(deps, { cronSecret: "" }, "anything");
    expect(res.status).toBe(503);
    expect(deps.slotCalls).toEqual([]);
  });

  it("returns 401 when the x-cron-secret header is missing", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "real-secret" },
      null,
    );
    expect(res.status).toBe(401);
    expect(res.body).toBe("Unauthorized");
    // 401s must NOT touch the runs table or take the lock.
    expect(deps.recordedRuns).toEqual([]);
    expect(deps.slotCalls).toEqual([]);
    expect(deps.detectCalls).toEqual([]);
  });

  it("returns 401 when the x-cron-secret header is wrong", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "real-secret" },
      "wrong-secret",
    );
    expect(res.status).toBe(401);
    expect(deps.slotCalls).toEqual([]);
  });

  it("returns 401 when only the prefix matches (constant-time guard)", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "real-secret" },
      "real",
    );
    expect(res.status).toBe(401);
  });
});

describe("runDetectWeaves cooldown (database-backed lock)", () => {
  it("delegates the cooldown decision to tryAcquireSlot and returns 429 on refusal", async () => {
    const deps = makeDeps({
      tryAcquireSlot: async () => ({
        acquired: false,
        retryAfterSeconds: 1500, // 25 minutes
      }),
    });

    const res = await runDetectWeaves(
      deps,
      { cronSecret: "secret", minIntervalMs: 30 * 60 * 1000 },
      "secret",
    );

    expect(res.status).toBe(429);
    expect(res.body).toBe("Too soon");
    expect(res.headers?.["retry-after"]).toBe("1500");

    // The refusal IS persisted so operators can see the cooldown firing.
    const refused = deps.recordedRuns.filter((r) => r.status === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0].message).toMatch(/cooldown active/);
    // No scan work performed.
    expect(deps.detectCalls).toEqual([]);
  });

  it("clamps retry-after to at least 1 second when the lock reports 0", async () => {
    const deps = makeDeps({
      tryAcquireSlot: async () => ({ acquired: false, retryAfterSeconds: 0 }),
    });
    const res = await runDetectWeaves(deps, { cronSecret: "secret" }, "secret");
    expect(res.status).toBe(429);
    expect(res.headers?.["retry-after"]).toBe("1");
  });

  it("forwards minIntervalMs to the lock so the DB enforces the same window", async () => {
    const deps = makeDeps();
    await runDetectWeaves(
      deps,
      { cronSecret: "secret", minIntervalMs: 12_345 },
      "secret",
    );
    expect(deps.slotCalls).toEqual([{ minIntervalMs: 12_345 }]);
  });

  it("returns 500 + records an error when the lock RPC throws", async () => {
    const errorSpy = vi.fn();
    const deps = makeDeps({
      tryAcquireSlot: async () => {
        throw new Error("postgres unavailable");
      },
    });
    deps.log = { error: errorSpy };

    const res = await runDetectWeaves(deps, { cronSecret: "secret" }, "secret");

    expect(res.status).toBe(500);
    expect(res.body).toBe("Internal error");
    const errored = deps.recordedRuns.find((r) => r.status === "error");
    expect(errored?.message).toMatch(/lock acquire failed/);
    expect(errored?.message).toMatch(/postgres unavailable/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does NOT keep in-memory state across calls — each call re-asks the lock", async () => {
    // Even after a successful run, the next call must consult the lock again.
    // The previous in-memory implementation would have skipped the second
    // acquire; the new contract MUST always defer to the database.
    const deps = makeDeps();

    await runDetectWeaves(deps, { cronSecret: "secret" }, "secret");
    await runDetectWeaves(deps, { cronSecret: "secret" }, "secret");

    expect(deps.slotCalls).toHaveLength(2);
  });
});

describe("runDetectWeaves throughput limits", () => {
  it("caps the number of users processed at maxUsersPerRun", async () => {
    const userIds = Array.from({ length: 7 }, (_, i) => `user-${i}`);
    const rows = userIds.flatMap((u) => [{ user_id: u }, { user_id: u }]);

    const deps = makeDeps({
      loadActivePatternUserIds: async () => ({ rows, error: null }),
    });

    const res = await runDetectWeaves(
      deps,
      { cronSecret: "secret", maxUsersPerRun: 3 },
      "secret",
    );

    expect(res.status).toBe(200);
    expect(deps.detectCalls).toHaveLength(3);
    const body = res.body as Record<string, unknown>;
    expect(body.users_scanned).toBe(3);
    const success = deps.recordedRuns.find((r) => r.status === "success");
    expect(success?.usersScanned).toBe(3);
  });

  it("ignores users with fewer than 2 active patterns", async () => {
    const rows = [
      { user_id: "loner" }, // 1 pattern -> ignored
      { user_id: "weaver" },
      { user_id: "weaver" },
    ];
    const deps = makeDeps({
      loadActivePatternUserIds: async () => ({ rows, error: null }),
    });

    const res = await runDetectWeaves(deps, { cronSecret: "secret" }, "secret");

    expect(res.status).toBe(200);
    expect(deps.detectCalls).toEqual(["weaver"]);
  });

  it("default maxUsersPerRun cap is 500", () => {
    expect(DEFAULT_MAX_USERS_PER_RUN).toBe(500);
  });

  it("captures per-user errors as partial without aborting the whole run", async () => {
    const rows = [
      { user_id: "ok-1" },
      { user_id: "ok-1" },
      { user_id: "boom" },
      { user_id: "boom" },
    ];
    const deps = makeDeps({
      loadActivePatternUserIds: async () => ({ rows, error: null }),
      detectWeavesForUser: async (userId) => {
        if (userId === "boom") throw new Error("kaboom");
        return { inserted: 2, existing: 1 };
      },
    });

    const res = await runDetectWeaves(deps, { cronSecret: "secret" }, "secret");

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.errors).toBe(1);
    expect(body.weaves_detected).toBe(2);
    const partial = deps.recordedRuns.find((r) => r.status === "partial");
    expect(partial?.perUserErrors).toEqual([
      { user_id: "boom", error: "kaboom" },
    ]);
  });
});