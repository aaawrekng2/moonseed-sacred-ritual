import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getStreakHistory } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { STREAK_ELEMENT_COLORS, type StreakElement } from "@/lib/streak-phase";
import { formatDateShort } from "@/lib/dates";

type Streak = { startDate: string; endDate: string; length: number; isActive: boolean };

function elementForLength(len: number): StreakElement {
  if (len >= 48) return "fire";
  if (len >= 36) return "fire";
  if (len >= 24) return "air";
  if (len >= 12) return "water";
  if (len >= 12) return "earth"; // unreachable but kept for clarity
  return "none";
}

function colorFor(len: number): string {
  if (len >= 48) return STREAK_ELEMENT_COLORS.fire;
  if (len >= 36) return STREAK_ELEMENT_COLORS.fire;
  if (len >= 24) return STREAK_ELEMENT_COLORS.air;
  if (len >= 12) return STREAK_ELEMENT_COLORS.water;
  return STREAK_ELEMENT_COLORS.none;
}

function fmtRange(s: string, e: string): string {
  return s === e ? formatDateShort(s) : `${formatDateShort(s)}–${formatDateShort(e)}`;
}

/** EM-4 — Streak history bar timeline. */
export function StreakHistory() {
  const fn = useServerFn(getStreakHistory);
  const [data, setData] = useState<{
    streaks: Streak[];
    currentStreak: number;
    longestStreak: number;
    singleDayPulls: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ headers });
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
  }, [fn]);

  const streaks = data?.streaks ?? [];
  const max = Math.max(1, ...streaks.map((s) => s.length));

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
        Streak history
      </header>
      {loading && (
        <div className="animate-pulse" style={{ height: 120, background: "var(--surface-elevated)", borderRadius: 8, opacity: 0.4 }} />
      )}
      {!loading && streaks.length === 0 && (
        <div style={{ fontStyle: "italic", opacity: 0.7, fontSize: "var(--text-body-sm)" }}>
          Your streaks will appear here as your practice deepens.
        </div>
      )}
      {!loading && streaks.length > 0 && (
        <>
          <div
            className="mb-3"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 0.75rem)",
              opacity: 0.7,
            }}
          >
            Your practice rhythm: {streaks.length} streaks of 2+ days, longest {data!.longestStreak} days.
          </div>
          <div className="flex flex-col gap-2">
            {streaks.map((s) => (
              <div key={`${s.startDate}-${s.endDate}`} className="flex flex-col gap-1">
                <div
                  style={{
                    width: `${Math.max(8, (s.length / max) * 100)}%`,
                    height: 14,
                    background: colorFor(s.length),
                    borderRadius: 4,
                    boxShadow: s.isActive
                      ? "0 0 0 1px var(--gold), 0 0 16px color-mix(in oklch, var(--gold) 50%, transparent)"
                      : undefined,
                    animation: s.isActive ? "pulse 2s ease-in-out infinite" : undefined,
                  }}
                  title={`${s.length} days · ${elementForLength(s.length)}`}
                />
                <div style={{ fontSize: "0.7rem", opacity: 0.6, fontStyle: "italic" }}>
                  {s.length} days, {fmtRange(s.startDate, s.endDate)}
                  {s.isActive && " · active"}
                </div>
              </div>
            ))}
          </div>
          {data!.singleDayPulls > 0 && (
            <div
              className="mt-3"
              style={{
                fontStyle: "italic",
                fontSize: "var(--text-caption, 0.75rem)",
                opacity: 0.55,
              }}
            >
              Plus {data!.singleDayPulls} single-day pull{data!.singleDayPulls === 1 ? "" : "s"}.
            </div>
          )}
        </>
      )}
    </section>
  );
}