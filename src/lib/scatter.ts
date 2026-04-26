// Generates "shuffled on a table" positions for the 78 face-down cards.
// Uses a seeded RNG so a given seed produces stable positions during a session.

export type ScatterCard = {
  id: number;
  x: number; // px from container left, top-left of card
  y: number; // px from container top, top-left of card
  rotation: number; // degrees
  z: number; // stacking order (0..N-1)
};

export type ScatterParams = {
  width: number;
  height: number;
  count: number;
  cardWidth: number;
  cardHeight: number;
  maxRotation: number;
  padding: number;
  seed: number;
  /**
   * Optional rectangular no-spawn zones in container coordinates. Cards whose
   * un-rotated bounding box overlaps any zone are nudged elsewhere. Used to
   * keep the scatter clear of fixed UI like the top-right close button.
   */
  exclusionZones?: { x: number; y: number; w: number; h: number }[];
  /**
   * Minimum fraction of each card that must remain visible (not covered by
   * later-stacked cards). Defaults to 0.3 (30%). Cards that fall below this
   * threshold get nudged to a free-er position.
   */
  minVisibleRatio?: number;
  /**
   * Vertical offset (px) added to every card's `y` so the field starts
   * below a fixed top strip (e.g. the reserved zone for the top bar).
   * `height` should still be the *usable* height (i.e. exclude this
   * strip) — the offset only translates the final positions.
   */
  topOffset?: number;
};

// Mulberry32 — small, fast, deterministic.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Loose-grid scatter. Grid shape adapts to viewport so cards fill space
 * evenly across phones, tablets, and desktops. Each card is offset within
 * ±30% of its cell and given a visible rotation. Stacking order is shuffled.
 */
export function buildScatter(p: ScatterParams): ScatterCard[] {
  const rng = makeRng(p.seed);

  // Adaptive grid: portrait phones get tall grids; desktop wide grids.
  let cols: number;
  let rows: number;
  if (p.width < 768) {
    cols = 8;
    rows = 11;
  } else if (p.width < 1024) {
    cols = 9;
    rows = 10;
  } else {
    cols = 10;
    rows = 9;
  }
  const totalCells = cols * rows;
  const pick = Math.min(p.count, totalCells);

  // Rotated bounding box of the card at maxRotation (worst case).
  // A rotated rect of (w,h) at angle θ has bbox
  //   bw = |w·cosθ| + |h·sinθ|, bh = |w·sinθ| + |h·cosθ|
  const theta = (p.maxRotation * Math.PI) / 180;
  const cosT = Math.abs(Math.cos(theta));
  const sinT = Math.abs(Math.sin(theta));
  const bboxW = p.cardWidth * cosT + p.cardHeight * sinT;
  const bboxH = p.cardWidth * sinT + p.cardHeight * cosT;

  // Extra horizontal/vertical slack from rotation (half on each side, since we
  // position by the un-rotated top-left but the visual extends symmetrically
  // around the center).
  const rotSlackX = (bboxW - p.cardWidth) / 2;
  const rotSlackY = (bboxH - p.cardHeight) / 2;

  // Effective inner padding accounts for rotation slack so a tilted card never
  // pokes past the container edge — critical on narrow portrait viewports.
  const padX = p.padding + rotSlackX;
  const padY = p.padding + rotSlackY;

  // If the container is too small to fit even one card with full padding,
  // gracefully shrink padding rather than producing negative usable space.
  const safePadX = Math.min(padX, Math.max(0, (p.width - p.cardWidth) / 2));
  const safePadY = Math.min(padY, Math.max(0, (p.height - p.cardHeight) / 2));

  const usableW = Math.max(1, p.width - safePadX * 2);
  const usableH = Math.max(1, p.height - safePadY * 2);
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  // ±30% of cell size → range = 0.6 * cell. Slightly tighter than ±40%
  // so the field reads as fuller and more even.
  const jitterX = cellW * 0.6;
  const jitterY = cellH * 0.6;

  // Shuffle cell indices and take the first `pick`.
  const cellOrder = Array.from({ length: totalCells }, (_, i) => i);
  for (let i = cellOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cellOrder[i], cellOrder[j]] = [cellOrder[j], cellOrder[i]];
  }
  const chosen = cellOrder.slice(0, pick).sort((a, b) => a - b);

  const cards: ScatterCard[] = [];
  for (let i = 0; i < pick; i++) {
    const cell = chosen[i];
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const baseX = safePadX + col * cellW + (cellW - p.cardWidth) / 2;
    const baseY = safePadY + row * cellH + (cellH - p.cardHeight) / 2;
    const dx = (rng() - 0.5) * jitterX;
    const dy = (rng() - 0.5) * jitterY;

    // Rotation: uniform in [-maxRotation, +maxRotation], snapped away from
    // 0° so every card visibly tilts. Per design: 8° is significant — the
    // full range must be used so the table looks scattered, not mechanical.
    let rot = rng() * (p.maxRotation * 2) - p.maxRotation;
    if (Math.abs(rot) < 1) rot = rot >= 0 ? 1 : -1;

    // Clamp using the rotation-aware safe padding so the rotated bbox
    // (not just the un-rotated top-left rect) stays inside the container.
    let x = clamp(baseX + dx, safePadX, p.width - safePadX - p.cardWidth);
    let y = clamp(baseY + dy, safePadY, p.height - safePadY - p.cardHeight);

    // Avoid exclusion zones (e.g. the X close button hit area). Try several
    // jittered positions; if none clear, fall back to a deterministic safe
    // corner so cards never sit beneath fixed UI.
    if (p.exclusionZones && p.exclusionZones.length > 0) {
      let attempts = 0;
      while (
        attempts < 12 &&
        intersectsAny(x, y, p.cardWidth, p.cardHeight, p.exclusionZones)
      ) {
        const ndx = (rng() - 0.5) * jitterX * 2;
        const ndy = (rng() - 0.5) * jitterY * 2;
        x = clamp(baseX + ndx, safePadX, p.width - safePadX - p.cardWidth);
        y = clamp(baseY + ndy, safePadY, p.height - safePadY - p.cardHeight);
        attempts++;
      }
      if (intersectsAny(x, y, p.cardWidth, p.cardHeight, p.exclusionZones)) {
        // Hard fallback: bottom-left corner is always far from the X button.
        x = safePadX;
        y = p.height - safePadY - p.cardHeight;
      }
    }

    cards.push({ id: i, x, y, rotation: rot, z: i });
  }

  // Shuffle z-order using Fisher–Yates so overlap looks organic.
  const order = cards.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((cardIdx, z) => {
    cards[cardIdx].z = z;
  });

  // Enforce minimum visibility: any card more than (1 - minVisibleRatio)
  // covered by higher-z cards gets nudged to a freer spot.
  const minVisible = p.minVisibleRatio ?? 0.3;
  enforceMinVisibility(cards, p, minVisible, rng);

  // Apply the top-strip offset last, after all positioning + nudging is
  // complete, so layout math stays in 0..height space and only the
  // final emitted Y values are translated.
  if (p.topOffset && p.topOffset !== 0) {
    for (const c of cards) c.y += p.topOffset;
  }

  return cards;
}

function intersectsAny(
  x: number,
  y: number,
  w: number,
  h: number,
  zones: { x: number; y: number; w: number; h: number }[],
): boolean {
  for (const z of zones) {
    if (x < z.x + z.w && x + w > z.x && y < z.y + z.h && y + h > z.y) {
      return true;
    }
  }
  return false;
}

function rectOverlapArea(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const ow = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const oh = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return ow * oh;
}

function visibleRatio(card: ScatterCard, higher: ScatterCard[], cw: number, ch: number): number {
  const area = cw * ch;
  if (area <= 0) return 1;
  // Approximate covered area as the sum of pairwise overlaps with higher-z
  // cards, capped at the card's own area. This overcounts when higher cards
  // overlap each other but is plenty for a "≥30% visible" heuristic.
  let covered = 0;
  for (const o of higher) {
    covered += rectOverlapArea(card.x, card.y, cw, ch, o.x, o.y, cw, ch);
    if (covered >= area) break;
  }
  return Math.max(0, 1 - Math.min(area, covered) / area);
}

function enforceMinVisibility(
  cards: ScatterCard[],
  p: ScatterParams,
  minVisible: number,
  rng: () => number,
) {
  // Sort references by z so we can quickly pull "higher" cards (greater z).
  const byZ = [...cards].sort((a, b) => a.z - b.z);
  for (let i = 0; i < byZ.length; i++) {
    const c = byZ[i];
    const higher = byZ.slice(i + 1);
    if (visibleRatio(c, higher, p.cardWidth, p.cardHeight) >= minVisible) continue;
    // Try up to 16 random repositions to find a spot meeting the threshold.
    for (let attempt = 0; attempt < 16; attempt++) {
      const nx = clamp(
        rng() * (p.width - p.cardWidth),
        0,
        Math.max(0, p.width - p.cardWidth),
      );
      const ny = clamp(
        rng() * (p.height - p.cardHeight),
        0,
        Math.max(0, p.height - p.cardHeight),
      );
      if (
        p.exclusionZones &&
        intersectsAny(nx, ny, p.cardWidth, p.cardHeight, p.exclusionZones)
      ) {
        continue;
      }
      const candidate = { ...c, x: nx, y: ny };
      if (visibleRatio(candidate, higher, p.cardWidth, p.cardHeight) >= minVisible) {
        c.x = nx;
        c.y = ny;
        break;
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Returns a permutation of 0..n-1 for the deck (which card face is "drawn")
 * using the same seed so refreshing within a session is stable.
 */
export function shuffleDeck(n: number, seed: number): number[] {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}