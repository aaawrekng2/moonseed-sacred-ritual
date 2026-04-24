import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { buildScatter, shuffleDeck, type ScatterCard } from "@/lib/scatter";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import {
  MAX_RESTING_OPACITY,
  MIN_RESTING_OPACITY,
  useRestingOpacity,
} from "@/lib/use-resting-opacity";
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
  // True for the duration of the stir animation. Drives the tabletop tilt
  // overlay and toggles a position-transition class on unselected cards so
  // they drift to their new slots instead of snapping.
  const [stirring, setStirring] = useState(false);
  const stirTimerRef = useRef<number | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealedAll, setRevealedAll] = useState(false);
  const { opacity: restingOpacityPct, setOpacity: setRestingOpacity } =
    useRestingOpacity();
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
  // Always use the full ±CARD_MAX_ROTATION range so no card sits axis-aligned.
  const maxRotation = TABLETOP_CONFIG.CARD_MAX_ROTATION;

  // No-spawn zone for the top-right close button. Slightly larger than the
  // visible 44×44 hit area so even rotated cards stay clear of it.
  const exclusionZones = useMemo(() => {
    if (!size) return [] as { x: number; y: number; w: number; h: number }[];
    const zoneW = 80;
    const zoneH = 80;
    return [
      { x: Math.max(0, size.w - zoneW), y: 0, w: zoneW, h: zoneH },
    ];
  }, [size]);

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
      exclusionZones,
      minVisibleRatio: 0.3,
    });
  }, [size, seed, cardW, cardH, maxRotation, exclusionZones]);

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
        exclusionZones,
        minVisibleRatio: 0.3,
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
  }, [stirNonce, size, cardW, cardH, maxRotation, seed, exclusionZones]);

  const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
  const ready = selectedCount === required;

  const triggerStir = useCallback(() => {
    if (revealing || revealedAll) return;
    setStirring(true);
    setStirNonce((n) => n + 1);
    if (stirTimerRef.current != null) {
      window.clearTimeout(stirTimerRef.current);
    }
    stirTimerRef.current = window.setTimeout(() => {
      setStirring(false);
      stirTimerRef.current = null;
    }, 760);
  }, [revealing, revealedAll]);

  useEffect(() => {
    return () => {
      if (stirTimerRef.current != null) {
        window.clearTimeout(stirTimerRef.current);
      }
    };
  }, []);

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

  // ---- Tap-only selection -------------------------------------------------
  // Per design: only a deliberate single tap selects/deselects a card. Swipes
  // (drags across cards) must never alter selection state. We implement this
  // per-card on the CardSlot button, tracking the pointer-down position and
  // ignoring the click if the pointer moved beyond a small threshold.
  const TAP_MOVE_THRESHOLD_PX = 8;

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
      {/* Minimal exit affordance — single zen X in the top-right. */}
      <button
        type="button"
        onClick={handleExit}
        aria-label="Close tabletop"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: "calc(env(safe-area-inset-right, 0px) + 16px)",
          opacity: exitAlpha,
        }}
        className="absolute z-50 flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        {/* Invisible hit-area expansion so the effective touch target meets
            Apple HIG / Material's 44–48px minimum even though the visible
            glyph stays small and zen. */}
        <span aria-hidden="true" className="absolute -inset-2" />
        <X className="h-5 w-5" strokeWidth={1.5} />
      </button>

      {/* Tabletop scatter area */}
      <div
        ref={containerRef}
        className={cn(
          "relative flex-1 overflow-hidden select-none",
          stirring && "animate-tabletop-tilt",
        )}
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
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
            stirring={stirring && c.selectionOrder === null}
            tapMoveThresholdPx={TAP_MOVE_THRESHOLD_PX}
            onSelect={() => toggleSelect(c.id)}
            settleDelay={Math.min(idx * 4, 320)}
          />
        ))}
        {stirring && (
          <span
            aria-hidden="true"
            className="tabletop-shimmer-overlay"
          />
        )}
      </div>

      {/* Bottom zen bar: status whisper + soft reveal + stir affordance.
          Sits at resting opacity so nothing competes with the cards. */}
      <div
        className="relative flex flex-col items-center justify-center gap-3 pt-2"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          paddingLeft: "calc(env(safe-area-inset-left, 0px) + 24px)",
          paddingRight: "calc(env(safe-area-inset-right, 0px) + 24px)",
        }}
      >
        {/* Temporary resting-opacity test slider — mirrors the home screen
            control so this value can be tuned in-context on the tabletop. */}
        <div
          style={{
            position: "absolute",
            right: "calc(env(safe-area-inset-right, 0px) + 16px)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            width: 130,
            zIndex: 20,
            opacity: restingAlpha,
          }}
        >
          <label
            htmlFor="tabletop-resting-opacity"
            style={{
              fontSize: 9,
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Opacity {restingOpacityPct}
          </label>
          <input
            id="tabletop-resting-opacity"
            type="range"
            min={MIN_RESTING_OPACITY}
            max={MAX_RESTING_OPACITY}
            value={restingOpacityPct}
            onChange={(e) => setRestingOpacity(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--gold)" }}
          />
        </div>

        {/* Stir — anchored bottom-left at resting opacity. Single, quiet word. */}
        {!revealedAll && (
          <button
            type="button"
            onClick={triggerStir}
            disabled={revealing || stirring}
            aria-label="Stir — rearrange unselected cards"
            style={{
              opacity: restingAlpha,
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
              left: "calc(env(safe-area-inset-left, 0px) + 20px)",
            }}
            className="absolute inline-flex items-center gap-1.5 font-display text-[11px] uppercase tracking-[0.3em] text-gold/80 transition-opacity hover:!opacity-100 focus:!opacity-100 focus:outline-none disabled:cursor-not-allowed"
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            Stir
          </button>
        )}

        {/* Centered whisper. When the spread is incomplete, this is a quiet
            status line ("Choose N more"). Once all picks are made it morphs
            into a soft pill that taps to reveal — same scale, same opacity,
            no bold UI screaming for attention. */}
        {!revealedAll && (
          ready ? (
            <button
              type="button"
              onClick={handleReveal}
              disabled={revealing}
              aria-busy={revealing}
              aria-live="polite"
              style={{ opacity: restingAlpha }}
              className={cn(
                "inline-flex items-center justify-center gap-2",
                "rounded-full border border-gold/30 px-5 py-1.5",
                "font-display text-[10px] uppercase tracking-[0.4em] text-gold",
                "transition-opacity hover:!opacity-100 focus:!opacity-100",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/40",
                "disabled:cursor-not-allowed",
              )}
            >
              {revealing && (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              )}
              <span>{revealing ? "Revealing" : "Reveal"}</span>
            </button>
          ) : (
            <span
              className="font-display text-[10px] uppercase tracking-[0.4em] text-foreground"
              style={{ opacity: restingAlpha }}
              aria-live="polite"
            >
              {`Choose ${required - selectedCount} more`}
            </span>
          )
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
  stirring,
  onSelect,
  settleDelay,
  tapMoveThresholdPx,
}: {
  card: CardState;
  cardW: number;
  cardH: number;
  cardBack: CardBackId;
  faceIndex: number;
  disabled: boolean;
  hitInset: number;
  stirring: boolean;
  onSelect: () => void;
  settleDelay: number;
  tapMoveThresholdPx: number;
}) {
  const isSelected = card.selectionOrder !== null;
  const glow = `0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD}px var(--gold)`;

  // Re-trigger the tap micro-animation on every click by toggling a key.
  const [tapTick, setTapTick] = useState(0);
  // Track pointer-down position so we can distinguish a deliberate tap from
  // a swipe / drag. Any movement past `tapMoveThresholdPx` cancels the tap
  // and the click handler bails out — selection only changes on real taps.
  const downPosRef = useRef<{ x: number; y: number; cancelled: boolean } | null>(
    null,
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    downPosRef.current = { x: e.clientX, y: e.clientY, cancelled: false };
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = downPosRef.current;
    if (!d || d.cancelled) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (dx * dx + dy * dy > tapMoveThresholdPx * tapMoveThresholdPx) {
      d.cancelled = true;
    }
  };
  const handleClick = () => {
    const d = downPosRef.current;
    downPosRef.current = null;
    if (d?.cancelled) return; // swipe — never selects
    setTapTick((t) => t + 1);
    onSelect();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerCancel={() => {
        if (downPosRef.current) downPosRef.current.cancelled = true;
      }}
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
        // While stirring, animate left/top/transform together so the card
        // drifts to its new scatter slot. Otherwise keep the snappier
        // transform-only transition for selection feedback.
        stirring
          ? "card-stir-transition"
          : "transition-transform duration-200 ease-out",
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
          stirring && !card.revealed && "animate-card-stir-glide",
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