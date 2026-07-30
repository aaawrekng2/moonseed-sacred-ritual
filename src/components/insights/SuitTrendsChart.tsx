import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
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
import { SUIT_COLORS } from "@/lib/suit-colors";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { useTimezone } from "@/lib/use-timezone";

const SUIT_LABEL: Record<string, string> = {
  major: "Major Arcana",
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pentacles",
};

const SUITS = ["major", "wands", "cups", "swords", "pentacles"] as const;

type Mode = "pct" | "count";
type ChartType = "line" | "bar" | "area";

const GRAN_OPTIONS: Array<{ id: SuitGranularity; label: string }> = [
  { id: "daily", label: "Day" },
  { id: "weekly", label: "Week" },
  { id: "fortnightly", label: "Fortnight" },
  { id: "monthly", label: "Month" },
  { id: "lunation", label: "Lunation" },
  { id: "quarterly", label: "Quarter" },
];

const selectStyle: CSSProperties = {
  background: "color-mix(in oklch, var(--gold) 12%, transparent)",
  color: "var(--gold)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 999,
  padding: "4px 10px",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 12,
  cursor: "pointer",
};

export function SuitTrendsChart({ filters, rangeLabel }: { filters: InsightsFilters; rangeLabel?: string }) {
  const fn = useServerFn(getSuitTrends);
  const { effectiveTz } = useTimezone();
  const [data, setData] = useState<{
    buckets: SuitBucket[];
    granularity: SuitGranularity;
    totalReadings: number;
    totalCards: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("pct");
  const [chartType, setChartType] = useState<ChartType>("line");
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

  const axisTick = {
    fontSize: "var(--text-caption)",
    fill: "var(--color-foreground)",
    opacity: 0.7,
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
  } as const;

  // Shared chart children (axes/grid/tooltip/legend). React flattens arrays, so
  // recharts still discovers each element by type.
  const axes = [
    <CartesianGrid key="g" strokeDasharray="3 3" stroke="var(--border-subtle)" />,
    <XAxis key="x" dataKey="label" tick={axisTick} stroke="var(--border-default)" />,
    <YAxis
      key="y"
      tick={axisTick}
      stroke="var(--border-default)"
      tickFormatter={(v) => (mode === "pct" ? `${v}%` : String(v))}
    />,
    <Tooltip
      key="t"
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
    />,
    <Legend
      key="l"
      wrapperStyle={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-caption)",
        paddingTop: 8,
      }}
      formatter={(value) => SUIT_LABEL[value as string] ?? value}
    />,
  ];

  const series =
    chartType === "line"
      ? SUITS.map((s) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            stroke={SUIT_COLORS[s]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))
      : chartType === "bar"
        ? SUITS.map((s) => (
            <Bar key={s} dataKey={s} stackId="a" fill={SUIT_COLORS[s]} />
          ))
        : SUITS.map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="a"
              stroke={SUIT_COLORS[s]}
              fill={SUIT_COLORS[s]}
              fillOpacity={0.45}
            />
          ));

  // v3.149 — caption totals: "N readings · M cards pulled in <range>".
  const statsLine =
    data
      ? `${data.totalReadings} reading${data.totalReadings === 1 ? "" : "s"} · ` +
        `${data.totalCards} card${data.totalCards === 1 ? "" : "s"} pulled` +
        `${rangeLabel ? ` in ${rangeLabel}` : ""}`
      : null;

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
            {statsLine ?? "Distribution of suits over time"}
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
            style={selectStyle}
          >
            {GRAN_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} style={{ color: "#000" }}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            aria-label="Show as percent or count"
            style={selectStyle}
          >
            <option value="pct" style={{ color: "#000" }}>
              Percent
            </option>
            <option value="count" style={{ color: "#000" }}>
              Count
            </option>
          </select>

          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value as ChartType)}
            aria-label="Chart type"
            style={selectStyle}
          >
            <option value="line" style={{ color: "#000" }}>
              Line
            </option>
            <option value="bar" style={{ color: "#000" }}>
              Stacked bar
            </option>
            <option value="area" style={{ color: "#000" }}>
              Stacked area
            </option>
          </select>
        </div>
      </div>

      {hasChart ? (
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "line" ? (
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 16, bottom: 8, left: -8 }}
              >
                {axes}
                {series}
              </LineChart>
            ) : chartType === "bar" ? (
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, bottom: 8, left: -8 }}
              >
                {axes}
                {series}
              </BarChart>
            ) : (
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 16, bottom: 8, left: -8 }}
              >
                {axes}
                {series}
              </AreaChart>
            )}
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
