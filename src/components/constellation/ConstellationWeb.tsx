/**
 * Phase 17 — SVG mandala of card co-occurrence around the hero card.
 *
 * Hero card sits centred at the top of the viewBox; up to 7 companion
 * cards arrange around it. Weighted lines connect every pair, with
 * stroke width + opacity proportional to lifetime co-pull count.
 */
import { useMemo } from "react";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import { useActiveDeckCornerRadius } from "@/lib/active-deck";
import type { CardConstellation } from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

// Phase 19 Fix 4 + Fix 6 — wider SVG (edge buffer for ring outline),
// shorter SVG so the whole page fits one viewport, smaller hero +
// companions to match.
// Phase 20 Fix 4/5 — enlarged after the inner header block was removed.
const AR_CEILING = 1.7;
const COMPANION_W = 60;
const COMPANION_H = Math.round(COMPANION_W * AR_CEILING); // ≈102
const HERO_W = 120;
const HERO_H = Math.round(HERO_W * AR_CEILING); // ≈204
// Phase 22 Fix 2 — HERO_Y dropped 60→24, SVG_H dropped 540→504,
// all companion Y values shifted up by 36 to remove dead top space.
// EF4 — drop HERO_Y from 24 → 4, SVG_H from 504 → 484 (additional
// 20px reduction). Pulls the constellation up so it sits just below
// the right column's chips at top of two-column grid.
// EJ11 — HERO_Y 4 → 0 to close the gap between filter chips and
// hero card. Combined with the viewBox top-buffer reduction below,
// pulls the constellation up by ~24px total.
const HERO_Y = 0;
export const SVG_W = 540;
export const SVG_H = 484;
const COMPANION_POSITIONS = [
  { x: 95, y: 94 }, // upper-left      (shifted up 20)
  { x: 385, y: 94 }, // upper-right     (shifted up 20)
  { x: 30, y: 224 }, // mid-far-left    (shifted up 20)
  { x: 450, y: 224 }, // mid-far-right   (shifted up 20)
  { x: 120, y: 344 }, // lower-left      (shifted up 20)
  { x: 360, y: 344 }, // lower-right     (shifted up 20)
  { x: 240, y: 364 }, // bottom-center   (shifted up 20)
];

type Props = {
  heroPick: ManualPick | null;
  constellation: CardConstellation | null;
  /** Phase 24 — clicking any card (hero or companion) toggles its membership
   * in the teal selection. */
  onCardClick: (cardId: number) => void;
  /** Phase 24 — set of card ids currently in the teal trace. */
  tealSelectedIds: number[];
  /** Phase 24 — cards in the constellation that, if added to the teal set,
   * would still match at least one day. Rendered with a teal connecting line
   * as a "click to extend" hint. */
  candidateIds?: number[];
  /** Phase 24 — number of times the hero card has been drawn within the
   * current filter window. Drives the gold count badge on the hero. */
  heroDrawCount?: number | null;
  /** DP — drag a constellation card to a slot. Caller wires drop targets. */
  onCardDragStart?: (cardId: number) => void;
  /** DY — hover lifecycle for the parent's tooltip overlay.
   *  Called with (cardId | null, clientX, clientY, targetRect?) — null on leave.
   *  EJ23 — targetRect added so parent can position popovers above the
   *  card rather than overlapping it. */
  onCardHover?: (
    cardId: number | null,
    clientX: number,
    clientY: number,
    targetRect?: DOMRect | null,
  ) => void;
  /** DZ — click the gold draw-count badge on the hero card.
   *  Parent opens the readings modal scoped to all hero readings. */
  onHeroBadgeClick?: () => void;
  /** EC — tooltip text for the gold hero badge. Format:
   *  "N PULLS · [Hero Card Name]". Parent provides because
   *  ConstellationWeb doesn't have access to card names. When omitted,
   *  falls back to a generic "View all N readings with this card". */
  heroBadgeTooltip?: string;
  /** DZ — match-count badge displayed on the FIRST-clicked teal card
   *  when 2+ teal cards are selected. Same visual language as the
   *  hero badge but teal-tinted. Null = hide.
   *  EC — `tooltip` is now passed through so the parent can format
   *  the unit-aware label ("N PULLS · Card A, Card B" or
   *  "N DAYS · Card A, Card B") since ConstellationWeb doesn't have
   *  access to card names or the same-pull/same-day pill state. */
  tealBadge?: {
    cardId: number;
    count: number;
    tooltip?: string;
  } | null;
  /** EJ25 — synchronous popover dismissal. Badges call this on
   *  mouseenter to immediately close the card-meaning popover, so the
   *  popover's hover-bridge doesn't block badge clicks. The standard
   *  onCardHover(null, ...) schedules a delayed dismiss that leaves a
   *  click-blocking window. */
  onPopoverDismissImmediate?: () => void;
  /** DZ — click the teal match-count badge. Parent opens the readings
   *  modal scoped to the current teal selection. */
  onTealBadgeClick?: () => void;
  /** EH — hover the gold hero badge. Parent renders a rich popover with
   *  a chained ⓘ legend explaining the constellation. */
  onHeroBadgeHover?: (clientX: number, clientY: number) => void;
  onHeroBadgeHoverEnd?: () => void;
  /** EH — hover the teal selection badge. */
  onTealBadgeHover?: (clientX: number, clientY: number) => void;
  onTealBadgeHoverEnd?: () => void;
  /** EJ9 — drop a card from the seeker's slot row onto a constellation
   * card. `targetCardId` is the card currently at the drop position
   * (hero or companion); `droppedCardId` is the card payload from
   * the slot drag. The parent decides whether to swap, replace,
   * or promote-to-hero. */
  onConstellationDrop?: (targetCardId: number, droppedCardId: number) => void;
  /** EJ9 — the cardId currently being dragged-over. Drives the subtle
   * drop-target highlight on the matching constellation card. Null
   * when no drag is over a target. */
  dragOverTargetId?: number | null;
  /** EJ9 — hover lifecycle for the drop target. Called with the
   * constellation cardId on `dragover`, null on `dragleave`. The
   * parent tracks this in state to drive the highlight. */
  onConstellationDragOver?: (cardId: number | null) => void;
};

type Box = { x: number; y: number; w: number; h: number };

/** Phase 24 — teal trace color used across constellation cards, calendar day
 * cells, and readings panel for the multi-card co-occurrence query. */
/**
 * EC — Default trace color for the teal selection / discovery hints.
 * Overridable per-theme via the `--trace-color` CSS variable, set in
 * applyCommunityTheme(). Themes whose accent is in the cyan/green
 * family override to a warm coral so the trace stays visible.
 *
 * Exported for callers that need the hex literal (e.g. passing as a
 * prop to non-DOM consumers). DOM consumers should prefer
 * var(--trace-color, #5cead4) directly in their style.
 */
export const TRACE_COLOR = "#5cead4";
const TRACE_VAR = "var(--trace-color, #5cead4)";

function getCardPosition(cardId: number, constellation: CardConstellation): Box {
  if (cardId === constellation.heroCardId) {
    return { x: (SVG_W - HERO_W) / 2, y: HERO_Y, w: HERO_W, h: HERO_H };
  }
  const idx = constellation.companions.findIndex((c) => c.cardId === cardId);
  if (idx === -1 || idx >= COMPANION_POSITIONS.length) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const pos = COMPANION_POSITIONS[idx];
  return { x: pos.x, y: pos.y, w: COMPANION_W, h: COMPANION_H };
}

function center(b: Box): { cx: number; cy: number } {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

export function ConstellationWeb({
  heroPick,
  constellation,
  onCardClick,
  tealSelectedIds,
  candidateIds = [],
  heroDrawCount = null,
  onCardDragStart = undefined,
  onCardHover = undefined,
  onHeroBadgeClick = undefined,
  heroBadgeTooltip = undefined,
  tealBadge = null,
  onTealBadgeClick = undefined,
  onHeroBadgeHover = undefined,
  onHeroBadgeHoverEnd = undefined,
  onTealBadgeHover = undefined,
  onTealBadgeHoverEnd = undefined,
  onPopoverDismissImmediate = undefined,
  onConstellationDrop = undefined,
  dragOverTargetId = null,
  onConstellationDragOver = undefined,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        width: "100%",
        maxWidth: SVG_W,
        minHeight: 0,
      }}
    >
      {/* Phase 20 Fix 3 — inner title block deleted; page H1 carries the name. */}
      {!heroPick || !constellation ? (
        <div
          style={{
            width: "100%",
            aspectRatio: `${SVG_W} / ${SVG_H}`,
            border: "1px dashed var(--border-default)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 13,
            opacity: 0.7,
            padding: 24,
            textAlign: "center",
          }}
        >
          add a card to begin
        </div>
      ) : (
        <ConstellationSvg
          constellation={constellation}
          onCardClick={onCardClick}
          tealSelectedIds={tealSelectedIds}
          candidateIds={candidateIds}
          heroPick={heroPick}
          heroDrawCount={heroDrawCount}
          onCardDragStart={onCardDragStart}
          onCardHover={onCardHover}
          onHeroBadgeClick={onHeroBadgeClick}
          heroBadgeTooltip={heroBadgeTooltip}
          tealBadge={tealBadge}
          onTealBadgeClick={onTealBadgeClick}
          onHeroBadgeHover={onHeroBadgeHover}
          onHeroBadgeHoverEnd={onHeroBadgeHoverEnd}
          onTealBadgeHover={onTealBadgeHover}
          onTealBadgeHoverEnd={onTealBadgeHoverEnd}
          onPopoverDismissImmediate={onPopoverDismissImmediate}
          onConstellationDrop={onConstellationDrop}
          dragOverTargetId={dragOverTargetId}
          onConstellationDragOver={onConstellationDragOver}
        />
      )}
    </div>
  );
}

function ConstellationSvg({
  constellation,
  onCardClick,
  tealSelectedIds,
  candidateIds,
  heroPick,
  heroDrawCount,
  onCardDragStart,
  onCardHover,
  onHeroBadgeClick,
  heroBadgeTooltip,
  tealBadge,
  onTealBadgeClick,
  onHeroBadgeHover,
  onHeroBadgeHoverEnd,
  onTealBadgeHover,
  onTealBadgeHoverEnd,
  onPopoverDismissImmediate,
  onConstellationDrop,
  dragOverTargetId,
  onConstellationDragOver,
}: {
  constellation: CardConstellation;
  onCardClick: (cardId: number) => void;
  tealSelectedIds: number[];
  candidateIds: number[];
  heroPick: ManualPick;
  heroDrawCount: number | null;
  onCardDragStart?: (cardId: number) => void;
  onCardHover?: (
    cardId: number | null,
    clientX: number,
    clientY: number,
    targetRect?: DOMRect | null,
  ) => void;
  onHeroBadgeClick?: () => void;
  heroBadgeTooltip?: string;
  tealBadge?: {
    cardId: number;
    count: number;
    tooltip?: string;
  } | null;
  onTealBadgeClick?: () => void;
  onHeroBadgeHover?: (clientX: number, clientY: number) => void;
  onHeroBadgeHoverEnd?: () => void;
  onTealBadgeHover?: (clientX: number, clientY: number) => void;
  onTealBadgeHoverEnd?: () => void;
  /** EJ25 — synchronous popover dismissal on badge hover. */
  onPopoverDismissImmediate?: () => void;
  onConstellationDrop?: (targetCardId: number, droppedCardId: number) => void;
  dragOverTargetId?: number | null;
  onConstellationDragOver?: (cardId: number | null) => void;
}) {
  const maxPair = constellation.pairCounts.reduce((m, p) => (p.count > m ? p.count : m), 0);
  const tealSet = new Set(tealSelectedIds);
  const candidateSet = new Set(candidateIds);
  // EJ27 — read the active deck's seeker-chosen corner radius (stored
  // as a 0-15% value via the deck-import slider). Used to size the
  // selection highlight's borderRadius so its outer silhouette matches
  // the image's baked-in rounded corners. EJ28 — fallback is now 0
  // (sharp) when the deck has no override saved: default decks (Rider-
  // Waite shipped with the app) and any deck imported without the
  // slider have rectangular sharp-cornered images, and a 4% assumed
  // radius was giving the highlight a rounded silhouette that poked
  // past the sharp image corners visually.
  const deckRadiusPct = useActiveDeckCornerRadius() ?? 0;

  // EE2 — teal-line dedupe. Baseline (pink/accent) co-occurrence lines
  // are unchanged: every pair, full mesh, as before.
  //
  // What IS deduped is the teal discovery-hint lines that appear when
  // 2+ cards are in the teal selection. Each candidate card should
  // receive at most ONE teal line. Priority for which teal source wins:
  //   1. Hero, if hero is in the teal selection AND co-occurs with the
  //      candidate.
  //   2. Otherwise, the teal-selected source with the highest
  //      co-occurrence count for that candidate.
  //   3. Tie-break: lowest source card id (deterministic).
  //
  // Pairs that WOULD have rendered as teal but lose this contest fall
  // back to baseline (pink/accent) rendering automatically — they just
  // don't get added to `allowedTealPairs`.
  const allowedTealPairs = useMemo(() => {
    const allowed = new Set<number>();
    if (tealSet.size < 2) return allowed;

    const heroId = constellation.heroCardId;
    // For each candidate, find the best teal source per the priority
    // rules above. Then mark the (source, candidate) pair as the allowed
    // teal line.
    const bestTealForCandidate = new Map<number, { src: number; idx: number; count: number }>();

    constellation.pairCounts.forEach((pair, originalIndex) => {
      const aIsTeal = tealSet.has(pair.a);
      const bIsTeal = tealSet.has(pair.b);
      const aIsCandidate = candidateSet.has(pair.a);
      const bIsCandidate = candidateSet.has(pair.b);
      // Identify (source, candidate) for this pair, if it's a teal line.
      let src: number | null = null;
      let cand: number | null = null;
      if (aIsTeal && bIsCandidate) {
        src = pair.a;
        cand = pair.b;
      } else if (bIsTeal && aIsCandidate) {
        src = pair.b;
        cand = pair.a;
      }
      if (src === null || cand === null) return;

      const existing = bestTealForCandidate.get(cand);
      const srcIsHero = src === heroId;
      const existingSrcIsHero = existing ? existing.src === heroId : false;

      // Priority rules:
      //   hero beats non-hero unconditionally
      //   otherwise: higher count wins
      //   tie on count: lower src id wins
      const wins = (() => {
        if (!existing) return true;
        if (srcIsHero && !existingSrcIsHero) return true;
        if (!srcIsHero && existingSrcIsHero) return false;
        if (pair.count !== existing.count) return pair.count > existing.count;
        return src < existing.src;
      })();

      if (wins) {
        bestTealForCandidate.set(cand, { src, idx: originalIndex, count: pair.count });
      }
    });

    for (const entry of bestTealForCandidate.values()) {
      allowed.add(entry.idx);
    }
    return allowed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    constellation.heroCardId,
    constellation.pairCounts,
    // Stringify Sets to give useMemo a stable dep value.
    [...tealSet].sort().join(","),
    [...candidateSet].sort().join(","),
  ]);

  return (
    <svg
      // EJ5 — viewBox extended 32px above 0 (was 20) to ensure the
      // asterism badge (32px tall, anchored at pos.y - 16 = -12 in
      // SVG coords) renders fully. Also style.overflow: visible so the
      // SVG element box does not clip negative-y children even if a
      // parent container would otherwise. Width unchanged.
      // EJ11 — top buffer tightened from -32 to -12. The asterism
      // badge anchors at -10 relative to the card image, which only
      // needs ~12px of viewBox headroom (not 32). The extra 20 units
      // were dead space pushing the whole constellation down. With
      // overflow:visible the SVG element box still doesn't clip
      // negative-y children even if rare overshoot occurs.
      viewBox={`0 -12 ${SVG_W} ${SVG_H + 12}`}
      width="100%"
      style={{ display: "block", overflow: "visible" }}
      role="img"
      aria-label="constellation web of cards that have appeared together"
    >
      {/* Lines first */}
      {constellation.pairCounts.map((pair, i) => {
        const a = getCardPosition(pair.a, constellation);
        const b = getCardPosition(pair.b, constellation);
        if (a.w === 0 || b.w === 0) return null;
        const ca = center(a);
        const cb = center(b);
        const weight = maxPair > 0 ? pair.count / maxPair : 0;
        const aIsTeal = tealSet.has(pair.a);
        const bIsTeal = tealSet.has(pair.b);
        const aIsCandidate = candidateSet.has(pair.a);
        const bIsCandidate = candidateSet.has(pair.b);
        // Phase 24 — paint teal only when connecting a teal card to a
        // candidate (the "click me, my trace has data" hint). Lines between
        // two already-selected teal cards stay at their normal accent weight
        // so the trace doesn't get visually crowded; lines disappear entirely
        // when there are no candidates left to suggest.
        // EE2 — additionally require membership in allowedTealPairs so
        // each candidate receives at most ONE teal line (hero priority,
        // then highest co-occurrence, then lowest source id). Pairs that
        // would otherwise have been teal but lost the dedupe contest
        // fall back to baseline rendering automatically.
        const isTealLine =
          ((aIsTeal && bIsCandidate) || (bIsTeal && aIsCandidate)) && allowedTealPairs.has(i);
        const strokeWidth = isTealLine ? 2.5 : Math.max(1, Math.min(5, weight * 5));
        const opacity = isTealLine ? 0.95 : 0.2 + weight * 0.7;
        const stroke = isTealLine ? TRACE_VAR : "var(--accent, var(--gold))";
        return (
          <line
            key={`${pair.a}-${pair.b}-${i}`}
            x1={ca.cx}
            y1={ca.cy}
            x2={cb.cx}
            y2={cb.cy}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
            style={{ cursor: "help" }}
          >
            <title>{`${getCardName(pair.a)} + ${getCardName(pair.b)} — co-occurred in ${pair.count} ${pair.count === 1 ? "spread" : "spreads"} (matching your filters)`}</title>
          </line>
        );
      })}

      {/* Hero card — clickable; participates in teal selection when clicked. */}
      {(() => {
        const pos = getCardPosition(constellation.heroCardId, constellation);
        const heroInTeal = tealSet.has(constellation.heroCardId);
        return (
          <g>
            <foreignObject
              x={pos.x}
              y={pos.y}
              width={pos.w}
              height={pos.h}
              style={{ overflow: "visible" }}
            >
              <button
                type="button"
                onClick={() => onCardClick(constellation.heroCardId)}
                draggable={!!onCardDragStart}
                onDragStart={(e) => {
                  if (!onCardDragStart) return;
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(
                    "application/x-tarotseed-cardid",
                    String(constellation.heroCardId),
                  );
                  onCardDragStart(constellation.heroCardId);
                }}
                onDragOver={(e) => {
                  // EJ9 — accept drops from slot row. Only react when a
                  // card payload is on the wire (parent passes onConstellationDrop).
                  if (!onConstellationDrop) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  onConstellationDragOver?.(constellation.heroCardId);
                }}
                onDragLeave={() => {
                  if (!onConstellationDrop) return;
                  onConstellationDragOver?.(null);
                }}
                onDrop={(e) => {
                  if (!onConstellationDrop) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const raw = e.dataTransfer.getData("application/x-tarotseed-cardid");
                  const id = raw ? Number(raw) : null;
                  onConstellationDragOver?.(null);
                  if (id !== null && Number.isFinite(id)) {
                    onConstellationDrop(constellation.heroCardId, id);
                  }
                }}
                onMouseEnter={(e) =>
                  onCardHover?.(
                    constellation.heroCardId,
                    e.clientX,
                    e.clientY,
                    e.currentTarget.getBoundingClientRect(),
                  )
                }
                onMouseMove={(e) =>
                  onCardHover?.(
                    constellation.heroCardId,
                    e.clientX,
                    e.clientY,
                    e.currentTarget.getBoundingClientRect(),
                  )
                }
                onMouseLeave={(e) => onCardHover?.(null, e.clientX, e.clientY)}
                style={{
                  width: pos.w,
                  height: pos.h,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                }}
              >
                {/* EJ5 — inner wrapper carries the accent ring (and the
                    teal outline when this card is in the asterism). The
                    button stays slot-sized (pos.h) so the gold hero badge
                    and asterism badge anchor predictably to the slot
                    corners. The ring hugs the actual rendered card image
                    via this auto-height wrapper. */}
                <span
                  style={{
                    // EJ29 — kill the inline-block descender gap. When
                    // an inline-block contains another inline-block, the
                    // browser reserves invisible line-box descender
                    // space below the inner element (room for letters
                    // like g, y, p — even when there are none). That
                    // space made this wrapper measurably taller than
                    // the image inside it, so the absolute-positioned
                    // teal highlight (top:-2, bottom:-2) extended visibly
                    // past the image's bottom. vertical-align: top on
                    // the inline-block child + font-size: 0 on this
                    // parent both eliminate the descender reservation.
                    display: "inline-block",
                    width: pos.w,
                    position: "relative",
                    verticalAlign: "top",
                    fontSize: 0,
                    lineHeight: 0,
                  }}
                >
                  {/* EJ7 — solid backdrop sized to the actual rendered
                    image, extending 2px on every side, plus a 4px outer
                    glow. Only shown when this card is in the asterism.
                    Rendered as an absolute span BEHIND the image-clip
                    span; both share width=pos.w and the image-clip span
                    is what drives the height (via the natural-aspect
                    CardImage inside it), so the backdrop hugs the
                    actual rendered card no matter what aspect the deck
                    uses. */}
                  {heroInTeal && (
                    <span
                      aria-hidden
                      style={{
                        // EJ27 — solid trace fill, 2px outset, NO box-shadow
                        // glow (the glow was extending visibly past the
                        // card's bottom and corners). borderRadius derives
                        // from the seeker's chosen deck corner radius so
                        // the highlight silhouette matches the image's
                        // baked-in rounded shape, plus 2px for the outset.
                        // EJ28 — breathing animation class dropped per
                        // user feedback ("too in your face"). Static glow,
                        // visible but quiet.
                        position: "absolute",
                        top: -2,
                        left: -2,
                        right: -2,
                        bottom: -2,
                        borderRadius: Math.round((deckRadiusPct / 100) * pos.w) + 2,
                        background: TRACE_VAR,
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {/* EJ9 — drop-target highlight: subtle accent ring +
                    glow when a slot card is being dragged over this
                    card. Sits above the teal backdrop so the seeker
                    sees the cue regardless of teal state. */}
                  {dragOverTargetId === constellation.heroCardId && (
                    <span
                      aria-hidden
                      style={{
                        // EJ27 — matched solid accent fill, no glow.
                        position: "absolute",
                        top: -2,
                        left: -2,
                        right: -2,
                        bottom: -2,
                        borderRadius: Math.round((deckRadiusPct / 100) * pos.w) + 2,
                        background:
                          "color-mix(in oklab, var(--accent, var(--gold)) 75%, transparent)",
                        zIndex: 2,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  <span
                    style={{
                      // EJ27 — no borderRadius / overflow:hidden. The
                      // image is pre-processed at deck-import time with
                      // a baked rounded alpha mask (FD/FE pipeline) so
                      // its transparent corners ARE the card silhouette.
                      // Adding a CSS clip on top forced a second
                      // different rounded rectangle to interact with
                      // the baked shape, creating visible corner wedges
                      // when the two radii didn't match.
                      // EJ29 — vertical-align: top eliminates the
                      // inline-block descender gap below this element
                      // in the parent's line-box.
                      display: "inline-block",
                      width: pos.w,
                      position: "relative",
                      zIndex: 1,
                      verticalAlign: "top",
                    }}
                  >
                    <CardImage
                      variant="face"
                      cardId={constellation.heroCardId}
                      reversed={heroPick.isReversed}
                      deckId={heroPick.deckId ?? undefined}
                      size="custom"
                      widthPx={pos.w}
                      eager
                    />
                  </span>
                  {/* EJ7 — hero gold badge nested INSIDE the inner span
                    so it anchors to the actual image bottom-right (the
                    span hugs the image). Previously the badge lived in
                    a sibling foreignObject anchored to the SLOT
                    bottom-right; when the deck's aspect was shorter
                    than 1.7 the badge floated below the image and
                    clicks missed. Rendered as a div with role=button
                    because nesting <button> inside <button> is invalid
                    HTML. stopPropagation prevents the slot click from
                    firing. */}
                  {heroDrawCount !== null && heroDrawCount !== undefined && (
                    <div
                      role={onHeroBadgeClick ? "button" : undefined}
                      tabIndex={onHeroBadgeClick ? 0 : undefined}
                      onClick={
                        onHeroBadgeClick
                          ? (e) => {
                              e.stopPropagation();
                              onHeroBadgeClick();
                            }
                          : undefined
                      }
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        // EJ25 — SYNCHRONOUS popover dismissal. The
                        // scheduled-dismiss pattern from EJ23 left a
                        // window where the popover's hover-bridge still
                        // intercepted clicks. onPopoverDismissImmediate
                        // closes the popover NOW so the badge's click
                        // event registers cleanly.
                        onPopoverDismissImmediate?.();
                        onHeroBadgeHover?.(e.clientX, e.clientY);
                      }}
                      onMouseLeave={(e) => {
                        e.stopPropagation();
                        onHeroBadgeHoverEnd?.();
                      }}
                      aria-label={
                        onHeroBadgeClick
                          ? (heroBadgeTooltip ?? `View all ${heroDrawCount} spreads with this card`)
                          : undefined
                      }
                      title={
                        onHeroBadgeHover
                          ? undefined
                          : onHeroBadgeClick
                            ? (heroBadgeTooltip ??
                              `View all ${heroDrawCount} spreads with this card`)
                            : undefined
                      }
                      style={{
                        position: "absolute",
                        bottom: -10,
                        right: -10,
                        width: 32,
                        height: 32,
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
                        fontSize: 13,
                        lineHeight: 1,
                        cursor: onHeroBadgeClick ? "pointer" : "default",
                        padding: 0,
                        // EJ23 — beat the card popover's portal z-index
                        // so a click on the badge is never intercepted
                        // by an overlapping popover. Popover lives at
                        // --z-toast which is 300+ via tokens; the badge
                        // sits at 1000 here to be unambiguously above.
                        zIndex: 1000,
                      }}
                    >
                      {heroDrawCount}
                    </div>
                  )}
                  {/* EJ7 — asterism (teal) badge: same treatment, anchored
                    to image TOP-right. */}
                  {tealBadge &&
                    tealBadge.cardId === constellation.heroCardId &&
                    tealBadge.count > 0 && (
                      <div
                        role={onTealBadgeClick ? "button" : undefined}
                        tabIndex={onTealBadgeClick ? 0 : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTealBadgeClick?.();
                        }}
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          // EJ25 — SYNCHRONOUS dismissal (see hero badge).
                          onPopoverDismissImmediate?.();
                          onTealBadgeHover?.(e.clientX, e.clientY);
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation();
                          onTealBadgeHoverEnd?.();
                        }}
                        aria-label={
                          tealBadge.tooltip ?? `View ${tealBadge.count} spreads with selected cards`
                        }
                        title={
                          onTealBadgeHover
                            ? undefined
                            : (tealBadge.tooltip ??
                              `View ${tealBadge.count} spreads with selected cards`)
                        }
                        style={{
                          position: "absolute",
                          top: -10,
                          right: -10,
                          width: 32,
                          height: 32,
                          borderRadius: 9999,
                          background: TRACE_VAR,
                          border:
                            "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--background)",
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: 13,
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: 0,
                          // EJ23 — beat the popover's portal z-index so
                          // a click on the teal badge is never blocked.
                          zIndex: 1000,
                        }}
                      >
                        {tealBadge.count}
                      </div>
                    )}
                </span>
              </button>
            </foreignObject>
            {/* EJ2 — hero teal outline moved to CSS boxShadow on the
                button so it hugs the actual card image (different
                decks have different aspect ratios; an SVG rect at
                pos.w × pos.h surrounds empty letterbox space). */}
            {/* EJ7 — hero gold + teal badges moved into the inner span
                (see above) so they anchor to the actual rendered card
                image, not the SVG slot box. The previous sibling-
                foreignObject badges below were unreachable on decks
                whose aspect was shorter than the slot's 1.7 ceiling
                because they floated in the empty space below the
                image. */}
          </g>
        );
      })()}

      {/* Companion cards */}
      {constellation.companions.map((c) => {
        const pos = getCardPosition(c.cardId, constellation);
        if (pos.w === 0) return null;
        const inTeal = tealSet.has(c.cardId);
        return (
          <g key={c.cardId}>
            <foreignObject
              x={pos.x}
              y={pos.y}
              width={pos.w}
              height={pos.h}
              style={{ overflow: "visible" }}
            >
              <button
                type="button"
                onClick={() => onCardClick(c.cardId)}
                draggable={!!onCardDragStart}
                onDragStart={(e) => {
                  if (!onCardDragStart) return;
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("application/x-tarotseed-cardid", String(c.cardId));
                  onCardDragStart(c.cardId);
                }}
                onDragOver={(e) => {
                  // EJ9 — accept drops from slot row.
                  if (!onConstellationDrop) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  onConstellationDragOver?.(c.cardId);
                }}
                onDragLeave={() => {
                  if (!onConstellationDrop) return;
                  onConstellationDragOver?.(null);
                }}
                onDrop={(e) => {
                  if (!onConstellationDrop) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const raw = e.dataTransfer.getData("application/x-tarotseed-cardid");
                  const id = raw ? Number(raw) : null;
                  onConstellationDragOver?.(null);
                  if (id !== null && Number.isFinite(id)) {
                    onConstellationDrop(c.cardId, id);
                  }
                }}
                onMouseEnter={(e) =>
                  onCardHover?.(
                    c.cardId,
                    e.clientX,
                    e.clientY,
                    e.currentTarget.getBoundingClientRect(),
                  )
                }
                onMouseMove={(e) =>
                  onCardHover?.(
                    c.cardId,
                    e.clientX,
                    e.clientY,
                    e.currentTarget.getBoundingClientRect(),
                  )
                }
                onMouseLeave={(e) => onCardHover?.(null, e.clientX, e.clientY)}
                style={{
                  width: pos.w,
                  height: pos.h,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                }}
              >
                {/* EJ7 — solid backdrop sized to the actual rendered
                    image, extending 2px on every side, plus a 4px outer
                    glow. Only shown when this companion is in the
                    asterism. */}
                <span
                  style={{
                    // EJ29 — see hero comment. font-size/line-height: 0
                    // on parent + vertical-align: top on inline-block
                    // child kills the descender gap.
                    display: "inline-block",
                    width: pos.w,
                    position: "relative",
                    verticalAlign: "top",
                    fontSize: 0,
                    lineHeight: 0,
                  }}
                >
                  {inTeal && (
                    <span
                      aria-hidden
                      style={{
                        // EJ27 — matched hero treatment. Solid trace fill,
                        // 2px outset, deck-derived radius, no glow.
                        // EJ28 — breathing class dropped (too in-your-face).
                        position: "absolute",
                        top: -2,
                        left: -2,
                        right: -2,
                        bottom: -2,
                        borderRadius: Math.round((deckRadiusPct / 100) * pos.w) + 2,
                        background: TRACE_VAR,
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {/* EJ9 — drop-target highlight on companion cards. */}
                  {dragOverTargetId === c.cardId && (
                    <span
                      aria-hidden
                      style={{
                        // EJ27 — matched solid accent fill, no glow.
                        position: "absolute",
                        top: -2,
                        left: -2,
                        right: -2,
                        bottom: -2,
                        borderRadius: Math.round((deckRadiusPct / 100) * pos.w) + 2,
                        background:
                          "color-mix(in oklab, var(--accent, var(--gold)) 75%, transparent)",
                        zIndex: 2,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  <span
                    style={{
                      // EJ27 — no borderRadius / overflow:hidden. Image
                      // carries its own baked rounding via alpha channel.
                      // EJ29 — vertical-align: top removes baseline space.
                      display: "inline-block",
                      width: pos.w,
                      position: "relative",
                      zIndex: 1,
                      verticalAlign: "top",
                    }}
                  >
                    <CardImage
                      variant="face"
                      cardId={c.cardId}
                      size="custom"
                      widthPx={pos.w}
                      /* EC — see hero card comment above. Same fix applies
                     to all companion cards. */
                      eager
                    />
                  </span>
                  {/* EJ7 — companion asterism badge nested inside the
                    button so it anchors to the actual rendered card
                    image top-right (same fix as the hero badges). */}
                  {tealBadge && tealBadge.cardId === c.cardId && tealBadge.count > 0 && (
                    <div
                      role={onTealBadgeClick ? "button" : undefined}
                      tabIndex={onTealBadgeClick ? 0 : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTealBadgeClick?.();
                      }}
                      onMouseEnter={
                        onTealBadgeHover
                          ? (e) => {
                              e.stopPropagation();
                              onTealBadgeHover(e.clientX, e.clientY);
                            }
                          : undefined
                      }
                      onMouseLeave={(e) => {
                        e.stopPropagation();
                        onTealBadgeHoverEnd?.();
                      }}
                      aria-label={
                        tealBadge.tooltip ?? `View ${tealBadge.count} spreads with selected cards`
                      }
                      title={
                        onTealBadgeHover
                          ? undefined
                          : (tealBadge.tooltip ??
                            `View ${tealBadge.count} spreads with selected cards`)
                      }
                      style={{
                        position: "absolute",
                        top: -8,
                        right: -8,
                        width: 28,
                        height: 28,
                        borderRadius: 9999,
                        background: TRACE_VAR,
                        border:
                          "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--background)",
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 11,
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                        zIndex: 2,
                      }}
                    >
                      {tealBadge.count}
                    </div>
                  )}
                </span>
              </button>
            </foreignObject>
            {/* EJ2 — companion teal outline moved to CSS boxShadow on
                the button (same reason as hero). */}
            {/* EJ11 — ×N coCount labels below companion cards removed
                per spec. The same count is still accessible via the
                line tooltip ("co-occurred in N spreads") and the
                companion's hover popover, so the label was redundant
                visual weight under each card. */}
            {/* EJ7 — companion asterism badge moved inside the button
                so it anchors to the actual rendered card image (see
                above). The previous sibling-foreignObject version is
                gone. */}
          </g>
        );
      })}
    </svg>
  );
}
