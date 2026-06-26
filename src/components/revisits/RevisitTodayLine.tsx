/**
 * v2.10 — RevisitTodayLine.
 *
 * A quiet line above the draw types on Today. When the seeker has any
 * revisits due (or past-due), it shows "{n} readings ready to revisit"
 * with a count badge, taps into Journal filtered to Awaiting reflection,
 * and an X hides it until the next day. No modal — it can't nag.
 *
 * The X dismissal is per-day: we store today's date and suppress the line
 * for the rest of the day. It returns naturally the next day if anything
 * is still due.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, X as XIcon } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useTimezone } from "@/lib/use-timezone";
import { nowYmdInTz } from "@/lib/time";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { getDueRevisits } from "@/lib/revisits.functions";

const HIDE_KEY = "tarotseed:revisit-line-hidden-on";
const OPEN_FLAG = "tarotseed:open-awaiting-reflection";

export function RevisitTodayLine() {
  const navigate = useNavigate();
  const { effectiveTz } = useTimezone();
  const fetchDue = useServerFn(getDueRevisits);
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = nowYmdInTz(effectiveTz);
        let hiddenToday = false;
        try {
          hiddenToday = window.localStorage.getItem(HIDE_KEY) === today;
        } catch {
          /* ignore */
        }
        if (hiddenToday) {
          if (!cancelled) setHidden(true);
          return;
        }
        const headers = await getAuthHeaders();
        const res = (await fetchDue({
          data: { tz: effectiveTz },
          headers,
        })) as { count: number };
        if (cancelled) return;
        setCount(res?.count ?? 0);
        setHidden(false);
      } catch {
        if (!cancelled) setHidden(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveTz, fetchDue]);

  if (hidden || count <= 0) return null;

  const open = () => {
    try {
      window.localStorage.setItem(OPEN_FLAG, "1");
    } catch {
      /* ignore */
    }
    void navigate({ to: "/journal" });
  };

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      window.localStorage.setItem(HIDE_KEY, nowYmdInTz(effectiveTz));
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        margin: "0 auto 10px",
        width: "fit-content",
        maxWidth: "90vw",
      }}
    >
      <button
        type="button"
        onClick={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 2px",
          color: "var(--color-foreground)",
        }}
      >
        <CalendarClock
          className="h-4 w-4"
          style={{ color: "var(--gold)" }}
          aria-hidden="true"
        />
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
          }}
        >
          {count} {count === 1 ? "reading" : "readings"} ready to revisit
        </span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: "var(--gold)",
            color: "#1a1205",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {count}
        </span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide until tomorrow"
        style={{
          background: "none",
          border: "none",
          padding: 2,
          cursor: "pointer",
          color: "var(--color-foreground-muted)",
          opacity: 0.5,
        }}
      >
        <XIcon size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}
