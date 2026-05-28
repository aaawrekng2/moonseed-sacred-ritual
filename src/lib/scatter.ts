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

  // Rotated bounding box of the card at maxRotation (worst case).
  // A rotated rect of (w,h) at angle θ has bbox
  //   bw = |w·cosθ| + |h·sinθ|, bh = |w·sinθ| + |h·cosθ|
  // EK01 — Moved above the rows/cols block so effCardH below can use
  // cosT/sinT to size cells for the rotated card silhouette.
  const theta = (p.maxRotation * Math.PI) / 180;
  const cosT = Math.abs(Math.cos(theta));
  const sinT = Math.abs(Math.sin(theta));
  const bboxW = p.cardWidth * cosT + p.cardHeight * sinT;
  const bboxH = p.cardWidth * sinT + p.cardHeight * cosT;

  // EK01 — Grid dimensions derived from CARD GEOMETRY vs viewport,
  // not hardcoded width buckets. The previous bucket scheme (8×11 mobile
  // / 9×10 tablet / 10×9 desktop) didn't account for actual card height:
  // on tablet (e.g. 800×600 viewport with cards forced to 60×96px by the
  // density formula's floor), 10 rows produced 60px-tall cells holding
  // 96px-tall cards. Every card overflowed its cell, the visibility-
  // relocation pass ran overtime, and cards clumped along the edges
  // ("the shape" Cori reported). Mobile escaped because its tall narrow
  // grid happened to produce taller cells; desktop escaped because its
  // density formula gave smaller cards relative to height.
  //
  // New approach: rows = floor(usableH / effCardH) so every cell is at
  // least one rotated-card-height tall, then cols = ceil(count / rows)
  // so there's always enough cells for the deck. Self-corrects on every
  // viewport (mobile portrait, mobile landscape, tablet portrait/
  // landscape, desktop, ultra-wide) without per-breakpoint tuning.
  const effCardH = p.cardHeight * cosT + p.cardWidth * sinT;
  const provisionalUsableH = Math.max(1, p.height - p.padding * 2);
  let rows = Math.max(1, Math.floor(provisionalUsableH / Math.max(1, effCardH)));
  rows = Math.min(rows, p.count); // never more rows than cards
  const cols = Math.max(1, Math.ceil(p.count / rows));
  const totalCells = cols * rows;
  const pick = Math.min(p.count, totalCells);

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

  // Q68 — tightened jitter from ±30% to ±22.5% so the scatter reads
  // organic but calmer (less collision, fewer near-overlaps that the
  // visibility-pass has to fix up).
  const jitterX = cellW * 0.45;
  const jitterY = cellH * 0.45;

  // Shuffle cell indices and take the first `pick`.
  const cellOrder = Array.from({ length: totalCells }, (_, i) => i);
  for (let i = cellOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cellOrder[i], cellOrder[j]] = [cellOrder[j], cellOrder[i]];
  }
  // EJ75 — Removed the ascending `.sort((a, b) => a - b)` that used to
  // run here. On desktop/tablet the grid has more cells than cards
  // (90 cells for 78 cards). Sorting cell indices ascending meant the
  // chosen subset filled rows top-down: the last ~12 unused cells
  // always clustered at the bottom, packing cards into the top of the
  // table. Combined with the visibility-relocation pass that nudges
  // overlapping cards toward open space, this produced the
  // top-heavy-with-side-columns shape Cori reported — worst on tablet,
  // invisible on mobile (whose tall narrow grid spread cards evenly
  // regardless). Without the sort, the picked cells stay in their
  // shuffled order, distributing cards across the full grid evenly.
  const chosen = cellOrder.slice(0, pick);

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

function visibleRatio(
  card: ScatterCard,
  higher: ScatterCard[],
  cw: number,
  ch: number,
  maxRotation: number,
): number {
  // EJ66 — Rasterized visibility. Previously this function summed
  // pairwise axis-aligned overlaps as if higher cards didn't overlap
  // each other, with a comment that "overcounts when higher cards
  // overlap but is plenty for a 30% heuristic." At the new 90%
  // target that overcount rejected genuinely-good positions, so
  // cards stayed stuck in their original failing spots.
  //
  // The new approach rasterizes the card into a small grid (24x36 =
  // 864 cells) and marks each cell covered by ANY higher card. The
  // visibility ratio is uncovered / total, which is exact within
  // grid resolution and correctly handles overlapping coverers.
  //
  // Higher cards are tested using their ROTATED axis-aligned bbox
  // (the worst-case envelope of the rotated rect) so a tilted card
  // doesn't get falsely reported as "not covering" the card below.
  const GRID_X = 24;
  const GRID_Y = 36;
  // Rotation-aware bbox for higher cards. theta = maxRotation.
  const theta = (maxRotation * Math.PI) / 180;
  const cosT = Math.abs(Math.cos(theta));
  const sinT = Math.abs(Math.sin(theta));
  const bboxW = cw * cosT + ch * sinT;
  const bboxH = cw * sinT + ch * cosT;
  const slackX = (bboxW - cw) / 2;
  const slackY = (bboxH - ch) / 2;
  // Precompute higher cards' expanded bboxes (center ± half-bbox).
  const higherBoxes = higher.map((o) => ({
    left: o.x - slackX,
    top: o.y - slackY,
    right: o.x + cw + slackX,
    bottom: o.y + ch + slackY,
  }));
  let covered = 0;
  const cellW = cw / GRID_X;
  const cellH = ch / GRID_Y;
  for (let gy = 0; gy < GRID_Y; gy++) {
    const py = card.y + (gy + 0.5) * cellH;
    for (let gx = 0; gx < GRID_X; gx++) {
      const px = card.x + (gx + 0.5) * cellW;
      // Cell covered if ANY higher card's expanded bbox contains it.
      for (let i = 0; i < higherBoxes.length; i++) {
        const b = higherBoxes[i];
        if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) {
          covered++;
          break;
        }
      }
    }
  }
  const total = GRID_X * GRID_Y;
  return (total - covered) / total;
}

function enforceMinVisibility(
  cards: ScatterCard[],
  p: ScatterParams,
  minVisible: number,
  rng: () => number,
) {
  // EJ66 — More attempts (100 vs 16) because the search space gets
  // dramatically tighter at 90% than at 30%. Also: track the BEST
  // candidate found across all attempts so cards never end up worse
  // off than they started, even if no position meets the threshold.
  // The original implementation kept the failing position when no
  // attempt cleared the bar, leaving the seeker with cards 30%
  // visible despite asking for 90%.
  //
  // Strategy: random-direction nudges from the card's current
  // position (Cori's "move it a random direction that's still in
  // the visible area"), with the search radius growing with each
  // attempt so we explore locally first then sweep wider.
  const byZ = [...cards].sort((a, b) => a.z - b.z);
  for (let i = 0; i < byZ.length; i++) {
    const c = byZ[i];
    const higher = byZ.slice(i + 1);
    const initialVis = visibleRatio(c, higher, p.cardWidth, p.cardHeight, p.maxRotation);
    if (initialVis >= minVisible) continue;
    // Track the best (position, visibility) found across attempts.
    let bestX = c.x;
    let bestY = c.y;
    let bestVis = initialVis;
    const ATTEMPTS = 100;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      // Random-direction nudge from the original position. Radius
      // grows from 0.5x card width on early attempts to 2.0x card
      // width on later ones, so we explore locally first.
      const radiusFactor = 0.5 + (1.5 * attempt) / ATTEMPTS;
      const radius = p.cardWidth * radiusFactor;
      const angle = rng() * Math.PI * 2;
      const dx = Math.cos(angle) * radius * rng();
      const dy = Math.sin(angle) * radius * rng();
      const nx = clamp(
        c.x + dx,
        0,
        Math.max(0, p.width - p.cardWidth),
      );
      const ny = clamp(
        c.y + dy,
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
      const v = visibleRatio(candidate, higher, p.cardWidth, p.cardHeight, p.maxRotation);
      if (v > bestVis) {
        bestVis = v;
        bestX = nx;
        bestY = ny;
        if (v >= minVisible) break; // Met the target — stop searching.
      }
    }
    // Commit the best position found. If we hit minVisible, this is
    // the first qualifying candidate; otherwise it's the highest-
    // visibility candidate from all 100 attempts — guaranteed to be
    // no worse than the starting position.
    c.x = bestX;
    c.y = bestY;
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
