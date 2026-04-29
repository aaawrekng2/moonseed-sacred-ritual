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
import { getYmdInTz, getDeviceTimezone } from "@/lib/use-timezone";

export const DAILY_RESET_EVENT = "moonseed:daily-reset";

/**
 * YYYY-MM-DD key for "today" as observed in the given IANA timezone.
 * Defaults to the device timezone when omitted — but callers that know
 * the seeker's effective timezone (e.g. profile-locked "fixed" mode)
 * SHOULD pass it explicitly so the ritual cadence honors that choice.
 */
export function getLocalDayKey(timeZone?: string, d: Date = new Date()): string {
  return getYmdInTz(d, timeZone ?? getDeviceTimezone());
}

export function useDailyReset(timeZone?: string): { today: string; epoch: number } {
  const [today, setToday] = useState<string>(() => getLocalDayKey(timeZone));
  const [epoch, setEpoch] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = getLocalDayKey(timeZone);
    // If the timezone changed (e.g. user toggled fixed → auto), re-seed
    // immediately so the next check compares against the right day.
    if (last !== today) {
      setToday(last);
      setEpoch((n) => n + 1);
    }

    const check = () => {
      const next = getLocalDayKey(timeZone);
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
    // Re-subscribe when the seeker's effective timezone changes so the
    // day-flip check honors the new zone immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone]);

  return { today, epoch };
}