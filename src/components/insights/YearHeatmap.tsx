import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getCalendarHeatmap } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";

type Day = { date: string; count: number; dominantSuit?: string };

function intensity(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 0.25;
  if (count === 2) return 0.45;
  if (count === 3) return 0.65;
  return 1;
}

/** EM-1 — GitHub-style year heatmap. */
export function YearHeatmap({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getCalendarHeatmap);
  const navigate = useNavigate();
  const [data, setData] = useState<{ days: Day[]; maxCount: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: filters, headers });
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, fn]);

  // Group days into weeks (columns). Pad start so first column begins on Sunday.
  const days = data?.days ?? [];
  const firstDate = days[0] ? new Date(days[0].date) : new Date();
  const padStart = firstDate.getDay(); // 0..6 (Sun..Sat)
  const cells: Array<Day | null> = [
    ...Array<Day | null>(padStart).fill(null),
    ...days,
  ];
  const weeks: Array<Array<Day | null>> = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const totalReadDays = days.filter((d) => d.count > 0).length;
  // Active streak: walk back from end while count>0
  let activeStreak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].count > 0) activeStreak += 1;
    else break;
  }

  // Month labels: index (week) where the 1st of a month falls.
  const monthLabels: Array<{ col: number; label: string }> = [];
  weeks.forEach((w, col) => {
    for (const d of w) {
      if (d && d.date.endsWith("-01")) {
        const m = new Date(d.date).toLocaleString("en", { month: "short" });
        monthLabels.push({ col, label: m });
        break;
      }
    }
  });

  return (
    <section
      className="p-4"
      style={{
        background: "var(--surface-card)",
        borderRadius: 18,
        boxShadow: "0 1px 3px color-mix(in oklch, var(--cosmos, #0a0a14) 25%, transparent)",
      }}
    >
      <header
        className="mb-3 uppercase"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption, 0.7rem)",
          letterSpacing: "0.18em",
          opacity: 0.55,
        }}
      >
        Reading rhythm
      </header>
      {loading && (
        <div className="animate-pulse" style={{ height: 120, background: "var(--surface-elevated)", borderRadius: 8, opacity: 0.4 }} />
      )}
      {!loading && days.length > 0 && (
        <div className="overflow-x-auto">
          <div style={{ display: "inline-block", minWidth: "100%" }}>
            <div className="mb-1 flex" style={{ paddingLeft: 18, gap: 2, fontSize: 9, opacity: 0.55 }}>
              {weeks.map((_, col) => {
                const m = monthLabels.find((x) => x.col === col);
                return (
                  <div key={col} style={{ width: 12, textAlign: "left" }}>
                    {m?.label ?? ""}
                  </div>
                );
              })}
            </div>
            <div className="flex" style={{ gap: 2 }}>
              <div className="flex flex-col" style={{ gap: 2, fontSize: 9, opacity: 0.55, paddingRight: 4, width: 14 }}>
                {["", "M", "", "W", "", "F", ""].map((l, i) => (
                  <div key={i} style={{ height: 12, lineHeight: "12px" }}>{l}</div>
                ))}
              </div>
              {weeks.map((w, col) => (
                <div key={col} className="flex flex-col" style={{ gap: 2 }}>
                  {Array.from({ length: 7 }).map((_, row) => {
                    const d = w[row] ?? null;
                    const op = d ? (d.count === 0 ? 0.08 : intensity(d.count)) : 0;
                    return (
                      <button
                        key={row}
                        type="button"
                        title={d ? `${d.date}: ${d.count} reading${d.count === 1 ? "" : "s"}` : ""}
                        disabled={!d}
                        onClick={() => {
                          if (d && d.count > 0) {
                            void navigate({ to: "/journal" });
                          }
                        }}
                        style={{
                          width: 12,
                          height: 12,
                          background: d ? "var(--gold)" : "transparent",
                          opacity: op,
                          borderRadius: 2,
                          cursor: d && d.count > 0 ? "pointer" : "default",
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {!loading && days.length === 0 && (
        <div style={{ fontStyle: "italic", opacity: 0.7, fontSize: "var(--text-body-sm)" }}>
          Your reading rhythm will fill in here as you practice.
        </div>
      )}
      {!loading && days.length > 0 && (
        <div
          className="mt-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            opacity: 0.7,
          }}
        >
          You read {totalReadDays} day{totalReadDays === 1 ? "" : "s"} out of the last {days.length}.
          {activeStreak >= 2 && ` Currently on day ${activeStreak} of a streak.`}
        </div>
      )}
    </section>
  );
}