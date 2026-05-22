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
const HERO_Y = 24;
export const SVG_W = 540;
export const SVG_H = 504;
const COMPANION_POSITIONS = [
  { x: 95,  y: 114 },  // upper-left
  { x: 385, y: 114 },  // upper-right
  { x: 30,  y: 244 },  // mid-far-left
  { x: 450, y: 244 },  // mid-far-right
  { x: 120, y: 364 },  // lower-left
  { x: 360, y: 364 },  // lower-right
  { x: 240, y: 384 },  // bottom-center
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
  tealBadge?: { cardId: number; count: number; tooltip?: string } | null;
  onTealBadgeClick?: () => void;
}) {
  const maxPair = constellation.pairCounts.reduce(
    (m, p) => (p.count > m ? p.count : m),
    0,
  );
  const tealSet = new Set(tealSelectedIds);
  const candidateSet = new Set(candidateIds);

  // EE — pink-line dedupe. The seeker asked for a cleaner web: each
  // non-teal card should receive at most ONE baseline (pink) line. Hero
  // ALWAYS wins — if a companion co-occurs with the hero, its single
  // pink slot is the hero connection. For companions that somehow have
  // no hero connection (rare; can happen with stale data), the slot
  // falls to the pair with the highest co-occurrence count.
  //
  // Teal/discovery (cyan) lines are NOT subject to this cap — they're
  // a separate visual layer. Pink lines between two teal-selected
  // cards also aren't capped, since teal cards aren't "non-teal."
  //
  // Algorithm:
  //   1. Sort pairs: hero-containing pairs first (descending count),
  //      then non-hero pairs (descending count).
  //   2. Walk in order. For each pair, draw the line IF neither
  //      non-teal endpoint already has a pink line. Otherwise skip.
  //   3. Cyan lines bypass the cap entirely.
  const allowedPairIndices = useMemo(() => {
    const heroId = constellation.heroCardId;
    const ordered = constellation.pairCounts
      .map((pair, originalIndex) => ({ pair, originalIndex }))
      .sort((p1, p2) => {
        const p1HasHero = p1.pair.a === heroId || p1.pair.b === heroId;
        const p2HasHero = p2.pair.a === heroId || p2.pair.b === heroId;
        if (p1HasHero !== p2HasHero) return p1HasHero ? -1 : 1;
        return p2.pair.count - p1.pair.count;
      });

    const baselineLineCount = new Map<number, number>();
    const allowed = new Set<number>();

    for (const { pair, originalIndex } of ordered) {
      const aIsTeal = tealSet.has(pair.a);
      const bIsTeal = tealSet.has(pair.b);
      const aIsCandidate = candidateSet.has(pair.a);
      const bIsCandidate = candidateSet.has(pair.b);
      const isTealLine =
        (aIsTeal && bIsCandidate) || (bIsTeal && aIsCandidate);
      if (isTealLine) {
        // Cyan discovery line — always allowed, never counted.
        allowed.add(originalIndex);
        continue;
      }
      // Baseline pink line. Enforce the one-pink-per-non-teal-card cap.
      const aCapBlocks =
        !aIsTeal && (baselineLineCount.get(pair.a) ?? 0) >= 1;
      const bCapBlocks =
        !bIsTeal && (baselineLineCount.get(pair.b) ?? 0) >= 1;
      if (aCapBlocks || bCapBlocks) continue;
      allowed.add(originalIndex);
      if (!aIsTeal)
        baselineLineCount.set(pair.a, (baselineLineCount.get(pair.a) ?? 0) + 1);
      if (!bIsTeal)
        baselineLineCount.set(pair.b, (baselineLineCount.get(pair.b) ?? 0) + 1);
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
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width="100%"
      style={{ display: "block" }}
      role="img"
      aria-label="constellation web of cards that have appeared together"
    >
      {/* Lines first */}
      {constellation.pairCounts.map((pair, i) => {
        // EE — skip pairs filtered out by the pink-line dedupe.
        if (!allowedPairIndices.has(i)) return null;
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
        const isTealLine =
          (aIsTeal && bIsCandidate) || (bIsTeal && aIsCandidate);
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
            <foreignObject x={pos.x} y={pos.y} width={pos.w} height={pos.h}>
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
                title={getCardName(constellation.heroCardId)}
                style={{
                  width: pos.w,
                  height: pos.h,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  borderRadius: 6,
                  boxShadow:
                    "0 0 0 2px var(--accent, var(--gold)), 0 0 18px color-mix(in oklab, var(--accent, var(--gold)) 35%, transparent)",
                  overflow: "hidden",
                  display: "block",
                }}
              >
                <CardImage
                  variant="face"
                  cardId={constellation.heroCardId}
                  reversed={heroPick.isReversed}
                  deckId={heroPick.deckId ?? undefined}
                  size="custom"
                  widthPx={pos.w}
                  /* EC — opt out of native lazy loading. Inside SVG
                     foreignObject the browser's lazy heuristics can
                     stall image fetches, causing 1-5s skeleton delays
                     when the seeker swaps heroes. eager=true triggers
                     immediate fetch + high fetchPriority. */
                  eager
                />
              </button>
            </foreignObject>
            {heroInTeal && (
              <rect
                x={pos.x - 5}
                y={pos.y - 5}
                width={pos.w + 10}
                height={pos.h + 10}
                rx={8}
                fill="none"
                stroke={TRACE_VAR}
                strokeWidth={2.5}
                pointerEvents="none"
              />
            )}
            {/* Phase 24 / DZ — gold count badge, bottom-right of hero.
                Clickable when onHeroBadgeClick is provided; opens the
                readings modal scoped to all hero readings. */}
            {heroDrawCount !== null && heroDrawCount !== undefined && (
              <foreignObject
                x={pos.x + pos.w - 16}
                y={pos.y + pos.h - 16}
                width={32}
                height={32}
                pointerEvents={onHeroBadgeClick ? "auto" : "none"}
              >
                <button
                  type="button"
                  onClick={
                    onHeroBadgeClick
                      ? (e) => {
                          e.stopPropagation();
                          onHeroBadgeClick();
                        }
                      : undefined
                  }
                  aria-label={
                    onHeroBadgeClick
                      ? (heroBadgeTooltip ??
                        `View all ${heroDrawCount} readings with this card`)
                      : undefined
                  }
                  title={
                    onHeroBadgeClick
                      ? (heroBadgeTooltip ??
                        `View all ${heroDrawCount} readings with this card`)
                      : undefined
                  }
                  disabled={!onHeroBadgeClick}
                  style={{
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
                  }}
                >
                  {heroDrawCount}
                </button>
              </foreignObject>
            )}
            {/* DZ — teal match-count badge, upper-right of hero card
                when the hero is the first-clicked teal card and 2+
                teal cards are selected. Clicking opens the readings
                modal scoped to the current teal selection. */}
            {tealBadge &&
              tealBadge.cardId === constellation.heroCardId &&
              tealBadge.count > 0 && (
                <foreignObject
                  x={pos.x + pos.w - 16}
                  y={pos.y - 16}
                  width={32}
                  height={32}
                  pointerEvents="auto"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTealBadgeClick?.();
                    }}
                    aria-label={(tealBadge.tooltip ?? `View ${tealBadge.count} readings with selected cards`)}
                    title={(tealBadge.tooltip ?? `View ${tealBadge.count} readings with selected cards`)}
                    style={{
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
                    }}
                  >
                    {tealBadge.count}
                  </button>
                </foreignObject>
              )}
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
                title={getCardName(c.cardId)}
                style={{
                  width: pos.w,
                  height: pos.h,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  borderRadius: 4,
                  overflow: "hidden",
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
              </button>
            </foreignObject>
            {inTeal && (
              <rect
                x={pos.x - 3}
                y={pos.y - 3}
                width={pos.w + 6}
                height={pos.h + 6}
                rx={6}
                fill="none"
                stroke={TRACE_VAR}
                strokeWidth={2}
                pointerEvents="none"
              />
            )}
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
            {/* DZ — teal match-count badge on companion when it is the
                first-clicked teal card and 2+ teal cards are selected. */}
            {tealBadge &&
              tealBadge.cardId === c.cardId &&
              tealBadge.count > 0 && (
                <foreignObject
                  x={pos.x + pos.w - 14}
                  y={pos.y - 14}
                  width={28}
                  height={28}
                  pointerEvents="auto"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTealBadgeClick?.();
                    }}
                    aria-label={(tealBadge.tooltip ?? `View ${tealBadge.count} readings with selected cards`)}
                    title={(tealBadge.tooltip ?? `View ${tealBadge.count} readings with selected cards`)}
                    style={{
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
                    }}
                  >
                    {tealBadge.count}
                  </button>
                </foreignObject>
              )}
          </g>
        );
      })}
    </svg>
  );
}
