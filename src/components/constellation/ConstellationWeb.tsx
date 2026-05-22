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
const HERO_Y = 4;
export const SVG_W = 540;
export const SVG_H = 484;
const COMPANION_POSITIONS = [
  { x: 95,  y: 94 },   // upper-left      (shifted up 20)
  { x: 385, y: 94 },   // upper-right     (shifted up 20)
  { x: 30,  y: 224 },  // mid-far-left    (shifted up 20)
  { x: 450, y: 224 },  // mid-far-right   (shifted up 20)
  { x: 120, y: 344 },  // lower-left      (shifted up 20)
  { x: 360, y: 344 },  // lower-right     (shifted up 20)
  { x: 240, y: 364 },  // bottom-center   (shifted up 20)
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
   *  Called with (cardId | null, clientX, clientY) — null on leave. */
  onCardHover?: (
    cardId: number | null,
    clientX: number,
    clientY: number,
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

function getCardPosition(
  cardId: number,
  constellation: CardConstellation,
): Box {
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
}) {
  const maxPair = constellation.pairCounts.reduce(
    (m, p) => (p.count > m ? p.count : m),
    0,
  );
  const tealSet = new Set(tealSelectedIds);
  const candidateSet = new Set(candidateIds);

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
      viewBox={`0 -32 ${SVG_W} ${SVG_H + 32}`}
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
          ((aIsTeal && bIsCandidate) || (bIsTeal && aIsCandidate)) &&
          allowedTealPairs.has(i);
        const strokeWidth = isTealLine
          ? 2.5
          : Math.max(1, Math.min(5, weight * 5));
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
            <title>{`${getCardName(pair.a)} + ${getCardName(pair.b)} — drawn together ${pair.count} ${pair.count === 1 ? "time" : "times"}`}</title>
          </line>
        );
      })}

      {/* Hero card — clickable; participates in teal selection when clicked. */}
      {(() => {
        const pos = getCardPosition(
          constellation.heroCardId,
          constellation,
        );
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
                onMouseEnter={(e) =>
                  onCardHover?.(
                    constellation.heroCardId,
                    e.clientX,
                    e.clientY,
                  )
                }
                onMouseMove={(e) =>
                  onCardHover?.(
                    constellation.heroCardId,
                    e.clientX,
                    e.clientY,
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
                    display: "inline-block",
                    width: pos.w,
                    position: "relative",
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
                      position: "absolute",
                      top: -2,
                      left: -2,
                      width: pos.w + 4,
                      height: "calc(100% + 4px)",
                      borderRadius: 8,
                      background: TRACE_VAR,
                      boxShadow: `0 0 4px 4px ${TRACE_VAR}`,
                      zIndex: 0,
                      pointerEvents: "none",
                    }}
                  />
                )}
                <span
                  style={{
                    display: "inline-block",
                    width: pos.w,
                    borderRadius: 6,
                    overflow: "hidden",
                    position: "relative",
                    zIndex: 1,
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
                    onMouseEnter={
                      onHeroBadgeHover
                        ? (e) => {
                            e.stopPropagation();
                            onHeroBadgeHover(e.clientX, e.clientY);
                          }
                        : undefined
                    }
                    onMouseLeave={(e) => {
                      e.stopPropagation();
                      onHeroBadgeHoverEnd?.();
                    }}
                    aria-label={
                      onHeroBadgeClick
                        ? (heroBadgeTooltip ??
                          `View all ${heroDrawCount} spreads with this card`)
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
                      zIndex: 2,
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
                        tealBadge.tooltip ??
                        `View ${tealBadge.count} spreads with selected cards`
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
                        zIndex: 2,
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
                  e.dataTransfer.setData(
                    "application/x-tarotseed-cardid",
                    String(c.cardId),
                  );
                  onCardDragStart(c.cardId);
                }}
                onMouseEnter={(e) =>
                  onCardHover?.(c.cardId, e.clientX, e.clientY)
                }
                onMouseMove={(e) =>
                  onCardHover?.(c.cardId, e.clientX, e.clientY)
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
                    display: "inline-block",
                    width: pos.w,
                    position: "relative",
                  }}
                >
                {inTeal && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: -2,
                      left: -2,
                      width: pos.w + 4,
                      height: "calc(100% + 4px)",
                      borderRadius: 6,
                      background: TRACE_VAR,
                      boxShadow: `0 0 4px 4px ${TRACE_VAR}`,
                      zIndex: 0,
                      pointerEvents: "none",
                    }}
                  />
                )}
                <span
                  style={{
                    display: "inline-block",
                    width: pos.w,
                    borderRadius: 4,
                    overflow: "hidden",
                    position: "relative",
                    zIndex: 1,
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
                {tealBadge &&
                  tealBadge.cardId === c.cardId &&
                  tealBadge.count > 0 && (
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
                        tealBadge.tooltip ??
                        `View ${tealBadge.count} spreads with selected cards`
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
            <text
              x={pos.x + pos.w / 2}
              y={pos.y + pos.h + 14}
              textAnchor="middle"
              fontSize={11}
              fontFamily="var(--font-serif)"
              fontStyle="italic"
              fill="var(--color-foreground-muted, var(--color-foreground))"
            >
              ×{c.coCount}
            </text>
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