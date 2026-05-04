/**
 * EM-2 — Guide preferences over time as a stacked area chart.
 * SVG path-based, no chart library.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getGuidePreferences } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, EmptyNote, SkeletonRow } from "./StalkerCardsSection";

// Distinct, non-suit hues. Aligned with Moonseed palette but not elemental.
const GUIDE_COLORS = [
  "var(--gold)",
  "color-mix(in oklab, var(--gold) 60%, var(--cosmos, #2a2860) 40%)",
  "color-mix(in oklab, #b388eb 70%, transparent)",
  "color-mix(in oklab, #88c0d0 70%, transparent)",
  "color-mix(in oklab, #c9a96e 80%, transparent)",
  "color-mix(in oklab, #e6a4b4 70%, transparent)",
];

type Data = {
  months: Array<{ month: string; counts: Record<string, number> }>;
  guides: Array<{ guideId: string; name: string; totalCount: number }>;
  bucket: "week" | "month";
};

export function GuidePreferences({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getGuidePreferences);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [emphasized, setEmphasized] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = (await fn({ data: filters, headers })) as Data;
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

  const caption = useMemo(() => {
    if (!data || data.months.length === 0 || data.guides.length === 0) return null;
    if (data.guides.length === 1) {
      return `You always reach for ${data.guides[0].name}.`;
    }
    const half = Math.floor(data.months.length / 2);
    const dominantIn = (slice: Data["months"]) => {
      const totals = new Map<string, number>();
      for (const m of slice) {
        for (const [g, c] of Object.entries(m.counts)) {
          totals.set(g, (totals.get(g) ?? 0) + c);
        }
      }
      const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
      return top?.[0] ?? null;
    };
    const recent = dominantIn(data.months.slice(half));
    const earlier = dominantIn(data.months.slice(0, half));
    const nameOf = (id: string | null) =>
      data.guides.find((g) => g.guideId === id)?.name ?? id ?? "your guide";
    if (!recent || !earlier || recent === earlier) {
      return `${nameOf(recent ?? earlier)} has been your steady voice.`;
    }
    return `You spent time with ${nameOf(earlier)}; now you reach for ${nameOf(recent)}.`;
  }, [data]);

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Guides over time"
        caption="Whose voice you've been reaching for."
      />
      {loading && <SkeletonRow />}
      {!loading && (!data || data.guides.length === 0) && (
        <EmptyNote text="You haven't selected a guide yet." />
      )}
      {!loading && data && data.guides.length > 0 && data.months.length > 0 && (
        <div
          className="p-4"
          style={{ background: "var(--surface-card)", borderRadius: 18 }}
        >
          <StackedAreaChart data={data} emphasized={emphasized} onEmphasize={setEmphasized} />
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {data.guides.map((g, i) => {
              const isEmph = emphasized === g.guideId;
              return (
                <button
                  key={g.guideId}
                  type="button"
                  onClick={() =>
                    setEmphasized(emphasized === g.guideId ? null : g.guideId)
                  }
                  className="flex items-center gap-1.5"
                  style={{
                    fontStyle: "italic",
                    fontSize: "var(--text-caption, 0.75rem)",
                    opacity: emphasized && !isEmph ? 0.4 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: GUIDE_COLORS[i % GUIDE_COLORS.length],
                      display: "inline-block",
                    }}
                  />
                  {g.name}
                </button>
              );
            })}
          </div>
          {caption && (
            <p
              className="mt-3 text-center"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption, 0.75rem)",
                opacity: 0.65,
              }}
            >
              {caption}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function StackedAreaChart({
  data,
  emphasized,
  onEmphasize,
}: {
  data: Data;
  emphasized: string | null;
  onEmphasize: (id: string | null) => void;
}) {
  const W = 400;
  const H = 180;
  const padding = { top: 8, right: 8, bottom: 18, left: 8 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const months = data.months;
  const guides = data.guides;
  // Per month, total used to compute proportional stacks.
  const totals = months.map((m) =>
    guides.reduce((acc, g) => acc + (m.counts[g.guideId] ?? 0), 0),
  );
  const maxTotal = Math.max(1, ...totals);
  const pointX = (i: number) =>
    months.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (months.length - 1)) * innerW;
  // Build cumulative bands per guide.
  const bands = guides.map((g, gi) => {
    const upper: Array<[number, number]> = [];
    const lower: Array<[number, number]> = [];
    months.forEach((m, mi) => {
      let cumLower = 0;
      for (let k = 0; k < gi; k++) cumLower += m.counts[guides[k].guideId] ?? 0;
      const value = m.counts[g.guideId] ?? 0;
      const yBottom = padding.top + innerH - (cumLower / maxTotal) * innerH;
      const yTop =
        padding.top + innerH - ((cumLower + value) / maxTotal) * innerH;
      lower.push([pointX(mi), yBottom]);
      upper.push([pointX(mi), yTop]);
    });
    return { guide: g, color: GUIDE_COLORS[gi % GUIDE_COLORS.length], upper, lower };
  });

  const toPath = (upper: Array<[number, number]>, lower: Array<[number, number]>) => {
    if (upper.length === 0) return "";
    const smooth = (pts: Array<[number, number]>) => {
      if (pts.length < 2) return `M ${pts[0][0]} ${pts[0][1]}`;
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const cx = (x0 + x1) / 2;
        d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
      }
      return d;
    };
    const top = smooth(upper);
    const reversedLower = [...lower].reverse();
    const bot = smooth(reversedLower).replace(/^M/, "L");
    return `${top} ${bot} Z`;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="Guide use over time"
      style={{ display: "block" }}
    >
      {bands.map((b) => {
        const dim = emphasized && emphasized !== b.guide.guideId;
        return (
          <path
            key={b.guide.guideId}
            d={toPath(b.upper, b.lower)}
            fill={b.color}
            opacity={dim ? 0.18 : 0.85}
            onClick={() =>
              onEmphasize(emphasized === b.guide.guideId ? null : b.guide.guideId)
            }
            style={{ cursor: "pointer", transition: "opacity 200ms ease" }}
          />
        );
      })}
      {/* Bucket labels (first + last) */}
      <text
        x={padding.left}
        y={H - 4}
        fontSize="9"
        fill="var(--color-foreground)"
        opacity={0.5}
      >
        {months[0]?.month}
      </text>
      <text
        x={W - padding.right}
        y={H - 4}
        fontSize="9"
        textAnchor="end"
        fill="var(--color-foreground)"
        opacity={0.5}
      >
        {months[months.length - 1]?.month}
      </text>
    </svg>
  );
}