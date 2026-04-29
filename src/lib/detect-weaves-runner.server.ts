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
   * Atomic database-backed cooldown check. The implementation MUST:
   *   - take a short-lived advisory lock so concurrent calls across
   *     instances cannot both acquire the slot;
   *   - compare the persisted last-run timestamp to `minIntervalMs`;
   *   - on success, stamp a new last-run timestamp and return acquired=true;
   *   - on cooldown / lock contention, return acquired=false plus the
   *     number of seconds the caller should wait before retrying.
   *
   * This replaces the in-memory `lastRunAt` so the cooldown survives
   * restarts and is enforced across multiple server instances.
   */
  tryAcquireSlot: (
    minIntervalMs: number,
  ) => Promise<{ acquired: boolean; retryAfterSeconds: number }>;
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
  /**
   * When false, the cron-secret check is bypassed entirely (no 503 if the
   * secret is unset, no 401 on mismatch). Cooldown + per-run cap still apply.
   *
   * TEMPORARY: used in Phase 9 while Vault seeding is deferred. Phase 10 will
   * flip this back to true and reinstate the secret requirement.
   */
  requireCronSecret?: boolean;
};

export type DetectWeavesResponse = {
  status: number;
  body: string | Record<string, unknown>;
  headers?: Record<string, string>;
};

/**
 * Headers we accept on the incoming request. Anything else is rejected so an
 * attacker cannot smuggle extra metadata (custom auth tokens, tracing, cache
 * poisoning hints) through the public endpoint. Standard hop-by-hop and
 * transport headers added automatically by clients/proxies are allowed.
 */
const ALLOWED_REQUEST_HEADERS = new Set<string>([
  // Required / expected app headers
  "x-cron-secret",
  "content-type",
  "content-length",
  "accept",
  "user-agent",
  // Standard transport / proxy headers we don't control
  "host",
  "connection",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "pragma",
  "te",
  "traceparent",
  "tracestate",
  "x-request-id",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cdn-loop",
  "forwarded",
  "via",
]);

/** Header names matching these prefixes are always allowed (proxy noise). */
const ALLOWED_REQUEST_HEADER_PREFIXES = ["sec-", "cf-", "x-vercel-"];

export type RequestLike = {
  method: string;
  headers: { forEach: (cb: (value: string, key: string) => void) => void };
};

/**
 * Strict request shape validation. Runs BEFORE any auth or DB work so the
 * cheapest checks rejecting bad shapes happen first.
 *
 *  - Only POST is accepted (other methods get 405 + Allow header).
 *  - A request body, if any, MUST declare `application/json` (415 otherwise).
 *    A missing content-type is allowed only when there is no body
 *    (content-length 0 / absent). pg_cron's net.http_post always sets it.
 *  - Any header outside the allowlist (and standard proxy noise) yields 400.
 */
export function validateDetectWeavesRequest(
  req: RequestLike,
): DetectWeavesResponse | null {
  if (req.method !== "POST") {
    return {
      status: 405,
      body: "Method Not Allowed",
      headers: { allow: "POST" },
    };
  }

  let contentType: string | null = null;
  let contentLength: string | null = null;
  const unexpected: string[] = [];
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-type") contentType = value;
    if (k === "content-length") contentLength = value;
    if (ALLOWED_REQUEST_HEADERS.has(k)) return;
    if (ALLOWED_REQUEST_HEADER_PREFIXES.some((p) => k.startsWith(p))) return;
    unexpected.push(k);
  });

  if (unexpected.length > 0) {
    return {
      status: 400,
      body: `Unexpected header(s): ${unexpected.sort().join(", ")}`,
    };
  }

  const hasBody = contentLength !== null && contentLength !== "0";
  if (hasBody || contentType !== null) {
    const ct = (contentType ?? "").toLowerCase().split(";")[0].trim();
    if (ct !== "application/json") {
      return {
        status: 415,
        body: "Unsupported Media Type",
        headers: { accept: "application/json" },
      };
    }
  }

  return null;
}

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
 * adapts into a real Response. The cooldown is enforced via
 * `deps.tryAcquireSlot`, which is backed by Postgres (see migration
 * `try_acquire_detect_weaves_slot`) — no in-memory state is used so that the
 * limit holds across server restarts and multiple instances.
 */
export async function runDetectWeaves(
  deps: DetectWeavesDeps,
  config: DetectWeavesConfig,
  cronHeader: string | null,
): Promise<DetectWeavesResponse> {
  const startedAt = deps.now();
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const maxUsersPerRun = config.maxUsersPerRun ?? DEFAULT_MAX_USERS_PER_RUN;
  const log = deps.log ?? console;

  const cronSecret = config.cronSecret;
  const requireCronSecret = config.requireCronSecret ?? true;
  if (requireCronSecret) {
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
  } else {
    log.error(
      "[detect-weaves] WARNING: cron-secret check disabled (requireCronSecret=false). Phase 10 must re-enable it.",
    );
  }

  // Persistent, multi-instance safe cooldown. Backed by an advisory lock
  // + singleton row in Postgres — see try_acquire_detect_weaves_slot.
  let slot: { acquired: boolean; retryAfterSeconds: number };
  try {
    slot = await deps.tryAcquireSlot(minIntervalMs);
  } catch (e) {
    log.error("[detect-weaves] tryAcquireSlot failed", e);
    await deps.recordRun({
      startedAt,
      finishedAt: deps.now(),
      status: "error",
      usersScanned: 0,
      weavesDetected: 0,
      weavesExisting: 0,
      message: `lock acquire failed: ${e instanceof Error ? e.message : String(e)}`,
      perUserErrors: [],
    });
    return { status: 500, body: "Internal error" };
  }
  if (!slot.acquired) {
    const retryAfter = Math.max(1, slot.retryAfterSeconds);
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