/**
 * Typed wrappers around the generic analytics tracker for the
 * Share flow. Centralised so event names stay consistent across
 * components and dashboards.
 *
 * Events:
 *   share_open       — builder dialog opened
 *   share_level_pick — user explicitly switched to a level
 *   share_prepare    — PNG render attempt (success/failure)
 *   share_success    — Web Share completed
 *   share_download   — image saved/downloaded
 *   share_error      — share or save failed (after preparation)
 *   share_cancel     — user dismissed preview without confirming
 */
import { track } from "@/lib/analytics";
import type { ShareLevel } from "./share-types";

export type ShareIntent = "share" | "save";

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
}) {
  track("share_error", props);
}

export function trackShareCancel(props: {
  context: string;
  level: ShareLevel;
  intent: ShareIntent;
}) {
  track("share_cancel", props);
}