import type { CardState, TabletopSession } from "./types";

export const TABLETOP_CONFIG = {
  // 9-6-V — was 1.75; closer to typical tarot 5:8 (1.6).
  CARD_ASPECT_RATIO: 1.6,
  // Cards on the table spawn at random tilts between ±6° to give the
  // scatter an organic, hand-tossed feel. The adaptive curve below scales
  // this down on narrow portrait widths so cards don't visually overflow.
  CARD_MAX_ROTATION: 6,
  // Q67 — viewport-aware: 10 on mobile, 24 on desktop. Use
  // `scatterPadding()` helper below when reading at runtime.
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
    typeof window !== "undefined" && window.innerWidth < 768 ? 96 : 72,
  SELECTION_GLOW_SPREAD: 6,
  SELECTION_GLOW_OPACITY: 0.8,
  // Slow, ceremonial flip — long enough to feel reverent without
  // dragging. Paired with sacred-reveal-lift in styles.css.
  REVEAL_ANIMATION_MS: 600,
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

export function scatterPadding(viewportW?: number): number {
  const w =
    viewportW ??
    (typeof window !== "undefined" ? window.innerWidth : 0);
  return w >= 768 ? 24 : 10;
}

export function responsiveCardWidth(viewportW: number): number {
  // Mobile uses a tuned static value — kept as-is to avoid regressing
  // mobile layouts that already work well at 38px.
  if (viewportW < 768) return 38;

  // DF-2 — Desktop uses a density-based formula. Targets ~70% deck-area
  // density: cards fill 70% of available scatter area, leaving 30%
  // breathing room. Result scales naturally from small laptops
  // (~1024px → ~58px cards) to large monitors (~2560px → ~95px cards).
  const viewportH =
    typeof window !== "undefined" ? window.innerHeight : 720;
  const scatterH = viewportH * 0.6;
  // Q67 — was 0.7. Reduced to 0.5 for larger cards + more breathing
  // room on desktop/iPad. Mobile is unchanged (early return above).
  const density = 0.5;
  const aspectRatio = TABLETOP_CONFIG.CARD_ASPECT_RATIO;
  const deckSize = TABLETOP_CONFIG.DECK_SIZE;
  const computed = Math.sqrt(
    (viewportW * scatterH * density) / (deckSize * aspectRatio),
  );
  // Floor and ceiling so unusual viewports don't produce tiny or
  // gigantic cards.
  return Math.max(50, Math.min(110, Math.round(computed)));
}

/**
 * Per-spread slot dimensions. Slots are sized differently from the table
 * cards because the rail must fit a fixed number of positions in one row
 * with no horizontal scrolling, even on narrow phones (10 for Celtic).
 *
 * Returns the visible slot card width — height is derived from
 * CARD_ASPECT_RATIO.
 */
export function responsiveSlotWidth(viewportW: number, count: number): number {
  // Q19 Fix 4 — viewport-aware slot rail sizing. Previous step-table
  // returned fixed widths per count which caused 7-9 card spreads to
  // overflow on narrow phones. Compute the largest slot that lets the
  // entire rail fit in one row given the live viewport width, the
  // gap between slots, and an upper/lower bound that keeps the slots
  // legible without dwarfing the rest of the table.
  if (count <= 0 || viewportW <= 0) return 48;
  const isMobile = viewportW < TABLETOP_CONFIG.MOBILE_BREAKPOINT;
  // Q73 Fix 8 — bumped by 8px each side so the rail inner flex has
  // padding room for the breathing beacon glow to render without
  // clipping the leftmost / rightmost slot.
  const railPad = isMobile ? 40 : 48;
  const gap = slotGap(count, isMobile);
  const usable = Math.max(0, viewportW - railPad * 2 - gap * (count - 1));
  const naive = Math.floor(usable / count);
  const baseMinW = isMobile ? 24 : 36;
  const maxW = isMobile
    ? count <= 3
      ? 56
      : 48
    : count <= 3
      ? 100
      : count <= 5
        ? 80
        : 64;
  // Q67 — if even the naive width can fit, use it. Otherwise reduce
  // minW until the rail fits, with an absolute floor of 16px. Callers
  // can detect the "doesn't fit" state by comparing slot rail total
  // against viewport (see `slotRailFitsViewport`).
  if (naive >= baseMinW) return Math.min(maxW, naive);
  return Math.max(16, naive);
}

/**
 * Q67 — does the slot rail (`count` slots @ `slotW` + gaps + padding)
 * fit within `viewportW`? When false, the rail should switch to
 * horizontal scrolling with edge fades.
 */
export function slotRailFitsViewport(
  viewportW: number,
  count: number,
  slotW: number,
): boolean {
  if (count <= 0 || viewportW <= 0) return true;
  const isMobile = viewportW < TABLETOP_CONFIG.MOBILE_BREAKPOINT;
  const railPad = isMobile ? 40 : 48;
  const gap = slotGap(count, isMobile);
  const total = slotW * count + gap * (count - 1) + railPad * 2;
  return total <= viewportW;
}

/**
 * Q68 — single source of truth for the slot-rail gap. Tabletop's DOM
 * uses this value as an inline style (replacing the old gap-1/gap-2
 * Tailwind classes) so the rendered gap matches what
 * `responsiveSlotWidth` assumes when laying out the rail. Without this
 * the math drifts by 1–2px per gap on mobile and pushes the last slot
 * off-screen for 8+ card custom spreads.
 */
export function slotGap(count: number, isMobile: boolean): number {
  return count >= 10 ? 4 : isMobile ? 6 : 8;
}

export function pickReturnSpot(
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

const tabletopSessions = new Map<string, TabletopSession>();

export function readTabletopSession(spread: string): TabletopSession | null {
  return tabletopSessions.get(spread) ?? null;
}
export function writeTabletopSession(spread: string, snapshot: TabletopSession) {
  tabletopSessions.set(spread, snapshot);
}
export function clearTabletopSession(spread: string) {
  tabletopSessions.delete(spread);
}
