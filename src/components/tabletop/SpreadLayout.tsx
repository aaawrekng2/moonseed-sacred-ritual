import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { useShowLabels } from "@/lib/use-show-labels";
import { cn } from "@/lib/utils";

type Pick = { id: number; cardIndex: number };

type Props = {
  spread: SpreadMode;
  picks: Pick[];
  onExit: () => void;
  /** Called once the user has revealed every card on the spread layout. */
  onContinue: () => void;
};

/**
 * Classic tarot spread layout. Cards are presented face-down in their
 * traditional positions for the chosen spread. A glowing "Reveal" button
 * flips them all face-up simultaneously; once revealed the user can
 * continue into the reading.
 */
export function SpreadLayout({ spread, picks, onExit, onContinue }: Props) {
  const meta = SPREAD_META[spread];
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const { showLabels, toggleShowLabels } = useShowLabels();

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  const labels = meta.positions ?? meta.positionsShort ?? [];

  const handleReveal = () => {
    if (revealed || revealing) return;
    setRevealing(true);
    // Flip together; brief lingering pause before the reading screen.
    window.setTimeout(() => {
      setRevealed(true);
    }, 80);
    window.setTimeout(() => {
      onContinue();
    }, 2400);
  };

  return (
    <main
      className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_30%,rgba(60,40,90,0.35),transparent_70%)]"
      aria-label={`${meta.label} spread layout`}
    >
      <button
        type="button"
        onClick={onExit}
        aria-label="Close spread"
        className="absolute right-3 top-3 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full text-gold/80 transition-opacity hover:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: "calc(env(safe-area-inset-right, 0px) + 12px)",
        }}
      >
        <X className="h-5 w-5" strokeWidth={1.5} />
      </button>

      {/* Labels visibility toggle — mirrors the tabletop preference. */}
      <button
        type="button"
        onClick={toggleShowLabels}
        aria-pressed={showLabels}
        aria-label={
          showLabels
            ? "Hide spread position labels"
            : "Show spread position labels"
        }
        title={showLabels ? "Hide labels" : "Show labels"}
        className="absolute left-3 top-3 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full text-gold/80 transition-opacity hover:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "calc(env(safe-area-inset-left, 0px) + 12px)",
          opacity: showLabels ? 0.95 : 0.55,
        }}
      >
        {showLabels ? (
          <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <EyeOff className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <SpreadContent
          spread={spread}
          picks={picks}
          labels={labels}
          cardBack={cardBack}
          revealed={revealed}
          showLabels={showLabels}
        />
      </div>

      <div
        className="flex justify-center"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          paddingTop: 8,
        }}
      >
        {!revealed ? (
          <button
            type="button"
            onClick={handleReveal}
            disabled={revealing}
            aria-busy={revealing}
            aria-label="Reveal all cards"
            className="reveal-glow-pulse inline-flex items-center gap-2 bg-transparent font-display italic leading-none transition-transform hover:scale-[1.04] focus:outline-none disabled:cursor-not-allowed"
            style={{
              fontSize: 22,
              color: "var(--gold)",
              cursor: "pointer",
              textShadow:
                "0 0 18px rgba(212,175,55,0.85), 0 0 36px rgba(212,175,55,0.4)",
            }}
          >
            {revealing && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {revealing ? "Revealing" : "Reveal"}
          </button>
        ) : (
          <span
            className="font-display italic leading-none"
            style={{
              fontSize: 14,
              color: "var(--gold)",
              opacity: 0.7,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Opening reading…
          </span>
        )}
      </div>
    </main>
  );
}

function SpreadContent({
  spread,
  picks,
  labels,
  cardBack,
  revealed,
  showLabels,
}: {
  spread: SpreadMode;
  picks: Pick[];
  labels: string[];
  cardBack: CardBackId;
  revealed: boolean;
  showLabels: boolean;
}) {
  // Pick a card width that fits the spread + viewport. Celtic Cross has
  // the densest layout so it gets the smallest cards.
  const sizing = useMemo(() => spreadSizing(spread), [spread]);

  if (spread === "celtic") {
    return <CelticCross picks={picks} labels={labels} cardBack={cardBack} revealed={revealed} sizing={sizing} showLabels={showLabels} />;
  }
  if (spread === "three") {
    return <ThreeRow picks={picks} labels={labels} cardBack={cardBack} revealed={revealed} sizing={sizing} showLabels={showLabels} />;
  }
  // single / daily / yes_no — one large card centered.
  return <SingleCard pick={picks[0]} cardBack={cardBack} revealed={revealed} sizing={sizing} />;
}

type Sizing = { w: number; h: number };

function spreadSizing(spread: SpreadMode): Sizing {
  // Tuned per layout density. Heights derived from CARD_ASPECT_RATIO 1.75.
  switch (spread) {
    case "celtic":
      return { w: 56, h: 98 };
    case "three":
      return { w: 92, h: 161 };
    default:
      return { w: 160, h: 280 };
  }
}

function CardFace({
  pick,
  cardBack,
  revealed,
  sizing,
  rotated,
  delayMs,
}: {
  pick: Pick;
  cardBack: CardBackId;
  revealed: boolean;
  sizing: Sizing;
  rotated?: boolean;
  delayMs?: number;
}) {
  return (
    <div
      className="relative"
      style={{
        width: sizing.w,
        height: sizing.h,
        transform: rotated ? "rotate(90deg)" : undefined,
        transformOrigin: "center center",
      }}
    >
      <div
        className={cn("relative h-full w-full rounded-[10px] flip-3d", revealed && "is-flipped")}
        style={{
          // @ts-expect-error custom prop
          "--flip-ms": "1100ms",
          transitionDelay: delayMs ? `${delayMs}ms` : undefined,
          boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flip-face back">
          <CardBack id={cardBack} width={sizing.w} className="h-full w-full" />
        </div>
        <div className="flip-face front overflow-hidden rounded-[10px] border border-gold/40 bg-card">
          <img
            src={getCardImagePath(pick.cardIndex)}
            alt={getCardName(pick.cardIndex)}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-1 text-center">
            <span className="font-display text-[8px] leading-tight text-foreground/80 bg-background/40 rounded px-1">
              {getCardName(pick.cardIndex)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-display italic"
      style={{
        fontSize: 10,
        color: "var(--gold)",
        opacity: 0.75,
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SingleCard({
  pick,
  cardBack,
  revealed,
  sizing,
}: {
  pick: Pick;
  cardBack: CardBackId;
  revealed: boolean;
  sizing: Sizing;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <CardFace pick={pick} cardBack={cardBack} revealed={revealed} sizing={sizing} />
    </div>
  );
}

function ThreeRow({
  picks,
  labels,
  cardBack,
  revealed,
  sizing,
  showLabels,
}: {
  picks: Pick[];
  labels: string[];
  cardBack: CardBackId;
  revealed: boolean;
  sizing: Sizing;
  showLabels: boolean;
}) {
  return (
    <div className="flex items-end gap-6">
      {picks.map((pick, i) => (
        <div key={pick.id} className="flex flex-col items-center gap-2">
          <CardFace
            pick={pick}
            cardBack={cardBack}
            revealed={revealed}
            sizing={sizing}
          />
          {showLabels && (
            <PositionLabel>{labels[i] ?? `Card ${i + 1}`}</PositionLabel>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Classic Celtic Cross layout:
 *   - Center column: 3 vertical (Future top, Present+Obstacle middle, Root bottom)
 *     with Obstacle rotated 90° across Present.
 *   - Past sits left of center, Potential sits right.
 *   - Right staff column: Self / External / Hopes / Outcome (bottom to top).
 *
 * picks[0..9] correspond to positions Present(1), Obstacle(2), Root(3),
 * Past(4), Potential(5), Future(6), Self(7), External(8), Hopes(9),
 * Outcome(10) — matching SPREAD_META.celtic.positions.
 */
function CelticCross({
  picks,
  labels,
  cardBack,
  revealed,
  sizing,
  showLabels,
}: {
  picks: Pick[];
  labels: string[];
  cardBack: CardBackId;
  revealed: boolean;
  sizing: Sizing;
  showLabels: boolean;
}) {
  // Spacing constants tuned to the chosen card size.
  const colGap = Math.round(sizing.w * 0.35);
  const rowGap = Math.round(sizing.h * 0.18);

  const present = picks[0];
  const obstacle = picks[1];
  const root = picks[2];
  const past = picks[3];
  const potential = picks[4];
  const future = picks[5];
  const staff = [picks[6], picks[7], picks[8], picks[9]]; // Self/Ext/Hope/Out

  const cardWithLabel = (
    p: Pick | undefined,
    label: string,
    delay: number,
    rotated = false,
  ) =>
    p ? (
      <div className="flex flex-col items-center gap-1.5">
        <CardFace
          pick={p}
          cardBack={cardBack}
          revealed={revealed}
          sizing={sizing}
          rotated={rotated}
          delayMs={delay}
        />
        {showLabels && <PositionLabel>{label}</PositionLabel>}
      </div>
    ) : null;

  return (
    <div className="flex items-center" style={{ gap: colGap * 1.4 }}>
      {/* Cross block */}
      <div className="flex items-center" style={{ gap: colGap }}>
        {/* Past — left of cross */}
        {cardWithLabel(past, labels[3] ?? "Past", 0)}

        {/* Center column: Future / (Present+Obstacle) / Root */}
        <div className="flex flex-col items-center" style={{ gap: rowGap }}>
          {cardWithLabel(future, labels[5] ?? "Future", 50)}
          <div className="flex flex-col items-center gap-1.5">
          <div
            className="relative flex items-center justify-center"
            style={{ width: sizing.w, height: sizing.h }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <CardFace
                pick={present}
                cardBack={cardBack}
                revealed={revealed}
                sizing={sizing}
                delayMs={100}
              />
            </div>
            {obstacle ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <CardFace
                  pick={obstacle}
                  cardBack={cardBack}
                  revealed={revealed}
                  sizing={sizing}
                  rotated
                  delayMs={150}
                />
              </div>
            ) : null}
          </div>
          {showLabels && (
            <PositionLabel>
              {labels[0] ?? "Present"}
              <span style={{ opacity: 0.4, margin: "0 4px" }}>·</span>
              {labels[1] ?? "Obstacle"}
            </PositionLabel>
          )}
          </div>
          {cardWithLabel(root, labels[2] ?? "Root", 200)}
        </div>

        {/* Potential — right of cross */}
        {cardWithLabel(potential, labels[4] ?? "Potential", 250)}
      </div>

      {/* Staff column on the right */}
      <div className="flex flex-col" style={{ gap: rowGap * 0.6 }}>
        {staff.map((p, i) =>
          p ? (
            <div key={p.id} className="flex items-center gap-2">
              <CardFace
                pick={p}
                cardBack={cardBack}
                revealed={revealed}
                sizing={sizing}
                delayMs={300 + i * 60}
              />
              {showLabels && (
                <PositionLabel>{labels[6 + i] ?? `Slot ${7 + i}`}</PositionLabel>
              )}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}