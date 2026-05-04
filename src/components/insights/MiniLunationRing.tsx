/**
 * EN-2 — Tiny 8-glyph ring depicting a single lunation cycle.
 * Decorative; not interactive.
 */
const PHASES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

export function MiniLunationRing({ size = 80 }: { size?: number }) {
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--gold)"
        strokeOpacity={0.18}
      />
      {PHASES.map((g, i) => {
        const angle = (i / PHASES.length) * 2 * Math.PI - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size / 7}
            opacity={0.85}
          >
            {g}
          </text>
        );
      })}
    </svg>
  );
}