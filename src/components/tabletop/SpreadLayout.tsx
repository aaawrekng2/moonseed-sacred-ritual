import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, BookOpen } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import {
  useActiveCardBackUrl,
  useActiveDeckImage,
  useActiveDeckCornerRadius,
  useActiveDeckCardName,
} from "@/lib/active-deck";
import { buildDeckImageMap, resolveCardImage, type DeckImageMap } from "@/lib/custom-decks";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { useShowLabels } from "@/lib/use-show-labels";
import { useShowMeanings } from "@/lib/use-show-meanings";
import { PageMenu, type PageMenuSection } from "@/components/nav/PageMenu";
import { PageMenuTrigger } from "@/components/nav/PageMenuTrigger";
import { getCardMeaning } from "@/lib/tarot-meanings";
import { usePortraitOnly } from "@/lib/use-portrait-only";
import { responsiveSlotWidth, TABLETOP_CONFIG } from "@/components/tabletop/config";
import { SlotLabel } from "@/components/tabletop/SlotLabel";
import { cn } from "@/lib/utils";
import { InlineReading } from "@/components/reading/ReadingParts";
import { useIsMobile } from "@/hooks/use-mobile";
import { CardZoomModal } from "./CardZoomModal";
// EJ64 — Tap on a face-up card on the flip table no longer opens
// the hero zoom; it opens Card Trace as a modal overlay so the
// seeker sees the card's full history without losing the spread
// state behind it.
import { CardTraceView } from "@/routes/insights.card.$cardId";
import { useRegisterCloseHandler, useRegisterCopyText } from "@/lib/floating-menu-context";
import { nextYesNoSaying } from "@/lib/yes-no-sayings";
import { MANUAL_ENTRY_CONTENT_MAX } from "@/components/tabletop/manual-entry-constants";

type Pick = { id: number; cardIndex: number; isReversed?: boolean; deckId?: string | null };

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
  /** 9-6-O — Custom spread cardinality (1-10). */
  customCount?: number;
  /**
   * EK16 — Shared-element transition. When provided, indexed by pick
   * order, these are the viewport rects each card occupied IN ITS SLOT
   * at the moment of handoff from Tabletop. SpreadLayout uses them as
   * the START position of its entry animation: after first paint,
   * each card is transformed back to its slot rect, then over ~700ms
   * the transform unwinds to identity — so the card visually slides
   * from the slot position up to its spread position.
   *
   * When omitted (manual entry, or any other code path that can't
   * measure slots), SpreadLayout falls back to the pre-EK16
   * cast-card-emerge animation (small fade-up from center).
   */
  fromSlotRects?: { x: number; y: number; width: number; height: number }[] | null;
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
  customCount,
  fromSlotRects,
}: Props) {
  const meta = SPREAD_META[spread];
  // BX — Tabletop / draw stays portrait-only.
  usePortraitOnly();
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const { showLabels } = useShowLabels();
  // CZ Group 2 — on mobile, suppress the under-card position labels
  // (Past/Present/Future, Celtic Cross labels). The bottom-bar whisper
  // still names the focused position so no information is lost.
  const isMobile = useIsMobile();
  const showSlotLabels = showLabels && !isMobile;
  // v3.59 — the flip surface now carries its own hamburger so the
  // Meanings toggle is reachable HERE (previously it lived only on the
  // picking table, a different component). setShowMeanings drives the
  // below-card meanings rendered further down.
  const { showMeanings, setShowMeanings } = useShowMeanings();
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const flipPageMenuSections: PageMenuSection[] = [
    {
      id: "hide-show",
      title: "Hide / Show",
      items: [
        {
          id: "meanings",
          label: "Meanings",
          description: showMeanings ? "Shown under cards" : "Hidden",
          Icon: BookOpen,
          mode: "toggle",
          on: showMeanings,
          onClick: () => setShowMeanings(!showMeanings),
        },
      ],
    },
  ];
  // CZ Group 3 — tap-to-zoom on flipped cards.
  const [zoomedCard, setZoomedCard] = useState<{
    cardIndex: number;
    reversed: boolean;
    pickDeckId: string | null;
  } | null>(null);
  // Once every card is face-up the inline reading flow takes over.
  // `copyText` is hoisted from <InlineReading> so the global
  // FloatingMenu can surface a Copy icon while the reading is open.
  const [copyText, setCopyText] = useState<string | null>(null);

  // Register screen-specific actions with the global floating menu.
  useRegisterCloseHandler(onExit);
  useRegisterCopyText(copyText);

  // Per-card revealed state. Cards must be flipped in slot order.
  const [revealedFlags, setRevealedFlags] = useState<boolean[]>(() => picks.map(() => false));
  // Index of the card that just received a wrong tap (red border flash).
  // Cleared 400ms after it's set.
  const [wrongIndex, setWrongIndex] = useState<number | null>(null);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // EK54 — castReady/Pause B removed. The flicker we were chasing
  // turned out to be edits in the wrong file (ReadingScreen vs
  // InlineReading). Spread content always renders on mount.

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
  // EK33 — Per-position one-sentence descriptions, threaded down to
  // PositionLabel so it can render the tap-to-reveal popover. Custom
  // spreads have no `positionDescriptions` (undefined), so the resulting
  // array stays empty and PositionLabel falls back to the non-tappable
  // plain-text path.
  const descriptions = meta.positionDescriptions ?? [];

  // The lowest unrevealed index — that's the card the user must tap next.
  const nextIndex = revealedFlags.findIndex((r) => !r);
  const allRevealed = nextIndex === -1;

  // Q93 #5 — When the last card flips and InlineReading mounts below,
  // the cards can be scrolled off the top. Snap the scroll container
  // back to top so the seeker still sees their spread.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!allRevealed) return;
    const el = mainRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [allRevealed]);

  // EK55 — Delay the InlineReading mount until the last card's flip
  // animation completes + 1s pause, then fade in. Without this, the
  // notes section pops in instantly the moment the last card is
  // clicked, before the seeker has even finished seeing the card
  // turn over. The flip animation is 1100ms (the `--flip-ms` CSS
  // variable on the card's flip-3d wrapper); add a 1000ms pause
  // for the seeker to register the spread before notes appear.
  const [mountReading, setMountReading] = useState<boolean>(false);
  useEffect(() => {
    if (!allRevealed) {
      setMountReading(false);
      return;
    }
    const t = setTimeout(() => setMountReading(true), 2100);
    return () => clearTimeout(t);
  }, [allRevealed]);

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
      ref={mainRef}
      className="bg-cosmos fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-y-auto"
      aria-label={`${meta.label} spread layout`}
      style={{
        // v3.61 — the flip surface is a TRANSPARENT full-screen layer
        // (.bg-cosmos paints nothing) sitting over the TopNav at the same
        // z-index, so it swallowed the nav's clicks. pointer-events:none on
        // the root lets clicks fall through in the empty areas (nav strip,
        // side gutters); every interactive block below re-enables them.
        pointerEvents: "none",
        // Allow native pinch-zoom + pan without the browser snapping the
        // viewport on tap. `manipulation` would also disable double-tap
        // zoom but kills pinch on some browsers; the explicit list is
        // the safest combination across iOS Safari + Chrome Android.
        touchAction: "pan-x pan-y pinch-zoom",
        // Q79b — always reserve the scrollbar so the viewport width is
        // constant whether or not the page actually overflows. Without
        // this, the scrollbar appears mid-reveal (when interpretation UI
        // mounts after the last flip) and shrinks the 10-card grid by
        // ~15px of viewport width.
        overflowY: "scroll",
        // Q77 #3 — prevent a few px of horizontal scroll on 10-card
        // custom spreads (cells + 12px side padding can exceed viewport).
        overflowX: "hidden",
        // EK49 — Dropped the maxWidth: 1280 cap. On wide monitors the
        // draw table fills the full viewport but the reveal layout was
        // pinching to 1280px in the center, reading as a visible width
        // shrink during the cast/flip transition. Matching the draw
        // table's full-width behavior eliminates the perceived shrink.
        // (Q94 #2's intent — keep cards from stretching uncomfortably
        // wide — is preserved by the per-spread cell sizing logic
        // further down the file, which already caps individual card
        // widths.)
        margin: "0 auto",
        left: 0,
        right: 0,
      }}
    >
      {/* EK54 — Pause B overlay removed (was an unhelpful diagnostic;
          spread content renders unconditionally). */}
      <>
      {/* v3.59 — flip-surface hamburger. PageMenuTrigger portals to
          document.body so it escapes this fixed z-40 container. */}
      <PageMenuTrigger onClick={() => setPageMenuOpen(true)} />
      <PageMenu
        open={pageMenuOpen}
        onClose={() => setPageMenuOpen(false)}
        sections={flipPageMenuSections}
        title="Reading"
      />
      {/* Q50 Fix 3 — close X for cast/flip phase (Tabletop's X is gone,
          ReadingScreen's X isn't here yet). */}
      <button
        type="button"
        onClick={onExit}
        aria-label="Close reading"
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 10px)",
          right: "calc(env(safe-area-inset-right, 0px) + 12px)",
          zIndex: 60,
          pointerEvents: "auto",
          padding: 8,
          color: "var(--color-foreground)",
          opacity: 0.7,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          touchAction: "manipulation",
        }}
      >
        <X size={18} strokeWidth={1.5} />
      </button>
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
          pointerEvents: "auto",
          // v3.61 — top spacing as MARGIN (not padding) so this block's
          // clickable box starts at the cards; the empty strip above (where
          // the nav sits) stays click-through.
          marginTop:
            spread === "celtic"
              ? "calc(var(--topbar-pad) + 48px)"
              : "calc(var(--topbar-pad) + 80px)",
          paddingBottom: "48px",
        }}
      >
        <SpreadContent
          spread={spread}
          picks={picks}
          labels={labels}
          descriptions={descriptions}
          cardBack={cardBack}
          revealedFlags={revealedFlags}
          nextIndex={nextIndex}
          wrongIndex={wrongIndex}
          onTap={handleTap}
          showLabels={showSlotLabels}
          onZoom={(cardIndex, reversed, pickDeckId) =>
            setZoomedCard({ cardIndex, reversed, pickDeckId })
          }
          // EK16 — Slot-origin rects for the shared-element transition.
          fromSlotRects={fromSlotRects ?? null}
        />
      </div>

      {/* Footer: progress dots while revealing, inline reading once done. */}
      {allRevealed ? (
        <div
          className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-5"
          style={{
            pointerEvents: "auto",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 140px)",
            paddingTop: 8,
          }}
        >
          {/* EK55 — Fade-in wrapper. opacity transitions over 400ms
                when mountReading flips to true (after flip animation
                + 1s pause). InlineReading itself is mounted from
                first paint so its internal state doesn't reset on
                toggle — the opacity is the only visible change. */}
          <div
            style={{
              width: "100%",
              opacity: mountReading ? 1 : 0,
              transition: "opacity 400ms ease-out",
              pointerEvents: mountReading ? "auto" : "none",
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
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-3 px-5"
          style={{
            pointerEvents: "auto",
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
      {zoomedCard && (
        <div style={{ pointerEvents: "auto" }}>
          <CardTraceView
            cardId={zoomedCard.cardIndex}
            onClose={() => setZoomedCard(null)}
          />
        </div>
      )}
      </>
    </main>
  );
}

function SpreadContent({
  spread,
  picks,
  labels,
  descriptions,
  cardBack,
  revealedFlags,
  nextIndex,
  wrongIndex,
  onTap,
  showLabels,
  onZoom,
  fromSlotRects,
}: {
  spread: SpreadMode;
  picks: Pick[];
  labels: string[];
  descriptions: string[];
  cardBack: CardBackId;
  revealedFlags: boolean[];
  nextIndex: number;
  wrongIndex: number | null;
  onTap: (i: number) => void;
  showLabels: boolean;
  onZoom: (cardIndex: number, reversed: boolean, pickDeckId: string | null) => void;
  // EK16 — Per-pick slot origin rects. Threaded down to CardFace so
  // each card knows where it came from in the slot rail and animates
  // FROM that position to its final spread position.
  fromSlotRects?: { x: number; y: number; width: number; height: number }[] | null;
}) {
  // Pick a card width that fits the spread + viewport. Celtic Cross has
  // the densest layout so it gets the smallest cards.
  const sizing = useMemo(() => spreadSizing(spread, picks.length), [spread, picks.length]);
  // CM Group 2 — reveal phase = all slots filled but not every card flipped.
  const required = picks.length;
  const { showMeanings } = useShowMeanings();
  const revealedCount = revealedFlags.filter(Boolean).length;
  const isRevealPhase = required > 0 && revealedCount < required && picks.length === required;

  if (spread === "celtic") {
    return (
      <CelticCross
        picks={picks}
        labels={labels}
        descriptions={descriptions}
        cardBack={cardBack}
        revealedFlags={revealedFlags}
        nextIndex={nextIndex}
        wrongIndex={wrongIndex}
        onTap={onTap}
        sizing={sizing}
        showLabels={showLabels}
        isRevealPhase={isRevealPhase}
        onZoom={onZoom}
        fromSlotRects={fromSlotRects}
      />
    );
  }
  if (spread === "three") {
    return (
      <ThreeRow
        picks={picks}
        labels={labels}
        descriptions={descriptions}
        cardBack={cardBack}
        revealedFlags={revealedFlags}
        nextIndex={nextIndex}
        wrongIndex={wrongIndex}
        onTap={onTap}
        sizing={sizing}
        showLabels={showLabels}
        isRevealPhase={isRevealPhase}
        onZoom={onZoom}
        fromSlotRects={fromSlotRects}
      />
    );
  }
  if (spread === "custom") {
    const count = picks.length;
    // Q39b Fix 6 — max 5 cards per row, wrap to 2 rows beyond.
    if (count >= 5) {
      const rawViewportW = typeof window !== "undefined" ? window.innerWidth : 380;
      const effectiveViewportW = Math.max(280, rawViewportW - 24);
      const cols = Math.min(count, 5);
      const slotW = responsiveSlotWidth(effectiveViewportW, cols);
      // Q50 Fix 7 — in reveal phase the cards stop being small slot-rail
      // tap targets and become the focal display. Scale slotW up (capped
      // at 140) so they don't read as tiny.
      const revealScale = isRevealPhase ? 1.6 : 1.0;
      const displayW = Math.min(Math.round(slotW * revealScale), 140);
      const slotH = Math.round(displayW * TABLETOP_CONFIG.CARD_ASPECT_RATIO);
      const gap = count >= 10 ? 4 : 8;
      const rowSize = count <= 5 ? count : Math.ceil(count / 2);
      const row1 = picks.slice(0, rowSize);
      const row2 = picks.slice(rowSize);
      // Q47 — two-row pattern: cards anchored to a shared floor,
      // labels in a separate top-aligned row below. Eliminates the
      // per-cell stacking misalignment when only some cards are
      // revealed.
      const cardAreaH = Math.round(displayW * 2);
      const renderRow = (rowPicks: typeof picks, rowOffset: number) => {
        const colsInRow = rowPicks.length;
        return (
          <div key={`row-${rowOffset}`} style={{ width: "100%" }}>
            <div
              style={{
                display: "grid",
                // EK59 — fixed-width, center-justified columns instead of
                // 1fr. 1fr stretched 5+ cards edge-to-edge across the
                // viewport; fixed width keeps them clustered and centered,
                // matching the ≤4-card layout.
                gridTemplateColumns: `repeat(${colsInRow}, ${displayW}px)`,
                gap: `${gap}px`,
                justifyContent: "center",
                alignItems: "end",
                justifyItems: "center",
                marginBottom: 4,
              }}
            >
              {rowPicks.map((pick, idx) => {
                const i = rowOffset + idx;
                return (
                  <div
                    key={`card-${pick.id}`}
                    style={{
                      height: cardAreaH,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                    }}
                  >
                    <CardFace
                      pick={pick}
                      cardBack={cardBack}
                      revealed={!!revealedFlags[i]}
                      isNext={nextIndex === i}
                      isWrong={wrongIndex === i}
                      onTap={() => onTap(i)}
                      sizing={{ w: displayW, h: slotH }}
                      emergeDelayMs={i * 80}
                      isRevealPhase={isRevealPhase}
                      onZoom={onZoom}
                      fromSlotRect={fromSlotRects?.[i] ?? null}
                    />
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "grid",
                // EK59 — match the cards row: fixed-width, centered.
                gridTemplateColumns: `repeat(${colsInRow}, ${displayW}px)`,
                gap: `${gap}px`,
                justifyContent: "center",
                alignItems: "start",
                justifyItems: "center",
              }}
            >
              {rowPicks.map((pick, idx) => {
                const i = rowOffset + idx;
                return (
                  <div
                    key={`label-${pick.id}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                    }}
                  >
                    {/* EK33 — Was `<PositionLabel>{`Card ${i + 1}`}</PositionLabel>`.
                        Per the styling doc + EK33 request: custom
                        spreads have no `positions` data, so they
                        render no label at all. Removed entirely. */}
                    {(showLabels || showMeanings) && revealedFlags[i] && (
                      <CardNameLabel
                        cardIndex={pick.cardIndex}
                        isReversed={!!pick.isReversed}
                        cardWidth={displayW}
                        fadeInDelayMs={1100}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      };
      return (
        <div className="flex flex-col items-center gap-3 w-full max-w-full">
          {renderRow(row1, 0)}
          {row2.length > 0 && renderRow(row2, rowSize)}
        </div>
      );
    }
    // Q92 #5 — Two stacked grids: cards bottom-aligned to a shared
    // baseline, labels top-aligned in the row below.
    // EJ70 — Fixed-width columns + justifyContent center so the cards
    // cluster instead of spreading across the full frame on desktop.
    return (
      <div className="flex flex-col items-center gap-2 w-full max-w-full">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${picks.length}, ${sizing.w}px)`,
            gap: 16,
            alignItems: "end",
            justifyContent: "center",
            justifyItems: "center",
            maxWidth: "100%",
          }}
        >
          {picks.map((pick, i) => (
            <CardFace
              key={`card-${pick.id}`}
              pick={pick}
              cardBack={cardBack}
              revealed={!!revealedFlags[i]}
              isNext={nextIndex === i}
              isWrong={wrongIndex === i}
              onTap={() => onTap(i)}
              sizing={sizing}
              emergeDelayMs={i * 80}
              isRevealPhase={isRevealPhase}
              onZoom={onZoom}
              fromSlotRect={fromSlotRects?.[i] ?? null}
            />
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${picks.length}, ${sizing.w}px)`,
            gap: 16,
            alignItems: "start",
            justifyContent: "center",
            justifyItems: "center",
            maxWidth: "100%",
          }}
        >
          {picks.map((pick, i) => (
            <div
              key={`label-${pick.id}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
            >
              {/* EK33 — Non-custom multi-card spreads (horseshoe,
                  relationship, decision, year_of_lunations etc.) get
                  the underlined tappable label with popover. Custom
                  spreads have no `labels[i]` and PositionLabel's null
                  guard makes them render nothing. */}
              {showLabels && (
                <PositionLabel
                  cardWidth={sizing.w}
                  fullName={labels[i] ?? null}
                  description={descriptions[i] ?? null}
                >
                  {labels[i] ?? null}
                </PositionLabel>
              )}
              {(showLabels || showMeanings) && revealedFlags[i] && (
                <CardNameLabel
                  cardIndex={pick.cardIndex}
                  isReversed={!!pick.isReversed}
                  cardWidth={sizing.w}
                  fadeInDelayMs={1100}
                  positionLabel={labels[i] ?? undefined}
                />
              )}
            </div>
          ))}
        </div>
      </div>
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
      isRevealPhase={isRevealPhase}
      onZoom={onZoom}
      spread={spread}
      // EK16 — Slot-origin rect (single-card spreads have one slot).
      fromSlotRect={fromSlotRects?.[0] ?? null}
    />
  );
}

type Sizing = { w: number; h: number };

function spreadSizing(spread: SpreadMode, count?: number): Sizing {
  // Tuned per layout density. Heights derived from CARD_ASPECT_RATIO 1.75.
  // 3-card sizing is now responsive and matches ReadingScreen's CardStrip
  // exactly, so the cards do not resize when the inline reading flow
  // takes over after the last reveal.
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  switch (spread) {
    case "celtic":
      return { w: 56, h: 98 };
    case "three":
      return isMobile ? { w: 100, h: 175 } : { w: 112, h: 196 };
    case "custom": {
      // 9-6-O — scale down as count grows; wrap-friendly sizing.
      const n = count ?? 3;
      if (n <= 1) return isMobile ? { w: 180, h: 315 } : { w: 160, h: 280 };
      if (n <= 3) return isMobile ? { w: 100, h: 175 } : { w: 112, h: 196 };
      if (n <= 6) return isMobile ? { w: 80, h: 140 } : { w: 96, h: 168 };
      return { w: 64, h: 112 };
    }
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
  isRevealPhase,
  onZoom,
  fromSlotRect,
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
  isRevealPhase?: boolean;
  onZoom?: (cardIndex: number, reversed: boolean, pickDeckId: string | null) => void;
  /**
   * EK16 — Viewport rect this card occupied IN ITS SLOT at the moment
   * the seeker filled the final slot. When present, CardFace plays a
   * shared-element transition: on mount, transform the card back to
   * the slot rect; then in the next frame unwind the transform to
   * identity over ~700ms so the card visibly slides from the slot
   * position to its spread position. When absent, the existing
   * cast-card-emerge animation runs (small fade-up from center).
   */
  fromSlotRect?: { x: number; y: number; width: number; height: number } | null;
}) {
  const interactive = !revealed && !!onTap;
  const cardImg = useActiveDeckImage();
  // BX — when a custom deck is active, render its photographed back.
  const customBackUrl = useActiveCardBackUrl();
  const deckRadiusPx = useActiveDeckCornerRadius();
  // EJ35 — resolve oracle card names for alt + aria-label.
  const resolveCardName = useActiveDeckCardName();
  // CM Group 2 — focus dim during the reveal phase only. Next-to-flip
  // stays full opacity, already-flipped fade to 0.8, others to 0.6.
  const cardOpacity = !isRevealPhase ? 1 : isNext ? 1 : revealed ? 0.8 : 0.6;

  // EK16 — Shared-element transition. The outer FLIP wrapper captures
  // its post-paint viewport rect, computes the delta to where the card
  // sat IN ITS SLOT at handoff, applies that as an inverse transform
  // synchronously (before paint commits), then unwinds it over 700ms.
  // Net visual: card lives at slot position on first frame, then
  // smoothly slides to the spread position.
  //
  // When `fromSlotRect` is absent, this whole effect is skipped and the
  // existing cast-card-emerge animation (small fade-up) plays via the
  // sibling div below.
  const flipRef = useRef<HTMLDivElement | null>(null);
  const flipPlayedRef = useRef(false);
  // EK56 — Lift-off in place. The slot→spread transition is now armed
  // in the flip node's REF CALLBACK rather than a useLayoutEffect.
  //
  // Why: the ref callback runs during React's commit, before the
  // browser's first paint of this node. Applying the inverse transform
  // (translate + scale back to the rail rect) AND flipping opacity to 1
  // here means the card's very FIRST painted frame already sits at the
  // exact rail position/size — never at the final spread position. The
  // old useLayoutEffect path left a window where the browser could
  // paint the card once at its final spread spot over the opaque cosmos
  // background while Tabletop was hidden underneath, which read as
  // "disappear, then reappear smaller and in a slightly different spot,
  // then shift up." With the transform committed pre-paint there is no
  // blank frame and no pre-travel snap: the card lifts straight off the
  // rail and travels to its already-coded spread position.
  const setFlipNode = useCallback(
    (el: HTMLDivElement | null) => {
      flipRef.current = el;
      if (!el) return;
      // v3.65 — the flip node starts at opacity 0 (see the style below) so it
      // never flashes at the spread position before the lift-off arms. That
      // means we MUST reveal it here no matter what, or a card whose lift-off
      // can't run (missing / zero slot rect, throttled rAF) stays invisible —
      // the "cards vanished on a 7-card cast" bug. So bail to a plain reveal
      // whenever the shared-element transition can't be set up.
      const validFrom =
        !!fromSlotRect && fromSlotRect.width > 0 && fromSlotRect.height > 0;
      if (!validFrom) {
        el.style.opacity = "1";
        el.style.transform = "translate(0, 0) scale(1, 1)";
        return;
      }
      if (flipPlayedRef.current) return;
      const dest = el.getBoundingClientRect();
      if (!(dest.width > 0 && dest.height > 0)) {
        el.style.opacity = "1";
        el.style.transform = "translate(0, 0) scale(1, 1)";
        return;
      }
      // translate FROM the final spread position BACK to the rail rect,
      // and scale FROM spread size DOWN to rail size. transform-origin
      // top-left so the scale anchors where the translate targets.
      const deltaX = fromSlotRect.x - dest.left;
      const deltaY = fromSlotRect.y - dest.top;
      const scaleX = fromSlotRect.width / dest.width;
      const scaleY = fromSlotRect.height / dest.height;
      el.style.transition = "none";
      el.style.transformOrigin = "top left";
      el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
      el.style.opacity = "1";
      // Commit the start transform synchronously before enabling the
      // transition (offsetWidth read forces layout).
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetWidth;
      requestAnimationFrame(() => {
        const node = flipRef.current;
        if (!node) return;
        // 1100ms true ease-in-out: eases in slowly, peaks mid-flight,
        // decelerates gently into the spread slot.
        node.style.transition = "transform 1100ms cubic-bezier(0.65, 0, 0.35, 1)";
        node.style.transform = "translate(0, 0) scale(1, 1)";
      });
      // v3.65 — safety net: if the rAF-driven unwind never runs (background /
      // throttled tab, interrupted paint), force the card to its final spread
      // position + full opacity so it can never get stranded small at the rail.
      window.setTimeout(() => {
        const node = flipRef.current;
        if (!node) return;
        node.style.transition = "none";
        node.style.transform = "translate(0, 0) scale(1, 1)";
        node.style.opacity = "1";
      }, 1300);
      flipPlayedRef.current = true;
    },
    [fromSlotRect],
  );

  return (
    <div
      style={{
        display: "inline-block",
        opacity: cardOpacity,
        transition: "opacity 400ms ease-out",
      }}
    >
      <div
        ref={setFlipNode}
        // EK16/EK56 — cast-card-emerge class ONLY when there's no
        // fromSlotRect (the pre-EK16 fade-up fallback). With a slot
        // rect, the lift-off is driven entirely by inline styles set
        // in the setFlipNode ref callback above; the emerge keyframes
        // would fight it.
        className={fromSlotRect ? undefined : "cast-card-emerge"}
        style={
          fromSlotRect
            ? {
                // Inline transform/transition is set by the ref
                // callback during commit; default to identity for
                // SSR + first paint. willChange keeps the GPU layer
                // warm for the travel.
                display: "inline-block",
                willChange: "transform",
                // EK54/EK56 — Start hidden. The ref callback flips
                // opacity to 1 the same frame it applies the rail
                // transform, so the first painted frame is the card
                // sitting at the rail (never at the spread position).
                opacity: 0,
              }
            : {
                // Pre-EK16 fallback path: small fade-up from center.
                ...({ "--emerge-delay": `${emergeDelayMs ?? 0}ms` } as React.CSSProperties),
                display: "inline-block",
              }
        }
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
              <CardBack
                id={cardBack}
                imageUrl={customBackUrl}
                width={sizing.w}
                className="h-full w-full"
              />
            </div>
            <div className="flip-face front overflow-hidden bg-card">
              {/* Always render the face image so it's preloaded before the flip
              animation begins — otherwise the first reveal shows a blank
              front while the image is still fetching. */}
              <img
                src={cardImg(pick.cardIndex) ?? undefined}
                alt={resolveCardName(pick.cardIndex)}
                className="h-full w-full object-contain"
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
              aria-label={isNext ? "Reveal this card" : "Tap the highlighted card first"}
              onClick={onTap}
              className="absolute inset-0 cursor-pointer rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              // The "next" card must always sit on top of any sibling card's
              // tap target — critical for the Celtic Cross where the rotated
              // Obstacle (slot 2) overlaps the Present (slot 1) and would
              // otherwise swallow every tap meant for Present.
              style={{ background: "transparent", zIndex: isNext ? 30 : 10 }}
            />
          )}
          {revealed && onZoom && (
            <button
              type="button"
              aria-label={`Zoom ${resolveCardName(pick.cardIndex)}`}
              onClick={(e) => {
                e.stopPropagation();
                onZoom(pick.cardIndex, !!pick.isReversed, pick.deckId ?? null);
              }}
              className="absolute inset-0 cursor-zoom-in rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
              style={{ background: "transparent", zIndex: 15 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * EK33 — Underlined, tappable position label with a popover containing
 * the full position name + one-sentence description.
 *
 * When `children` (the short label) is falsy, renders nothing — same
 * contract as the rail's SlotLabel. Custom spreads have no `positions`
 * data, so call sites passing literal "Card N" fallbacks now pass null
 * instead and the label simply doesn't render.
 *
 * `description` is the per-position explanation from
 * `meta.positionDescriptions`. When absent, the popover is suppressed
 * and the label renders as plain non-tappable styled text — same look
 * as before EK33.
 */
export function PositionLabel({
  children,
  fullName,
  description,
  cardWidth,
}: {
  children: React.ReactNode;
  /** Full position name shown as the popover header. */
  fullName?: string | null;
  /** One-sentence description shown below the name in the popover. */
  description?: string | null;
  cardWidth?: number;
}) {
  // If children is null/undefined/empty, render nothing — bans the
  // legacy "Card N" / "Slot N" fallback per the styling doc.
  if (children === null || children === undefined || children === "") return null;
  // Without a description, fall back to a plain styled span (the
  // pre-EK33 look). The popover only opens when there's real content
  // for it; otherwise the label is informational text, not a control.
  if (!description) {
    return (
      <span
        className="font-display italic"
        style={{
          fontSize: "var(--text-body-lg)",
          color: "var(--gold)",
          opacity: 0.75,
          letterSpacing: "0.05em",
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
  // With a description, render the tappable underlined affordance via
  // SlotLabel. The visible text is the short label (children); the
  // popover shows fullName + description.
  const short = typeof children === "string" ? children : String(children);
  return (
    <SlotLabel
      shortName={short}
      fullName={fullName ?? short}
      description={description}
      className="font-display italic"
      style={{
        fontSize: "var(--text-body-lg)",
        color: "var(--gold)",
        opacity: 0.75,
        letterSpacing: "0.05em",
        textAlign: "center",
        lineHeight: 1.2,
        display: "inline-block",
        ...(cardWidth ? { maxWidth: cardWidth } : {}),
      }}
    />
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
  nameOverride,
  fadeInDelayMs,
  positionLabel,
}: {
  cardIndex: number;
  isReversed: boolean;
  cardWidth: number;
  nameOverride?: string;
  positionLabel?: string;
  /**
   * EK119 — when set, the label stays hidden for this many ms after mount
   * (i.e. while the card is mid-flip), then fades in. Used on the flip
   * screen so the name never shows through a turning card — it appears
   * only once the card is fully face-up. Omitted elsewhere → instant.
   */
  fadeInDelayMs?: number;
}) {
  // EJ35 — resolve oracle card names via active deck so the label
  // under each card reads "Hurricane Lamp" not "Card 1000".
  const resolveCardName = useActiveDeckCardName();
  const { showMeanings } = useShowMeanings();
  const meaning = (() => {
    if (!showMeanings) return null;
    const m = getCardMeaning(cardIndex);
    if (!m) return null;
    return isReversed ? m.reversedMeaning : m.uprightMeaning;
  })();
  const delayed = typeof fadeInDelayMs === "number" && fadeInDelayMs > 0;
  const [shown, setShown] = useState(!delayed);
  useEffect(() => {
    if (!delayed) return;
    setShown(false);
    const t = window.setTimeout(() => setShown(true), fadeInDelayMs);
    return () => window.clearTimeout(t);
  }, [delayed, fadeInDelayMs]);
  return (
    <div
      className="flex flex-col items-center"
      style={{
        width: cardWidth,
        maxWidth: cardWidth,
        opacity: shown ? 1 : 0,
        transition: delayed ? "opacity 360ms ease-out" : undefined,
      }}
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
        {nameOverride ?? resolveCardName(cardIndex)}
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
      {showMeanings && positionLabel && (
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--accent, var(--gold))",
            fontStyle: "italic",
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {positionLabel}
        </span>
      )}
      {meaning && (
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--foreground-muted)",
            textAlign: "center",
            lineHeight: 1.3,
            marginTop: 2,
          }}
        >
          {meaning}
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
  isRevealPhase,
  onZoom,
  spread,
  fromSlotRect,
}: {
  pick: Pick;
  cardBack: CardBackId;
  revealed: boolean;
  isNext: boolean;
  isWrong: boolean;
  onTap: () => void;
  sizing: Sizing;
  isRevealPhase?: boolean;
  onZoom?: (cardIndex: number, reversed: boolean, pickDeckId: string | null) => void;
  spread?: SpreadMode;
  // EK16 — Slot-origin rect for the shared-element transition.
  fromSlotRect?: { x: number; y: number; width: number; height: number } | null;
}) {
  // DD-1 — under-card name labels also hide on mobile (matches the
  // position-label suppression at the parent level). The bottom-bar
  // whisper still names the focused card.
  const { showLabels: rawShowLabels } = useShowLabels();
  const isMobile = useIsMobile();
  const showLabels = rawShowLabels && !isMobile;
  const { showMeanings } = useShowMeanings();
  // Q92 #7 — Yes/No: after the card flips, drop a tarot-voice saying
  // beneath it that matches the card's yes/no tendency. Computed once
  // per (cardId, reveal) so re-renders don't keep advancing the index.
  const [saying, setSaying] = useState<string | null>(null);
  useEffect(() => {
    if (spread === "yes_no" && revealed && pick) {
      setSaying(nextYesNoSaying(pick.cardIndex, !!pick.isReversed));
    } else if (!revealed) {
      setSaying(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, pick?.cardIndex, spread]);
  return (
    <div
      className="flex flex-col items-center gap-3"
      style={
        spread === "yes_no" && revealed
          ? { transform: "translateY(-60px)", transition: "transform 600ms ease" }
          : undefined
      }
    >
      <CardFace
        pick={pick}
        cardBack={cardBack}
        revealed={revealed}
        isNext={isNext}
        isWrong={isWrong}
        onTap={onTap}
        sizing={sizing}
        emergeDelayMs={0}
        isRevealPhase={isRevealPhase}
        onZoom={onZoom}
        fromSlotRect={fromSlotRect ?? null}
      />
      {(showLabels || showMeanings) && revealed && (
        <CardNameLabel
          cardIndex={pick.cardIndex}
          isReversed={!!pick.isReversed}
          cardWidth={sizing.w}
          fadeInDelayMs={1100}
        />
      )}
      {spread === "yes_no" && revealed && saying && (
        <p
          key={saying}
          className="text-center"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-lg)",
            color: "var(--gold)",
            maxWidth: 360,
            margin: "8px auto 0",
            opacity: 0,
            animation: "yesno-saying-in 600ms ease 400ms forwards",
          }}
        >
          {saying}
        </p>
      )}
      <style>{`
        @keyframes yesno-saying-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function ThreeRow({
  picks,
  labels,
  descriptions,
  cardBack,
  revealedFlags,
  nextIndex,
  wrongIndex,
  onTap,
  sizing,
  showLabels,
  isRevealPhase,
  onZoom,
  fromSlotRects,
}: {
  picks: Pick[];
  labels: string[];
  // EK33 — Per-position descriptions threaded down so PositionLabel can
  // render the tap-to-reveal popover. Empty = no popover (custom).
  descriptions: string[];
  cardBack: CardBackId;
  revealedFlags: boolean[];
  nextIndex: number;
  wrongIndex: number | null;
  onTap: (i: number) => void;
  sizing: Sizing;
  showLabels: boolean;
  isRevealPhase?: boolean;
  onZoom?: (cardIndex: number, reversed: boolean, pickDeckId: string | null) => void;
  // EK16 — Slot origin rects per pick index.
  fromSlotRects?: { x: number; y: number; width: number; height: number }[] | null;
}) {
  // Q47 — two-row pattern: cards bottom-anchored to a shared floor,
  // labels in a separate top-aligned row below.
  // Q49 Fix 2 — cardAreaH * 2 instead of * 1.71 so taller-aspect
  // card images (oracle decks) do not overflow the cell upward.
  const { showMeanings } = useShowMeanings();
  const cardAreaH = Math.round(sizing.w * 2);
  const cols = picks.length;
  // EJ70 — Constrain the row to a centered content-width cluster instead
  // of letting `repeat(cols, 1fr)` span the full 1280 frame. On wide
  // desktops the 1fr columns absorbed all the slack and pushed the cards
  // to the thirds of the screen with huge gaps. Width = cards + gaps, so
  // the cards sit together with just the 24px gutter between them, and
  // mx-auto centers the cluster.
  const ROW_GAP = 24;
  const clusterWidth = cols * sizing.w + (cols - 1) * ROW_GAP;
  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${sizing.w}px)`,
          gap: ROW_GAP,
          alignItems: "end",
          justifyContent: "center",
          justifyItems: "center",
          marginBottom: 8,
          width: clusterWidth,
          maxWidth: "100%",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {picks.map((pick, i) => (
          <div
            key={`card-${pick.id}-${i}`}
            style={{
              height: cardAreaH,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <CardFace
              pick={pick}
              cardBack={cardBack}
              revealed={!!revealedFlags[i]}
              isNext={nextIndex === i}
              isWrong={wrongIndex === i}
              onTap={() => onTap(i)}
              sizing={sizing}
              emergeDelayMs={i * 90}
              isRevealPhase={isRevealPhase}
              onZoom={onZoom}
              fromSlotRect={fromSlotRects?.[i] ?? null}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${sizing.w}px)`,
          gap: ROW_GAP,
          alignItems: "start",
          justifyContent: "center",
          justifyItems: "center",
          width: clusterWidth,
          maxWidth: "100%",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {picks.map((pick, i) => (
          <div
            key={`label-${pick.id}-${i}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            {showLabels && (
              <PositionLabel
                cardWidth={sizing.w}
                fullName={labels[i] ?? null}
                description={descriptions[i] ?? null}
              >
                {labels[i] ?? null}
              </PositionLabel>
            )}
            {(showLabels || showMeanings) && revealedFlags[i] && (
              <CardNameLabel
                cardIndex={pick.cardIndex}
                isReversed={!!pick.isReversed}
                cardWidth={sizing.w}
                fadeInDelayMs={1100}
              />
            )}
          </div>
        ))}
      </div>
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
  descriptions,
  cardBack,
  revealedFlags,
  nextIndex,
  wrongIndex,
  onTap,
  sizing,
  showLabels: _showLabels,
  isRevealPhase,
  onZoom,
  fromSlotRects,
}: {
  picks: Pick[];
  labels: string[];
  // EK33 — Per-position one-sentence descriptions, used by PositionLabel
  // to show a tap-to-reveal popover. Empty array when meta has no
  // descriptions (custom spread); PositionLabel falls back to plain text.
  descriptions: string[];
  cardBack: CardBackId;
  revealedFlags: boolean[];
  nextIndex: number;
  wrongIndex: number | null;
  onTap: (i: number) => void;
  sizing: Sizing;
  showLabels: boolean;
  isRevealPhase?: boolean;
  onZoom?: (cardIndex: number, reversed: boolean, pickDeckId: string | null) => void;
  // EK16 — Slot origin rects per pick index.
  fromSlotRects?: { x: number; y: number; width: number; height: number }[] | null;
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
    _label: string,
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
          isRevealPhase={isRevealPhase}
          onZoom={onZoom}
          fromSlotRect={fromSlotRects?.[cell.slotIndex] ?? null}
        />
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
                  isRevealPhase={isRevealPhase}
                  onZoom={onZoom}
                  fromSlotRect={fromSlotRects?.[0] ?? null}
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
                    isRevealPhase={isRevealPhase}
                    onZoom={onZoom}
                    fromSlotRect={fromSlotRects?.[1] ?? null}
                  />
                </div>
              ) : null}
            </div>
          </div>
          {cardWithLabel(root, labels[2] ?? "Root")}
        </div>

        {/* Potential — right of cross */}
        {cardWithLabel(potential, labels[4] ?? "Potential")}
      </div>

      {/* Staff column on the right */}
      <div className="flex flex-col" style={{ gap: rowGap * 0.6 }}>
        {staff.map((cell) =>
          cell.pick ? (
            <div key={cell.pick.id} className="flex flex-col items-center gap-1.5">
              <CardFace
                pick={cell.pick}
                cardBack={cardBack}
                revealed={!!revealedFlags[cell.slotIndex]}
                isNext={nextIndex === cell.slotIndex}
                isWrong={wrongIndex === cell.slotIndex}
                onTap={() => onTap(cell.slotIndex)}
                sizing={sizing}
                emergeDelayMs={cell.slotIndex * 70}
                isRevealPhase={isRevealPhase}
                onZoom={onZoom}
                fromSlotRect={fromSlotRects?.[cell.slotIndex] ?? null}
              />
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

type ManualSlotPick = {
  cardIndex: number;
  isReversed: boolean;
  /** 9-6-M — null = active deck. */
  deckId?: string | null;
  cardName?: string;
} | null;

export function ManualSpreadSlots({
  spread,
  picks,
  onSlotTap,
  showLabels = true,
  customCount,
  onSlotReorder,
  ambiguousSlots,
}: {
  spread: SpreadMode;
  picks: ManualSlotPick[];
  onSlotTap: (slotIndex: number) => void;
  showLabels?: boolean;
  /** 9-6-O — used when spread === "custom". */
  customCount?: number;
  /** Q17 Fix 2 — drag/drop reorder. fromIdx may equal toIdx (no-op). */
  onSlotReorder?: (fromIdx: number, toIdx: number) => void;
  /** Q17 Fix 1 — slots filled via paste with ambiguous match. */
  ambiguousSlots?: number[];
}) {
  const meta = SPREAD_META[spread];
  const labels = meta.positions ?? meta.positionsShort ?? [];
  // EK33 — Threaded to PositionLabel so manual-entry slot labels also
  // get the tap-to-reveal popover. Custom spreads have no descriptions
  // so PositionLabel falls back to plain non-tappable text.
  const descriptions = meta.positionDescriptions ?? [];
  const sizing = useMemo(() => spreadSizing(spread, customCount), [spread, customCount]);
  const activeResolve = useActiveDeckImage();
  const deckRadiusPx = useActiveDeckCornerRadius();
  // EJ35 — resolver routes through the active deck's nameByCardId so
  // oracle picks without an explicit pick.cardName still surface a
  // real label instead of "Card 1000".
  const resolveCardName = useActiveDeckCardName();

  // 9-6-M — load image maps for any non-active deck IDs the picks reference.
  const uniqueDeckIds = useMemo(
    () => Array.from(new Set(picks.map((p) => p?.deckId ?? null).filter((d): d is string => !!d))),
    [picks],
  );
  const uniqueKey = uniqueDeckIds.join(",");
  const [deckMaps, setDeckMaps] = useState<Record<string, DeckImageMap>>({});
  const [deckMapsLoading, setDeckMapsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setDeckMapsLoading(true);
    void Promise.all(
      uniqueDeckIds.map(async (id) => {
        const map = await buildDeckImageMap(id);
        return [id, map] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, DeckImageMap> = {};
      for (const [id, map] of entries) {
        if (map) next[id] = map;
      }
      setDeckMaps(next);
      setDeckMapsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueKey]);

  const resolveForPick = (pick: NonNullable<ManualSlotPick>): string | null => {
    // 9-6-O — slot tiles are small; pull the thumbnail variant rather
    // than the multi-MB display image.
    if (!pick.deckId) return activeResolve(pick.cardIndex, "thumbnail");
    const map = deckMaps[pick.deckId];
    return resolveCardImage(pick.cardIndex, map ?? null, "thumbnail");
  };
  const nameForPick = (pick: NonNullable<ManualSlotPick>): string =>
    pick.cardName ?? resolveCardName(pick.cardIndex) ?? `Card ${pick.cardIndex}`;

  // 9-6-O — track natural aspect of each picked image so the slot
  // adapts to non-tarot card shapes (oracle decks). Empty slots keep
  // the standard 5:8 placeholder so the dashed target reads as a card.
  const [pickAspects, setPickAspects] = useState<Record<number, number>>({});
  const defaultAspect = sizing.w / sizing.h;

  const Slot = ({
    pick,
    slotIndex,
    rotated,
    responsiveWidth,
    cellWidth,
  }: {
    pick: ManualSlotPick;
    slotIndex: number;
    rotated?: boolean;
    responsiveWidth?: boolean;
    cellWidth?: number;
  }) => {
    const aspect = pick ? (pickAspects[slotIndex] ?? defaultAspect) : defaultAspect;
    const baseW = cellWidth ?? sizing.w;
    const baseH = cellWidth ? Math.round(cellWidth / defaultAspect) : sizing.h;
    const height = pick ? Math.round(baseW / aspect) : baseH;
    const isAmbiguous = ambiguousSlots?.includes(slotIndex);
    // Q20 Fix 6 — when the parent column controls the width (custom
    // spread max-5-per-row), let the slot fill the column and derive
    // height from the natural aspect.
    const sizeStyle: React.CSSProperties = responsiveWidth
      ? { width: "100%", aspectRatio: String(aspect) }
      : { width: baseW, height };
    const showShimmer = !!pick && pick.deckId != null && deckMapsLoading;
    return (
      <button
        type="button"
        onClick={() => onSlotTap(slotIndex)}
        draggable={!!pick && !!onSlotReorder}
        onDragStart={(e) => {
          if (!pick || !onSlotReorder) return;
          e.dataTransfer.setData("text/plain", String(slotIndex));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!onSlotReorder) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (!onSlotReorder) return;
          e.preventDefault();
          const raw = e.dataTransfer.getData("text/plain");
          const fromIdx = parseInt(raw, 10);
          if (Number.isNaN(fromIdx) || fromIdx === slotIndex) return;
          onSlotReorder(fromIdx, slotIndex);
        }}
        aria-label={
          pick
            ? `Replace ${nameForPick(pick)}`
            : `Pick card for ${labels[slotIndex] ?? `position ${slotIndex + 1}`}`
        }
        className={cn(
          "relative transition active:scale-[0.98]",
          pick
            ? "overflow-hidden"
            : "border-2 border-dashed border-foreground/25 bg-foreground/[0.04] hover:border-gold/50 hover:bg-gold/5",
          isAmbiguous && "ring-2 ring-yellow-400/70",
        )}
        style={{
          ...sizeStyle,
          transform: rotated ? "rotate(90deg)" : undefined,
          transformOrigin: "center center",
          // 9-6-W — filter follows the card's painted alpha so the
          // emphasis hugs the silhouette; the variable adapts per theme.
          filter: pick ? "var(--card-emphasis-filter)" : undefined,
        }}
      >
        {pick ? (
          showShimmer ? (
            <div
              className="animate-pulse"
              style={{
                width: "100%",
                height: "100%",
                background: "color-mix(in oklab, var(--color-foreground) 8%, transparent)",
                borderRadius: "var(--radius-sm)",
              }}
            />
          ) : (
            <img
              src={resolveForPick(pick) ?? undefined}
              alt={nameForPick(pick)}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  const a = img.naturalWidth / img.naturalHeight;
                  setPickAspects((prev) =>
                    prev[slotIndex] === a ? prev : { ...prev, [slotIndex]: a },
                  );
                }
              }}
              className="h-full w-full object-contain"
              style={{ transform: pick.isReversed ? "rotate(180deg)" : undefined }}
            />
          )
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[18px] font-light text-foreground/50">
            +
          </span>
        )}
      </button>
    );
  };

  if (spread === "celtic") {
    const colGap = Math.round(sizing.w * 0.35);
    const rowGap = Math.round(sizing.h * 0.18);
    const cellWithLabel = (i: number, label: string, rotated = false) => (
      <div className="flex flex-col items-center gap-1.5">
        <Slot pick={picks[i] ?? null} slotIndex={i} rotated={rotated} />
        {showLabels && (
          <PositionLabel
            cardWidth={sizing.w}
            fullName={label}
            description={descriptions[i] ?? null}
          >
            {label}
          </PositionLabel>
        )}
        {showLabels && picks[i] && (
          <CardNameLabel
            cardIndex={picks[i]!.cardIndex}
            isReversed={!!picks[i]!.isReversed}
            cardWidth={sizing.w}
            nameOverride={picks[i]!.cardName}
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
              <div
                className="relative flex items-center justify-center"
                style={{ width: sizing.w, height: sizing.h }}
              >
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ zIndex: 10 }}
                >
                  <Slot pick={picks[0] ?? null} slotIndex={0} />
                </div>
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ zIndex: 11 }}
                >
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
              {showLabels && (
                <PositionLabel
                  cardWidth={sizing.w}
                  fullName={labels[i] ?? null}
                  description={descriptions[i] ?? null}
                >
                  {labels[i] ?? null}
                </PositionLabel>
              )}
              {showLabels && picks[i] && (
                <CardNameLabel
                  cardIndex={picks[i]!.cardIndex}
                  isReversed={!!picks[i]!.isReversed}
                  cardWidth={sizing.w}
                  nameOverride={picks[i]!.cardName}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (spread === "three") {
    // Q48 Fix 1 — use the same viewport-responsive sizing as the
    // custom branch so a 3-card three spread and a 3-card custom
    // spread render identically. Avoids top-cropping when filled
    // card aspect ratios exceed sizing.w * 1.71.
    const cols = picks.length;
    const gap = 8;
    const sidePad = 48;
    const availW =
      typeof window !== "undefined"
        ? Math.min(Math.max(280, window.innerWidth - sidePad), MANUAL_ENTRY_CONTENT_MAX)
        : 320;
    // Q49 Fix 2 — cap cellW so desktop does not render giant cards;
    // use cellW * 2 so any reasonable card aspect fits without top-crop.
    const cellWRaw = Math.floor((availW - gap * (cols - 1)) / cols);
    const cellW = Math.min(cellWRaw, 120);
    // Q95 #1 — was cellW * 2 (too tall); 1.6 matches tarot 5:8 ratio
    // and removes empty space above/below the slot.
    const cardAreaH = Math.round(cellW * 1.6);
    return (
      <div
        style={{
          width: "max-content",
          maxWidth: "100%",
          margin: "0 auto",
          overflow: "visible",
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
            gap: `${gap}px`,
            alignItems: "end",
            width: "max-content",
            marginBottom: 12,
          }}
        >
          {picks.map((pick, i) => (
            <div
              key={`card-${i}`}
              style={{
                height: cardAreaH,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
              }}
            >
              <Slot pick={pick} slotIndex={i} cellWidth={cellW} />
            </div>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
            gap: `${gap}px`,
            alignItems: "start",
            width: "max-content",
            marginBottom: 8,
          }}
        >
          {picks.map((pick, i) => (
            <div
              key={`label-${i}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                minHeight: 48,
              }}
            >
              {showLabels && labels[i] && (
                <PositionLabel
                  cardWidth={cellW}
                  fullName={labels[i]}
                  description={descriptions[i] ?? null}
                >
                  {labels[i]}
                </PositionLabel>
              )}
              {showLabels && pick && (
                <CardNameLabel
                  cardIndex={pick.cardIndex}
                  isReversed={!!pick.isReversed}
                  cardWidth={cellW}
                  nameOverride={pick.cardName}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (spread === "custom") {
    // Q39 Fix 3 — deterministic 1-10 card grid. Cards bottom-anchored to a
    // shared floor; labels in a separate row aligned to the same top.
    const cols = picks.length <= 5 ? picks.length : Math.ceil(picks.length / 2);
    const gap = 8;
    const sidePad = 48; // 16px each side + 8px safety margin each side
    const availW =
      typeof window !== "undefined"
        ? Math.min(Math.max(280, window.innerWidth - sidePad), MANUAL_ENTRY_CONTENT_MAX)
        : 320;
    const cellWRaw = Math.floor((availW - gap * (cols - 1)) / cols);
    const cellW = Math.min(cellWRaw, 120);
    // Q95 #1 — was cellW * 2 (too tall); 1.6 matches tarot card aspect.
    const cardAreaH = Math.round(cellW * 1.6);
    const rows: ManualSlotPick[][] = [];
    if (picks.length <= 5) {
      rows.push(picks);
    } else {
      rows.push(picks.slice(0, cols));
      rows.push(picks.slice(cols));
    }
    return (
      <div
        style={{
          width: "max-content",
          maxWidth: "100%",
          margin: "0 auto",
          overflow: "visible",
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 12,
        }}
      >
        {rows.map((rowPicks, rowIdx) => {
          const offset = rowIdx * cols;
          return (
            <div key={`row-${rowIdx}`}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
                  gap: `${gap}px`,
                  alignItems: "end",
                  width: "max-content",
                  // Q95 #1 — was 12; tighter so multi-row custom spreads
                  // don't show a canyon between row 1 and row 2.
                  marginBottom: 4,
                }}
              >
                {rowPicks.map((pick, idx) => {
                  const absIdx = offset + idx;
                  return (
                    <div
                      key={`card-${absIdx}`}
                      style={{
                        height: cardAreaH,
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                      }}
                    >
                      <Slot pick={pick} slotIndex={absIdx} cellWidth={cellW} />
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
                  gap: `${gap}px`,
                  alignItems: "start",
                  width: "max-content",
                  marginBottom: 8,
                }}
              >
                {rowPicks.map((pick, idx) => {
                  const absIdx = offset + idx;
                  return (
                    <div
                      key={`label-${absIdx}`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        minHeight: 48,
                      }}
                    >
                      {/* CF — numeric "Card N" position labels removed. */}
                      {showLabels && pick && (
                        <CardNameLabel
                          cardIndex={pick.cardIndex}
                          isReversed={!!pick.isReversed}
                          cardWidth={cellW}
                          nameOverride={pick.cardName}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // single / daily / yes_no
  return (
    <div className="flex flex-col items-center gap-3">
      <Slot pick={picks[0] ?? null} slotIndex={0} />
      <div
        style={{
          minHeight: 48,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        {showLabels && labels[0] && (
          <PositionLabel
            cardWidth={sizing.w}
            fullName={labels[0]}
            description={descriptions[0] ?? null}
          >
            {labels[0]}
          </PositionLabel>
        )}
        {showLabels && picks[0] && (
          <CardNameLabel
            cardIndex={picks[0]!.cardIndex}
            isReversed={!!picks[0]!.isReversed}
            cardWidth={sizing.w}
            nameOverride={picks[0]!.cardName}
          />
        )}
      </div>
    </div>
  );
}
