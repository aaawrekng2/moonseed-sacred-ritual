/**
 * EK101 / EK102 — Atlas web.
 *
 * All 78 standard tarot cards laid out in a single clock ring. The Fool
 * (card 00) sits at the 12 o'clock position; the remaining cards run
 * clockwise — 01, 02, 03, … 77.
 *
 * EK102 — each node is now the real CARD IMAGE (rendered through the
 * seeker's active deck), not a number. Three behaviours hang off the
 * HTML card nodes:
 *
 *   - DRAG TO SLOTS. Each card is natively draggable and writes the same
 *     `application/x-tarotseed-cardid` payload the slot row already
 *     accepts, so dragging an atlas card into a slot just works.
 *   - DOCK MAGNIFY. As the cursor nears the ring, cards lean in and grow
 *     like macOS dock icons — focused card biggest, neighbours tapering
 *     off. Driven by direct transform writes inside a rAF tick (no React
 *     re-render per mouse move) so it stays smooth across all 78 cards.
 *   - CLICK + HOVER. Click toggles a card into the teal asterism
 *     selection; hover opens the master card popover. Both reuse the
 *     parent's existing handlers, so the calendar reacts identically.
 *
 * Connecting lines show co-occurrence across the seeker's filtered
 * reading history, weight + opacity scaling by how often two cards meet.
 *
 * This is deliberately a SEPARATE component from ConstellationWeb. That
 * one is hard-wired around a single hero plus seven companions in fixed
 * boxes; rendering 78 nodes through it would destabilise every other
 * surface it draws on. Atlas owns its own layout path.
 */
import { useRef } from "react";
import { CardImage } from "@/components/card/CardImage";

type AtlasPair = { a: number; b: number; count: number };

const N = 78;
const STAGE = 660; // square logical stage; scales to fit via maxWidth
const CX = STAGE / 2;
const CY = STAGE / 2 + 8; // nudge down slightly to leave room for the label
const R = 272;
const CARD_W = 20; // base card width; magnify scales this up on hover
const REACH = 120; // px — dock magnify influence radius (approved EK102)
const MAX_SCALE = 2.6; // px — focused card grows to this multiple (approved)

function anglePos(i: number): { x: number; y: number } {
  // -90deg puts index 0 at the top (12 o'clock); increasing angle runs
  // clockwise in the y-down coordinate space.
  const a = ((-90 + i * (360 / N)) * Math.PI) / 180;
  return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
}

const POS: Array<{ x: number; y: number }> = Array.from({ length: N }, (_, i) =>
  anglePos(i),
);

export function AtlasWeb({
  pairs,
  tealSelectedIds,
  onCardClick,
  onCardHover,
  onCardDragStart,
  onCardDragEnd,
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
  onCardDragStart?: (cardId: number) => void;
  onCardDragEnd?: () => void;
}) {
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  // Max co-occurrence count, for line-weight scaling. Floor at 1 so an
  // empty history (no pairs) doesn't divide by zero.
  const maxCount = pairs.reduce((m, p) => Math.max(m, p.count), 1);
  const tealSet = new Set(tealSelectedIds);
  const traceColor = "var(--trace-color, #5cead4)";

  // Write each card's scale + z-index directly. mx/my are in STAGE-logical
  // pixels (the same space POS lives in), so REACH is honoured at any
  // rendered size.
  const applyMagnify = (mx: number | null, my: number | null) => {
    for (let i = 0; i < N; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      let s = 1;
      if (mx !== null && my !== null) {
        const d = Math.hypot(mx - POS[i].x, my - POS[i].y);
        if (d < REACH) {
          const f = 0.5 * (1 + Math.cos((Math.PI * d) / REACH));
          s = 1 + (MAX_SCALE - 1) * f;
        }
      }
      el.style.transform = `translate(-50%, -50%) scale(${s.toFixed(3)})`;
      el.style.zIndex = String(Math.round(s * 100));
    }
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // Convert the cursor into STAGE-logical coordinates so the magnify
    // math is resolution-independent if the stage is scaled down to fit.
    const x = ((e.clientX - r.left) * STAGE) / r.width;
    const y = ((e.clientY - r.top) * STAGE) / r.height;
    pendingRef.current = { x, y };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingRef.current)
          applyMagnify(pendingRef.current.x, pendingRef.current.y);
      });
    }
  };

  const onLeave = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    applyMagnify(null, null);
  };

  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <div
        style={{
          position: "relative",
          width: STAGE,
          height: STAGE,
          maxWidth: "100%",
        }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* Co-occurrence lines, behind the cards. */}
        <svg
          viewBox={`0 0 ${STAGE} ${STAGE}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
          aria-hidden
        >
          {pairs.map((p) => {
            const A = POS[p.a];
            const B = POS[p.b];
            if (!A || !B) return null;
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
              />
            );
          })}
        </svg>

        {/* The 78 card images. */}
        {Array.from({ length: N }, (_, i) => {
          const { x, y } = POS[i];
          const selected = tealSet.has(i);
          return (
            <div
              key={i}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              draggable={!!onCardDragStart}
              onDragStart={(e) => {
                if (!onCardDragStart) return;
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData(
                  "application/x-tarotseed-cardid",
                  String(i),
                );
                onCardDragStart(i);
              }}
              onDragEnd={() => onCardDragEnd?.()}
              onClick={() => onCardClick(i)}
              onMouseEnter={(e) =>
                onCardHover?.(
                  i,
                  e.clientX,
                  e.clientY,
                  e.currentTarget.getBoundingClientRect(),
                )
              }
              onMouseLeave={(e) => onCardHover?.(null, e.clientX, e.clientY)}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: CARD_W,
                transform: "translate(-50%, -50%) scale(1)",
                transformOrigin: "center center",
                transition: "transform 90ms ease-out",
                cursor: "grab",
                willChange: "transform",
                borderRadius: 3,
                lineHeight: 0,
                boxShadow: selected ? `0 0 0 2px ${traceColor}` : "none",
              }}
            >
              <CardImage
                variant="face"
                cardId={i}
                size="custom"
                widthPx={CARD_W}
              />
            </div>
          );
        })}

        {/* Marker naming the card at 12 o'clock. */}
        <div
          style={{
            position: "absolute",
            left: CX,
            top: CY - R - 24,
            transform: "translateX(-50%)",
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 13,
            color: "var(--color-foreground-muted, var(--color-foreground))",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          00 · The Fool
        </div>
      </div>
    </div>
  );
}
