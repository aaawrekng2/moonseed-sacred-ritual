import { InsightCard } from "./InsightCard";

const PHASES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
] as const;

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

export function MoonPhaseRing({
  distribution,
  onTap,
}: {
  distribution: Record<string, number>;
  onTap?: () => void;
}) {
  const counts = PHASES.map((p) => distribution[p] ?? 0);
  const max = Math.max(1, ...counts);
  const dominantIdx = counts.indexOf(Math.max(...counts));
  const dominant = PHASES[dominantIdx];
  const total = counts.reduce((a, b) => a + b, 0);
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = 54;
  const inner = 28;
  const segAngle = 360 / 8;

  return (
    <InsightCard
      title="Moon phases"
      caption={
        total === 0
          ? "No moon phases logged yet."
          : `You read most under the ${dominant}.`
      }
      onTap={onTap}
    >
      <div className="flex justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {PHASES.map((_, i) => {
            const start = i * segAngle;
            const end = (i + 1) * segAngle - 1;
            const intensity = total === 0 ? 0.08 : 0.15 + (counts[i] / max) * 0.85;
            return (
              <path
                key={i}
                d={arcPath(cx, cy, r, start, end, inner)}
                fill="var(--gold)"
                opacity={intensity}
              />
            );
          })}
        </svg>
      </div>
    </InsightCard>
  );
}