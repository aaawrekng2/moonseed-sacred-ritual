/**
 * EK101 — Atlas web.
 *
 * All 78 standard tarot cards laid out in a single clock ring. The Fool
 * (card 00) sits at the 12 o'clock position; the remaining cards run
 * clockwise — 01, 02, 03, … 77.
 *
 * Connecting lines show co-occurrence across the seeker's filtered
 * reading history: for every pair of cards that have appeared together
 * in a spread, a line is drawn, with weight and opacity scaling by how
 * often they have met.
 *
 * Interaction mirrors the hero+companions web (ConstellationWeb):
 *   - Clicking a card toggles it into the teal asterism selection. The
 *     calendar below reacts exactly as it does on the manual-entry page.
 *   - Hovering a card opens the master card popover via the parent's
 *     hover handler (handleConstellationHover) and breathes that card's
 *     own days on the calendar.
 *
 * This is deliberately a SEPARATE component from ConstellationWeb. That
 * one is hard-wired around a single hero plus seven companions in fixed
 * boxes; rendering 78 nodes through it would destabilise every other
 * surface it draws on (the popover mini-web, Insights). Atlas owns its
 * own layout path.
 */

type AtlasPair = { a: number; b: number; count: number };

export function AtlasWeb({
  pairs,
  tealSelectedIds,
  onCardClick,
  onCardHover,
}: {
  pairs: AtlasPair[];
  tealSelectedIds: number[];
  onCardClick: (cardId: number) => void;
  onCardHover?: (
    cardId: number | null,
    clientX: number,
    clientY: number,
    targetRect?: DOMRect | null,
  ) => void;
}) {
  const N = 78;
  const cx = 380;
  const cy = 372;
  const R = 300;
  const nodeW = 20;
  const nodeH = 28;

  const pos = (i: number) => {
    // -90deg puts index 0 at the top (12 o'clock); increasing angle runs
    // clockwise in SVG's y-down coordinate space.
    const ang = ((-90 + i * (360 / N)) * Math.PI) / 180;
    return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  };

  // Max co-occurrence count, for line-weight scaling. Floor at 1 so an
  // empty history (no pairs) doesn't divide by zero.
  const maxCount = pairs.reduce((m, p) => Math.max(m, p.count), 1);

  const tealSet = new Set(tealSelectedIds);
  const traceColor = "var(--trace-color, #5cead4)";

  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <svg
        viewBox="0 0 760 760"
        style={{ width: "100%", maxWidth: 720, height: "auto" }}
        role="img"
        aria-label="All 78 tarot cards arranged in a clock ring, the Fool at the 12 o'clock position, running clockwise"
      >
        {/* Co-occurrence lines, drawn behind the cards. */}
        <g>
          {pairs.map((p) => {
            const A = pos(p.a);
            const B = pos(p.b);
            const t = p.count / maxCount;
            return (
              <line
                key={`${p.a}-${p.b}`}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke="var(--accent)"
                strokeWidth={0.5 + t * 1.6}
                opacity={0.1 + t * 0.45}
                pointerEvents="none"
              />
            );
          })}
        </g>

        {/* The 78 card nodes. */}
        <g>
          {Array.from({ length: N }, (_, i) => {
            const { x, y } = pos(i);
            const selected = tealSet.has(i);
            return (
              <g
                key={i}
                style={{ cursor: "pointer" }}
                onClick={() => onCardClick(i)}
                onMouseEnter={(e) =>
                  onCardHover?.(
                    i,
                    e.clientX,
                    e.clientY,
                    (e.currentTarget as SVGGElement).getBoundingClientRect(),
                  )
                }
                onMouseLeave={(e) => onCardHover?.(null, e.clientX, e.clientY)}
              >
                <rect
                  x={x - nodeW / 2}
                  y={y - nodeH / 2}
                  width={nodeW}
                  height={nodeH}
                  rx={3}
                  fill="var(--surface-card)"
                  stroke={selected ? traceColor : "var(--border-subtle)"}
                  strokeWidth={selected ? 2 : 0.75}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 9,
                    fill: "var(--color-foreground)",
                    pointerEvents: "none",
                  }}
                >
                  {String(i).padStart(2, "0")}
                </text>
              </g>
            );
          })}
        </g>

        {/* Marker naming the card at 12 o'clock. */}
        <text
          x={cx}
          y={cy - R - 16}
          textAnchor="middle"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 13,
            fill: "var(--color-foreground-muted, var(--color-foreground))",
          }}
        >
          00 · The Fool
        </text>
      </svg>
    </div>
  );
}
