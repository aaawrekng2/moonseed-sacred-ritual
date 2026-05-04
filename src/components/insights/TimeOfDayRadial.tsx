import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTimeOfDayPattern } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useTimezone } from "@/lib/use-timezone";
import type { InsightsFilters } from "@/lib/insights.types";

function descriptor(h: number): string {
  if (h <= 5) return "the dark hours";
  if (h <= 11) return "morning light";
  if (h <= 17) return "midday";
  if (h <= 21) return "evening";
  return "the night";
}

function fmtH(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
}

/** EM-3 — 24-hour radial chart of reading times. */
export function TimeOfDayRadial({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getTimeOfDayPattern);
  const tz = useTimezone();
  const [data, setData] = useState<{
    hours: Array<{ hour: number; count: number }>;
    peakHour: number | null;
    peakLabel: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { ...filters, timeZone: tz.effectiveTz }, headers });
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
  }, [filters, fn, tz.effectiveTz]);

  const hours = data?.hours ?? [];
  const max = Math.max(1, ...hours.map((h) => h.count));
  const total = hours.reduce((a, b) => a + b.count, 0);

  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 30;
  const maxR = 120;
  const barWidth = 8;

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
        Time of day
      </header>
      {loading && (
        <div className="animate-pulse" style={{ height: 200, background: "var(--surface-elevated)", borderRadius: 8, opacity: 0.4 }} />
      )}
      {!loading && total === 0 && (
        <div style={{ fontStyle: "italic", opacity: 0.7, fontSize: "var(--text-body-sm)" }}>
          No timing data yet.
        </div>
      )}
      {!loading && total > 0 && (
        <div className="flex flex-col items-center">
          <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="auto" style={{ maxWidth: 320 }}>
            <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="var(--gold)" strokeOpacity={0.2} />
            {hours.map(({ hour, count }) => {
              const angle = (hour / 24) * 360 - 90; // 0h at top
              const len = innerR + (count / max) * (maxR - innerR);
              const rad = (angle * Math.PI) / 180;
              const x1 = cx + Math.cos(rad) * innerR;
              const y1 = cy + Math.sin(rad) * innerR;
              const x2 = cx + Math.cos(rad) * len;
              const y2 = cy + Math.sin(rad) * len;
              const op = count === 0 ? 0.08 : 0.4 + (count / max) * 0.6;
              return (
                <line
                  key={hour}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--gold)"
                  strokeWidth={barWidth}
                  strokeLinecap="round"
                  opacity={op}
                  onMouseEnter={() => setHovered(hour)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer" }}
                >
                  <title>{`${fmtH(hour)}: ${count} reading${count === 1 ? "" : "s"}`}</title>
                </line>
              );
            })}
            {[0, 6, 12, 18].map((h) => {
              const angle = (h / 24) * 360 - 90;
              const rad = (angle * Math.PI) / 180;
              const lx = cx + Math.cos(rad) * (maxR + 14);
              const ly = cy + Math.sin(rad) * (maxR + 14);
              return (
                <text
                  key={h}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="10"
                  fill="var(--color-foreground)"
                  opacity={0.55}
                >
                  {fmtH(h)}
                </text>
              );
            })}
          </svg>
          {hovered !== null && (
            <div style={{ fontStyle: "italic", fontSize: "var(--text-caption, 0.75rem)", opacity: 0.8 }}>
              {fmtH(hovered)}: {hours[hovered]?.count ?? 0}
            </div>
          )}
        </div>
      )}
      {!loading && data?.peakHour !== null && data?.peakHour !== undefined && (
        <div
          className="mt-3 text-center"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            opacity: 0.7,
          }}
        >
          You read mostly between {data.peakLabel} — {descriptor(data.peakHour)}.
        </div>
      )}
    </section>
  );
}