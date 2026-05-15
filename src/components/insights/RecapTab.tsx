/**
 * EN-2 — Recap tab landing screen.
 * Lists lunations (most-recent first) with a tiny moon-cycle ring,
 * title, date range, and reading count. Tap a card to enter the
 * Lunation Recap story.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getEarliestReadingDate } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { getLunationHistory, formatLunationRange, type Lunation } from "@/lib/lunation";
import { MiniLunationRing } from "./MiniLunationRing";
import { YearOfLunationsLocked } from "./YearOfLunationsLocked";
import { LunationHint } from "./LunationHint";

export function RecapTab() {
  const earliestFn = useServerFn(getEarliestReadingDate);
  const [earliest, setEarliest] = useState<Date | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await earliestFn({ headers });
        if (!cancelled) {
          setEarliest(r.earliest ? new Date(r.earliest) : null);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [earliestFn]);

  const lunations: Lunation[] = useMemo(
    () => (loaded ? getLunationHistory(earliest) : []),
    [earliest, loaded],
  );

  const hasReadings = !!earliest;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <LunationHint />
      <header className="text-center">
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md, 2rem)",
            color: "var(--color-foreground)",
            lineHeight: 1.1,
          }}
        >
          Lunations
        </h1>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.7,
            marginTop: 6,
          }}
        >
          Each cycle of the moon is a chapter. Tap one to revisit.
        </p>
      </header>

      {!loaded && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{ height: 120, background: "var(--surface-card)", borderRadius: 18, opacity: 0.5 }}
            />
          ))}
        </div>
      )}

      {loaded && !hasReadings && (
        <div
          className="py-10 text-center"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.7,
            fontSize: "var(--text-body)",
          }}
        >
          Your lunations will fill in as the moon cycles. Begin reading to start your first.
        </div>
      )}

      {loaded && (
        <div className="flex flex-col gap-3">
          {lunations.map((l) => (
            // FK-5 — TanStack <Link> for reliable navigation. The old
            // programmatic navigate() inside an onClick handler did
            // not consistently fire for Mark on the recap landing.
            <Link
              key={l.start.toISOString()}
              to="/insights/recap/$lunationStart"
              params={{
                // EX-1 — encode ':' and '.' to '-' so the ISO datetime
                // survives as a single URL path segment.
                lunationStart: l.start.toISOString().replace(/[:.]/g, "-"),
              }}
              className="relative flex w-full items-center gap-4 p-4 text-left transition-opacity hover:opacity-95"
              style={{
                background: "var(--surface-card)",
                borderRadius: 18,
                minHeight: 120,
              }}
            >
              <div style={{ flexShrink: 0 }}>
                <MiniLunationRing size={80} />
              </div>
              <div className="flex-1">
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-heading-sm, 1.25rem)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {l.isCurrent ? "This Lunation" : `Lunation ${l.ordinal}`}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm)",
                    opacity: 0.7,
                    marginTop: 2,
                  }}
                >
                  {formatLunationRange(l)}
                </div>
              </div>
              {l.isCurrent && (
                <div
                  className="absolute flex items-center gap-1"
                  style={{ top: 12, right: 14 }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--gold)",
                      boxShadow: "0 0 8px var(--gold)",
                      animation: "pulse 2s ease-in-out infinite",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption, 0.7rem)",
                      color: "var(--gold)",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    Active
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {loaded && <YearOfLunationsLocked />}
    </div>
  );
}