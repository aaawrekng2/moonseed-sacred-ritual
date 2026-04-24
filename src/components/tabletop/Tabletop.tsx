import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { buildScatter, shuffleDeck, type ScatterCard } from "@/lib/scatter";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, spreadUsesSlots, type SpreadMode } from "@/lib/spreads";
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
  // Slow, ceremonial flip — long enough to feel reverent without
  // dragging. Paired with sacred-reveal-lift in styles.css.
  REVEAL_ANIMATION_MS: 1100,
  // Cards reveal simultaneously when the user taps Reveal — staggered
  // entrance broke the "ceremonial all-at-once" feel of multi-card spreads.
  REVEAL_STAGGER_MS: 0,
  FLIGHT_MS: 420,
  DECK_SIZE: 78,
  /**
   * Mobile breakpoint (CSS px). Below this the layout switches to:
   *   - Slot rail anchored at the very bottom of the screen.
   *   - Stir / counter / X arranged on a thinner row above it.
   *   - Opacity slider hidden (desktop dev tool only).
   */
  MOBILE_BREAKPOINT: 768,
};

// Responsive card width: 42px mobile, 52px tablet, 64px desktop.
function responsiveCardWidth(viewportW: number): number {
  if (viewportW < 768) return 42;
  if (viewportW < 1024) return 52;
  return 64;
}

/**
 * Per-spread slot dimensions. Slots are sized differently from the table
 * cards because the rail must fit a fixed number of positions in one row
 * with no horizontal scrolling, even on narrow phones (10 for Celtic).
 *
 * Returns the visible slot card width — height is derived from
 * CARD_ASPECT_RATIO.
 */
function responsiveSlotWidth(viewportW: number, count: number): number {
  const isMobile = viewportW < TABLETOP_CONFIG.MOBILE_BREAKPOINT;
  if (count <= 3) {
    // Three-card spread: roomy slots both layouts.
    return isMobile ? 48 : 72;
  }
  if (count >= 10) {
    // Celtic Cross: 10 slots must fit in a single non-scrolling row. Sizes
    // chosen so 10 * (slotW + gap) stays inside common viewport widths.
    if (isMobile) {
      // Aim for ≤360px of rail on a 390px viewport (room for safe-area).
      // 10 slots × 28 + 9 gaps × 4 ≈ 316px → comfortably fits.
      return 28;
    }
    return 44;
  }
  // Fallback for any future spread with 4–9 cards.
  return isMobile ? 38 : 56;
}

/**
 * Pick a random scatter spot for a card returning from a slot. Tries to
 * minimise overlap with existing un-rotated card rects so the returned
 * card is visible. Falls back to a random position if no roomy spot is
 * found within a few tries (the table is intentionally cluttered).
 */
function pickReturnSpot(
  cards: CardState[],
  excludeId: number,
  geo: {
    width: number;
    height: number;
    cardW: number;
    cardH: number;
    padding: number;
    maxRotation: number;
  },
): { x: number; y: number; rotation: number } {
  const others = cards.filter((c) => c.id !== excludeId);
  const maxX = Math.max(0, geo.width - geo.padding * 2 - geo.cardW);
  const maxY = Math.max(0, geo.height - geo.padding * 2 - geo.cardH);
  const tries = 20;
  let best: { x: number; y: number; coverage: number } | null = null;
  for (let i = 0; i < tries; i++) {
    const x = geo.padding + Math.random() * maxX;
    const y = geo.padding + Math.random() * maxY;
    let coverage = 0;
    for (const o of others) {
      const ow = Math.max(
        0,
        Math.min(x + geo.cardW, o.x + geo.cardW) - Math.max(x, o.x),
      );
      const oh = Math.max(
        0,
        Math.min(y + geo.cardH, o.y + geo.cardH) - Math.max(y, o.y),
      );
      coverage += ow * oh;
    }
    if (best === null || coverage < best.coverage) {
      best = { x, y, coverage };
      // Good enough — visible enough that we won't waste cycles searching.
      if (coverage < geo.cardW * geo.cardH * 0.4) break;
    }
  }
  const spot = best ?? { x: geo.padding, y: geo.padding, coverage: 0 };
  let rotation = (Math.random() * 2 - 1) * geo.maxRotation;
  if (Math.abs(rotation) < 1) rotation = rotation >= 0 ? 1 : -1;
  return { x: spot.x, y: spot.y, rotation };
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
  /**
   * Called when the reading is ready to display.
   *  - mode "reveal": user tapped Reveal first; cards are flipped face-up
   *    on the tabletop and the reading screen should open with cards
   *    already revealed.
   *  - mode "cast": user tapped Cast directly; cards remain face-down
   *    and the spread layout screen should let the user reveal them there.
   */
  onComplete: (
    picks: { id: number; cardIndex: number }[],
    mode: "reveal" | "cast",
  ) => void;
};

type CardState = ScatterCard & {
  selectionOrder: number | null;
  revealed: boolean;
};

export function Tabletop({ spread, onExit, onComplete }: TabletopProps) {
  const meta = SPREAD_META[spread];
  const required = meta.count;
  const usesSlots = spreadUsesSlots(spread);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Viewport-coordinate origin of the scatter container. Passed to
  // CardSlot so a card returning from a slot to the table can compute
  // its absolute landing point in viewport space (slot rects are in
  // viewport coords; scatter rects are in container coords).
  const [containerOrigin, setContainerOrigin] = useState<{ left: number; top: number } | null>(null);
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
  // Refs to each slot DOM element. Used to compute flight target rects in
  // viewport coordinates so a selected card can animate from its current
  // scatter position to its slot.
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Viewport-coordinate rect for each slot (id'd by slot index 0..N-1).
  // Re-measured on resize and when slot row mounts.
  const [slotRects, setSlotRects] = useState<Array<DOMRect | null>>([]);
  const { opacity: restingOpacityPct, setOpacity: setRestingOpacity } =
    useRestingOpacity();
  const restingAlpha = restingOpacityPct / 100;
  const exitAlpha = Math.min(1, restingAlpha + 0.1);

  // Dev-only overlap debug overlay. Visualises each card's visible-area
  // ratio so the 30% minimum visibility rule can be eyeballed at a glance.
  const [debugOverlap, setDebugOverlap] = useState(false);

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
      setContainerOrigin({ left: r.left, top: r.top });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardW = responsiveCardWidth(size?.w ?? 0);
  const cardH = Math.round(cardW * TABLETOP_CONFIG.CARD_ASPECT_RATIO);
  const isMobile = (size?.w ?? 0) < TABLETOP_CONFIG.MOBILE_BREAKPOINT;
  // Slot rail uses its own width (smaller on mobile / for many-slot
  // spreads) so all slots fit in one row without scrolling.
  // Slot dimensions: on desktop they match the table card exactly (per
  // design: empty slots read as full-size mirrors of the cards). On mobile
  // they shrink so a 10-slot Celtic rail still fits in one row.
  const slotW = isMobile ? responsiveSlotWidth(size?.w ?? 0, required) : cardW;
  const slotH = isMobile
    ? Math.round(slotW * TABLETOP_CONFIG.CARD_ASPECT_RATIO)
    : cardH;
  // On mobile, abbreviate position labels so the rail isn't cluttered.
  const slotLabels = (isMobile ? meta.positionsShort : meta.positions) ?? [];
  // Always use the full ±CARD_MAX_ROTATION range so no card sits axis-aligned.
  const maxRotation = TABLETOP_CONFIG.CARD_MAX_ROTATION;

  // The exit X now lives in the bottom bar (outside the scatter area), and
  // cards are explicitly allowed to scatter beneath the upper-left opacity
  // slider. No exclusion zones needed inside the scatter container.
  const exclusionZones = useMemo(
    () => [] as { x: number; y: number; w: number; h: number }[],
    [],
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
  // Once cards are initialized we never wipe selections automatically.
  // Subsequent geometry changes (e.g. the bottom bar growing/shrinking
  // when the slot rail collapses on Reveal) reflow the unselected cards
  // in place but preserve every selectionOrder and revealed flag.
  const initializedRef = useRef(false);

  // First mount: build the initial card array from the scatter. After that,
  // geometry changes only re-place unselected cards — never reset selections.
  // CRITICAL: a previous version reset every card on any `initialScatter`
  // change, which silently wiped the user's picks the moment the bottom bar
  // resized (e.g. when the slot rail collapsed once all cards were placed).
  useEffect(() => {
    if (initialScatter.length === 0) return;
    if (!initializedRef.current) {
      setCards(
        initialScatter.map((s) => ({
          ...s,
          selectionOrder: null,
          revealed: false,
        })),
      );
      initializedRef.current = true;
      setSlotRects(usesSlots ? Array(required).fill(null) : []);
      return;
    }
    // Subsequent geometry change — reflow unselected cards only.
    setCards((prev) => {
      if (prev.length === 0) {
        // Edge case: somehow lost the array; rebuild from scratch.
        return initialScatter.map((s) => ({
          ...s,
          selectionOrder: null,
          revealed: false,
        }));
      }
      let cursor = 0;
      return prev.map((c) => {
        if (c.selectionOrder !== null) return c; // never disturb a pick
        const next = initialScatter[cursor++ % initialScatter.length];
        return {
          ...c,
          x: next.x,
          y: next.y,
          rotation: next.rotation,
          z: next.z,
        };
      });
    });
  }, [initialScatter, usesSlots, required]);

  // Measure slot rects after layout (and on resize). Selected-card flight
  // animations read from these rects to compute their flight target.
  useEffect(() => {
    if (!usesSlots) return;
    const measure = () => {
      const next = slotRefs.current.map((el) =>
        el ? el.getBoundingClientRect() : null,
      );
      setSlotRects(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [usesSlots, size, required, cards.length]);

  // Re-measure slots whenever any selection changes (slot row may grow / re-flow).
  const selectionSig = cards.map((c) => c.selectionOrder ?? "_").join(",");
  useEffect(() => {
    if (!usesSlots) return;
    // Two ticks: layout pass + paint, then read.
    const id = window.requestAnimationFrame(() => {
      const next = slotRefs.current.map((el) =>
        el ? el.getBoundingClientRect() : null,
      );
      setSlotRects(next);
    });
    return () => window.cancelAnimationFrame(id);
  }, [usesSlots, selectionSig]);

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

  // Per-card visible-area ratio (0–1), derived from current card positions
  // and the same overlap heuristic used by buildScatter's enforcement pass.
  // Only computed when the debug overlay is on.
  const visibilityByCardId = useMemo(() => {
    const map = new Map<number, number>();
    if (!debugOverlap || cards.length === 0) return map;
    const area = cardW * cardH;
    if (area <= 0) return map;
    // Sort by z; higher-z cards (later in the array) render on top.
    const byZ = [...cards].sort((a, b) => a.z - b.z);
    for (let i = 0; i < byZ.length; i++) {
      const c = byZ[i];
      let covered = 0;
      for (let j = i + 1; j < byZ.length; j++) {
        const o = byZ[j];
        const ow = Math.max(
          0,
          Math.min(c.x + cardW, o.x + cardW) - Math.max(c.x, o.x),
        );
        const oh = Math.max(
          0,
          Math.min(c.y + cardH, o.y + cardH) - Math.max(c.y, o.y),
        );
        covered += ow * oh;
        if (covered >= area) break;
      }
      map.set(c.id, Math.max(0, 1 - Math.min(area, covered) / area));
    }
    return map;
  }, [debugOverlap, cards, cardW, cardH]);

  const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
  const ready = selectedCount === required;

  const triggerStir = useCallback(() => {
    if (revealing || revealedAll) return;
    // If any cards are already in slots, ask before clearing them. Per
    // design: Stir is the "begin again" gesture — never silently destroy
    // the user's intentional picks.
    const anySelected = cards.some((c) => c.selectionOrder !== null);
    if (anySelected) {
      const ok = window.confirm("Begin again? Your picks will return to the table.");
      if (!ok) return;
      setCards((prev) =>
        prev.map((c) =>
          c.selectionOrder !== null ? { ...c, selectionOrder: null } : c,
        ),
      );
    }
    setStirring(true);
    setStirNonce((n) => n + 1);
    if (stirTimerRef.current != null) {
      window.clearTimeout(stirTimerRef.current);
    }
    stirTimerRef.current = window.setTimeout(() => {
      setStirring(false);
      stirTimerRef.current = null;
    }, 760);
  }, [revealing, revealedAll, cards]);

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
      // Tapping a slotted card sends it back to the table. The other slots
      // hold their cards (we never compact / shift indices). The returning
      // card lands at a fresh random position so the table reads as
      // "shuffled" rather than the card returning to its origin.
      if (target.selectionOrder !== null) {
        if (usesSlots) {
          if (!size) return prev;
          const newPos = pickReturnSpot(prev, target.id, {
            width: size.w,
            height: size.h,
            cardW,
            cardH,
            padding: TABLETOP_CONFIG.SCATTER_PADDING,
            maxRotation,
          });
          // Push z above any other unselected card so it's clearly on top
          // when it lands; selected cards still sit in the 1000+ band.
          const maxZ = prev.reduce(
            (m, c) => (c.selectionOrder === null && c.z > m ? c.z : m),
            0,
          );
          return prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  selectionOrder: null,
                  x: newPos.x,
                  y: newPos.y,
                  rotation: newPos.rotation,
                  z: maxZ + 1,
                }
              : c,
          );
        }
        // Single-card / yes_no: keep the original toggle behavior.
        const removedOrder = target.selectionOrder;
        return prev.map((c) => {
          if (c.id === id) return { ...c, selectionOrder: null };
          if (c.selectionOrder !== null && c.selectionOrder > removedOrder) {
            return { ...c, selectionOrder: c.selectionOrder - 1 };
          }
          return c;
        });
      }
      // Pick the lowest-numbered empty slot (1..required). When a card is
      // returned to the table from slot N, the next selection refills slot N
      // rather than appending past the last filled slot.
      const occupied = new Set(
        prev
          .map((c) => c.selectionOrder)
          .filter((n): n is number => n !== null),
      );
      let nextSlot: number | null = null;
      for (let i = 1; i <= required; i++) {
        if (!occupied.has(i)) {
          nextSlot = i;
          break;
        }
      }
      if (nextSlot === null) return prev;
      return prev.map((c) =>
        c.id === id ? { ...c, selectionOrder: nextSlot } : c,
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

    // Pause for the sacred moment, then flip every selected card together.
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
        // Lingering breath: let users savor the faces before the
        // reading screen takes over.
        650;
      window.setTimeout(() => {
        setRevealedAll(true);
        onComplete(
          picks.map((p) => ({ id: p.id, cardIndex: deckMapping[p.id] })),
        );
      }, total);
    }, 320);
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
      {/* Temporary resting-opacity test slider — fixed upper-left, top
          layer so cards never sit above its controls. Desktop-only:
          hidden on mobile per design (it is a dev-only tool). */}
      {!isMobile && (
      <div
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "calc(env(safe-area-inset-left, 0px) + 12px)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          width: 130,
          zIndex: 100,
          opacity: restingAlpha,
          pointerEvents: "auto",
        }}
        className="transition-opacity hover:!opacity-100 focus-within:!opacity-100"
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
      )}

      {/* Overlap debug pill — fixed upper-right, leaves room for the X
          close button in the bottom bar but mirrors the dev slider on
          the opposite corner. Desktop only. */}
      {!isMobile && (
        <button
          type="button"
          onClick={() => setDebugOverlap((v) => !v)}
          aria-pressed={debugOverlap}
          aria-label="Toggle overlap debug overlay"
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            right: "calc(env(safe-area-inset-right, 0px) + 52px)",
            zIndex: 50,
            opacity: debugOverlap ? 1 : restingAlpha,
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
            "font-display text-[9px] uppercase tracking-[0.25em] transition-opacity",
            "hover:!opacity-100 focus:!opacity-100 focus:outline-none",
            debugOverlap
              ? "border-destructive/70 text-destructive-foreground bg-destructive/20"
              : "border-gold/30 text-gold/70",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              debugOverlap ? "bg-destructive" : "bg-gold/50",
            )}
          />
          Overlap {debugOverlap ? "On" : "Off"}
        </button>
      )}

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
            slotRect={
              usesSlots && c.selectionOrder !== null
                ? slotRects[c.selectionOrder - 1] ?? null
                : null
            }
            flightMs={TABLETOP_CONFIG.FLIGHT_MS}
            containerOrigin={containerOrigin}
          />
        ))}
        {stirring && (
          <span
            aria-hidden="true"
            className="tabletop-shimmer-overlay"
          />
        )}
        {/* Dev overlap debug overlay. Each card gets a tinted rectangle at
            its bounding-box position with its visible-area % shown. Red <30%
            (violates the rule), amber 30–60%, green ≥60%. */}
        {debugOverlap &&
          cards.map((c) => {
            const ratio = visibilityByCardId.get(c.id) ?? 1;
            const pct = Math.round(ratio * 100);
            const violates = ratio < 0.3;
            const tint = violates
              ? "rgba(239, 68, 68, 0.45)" // red
              : ratio < 0.6
                ? "rgba(245, 158, 11, 0.35)" // amber
                : "rgba(34, 197, 94, 0.30)"; // green
            const border = violates
              ? "2px solid rgba(239, 68, 68, 0.95)"
              : ratio < 0.6
                ? "1px dashed rgba(245, 158, 11, 0.9)"
                : "1px dashed rgba(34, 197, 94, 0.8)";
            return (
              <div
                key={`dbg-${c.id}`}
                aria-hidden="true"
                className="pointer-events-none absolute"
                style={{
                  left: c.x,
                  top: c.y,
                  width: cardW,
                  height: cardH,
                  background: tint,
                  border,
                  borderRadius: 10,
                  zIndex: 9000 + c.z,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "white",
                  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                }}
              >
                {pct}%
              </div>
            );
          })}
      </div>

      {(() => {
        // When the user is mid-pick we show the slot rail prominently. Once
        // every slot is filled the rail visually steps aside for "Reveal",
        // but its DOM stays mounted (just hidden) so the slotted cards keep
        // their fixed-position anchors and don't fly back to the table.
        const slotRailMounted = !revealedAll && usesSlots;
        const showSlotRail = slotRailMounted && !ready;
        const slotRail = slotRailMounted ? (
          <div
            className="flex flex-col items-center gap-1.5"
            // When ready, hide the rail visually but keep it in the DOM so
            // slot rects stay measurable — slotted cards anchor to them.
            style={
              !showSlotRail
                ? {
                    visibility: "hidden",
                    position: "absolute",
                    pointerEvents: "none",
                  }
                : undefined
            }
            aria-hidden={!showSlotRail}
          >
            {!isMobile && (
              <span
                aria-live="polite"
                aria-label={`${selectedCount} of ${required} cards chosen`}
                className="font-display italic tabular-nums leading-none"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  color: "var(--gold)",
                  opacity: restingAlpha,
                  textTransform: "uppercase",
                }}
              >
                <span style={{ color: "var(--gold)", opacity: 1 }}>
                  {selectedCount}
                </span>
                <span style={{ margin: "0 4px", opacity: 0.5 }}>/</span>
                <span>{required}</span>
              </span>
            )}
            <div
              className={cn(
                "flex items-end justify-center px-1 pb-1",
                required >= 10 ? "gap-1" : "gap-2",
                "overflow-x-auto",
              )}
              role="list"
              aria-label={`${meta.label} slots`}
            >
              {Array.from({ length: required }).map((_, i) => {
                const filled = cards.some((c) => c.selectionOrder === i + 1);
                const isNext = !filled && i === selectedCount;
                return (
                  <div
                    key={i}
                    role="listitem"
                    className="flex flex-col items-center gap-1 shrink-0"
                  >
                    <div
                      ref={(el) => {
                        slotRefs.current[i] = el;
                      }}
                      className={cn(isNext && "slot-next-frame")}
                      style={{
                        width: slotW,
                        height: slotH,
                        borderRadius: 10,
                        border: isNext
                          ? undefined
                          : "1px solid rgba(212,175,55,0.2)",
                        background: isNext
                          ? undefined
                          : filled
                            ? "transparent"
                            : "rgba(212,175,55,0.03)",
                        transition: isNext
                          ? undefined
                          : "background 200ms ease-out, border-color 200ms ease-out, box-shadow 200ms ease-out",
                      }}
                      aria-label={
                        filled
                          ? `${slotLabels[i] ?? `Slot ${i + 1}`} — filled`
                          : isNext
                            ? `${slotLabels[i] ?? `Slot ${i + 1}`} — next`
                            : `${slotLabels[i] ?? `Slot ${i + 1}`} — empty`
                      }
                    />
                    <span
                      className={cn(
                        "font-display italic",
                        isNext && "slot-next-label",
                      )}
                      style={{
                        fontSize: required >= 10 ? (isMobile ? 8 : 9) : 10,
                        color: "var(--gold)",
                        opacity: isNext ? undefined : restingAlpha,
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {slotLabels[i] ?? `Slot ${i + 1}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null;

        const centerWhisper =
          !revealedAll && (!usesSlots || ready)
            ? ready
              ? (
                <button
                  type="button"
                  onClick={handleReveal}
                  disabled={revealing}
                  aria-busy={revealing}
                  aria-label="Reveal your reading"
                  className="reveal-cta-enter reveal-glow-pulse inline-flex items-center gap-2 bg-transparent font-display italic leading-none hover:scale-[1.02] focus:outline-none disabled:cursor-not-allowed"
                  style={{
                    fontSize: 24,
                    color: "var(--gold)",
                    opacity: 1,
                    textShadow:
                      "0 0 20px rgba(212,175,55,0.9), 0 0 40px rgba(212,175,55,0.4)",
                    cursor: "pointer",
                  }}
                >
                  {revealing && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {revealing ? "Revealing" : "Reveal"}
                </button>
              )
              : (
                <span
                  aria-live="polite"
                  aria-label={`Choose ${required - selectedCount} more`}
                  className="font-display italic leading-none"
                  style={{
                    fontSize: 32,
                    color: "var(--gold)",
                    opacity: 1,
                    textShadow: "0 0 20px rgba(212,175,55,0.8)",
                  }}
                >
                  {required - selectedCount}
                </span>
              )
            : null;

        const mobileSlotCounter =
          isMobile && showSlotRail ? (
            <span
              aria-live="polite"
              aria-label={`${selectedCount} of ${required} cards chosen`}
              className="font-display italic tabular-nums leading-none"
              style={{
                fontSize: 22,
                letterSpacing: "0.05em",
                color: "var(--gold)",
                opacity: 1,
                textShadow: "0 0 16px rgba(212,175,55,0.7)",
              }}
            >
              <span>{selectedCount}</span>
              <span style={{ margin: "0 4px", opacity: 0.5 }}>/</span>
              <span>{required}</span>
            </span>
          ) : null;

        const controlsRow = (
          <div
            className="relative grid grid-cols-3 items-end"
            style={{
              paddingBottom:
                isMobile && showSlotRail
                  ? 4
                  : "calc(env(safe-area-inset-bottom, 0px) + 12px)",
              paddingLeft: "calc(env(safe-area-inset-left, 0px) + 16px)",
              paddingRight: "calc(env(safe-area-inset-right, 0px) + 16px)",
              paddingTop: 8,
            }}
          >
            <div className="flex flex-col items-start gap-2">
              {!revealedAll && (
                <button
                  type="button"
                  onClick={triggerStir}
                  disabled={revealing || stirring}
                  aria-label="Stir — rearrange unselected cards"
                  style={{ opacity: restingAlpha }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed"
                >
                  <Sparkles className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
            </div>

            <div
              className="flex items-end justify-center min-w-0"
              style={{
                transform:
                  ready || !usesSlots
                    ? "translateY(-8px)"
                    : isMobile
                      ? "translateY(-4px)"
                      : "translateY(0)",
              }}
            >
              {isMobile && showSlotRail ? mobileSlotCounter : slotRail}
              {centerWhisper}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleExit}
                aria-label="Close tabletop"
                style={{ opacity: exitAlpha }}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        );

        if (isMobile && showSlotRail) {
          return (
            <>
              {controlsRow}
              <div
                className="flex justify-center"
                style={{
                  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
                  paddingLeft: "calc(env(safe-area-inset-left, 0px) + 8px)",
                  paddingRight: "calc(env(safe-area-inset-right, 0px) + 8px)",
                }}
              >
                {slotRail}
              </div>
            </>
          );
        }

        return controlsRow;
      })()}
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
  slotRect,
  flightMs,
  containerOrigin,
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
  /**
   * Viewport-coordinate rect of this card's slot when it has been
   * selected as part of a multi-card spread. When non-null the card
   * positions itself with `position: fixed` and animates to the slot.
   * Null for unselected cards or single-card spreads (in-place glow).
   */
  slotRect: DOMRect | null;
  flightMs: number;
  /**
   * Viewport offset of the scatter container — needed to convert a
   * card's container-relative scatter coords (card.x / card.y) into
   * viewport coords for the return-flight animation.
   */
  containerOrigin: { left: number; top: number } | null;
}) {
  const isSelected = card.selectionOrder !== null;
  const flying = isSelected && slotRect !== null;
  const glow = `0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD}px var(--gold)`;

  // Ref to the root button so we can measure its viewport rect before the
  // flight begins (FLIP-style: capture First, set Last, animate transform).
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Flight state machine. 'idle' = scattered/in-place. 'launching' = card
  // freshly promoted to fixed positioning at its captured viewport rect (no
  // visual jump yet). 'arrived' = card has been told to move to the slot
  // rect; CSS transition carries it there. 'returning' = card is flying
  // *back* from its last slot rect to a fresh scatter spot on the table.
  type FlightPhase = "idle" | "launching" | "arrived" | "returning";
  const [flightPhase, setFlightPhase] = useState<FlightPhase>("idle");
  // Captured viewport rect at the moment the card was selected.
  const [launchRect, setLaunchRect] = useState<DOMRect | null>(null);
  // The slot rect the card was occupying right before being released back
  // to the table. Used as the starting position of the return flight.
  const [returnFromRect, setReturnFromRect] = useState<DOMRect | null>(null);
  // Captured rotation at launch — we ease this back to 0 during flight.
  const launchRotationRef = useRef(0);
  // Most recent slotRect we saw while flying. Tracked separately so that
  // when the parent clears slotRect (card released) we still know where
  // the card visually was a frame ago.
  const lastSlotRectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    if (slotRect) lastSlotRectRef.current = slotRect;
  }, [slotRect]);

  // Detect the moment the card becomes flying-eligible. Capture its current
  // bbox synchronously so the upcoming switch from absolute(scatter) →
  // fixed(viewport) does not produce a one-frame jump.
  useLayoutEffect(() => {
    if (!flying) {
      // Was on a flight (arrived/launching) and lost the slotRect → start
      // a return flight from the last known slot position. Skip the
      // transition only if we never had a meaningful flight to begin with.
      if (
        (flightPhase === "arrived" || flightPhase === "launching") &&
        lastSlotRectRef.current
      ) {
        setReturnFromRect(lastSlotRectRef.current);
        setFlightPhase("returning");
      } else if (flightPhase !== "idle" && flightPhase !== "returning") {
        setFlightPhase("idle");
      }
      return;
    }
    if (flightPhase === "idle") {
      const r = btnRef.current?.getBoundingClientRect() ?? null;
      setLaunchRect(r);
      launchRotationRef.current = card.rotation;
      setFlightPhase("launching");
    }
  }, [flying, flightPhase, card.rotation]);

  // After one paint at the launch rect, transition to the slot rect.
  useEffect(() => {
    if (flightPhase !== "launching") return;
    const id = window.requestAnimationFrame(() => {
      // Second rAF guarantees the browser has painted the launch frame
      // before applying the destination styles, so the transition fires.
      window.requestAnimationFrame(() => setFlightPhase("arrived"));
    });
    return () => window.cancelAnimationFrame(id);
  }, [flightPhase]);

  // Returning: paint one frame at the last slot rect, then transition to
  // the fresh scatter target. After flightMs settle back into 'idle' so
  // the card returns to absolute positioning inside the scatter.
  const [returnAnimating, setReturnAnimating] = useState(false);
  useEffect(() => {
    if (flightPhase !== "returning") return;
    setReturnAnimating(false);
    const raf1 = window.requestAnimationFrame(() => {
      const raf2 = window.requestAnimationFrame(() => setReturnAnimating(true));
      return () => window.cancelAnimationFrame(raf2);
    });
    const settle = window.setTimeout(() => {
      setFlightPhase("idle");
      setReturnFromRect(null);
      lastSlotRectRef.current = null;
      setReturnAnimating(false);
    }, flightMs + 40);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(settle);
    };
  }, [flightPhase, flightMs]);

  // Re-trigger the tap micro-animation on every click by toggling a key.
  const [tapTick, setTapTick] = useState(0);
  // Sacred consecration: play a slow ceremonial animation once each time a
  // card transitions from unselected → selected. Tracked via a tick that
  // re-keys the animation wrapper so React replays it cleanly. Cleared
  // after the animation duration so the static selected glow takes over.
  const [consecrateTick, setConsecrateTick] = useState(0);
  const [consecrating, setConsecrating] = useState(false);
  const prevSelectedRef = useRef(isSelected);
  useEffect(() => {
    if (isSelected && !prevSelectedRef.current) {
      setConsecrateTick((t) => t + 1);
      setConsecrating(true);
      const id = window.setTimeout(() => setConsecrating(false), 1400);
      prevSelectedRef.current = isSelected;
      return () => window.clearTimeout(id);
    }
    prevSelectedRef.current = isSelected;
  }, [isSelected]);

  // Sacred flip: when this card transitions face-down → face-up, play the
  // lift + halo animation alongside the rotateY flip. Tracked separately
  // from `revealed` so the halo cleanly unmounts after the animation.
  const [revealTick, setRevealTick] = useState(0);
  const [flipping, setFlipping] = useState(false);
  // Brief gold breath on the face once the flip is essentially done.
  // Triggered shortly before the rotateY transition fully settles so the
  // glow appears to "ignite" the freshly revealed face.
  const [faceGlowing, setFaceGlowing] = useState(false);
  const [faceGlowTick, setFaceGlowTick] = useState(0);
  const prevRevealedRef = useRef(card.revealed);
  useEffect(() => {
    if (card.revealed && !prevRevealedRef.current) {
      setRevealTick((t) => t + 1);
      setFlipping(true);
      const flipDone = window.setTimeout(
        () => setFlipping(false),
        TABLETOP_CONFIG.REVEAL_ANIMATION_MS + 60,
      );
      // Ignite the face glow at ~75% through the flip so it crests just
      // as the front face becomes fully visible, then fades over ~1.4s.
      const glowStart = window.setTimeout(() => {
        setFaceGlowTick((t) => t + 1);
        setFaceGlowing(true);
      }, Math.round(TABLETOP_CONFIG.REVEAL_ANIMATION_MS * 0.75));
      const glowEnd = window.setTimeout(
        () => setFaceGlowing(false),
        Math.round(TABLETOP_CONFIG.REVEAL_ANIMATION_MS * 0.75) + 1400 + 60,
      );
      prevRevealedRef.current = card.revealed;
      return () => {
        window.clearTimeout(flipDone);
        window.clearTimeout(glowStart);
        window.clearTimeout(glowEnd);
      };
    }
    prevRevealedRef.current = card.revealed;
  }, [card.revealed]);

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
      ref={btnRef}
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
        flying || flightPhase === "returning"
          ? "fixed outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
          : "absolute outline-none focus-visible:ring-2 focus-visible:ring-gold/70",
        // While stirring, animate left/top/transform together so the card
        // drifts to its new scatter slot. Otherwise keep the snappier
        // transform-only transition for selection feedback.
        flying || flightPhase === "returning"
          ? null
          : stirring
          ? "card-stir-transition"
          : "transition-transform duration-200 ease-out",
        // Remove default tap highlight on iOS / Android.
        "[-webkit-tap-highlight-color:transparent] touch-manipulation",
        isSelected ? "z-30" : null,
      )}
      style={
        flightPhase === "returning" && returnFromRect && containerOrigin
          ? {
              // Fixed positioning during return flight. Start at the last
              // slot rect; on the next frame transition to the new scatter
              // viewport coords. After the transition completes the
              // settle effect drops the card back to absolute (idle).
              left: returnAnimating
                ? containerOrigin.left + card.x
                : returnFromRect.left,
              top: returnAnimating
                ? containerOrigin.top + card.y
                : returnFromRect.top,
              width: returnAnimating ? cardW : returnFromRect.width,
              height: returnAnimating ? cardH : returnFromRect.height,
              transform: returnAnimating
                ? `rotate(${card.rotation}deg)`
                : `rotate(0deg)`,
              transition: returnAnimating
                ? `left ${flightMs}ms cubic-bezier(0.22,1,0.36,1), top ${flightMs}ms cubic-bezier(0.22,1,0.36,1), width ${flightMs}ms cubic-bezier(0.22,1,0.36,1), height ${flightMs}ms cubic-bezier(0.22,1,0.36,1), transform ${flightMs}ms cubic-bezier(0.22,1,0.36,1)`
                : "none",
              zIndex: 1400,
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : flying && launchRect && slotRect
          ? {
              // Fixed (viewport) positioning during flight. Phase 'launching'
              // sits at the captured rect; phase 'arrived' is the slot rect.
              // The CSS transition between the two creates the flight.
              left:
                flightPhase === "launching" ? launchRect.left : slotRect.left,
              top:
                flightPhase === "launching" ? launchRect.top : slotRect.top,
              width:
                flightPhase === "launching" ? launchRect.width : slotRect.width,
              height:
                flightPhase === "launching"
                  ? launchRect.height
                  : slotRect.height,
              transform:
                flightPhase === "launching"
                  ? `rotate(${launchRotationRef.current}deg)`
                  : `rotate(0deg)`,
              transition:
                flightPhase === "launching"
                  ? "none"
                  : `left ${flightMs}ms cubic-bezier(0.22,1,0.36,1), top ${flightMs}ms cubic-bezier(0.22,1,0.36,1), width ${flightMs}ms cubic-bezier(0.22,1,0.36,1), height ${flightMs}ms cubic-bezier(0.22,1,0.36,1), transform ${flightMs}ms cubic-bezier(0.22,1,0.36,1)`,
              zIndex: 1500 + (card.selectionOrder ?? 0),
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : {
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
            }
      }
    >
      {/* Invisible expanded hit area for easier tapping on mobile. */}
      <span aria-hidden="true" className="card-hit" />
      <div
        key={`${tapTick}-${consecrateTick}-${revealTick}`}
        className={cn(
          "relative h-full w-full rounded-[10px] flip-3d",
          card.revealed && "is-flipped",
          tapTick > 0 && !card.revealed && "animate-card-tap",
          stirring && !card.revealed && "animate-card-stir-glide",
          consecrating && !card.revealed && "animate-card-consecrate animate-card-consecrate-halo",
          flipping && "animate-sacred-reveal",
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
        {flipping && (
          <span aria-hidden="true" className="sacred-reveal-halo" />
        )}
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
          {faceGlowing && (
            <span
              key={`face-glow-${faceGlowTick}`}
              aria-hidden="true"
              className="face-reveal-glow"
            />
          )}
        </div>
        {consecrating && !card.revealed && (
          <span aria-hidden="true" className="card-consecrate-shimmer" />
        )}
      </div>
      {isSelected && !card.revealed && !flying && (
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