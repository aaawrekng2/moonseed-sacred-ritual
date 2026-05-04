import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMoonPhaseStats } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import type { MoonPhaseName } from "@/lib/moon";

const PHASES: MoonPhaseName[] = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
];

const GLYPHS: Record<MoonPhaseName, string> = {
  "New Moon": "🌑",
  "Waxing Crescent": "🌒",
  "First Quarter": "🌓",
  "Waxing Gibbous": "🌔",
  "Full Moon": "🌕",
  "Waning Gibbous": "🌖",
  "Last Quarter": "🌗",
  "Waning Crescent": "🌘",
};

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, inner: number) {
  const polar = (angle: number, radius: number) => {
    const a = ((angle - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };
  const [x1, y1] = polar(startAngle, r);
  const [x2, y2] = polar(endAngle, r);
  const [x3, y3] = polar(endAngle, inner);
  const [x4, y4] = polar(startAngle, inner);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

/** EM-2 — Large interactive moon phase ring for the Calendar tab. */
export function MoonPhaseInsightRing({
  filters,
  onPhaseToggle,
}: {
  filters: InsightsFilters;
  onPhaseToggle?: (phase: MoonPhaseName) => void;
}) {
  const fn = useServerFn(getMoonPhaseStats);
  const [data, setData] = useState<{
    phaseCounts: Record<string, number>;
    totalReadings: number;
    dominantPhase: string | null;
  } | null>(null);
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

  const counts = PHASES.map((p) => data?.phaseCounts[p] ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  const dominant = (data?.dominantPhase as MoonPhaseName | null) ?? null;
  const dominantCount = dominant ? data?.phaseCounts[dominant] ?? 0 : 0;
  const dominantPct = total > 0 ? Math.round((dominantCount / total) * 100) : 0;
  const activePhase = filters.moonPhases[0] as MoonPhaseName | undefined;

  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const r = 150;
  const inner = 70;
  const segAngle = 360 / 8;

  return (
    <section className="flex flex-col items-center">
      {loading && (
        <div
          className="animate-pulse"
          style={{ width: 280, height: 280, borderRadius: "50%", background: "var(--surface-card)", opacity: 0.4 }}
        />
      )}
      {!loading && (
        <div className="relative" style={{ width: "min(100%, 360px)" }}>
          <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="auto">
            {PHASES.map((phase, i) => {
              const start = i * segAngle;
              const end = (i + 1) * segAngle - 1;
              const c = counts[i];
              const op = total === 0 ? 0.06 : 0.12 + (c / max) * 0.85;
              const isActive = activePhase === phase;
              return (
                <g key={phase}>
                  <path
                    d={arcPath(cx, cy, r, start, end, inner)}
                    fill="var(--gold)"
                    opacity={op}
                    onClick={() => {
                      onPhaseToggle?.(phase);
                    }}
                    style={{ cursor: "pointer" }}
                  />
                  {isActive && (
                    <path
                      d={arcPath(cx, cy, r, start, end, inner)}
                      fill="none"
                      stroke="var(--gold)"
                      strokeWidth={3}
                    />
                  )}
                  <text
                    x={cx + ((r + inner) / 2) * Math.cos(((start + end) / 2 - 90) * Math.PI / 180)}
                    y={cy + ((r + inner) / 2) * Math.sin(((start + end) / 2 - 90) * Math.PI / 180)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="22"
                    style={{ pointerEvents: "none" }}
                  >
                    {GLYPHS[phase]}
                  </text>
                  {c > 0 && (
                    <text
                      x={cx + ((r + inner) / 2 + 18) * Math.cos(((start + end) / 2 - 90) * Math.PI / 180)}
                      y={cy + ((r + inner) / 2 + 18) * Math.sin(((start + end) / 2 - 90) * Math.PI / 180)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fill="var(--color-foreground)"
                      opacity={0.7}
                      style={{ pointerEvents: "none" }}
                    >
                      {c}
                    </text>
                  )}
                </g>
              );
            })}
            <foreignObject x={cx - inner + 6} y={cy - inner + 6} width={(inner - 6) * 2} height={(inner - 6) * 2}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "0.85rem",
                  lineHeight: 1.2,
                  padding: 4,
                  color: "var(--color-foreground)",
                }}
              >
                {dominant ? `Most under the ${dominant}` : "No moon data yet"}
              </div>
            </foreignObject>
          </svg>
        </div>
      )}
      {!loading && dominant && (
        <div
          className="mt-2 text-center"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            opacity: 0.7,
          }}
        >
          You read most under the {dominant}. That's {dominantPct}% of your readings.
        </div>
      )}
    </section>
  );
}