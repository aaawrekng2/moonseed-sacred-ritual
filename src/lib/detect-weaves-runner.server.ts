/**
 * Pure, dependency-injected core of the /api/public/detect-weaves endpoint.
 *
 * The route handler in src/routes/api/public/detect-weaves.ts is a thin
 * wrapper around `runDetectWeaves` so the security and throttling logic can
 * be unit-tested without standing up a real Supabase client or HTTP server.
 *
 * Tests construct fake `deps` (clock, db, alerts evaluator) and call
 * `runDetectWeaves` directly — no module-level singletons are involved.
 */
import { timingSafeEqual } from "node:crypto";

/** Default minimum gap between full scans, regardless of caller. 30 minutes. */
export const DEFAULT_MIN_INTERVAL_MS = 30 * 60 * 1000;
/** Default hard cap on users processed per invocation. */
export const DEFAULT_MAX_USERS_PER_RUN = 500;

export type RunStatus = "success" | "partial" | "refused" | "error";
export type PerUserError = { user_id: string; error: string };

export type RunRecordInput = {
  startedAt: number;
  finishedAt: number;
  status: RunStatus;
  usersScanned: number;
  weavesDetected: number;
  weavesExisting: number;
  message: string | null;
  perUserErrors: PerUserError[];
};

export type DetectWeavesDeps = {
  /** Returns current epoch ms. Tests inject a controllable clock. */
  now: () => number;
  /** Persist a run row. Returns the inserted run id, or null on failure. */
  recordRun: (input: RunRecordInput) => Promise<string | null>;
  /**
   * Returns user_ids that currently have an "active-ish" pattern (one row per
   * pattern; duplicates are aggregated by the runner to find users with >= 2).
   * Returns null + an error message on failure.
   */
  loadActivePatternUserIds: () => Promise<
    { rows: { user_id: string }[] | null; error: string | null }
  >;
  /** Detect weaves for a single user. Throws on failure. */
  detectWeavesForUser: (
    userId: string,
  ) => Promise<{ inserted: number; existing: number }>;
  /** Fire-and-forget alerts evaluation. Errors are caught and logged. */
  evaluateAlerts: (runId: string) => Promise<void>;
  /** Logger seam so tests can stay quiet. */
  log?: {
    error: (...args: unknown[]) => void;
  };
};

export type DetectWeavesConfig = {
  cronSecret: string | undefined;
  minIntervalMs?: number;
  maxUsersPerRun?: number;
};

export type DetectWeavesState = {
  /** Epoch ms of the last accepted (post-auth, post-cooldown) run. */
  lastRunAt: number;
};

export type DetectWeavesResponse = {
  status: number;
  body: string | Record<string, unknown>;
  headers?: Record<string, string>;
};

/**
 * Constant-time string comparison that tolerates unequal-length inputs
 * without leaking the length difference via timingSafeEqual throwing.
 */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 1);
  const ab = Buffer.alloc(len, 0);
  const bb = Buffer.alloc(len, 0);
  ab.write(a);
  bb.write(b);
  return a.length === b.length && timingSafeEqual(ab, bb);
}

/**
 * Core handler. Returns a serializable response shape that the HTTP route
 * adapts into a real Response. `state` is mutated in place so the caller can
 * persist `lastRunAt` across invocations.
 */
export async function runDetectWeaves(
  deps: DetectWeavesDeps,
  config: DetectWeavesConfig,
  state: DetectWeavesState,
  cronHeader: string | null,
): Promise<DetectWeavesResponse> {
  const startedAt = deps.now();
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const maxUsersPerRun = config.maxUsersPerRun ?? DEFAULT_MAX_USERS_PER_RUN;
  const log = deps.log ?? console;

  const cronSecret = config.cronSecret;
  if (!cronSecret) {
    log.error("[detect-weaves] refused: DETECT_WEAVES_CRON_SECRET is not set");
    await deps.recordRun({
      startedAt,
      finishedAt: deps.now(),
      status: "refused",
      usersScanned: 0,
      weavesDetected: 0,
      weavesExisting: 0,
      message: "DETECT_WEAVES_CRON_SECRET is not set",
      perUserErrors: [],
    });
    return { status: 503, body: "Server not configured" };
  }

  if (!safeEqual(cronHeader ?? "", cronSecret)) {
    return { status: 401, body: "Unauthorized" };
  }

  const now = deps.now();
  if (now - state.lastRunAt < minIntervalMs) {
    const retryAfter = Math.ceil((minIntervalMs - (now - state.lastRunAt)) / 1000);
    await deps.recordRun({
      startedAt,
      finishedAt: deps.now(),
      status: "refused",
      usersScanned: 0,
      weavesDetected: 0,
      weavesExisting: 0,
      message: `cooldown active, retry after ${retryAfter}s`,
      perUserErrors: [],
    });
    return {
      status: 429,
      body: "Too soon",
      headers: { "retry-after": String(retryAfter) },
    };
  }
  state.lastRunAt = now;

  const { rows, error: loadError } = await deps.loadActivePatternUserIds();
  if (loadError) {
    log.error("[detect-weaves] load patterns failed", loadError);
    const failedRunId = await deps.recordRun({
      startedAt,
      finishedAt: deps.now(),
      status: "error",
      usersScanned: 0,
      weavesDetected: 0,
      weavesExisting: 0,
      message: `load patterns failed: ${loadError}`,
      perUserErrors: [],
    });
    if (failedRunId) {
      await deps.evaluateAlerts(failedRunId).catch((err) =>
        log.error("[detect-weaves alerts] eval failed", err),
      );
    }
    return { status: 500, body: "Internal error" };
  }

  const userCounts = new Map<string, number>();
  for (const r of rows ?? []) {
    userCounts.set(r.user_id, (userCounts.get(r.user_id) ?? 0) + 1);
  }
  const candidates = Array.from(userCounts.entries())
    .filter(([, c]) => c >= 2)
    .map(([u]) => u)
    .slice(0, maxUsersPerRun);

  let totalDetected = 0;
  let totalExisting = 0;
  const perUserErrors: PerUserError[] = [];
  for (const userId of candidates) {
    try {
      const { inserted, existing } = await deps.detectWeavesForUser(userId);
      totalDetected += inserted;
      totalExisting += existing;
    } catch (e) {
      log.error("[detect-weaves cron] user failed", userId, e);
      perUserErrors.push({
        user_id: userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const finishedRunId = await deps.recordRun({
    startedAt,
    finishedAt: deps.now(),
    status: perUserErrors.length > 0 ? "partial" : "success",
    usersScanned: candidates.length,
    weavesDetected: totalDetected,
    weavesExisting: totalExisting,
    message: null,
    perUserErrors,
  });
  if (finishedRunId) {
    await deps.evaluateAlerts(finishedRunId).catch((err) =>
      log.error("[detect-weaves alerts] eval failed", err),
    );
  }

  return {
    status: 200,
    body: {
      ok: true,
      users_scanned: candidates.length,
      weaves_detected: totalDetected,
      weaves_existing: totalExisting,
      errors: perUserErrors.length,
    },
  };
}