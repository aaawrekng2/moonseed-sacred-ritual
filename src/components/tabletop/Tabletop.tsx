import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { buildScatter, shuffleDeck, type ScatterCard } from "@/lib/scatter";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { cn } from "@/lib/utils";

const TABLETOP_CONFIG = {
  CARD_ASPECT_RATIO: 1.75,
  CARD_MAX_ROTATION: 8,
  SCATTER_PADDING: 10,
  SELECTION_GLOW_SPREAD: 6,
  SELECTION_GLOW_OPACITY: 0.8,
  REVEAL_ANIMATION_MS: 600,
  REVEAL_STAGGER_MS: 100,
  DECK_SIZE: 78,
};

// Responsive card width: 42px mobile, 52px tablet, 64px desktop.
function responsiveCardWidth(viewportW: number): number {
  if (viewportW < 768) return 42;
  if (viewportW < 1024) return 52;
  return 64;
}

/**
 * Adaptive max rotation: on very narrow portrait widths the rotated bounding
 * box of a card eats meaningful horizontal real-estate, making the scatter
 * feel cramped. Scale the tilt down smoothly so layouts stay spacious and
 * never approach the clip boundary.
 *
 * Curve (linear interp on width):
 *   ≤320px → 4°   (worst-case small phones, e.g. iPhone SE)
 *    360px → 5°
 *    390px → 6°
 *    480px → 7°
 *   ≥640px → CARD_MAX_ROTATION (8°)
 */
export function adaptiveMaxRotation(viewportW: number, base: number): number {
  if (viewportW >= 640) return base;
  if (viewportW <= 320) return Math.min(base, 4);
  // Linear ramp from (320, 4) to (640, base).
  const t = (viewportW - 320) / (640 - 320);
  const value = 4 + (base - 4) * t;
  // Round to nearest 0.5° to keep values stable across small width changes.
  return Math.round(value * 2) / 2;
}

/**
 * Compute the invisible hit-area inset around each card so the effective
 * touch target reaches an Apple-HIG-friendly minimum width regardless of
 * how small the rendered card is. Coarse pointers (touch) target 44px min;
 * fine pointers (mouse) target ~28px and never inset more than 8px.
 *
 * Returns CSS pixels (positive number). The card-hit element negates this
 * for `inset`, so a value of 12 means the hit area extends 12px on every
 * side of the visible card.
 */
export function adaptiveHitInset(
  cardW: number,
  isCoarsePointer: boolean,
): number {
  const targetMin = isCoarsePointer ? 44 : 28;
  const expansion = Math.max(0, (targetMin - cardW) / 2);
  // Clamp so the hit area never grows so large it overlaps neighbours.
  const cap = isCoarsePointer ? 16 : 8;
  return Math.min(cap, Math.round(expansion));
}

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
  // Bumped each time the user "stirs" the table. Used to derive a fresh
  // scatter seed for unselected cards while preserving selected ones.
  const [stirNonce, setStirNonce] = useState(0);
  const { opacity: restingOpacityPct } = useRestingOpacity();
  const restingAlpha = restingOpacityPct / 100;
  const exitAlpha = Math.min(1, restingAlpha + 0.1);

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

  const cardW = responsiveCardWidth(size?.w ?? 0);
  const cardH = Math.round(cardW * TABLETOP_CONFIG.CARD_ASPECT_RATIO);
  const maxRotation = adaptiveMaxRotation(
    size?.w ?? 0,
    TABLETOP_CONFIG.CARD_MAX_ROTATION,
  );

  // Detect coarse pointer once (and on media-query change) so we can scale
  // the hit area appropriately. Defaults to true on first render so SSR /
  // pre-mount touches still feel generous.
  const [isCoarsePointer, setIsCoarsePointer] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const hitInset = adaptiveHitInset(cardW, isCoarsePointer);

  // Initial scatter — only depends on session seed + geometry, NOT stirNonce,
  // so resizing or first-mount doesn't wipe the user's selections.
  const initialScatter = useMemo(() => {
    if (!size) return [] as ScatterCard[];
    return buildScatter({
      width: size.w,
      height: size.h,
      count: TABLETOP_CONFIG.DECK_SIZE,
      cardWidth: cardW,
      cardHeight: cardH,
      maxRotation,
      padding: TABLETOP_CONFIG.SCATTER_PADDING,
      seed,
    });
  }, [size, seed, cardW, cardH, maxRotation]);

  // Map slot index -> tarot card id (shuffled at session start).
  const deckMapping = useMemo(
    () => shuffleDeck(TABLETOP_CONFIG.DECK_SIZE, seed),
    [seed],
  );

  const [cards, setCards] = useState<CardState[]>([]);

  // Reset / rebuild whenever the underlying scatter geometry changes
  // (mount, resize, breakpoint change). Stir is handled separately so it
  // can preserve selected cards.
  useEffect(() => {
    if (initialScatter.length === 0) return;
    setCards(
      initialScatter.map((s) => ({
        ...s,
        selectionOrder: null,
        revealed: false,
      })),
    );
  }, [initialScatter]);

  // Stir: rebuild scatter for unselected cards only. Selected cards keep
  // their position, rotation, z-order, and slot number untouched.
  useEffect(() => {
    if (stirNonce === 0) return;
    if (!size) return;
    setCards((prev) => {
      if (prev.length === 0) return prev;
      const fresh = buildScatter({
        width: size.w,
        height: size.h,
        count: TABLETOP_CONFIG.DECK_SIZE,
        cardWidth: cardW,
        cardHeight: cardH,
        maxRotation,
        padding: TABLETOP_CONFIG.SCATTER_PADDING,
        seed: (seed ^ (stirNonce * 0x9e3779b9)) >>> 0,
      });
      // Use the fresh scatter slots in order to re-place each unselected card.
      let cursor = 0;
      return prev.map((c) => {
        if (c.selectionOrder !== null) return c; // preserve selected exactly
        const next = fresh[cursor++ % fresh.length];
        return {
          ...c,
          x: next.x,
          y: next.y,
          rotation: next.rotation,
          z: next.z,
        };
      });
    });
  }, [stirNonce, size, cardW, cardH, maxRotation, seed]);

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

  // Apply a one-directional change (select-only or deselect-only) used by
  // swipe gestures so dragging across cards never thrashes their state.
  const applyDirectional = useCallback(
    (id: number, mode: "select" | "deselect") => {
      if (revealing || revealedAll) return;
      setCards((prev) => {
        const target = prev.find((c) => c.id === id);
        if (!target) return prev;
        const currentlySelected = target.selectionOrder !== null;
        if (mode === "select") {
          if (currentlySelected) return prev;
          const used = prev.filter((c) => c.selectionOrder !== null).length;
          if (used >= required) return prev;
          return prev.map((c) =>
            c.id === id ? { ...c, selectionOrder: used + 1 } : c,
          );
        }
        // deselect
        if (!currentlySelected) return prev;
        const removedOrder = target.selectionOrder!;
        return prev.map((c) => {
          if (c.id === id) return { ...c, selectionOrder: null };
          if (c.selectionOrder !== null && c.selectionOrder > removedOrder) {
            return { ...c, selectionOrder: c.selectionOrder - 1 };
          }
          return c;
        });
      });
    },
    [required, revealing, revealedAll],
  );

  // ---- Swipe / drag selection ---------------------------------------------
  // Track gesture state in a ref so handlers stay stable and don't re-render
  // mid-drag. We resolve which card is under the pointer via elementFromPoint
  // + a `data-card-id` attribute on each CardSlot.
  const gestureRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    moved: boolean; // crossed the drag threshold
    mode: "select" | "deselect" | null;
    visited: Set<number>;
    startCardId: number | null;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    moved: false,
    mode: null,
    visited: new Set(),
    startCardId: null,
  });

  const DRAG_THRESHOLD_PX = 8;

  const cardIdAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const slot = el.closest<HTMLElement>("[data-card-id]");
    if (!slot) return null;
    const raw = slot.dataset.cardId;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const onContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (revealing || revealedAll) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const id = cardIdAtPoint(e.clientX, e.clientY);
    if (id == null) return;
    const startCard = cards.find((c) => c.id === id);
    if (!startCard) return;
    gestureRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      // Intent locks based on starting card. A drag from a selected card
      // deselects everything it crosses; a drag from a face-down card selects.
      mode: startCard.selectionOrder !== null ? "deselect" : "select",
      visited: new Set(),
      startCardId: id,
    };
    // Capture so we keep getting move events even if the pointer leaves.
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId !== e.pointerId) return;

    if (!g.moved) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      g.moved = true;
      // Once we cross the threshold, apply the action to the starting card so
      // the gesture has immediate visible feedback.
      if (g.startCardId != null && g.mode) {
        g.visited.add(g.startCardId);
        applyDirectional(g.startCardId, g.mode);
      }
    }

    const id = cardIdAtPoint(e.clientX, e.clientY);
    if (id == null || g.visited.has(id) || !g.mode) return;
    g.visited.add(id);
    applyDirectional(id, g.mode);
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (g.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore — capture may already be released
    }
    gestureRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      moved: false,
      mode: null,
      visited: new Set(),
      startCardId: null,
    };
  };

  // Lets CardSlot's onClick know to ignore the synthetic click at the end of
  // a drag (so a swipe doesn't double-toggle the starting card).
  const wasDraggingRef = useRef(false);
  const onContainerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    wasDraggingRef.current = g.moved;
    // If the gesture never crossed the drag threshold, treat it as a tap
    // and toggle the starting card. Required because the container uses
    // setPointerCapture, which prevents the inner <button>'s click event
    // from firing reliably (especially with mouse on desktop).
    if (!g.moved && g.startCardId != null && !revealing && !revealedAll) {
      toggleSelect(g.startCardId);
      // Suppress the synthetic click that may follow so we don't double-toggle.
      wasDraggingRef.current = true;
    }
    endGesture(e);
  };
  const shouldSuppressClick = () => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return true;
    }
    return false;
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
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden touch-none select-none"
        onPointerDown={onContainerPointerDown}
        onPointerMove={onContainerPointerMove}
        onPointerUp={onContainerPointerUp}
        onPointerCancel={endGesture}
      >
        {cards.map((c, idx) => (
          <CardSlot
            key={c.id}
            card={c}
            cardW={cardW}
            cardH={cardH}
            cardBack={cardBack}
            faceIndex={deckMapping[c.id]}
            disabled={revealing || revealedAll}
            hitInset={hitInset}
            onSelect={() => {
              if (shouldSuppressClick()) return;
              toggleSelect(c.id);
            }}
            settleDelay={Math.min(idx * 4, 320)}
          />
        ))}
      </div>

      {/* Reveal bar */}
      <div
        className="flex flex-col items-center justify-center gap-2 px-6 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
      >
        {!revealedAll && (
          <span
            className="font-display text-[11px] uppercase tracking-[0.25em] text-gold/70"
            aria-live="polite"
          >
            {selectedCount} / {required} selected
          </span>
        )}
        {!revealedAll && (
          <button
            type="button"
            onClick={handleReveal}
            disabled={!ready || revealing}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full border px-6 py-3 font-display text-sm uppercase tracking-[0.25em] transition-all",
              "disabled:cursor-not-allowed",
              ready && !revealing
                ? "border-gold/60 bg-gold/10 text-gold animate-reveal-pulse"
                : "border-border/50 bg-card/30 text-muted-foreground/60",
            )}
            aria-busy={revealing}
          >
            {revealing && (
              <Loader2
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            <span>
              {revealing
                ? "Revealing…"
                : `Reveal ${required > 1 ? required + " cards" : "card"}`}
            </span>
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
  hitInset,
  onSelect,
  settleDelay,
}: {
  card: CardState;
  cardW: number;
  cardH: number;
  cardBack: CardBackId;
  faceIndex: number;
  disabled: boolean;
  hitInset: number;
  onSelect: () => void;
  settleDelay: number;
}) {
  const isSelected = card.selectionOrder !== null;
  const glow = `0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD}px var(--gold)`;

  // Re-trigger the tap micro-animation on every click by toggling a key.
  const [tapTick, setTapTick] = useState(0);
  const handleClick = () => {
    setTapTick((t) => t + 1);
    onSelect();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled && !card.revealed}
      data-card-id={card.id}
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
        // Remove default tap highlight on iOS / Android.
        "[-webkit-tap-highlight-color:transparent] touch-manipulation",
        isSelected ? "z-30" : null,
      )}
      style={{
        left: card.x,
        top: card.y,
        width: cardW,
        height: cardH,
        transform: `rotate(${card.rotation}deg) translateY(${isSelected ? "-4px" : "0"})`,
        // Selected cards (and their numbered badges) must always sit above
        // every unselected card. Use a large constant well above any
        // possible scatter z value.
        zIndex: isSelected ? 1000 + (card.selectionOrder ?? 0) : card.z + 1,
        animation: `settle-in 320ms ease-out both`,
        animationDelay: `${settleDelay}ms`,
        // Drives the .card-hit element's inset via a CSS variable so the
        // touch target scales with the rendered card size.
        ["--card-hit-inset" as string]: `${hitInset}px`,
      }}
    >
      {/* Invisible expanded hit area for easier tapping on mobile. */}
      <span aria-hidden="true" className="card-hit" />
      <div
        key={tapTick}
        className={cn(
          "relative h-full w-full rounded-[10px] flip-3d",
          card.revealed && "is-flipped",
          tapTick > 0 && !card.revealed && "animate-card-tap",
        )}
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