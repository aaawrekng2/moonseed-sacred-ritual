/**
 * v3.52 — client-side activity tracking.
 *
 * `track(event, props)` is fire-and-forget: it never throws and never blocks
 * the UI. A per-tab session id (sessionStorage) ties events into sessions.
 * `session_start` fires once per session automatically on first load.
 *
 * Add `track(ACTIVITY.X, { ... })` at feature sites as they get instrumented.
 */
import { recordActivityEvent } from "./activity.functions";

export const ACTIVITY = {
  SESSION_START: "session_start",
  SIGN_IN: "sign_in",
  SPREAD_DRAWN: "spread_drawn",
  READING_SAVED: "reading_saved",
  AI_READING: "ai_reading_generated",
  AI_PROMPT_COPIED: "ai_prompt_copied",
  JOURNAL_ENTRY: "journal_entry",
  SHARE: "share",
  DECK_ACTION: "deck_action",
  INSIGHTS_VIEWED: "insights_viewed",
  PATTERNS_VIEWED: "patterns_viewed",
  MOON_VIEWED: "moon_viewed",
  SETTINGS_CHANGED: "settings_changed",
} as const;

const SESSION_KEY = "tarotseed:session_id";
const STARTED_KEY = "tarotseed:session_started";

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let s = window.sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = newId();
      window.sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch {
    return newId();
  }
}

export function track(
  eventName: string,
  properties: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  try {
    void recordActivityEvent({
      data: {
        eventName,
        properties,
        sessionId: getSessionId(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        timeZone: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            return undefined;
          }
        })(),
      },
    }).catch(() => {});
  } catch {
    /* never throw from tracking */
  }
}

// Fire session_start once per tab-session, shortly after load so anonymous
// auth has settled (the server fn requires an authenticated context).
if (typeof window !== "undefined") {
  try {
    if (!window.sessionStorage.getItem(STARTED_KEY)) {
      window.sessionStorage.setItem(STARTED_KEY, "1");
      window.setTimeout(() => track(ACTIVITY.SESSION_START), 1500);
    }
  } catch {
    /* ignore */
  }
}
