import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  getSuitTrends,
  type SuitBucket,
  type SuitGranularity,
} from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { useTimezone } from "@/lib/use-timezone";

// v3.130 — element-based suit colors, clearly distinct on the dark crimson
// ground: Major = violet, Wands = orange (fire), Cups = blue (water),
// Swords = gold (air), Pentacles = green (earth).
const SUIT_COLOR: Record<string, string> = {
  major: "#a855f7",
  wands: "#f97316",
  cups: "#3b82f6",
  swords: "#eab308",
  pentacles: "#22c55e",
};

const SUIT_LABEL: Record<string, string> = {
  major: "Major Arcana",
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pentacles",
};

const SUITS = ["major", "wands", "cups", "swords", "pentacles"] as const;

type Mode = "pct" | "count";

const GRAN_OPTIONS: Array<{ id: SuitGranularity; label: string }> = [
  { id: "daily", label: "Day" },
  { id: "weekly", label: "Week" },
  { id: "fortnightly", label: "Fortnight" },
  { id: "monthly", label: "Month" },
  { id: "quarterly", label: "Quarter" },
];

export function SuitTrendsChart({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getSuitTrends);
  const { effectiveTz } = useTimezone();
  const [data, setData] = useState<{
    buckets: SuitBucket[];
    granularity: SuitGranularity;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("pct");
  // null = let the server auto-pick a sensible bucket size for the range.
  const [gran, setGran] = useState<SuitGranularity | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const headers = await getAuthHeaders();
        const r = await fn({
          // v3.94 — use the shared top-left timeframe (filters.timeRange).
          data: { ...filters, tz: effectiveTz, granularity: gran ?? undefined },
          headers,
        });
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
  }, [filters, fn, effectiveTz, gran]);

  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data.buckets)) return [];
    return data.buckets.map((b) => {
      const total = b.major + b.wands + b.cups + b.swords + b.pentacles;
      if (mode === "pct") {
        const pct = (n: number) =>
          total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
        return {
          label: b.label,
          major: pct(b.major),
          wands: pct(b.wands),
          cups: pct(b.cups),
          swords: pct(b.swords),
          pentacles: pct(b.pentacles),
        };
      }
      return {
        label: b.label,
        major: b.major,
        wands: b.wands,
        cups: b.cups,
        swords: b.swords,
        pentacles: b.pentacles,
      };
    });
  }, [data, mode]);

  if (loading && !data) return null;
  if (!data) return null;

  const selectedGran: SuitGranularity = gran ?? data.granularity;
  const hasChart = Array.isArray(data.buckets) && data.buckets.length >= 2;

  return (
    <section
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "var(--text-heading-md)",
              margin: 0,
            }}
          >
            Suit Trends
          </h3>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              opacity: 0.7,
              margin: 0,
            }}
          >
            Distribution of suits over time
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <select
            value={selectedGran}
            onChange={(e) => setGran(e.target.value as SuitGranularity)}
            aria-label="Bucket each data point by"
            style={{
              background: "color-mix(in oklch, var(--gold) 12%, transparent)",
              color: "var(--gold)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 999,
              padding: "4px 10px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {GRAN_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} style={{ color: "#000" }}>
                {o.label}
              </option>
            ))}
          </select>

          <div
            className="flex gap-1 rounded-full p-0.5"
            style={{ background: "var(--surface-card)" }}
          >
            {(
              [
                { id: "pct", label: "%" },
                { id: "count", label: "Count" },
              ] as const
            ).map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setMode(it.id)}
                className="rounded-full px-2 py-1 text-xs"
                style={{
                  background:
                    mode === it.id
                      ? "color-mix(in oklch, var(--gold) 24%, transparent)"
                      : "transparent",
                  color:
                    mode === it.id
                      ? "var(--gold)"
                      : "var(--color-foreground)",
                  fontStyle: "italic",
                  opacity: mode === it.id ? 1 : 0.7,
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasChart ? (
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 8, left: -8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis
                dataKey="label"
                tick={{
                  fontSize: "var(--text-caption)",
                  fill: "var(--color-foreground)",
                  opacity: 0.7,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                }}
                stroke="var(--border-default)"
              />
              <YAxis
                tick={{
                  fontSize: "var(--text-caption)",
                  fill: "var(--color-foreground)",
                  opacity: 0.7,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                }}
                stroke="var(--border-default)"
                tickFormatter={(v) => (mode === "pct" ? `${v}%` : String(v))}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-caption)",
                }}
                formatter={(value: number, name: string) => [
                  mode === "pct" ? `${value}%` : value,
                  SUIT_LABEL[name] ?? name,
                ]}
                labelStyle={{
                  color: "var(--color-foreground)",
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              />
              <Legend
                wrapperStyle={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-caption)",
                  paddingTop: 8,
                }}
                formatter={(value) => SUIT_LABEL[value as string] ?? value}
              />
              {SUITS.map((s) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={SUIT_COLOR[s]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground-muted)",
            textAlign: "center",
            padding: "32px 8px",
          }}
        >
          Not enough points at this bucket size — try a coarser one.
        </div>
      )}
    </section>
  );
}
