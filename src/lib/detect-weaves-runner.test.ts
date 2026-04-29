import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_USERS_PER_RUN,
  runDetectWeaves,
  type DetectWeavesDeps,
  type DetectWeavesState,
  type RunRecordInput,
} from "./detect-weaves-runner.server";

type FakeDeps = DetectWeavesDeps & {
  recordedRuns: RunRecordInput[];
  detectCalls: string[];
  alertCalls: string[];
};

function makeDeps(overrides: Partial<DetectWeavesDeps> = {}): FakeDeps {
  const recordedRuns: RunRecordInput[] = [];
  const detectCalls: string[] = [];
  const alertCalls: string[] = [];

  const base: DetectWeavesDeps = {
    now: () => 1_000_000,
    recordRun: async (input) => {
      recordedRuns.push(input);
      return `run-${recordedRuns.length}`;
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
  return Object.assign(merged, { recordedRuns, detectCalls, alertCalls });
}

function freshState(): DetectWeavesState {
  return { lastRunAt: 0 };
}

describe("runDetectWeaves auth", () => {
  it("returns 503 when DETECT_WEAVES_CRON_SECRET is not configured", async () => {
    const deps = makeDeps();
    const errorSpy = vi.fn();
    deps.log = { error: errorSpy };

    const res = await runDetectWeaves(
      deps,
      { cronSecret: undefined },
      freshState(),
      "anything",
    );

    expect(res.status).toBe(503);
    expect(res.body).toBe("Server not configured");
    // The refusal IS persisted so operators can see misconfiguration.
    expect(deps.recordedRuns).toHaveLength(1);
    expect(deps.recordedRuns[0].status).toBe("refused");
    expect(deps.recordedRuns[0].message).toContain("not set");
    expect(errorSpy).toHaveBeenCalled();
    // No work should have been attempted.
    expect(deps.detectCalls).toEqual([]);
  });

  it("returns 503 when secret is empty string (treated as unset)", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "" },
      freshState(),
      "anything",
    );
    expect(res.status).toBe(503);
  });

  it("returns 401 when the x-cron-secret header is missing", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "real-secret" },
      freshState(),
      null,
    );
    expect(res.status).toBe(401);
    expect(res.body).toBe("Unauthorized");
    // 401s must NOT touch the runs table — that would let an attacker spam logs.
    expect(deps.recordedRuns).toEqual([]);
    expect(deps.detectCalls).toEqual([]);
  });

  it("returns 401 when the x-cron-secret header is wrong", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "real-secret" },
      freshState(),
      "wrong-secret",
    );
    expect(res.status).toBe(401);
    expect(deps.recordedRuns).toEqual([]);
  });

  it("returns 401 when only the prefix matches (constant-time guard)", async () => {
    const deps = makeDeps();
    const res = await runDetectWeaves(
      deps,
      { cronSecret: "real-secret" },
      freshState(),
      "real",
    );
    expect(res.status).toBe(401);
  });
});

describe("runDetectWeaves cooldown", () => {
  it("rejects the second call inside the cooldown window with 429 + retry-after", async () => {
    let nowMs = 10_000_000;
    const deps = makeDeps({ now: () => nowMs });
    const state = freshState();
    const config = {
      cronSecret: "secret",
      minIntervalMs: 30 * 60 * 1000, // 30 min
    };

    const first = await runDetectWeaves(deps, config, state, "secret");
    expect(first.status).toBe(200);
    expect(state.lastRunAt).toBe(nowMs);

    // Advance only 5 minutes — still inside the 30 min cooldown.
    nowMs += 5 * 60 * 1000;
    const second = await runDetectWeaves(deps, config, state, "secret");

    expect(second.status).toBe(429);
    expect(second.body).toBe("Too soon");
    // ~25 minutes remaining, expressed in seconds.
    expect(second.headers?.["retry-after"]).toBe(String(25 * 60));

    // Cooldown refusal IS persisted (status: refused).
    const refused = deps.recordedRuns.filter((r) => r.status === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0].message).toMatch(/cooldown active/);
  });

  it("allows a second call after the cooldown elapses", async () => {
    let nowMs = 10_000_000;
    const deps = makeDeps({ now: () => nowMs });
    const state = freshState();
    const config = {
      cronSecret: "secret",
      minIntervalMs: 30 * 60 * 1000,
    };

    const first = await runDetectWeaves(deps, config, state, "secret");
    expect(first.status).toBe(200);

    nowMs += 30 * 60 * 1000 + 1; // just past the boundary
    const second = await runDetectWeaves(deps, config, state, "secret");
    expect(second.status).toBe(200);
  });
});

describe("runDetectWeaves throughput limits", () => {
  it("caps the number of users processed at maxUsersPerRun", async () => {
    // Create 7 users, each with two patterns => 7 candidates.
    const userIds = Array.from({ length: 7 }, (_, i) => `user-${i}`);
    const rows = userIds.flatMap((u) => [{ user_id: u }, { user_id: u }]);

    const deps = makeDeps({
      loadActivePatternUserIds: async () => ({ rows, error: null }),
    });

    const res = await runDetectWeaves(
      deps,
      {
        cronSecret: "secret",
        maxUsersPerRun: 3, // intentionally below the candidate count
      },
      freshState(),
      "secret",
    );

    expect(res.status).toBe(200);
    expect(deps.detectCalls).toHaveLength(3);
    const body = res.body as Record<string, unknown>;
    expect(body.users_scanned).toBe(3);
    // The recorded run reflects the cap, not the candidate pool size.
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

    const res = await runDetectWeaves(
      deps,
      { cronSecret: "secret" },
      freshState(),
      "secret",
    );

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

    const res = await runDetectWeaves(
      deps,
      { cronSecret: "secret" },
      freshState(),
      "secret",
    );

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