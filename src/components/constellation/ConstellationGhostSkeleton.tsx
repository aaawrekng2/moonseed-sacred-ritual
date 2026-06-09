/**
 * EK74 — ConstellationGhostSkeleton
 *
 * A faint, gently-breathing placeholder shaped like a constellation: a hero
 * node at center-top with companion nodes and connecting lines around it.
 * Used wherever the constellation web has no hero yet but "add a card to
 * begin" would be meaningless (the card popover's mini-constellation, the
 * Insights surface). The manual-entry page keeps its own prompt instead.
 *
 * Pure presentational, theme-token only, no data. Reuses the shared
 * `.tarotseed-constellation-breathe` animation from styles.css for the
 * subtle shimmer.
 */
export function ConstellationGhostSkeleton() {
  // Hero (center-top) + six companions in fixed faint positions.
  const hero = { x: 150, y: 58 };
  const companions = [
    { x: 60, y: 120 },
    { x: 240, y: 120 },
    { x: 95, y: 185 },
    { x: 205, y: 185 },
    { x: 150, y: 205 },
    { x: 150, y: 150 },
  ];
  const stroke = "color-mix(in oklab, var(--accent, var(--gold)) 38%, transparent)";
  const nodeFill = "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)";

  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        aspectRatio: "300 / 230",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="0 0 300 230"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        className="tarotseed-constellation-breathe"
        style={{ opacity: 0.7 }}
      >
        {/* Connecting lines hero → companions + a few companion links */}
        {companions.map((c, i) => (
          <line
            key={`l-${i}`}
            x1={hero.x}
            y1={hero.y}
            x2={c.x}
            y2={c.y}
            stroke={stroke}
            strokeWidth={1}
          />
        ))}
        <line x1={companions[0].x} y1={companions[0].y} x2={companions[2].x} y2={companions[2].y} stroke={stroke} strokeWidth={0.75} />
        <line x1={companions[1].x} y1={companions[1].y} x2={companions[3].x} y2={companions[3].y} stroke={stroke} strokeWidth={0.75} />

        {/* Companion nodes */}
        {companions.map((c, i) => (
          <circle key={`c-${i}`} cx={c.x} cy={c.y} r={9} fill={nodeFill} stroke={stroke} strokeWidth={1} />
        ))}

        {/* Hero node — a faint card shape */}
        <rect
          x={hero.x - 20}
          y={hero.y - 30}
          width={40}
          height={60}
          rx={6}
          fill={nodeFill}
          stroke={stroke}
          strokeWidth={1.25}
        />
      </svg>
    </div>
  );
}
