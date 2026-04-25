import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Eye, EyeOff, Sparkles, Undo2, Redo2, X } from "lucide-react";
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
import { useShowLabels } from "@/lib/use-show-labels";
import { cn } from "@/lib/utils";

const TABLETOP_CONFIG = {
  CARD_ASPECT_RATIO: 1.75,
  // Cards sit flat on the table — no rotation. The original scatter
  // tilted each card by up to ±8°; per design the table now reads as a
  // calm, axis-aligned spread so the eye isn't pulled around.
  CARD_MAX_ROTATION: 0,
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
  /**
   * The card's home position on the table, captured exactly once when the
   * scatter is first built. When a card is returned from a slot (via Stir
   * or by tapping it again) it animates back to these coordinates so the
   * table reads as the same scatter the user has been navigating, not a
   * fresh shuffle. NEVER overwrite these after initial assignment.
   */
  originalX: number;
  originalY: number;
  originalRotation: number;
  originalZ: number;
  /**
   * Last known position the card occupied while resting on the table.
   * Updated whenever the user drops the card on the table (drag-move or
   * drag-unplace). When a slotted card is returned to the table by a
   * tap (deselect) or by being displaced, it goes back to this spot
   * rather than its original random scatter coords — so the user's
   * deliberate placement is preserved.
   */
  lastTableX: number;
  lastTableY: number;
  lastTableRotation: number;
  /**
   * Set when the card just landed in a slot via a physical drag-drop
   * (rather than a tap). The flight animation is skipped for this
   * card on the next render — it appears in its slot exactly where
   * the user released it. Cleared once the card transitions back to
   * the table or another action runs.
   */
  isDragDrop?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Session store — keep undo/redo + cards across route transitions    */
/* ------------------------------------------------------------------ */

/**
 * In-memory snapshot of an in-flight tabletop session. Survives
 * unmount/remount of <Tabletop /> (e.g. the user navigates to /journal
 * and then back to /draw) but is intentionally NOT persisted to
 * localStorage — the scatter geometry is viewport-specific and stale
 * across reloads. Clearing happens on:
 *   1. handleExit() — explicit "Leave this reading"
 *   2. onComplete   — the spread fills and we move to cast/reading
 *   3. spread mode change — different spread = fresh stack
 *
 * Keyed by spread mode so each spread has an independent session.
 */
type TabletopSession = {
  cards: CardState[];
  undoStack: DragAction[];
  redoStack: DragAction[];
};
const tabletopSessions = new Map<string, TabletopSession>();

function readTabletopSession(spread: string): TabletopSession | null {
  return tabletopSessions.get(spread) ?? null;
}
function writeTabletopSession(spread: string, snapshot: TabletopSession) {
  tabletopSessions.set(spread, snapshot);
}
function clearTabletopSession(spread: string) {
  tabletopSessions.delete(spread);
}

/* ------------------------------------------------------------------ */
/*  Drag + undo/redo                                                   */
/* ------------------------------------------------------------------ */

/**
 * Session-only undo/redo actions captured each time the user drags a
 * card. The Tabletop applies these forward (do/redo) and inversely
 * (undo). Cleared when the tabletop unmounts (the user exits the draw).
 *
 * Three kinds, all fully reversible:
 *
 *  - "move"    — an unslotted card moved on the table from (fromX,fromY)
 *                → (toX,toY).
 *  - "place"   — a card landed in `toSlot`. The dragged card may have
 *                come from another slot (`fromSlot`) or from the table
 *                (`fromX,fromY`, `fromSlot === null`). If `toSlot` was
 *                occupied, the displaced occupant is moved either back
 *                to the dragged card's previous slot (a clean swap) or
 *                onto the table at its own previous coordinates.
 *  - "unplace" — a card was dragged off `fromSlot` onto the table at
 *                (toX,toY). Undo restores its slot.
 *
 * Every action stores enough state to perfectly reverse itself —
 * including the displaced card's slot/coords — so undo + redo always
 * return the board to the exact prior configuration regardless of drag
 * type or slot occupancy.
 */
type DragAction =
  | { kind: "move"; cardId: number; fromX: number; fromY: number; toX: number; toY: number }
  | {
      kind: "place";
      cardId: number;
      toSlot: number;
      /** Slot the dragged card came from, or null if it was on the table. */
      fromSlot: number | null;
      /** Pre-drag table coords (used when fromSlot === null). */
      fromX: number;
      fromY: number;
      displacedCardId: number | null;
      /**
       * Where the displaced occupant ended up after this action:
       *  - if dragged came from a slot → swap into that slot
       *    (`displacedToSlot` set, coords ignored)
       *  - if dragged came from the table → onto the table at the
       *    dragged card's pre-drag coords
       */
      displacedToSlot: number | null;
      displacedFromX: number;
      displacedFromY: number;
    }
  | {
      kind: "unplace";
      cardId: number;
      fromSlot: number;
      toX: number;
      toY: number;
    };

export function Tabletop({ spread, onExit, onComplete }: TabletopProps) {
  const meta = SPREAD_META[spread];
  const required = meta.count;
  const usesSlots = spreadUsesSlots(spread);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewportW, setViewportW] = useState<number | null>(null);
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
  // Persisted preference for showing spread position labels under each
  // slot. Defaults to ON (annotated). Mirrored on the SpreadLayout
  // screen so the choice carries through the entire draw flow.
  const { showLabels, toggleShowLabels } = useShowLabels();

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setViewportW(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const isMobile = viewportW === null || viewportW < TABLETOP_CONFIG.MOBILE_BREAKPOINT;
  const cardW = isMobile ? responsiveCardWidth(size?.w ?? 0) : 52;
  const cardH = Math.round(cardW * TABLETOP_CONFIG.CARD_ASPECT_RATIO);
  // Slot rail uses its own width (smaller on mobile / for many-slot
  // spreads) so all slots fit in one row without scrolling.
  // Slot dimensions: on desktop they match the table card exactly (per
  // design: empty slots read as full-size mirrors of the cards). On mobile
  // they shrink so a 10-slot Celtic rail still fits in one row.
  const slotW = isMobile ? responsiveSlotWidth(size?.w ?? 0, required) : cardW;
  const slotH = isMobile
    ? Math.round(slotW * TABLETOP_CONFIG.CARD_ASPECT_RATIO)
    : cardH;
  // The slot rail always uses the short labels — slot tiles are tiny on
  // mobile and only ~64px wide on desktop, so the new full position names
  // ("The Present", "Hopes & Fears", …) wouldn't fit. The full names are
  // surfaced in the bottom-bar whisper (`Draw: The Present` + description)
  // so the user still sees the proper name as they draw.
  const slotLabels = meta.positionsShort ?? meta.positions ?? [];
  // Full-length position labels (e.g. "The Present") + their per-position
  // descriptions, used by the two-line whisper above the rail.
  const fullPositionLabels = meta.positions ?? [];
  const positionDescriptions = meta.positionDescriptions ?? [];
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

  // Hydrate cards + undo/redo from the cross-route session store on
  // first mount. If the user navigated away from /draw and came back,
  // their entire in-flight session (scatter, picks, history) is
  // restored rather than starting over.
  const restored = readTabletopSession(spread);
  const [cards, setCards] = useState<CardState[]>(
    () => restored?.cards ?? [],
  );

  // ---- Drag + undo/redo (cross-route session) ---------------------------
  const [undoStack, setUndoStack] = useState<DragAction[]>(
    () => restored?.undoStack ?? [],
  );
  const [redoStack, setRedoStack] = useState<DragAction[]>(
    () => restored?.redoStack ?? [],
  );
  // Highlighted slot index while a card is being dragged over the rail.
  const [dragHoverSlot, setDragHoverSlot] = useState<number | null>(null);
  // Ghost preview of where the card would land if dropped on the table
  // right now — a subtle dashed outline at the clamped, container-local
  // coordinates. Null whenever the pointer is over a slot (the slot's
  // own highlight serves as the destination preview in that case) or
  // when no drag is in flight.
  const [tableGhost, setTableGhost] = useState<{ x: number; y: number } | null>(null);

  // ---- Onboarding hint --------------------------------------------------
  // Show a small hint on the tabletop that explains the hold-to-drag
  // gesture and dropping onto slots. Persists "seen" via localStorage so
  // returning users aren't nagged. Fades out after the first successful
  // drop into a slot (or any drop, for spreads without slots).
  const HINT_STORAGE_KEY = "moonseed:tabletop:drag-hint-seen";
  const [showDragHint, setShowDragHint] = useState(false);
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const seen = window.localStorage.getItem(HINT_STORAGE_KEY);
      if (!seen) setShowDragHint(true);
    } catch {
      // localStorage may be blocked — silently skip the hint.
    }
  }, []);
  const dismissDragHint = useCallback(() => {
    setShowDragHint(false);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  /**
   * Apply a DragAction to the cards array in the "do/redo" direction.
   * The reverse direction (undo) is computed inline in `undo()` below
   * because the inverse for `place` involves restoring the previous slot
   * occupant if any.
   */
  const applyAction = useCallback(
    (action: DragAction) => {
      setCards((prev) => {
        if (action.kind === "move") {
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  x: action.toX,
                  y: action.toY,
                  lastTableX: action.toX,
                  lastTableY: action.toY,
                  lastTableRotation: c.rotation,
                  isDragDrop: false,
                }
              : c,
          );
        }
        if (action.kind === "place") {
          const targetOrder = action.toSlot + 1;
          const dragOrigCoords = action.fromSlot === null
            ? { x: action.fromX, y: action.fromY }
            : null;
          return prev.map((c) => {
            if (c.id === action.cardId) {
              return { ...c, selectionOrder: targetOrder, isDragDrop: true };
            }
            if (
              action.displacedCardId !== null &&
              c.id === action.displacedCardId
            ) {
              if (action.displacedToSlot !== null) {
                // Swap: occupant takes the dragged card's previous slot.
                return {
                  ...c,
                  selectionOrder: action.displacedToSlot + 1,
                  isDragDrop: false,
                };
              }
              // Bumped onto the table at its own pre-drag coords.
              return {
                ...c,
                selectionOrder: null,
                x: action.displacedFromX,
                y: action.displacedFromY,
                lastTableX: action.displacedFromX,
                lastTableY: action.displacedFromY,
                lastTableRotation: c.rotation,
                isDragDrop: false,
              };
            }
            return c;
          });
          // (dragOrigCoords is only consulted by undo, kept here for clarity)
          void dragOrigCoords;
        }
        if (action.kind === "unplace") {
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  selectionOrder: null,
                  x: action.toX,
                  y: action.toY,
                  lastTableX: action.toX,
                  lastTableY: action.toY,
                  lastTableRotation: c.rotation,
                  isDragDrop: false,
                }
              : c,
          );
        }
        return prev;
      });
    },
    [],
  );

  /** Undo the most recent action. */
  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const action = stack[stack.length - 1];
      setCards((prev) => {
        if (action.kind === "move") {
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  x: action.fromX,
                  y: action.fromY,
                  lastTableX: action.fromX,
                  lastTableY: action.fromY,
                  lastTableRotation: c.rotation,
                  isDragDrop: false,
                }
              : c,
          );
        }
        if (action.kind === "place") {
          const targetOrder = action.toSlot + 1;
          return prev.map((c) => {
            if (c.id === action.cardId) {
              // Send dragged card back to wherever it came from.
              if (action.fromSlot !== null) {
                return { ...c, selectionOrder: action.fromSlot + 1, isDragDrop: false };
              }
              return {
                ...c,
                selectionOrder: null,
                x: action.fromX,
                y: action.fromY,
                lastTableX: action.fromX,
                lastTableY: action.fromY,
                lastTableRotation: c.rotation,
                isDragDrop: false,
              };
            }
            if (
              action.displacedCardId !== null &&
              c.id === action.displacedCardId
            ) {
              // Displaced card returns to the slot we just vacated.
              return { ...c, selectionOrder: targetOrder, isDragDrop: false };
            }
            return c;
          });
        }
        // unplace: card returns to its slot.
        return prev.map((c) =>
          c.id === action.cardId
            ? { ...c, selectionOrder: action.fromSlot + 1, isDragDrop: false }
            : c,
        );
      });
      setRedoStack((r) => [...r, action]);
      return stack.slice(0, -1);
    });
  }, []);

  /** Redo the most recently undone action. */
  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const action = stack[stack.length - 1];
      applyAction(action);
      setUndoStack((u) => [...u, action]);
      return stack.slice(0, -1);
    });
  }, [applyAction]);

  /**
   * Resolve a viewport (clientX, clientY) to a slot index 0..required-1
   * if it falls inside a slot rect, else null. Uses the cached slotRects
   * already maintained for the flight animation system.
   */
  const slotIndexAtPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      for (let i = 0; i < slotRects.length; i++) {
        const r = slotRects[i];
        if (!r) continue;
        if (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          return i;
        }
      }
      return null;
    },
    [slotRects],
  );

  /**
   * Called by CardSlot when a drag finishes. Decides whether the drop
   * lands in a slot or on the table, mutates state, and records an
   * undoable action.
   */
  const handleDragEnd = useCallback(
    (
      cardId: number,
      clientX: number,
      clientY: number,
      tableX: number,
      tableY: number,
      fromX: number,
      fromY: number,
    ) => {
      setDragHoverSlot(null);
      setTableGhost(null);
      const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
      const isReady = selectedCount === required;
      const slotIdx =
        usesSlots && !isReady ? slotIndexAtPoint(clientX, clientY) : null;
      const dragged = cards.find((c) => c.id === cardId) ?? null;
      const fromSlot =
        dragged && dragged.selectionOrder !== null
          ? dragged.selectionOrder - 1
          : null;
      if (slotIdx !== null) {
        // Dropping into a slot. Three sub-cases handled below:
        //  - same slot the card already occupies → no-op
        //  - empty target → simple place
        //  - occupied target → swap (if dragged came from a slot) or
        //    bump occupant onto the table at dragged card's coords.
        if (fromSlot === slotIdx) return; // dropped on its own slot
        const targetOrder = slotIdx + 1;
        const occupant = cards.find((c) => c.selectionOrder === targetOrder);
        const willDisplace = occupant && occupant.id !== cardId ? occupant : null;
        const action: DragAction = {
          kind: "place",
          cardId,
          toSlot: slotIdx,
          fromSlot,
          fromX,
          fromY,
          displacedCardId: willDisplace ? willDisplace.id : null,
          // Swap into vacated slot when dragged came from one; otherwise
          // bump occupant to the table at *its* current coords (which
          // are its pre-drag coords since occupant didn't move).
          displacedToSlot:
            willDisplace && fromSlot !== null ? fromSlot : null,
          displacedFromX: willDisplace ? willDisplace.x : 0,
          displacedFromY: willDisplace ? willDisplace.y : 0,
        };
        applyAction(action);
        setUndoStack((s) => [...s, action]);
        setRedoStack([]);
        // First successful slot drop → fade the onboarding hint.
        dismissDragHint();
        return;
      }
      // Dropping on the table.
      let action: DragAction;
      if (fromSlot !== null) {
        // Card was in a slot — this is an "unplace" that snaps it back
        // to scatter coordinates. Always recorded (even if coords match)
        // because the slot→table transition is itself a state change.
        action = {
          kind: "unplace",
          cardId,
          fromSlot,
          toX: tableX,
          toY: tableY,
        };
      } else {
        // Pure table-to-table move.
        if (tableX === fromX && tableY === fromY) return; // no-op
        action = {
          kind: "move",
          cardId,
          fromX,
          fromY,
          toX: tableX,
          toY: tableY,
        };
      }
      applyAction(action);
      setUndoStack((s) => [...s, action]);
      setRedoStack([]);
      // For spreads without slots, any successful move dismisses the hint.
      if (!usesSlots) dismissDragHint();
    },
    [applyAction, cards, required, slotIndexAtPoint, usesSlots, dismissDragHint],
  );

  /** Called continuously while dragging so we can light up a slot. */
  const handleDragMove = useCallback(
    (
      clientX: number,
      clientY: number,
      projectedLeft: number,
      projectedTop: number,
    ) => {
      const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
      const isReady = selectedCount === required;
      const overSlot =
        usesSlots && !isReady ? slotIndexAtPoint(clientX, clientY) : null;
      setDragHoverSlot(overSlot);
      // Compute the clamped table landing point in container coords. We
      // mirror the same clamp `finishDrag` will apply on release so the
      // ghost shows the *exact* spot where the card will snap.
      if (overSlot !== null || !containerOrigin || !size) {
        setTableGhost(null);
        return;
      }
      const targetLeft = projectedLeft - containerOrigin.left;
      const targetTop = projectedTop - containerOrigin.top;
      const clampedX = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          size.w - cardW - TABLETOP_CONFIG.SCATTER_PADDING,
          targetLeft,
        ),
      );
      const clampedY = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          size.h - cardH - TABLETOP_CONFIG.SCATTER_PADDING,
          targetTop,
        ),
      );
      setTableGhost({ x: clampedX, y: clampedY });
    },
    [cards, required, usesSlots, slotIndexAtPoint, containerOrigin, size, cardW, cardH],
  );

  // Once cards are initialized we never wipe selections automatically.
  // Subsequent geometry changes (e.g. the bottom bar growing/shrinking
  // when the slot rail collapses on Reveal) reflow the unselected cards
  // in place but preserve every selectionOrder and revealed flag.
  // If we restored a session, treat ourselves as already initialized so
  // the next initialScatter effect doesn't wipe the restored cards.
  const initializedRef = useRef(restored !== null && restored.cards.length > 0);

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
          originalX: s.x,
          originalY: s.y,
          originalRotation: s.rotation,
          originalZ: s.z,
          lastTableX: s.x,
          lastTableY: s.y,
          lastTableRotation: s.rotation,
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
          originalX: s.x,
          originalY: s.y,
          originalRotation: s.rotation,
          originalZ: s.z,
          lastTableX: s.x,
          lastTableY: s.y,
          lastTableRotation: s.rotation,
        }));
      }
      let cursor = 0;
      return prev.map((c) => {
        if (c.selectionOrder !== null) return c; // never disturb a pick
        const next = initialScatter[cursor++ % initialScatter.length];
        // Geometry has changed (resize). Refresh both the live position
        // AND the stored "home" — this card has never been placed yet, so
        // we want its return-target to match wherever the new scatter put
        // it. Cards in slots are skipped above and keep their originals.
        return {
          ...c,
          x: next.x,
          y: next.y,
          rotation: next.rotation,
          z: next.z,
          originalX: next.x,
          originalY: next.y,
          originalRotation: next.rotation,
          originalZ: next.z,
          lastTableX: next.x,
          lastTableY: next.y,
          lastTableRotation: next.rotation,
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
    // No-op once cards are flying to slots / auto-transitioning is moot
    // because Stir can only be tapped while the user is still picking.
    // If any cards are already in slots, ask before clearing them. Per
    // design: Stir is the "begin again" gesture — never silently destroy
    // the user's intentional picks.
    const anySelected = cards.some((c) => c.selectionOrder !== null);
    if (anySelected) {
      const ok = window.confirm("Begin again? Your picks will return to the table.");
      if (!ok) return;
      // Send every slotted card back to its original scatter position,
      // rotation and z. Stir is "begin again" — the table should look
      // exactly as it did before the user started picking.
      setCards((prev) =>
        prev.map((c) =>
          c.selectionOrder !== null
            ? {
                ...c,
                selectionOrder: null,
                x: c.originalX,
                y: c.originalY,
                rotation: c.originalRotation,
                z: c.originalZ,
              }
            : c,
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
  }, [cards]);

  useEffect(() => {
    return () => {
      if (stirTimerRef.current != null) {
        window.clearTimeout(stirTimerRef.current);
      }
    };
  }, []);

  const toggleSelect = (id: number) => {
    setCards((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      // Tapping a slotted card sends it back to the table. The other slots
      // hold their cards (we never compact / shift indices). The returning
      // card lands at a fresh random position so the table reads as
      // "shuffled" rather than the card returning to its origin.
      if (target.selectionOrder !== null) {
        if (usesSlots) {
          // Return the card to its LAST KNOWN table position — the
          // spot it was at when the user lifted it into the slot. If
          // the card was tap-selected (never dragged), lastTableX/Y
          // were initialised to the original scatter coords so this
          // still reads as the same scatter.
          return prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  selectionOrder: null,
                  x: c.lastTableX,
                  y: c.lastTableY,
                  rotation: c.lastTableRotation,
                  isDragDrop: false,
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
        c.id === id ? { ...c, selectionOrder: nextSlot, isDragDrop: false } : c,
      );
    });
  };

  // ---- Tap-only selection -------------------------------------------------
  // Per design: only a deliberate single tap selects/deselects a card. Swipes
  // (drags across cards) must never alter selection state. We implement this
  // per-card on the CardSlot button, tracking the pointer-down position and
  // ignoring the click if the pointer moved beyond a small threshold.
  const TAP_MOVE_THRESHOLD_PX = 8;

  const handleExit = () => {
    if (selectedCount > 0) {
      const ok = window.confirm("Leave this reading? Your selections will be lost.");
      if (!ok) return;
    }
    // Explicit exit ends the session — drop the saved snapshot so the
    // next visit starts with a fresh scatter and empty undo stack.
    clearTabletopSession(spread);
    onExit();
  };

  // Mirror current cards + undo/redo stacks into the cross-route
  // session store on every change. This is what makes the session
  // survive accidental navigation away from /draw — when <Tabletop>
  // remounts, its initial state hydrates from the same snapshot.
  // Only writes once cards exist (skip the empty pre-init render).
  useEffect(() => {
    if (cards.length === 0) return;
    writeTabletopSession(spread, { cards, undoStack, redoStack });
  }, [spread, cards, undoStack, redoStack]);

  // Auto-transition: when the user fills the final slot, pause briefly
  // (the "sacred pause" — long enough to feel intentional, short enough
  // not to frustrate) then hand off to the spread layout screen with
  // cards still face-down. Picks are ordered by selectionOrder so
  // position 1 maps to spread slot 1, etc.
  useEffect(() => {
    if (!ready || required === 0) return;
    const picks = cards
      .filter((c) => c.selectionOrder !== null)
      .sort((a, b) => (a.selectionOrder ?? 0) - (b.selectionOrder ?? 0));
    const timer = window.setTimeout(() => {
      // Reading complete — the in-flight session is done. Clear the
      // snapshot so navigating back to /draw produces a fresh draw.
      clearTabletopSession(spread);
      onComplete(
        picks.map((p) => ({ id: p.id, cardIndex: deckMapping[p.id] })),
        "cast",
      );
    }, 1500);
    return () => window.clearTimeout(timer);
    // We intentionally only re-run when readiness changes — the picks
    // array is stable once the final slot is filled (tapping a slotted
    // card to remove it would flip `ready` back to false and cancel
    // the timer via the cleanup above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, required]);

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-cosmos">
      {/* Undo / Redo — fixed top-center, above the X close button. Only
          rendered while there's something to undo or redo so the chrome
          stays minimal during a fresh draw. */}
      {(undoStack.length > 0 || redoStack.length > 0) && (
        <div
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            display: "flex",
            gap: 8,
            opacity: restingAlpha,
          }}
          className="transition-opacity hover:!opacity-100 focus-within:!opacity-100"
        >
          <button
            type="button"
            onClick={undo}
            disabled={undoStack.length === 0}
            aria-label="Undo last drag"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Undo2 className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={redoStack.length === 0}
            aria-label="Redo last drag"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Redo2 className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* First-visit onboarding hint. Explains the hold-to-drag gesture
          and dropping onto slots. Auto-fades after the first successful
          drop (handled in handleDragEnd via dismissDragHint). */}
      {showDragHint && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
            transform: "translateX(-50%)",
            zIndex: 55,
            maxWidth: "min(92vw, 360px)",
          }}
          className="pointer-events-auto animate-fade-in"
        >
          <div className="flex items-start gap-2 rounded-2xl border border-gold/30 bg-cosmos/85 px-4 py-3 text-center shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <p className="flex-1 text-[13px] leading-snug text-foreground/85">
              <span className="text-gold">Hold</span> a card to lift it, then{" "}
              {usesSlots ? (
                <>
                  drag it onto a <span className="text-gold">slot</span> to place it.
                </>
              ) : (
                <>drag it anywhere on the table.</>
              )}
            </p>
            <button
              type="button"
              onClick={dismissDragHint}
              aria-label="Dismiss hint"
              className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/60 transition hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

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

      {/* Right-side vertical control stack: X (exit), Stir (shuffle),
          Eye (toggle position labels). Per design: all three live in a
          fixed column on the right edge so the bottom bar can be reserved
          purely for the slot rail and Draw / Reveal · Cast whisper. */}
      <div
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: "calc(env(safe-area-inset-right, 0px) + 12px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 12,
          zIndex: 60,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          onClick={handleExit}
          aria-label="Close tabletop"
          style={{ opacity: exitAlpha }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
            type="button"
            onClick={triggerStir}
            disabled={stirring}
            aria-label="Stir — rearrange unselected cards"
            style={{ opacity: restingAlpha }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed"
          >
            <Sparkles className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        {usesSlots && (
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
            style={{
              opacity: showLabels
                ? Math.min(1, restingAlpha + 0.15)
                : restingAlpha,
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            {showLabels ? (
              <Eye className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <EyeOff className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* Tabletop scatter area */}
      <div
        ref={containerRef}
        className={cn(
          "tabletop-stage relative flex-1 overflow-hidden select-none",
          stirring && "animate-tabletop-tilt",
        )}
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
        }}
      >
        {cards.map((c, idx) => (
          <CardSlot
            key={c.id}
            card={c}
            cardW={cardW}
            cardH={cardH}
            cardBack={cardBack}
            faceIndex={deckMapping[c.id]}
            disabled={ready}
            hitInset={hitInset}
            stirring={stirring && c.selectionOrder === null}
            tapMoveThresholdPx={TAP_MOVE_THRESHOLD_PX}
            onSelect={() => toggleSelect(c.id)}
            onDragEnd={handleDragEnd}
            onDragMove={handleDragMove}
            isCoarsePointer={isCoarsePointer}
            containerRect={
              containerOrigin && size
                ? {
                    left: containerOrigin.left,
                    top: containerOrigin.top,
                    width: size.w,
                    height: size.h,
                  }
                : null
            }
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
        {/* Drop-target ghost. Subtle dashed outline at the clamped
            landing point so the user sees exactly where a release on
            the table would snap to. Hidden whenever the pointer is
            over a slot — the slot's own gold halo is the preview in
            that case. */}
        {tableGhost && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute animate-fade-in"
            style={{
              left: tableGhost.x,
              top: tableGhost.y,
              width: cardW,
              height: cardH,
              borderRadius: 10,
              border: "1.5px dashed color-mix(in oklab, var(--gold) 70%, transparent)",
              background: "color-mix(in oklab, var(--gold) 6%, transparent)",
              boxShadow: "0 0 12px color-mix(in oklab, var(--gold) 25%, transparent)",
              transition: "left 80ms linear, top 80ms linear",
            }}
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
        // The slot rail stays mounted for the entire ceremony — even after
        // Reveal — so slotted cards keep their fixed-position anchors and
        // never fly back to the table. While the user is still mid-pick the
        // rail is fully visible; once every slot is filled it visually
        // steps aside for the "Reveal · Cast" whisper but the DOM nodes
        // remain so slot rects stay measurable.
        const slotRailMounted = usesSlots;
        const showSlotRail = slotRailMounted && !ready;
        const slotRail = slotRailMounted ? (
          <div
            className="flex flex-col items-center gap-1.5"
            // When ready, hide the rail visually but KEEP it taking layout
            // space so the "Reveal · Cast" whisper stays visually above the
            // row where slotted cards have flown to. Previously this used
            // `position: absolute` which pulled the rail out of flow and
            // made the whisper drop below the cards.
            style={
              !showSlotRail
                ? {
                    visibility: "hidden",
                    pointerEvents: "none",
                    overflow: "visible",
                    paddingTop: 4,
                  }
                : { overflow: "visible", paddingTop: 4 }
            }
            aria-hidden={!showSlotRail}
          >
            <div
              className={cn(
                "flex items-end justify-center px-1 pb-1",
                required >= 10 ? "gap-1" : "gap-2",
                // Slot row must allow the active "breathing" beacon's
                // box-shadow to bleed past its own bounds; hidden overflow
                // would clip the gold pulse. (Was overflow-x-auto.)
                "overflow-visible",
              )}
              style={{ paddingTop: 12 }}
              role="list"
              aria-label={`${meta.label} slots`}
            >
              {Array.from({ length: required }).map((_, i) => {
                const filled = cards.some((c) => c.selectionOrder === i + 1);
                const isNext = !filled && i === selectedCount;
                const isDragHover = dragHoverSlot === i;
                return (
                  <div
                    key={i}
                    role="listitem"
                    className="flex flex-col items-center gap-1 shrink-0"
                    style={{ overflow: "visible" }}
                  >
                    <div
                      ref={(el) => {
                        slotRefs.current[i] = el;
                      }}
                      className={cn(
                        isNext && "slot-next-frame",
                        filled && !isNext && "slot-filled-static",
                      )}
                      style={{
                        width: slotW,
                        height: slotH,
                        borderRadius: 10,
                        border: isDragHover
                          ? "2px solid var(--gold)"
                          : isNext
                          ? undefined
                          : filled
                            ? "1px solid rgba(212,175,55,0.35)"
                            : "1px solid rgba(212,175,55,0.2)",
                        background: isDragHover
                          ? "rgba(212,175,55,0.18)"
                          : isNext
                          ? undefined
                          : filled
                            ? "transparent"
                            : "rgba(212,175,55,0.03)",
                        boxShadow: isDragHover
                          ? "0 0 18px var(--gold), 0 0 32px rgba(212,175,55,0.6)"
                          : undefined,
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
                    {showLabels && (
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
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null;

        // While selection is still in progress we show a two-line whisper:
        //   line 1: "Draw: <Full Position Name>"  (e.g. "Draw: The Present")
        //   line 2: a one-sentence description of that position
        // The line 1 text breathes (existing animation); line 2 is calmer.
        // For single-card spreads we just show "Draw".
        const nextFullLabel = fullPositionLabels[selectedCount];
        const nextDescription = positionDescriptions[selectedCount];
        const drawWord = (
          <div
            aria-live="polite"
            aria-label={
              nextFullLabel
                ? `Draw ${nextFullLabel}${nextDescription ? `. ${nextDescription}` : ""}`
                : `Draw — ${required - selectedCount} more`
            }
            className="flex flex-col items-center"
            style={{
              padding: "0 10px",
              margin: "2px 0",
              gap: 2,
              maxWidth: "min(92vw, 420px)",
            }}
          >
            <span
              className="font-display italic leading-none animate-breathe-glow"
              style={{
                fontSize: 18,
                color: "var(--gold)",
                opacity: restingAlpha,
                lineHeight: 1.2,
                letterSpacing: "0.08em",
                textShadow: "0 0 14px rgba(212,175,55,0.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {usesSlots && nextFullLabel
                ? `Draw: ${nextFullLabel}`
                : "Draw"}
            </span>
            {usesSlots && nextDescription && (
              <span
                className="font-display italic leading-none"
                style={{
                  fontSize: 11,
                  color: "var(--gold)",
                  opacity: 0.45,
                  letterSpacing: "0.04em",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                }}
              >
                {nextDescription}
              </span>
            )}
          </div>
        );

        // Transition cue: a single gold dot that pulses softly during the
        // 1500ms sacred pause after the last card is selected. Communicates
        // "the reading is beginning" without words.
        const transitionCue = (
          <span
            role="status"
            aria-label="The reading is beginning"
            className="inline-block animate-breathe-glow"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--gold)",
              boxShadow:
                "0 0 14px rgba(212,175,55,0.85), 0 0 28px rgba(212,175,55,0.45)",
              margin: "6px 0",
            }}
          />
        );

        // While picking: show the breathing "Draw" whisper. Once the user
        // selects the final card, the whisper goes quiet and the gold dot
        // pulses through the auto-transition pause.
        const centerWhisper = ready
          ? transitionCue
          : !usesSlots
            ? drawWord
            : null;

        // Mobile: when the slot rail is visible the center column shows
        // the same "Draw" word so the call-to-action language stays
        // consistent across breakpoints. Once ready, the transition cue
        // takes over.
        const mobileSlotCounter =
          isMobile && showSlotRail && !ready ? drawWord : null;

        const controlsRow = (
          <div
            className="tabletop-bottom-bar relative flex items-end justify-center"
            style={{
              paddingBottom:
                isMobile && showSlotRail
                  ? 4
                  : "calc(env(safe-area-inset-bottom, 0px) + 12px)",
              paddingLeft: "calc(env(safe-area-inset-left, 0px) + 16px)",
              paddingRight: "calc(env(safe-area-inset-right, 0px) + 16px)",
              paddingTop: 4,
            }}
          >
            <div
              className="flex flex-col items-center justify-end min-w-0"
              style={{
                gap: 4,
                transform:
                  ready || !usesSlots
                    ? "translateY(-8px)"
                    : isMobile
                      ? "translateY(-4px)"
                      : "translateY(0)",
              }}
            >
              {/* Whisper ALWAYS sits above the slot rail — "Draw" while
                  picking, "Reveal · Cast" once every slot is filled. The
                  slot rail is rendered in the same wrapper across mobile
                  and desktop so its DOM nodes never unmount mid-flight,
                  keeping slotted cards anchored to their slots. */}
              {centerWhisper ?? mobileSlotCounter}
              {slotRail}
            </div>
          </div>
        );

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
  onDragEnd,
  onDragMove,
  isCoarsePointer,
  containerRect,
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
  /**
   * Drag pipeline. Pointer is held for ≥150ms (touch) or moved past
   * the tap threshold (mouse) → CardSlot enters drag mode, follows the
   * pointer, and on release calls `onDragEnd` so the parent can decide
   * slot-drop vs. table-move. `containerRect` and `containerOrigin` let
   * us convert between viewport and container coordinates.
   */
  onDragEnd: (
    cardId: number,
    clientX: number,
    clientY: number,
    tableX: number,
    tableY: number,
    fromX: number,
    fromY: number,
  ) => void;
  onDragMove: (
    clientX: number,
    clientY: number,
    /** Card's projected top-left in viewport coords if dropped now. */
    projectedLeft: number,
    projectedTop: number,
  ) => void;
  isCoarsePointer: boolean;
  containerRect:
    | { left: number; top: number; width: number; height: number }
    | null;
}) {
  const isSelected = card.selectionOrder !== null;
  // When the card landed in the slot via a physical drag-drop we skip
  // the FLIP-style flight animation entirely — the user just placed it
  // there, animating it from the scatter coords (where it would re-mount
  // for one frame) creates a jarring disappear/reappear flicker.
  const skipFlight = isSelected && card.isDragDrop === true;
  const flying = isSelected && slotRect !== null && !skipFlight;
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

  // ---- Drag state machine -----------------------------------------------
  // `dragging` flips true once the pointer has been held for 150ms (the
  // hold-to-drag threshold from the spec) — at which point the card lifts,
  // follows the pointer with `position: fixed`, and the eventual click
  // handler is suppressed so selection state is preserved.
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    pointerOffsetX: number; // pointer offset inside the card on grab
    pointerOffsetY: number;
    fromX: number; // card's pre-drag table coords
    fromY: number;
    holdTimer: number | null;
    didDrag: boolean;
  } | null>(null);

  const beginDrag = useCallback(() => {
    setDragging(true);
    if (dragStateRef.current) {
      // Fire one immediate move so the card jumps to the pointer location
      // (it was sitting at its scatter slot during the hold).
      const s = dragStateRef.current;
      setDragPos({
        x: s.startClientX - s.pointerOffsetX,
        y: s.startClientY - s.pointerOffsetY,
      });
      onDragMove(
        s.startClientX,
        s.startClientY,
        s.startClientX - s.pointerOffsetX,
        s.startClientY - s.pointerOffsetY,
      );
    }
  }, [onDragMove]);

  const HOLD_MS = 150;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (card.revealed) return; // never drag a face-up card
    // Suppress the browser's native drag image / focus outline that would
    // otherwise leave a "ghost" of the card at its original position once
    // the user lifts their finger. Pointer events handle everything.
    e.preventDefault();
    downPosRef.current = { x: e.clientX, y: e.clientY, cancelled: false };
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Capture the pointer so we keep receiving move/up events even if the
    // pointer leaves the button bounds during the drag.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw in rare edge cases — safe to ignore */
    }
    dragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pointerOffsetX: e.clientX - rect.left,
      pointerOffsetY: e.clientY - rect.top,
      fromX: card.x,
      fromY: card.y,
      holdTimer: window.setTimeout(beginDrag, HOLD_MS),
      didDrag: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = downPosRef.current;
    if (d && !d.cancelled) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (dx * dx + dy * dy > tapMoveThresholdPx * tapMoveThresholdPx) {
        d.cancelled = true;
      }
    }
    const s = dragStateRef.current;
    if (!s) return;
    if (!dragging) return;
    s.didDrag = true;
    setDragPos({
      x: e.clientX - s.pointerOffsetX,
      y: e.clientY - s.pointerOffsetY,
    });
    onDragMove(
      e.clientX,
      e.clientY,
      e.clientX - s.pointerOffsetX,
      e.clientY - s.pointerOffsetY,
    );
  };

  const finishDrag = (clientX: number, clientY: number) => {
    const s = dragStateRef.current;
    if (!s) return false;
    if (s.holdTimer != null) {
      window.clearTimeout(s.holdTimer);
      s.holdTimer = null;
    }
    const wasDragging = dragging && s.didDrag;
    if (wasDragging && containerRect) {
      // Convert the drop point (top-left of the card under the pointer)
      // back into container coordinates and clamp it inside the table so
      // a card never lands fully off-screen.
      const targetLeft = clientX - s.pointerOffsetX - containerRect.left;
      const targetTop = clientY - s.pointerOffsetY - containerRect.top;
      const clampedX = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          containerRect.width - cardW - TABLETOP_CONFIG.SCATTER_PADDING,
          targetLeft,
        ),
      );
      const clampedY = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          containerRect.height - cardH - TABLETOP_CONFIG.SCATTER_PADDING,
          targetTop,
        ),
      );
      onDragEnd(card.id, clientX, clientY, clampedX, clampedY, s.fromX, s.fromY);
    }
    dragStateRef.current = null;
    setDragging(false);
    setDragPos(null);
    return wasDragging;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    finishDrag(e.clientX, e.clientY);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (downPosRef.current) downPosRef.current.cancelled = true;
    finishDrag(e.clientX, e.clientY);
  };

  const handleClick = () => {
    const d = downPosRef.current;
    downPosRef.current = null;
    if (d?.cancelled) return; // swipe — never selects
    // Suppress the click that fires after a drag release — selection
    // state must be preserved across drags per spec.
    if (dragStateRef.current?.didDrag || dragging) return;
    setTapTick((t) => t + 1);
    onSelect();
  };

  // Suppress isCoarsePointer-only lint complaint — we accept the prop for
  // future tuning even though the hold delay is currently unified.
  void isCoarsePointer;

  return (
    <button
      type="button"
      ref={btnRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      // Disable native HTML5 drag — we handle drag with pointer events.
      // `draggable={false}` blocks the browser from initialising a drag
      // image (which is the source of the dashed-outline ghost left
      // behind on release).
      draggable={false}
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
        flying || flightPhase === "returning" || dragging || (skipFlight && slotRect)
          ? "fixed outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
          : "absolute outline-none focus-visible:ring-2 focus-visible:ring-gold/70",
        // While stirring, animate left/top/transform together so the card
        // drifts to its new scatter slot. Otherwise keep the snappier
        // transform-only transition for selection feedback.
        flying || flightPhase === "returning" || dragging
          ? null
          : stirring
          ? "card-stir-transition"
          : "card-idle-transition",
        // Remove default tap highlight on iOS / Android.
        "[-webkit-tap-highlight-color:transparent] touch-manipulation",
        // Block the system drag-ghost on WebKit + suppress text selection
        // and the focus outline that becomes a "dashed ring" artifact.
        "select-none [-webkit-user-drag:none] [user-drag:none]",
        isSelected ? "z-30" : null,
      )}
      style={
        dragging && dragPos
          ? {
              // Card is being dragged — follow the pointer with a slight
              // lift (scale 1.05) and a subtle shadow. Selection state is
              // preserved via the existing render path; only positioning
              // is overridden here. zIndex jumps above every other card.
              left: dragPos.x,
              top: dragPos.y,
              width: cardW,
              height: cardH,
              transform: "rotate(0deg) scale(1.05)",
              transition: "none",
              zIndex: 9999,
              willChange: "left, top, transform",
              filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.55))",
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : skipFlight && slotRect
          ? {
              // Drag-drop placement: the card lives at its slot rect
              // immediately, with no FLIP transition. The user already
              // released over the slot — we don't want it to fly back
              // out and in again.
              left: slotRect.left,
              top: slotRect.top,
              width: slotRect.width,
              height: slotRect.height,
              transform: "rotate(0deg)",
              transition: "none",
              zIndex: 1500 + (card.selectionOrder ?? 0),
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : flightPhase === "returning" && returnFromRect && containerOrigin
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
          "relative rounded-[10px]",
          tapTick > 0 && !card.revealed && "animate-card-tap",
          stirring && !card.revealed && "animate-card-stir-glide",
          consecrating && !card.revealed && "animate-card-consecrate animate-card-consecrate-halo",
          flipping && "animate-sacred-reveal",
        )}
        style={{
          // @ts-expect-error custom prop
          "--flip-ms": `${TABLETOP_CONFIG.REVEAL_ANIMATION_MS}ms`,
          // Inner content is always rendered at the table card dimensions
          // for crisp ornament scaling. While flying to a smaller slot we
          // apply a CSS scale transform so the visible content shrinks
          // smoothly to slot size, in lock-step with the button width
          // animating from cardW → slotRect.width.
          width: cardW,
          height: cardH,
          transform:
            flightPhase === "launching"
              ? "scale(1)"
              : flightPhase === "arrived" && slotRect
                ? `scale(${slotRect.width / cardW})`
                : flightPhase === "returning"
                  ? returnAnimating
                    ? "scale(1)"
                    : returnFromRect && cardW > 0
                      ? `scale(${returnFromRect.width / cardW})`
                      : "scale(1)"
                  : skipFlight && slotRect && cardW > 0
                    ? `scale(${slotRect.width / cardW})`
                    : undefined,
          transformOrigin: "top left",
          transition:
            flightPhase === "arrived" || flightPhase === "returning"
              ? `transform ${flightMs}ms cubic-bezier(0.22,1,0.36,1)`
              : undefined,
          boxShadow: isSelected
            ? `var(--tabletop-card-shadow), ${glow}, 0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD * 2}px var(--gold)`
            : "var(--tabletop-card-shadow)",
          opacity: isSelected ? TABLETOP_CONFIG.SELECTION_GLOW_OPACITY + 0.2 : 1,
        }}
      >
        {flipping && (
          <span aria-hidden="true" className="sacred-reveal-halo" />
        )}
        {/* Flip 3D container nested inside the scale wrapper so the inline
            scale transform on the parent doesn't override the rotateY(180deg)
            applied by .flip-3d.is-flipped when the card reveals. */}
        <div
          className={cn(
            "absolute inset-0 rounded-[10px] flip-3d",
            card.revealed && "is-flipped",
          )}
        >
          <div className="flip-face back">
            <CardBack id={cardBack} width={cardW} className="h-full w-full" />
          </div>
          <div className="flip-face front overflow-hidden rounded-[10px] border border-gold/40 bg-card">
            {/* Always render the face image so it's loaded and decoded before
                the flip animation reaches the apex — gating on `card.revealed`
                left the front blank for the first reveal. The back covers it
                until the rotation completes (backface-visibility: hidden). */}
            <img
              src={getCardImagePath(faceIndex)}
              alt={getCardName(faceIndex)}
              className="h-full w-full object-cover"
              loading="eager"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            {faceGlowing && (
              <span
                key={`face-glow-${faceGlowTick}`}
                aria-hidden="true"
                className="face-reveal-glow"
              />
            )}
          </div>
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