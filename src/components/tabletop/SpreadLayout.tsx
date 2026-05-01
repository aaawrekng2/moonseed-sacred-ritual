import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { getCardName } from "@/lib/tarot";
import { useActiveCardBackUrl, useActiveDeckImage } from "@/lib/active-deck";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { useShowLabels } from "@/lib/use-show-labels";
import { usePortraitOnly } from "@/lib/use-portrait-only";
import { cn } from "@/lib/utils";
import { InlineReading } from "@/components/reading/ReadingParts";
import {
  useRegisterCloseHandler,
  useRegisterCopyText,
} from "@/lib/floating-menu-context";

type Pick = { id: number; cardIndex: number; isReversed?: boolean };

type Props = {
  spread: SpreadMode;
  picks: Pick[];
  onExit: () => void;
  /**
   * Legacy prop — kept for backwards compatibility with `routes/draw.tsx`
   * but no longer fired automatically. The reading now happens INLINE on
   * this same screen once every card has been revealed; we never navigate
   * away to a separate ReadingScreen.
   */
  onContinue?: () => void;
  /**
   * Optional question the seeker brought to the cards. Threaded into the
   * inline reading so it can be saved with the row and sent to the AI.
   */
  question?: string;
  /**
   * Phase 9.5b. How the picks were produced ('digital' or 'manual') and
   * which custom deck was active at the moment of casting. Both are
   * persisted on the saved reading row by {@link InlineReading}.
   */
  entryMode?: "digital" | "manual";
  deckId?: string | null;
};

/**
 * Classic tarot spread layout. Cards are presented face-down in their
 * traditional positions for the chosen spread. A glowing "Reveal" button
 * flips them all face-up simultaneously; once revealed the user can
 * continue into the reading.
 */
export function SpreadLayout({
  spread,
  picks,
  onExit,
  question,
  entryMode,
  deckId,
}: Props) {
  const meta = SPREAD_META[spread];
  // BX — Tabletop / draw stays portrait-only.
  usePortraitOnly();
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const { showLabels } = useShowLabels();
  // Once every card is face-up the inline reading flow takes over.
  // `copyText` is hoisted from <InlineReading> so the global
  // FloatingMenu can surface a Copy icon while the reading is open.
  const [copyText, setCopyText] = useState<string | null>(null);

  // Register screen-specific actions with the global floating menu.
  useRegisterCloseHandler(onExit);
  useRegisterCopyText(copyText);

  // Per-card revealed state. Cards must be flipped in slot order.
  const [revealedFlags, setRevealedFlags] = useState<boolean[]>(
    () => picks.map(() => false),
  );
  // Index of the card that just received a wrong tap (red border flash).
  // Cleared 400ms after it's set.
  const [wrongIndex, setWrongIndex] = useState<number | null>(null);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      className="cast-screen-enter fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-y-auto bg-[radial-gradient(ellipse_at_50%_30%,rgba(60,40,90,0.35),transparent_70%)]"
      aria-label={`${meta.label} spread layout`}
      style={{
        // Allow native pinch-zoom + pan without the browser snapping the
        // viewport on tap. `manipulation` would also disable double-tap
        // zoom but kills pinch on some browsers; the explicit list is
        // the safest combination across iOS Safari + Chrome Android.
        touchAction: "pan-x pan-y pinch-zoom",
        // Always allow vertical scroll so the enrichment panel and any
        // bottom UI clear the bottom nav on every device.
        overflowY: "auto",
      }}
    >
      {/* Cards block — ALWAYS anchored at the top with a stable
          paddingTop. We do NOT use `flex-1` or `items-center` because
          that would cause the cards to "jump" the moment the inline
          reading mounts below them (the flex container would re-center
          its child once a tall sibling appears). Keeping `flex-shrink-0`
          + `items-start` from first paint to last means the cards stay
          in the exact same spot through the entire reveal -> reading
          transition. */}
      <div
        className="flex flex-shrink-0 items-start justify-center px-4"
        style={{
          paddingTop:
            spread === "celtic"
              ? "calc(var(--topbar-pad) + 16px)"
              : "calc(var(--topbar-pad) + 48px)",
          paddingBottom: "32px",
        }}
      >
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

      {/* Footer: progress dots while revealing, inline reading once done. */}
      {allRevealed ? (
        <div
          className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-5"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 140px)",
            paddingTop: 8,
          }}
        >
          <InlineReading
            spread={spread}
            picks={picks}
            onExit={onExit}
            onCopyTextChange={setCopyText}
            question={question}
            entryMode={entryMode}
            deckId={deckId}
          />
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-3 px-5"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 140px)",
            paddingTop: 8,
          }}
        >
          {/* Show the seeker's question between the face-down cards
              and the (now-implicit) flip prompt. Appears immediately on
              cast, before any flipping begins. */}
          {question && question.trim() && (
            <p
              className="text-center"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                lineHeight: 1.6,
                color: "var(--foreground)",
                opacity: "var(--ro-plus-20)",
                maxWidth: 360,
                margin: 0,
              }}
            >
              “{question.trim()}”
            </p>
          )}
        </div>
      )}
    </main>
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
  // 3-card sizing is now responsive and matches ReadingScreen's CardStrip
  // exactly, so the cards do not resize when the inline reading flow
  // takes over after the last reveal.
  const isMobile =
    typeof window !== "undefined" && window.innerWidth < 768;
  switch (spread) {
    case "celtic":
      return { w: 56, h: 98 };
    case "three":
      return isMobile ? { w: 100, h: 175 } : { w: 112, h: 196 };
    default:
      return isMobile ? { w: 180, h: 315 } : { w: 160, h: 280 };
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
  const cardImg = useActiveDeckImage();
  // BX — when a custom deck is active, render its photographed back.
  const customBackUrl = useActiveCardBackUrl();
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
          <CardBack id={cardBack} imageUrl={customBackUrl} width={sizing.w} className="h-full w-full" />
        </div>
        <div className="flip-face front overflow-hidden rounded-[10px] border border-gold/40 bg-card">
          {/* Always render the face image so it's preloaded before the flip
              animation begins — otherwise the first reveal shows a blank
              front while the image is still fetching. */}
          <img
            src={cardImg(pick.cardIndex)}
            alt={getCardName(pick.cardIndex)}
            className="h-full w-full object-cover"
            loading="eager"
            style={{
              transform: pick.isReversed ? "rotate(180deg)" : undefined,
              transition: "transform 600ms ease-out",
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      </div>
      {interactive && (
        <button
          type="button"
          aria-label={
            isNext ? "Reveal this card" : "Tap the highlighted card first"
          }
          onClick={onTap}
          className="absolute inset-0 cursor-pointer rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          // The "next" card must always sit on top of any sibling card's
          // tap target — critical for the Celtic Cross where the rotated
          // Obstacle (slot 2) overlaps the Present (slot 1) and would
          // otherwise swallow every tap meant for Present.
          style={{ background: "transparent", zIndex: isNext ? 30 : 10 }}
        />
      )}
    </div>
    </div>
  );
}

export function PositionLabel({
  children,
  cardWidth,
}: {
  children: React.ReactNode;
  cardWidth?: number;
}) {
  return (
    <span
      className="font-display italic"
      style={{
        fontSize: "var(--text-body-lg)",
        color: "var(--gold)",
        opacity: 0.75,
        letterSpacing: "0.05em",
        // CL Group 1 — allow wrapping so long labels (e.g. "Hopes &
        // Fears", "Final Outcome") don't force the column wider than
        // the card and push Celtic Cross off the screen.
        textAlign: "center",
        lineHeight: 1.2,
        display: "inline-block",
        ...(cardWidth ? { maxWidth: cardWidth } : {}),
      }}
    >
      {children}
    </span>
  );
}

/**
 * CE Group 4 — under each revealed card, surface the card name (and a
 * muted italic "reversed" line when applicable). Position labels alone
 * required users to recognize 78 cards by image; the card name removes
 * that burden without competing visually with the gold position label.
 */
function CardNameLabel({
  cardIndex,
  isReversed,
  cardWidth,
}: {
  cardIndex: number;
  isReversed: boolean;
  cardWidth: number;
}) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ width: cardWidth, maxWidth: cardWidth }}
    >
      <span
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          textAlign: "center",
          // CK Group 1 — allow wrapping so long names (e.g. "King of
          // Pentacles") don't force the column wider than the card and
          // push Celtic Cross cards off the screen.
          whiteSpace: "normal",
          wordBreak: "normal",
          lineHeight: 1.2,
          width: "100%",
        }}
      >
        {getCardName(cardIndex)}
      </span>
      {isReversed && (
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--foreground-muted)",
            fontStyle: "italic",
            textAlign: "center",
          }}
        >
          reversed
        </span>
      )}
    </div>
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
  const { showLabels } = useShowLabels();
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
      {showLabels && revealed && (
        <CardNameLabel
          cardIndex={pick.cardIndex}
          isReversed={!!pick.isReversed}
          cardWidth={sizing.w}
        />
      )}
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
    <div className="flex items-start gap-6">
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
            <PositionLabel cardWidth={sizing.w}>{labels[i] ?? `Card ${i + 1}`}</PositionLabel>
          )}
          {showLabels && revealedFlags[i] && (
            <CardNameLabel
              cardIndex={pick.cardIndex}
              isReversed={!!pick.isReversed}
              cardWidth={sizing.w}
            />
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
        {showLabels && <PositionLabel cardWidth={sizing.w}>{label}</PositionLabel>}
        {showLabels && revealedFlags[cell.slotIndex] && (
          <CardNameLabel
            cardIndex={cell.pick.cardIndex}
            isReversed={!!cell.pick.isReversed}
            cardWidth={sizing.w}
          />
        )}
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
            {/* Present (slot 1) and Obstacle (slot 2) share this cell.
                Both wrappers are absolutely positioned and overlap, so
                stacking order is determined by their parent stacking
                contexts — NOT by the inner button's z-index (the rotated
                Obstacle creates its own stacking context via `transform`).
                Lift whichever card is currently the next-required tap so
                its tap target sits on top of its sibling. */}
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ zIndex: nextIndex === 0 ? 20 : 10 }}
            >
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
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ zIndex: nextIndex === 1 ? 20 : 10 }}
              >
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
            <PositionLabel cardWidth={sizing.w}>
              {labels[0] ?? "Present"}
              <span style={{ opacity: 0.4, margin: "0 4px" }}>·</span>
              {labels[1] ?? "Obstacle"}
            </PositionLabel>
          )}
          {showLabels && (revealedFlags[0] || revealedFlags[1]) && (
            <div className="flex flex-col items-center gap-0.5">
              {revealedFlags[0] && present.pick && (
                <CardNameLabel
                  cardIndex={present.pick.cardIndex}
                  isReversed={!!present.pick.isReversed}
                  cardWidth={sizing.w}
                />
              )}
              {revealedFlags[1] && obstacle.pick && (
                <CardNameLabel
                  cardIndex={obstacle.pick.cardIndex}
                  isReversed={!!obstacle.pick.isReversed}
                  cardWidth={sizing.w}
                />
              )}
            </div>
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
            <div
              key={cell.pick.id}
              className="flex flex-col items-center gap-1.5"
            >
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
                <PositionLabel cardWidth={sizing.w}>{labels[6 + i] ?? `Slot ${7 + i}`}</PositionLabel>
              )}
              {showLabels && revealedFlags[cell.slotIndex] && (
                <CardNameLabel
                  cardIndex={cell.pick.cardIndex}
                  isReversed={!!cell.pick.isReversed}
                  cardWidth={sizing.w}
                />
              )}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  ManualSpreadSlots — reuses the same per-spread layout maths so the     */
/*  empty positions in manual-entry mode appear in IDENTICAL locations    */
/*  to the cards that will eventually show up in the reading screen       */
/*  (Phase 9.5b Fix 5).                                                   */
/* ====================================================================== */

type ManualSlotPick = { cardIndex: number; isReversed: boolean } | null;

export function ManualSpreadSlots({
  spread,
  picks,
  onSlotTap,
  showLabels = true,
}: {
  spread: SpreadMode;
  picks: ManualSlotPick[];
  onSlotTap: (slotIndex: number) => void;
  showLabels?: boolean;
}) {
  const meta = SPREAD_META[spread];
  const labels = meta.positions ?? meta.positionsShort ?? [];
  const sizing = useMemo(() => spreadSizing(spread), [spread]);
  const cardImg = useActiveDeckImage();

  const Slot = ({ pick, slotIndex, rotated }: { pick: ManualSlotPick; slotIndex: number; rotated?: boolean }) => (
    <button
      type="button"
      onClick={() => onSlotTap(slotIndex)}
      aria-label={pick ? `Replace ${getCardName(pick.cardIndex)}` : `Pick card for ${labels[slotIndex] ?? `position ${slotIndex + 1}`}`}
      className={cn(
        "relative rounded-[10px] transition active:scale-[0.98]",
        pick
          ? "border border-gold/40 overflow-hidden bg-card"
          : "border-2 border-dashed border-foreground/25 bg-foreground/[0.04] hover:border-gold/50 hover:bg-gold/5",
      )}
      style={{
        width: sizing.w,
        height: sizing.h,
        transform: rotated ? "rotate(90deg)" : undefined,
        transformOrigin: "center center",
        boxShadow: pick ? "0 6px 18px rgba(0,0,0,0.5)" : undefined,
      }}
    >
      {pick ? (
        <img
          src={cardImg(pick.cardIndex)}
          alt={getCardName(pick.cardIndex)}
          className="h-full w-full object-cover"
          style={{ transform: pick.isReversed ? "rotate(180deg)" : undefined }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[18px] font-light text-foreground/50">+</span>
      )}
    </button>
  );

  if (spread === "celtic") {
    const colGap = Math.round(sizing.w * 0.35);
    const rowGap = Math.round(sizing.h * 0.18);
    const cellWithLabel = (i: number, label: string, rotated = false) => (
      <div className="flex flex-col items-center gap-1.5">
        <Slot pick={picks[i] ?? null} slotIndex={i} rotated={rotated} />
        {showLabels && <PositionLabel cardWidth={sizing.w}>{label}</PositionLabel>}
        {showLabels && picks[i] && (
          <CardNameLabel
            cardIndex={picks[i]!.cardIndex}
            isReversed={!!picks[i]!.isReversed}
            cardWidth={sizing.w}
          />
        )}
      </div>
    );
    return (
      <div className="flex items-center" style={{ gap: colGap * 1.4 }}>
        <div className="flex items-center" style={{ gap: colGap }}>
          {cellWithLabel(3, labels[3] ?? "Past")}
          <div className="flex flex-col items-center" style={{ gap: rowGap }}>
            {cellWithLabel(5, labels[5] ?? "Future")}
            <div className="flex flex-col items-center gap-1.5">
              <div className="relative flex items-center justify-center" style={{ width: sizing.w, height: sizing.h }}>
                <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 10 }}>
                  <Slot pick={picks[0] ?? null} slotIndex={0} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 11 }}>
                  <Slot pick={picks[1] ?? null} slotIndex={1} rotated />
                </div>
              </div>
              {showLabels && (
                <PositionLabel cardWidth={sizing.w}>
                  {labels[0] ?? "Present"}
                  <span style={{ opacity: 0.4, margin: "0 4px" }}>·</span>
                  {labels[1] ?? "Obstacle"}
                </PositionLabel>
              )}
            </div>
            {cellWithLabel(2, labels[2] ?? "Root")}
          </div>
          {cellWithLabel(4, labels[4] ?? "Potential")}
        </div>
        <div className="flex flex-col" style={{ gap: rowGap * 0.6 }}>
          {[6, 7, 8, 9].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Slot pick={picks[i] ?? null} slotIndex={i} />
              {showLabels && <PositionLabel cardWidth={sizing.w}>{labels[i] ?? `Slot ${i + 1}`}</PositionLabel>}
              {showLabels && picks[i] && (
                <CardNameLabel
                  cardIndex={picks[i]!.cardIndex}
                  isReversed={!!picks[i]!.isReversed}
                  cardWidth={sizing.w}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (spread === "three") {
    return (
      <div className="flex items-start gap-6">
        {picks.map((pick, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Slot pick={pick} slotIndex={i} />
            {showLabels && <PositionLabel cardWidth={sizing.w}>{labels[i] ?? `Card ${i + 1}`}</PositionLabel>}
            {showLabels && pick && (
              <CardNameLabel
                cardIndex={pick.cardIndex}
                isReversed={!!pick.isReversed}
                cardWidth={sizing.w}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  // single / daily / yes_no
  return (
    <div className="flex flex-col items-center gap-3">
      <Slot pick={picks[0] ?? null} slotIndex={0} />
      {showLabels && labels[0] && <PositionLabel cardWidth={sizing.w}>{labels[0]}</PositionLabel>}
      {showLabels && picks[0] && (
        <CardNameLabel
          cardIndex={picks[0]!.cardIndex}
          isReversed={!!picks[0]!.isReversed}
          cardWidth={sizing.w}
        />
      )}
    </div>
  );
}