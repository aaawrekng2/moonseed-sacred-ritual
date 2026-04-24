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
 * Loose-grid scatter: divide usable area into cells, jitter each card inside
 * its cell, give it a random rotation, then shuffle stacking order so the
 * deck doesn't read top-left → bottom-right.
 */
export function buildScatter(p: ScatterParams): ScatterCard[] {
  const rng = makeRng(p.seed);

  const usableW = Math.max(1, p.width - p.padding * 2 - p.cardWidth);
  const usableH = Math.max(1, p.height - p.padding * 2 - p.cardHeight);

  // Aim for a roughly card-shaped grid that fits `count` cells.
  const aspect = usableW / Math.max(1, usableH);
  const cols = Math.max(1, Math.round(Math.sqrt(p.count * aspect)));
  const rows = Math.max(1, Math.ceil(p.count / cols));

  const cellW = usableW / cols;
  const cellH = usableH / rows;

  // Jitter inside each cell — keep card center within the cell.
  const jitterX = cellW * 0.55;
  const jitterY = cellH * 0.55;

  const cards: ScatterCard[] = [];
  for (let i = 0; i < p.count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const baseX = p.padding + col * cellW + (cellW - p.cardWidth) / 2;
    const baseY = p.padding + row * cellH + (cellH - p.cardHeight) / 2;
    const dx = (rng() - 0.5) * jitterX;
    const dy = (rng() - 0.5) * jitterY;
    const rot = (rng() - 0.5) * 2 * p.maxRotation;

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