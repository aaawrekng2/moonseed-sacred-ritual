/**
 * Typed wrappers around the generic analytics tracker for the
 * Share flow. Every payload is wrapped in a versioned envelope so
 * downstream dashboards can parse it reliably.
 *
 * SCHEMA CONTRACT (v1)
 * ────────────────────
 * Every share event carries the following envelope keys:
 *   schemaVersion: 1               // bump on breaking changes
 *   event:         string          // canonical event name
 *   context:       string          // e.g. "single", "three", "oracle:single"
 *   level?:        ShareLevel      // omitted only on `share_open` (which
 *                                  // reports `initialLevel` instead)
 *   intent?:       ShareIntent     // present on prepare/error/cancel/save
 *   category?:     ShareErrorCategory  // present on every failure event
 *   errorName?:    string          // raw error.name|message, present on failures
 *
 * Per-event extras live alongside the envelope keys (see each helper).
 *
 * Events:
 *   share_open              — builder dialog opened
 *   share_level_pick        — user explicitly switched to a level
 *   share_prepare           — PNG render attempt (success or failure)
 *   share_capture_failed    — image capture (html-to-image) failed
 *   share_web_share_failed  — Web Share API call failed after capture
 *   share_save_failed       — explicit Download PNG path failed
 *   share_success           — Web Share completed
 *   share_download          — image saved/downloaded
 *   share_error             — share or save failed (after preparation)
 *   share_cancel            — user dismissed preview without confirming
 *   share_retry_attempt     — user tapped Retry on a failed share step
 *   share_retry_resolved    — retry session ended (success or abandoned)
 */
import { track } from "@/lib/analytics";
import type { ShareLevel } from "./share-types";

export type ShareIntent = "share" | "save";

/**
 * Stable, low-cardinality buckets for share-flow failures. Free-form
 * error names/messages still flow through `errorName` for deeper
 * investigation, but `category` is what dashboards group by.
 */
export type ShareErrorCategory =
  | "permission" // browser/OS denied (e.g. NotAllowedError)
  | "cors" // tainted canvas / cross-origin image block
  | "network" // fetch / network failure
  | "abort" // user dismissed the share sheet (rarely tracked)
  | "unknown"; // anything else

/**
 * Bump on any breaking change to the payload shape (renamed key,
 * removed key, changed type). Adding new optional keys is non-breaking
 * and does NOT require a bump.
 */
export const SHARE_ANALYTICS_SCHEMA_VERSION = 1 as const;

/** Common envelope present on every share analytics event. */
export type ShareEventEnvelope = {
  schemaVersion: typeof SHARE_ANALYTICS_SCHEMA_VERSION;
  event: string;
  context: string;
  level?: ShareLevel;
  intent?: ShareIntent;
  category?: ShareErrorCategory;
  errorName?: string;
};

function emit(
  event: string,
  payload: Omit<ShareEventEnvelope, "schemaVersion" | "event"> &
    Record<string, unknown>,
) {
  // Failure events get deduped within a short window so a seeker
  // tap-tap-tapping Share doesn't spam dashboards with identical
  // rows. Success and lifecycle events always pass through.
  if (FAILURE_EVENTS.has(event) && shouldSuppressFailure(event, payload)) {
    return;
  }
  track(event, {
    schemaVersion: SHARE_ANALYTICS_SCHEMA_VERSION,
    event,
    ...payload,
  });
}

// ─── Failure dedup ───────────────────────────────────────────────────
//
// Identical failure events fired within `FAILURE_DEDUP_WINDOW_MS` are
// dropped at the source so analytics stays signal-rich. "Identical"
// means same event name + context + level + intent + category +
// errorName — different categories or different errors still flow
// through, even back-to-back.
//
// Window is intentionally short (a couple of seconds): long enough to
// absorb double-tap / rage-tap bursts, short enough that a deliberate
// retry after reading the error banner is still recorded.

const FAILURE_EVENTS: ReadonlySet<string> = new Set([
  "share_capture_failed",
  "share_web_share_failed",
  "share_save_failed",
  "share_error",
  // share_prepare with ok:false also counts as a failure event
  "share_prepare",
]);

const FAILURE_DEDUP_WINDOW_MS = 2000;

const lastFailureAt = new Map<string, number>();

function failureKey(
  event: string,
  payload: Record<string, unknown>,
): string {
  return [
    event,
    payload.context ?? "",
    payload.level ?? "",
    payload.intent ?? "",
    payload.category ?? "",
    payload.errorName ?? "",
  ].join("|");
}

function shouldSuppressFailure(
  event: string,
  payload: Record<string, unknown>,
): boolean {
  // share_prepare success (ok:true) is not a failure — let it through.
  if (event === "share_prepare" && payload.ok !== false) return false;

  const now = Date.now();
  const key = failureKey(event, payload);
  const prev = lastFailureAt.get(key);
  if (prev !== undefined && now - prev < FAILURE_DEDUP_WINDOW_MS) {
    return true;
  }
  lastFailureAt.set(key, now);
  // Opportunistic GC so the map can't grow unbounded across a long
  // session of varied failures.
  if (lastFailureAt.size > 64) {
    for (const [k, t] of lastFailureAt) {
      if (now - t >= FAILURE_DEDUP_WINDOW_MS) lastFailureAt.delete(k);
    }
  }
  return false;
}

// ─── Lifecycle ───────────────────────────────────────────────────────

export function trackShareOpen(props: {
  context: string;
  initialLevel: ShareLevel;
  availableLevels: ShareLevel[];
}) {
  emit("share_open", {
    context: props.context,
    initialLevel: props.initialLevel,
    availableLevels: props.availableLevels,
  });
}

export function trackShareLevelPick(props: {
  context: string;
  level: ShareLevel;
  previousLevel: ShareLevel;
}) {
  emit("share_level_pick", {
    context: props.context,
    level: props.level,
    previousLevel: props.previousLevel,
  });
}

// ─── Prepare / capture ───────────────────────────────────────────────

export function trackSharePrepare(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  ok: boolean;
  errorName?: string;
  category?: ShareErrorCategory;
}) {
  emit("share_prepare", {
    context: props.context,
    level: props.level,
    intent: props.intent,
    ok: props.ok,
    errorName: props.errorName,
    category: props.category,
  });
}

/**
 * Image capture (html-to-image) failed — the Web Share / download
 * step never ran. Mirrors `share_prepare { ok: false }` but as a
 * dedicated event so funnels stay readable.
 */
export function trackShareCaptureFailed(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  category: ShareErrorCategory;
  errorName: string;
}) {
  emit("share_capture_failed", {
    context: props.context,
    level: props.level,
    intent: props.intent,
    category: props.category,
    errorName: props.errorName,
  });
}

// ─── Confirm: success paths ──────────────────────────────────────────

export function trackShareSuccess(props: {
  context: string;
  level: ShareLevel;
}) {
  emit("share_success", {
    context: props.context,
    level: props.level,
  });
}

export function trackShareDownload(props: {
  context: string;
  level: ShareLevel;
  reason: "user" | "share_unsupported";
}) {
  emit("share_download", {
    context: props.context,
    level: props.level,
    reason: props.reason,
  });
}

// ─── Confirm: failure paths ──────────────────────────────────────────

export function trackShareError(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  errorName: string;
  category: ShareErrorCategory;
}) {
  emit("share_error", {
    context: props.context,
    level: props.level,
    intent: props.intent,
    errorName: props.errorName,
    category: props.category,
  });
}

/** Web Share API failed after a successful capture (intent === "share"). */
export function trackShareWebShareFailed(props: {
  context: string;
  level: ShareLevel;
  category: ShareErrorCategory;
  errorName: string;
}) {
  emit("share_web_share_failed", {
    context: props.context,
    level: props.level,
    intent: "share",
    category: props.category,
    errorName: props.errorName,
  });
}

/** Explicit Download PNG path failed after a successful capture. */
export function trackShareSaveFailed(props: {
  context: string;
  level: ShareLevel;
  category: ShareErrorCategory;
  errorName: string;
}) {
  emit("share_save_failed", {
    context: props.context,
    level: props.level,
    intent: "save",
    category: props.category,
    errorName: props.errorName,
  });
}

// ─── Cancel ──────────────────────────────────────────────────────────

export function trackShareCancel(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
}) {
  emit("share_cancel", {
    context: props.context,
    level: props.level,
    intent: props.intent,
  });
}

// ─── Retry tracking ──────────────────────────────────────────────────
//
// A retry "session" begins on the first failure of a given step
// (prepare or confirm) and ends when the seeker either succeeds or
// abandons. Each Retry tap emits `share_retry_attempt` with the
// running count; the terminating state emits `share_retry_resolved`
// once. Sessions where the seeker never retried are not reported.

export function trackShareRetryAttempt(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  step: "prepare" | "confirm";
  /** 1-indexed: the first retry is `attempts: 1`. */
  attempts: number;
  originalCategory: ShareErrorCategory;
  originalErrorName: string;
}) {
  emit("share_retry_attempt", {
    context: props.context,
    level: props.level,
    intent: props.intent,
    step: props.step,
    attempts: props.attempts,
    category: props.originalCategory,
    errorName: props.originalErrorName,
  });
}

export function trackShareRetryResolved(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  step: "prepare" | "confirm";
  /** Number of retry taps before the resolution (>= 1). */
  attempts: number;
  resolution: "success" | "abandoned";
  originalCategory: ShareErrorCategory;
  originalErrorName: string;
}) {
  emit("share_retry_resolved", {
    context: props.context,
    level: props.level,
    intent: props.intent,
    step: props.step,
    attempts: props.attempts,
    resolution: props.resolution,
    category: props.originalCategory,
    errorName: props.originalErrorName,
  });
}
