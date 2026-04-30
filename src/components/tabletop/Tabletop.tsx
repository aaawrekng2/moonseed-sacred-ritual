import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Undo2, Redo2, X } from "lucide-react";
import { Hand } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { ManualEntryBuilder } from "@/components/tabletop/ManualEntryBuilder";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { buildScatter, shuffleDeck, type ScatterCard } from "@/lib/scatter";
import { getCardName } from "@/lib/tarot";
import { useActiveDeckImage } from "@/lib/active-deck";
import { SPREAD_META, spreadUsesSlots, type SpreadMode } from "@/lib/spreads";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { useShowLabels } from "@/lib/use-show-labels";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { t } from "@/lib/oracle-language";
import {
  useRegisterCloseHandler,
  useRegisterHelpHandler,
  useRegisterTabletopActive,
} from "@/lib/floating-menu-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const TABLETOP_CONFIG = {
  CARD_ASPECT_RATIO: 1.75,
  // Cards sit flat on the table — no rotation. The original scatter
  // tilted each card by up to ±8°; per design the table now reads as a
  // calm, axis-aligned spread so the eye isn't pulled around.
  CARD_MAX_ROTATION: 0,
  SCATTER_PADDING: 10,
  /**
   * Reserved vertical strip at the top of the scatter container so cards
   * never spawn or get dragged behind the fixed top-bar icon cluster
   * (44px tap targets + safe-area). Used both as `padding-top` on the
   * container and as a deduction from the usable scatter height.
   */
  // On mobile, the floating ··· menu is much smaller than the old top bar
  // so cards can start higher. Desktop keeps the original reserve.
  TOP_RESERVE:
    typeof window !== "undefined" && window.innerWidth < 768 ? 32 : 56,
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

// Responsive card width: 38px mobile, 47px tablet, 58px desktop (-10%).
function responsiveCardWidth(viewportW: number): number {
  if (viewportW < 768) return 38;
  if (viewportW < 1024) return 47;
  return 58;
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
    picks: { id: number; cardIndex: number; isReversed?: boolean }[],
    mode: "reveal" | "cast",
    meta?: { entryMode?: "digital" | "manual" },
  ) => void;
  /**
   * When true, the manual CardPicker offers a 'Reversed?' confirmation
   * step (Stamp AU). Mirrors the seeker's `allow_reversed_cards` pref.
   */
  allowReversed?: boolean;
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
    }
  | {
      // Tap-to-slot: card was tapped on the table and assigned to the
      // lowest empty slot. Reversible: undo returns the card to the
      // table at its previous coords and clears the slot.
      kind: "tap-place";
      cardId: number;
      toSlot: number;
      fromX: number;
      fromY: number;
    }
  | {
      // Tap-deselect: a slotted card was tapped and returned to the table
      // at its lastTable coords. Undo restores the slot.
      kind: "tap-unplace";
      cardId: number;
      fromSlot: number;
      toX: number;
      toY: number;
    };

export function Tabletop({
  spread,
  onExit,
  onComplete,
  allowReversed = false,
}: TabletopProps) {
  const meta = SPREAD_META[spread];
  const required = meta.count;
  const usesSlots = spreadUsesSlots(spread);

  // AU — Manual card entry. Bypass the scatter and let the seeker pick
  // cards from a 78-card grid (used for logging a physical reading).
  const [manualOpen, setManualOpen] = useState(false);

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
  // Refs to each slot DOM element. Used to compute flight target rects in
  // viewport coordinates so a selected card can animate from its current
  // scatter position to its slot.
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Viewport-coordinate rect for each slot (id'd by slot index 0..N-1).
  // Re-measured on resize and when slot row mounts.
  const [slotRects, setSlotRects] = useState<Array<DOMRect | null>>([]);
  const { opacity: restingOpacityPct } = useRestingOpacity();
  const restingAlpha = restingOpacityPct / 100;
  const exitAlpha = Math.min(1, restingAlpha + 0.1);
  // Persisted preference for showing spread position labels under each
  // slot. Defaults to ON (annotated). Mirrored on the SpreadLayout
  // screen so the choice carries through the entire draw flow.
  const { showLabels, setShowLabels } = useShowLabels();
  const { isOracle } = useOracleMode();

  // Three-level UI density for the draw screen, controlled by the eye
  // icon in the top-bar.
  //   0 → labels under slots + bottom whisper (richest)
  //   1 → labels under slots only (whisper hidden)
  //   2 → labels and whisper hidden (most minimal)
  // Persisted across sessions on `showLabels` (level 2 ↔ off) plus a
  // local `showWhisper` flag for the middle tier.
  const [showWhisper, setShowWhisper] = useState(true);
  const densityLevel: 0 | 1 | 2 = !showLabels ? 2 : !showWhisper ? 1 : 0;
  const cycleDensity = () => {
    if (densityLevel === 0) {
      setShowLabels(true);
      setShowWhisper(false);
    } else if (densityLevel === 1) {
      setShowLabels(false);
      setShowWhisper(false);
    } else {
      setShowLabels(true);
      setShowWhisper(true);
    }
  };

  // On-brand confirmation dialog state (replaces window.confirm calls).
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  // Celtic Cross help popup — always-accessible (no localStorage gate).
  // Shown only on the Celtic Cross spread; the trigger lives in the top
  // bar so the user can re-open the explainer whenever they want.
  const [celticHelpOpen, setCelticHelpOpen] = useState(false);

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
  const cardW = isMobile ? responsiveCardWidth(size?.w ?? 0) : 47;
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
    // Absolutely positioned children land at the BORDER edge of the
    // (position: relative) container — `padding-top` does NOT push them
    // down. So we must explicitly reserve TOP_RESERVE here: shrink the
    // usable height and translate every card's Y by TOP_RESERVE via
    // `topOffset`. This keeps cards out from under the top bar.
    const usableH = Math.max(1, size.h - TABLETOP_CONFIG.TOP_RESERVE);
    return buildScatter({
      width: size.w,
      height: usableH,
      count: TABLETOP_CONFIG.DECK_SIZE,
      cardWidth: cardW,
      cardHeight: cardH,
      maxRotation,
      padding: TABLETOP_CONFIG.SCATTER_PADDING,
      seed,
      exclusionZones,
      minVisibleRatio: 0.3,
      topOffset: TABLETOP_CONFIG.TOP_RESERVE,
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
        if (action.kind === "tap-place") {
          const targetOrder = action.toSlot + 1;
          return prev.map((c) =>
            c.id === action.cardId
              ? { ...c, selectionOrder: targetOrder, isDragDrop: false }
              : c,
          );
        }
        if (action.kind === "tap-unplace") {
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  selectionOrder: null,
                  x: action.toX,
                  y: action.toY,
                  lastTableX: action.toX,
                  lastTableY: action.toY,
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
        if (action.kind === "tap-place") {
          // Undo a tap selection: clear the slot and restore table coords.
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  selectionOrder: null,
                  x: action.fromX,
                  y: action.fromY,
                  lastTableX: action.fromX,
                  lastTableY: action.fromY,
                  isDragDrop: false,
                }
              : c,
          );
        }
        // unplace / tap-unplace: card returns to its slot.
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
      // Convert viewport coords to container coords. Card Y values are
      // produced by buildScatter in [TOP_RESERVE, size.h - cardH] space
      // (we apply `topOffset: TOP_RESERVE` there), so we keep
      // `targetTop` measured from the container border edge and clamp
      // its lower bound to TOP_RESERVE — the ghost lands exactly where
      // a release would snap.
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
        TABLETOP_CONFIG.TOP_RESERVE + TABLETOP_CONFIG.SCATTER_PADDING,
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

  const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
  const ready = selectedCount === required;

  const toggleSelect = (id: number) => {
    let recordedAction: DragAction | null = null;
    setCards((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      // Tapping a slotted card sends it back to the table. The other slots
      // hold their cards (we never compact / shift indices). The returning
      // card lands at a fresh random position so the table reads as
      // "shuffled" rather than the card returning to its origin.
      if (target.selectionOrder !== null) {
        if (usesSlots) {
          recordedAction = {
            kind: "tap-unplace",
            cardId: id,
            fromSlot: target.selectionOrder - 1,
            toX: target.lastTableX,
            toY: target.lastTableY,
          };
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
      if (usesSlots) {
        recordedAction = {
          kind: "tap-place",
          cardId: id,
          toSlot: nextSlot - 1,
          fromX: target.x,
          fromY: target.y,
        };
      }
      return prev.map((c) =>
        c.id === id ? { ...c, selectionOrder: nextSlot, isDragDrop: false } : c,
      );
    });
    if (recordedAction) {
      const action = recordedAction;
      setUndoStack((s) => [...s, action]);
      setRedoStack([]);
    }
  };

  // ---- Tap-only selection -------------------------------------------------
  // Per design: only a deliberate single tap selects/deselects a card. Swipes
  // (drags across cards) must never alter selection state. We implement this
  // per-card on the CardSlot button, tracking the pointer-down position and
  // ignoring the click if the pointer moved beyond a small threshold.
  const TAP_MOVE_THRESHOLD_PX = 8;

  const performExit = () => {
    clearTabletopSession(spread);
    onExit();
  };
  const handleExit = () => {
    if (selectedCount > 0) {
      setExitConfirmOpen(true);
      return;
    }
    performExit();
  };

  // The X icon on the global FloatingMenu mirrors handleExit so the
  // tabletop keeps its single-tap close affordance without owning a
  // top-bar cluster.
  useRegisterCloseHandler(handleExit);

  // Celtic Cross gets a contextual ? icon in the global FloatingMenu
  // that re-opens the position explainer. Other spreads register null.
  useRegisterHelpHandler(
    spread === "celtic" ? () => setCelticHelpOpen(true) : null,
  );

  // Hide the global BottomNav (and the floating quill in /draw) while
  // the seeker is on the table choosing cards. Both reappear once the
  // table unmounts (cast / reading phases) or the route changes.
  useRegisterTabletopActive(true);

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
        { entryMode: "digital" },
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
      {/* AU — manual card entry overlay. Sits above the scatter, lets the
          seeker pick cards directly from a grid (e.g. when logging a
          physical reading they've already pulled). */}
      <button
        type="button"
        onClick={() => setManualOpen(true)}
        className="absolute left-3 top-[calc(env(safe-area-inset-top,0px)+8px)] z-50 inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-cosmos/70 px-3 py-1.5 text-xs text-foreground/80 backdrop-blur hover:bg-gold/10"
        aria-label="Pick cards manually"
      >
        <Hand className="h-3.5 w-3.5" /> Pick manually
      </button>
      {manualOpen && (
        <ManualEntryBuilder
          spread={spread}
          allowReversed={allowReversed}
          onCancel={() => setManualOpen(false)}
          onComplete={(picks) => {
            setManualOpen(false);
            clearTabletopSession(spread);
            // Phase 9.5b Fix 6 — manual entry skips the flip animation
            // entirely. The seeker already knows what cards they placed,
            // so jump straight to the reading/interpretation phase.
            onComplete(
              picks.map((p) => ({
                id: p.id,
                cardIndex: p.cardIndex,
                isReversed: p.isReversed,
              })),
              "reveal",
              { entryMode: "manual" },
            );
          }}
        />
      )}

      {/* Undo / Redo moved into the upper-right cluster below so all
          tabletop chrome sits in one row at the top-right. */}

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

      {/* Per design: all chrome lives in the upper-right cluster. The
          old left-side opacity slider has been removed — opacity is
          configured in Settings → Themes. */}

      {/* Unified top-bar cluster: ScrollText (Oracle) → Wand (sanctuary) →
          Eye (Clarity) → user initial → X. Equal 12px gaps, 44px tap
          targets, X always rightmost. The Undo/Redo buttons sit just to
          the LEFT of the cluster as a separate group (they're transient
          and only appear when the user has done something to undo). */}
      {(undoStack.length > 0 || redoStack.length > 0) && (
        <div
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            // Sit to the left of TopRightControls. The cluster is roughly
            // 5×44px + 4×12px gap ≈ 268px; offset past it so we never
            // overlap. On smaller viewports the cluster wraps naturally.
            right: "calc(env(safe-area-inset-right, 0px) + 240px)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 60,
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            onClick={undo}
            disabled={undoStack.length === 0}
            aria-label="Undo last drag"
            style={{ opacity: restingAlpha }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={redoStack.length === 0}
            aria-label="Redo last drag"
            style={{ opacity: restingAlpha }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Tabletop scatter area */}
      <div
        ref={containerRef}
        className="tabletop-stage relative flex-1 overflow-hidden select-none"
        style={{
          // Reserve a vertical strip for the upper-right icon cluster
          // (44px tap targets + safe-area) so cards never spawn or get
          // dragged behind it. Same reserve on mobile and desktop —
          // a too-small reserve made cards on phones sit under the
          // close button. The matching deduction from the usable scatter
          // height happens in `buildScatter` and the drag clamps below.
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${TABLETOP_CONFIG.TOP_RESERVE}px)`,
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
            tapMoveThresholdPx={TAP_MOVE_THRESHOLD_PX}
            onSelect={() => toggleSelect(c.id)}
            onDragEnd={handleDragEnd}
            onDragMove={handleDragMove}
            isCoarsePointer={isCoarsePointer}
            containerElRef={containerRef}
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
                    {/*
                      Slot label: ALWAYS mounted with a reserved height
                      so toggling the eyeball density doesn't reflow the
                      tabletop. Only opacity / pointer-events change.
                    */}
                    <span
                      className={cn(
                        "font-display italic",
                        isNext && showLabels && "slot-next-label",
                      )}
                      style={{
                        fontSize: "var(--text-body-lg)",
                        color: "var(--gold)",
                        opacity: showLabels ? (isNext ? undefined : restingAlpha) : 0,
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                        pointerEvents: showLabels ? undefined : "none",
                        transition: "opacity 200ms ease-out",
                      }}
                      aria-hidden={!showLabels}
                    >
                      {slotLabels[i] ?? `Slot ${i + 1}`}
                    </span>
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
              gap: 1,
              maxWidth: "min(92vw, 420px)",
            }}
          >
            {/* Line 1: small italic gold "Draw:" word — only when a
                position name follows it. For single-card spreads we
                fall back to a single, larger "Draw". */}
            {usesSlots && nextFullLabel ? (
              <>
                <span
                  className="font-display italic leading-none animate-breathe-glow"
                  style={{
                    fontSize: "var(--text-heading-md)",
                    color: "var(--gold)",
                    opacity: showWhisper ? restingAlpha : 0,
                    lineHeight: 1.15,
                    letterSpacing: "0.06em",
                    textShadow: "0 0 14px rgba(212,175,55,0.55)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                    pointerEvents: "none",
                    transition: "opacity 200ms ease-out",
                  }}
                  aria-hidden={!showWhisper}
                >
                  {`Draw: ${nextFullLabel}`}
                </span>
                {nextDescription && (
                  <span
                    className="font-display italic leading-snug"
                    style={{
                      // Larger so the description reads at a glance —
                      // 16px on mobile, 18px on desktop. Closer to the
                      // slot rail (no top margin) per design.
                      fontSize: isMobile ? 16 : 18,
                      color: "color-mix(in oklab, var(--gold) 55%, transparent)",
                      opacity: showWhisper ? 1 : 0,
                      letterSpacing: "0.03em",
                      textAlign: "center",
                      maxWidth: "100%",
                      pointerEvents: "none",
                      transition: "opacity 200ms ease-out",
                      marginTop: 0,
                    }}
                    aria-hidden={!showWhisper}
                  >
                    {nextDescription}
                  </span>
                )}
              </>
            ) : (
              <span
                className="font-display italic leading-none animate-breathe-glow"
                style={{
                  fontSize: "var(--text-body-lg)",
                  color: "var(--gold)",
                  opacity: showWhisper ? restingAlpha : 0,
                  lineHeight: 1.2,
                  letterSpacing: "0.08em",
                  textShadow: "0 0 14px rgba(212,175,55,0.55)",
                  pointerEvents: "none",
                  transition: "opacity 200ms ease-out",
                }}
                aria-hidden={!showWhisper}
              >
                Draw
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

        // While picking: show the "Draw: <Position>" whisper above the
        // slot rail (or the breathing "Draw" word for single-card spreads).
        // Once the user selects the final card the whisper goes quiet and
        // the gold dot pulses through the auto-transition pause. The
        // whisper element is always mounted so toggling the eyeball
        // (Clarity) density only changes opacity, never layout height.
        const centerWhisper = ready ? transitionCue : drawWord;
        const mobileSlotCounter = null;

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
      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leaveReadingTitle", isOracle)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("leaveReadingBody", isOracle)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel", isOracle)}</AlertDialogCancel>
            <AlertDialogAction onClick={performExit}>
              {t("leaveReadingConfirm", isOracle)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {celticHelpOpen && spread === "celtic" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Celtic Cross — what each position means"
          onClick={() => setCelticHelpOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding:
              "calc(env(safe-area-inset-top, 0px) + 24px) 16px " +
              "calc(env(safe-area-inset-bottom, 0px) + 24px) 16px",
            overflowY: "auto",
          }}
          className="animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "min(92vw, 480px)",
              width: "100%",
              maxHeight: "100%",
              overflowY: "auto",
              borderRadius: 16,
              border: "1px solid color-mix(in oklch, var(--gold) 35%, transparent)",
              background:
                "color-mix(in oklch, var(--background) 92%, transparent)",
              boxShadow:
                "0 24px 64px -12px rgba(0,0,0,0.7), 0 0 32px -8px rgba(212,175,55,0.25)",
              padding: "20px 22px",
              color: "var(--foreground)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="font-display text-lg italic"
                style={{ color: "var(--gold)", letterSpacing: "0.02em" }}
              >
                The Celtic Cross
              </h2>
              <button
                type="button"
                onClick={() => setCelticHelpOpen(false)}
                aria-label="Close help"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gold/80 transition hover:text-gold hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              >
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <p
              className="mt-1 text-xs"
              style={{
                color: "color-mix(in oklab, var(--foreground) 65%, transparent)",
              }}
            >
              Ten positions, each holding a different facet of the question.
            </p>
            <ol className="mt-4 space-y-2.5">
              {fullPositionLabels.map((label, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-[11px]"
                    style={{
                      color: "var(--gold)",
                      border:
                        "1px solid color-mix(in oklch, var(--gold) 45%, transparent)",
                      background:
                        "color-mix(in oklch, var(--gold) 8%, transparent)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="font-display text-[13px] italic"
                      style={{ color: "var(--gold)" }}
                    >
                      {label}
                    </p>
                    {positionDescriptions[i] && (
                      <p
                        className="text-[12px] leading-snug"
                        style={{
                          color:
                            "color-mix(in oklab, var(--foreground) 75%, transparent)",
                        }}
                      >
                        {positionDescriptions[i]}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p
              className="mt-4 text-center text-[11px] italic"
              style={{
                color: "color-mix(in oklab, var(--foreground) 50%, transparent)",
              }}
            >
              Tap anywhere to close
            </p>
          </div>
        </div>
      )}
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
  tapMoveThresholdPx,
  slotRect,
  flightMs,
  containerOrigin,
  onDragEnd,
  onDragMove,
  isCoarsePointer,
  containerRect,
  containerElRef,
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
  /**
   * Live ref to the scatter container element. We always re-measure
   * with `getBoundingClientRect()` at drag start and during
   * `handlePointerMove` because the cached `containerRect` prop can
   * be stale on mobile (e.g. after browser chrome show/hide, address
   * bar collapse, or virtual keyboard) — the root cause of the
   * "card flies to upper-left" bug.
   */
  containerElRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isSelected = card.selectionOrder !== null;
  const cardImg = useActiveDeckImage();
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
      // a return flight from the last known slot position. If we don't
      // have a slotRect cached we still need to leave the flight cleanly
      // — fall back to idle without a fly so the card doesn't blink.
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
      // Capture the card's actual current visual rotation so the launch
      // frame paints at the same orientation, preventing a visible jump.
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
  const draggingRef = useRef(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // After a drag completes, the card re-renders into the absolute "idle"
  // style branch which carries `animation: settle-in 320ms` — that
  // animation starts at `opacity: 0` and is the source of the visible
  // disappear/reappear flicker on release. We track the most recent drag
  // so we can suppress `settle-in` for one render cycle after dropping.
  const wasDraggedRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    currentClientX: number;
    currentClientY: number;
    pointerOffsetX: number; // pointer offset inside the card on grab
    pointerOffsetY: number;
    fromX: number; // card's pre-drag table coords
    fromY: number;
    holdTimer: number | null;
    didDrag: boolean;
  } | null>(null);

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
    setDragging(true);
    if (dragStateRef.current) {
      // Fire one immediate move so the card jumps to the pointer location
      // (it was sitting at its scatter slot during the hold).
      const s = dragStateRef.current;
      // Re-measure the card NOW (not at pointerdown) so the pointer offset
      // matches the card's actual on-screen position at the moment drag
      // begins. This is important on mobile where the card may have shifted
      // between pointerdown and the hold-timer firing (layout shifts,
      // toolbar collapse, settle-in animation completing). Computing the
      // offset against a stale rect produced the "card jumps on grab" bug.
      const cardRect = btnRef.current?.getBoundingClientRect();
      const activeClientX = s.currentClientX;
      const activeClientY = s.currentClientY;
      if (cardRect) {
        s.pointerOffsetX = activeClientX - cardRect.left;
        s.pointerOffsetY = activeClientY - cardRect.top;
      }
      // Convert pointer position to container coords. ALWAYS re-measure
      // the container at drag start — the cached `containerRect` prop
      // can be stale on mobile (browser chrome show/hide, address-bar
      // collapse, layout shifts) which manifested as the "card flies
      // to upper-left" bug. Falling back to the prop, then 0, only as
      // a last resort.
      const freshRect = containerElRef.current?.getBoundingClientRect();
      const cLeft = freshRect?.left ?? containerRect?.left ?? 0;
      // Cards are absolutely positioned, so their `top` coords are
      // relative to the container's BORDER edge (padding does not
      // offset absolutely positioned children). Use the border-edge
      // top directly — TOP_RESERVE is baked into card Y values via
      // buildScatter's `topOffset`, so no per-frame adjustment here.
      const cTop = freshRect?.top ?? containerRect?.top ?? 0;
      setDragPos({
        x: activeClientX - s.pointerOffsetX - cLeft,
        y: activeClientY - s.pointerOffsetY - cTop,
      });
      onDragMove(
        activeClientX,
        activeClientY,
        activeClientX - s.pointerOffsetX,
        activeClientY - s.pointerOffsetY,
      );
    }
  }, [onDragMove, containerRect, containerElRef]);

  // Touch / coarse pointer activates drag faster (80ms) so a quick
  // press-and-move doesn't get treated as a tap. Mouse keeps 150ms.
  const HOLD_MS = isCoarsePointer ? 80 : 150;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (card.revealed) return; // never drag a face-up card
    // Suppress the browser's native drag image / focus outline that would
    // otherwise leave a "ghost" of the card at its original position once
    // the user lifts their finger. Pointer events handle everything.
    e.preventDefault();
    downPosRef.current = { x: e.clientX, y: e.clientY, cancelled: false };
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
      currentClientX: e.clientX,
      currentClientY: e.clientY,
      // Pointer offset inside the card is computed in `beginDrag` against
      // a fresh card rect, not here — the card may move between pointerdown
      // and the hold timer firing. Initialised to 0 as a safe default.
      pointerOffsetX: 0,
      pointerOffsetY: 0,
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
        // On coarse pointers (touch/mobile), activate drag immediately on
        // movement past the threshold rather than waiting for the hold
        // timer. This matches the standard Android drag pattern where a
        // finger that's moving is clearly trying to drag, not tap.
        // Fine pointers (mouse) keep the hold-timer behaviour so a quick
        // mouse drag still feels intentional.
        const s = dragStateRef.current;
        if (isCoarsePointer && s && !draggingRef.current) {
          if (s.holdTimer != null) {
            window.clearTimeout(s.holdTimer);
            s.holdTimer = null;
          }
          beginDrag();
        }
      }
    }
    const s = dragStateRef.current;
    if (!s) return;
    s.currentClientX = e.clientX;
    s.currentClientY = e.clientY;
    if (!draggingRef.current) return;
    s.didDrag = true;
    // Move the card via direct DOM mutation rather than React state so
    // every pointermove doesn't trigger a render. The `dragging` style
    // branch is already active (set once in beginDrag) and uses
    // `position: absolute` with `left`/`top`, so writing those properties
    // here is enough — and crucially avoids any React reconciliation
    // that could momentarily detach the inline styles.
    const el = btnRef.current;
    // Convert viewport coords → container coords using a FRESH measurement.
    // The cached prop can be stale on mobile during a drag (toolbar
    // collapse mid-gesture) so we re-measure every move.
    const freshRect = containerElRef.current?.getBoundingClientRect();
    const cLeft = freshRect?.left ?? containerRect?.left ?? 0;
    // Border edge — absolute children are NOT offset by padding-top.
    const cTop = freshRect?.top ?? containerRect?.top ?? 0;
    if (el) {
      el.style.left = `${e.clientX - s.pointerOffsetX - cLeft}px`;
      el.style.top = `${e.clientY - s.pointerOffsetY - cTop}px`;
    }
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
    const freshRect = containerElRef.current?.getBoundingClientRect();
    const liveRect = freshRect ?? containerRect;
    if (wasDragging && liveRect) {
      // Convert the drop point back into container coordinates (border
      // edge — absolute children ignore padding-top) and clamp inside
      // the visible scatter zone. The lower Y bound is TOP_RESERVE so a
      // card cannot be released under the top bar.
      const targetLeft = clientX - s.pointerOffsetX - liveRect.left;
      const targetTop = clientY - s.pointerOffsetY - liveRect.top;
      const clampedX = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          liveRect.width - cardW - TABLETOP_CONFIG.SCATTER_PADDING,
          targetLeft,
        ),
      );
      const clampedY = Math.max(
        TABLETOP_CONFIG.TOP_RESERVE + TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          liveRect.height - cardH - TABLETOP_CONFIG.SCATTER_PADDING,
          targetTop,
        ),
      );
      onDragEnd(card.id, clientX, clientY, clampedX, clampedY, s.fromX, s.fromY);
    }
    if (wasDragging) {
      // Suppress the `settle-in` fade/scale animation on the next render
      // — the card is already on screen at the drop position, animating
      // it back in from opacity:0 reads as a flicker.
      wasDraggedRef.current = true;
    }
    dragStateRef.current = null;
    draggingRef.current = false;
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

  return (
    <button
      type="button"
      ref={btnRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onMouseDown={(e) => e.preventDefault()}
      onFocus={(e) => e.currentTarget.blur()}
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
        (flying && launchRect && slotRect) ||
        (flightPhase === "returning" && returnFromRect && containerOrigin) ||
        (skipFlight && slotRect) ||
        (dragging && dragPos)
          ? "fixed outline-none focus:outline-none focus-visible:outline-none"
          : "absolute outline-none focus:outline-none focus-visible:outline-none",
        flying || flightPhase === "returning" || dragging
          ? null
          : "card-idle-transition",
        // Remove default tap highlight on iOS / Android.
        "[-webkit-tap-highlight-color:transparent] [touch-action:none]",
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
              // is overridden here. We render with `position: fixed` and
              // viewport coords so the lifted card escapes the
              // tabletop-stage `overflow:hidden` clip and floats above the
              // bottom whisper / slot rail at zIndex 9999.
              left: (containerOrigin?.left ?? 0) + dragPos.x,
              top: (containerOrigin?.top ?? 0) + dragPos.y,
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
              // No translateY lift here: the "-4px" used to fire BEFORE
              // getBoundingClientRect() captured the launch position,
              // causing a one-frame teleport at flight start. The selected
              // glow + halo is enough to communicate selection.
              transform: `rotate(${card.rotation}deg)`,
              // Selected cards (and their numbered badges) must always sit above
              // every unselected card. Use a large constant well above any
              // possible scatter z value.
              zIndex: isSelected ? 1000 + (card.selectionOrder ?? 0) : card.z + 1,
              // Skip the settle-in entrance animation if the card was just
              // dragged — it's already at the drop position and replaying
              // the opacity:0 → 1 fade looks like a disappear/reappear.
              animation: wasDraggedRef.current
                ? "none"
                : `settle-in 320ms ease-out both`,
              animationDelay: wasDraggedRef.current ? "0ms" : `${settleDelay}ms`,
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
              src={cardImg(faceIndex)}
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
    </button>
  );
}