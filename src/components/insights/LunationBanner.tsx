/**
 * EN-4 — Soft "Your last lunation is ready to revisit" banner.
 * Renders on the Overview tab only. Tracks last-viewed lunation
 * in localStorage; X dismisses until the next New Moon arrives.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, X } from "lucide-react";
import { getLunationContaining, formatLunationRange } from "@/lib/lunation";

const STORAGE_KEY = "moonseed:lastViewedLunationStart";

export function LunationBanner() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [previousStart, setPreviousStart] = useState<Date | null>(null);
  const [previousEnd, setPreviousEnd] = useState<Date | null>(null);

  useEffect(() => {
    try {
      const today = new Date();
      const current = getLunationContaining(today);
      // Previous lunation = ends at current.start.
      const prev = getLunationContaining(new Date(current.start.getTime() - 24 * 60 * 60 * 1000));
      const lastViewed = localStorage.getItem(STORAGE_KEY);
      const lastViewedDate = lastViewed ? new Date(lastViewed) : null;
      // Only show if previous lunation hasn't been viewed/dismissed yet.
      if (!lastViewedDate || lastViewedDate < prev.start) {
        setPreviousStart(prev.start);
        setPreviousEnd(prev.end);
        setShow(true);
      }
    } catch {
      // ignore
    }
  }, []);

  if (!show || !previousStart || !previousEnd) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, previousStart.toISOString());
    } catch {
      // ignore
    }
    setShow(false);
  };

  const open = () => {
    try {
      localStorage.setItem(STORAGE_KEY, previousStart.toISOString());
    } catch {
      // ignore
    }
    void navigate({
      to: "/insights/recap/$lunationStart",
      params: { lunationStart: previousStart.toISOString() },
    });
  };

  return (
    <div
      className="flex w-full items-center gap-3 px-4 py-3"
      style={{
        background: "var(--surface-card)",
        borderRadius: 12,
        borderLeft: "3px solid var(--gold)",
      }}
    >
      <button
        type="button"
        onClick={open}
        className="flex flex-1 items-center justify-between gap-2 text-left"
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
            }}
          >
            Your last lunation is ready to revisit.
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 0.7rem)",
              opacity: 0.6,
              marginTop: 2,
            }}
          >
            {formatLunationRange({ start: previousStart, end: previousEnd })}
          </div>
        </div>
        <ChevronRight size={18} style={{ color: "var(--gold)", opacity: 0.85, flexShrink: 0 }} />
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded-full p-1"
        style={{ color: "var(--color-foreground)", opacity: 0.55 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}