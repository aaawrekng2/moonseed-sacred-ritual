/**
 * Daily moon ritual reset.
 *
 * Watches the local calendar day and fires whenever it changes:
 *  - on visibility change (returning to the tab next morning),
 *  - on window focus,
 *  - on a 60s tick (covers tabs left open across midnight).
 *
 * Returns the current local YYYY-MM-DD `today` string and a monotonic
 * `epoch` counter that bumps every time the day rolls over. Components
 * can include `epoch` in an effect's dep list to re-run their daily
 * queries / refresh stale UI.
 *
 * Also dispatches a global `moonseed:daily-reset` CustomEvent so
 * sibling components in different trees can react without prop-drilling.
 */
import { useEffect, useState } from "react";

export const DAILY_RESET_EVENT = "moonseed:daily-reset";

export function getLocalDayKey(d: Date = new Date()): string {
  // YYYY-MM-DD in the seeker's local time zone — never UTC, since the
  // ritual cadence is anchored to the seeker's own dawn.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useDailyReset(): { today: string; epoch: number } {
  const [today, setToday] = useState<string>(() => getLocalDayKey());
  const [epoch, setEpoch] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = today;

    const check = () => {
      const next = getLocalDayKey();
      if (next !== last) {
        last = next;
        setToday(next);
        setEpoch((n) => n + 1);
        try {
          window.dispatchEvent(
            new CustomEvent(DAILY_RESET_EVENT, { detail: next }),
          );
        } catch {
          // ignore
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    // Cross-tree listener for components that aren't consuming this hook
    // directly but still want to react to the same day-flip event.
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail !== last) {
        last = detail;
        setToday(detail);
        setEpoch((n) => n + 1);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", check);
    window.addEventListener(DAILY_RESET_EVENT, onExternal);
    const interval = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", check);
      window.removeEventListener(DAILY_RESET_EVENT, onExternal);
      window.clearInterval(interval);
    };
    // Intentionally only on mount — the inner `last` closure tracks the
    // current day without re-subscribing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { today, epoch };
}