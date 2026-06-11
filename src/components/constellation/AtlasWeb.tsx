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
import { useRef, useState, useLayoutEffect } from "react";
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

// EK105 — line endpoints stop just INSIDE each card (radius R - inset)
// instead of at the card centre, so on the small ring it's obvious which
// card a line is reaching toward rather than the line vanishing behind it.
const LINE_INSET = 16;
const INSET_POS: Array<{ x: number; y: number }> = Array.from(
  { length: N },
  (_, i) => {
    const a = ((-90 + i * (360 / N)) * Math.PI) / 180;
    return {
      x: CX + (R - LINE_INSET) * Math.cos(a),
      y: CY + (R - LINE_INSET) * Math.sin(a),
    };
  },
);

export function AtlasWeb({
  pairs,
  tealSelectedIds,
  onCardClick,
  onCardHover,
  onCardDragStart,
  onCardDragEnd,
  candidateIds,
  heroCardId,
  heroDrawCount,
  heroBadgeTooltip,
  onHeroBadgeClick,
  tealBadge,
  onTealBadgeClick,
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
  /** EK104 — cards that co-occurred with the whole teal set; the lines
   *  from a teal card out to these render in the trace color. */
  candidateIds?: number[];
  /** EK104 — hero (first slot) card + its spread count, for the gold badge. */
  heroCardId?: number | null;
  heroDrawCount?: number | null;
  heroBadgeTooltip?: string;
  onHeroBadgeClick?: () => void;
  /** EK104 — asterism badge on the first-selected card when 2+ are picked. */
  tealBadge?: { cardId: number; count: number; tooltip?: string } | null;
  onTealBadgeClick?: () => void;
}) {
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  // EK105 — which card the cursor is currently over. Drives the
  // hover-preview: while an asterism is active, hovering another card
  // lights its connections to the selection in the trace color. Kept as
  // state (it must re-render the line layer), separate from the magnify,
  // which writes transforms directly to the DOM (see below).
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null);

  // EK105 — own the cards' transform OUTSIDE the React style prop. The
  // magnify writes el.style.transform directly every frame; if transform
  // also lived in the inline style, a hover-driven re-render would reset
  // it to scale(1) and fight the magnify. We set the centred resting
  // transform once, before paint, and let the magnify own it thereafter.
  useLayoutEffect(() => {
    for (let i = 0; i < N; i++) {
      const el = cardRefs.current[i];
      if (el) el.style.transform = "translate(-50%, -50%) scale(1)";
    }
  }, []);

  // Max co-occurrence count, for line-weight scaling. Floor at 1 so an
  // empty history (no pairs) doesn't divide by zero.
  const maxCount = pairs.reduce((m, p) => Math.max(m, p.count), 1);
  const tealSet = new Set(tealSelectedIds);
  const traceColor = "var(--trace-color, #5cead4)";
  // EK104 — teal-discovery: when 2+ cards are selected, a co-occurrence
  // line whose one end is selected and whose other end co-occurred with
  // the whole set (a candidate) renders in the trace color.
  const candidateSet = new Set(candidateIds ?? []);
  const showTeal = tealSelectedIds.length >= 2;
  // EK105 — hover preview: with 1+ cards selected, hovering a DIFFERENT
  // card lights the co-occurrence lines between it and the selection.
  const previewCardId =
    tealSelectedIds.length >= 1 &&
    hoveredCardId != null &&
    !tealSet.has(hoveredCardId)
      ? hoveredCardId
      : null;

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
          // EK103 — square at ANY rendered width. Previously height was
          // pinned to STAGE while width clamped via maxWidth, so on a
          // narrow column the stage went non-square: cards (raw px) ran
          // off the right edge and the SVG lines (which scale to fit)
          // shrank into a smaller circle that no longer reached them.
          aspectRatio: "1 / 1",
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
            const A = INSET_POS[p.a];
            const B = INSET_POS[p.b];
            if (!A || !B) return null;
            const t = p.count / maxCount;
            // EK104 — a line is a teal discovery hint when one end is in
            // the selection and the other co-occurred with the whole set.
            const isTealLine =
              showTeal &&
              ((tealSet.has(p.a) && candidateSet.has(p.b)) ||
                (tealSet.has(p.b) && candidateSet.has(p.a)));
            // EK105 — hover preview: a line between the hovered card and a
            // selected card lights up in the trace color while hovering.
            const isPreviewLine =
              previewCardId != null &&
              ((p.a === previewCardId && tealSet.has(p.b)) ||
                (p.b === previewCardId && tealSet.has(p.a)));
            const teal = isTealLine || isPreviewLine;
            return (
              <line
                key={`${p.a}-${p.b}`}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke={teal ? traceColor : "var(--accent)"}
                strokeWidth={teal ? Math.max(1.4, 0.5 + t * 1.6) : 0.5 + t * 1.6}
                opacity={teal ? 0.9 : 0.1 + t * 0.45}
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
              onMouseEnter={(e) => {
                setHoveredCardId(i);
                onCardHover?.(
                  i,
                  e.clientX,
                  e.clientY,
                  e.currentTarget.getBoundingClientRect(),
                );
              }}
              onMouseLeave={(e) => {
                setHoveredCardId((cur) => (cur === i ? null : cur));
                onCardHover?.(null, e.clientX, e.clientY);
              }}
              style={{
                position: "absolute",
                // EK103 — percentage of the stage (not raw px) so cards
                // scale in lockstep with the SVG line layer and with the
                // cursor→logical mapping the magnify uses. Keeps the
                // focused card directly under the cursor at every angle.
                left: `${(x / STAGE) * 100}%`,
                top: `${(y / STAGE) * 100}%`,
                width: CARD_W,
                // EK105 — transform is NOT set here; the magnify owns it
                // via direct DOM writes (see the useLayoutEffect above), so
                // hover-driven re-renders can't reset it.
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

        {/* EK104 — hero gold badge, anchored just OUTSIDE the ring at the
            hero card's angle so it's always legible (a 32px badge on a
            ~20px ring card would bury its neighbours). */}
        {heroCardId != null &&
          heroDrawCount != null &&
          (() => {
            const a = ((-90 + heroCardId * (360 / N)) * Math.PI) / 180;
            const bx = CX + (R + 30) * Math.cos(a);
            const by = CY + (R + 30) * Math.sin(a);
            return (
              <div
                role={onHeroBadgeClick ? "button" : undefined}
                onClick={
                  onHeroBadgeClick
                    ? (e) => {
                        e.stopPropagation();
                        onHeroBadgeClick();
                      }
                    : undefined
                }
                title={heroBadgeTooltip}
                style={{
                  position: "absolute",
                  left: `${(bx / STAGE) * 100}%`,
                  top: `${(by / STAGE) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 26,
                  height: 26,
                  borderRadius: 9999,
                  background:
                    "color-mix(in oklab, var(--gold, var(--accent)) 90%, var(--surface-card) 10%)",
                  border:
                    "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--background)",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: onHeroBadgeClick ? "pointer" : "default",
                  zIndex: 300,
                }}
              >
                {heroDrawCount}
              </div>
            );
          })()}

        {/* EK104 — teal asterism badge on the first-selected card, also
            anchored outside the ring. Sits a little further out if it
            lands on the same card as the hero badge. */}
        {tealBadge &&
          tealBadge.count > 0 &&
          (() => {
            const a = ((-90 + tealBadge.cardId * (360 / N)) * Math.PI) / 180;
            const extra = tealBadge.cardId === heroCardId ? 30 : 0;
            const bx = CX + (R + 30 + extra) * Math.cos(a);
            const by = CY + (R + 30 + extra) * Math.sin(a);
            return (
              <div
                role={onTealBadgeClick ? "button" : undefined}
                onClick={
                  onTealBadgeClick
                    ? (e) => {
                        e.stopPropagation();
                        onTealBadgeClick();
                      }
                    : undefined
                }
                title={tealBadge.tooltip}
                style={{
                  position: "absolute",
                  left: `${(bx / STAGE) * 100}%`,
                  top: `${(by / STAGE) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 26,
                  height: 26,
                  borderRadius: 9999,
                  background: traceColor,
                  border:
                    "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#04342c",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: onTealBadgeClick ? "pointer" : "default",
                  zIndex: 300,
                }}
              >
                {tealBadge.count}
              </div>
            );
          })()}

        {/* Marker naming the card at 12 o'clock. */}
        <div
          style={{
            position: "absolute",
            // EK103 — percentage like the cards so it tracks the ring.
            left: `${(CX / STAGE) * 100}%`,
            top: `${((CY - R - 24) / STAGE) * 100}%`,
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
