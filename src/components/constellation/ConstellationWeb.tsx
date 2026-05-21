/**
 * Phase 17 — SVG mandala of card co-occurrence around the hero card.
 *
 * Hero card sits centred at the top of the viewBox; up to 7 companion
 * cards arrange around it. Weighted lines connect every pair, with
 * stroke width + opacity proportional to lifetime co-pull count.
 */
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import type { CardConstellation } from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

const AR_CEILING = 1.7;
const COMPANION_W = 60;
const COMPANION_H = Math.round(COMPANION_W * AR_CEILING); // ≈102 — layout reservation
const HERO_W = 120;
const HERO_H = Math.round(HERO_W * AR_CEILING); // ≈204
const HERO_Y = 120;
const SVG_W = 500;
const SVG_H = 720;
const COMPANION_POSITIONS = [
  { x: 70, y: 170 },   // upper-left — overlaps hero
  { x: 410, y: 170 },  // upper-right — overlaps hero
  { x: 20, y: 340 },   // mid-far-left
  { x: 460, y: 340 },  // mid-far-right
  { x: 110, y: 500 },  // lower-left
  { x: 370, y: 500 },  // lower-right
  { x: 240, y: 580 },  // bottom center
];

type Props = {
  heroPick: ManualPick | null;
  constellation: CardConstellation | null;
  onCompanionClick: (cardId: number) => void;
  selectedCompanion: number | null;
};

type Box = { x: number; y: number; w: number; h: number };

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
  onCompanionClick,
  selectedCompanion,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        maxWidth: 500,
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 22,
            color: "var(--color-foreground)",
          }}
        >
          The Constellation
        </p>
        <p
          style={{
            margin: "4px 0 0 0",
            fontSize: 10,
            letterSpacing: "0.3em",
            fontFamily: "var(--font-serif)",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            textTransform: "uppercase",
          }}
        >
          Cards Drawn Together — Line Weight = Times Paired · tap a card to filter
        </p>
      </div>

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
          onCompanionClick={onCompanionClick}
          selectedCompanion={selectedCompanion}
          heroPick={heroPick}
        />
      )}
    </div>
  );
}

function ConstellationSvg({
  constellation,
  onCompanionClick,
  selectedCompanion,
  heroPick,
}: {
  constellation: CardConstellation;
  onCompanionClick: (cardId: number) => void;
  selectedCompanion: number | null;
  heroPick: ManualPick;
}) {
  const maxPair = constellation.pairCounts.reduce(
    (m, p) => (p.count > m ? p.count : m),
    0,
  );

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
        const a = getCardPosition(pair.a, constellation);
        const b = getCardPosition(pair.b, constellation);
        if (a.w === 0 || b.w === 0) return null;
        const ca = center(a);
        const cb = center(b);
        const weight = maxPair > 0 ? pair.count / maxPair : 0;
        const strokeWidth = Math.max(1, Math.min(5, weight * 5));
        const opacity = 0.2 + weight * 0.7;
        return (
          <line
            key={`${pair.a}-${pair.b}-${i}`}
            x1={ca.cx}
            y1={ca.cy}
            x2={cb.cx}
            y2={cb.cy}
            stroke="var(--accent, var(--gold))"
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
      })}

      {/* Hero card */}
      {(() => {
        const pos = getCardPosition(
          constellation.heroCardId,
          constellation,
        );
        return (
          <foreignObject x={pos.x} y={pos.y} width={pos.w} height={pos.h}>
            <div
              style={{
                width: pos.w,
                height: pos.h,
                borderRadius: 6,
                boxShadow:
                  "0 0 0 2px var(--accent, var(--gold)), 0 0 18px color-mix(in oklab, var(--accent, var(--gold)) 35%, transparent)",
                overflow: "hidden",
              }}
              title={getCardName(constellation.heroCardId)}
            >
              <CardImage
                variant="face"
                cardId={constellation.heroCardId}
                reversed={heroPick.isReversed}
                deckId={heroPick.deckId ?? undefined}
                size="custom"
                widthPx={pos.w}
              />
            </div>
          </foreignObject>
        );
      })()}

      {/* Companion cards */}
      {constellation.companions.map((c) => {
        const pos = getCardPosition(c.cardId, constellation);
        if (pos.w === 0) return null;
        const isSelected = selectedCompanion === c.cardId;
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
                onClick={() => onCompanionClick(c.cardId)}
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
                />
              </button>
            </foreignObject>
            {isSelected && (
              <rect
                x={pos.x - 3}
                y={pos.y - 3}
                width={pos.w + 6}
                height={pos.h + 6}
                rx={6}
                fill="none"
                stroke="var(--accent, var(--gold))"
                strokeWidth={2}
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
          </g>
        );
      })}
    </svg>
  );
}