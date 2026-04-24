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

    // Rotation: ±maxRotation, but never axis-aligned (min |1°|).
    let rot = (rng() - 0.5) * 2 * p.maxRotation;
    if (Math.abs(rot) < 1) rot = rot < 0 ? -1 : 1;

    // Clamp using the rotation-aware safe padding so the rotated bbox
    // (not just the un-rotated top-left rect) stays inside the container.
    const x = clamp(baseX + dx, safePadX, p.width - safePadX - p.cardWidth);
    const y = clamp(baseY + dy, safePadY, p.height - safePadY - p.cardHeight);

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

  return cards;
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