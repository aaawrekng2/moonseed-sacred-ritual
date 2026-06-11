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
import { TAROT_DECK } from "@/lib/tarot";

// EK107 — card display name for the builder-panel chips.
const CARD_NAME = (id: number): string => TAROT_DECK[id] ?? "Card";

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
const LINE_INSET = 16; // horizontal inset (sides) — unchanged
// EK107 — the line-ends ride a slightly squashed ellipse: sides come in
// LINE_INSET (16), top/bottom come in LINE_INSET_V (23) so they clear the
// taller card edges with the same visual gap as the sides. The CARDS do
// not move — only where the connecting lines terminate.
const LINE_INSET_V = 23;
const INSET_POS: Array<{ x: number; y: number }> = Array.from(
  { length: N },
  (_, i) => {
    const a = ((-90 + i * (360 / N)) * Math.PI) / 180;
    return {
      x: CX + (R - LINE_INSET) * Math.cos(a),
      y: CY + (R - LINE_INSET_V) * Math.sin(a),
    };
  },
);

// EK106 — suit arcs around the rim. Contiguous index ranges in the
// canonical deck, so each suit is one clean arc. Colours are a fixed
// elemental palette (fire / water / air / earth, gold for the Majors) —
// the one thing on this surface not drawn from theme tokens.
const SUIT_ARCS: Array<{
  key: string;
  label: string;
  from: number;
  to: number;
  color: string;
}> = [
  { key: "major", label: "Major Arcana", from: 0, to: 21, color: "#C6A24A" },
  { key: "wands", label: "Wands", from: 22, to: 35, color: "#C2552E" },
  { key: "cups", label: "Cups", from: 36, to: 49, color: "#3E6FA3" },
  { key: "swords", label: "Swords", from: 50, to: 63, color: "#9AA0B5" },
  { key: "pentacles", label: "Pentacles", from: 64, to: 77, color: "#4E7A4A" },
];

// EK107 — compact rank glyphs for the rank shelf (Ace … King).
const RANK_LABELS = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Pg", "Kn", "Qn", "Kg",
];
const RANK_FULL = [
  "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Page", "Knight", "Queen", "King",
];

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
  cardGroupColor,
  onRankChip,
  onSuitChip,
  onChipHover,
  customGroups,
  looseSingletons,
  canGroup,
  onGroup,
  onUngroup,
  onRemoveCard,
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
  /** EK107 — per-card ring color for custom-group membership (singletons
   *  fall through to teal). */
  cardGroupColor?: Record<number, string>;
  /** EK108 — bulk-select handlers: a rank/suit chip selects all its cards
   *  as loose singletons (toggles off if already all selected). */
  onRankChip?: (rank: number) => void;
  onSuitChip?: (suit: string) => void;
  /** EK108 — chip hover → calendar preview stroke (target card ids, or
   *  null on mouse-out). */
  onChipHover?: (ids: number[] | null) => void;
  /** EK107 — custom OR-groups + the loose singletons, for the builder
   *  panel, plus group/ungroup/remove handlers. */
  customGroups?: number[][];
  looseSingletons?: number[];
  canGroup?: boolean;
  onGroup?: () => void;
  onUngroup?: (groupIndex: number) => void;
  onRemoveCard?: (cardId: number) => void;
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
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          position: "relative",
          flex: "1 1 0",
          minWidth: 0,
          maxWidth: STAGE,
          // EK103 — square at ANY rendered width. Previously height was
          // pinned to STAGE while width clamped via maxWidth, so on a
          // narrow column the stage went non-square: cards (raw px) ran
          // off the right edge and the SVG lines (which scale to fit)
          // shrank into a smaller circle that no longer reached them.
          aspectRatio: "1 / 1",
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
                boxShadow: selected
                  ? `0 0 0 2px ${(cardGroupColor && cardGroupColor[i]) ?? traceColor}`
                  : "none",
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

      {/* EK108 — left controls: rank line, suit line, group builder. */}
      <div
        style={{
          flex: "0 0 300px",
          maxWidth: "46%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {(() => {
          const selSet = new Set(tealSelectedIds);
          const rankIds = (r: number): number[] => [
            22 + r,
            36 + r,
            50 + r,
            64 + r,
          ];
          const suitIds = (s: { from: number; to: number }): number[] =>
            Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i);
          const rankActive = (r: number) =>
            rankIds(r).every((id) => selSet.has(id));
          const suitActive = (s: { from: number; to: number }) =>
            suitIds(s).every((id) => selSet.has(id));
          const shelfLabel = (t: string) => (
            <div
              style={{
                fontSize: "var(--text-caption)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-foreground-muted)",
                fontFamily: "var(--font-sans)",
                marginBottom: 6,
              }}
            >
              {t}
            </div>
          );
          return (
            <>
              {/* Rank line — bulk-selects all four of that rank. */}
              <div>
                {shelfLabel("Ranks")}
                <div style={{ display: "flex", gap: 3 }}>
                  {RANK_LABELS.map((label, r) => {
                    const on = rankActive(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        title={`Select all four ${RANK_FULL[r]}s`}
                        onClick={() => onRankChip?.(r)}
                        onMouseEnter={() => onChipHover?.(rankIds(r))}
                        onMouseLeave={() => onChipHover?.(null)}
                        style={{
                          flex: "1 1 0",
                          minWidth: 0,
                          textAlign: "center",
                          padding: "4px 0",
                          borderRadius: "var(--radius-md, 6px)",
                          border: on
                            ? `1px solid ${traceColor}`
                            : "0.5px solid var(--border-default)",
                          background: on ? traceColor : "var(--surface-card)",
                          color: on
                            ? "var(--background)"
                            : "var(--color-foreground)",
                          fontFamily: "var(--font-display)",
                          fontStyle: "italic",
                          fontSize: "var(--text-body-sm)",
                          fontWeight: on ? 600 : 400,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Suit line — bulk-selects all cards of that suit. */}
              <div>
                {shelfLabel("Suits")}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {SUIT_ARCS.map((s) => {
                    const on = suitActive(s);
                    const label = s.key === "major" ? "Majors" : s.label;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        title={`Select all ${label}`}
                        onClick={() => onSuitChip?.(s.key)}
                        onMouseEnter={() => onChipHover?.(suitIds(s))}
                        onMouseLeave={() => onChipHover?.(null)}
                        style={{
                          padding: "4px 9px",
                          borderRadius: "var(--radius-md, 6px)",
                          border: on
                            ? `1px solid ${traceColor}`
                            : "0.5px solid var(--border-default)",
                          background: on ? traceColor : "var(--surface-card)",
                          color: on
                            ? "var(--background)"
                            : "var(--color-foreground)",
                          fontFamily: "var(--font-display)",
                          fontStyle: "italic",
                          fontSize: "var(--text-body-sm)",
                          fontWeight: on ? 600 : 400,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Group builder — the active asterism as removable chips,
                  with a "Group" action that folds the loose singletons into
                  one custom OR-group. */}
              {(() => {
                const singles = looseSingletons ?? [];
                const groups = customGroups ?? [];
                const empty = singles.length + groups.length === 0;
                const PALETTE = [
                  "#5cead4",
                  "#e0a3ff",
                  "#ffd27d",
                  "#86c5ff",
                  "#ff9eb5",
                ];
                const chip = (
                  key: string,
                  label: string,
                  onX: () => void,
                  color?: string,
                ) => (
                  <span
                    key={key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 8px",
                      borderRadius: "var(--radius-md, 7px)",
                      border: `1px solid ${color ?? "var(--border-default)"}`,
                      background: "var(--surface-card)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body-sm)",
                    }}
                  >
                    {label}
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={onX}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--color-foreground-muted)",
                        fontSize: 13,
                        lineHeight: 1,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
                return (
                  <div
                    style={{
                      border: "0.5px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md, 8px)",
                      background: "var(--surface-card)",
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--text-caption)",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--color-foreground-muted)",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        Asterism
                      </span>
                      <button
                        type="button"
                        disabled={!canGroup}
                        onClick={() => onGroup?.()}
                        style={{
                          padding: "3px 10px",
                          borderRadius: "var(--radius-md, 7px)",
                          border: "0.5px solid var(--border-default)",
                          background: "transparent",
                          color: canGroup
                            ? "var(--color-foreground)"
                            : "var(--color-foreground-muted)",
                          fontFamily: "var(--font-sans)",
                          fontSize: "var(--text-body-sm)",
                          cursor: canGroup ? "pointer" : "default",
                          opacity: canGroup ? 1 : 0.5,
                        }}
                      >
                        Group selected
                      </button>
                    </div>

                    {empty ? (
                      <span
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: "var(--text-body-sm)",
                          color: "var(--color-foreground-muted)",
                        }}
                      >
                        Tap cards on the clock, or a rank/suit chip, to select.
                        Then Group them into an &ldquo;any of these&rdquo; set.
                      </span>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        {singles.map((id) =>
                          chip(`s-${id}`, CARD_NAME(id), () =>
                            onRemoveCard?.(id),
                          ),
                        )}
                        {groups.map((g, gi) =>
                          chip(
                            `g-${gi}`,
                            "(" +
                              g.map((id) => CARD_NAME(id)).join(" / ") +
                              ")",
                            () => onUngroup?.(gi),
                            PALETTE[gi % PALETTE.length],
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          );
        })()}
      </div>
    </div>
  );
}
