import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { buildScatter, shuffleDeck, type ScatterCard } from "@/lib/scatter";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { cn } from "@/lib/utils";

const TABLETOP_CONFIG = {
  CARD_WIDTH: 44,
  CARD_ASPECT_RATIO: 1.75,
  CARD_MAX_ROTATION: 8,
  SCATTER_PADDING: 8,
  SELECTION_GLOW_SPREAD: 8,
  SELECTION_GLOW_OPACITY: 0.8,
  REVEAL_ANIMATION_MS: 600,
  REVEAL_STAGGER_MS: 100,
  DECK_SIZE: 78,
};

type TabletopProps = {
  spread: SpreadMode;
  onExit: () => void;
  onComplete: (picks: { id: number; cardIndex: number }[]) => void;
};

type CardState = ScatterCard & {
  selectionOrder: number | null;
  revealed: boolean;
};

export function Tabletop({ spread, onExit, onComplete }: TabletopProps) {
  const meta = SPREAD_META[spread];
  const required = meta.count;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);

  // Read selected card back once on mount.
  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  // Measure container — drives scatter geometry.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardW = TABLETOP_CONFIG.CARD_WIDTH;
  const cardH = Math.round(cardW * TABLETOP_CONFIG.CARD_ASPECT_RATIO);

  const scatter = useMemo(() => {
    if (!size) return [] as ScatterCard[];
    return buildScatter({
      width: size.w,
      height: size.h,
      count: TABLETOP_CONFIG.DECK_SIZE,
      cardWidth: cardW,
      cardHeight: cardH,
      maxRotation: TABLETOP_CONFIG.CARD_MAX_ROTATION,
      padding: TABLETOP_CONFIG.SCATTER_PADDING,
      seed,
    });
  }, [size, seed, cardW, cardH]);

  // Map slot index -> tarot card id (shuffled at session start).
  const deckMapping = useMemo(
    () => shuffleDeck(TABLETOP_CONFIG.DECK_SIZE, seed),
    [seed],
  );

  const [cards, setCards] = useState<CardState[]>([]);

  useEffect(() => {
    if (scatter.length === 0) return;
    setCards(
      scatter.map((s) => ({ ...s, selectionOrder: null, revealed: false })),
    );
  }, [scatter]);

  const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
  const ready = selectedCount === required;
  const [revealing, setRevealing] = useState(false);
  const [revealedAll, setRevealedAll] = useState(false);

  const toggleSelect = (id: number) => {
    if (revealing || revealedAll) return;
    setCards((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      if (target.selectionOrder !== null) {
        const removedOrder = target.selectionOrder;
        return prev.map((c) => {
          if (c.id === id) return { ...c, selectionOrder: null };
          if (c.selectionOrder !== null && c.selectionOrder > removedOrder) {
            return { ...c, selectionOrder: c.selectionOrder - 1 };
          }
          return c;
        });
      }
      const used = prev.filter((c) => c.selectionOrder !== null).length;
      if (used >= required) return prev;
      return prev.map((c) =>
        c.id === id ? { ...c, selectionOrder: used + 1 } : c,
      );
    });
  };

  const handleReveal = () => {
    if (!ready || revealing) return;
    setRevealing(true);
    const picks = cards
      .filter((c) => c.selectionOrder !== null)
      .sort((a, b) => (a.selectionOrder ?? 0) - (b.selectionOrder ?? 0));

    // Pause for the sacred moment, then flip in selection order.
    window.setTimeout(() => {
      picks.forEach((p, i) => {
        window.setTimeout(() => {
          setCards((prev) =>
            prev.map((c) => (c.id === p.id ? { ...c, revealed: true } : c)),
          );
        }, i * TABLETOP_CONFIG.REVEAL_STAGGER_MS);
      });
      const total =
        picks.length * TABLETOP_CONFIG.REVEAL_STAGGER_MS +
        TABLETOP_CONFIG.REVEAL_ANIMATION_MS +
        300;
      window.setTimeout(() => {
        setRevealedAll(true);
        onComplete(
          picks.map((p) => ({ id: p.id, cardIndex: deckMapping[p.id] })),
        );
      }, total);
    }, 200);
  };

  const handleExit = () => {
    if (selectedCount > 0 && !revealedAll) {
      const ok = window.confirm("Leave this reading? Your selections will be lost.");
      if (!ok) return;
    }
    onExit();
  };

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_30%,rgba(60,40,90,0.35),transparent_70%)]">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
      >
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-[0.3em] text-gold/80">
            {meta.label}
          </span>
          <span className="font-display text-sm text-foreground/80">
            {revealedAll
              ? "Revealed"
              : ready
                ? "Ready to reveal"
                : `Choose ${required - selectedCount} more`}
          </span>
        </div>
        <button
          type="button"
          onClick={handleExit}
          aria-label="Close tabletop"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card/40 hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tabletop scatter area */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {cards.map((c, idx) => (
          <CardSlot
            key={c.id}
            card={c}
            cardW={cardW}
            cardH={cardH}
            cardBack={cardBack}
            faceIndex={deckMapping[c.id]}
            disabled={revealing || revealedAll}
            onSelect={() => toggleSelect(c.id)}
            settleDelay={Math.min(idx * 4, 320)}
          />
        ))}
      </div>

      {/* Reveal bar */}
      <div
        className="flex items-center justify-center px-6 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        {!revealedAll && (
          <button
            type="button"
            onClick={handleReveal}
            disabled={!ready || revealing}
            className={cn(
              "rounded-full border px-6 py-3 font-display text-sm uppercase tracking-[0.25em] transition-all",
              ready && !revealing
                ? "border-gold/60 bg-gold/10 text-gold animate-reveal-pulse"
                : "border-border/50 bg-card/30 text-muted-foreground/60",
            )}
          >
            {revealing ? "Revealing…" : `Reveal ${required > 1 ? required + " cards" : "card"}`}
          </button>
        )}
      </div>
    </div>
  );
}

function CardSlot({
  card,
  cardW,
  cardH,
  cardBack,
  faceIndex,
  disabled,
  onSelect,
  settleDelay,
}: {
  card: CardState;
  cardW: number;
  cardH: number;
  cardBack: CardBackId;
  faceIndex: number;
  disabled: boolean;
  onSelect: () => void;
  settleDelay: number;
}) {
  const isSelected = card.selectionOrder !== null;
  const glow = `0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD}px var(--gold)`;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled && !card.revealed}
      aria-label={
        card.revealed
          ? `Revealed: ${getCardName(faceIndex)}`
          : isSelected
            ? `Selected position ${card.selectionOrder}`
            : "Face-down card"
      }
      className={cn(
        "absolute outline-none focus-visible:ring-2 focus-visible:ring-gold/70",
        "transition-transform duration-200 ease-out",
        isSelected ? "z-30" : null,
      )}
      style={{
        left: card.x,
        top: card.y,
        width: cardW,
        height: cardH,
        transform: `rotate(${card.rotation}deg) translateY(${isSelected ? "-4px" : "0"})`,
        zIndex: isSelected ? 40 : card.z + 1,
        animation: `settle-in 320ms ease-out both`,
        animationDelay: `${settleDelay}ms`,
      }}
    >
      <div
        className={cn("relative h-full w-full rounded-[10px] flip-3d", card.revealed && "is-flipped")}
        style={{
          // @ts-expect-error custom prop
          "--flip-ms": `${TABLETOP_CONFIG.REVEAL_ANIMATION_MS}ms`,
          boxShadow: isSelected
            ? `${glow}, 0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD * 2}px var(--gold)`
            : "0 4px 12px rgba(0,0,0,0.4)",
          opacity: isSelected ? TABLETOP_CONFIG.SELECTION_GLOW_OPACITY + 0.2 : 1,
        }}
      >
        <div className="flip-face back">
          <CardBack id={cardBack} width={cardW} className="h-full w-full" />
        </div>
        <div className="flip-face front overflow-hidden rounded-[10px] border border-gold/40 bg-card">
          {card.revealed ? (
            <img
              src={getCardImagePath(faceIndex)}
              alt={getCardName(faceIndex)}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                // Fallback: show the card name on a dark surface if face image is missing.
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-1 text-center">
            <span className="font-display text-[8px] leading-tight text-foreground/70">
              {getCardName(faceIndex)}
            </span>
          </div>
        </div>
      </div>
      {isSelected && !card.revealed && (
        <span
          className="pointer-events-none absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-background"
          style={{ transform: `rotate(${-card.rotation}deg)` }}
        >
          {card.selectionOrder}
        </span>
      )}
    </button>
  );
}