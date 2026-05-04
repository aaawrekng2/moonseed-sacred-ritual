/**
 * EK-1 — Tiny SVG sparkline showing rhythm of card appearances over the
 * filter window. Plots a dot per appearance, connected by a thin gold
 * line. No axes, no labels — pure rhythm.
 */
export function StalkerSparkline({
  dates,
  windowStart,
  windowEnd,
  width = 200,
  height = 24,
}: {
  dates: string[];
  windowStart: number;
  windowEnd: number;
  width?: number;
  height?: number;
}) {
  if (dates.length === 0 || windowEnd <= windowStart) return null;
  const span = windowEnd - windowStart;
  const points = dates
    .map((d) => new Date(d).getTime())
    .filter((t) => t >= windowStart && t <= windowEnd)
    .sort((a, b) => a - b)
    .map((t) => {
      const x = ((t - windowStart) / span) * (width - 4) + 2;
      const y = height / 2;
      return { x, y };
    });
  if (points.length === 0) return null;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke="var(--gold)" strokeOpacity={0.6} strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--gold)" opacity={0.8} />
      ))}
    </svg>
  );
}