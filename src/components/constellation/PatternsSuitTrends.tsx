/**
 * PatternsSuitTrends (v3.138)
 *
 * A Suit Trends chart for Insights > Patterns, mirroring the Overview's chart
 * (granularity / percent-or-count / chart-type dropdowns, element-based suit
 * colors) but computed CLIENT-SIDE from the constellation's own reading data.
 * A scope dropdown switches the data source between the entire timeframe and
 * only the days currently displayed on the calendar (slots / asterism / hover).
 */
import { useMemo, useState, type CSSProperties } from "react";
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
import { SUIT_COLORS } from "@/lib/suit-colors";

export type TrendReading = { date: string; cardIds: number[] };

type Scope = "all" | "displayed";
type Gran = "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly";
type Mode = "pct" | "count";
type ChartType = "line" | "bar" | "area";

const SUIT_LABEL: Record<string, string> = {
  major: "Major Arcana",
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pentacles",
};
const SUITS = ["major", "wands", "cups", "swords", "pentacles"] as const;
type SuitKey = (typeof SUITS)[number];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function suitOf(cid: number): SuitKey | null {
  if (cid < 0 || cid > 77) return null;
  if (cid <= 21) return "major";
  if (cid <= 35) return "wands";
  if (cid <= 49) return "cups";
  if (cid <= 63) return "swords";
  return "pentacles";
}

function keyLabel(dateStr: string, gran: Gran): { key: string; label: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return { key: dateStr, label: dateStr };
  const utc = Date.UTC(y, m - 1, d);
  if (gran === "daily") return { key: dateStr, label: `${MON[m - 1]} ${d}` };
  if (gran === "monthly")
    return { key: `${y}-${String(m).padStart(2, "0")}`, label: MON[m - 1] };
  if (gran === "quarterly") {
    const q = Math.floor((m - 1) / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q}` };
  }
  const epochDays = Math.floor(utc / 86400000);
  if (gran === "fortnightly") {
    const fn = Math.floor(epochDays / 14);
    const start = new Date(fn * 14 * 86400000);
    return {
      key: `FN${String(fn).padStart(7, "0")}`,
      label: `${MON[start.getUTCMonth()]} ${start.getUTCDate()}`,
    };
  }
  // weekly — Monday-anchored
  const dow = new Date(utc).getUTCDay() || 7;
  const monday = utc - (dow - 1) * 86400000;
  const md = new Date(monday);
  return {
    key: `W${String(Math.floor(monday / 86400000)).padStart(7, "0")}`,
    label: `${MON[md.getUTCMonth()]} ${md.getUTCDate()}`,
  };
}

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

export function PatternsSuitTrends({
  allReadings,
  displayedReadings,
}: {
  allReadings: TrendReading[];
  displayedReadings: TrendReading[];
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [gran, setGran] = useState<Gran>("monthly");
  const [mode, setMode] = useState<Mode>("pct");
  const [chartType, setChartType] = useState<ChartType>("line");

  const source = scope === "all" ? allReadings : displayedReadings;
  const dayCount = new Set(source.map((r) => r.date)).size;
  const readingCount = source.length;
  const subtitle =
    scope === "all"
      ? `Entire timeframe — ${readingCount} reading${readingCount === 1 ? "" : "s"}`
      : `Displayed days — ${dayCount} day${dayCount === 1 ? "" : "s"} · ${readingCount} reading${readingCount === 1 ? "" : "s"}`;

  const chartData = useMemo(() => {
    const buckets = new Map<
      string,
      { label: string; major: number; wands: number; cups: number; swords: number; pentacles: number }
    >();
    for (const r of source) {
      const { key, label } = keyLabel(r.date, gran);
      let b = buckets.get(key);
      if (!b) {
        b = { label, major: 0, wands: 0, cups: 0, swords: 0, pentacles: 0 };
        buckets.set(key, b);
      }
      for (const cid of r.cardIds) {
        const s = suitOf(cid);
        if (s) b[s] += 1;
      }
    }
    const rows = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, b]) => b);
    if (mode === "pct") {
      return rows.map((b) => {
        const total = b.major + b.wands + b.cups + b.swords + b.pentacles;
        const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
        return {
          label: b.label,
          major: pct(b.major),
          wands: pct(b.wands),
          cups: pct(b.cups),
          swords: pct(b.swords),
          pentacles: pct(b.pentacles),
        };
      });
    }
    return rows.map((b) => ({
      label: b.label,
      major: b.major,
      wands: b.wands,
      cups: b.cups,
      swords: b.swords,
      pentacles: b.pentacles,
    }));
  }, [source, gran, mode]);

  const axisTick = {
    fontSize: "var(--text-caption)",
    fill: "var(--color-foreground)",
    opacity: 0.7,
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
  } as const;

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
      labelStyle={{ color: "var(--color-foreground)", fontWeight: 500, marginBottom: 4 }}
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
          <Line key={s} type="monotone" dataKey={s} stroke={SUIT_COLORS[s]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))
      : chartType === "bar"
        ? SUITS.map((s) => <Bar key={s} dataKey={s} stackId="a" fill={SUIT_COLORS[s]} />)
        : SUITS.map((s) => (
            <Area key={s} type="monotone" dataKey={s} stackId="a" stroke={SUIT_COLORS[s]} fill={SUIT_COLORS[s]} fillOpacity={0.45} />
          ));

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "var(--text-heading-md)", margin: 0 }}>
            Suit Trends
          </h3>
          <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--gold)", opacity: 0.95, margin: 0 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Data source" style={selectStyle}>
            <option value="all" style={{ color: "#000" }}>Entire timeframe</option>
            <option value="displayed" style={{ color: "#000" }}>Displayed days</option>
          </select>
          <select value={gran} onChange={(e) => setGran(e.target.value as Gran)} aria-label="Bucket by" style={selectStyle}>
            <option value="daily" style={{ color: "#000" }}>Day</option>
            <option value="weekly" style={{ color: "#000" }}>Week</option>
            <option value="fortnightly" style={{ color: "#000" }}>Fortnight</option>
            <option value="monthly" style={{ color: "#000" }}>Month</option>
            <option value="quarterly" style={{ color: "#000" }}>Quarter</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Percent or count" style={selectStyle}>
            <option value="pct" style={{ color: "#000" }}>Percent</option>
            <option value="count" style={{ color: "#000" }}>Count</option>
          </select>
          <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} aria-label="Chart type" style={selectStyle}>
            <option value="line" style={{ color: "#000" }}>Line</option>
            <option value="bar" style={{ color: "#000" }}>Stacked bar</option>
            <option value="area" style={{ color: "#000" }}>Stacked area</option>
          </select>
        </div>
      </div>

      {chartData.length >= 2 ? (
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "line" ? (
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                {axes}
                {series}
              </LineChart>
            ) : chartType === "bar" ? (
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                {axes}
                {series}
              </BarChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
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
          {scope === "displayed"
            ? "Nothing on the calendar to chart yet — place cards in slots, hover a card, or build an asterism."
            : "Not enough points at this bucket size — try a coarser one."}
        </div>
      )}
    </section>
  );
}
