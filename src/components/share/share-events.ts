/**
 * Typed wrappers around the generic analytics tracker for the
 * Share flow. Centralised so event names stay consistent across
 * components and dashboards.
 *
 * Events:
 *   share_open       — builder dialog opened
 *   share_level_pick — user explicitly switched to a level
 *   share_prepare    — PNG render attempt (success/failure)
 *   share_capture_failed — image capture (html-to-image) failed
 *   share_web_share_failed — Web Share API call failed after capture
 *   share_save_failed — explicit Download PNG path failed
 *   share_success    — Web Share completed
 *   share_download   — image saved/downloaded
 *   share_error      — share or save failed (after preparation)
 *   share_cancel     — user dismissed preview without confirming
 */
import { track } from "@/lib/analytics";
import type { ShareLevel } from "./share-types";

export type ShareIntent = "share" | "save";

/**
 * Stable, low-cardinality buckets for share-flow failures. Free-form
 * error names/messages still flow through `error`/`errorName` for
 * deeper investigation, but `category` is what dashboards group by.
 */
export type ShareErrorCategory =
  | "permission" // browser/OS denied (e.g. NotAllowedError)
  | "cors" // tainted canvas / cross-origin image block
  | "network" // fetch / network failure
  | "abort" // user dismissed the share sheet (rarely tracked)
  | "unknown"; // anything else

export function trackShareOpen(props: {
  context: string;
  initialLevel: ShareLevel;
  availableLevels: ShareLevel[];
}) {
  track("share_open", props);
}

export function trackShareLevelPick(props: {
  context: string;
  level: ShareLevel;
  previousLevel: ShareLevel;
}) {
  track("share_level_pick", props);
}

export function trackSharePrepare(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  ok: boolean;
  error?: string;
  category?: ShareErrorCategory;
}) {
  track("share_prepare", props);
}

export function trackShareSuccess(props: {
  context: string;
  level: ShareLevel;
}) {
  track("share_success", props);
}

export function trackShareDownload(props: {
  context: string;
  level: ShareLevel;
  reason: "user" | "share_unsupported";
}) {
  track("share_download", props);
}

export function trackShareError(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
  error: string;
  category: ShareErrorCategory;
}) {
  track("share_error", props);
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
  track("share_capture_failed", props);
}

/**
 * Web Share API failed after a successful capture (intent === "share").
 */
export function trackShareWebShareFailed(props: {
  context: string;
  level: ShareLevel;
  category: ShareErrorCategory;
  errorName: string;
}) {
  track("share_web_share_failed", props);
}

/**
 * Explicit Download PNG path failed after a successful capture.
 */
export function trackShareSaveFailed(props: {
  context: string;
  level: ShareLevel;
  category: ShareErrorCategory;
  errorName: string;
}) {
  track("share_save_failed", props);
}

export function trackShareCancel(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
}) {
  track("share_cancel", props);
}