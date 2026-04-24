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
 * Loose-grid scatter (10×9 = 90 cells, pick `count` of them so some cells
 * stay empty for natural gaps). Each card is offset within ±40% of its cell
 * and given a visible rotation. Stacking order is shuffled.
 */
export function buildScatter(p: ScatterParams): ScatterCard[] {
  const rng = makeRng(p.seed);

  const cols = 10;
  const rows = 9;
  const totalCells = cols * rows;
  const pick = Math.min(p.count, totalCells);

  const usableW = Math.max(1, p.width - p.padding * 2);
  const usableH = Math.max(1, p.height - p.padding * 2);
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  // ±40% of cell size → range = 0.8 * cell.
  const jitterX = cellW * 0.8;
  const jitterY = cellH * 0.8;

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
    const baseX = p.padding + col * cellW + (cellW - p.cardWidth) / 2;
    const baseY = p.padding + row * cellH + (cellH - p.cardHeight) / 2;
    const dx = (rng() - 0.5) * jitterX;
    const dy = (rng() - 0.5) * jitterY;

    // Rotation: ±maxRotation, but never axis-aligned (min |1°|).
    let rot = (rng() - 0.5) * 2 * p.maxRotation;
    if (Math.abs(rot) < 1) rot = rot < 0 ? -1 : 1;

    const x = clamp(baseX + dx, p.padding, p.width - p.padding - p.cardWidth);
    const y = clamp(baseY + dy, p.padding, p.height - p.padding - p.cardHeight);

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