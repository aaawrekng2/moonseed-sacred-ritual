import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
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
  const { showLabels, toggleShowLabels } = useShowLabels();

  // Per-card revealed state. Cards must be flipped in slot order.
  const [revealedFlags, setRevealedFlags] = useState<boolean[]>(
    () => picks.map(() => false),
  );
  // Index of the card that just received a wrong tap (red border flash).
  // Cleared 400ms after it's set.
  const [wrongIndex, setWrongIndex] = useState<number | null>(null);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const continuedRef = useRef(false);

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  useEffect(
    () => () => {
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
    },
    [],
  );

  const labels = meta.positions ?? meta.positionsShort ?? [];

  // The lowest unrevealed index — that's the card the user must tap next.
  const nextIndex = revealedFlags.findIndex((r) => !r);
  const allRevealed = nextIndex === -1;
  const revealedCount = revealedFlags.filter(Boolean).length;
  const totalCount = picks.length;

  // Once every card is face-up, give the user a beat to take it in,
  // then push them into the reading.
  useEffect(() => {
    if (!allRevealed || continuedRef.current) return;
    continuedRef.current = true;
    const t = window.setTimeout(() => onContinue(), 1600);
    return () => window.clearTimeout(t);
  }, [allRevealed, onContinue]);

  const handleTap = useCallback(
    (i: number) => {
      if (revealedFlags[i]) return;
      if (i !== nextIndex) {
        // Wrong card — brief red flash, no other penalty.
        setWrongIndex(i);
        if (wrongTimer.current) clearTimeout(wrongTimer.current);
        wrongTimer.current = setTimeout(() => setWrongIndex(null), 400);
        return;
      }
      setRevealedFlags((prev) => {
        const next = prev.slice();
        next[i] = true;
        return next;
      });
    },
    [nextIndex, revealedFlags],
  );

  return (
    <main
      className="cast-screen-enter fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_30%,rgba(60,40,90,0.35),transparent_70%)]"
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
          revealedFlags={revealedFlags}
          nextIndex={nextIndex}
          wrongIndex={wrongIndex}
          onTap={handleTap}
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
        {allRevealed ? (
          <div className="flex flex-col items-center gap-2">
            <ProgressDots total={totalCount} revealed={revealedCount} />
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
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-2"
            aria-live="polite"
          >
            <ProgressDots total={totalCount} revealed={revealedCount} />
            <span
              className="font-display italic leading-none tabular-nums"
              style={{
                fontSize: 13,
                color: "var(--gold)",
                opacity: 0.75,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {revealedCount}/{totalCount} revealed
            </span>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Slim row of dots that fill in as cards are revealed. Dot count matches
 * the spread size so it scales naturally from 1 (single) to 10 (celtic).
 */
function ProgressDots({ total, revealed }: { total: number; revealed: number }) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuenow={revealed}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${revealed} of ${total} cards revealed`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < revealed;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: filled
                ? "var(--gold)"
                : "color-mix(in oklab, var(--gold) 25%, transparent)",
              boxShadow: filled
                ? "0 0 6px color-mix(in oklab, var(--gold) 60%, transparent)"
                : "none",
              transition:
                "background 300ms ease, box-shadow 300ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

function SpreadContent({
  spread,
  picks,
  labels,
  cardBack,
  revealedFlags,
  nextIndex,
  wrongIndex,
  onTap,
  showLabels,
}: {
  spread: SpreadMode;
  picks: Pick[];
  labels: string[];
  cardBack: CardBackId;
  revealedFlags: boolean[];
  nextIndex: number;
  wrongIndex: number | null;
  onTap: (i: number) => void;
  showLabels: boolean;
}) {
  // Pick a card width that fits the spread + viewport. Celtic Cross has
  // the densest layout so it gets the smallest cards.
  const sizing = useMemo(() => spreadSizing(spread), [spread]);

  if (spread === "celtic") {
    return (
      <CelticCross
        picks={picks}
        labels={labels}
        cardBack={cardBack}
        revealedFlags={revealedFlags}
        nextIndex={nextIndex}
        wrongIndex={wrongIndex}
        onTap={onTap}
        sizing={sizing}
        showLabels={showLabels}
      />
    );
  }
  if (spread === "three") {
    return (
      <ThreeRow
        picks={picks}
        labels={labels}
        cardBack={cardBack}
        revealedFlags={revealedFlags}
        nextIndex={nextIndex}
        wrongIndex={wrongIndex}
        onTap={onTap}
        sizing={sizing}
        showLabels={showLabels}
      />
    );
  }
  // single / daily / yes_no — one large card centered.
  return (
    <SingleCard
      pick={picks[0]}
      cardBack={cardBack}
      revealed={!!revealedFlags[0]}
      isNext={nextIndex === 0}
      isWrong={wrongIndex === 0}
      onTap={() => onTap(0)}
      sizing={sizing}
    />
  );
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
  isNext,
  isWrong,
  onTap,
  emergeDelayMs,
}: {
  pick: Pick;
  cardBack: CardBackId;
  revealed: boolean;
  sizing: Sizing;
  rotated?: boolean;
  isNext?: boolean;
  isWrong?: boolean;
  onTap?: () => void;
  emergeDelayMs?: number;
}) {
  const interactive = !revealed && !!onTap;
  return (
    <div
      className="cast-card-emerge"
      style={{
        // Custom prop consumed by the cast-card-emerge keyframes.
        ...({ "--emerge-delay": `${emergeDelayMs ?? 0}ms` } as React.CSSProperties),
        display: "inline-block",
      }}
    >
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
        className={cn(
          "relative h-full w-full rounded-[10px] flip-3d",
          revealed && "is-flipped",
          !revealed && isNext && "cast-next-hint",
          isWrong && "cast-wrong-flash",
        )}
        style={{
          // @ts-expect-error custom prop
          "--flip-ms": "1100ms",
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
      {interactive && (
        <button
          type="button"
          aria-label={
            isNext ? "Reveal this card" : "Tap the highlighted card first"
          }
          onClick={onTap}
          className="absolute inset-0 z-10 cursor-pointer rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          style={{ background: "transparent" }}
        />
      )}
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
  isNext,
  isWrong,
  onTap,
  sizing,
}: {
  pick: Pick;
  cardBack: CardBackId;
  revealed: boolean;
  isNext: boolean;
  isWrong: boolean;
  onTap: () => void;
  sizing: Sizing;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <CardFace
        pick={pick}
        cardBack={cardBack}
        revealed={revealed}
        isNext={isNext}
        isWrong={isWrong}
        onTap={onTap}
        sizing={sizing}
        emergeDelayMs={0}
      />
    </div>
  );
}

function ThreeRow({
  picks,
  labels,
  cardBack,
  revealedFlags,
  nextIndex,
  wrongIndex,
  onTap,
  sizing,
  showLabels,
}: {
  picks: Pick[];
  labels: string[];
  cardBack: CardBackId;
  revealedFlags: boolean[];
  nextIndex: number;
  wrongIndex: number | null;
  onTap: (i: number) => void;
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
            revealed={!!revealedFlags[i]}
            isNext={nextIndex === i}
            isWrong={wrongIndex === i}
            onTap={() => onTap(i)}
            sizing={sizing}
            emergeDelayMs={i * 90}
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
  revealedFlags,
  nextIndex,
  wrongIndex,
  onTap,
  sizing,
  showLabels,
}: {
  picks: Pick[];
  labels: string[];
  cardBack: CardBackId;
  revealedFlags: boolean[];
  nextIndex: number;
  wrongIndex: number | null;
  onTap: (i: number) => void;
  sizing: Sizing;
  showLabels: boolean;
}) {
  // Spacing constants tuned to the chosen card size.
  const colGap = Math.round(sizing.w * 0.35);
  const rowGap = Math.round(sizing.h * 0.18);

  // Each card carries its slot index (0-based) so we can wire in the
  // per-card revealed / next / wrong / tap state.
  const slotCard = (i: number) => ({ pick: picks[i], slotIndex: i });
  const present = slotCard(0);
  const obstacle = slotCard(1);
  const root = slotCard(2);
  const past = slotCard(3);
  const potential = slotCard(4);
  const future = slotCard(5);
  const staff = [slotCard(6), slotCard(7), slotCard(8), slotCard(9)];

  const cardWithLabel = (
    cell: { pick: Pick | undefined; slotIndex: number },
    label: string,
    rotated = false,
  ) =>
    cell.pick ? (
      <div className="flex flex-col items-center gap-1.5">
        <CardFace
          pick={cell.pick}
          cardBack={cardBack}
          revealed={!!revealedFlags[cell.slotIndex]}
          isNext={nextIndex === cell.slotIndex}
          isWrong={wrongIndex === cell.slotIndex}
          onTap={() => onTap(cell.slotIndex)}
          sizing={sizing}
          rotated={rotated}
          emergeDelayMs={cell.slotIndex * 70}
        />
        {showLabels && <PositionLabel>{label}</PositionLabel>}
      </div>
    ) : null;

  return (
    <div className="flex items-center" style={{ gap: colGap * 1.4 }}>
      {/* Cross block */}
      <div className="flex items-center" style={{ gap: colGap }}>
        {/* Past — left of cross */}
        {cardWithLabel(past, labels[3] ?? "Past")}

        {/* Center column: Future / (Present+Obstacle) / Root */}
        <div className="flex flex-col items-center" style={{ gap: rowGap }}>
          {cardWithLabel(future, labels[5] ?? "Future")}
          <div className="flex flex-col items-center gap-1.5">
          <div
            className="relative flex items-center justify-center"
            style={{ width: sizing.w, height: sizing.h }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <CardFace
                pick={present.pick!}
                cardBack={cardBack}
                revealed={!!revealedFlags[0]}
                isNext={nextIndex === 0}
                isWrong={wrongIndex === 0}
                onTap={() => onTap(0)}
                sizing={sizing}
                emergeDelayMs={0}
              />
            </div>
            {obstacle.pick ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <CardFace
                  pick={obstacle.pick}
                  cardBack={cardBack}
                  revealed={!!revealedFlags[1]}
                  isNext={nextIndex === 1}
                  isWrong={wrongIndex === 1}
                  onTap={() => onTap(1)}
                  sizing={sizing}
                  rotated
                  emergeDelayMs={70}
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
          {cardWithLabel(root, labels[2] ?? "Root")}
        </div>

        {/* Potential — right of cross */}
        {cardWithLabel(potential, labels[4] ?? "Potential")}
      </div>

      {/* Staff column on the right */}
      <div className="flex flex-col" style={{ gap: rowGap * 0.6 }}>
        {staff.map((cell, i) =>
          cell.pick ? (
            <div key={cell.pick.id} className="flex items-center gap-2">
              <CardFace
                pick={cell.pick}
                cardBack={cardBack}
                revealed={!!revealedFlags[cell.slotIndex]}
                isNext={nextIndex === cell.slotIndex}
                isWrong={wrongIndex === cell.slotIndex}
                onTap={() => onTap(cell.slotIndex)}
                sizing={sizing}
                emergeDelayMs={cell.slotIndex * 70}
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