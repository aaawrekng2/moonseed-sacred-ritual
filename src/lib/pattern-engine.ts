/**
 * pattern-engine.ts — the unified statistical pattern engine (v2.40).
 *
 * Pure functions only. No React, no Supabase. Importable from server AND
 * client. Single source of truth for every "is this appearing more than
 * chance predicts" question in Tarot Seed — at the level of an individual
 * card ("stalker"), a suit, a number/rank, a court rank, or the Major Arcana.
 *
 * Two consumers today:
 *   • cardComparison(cardId, draws) — the per-card §9 numbers (observed vs
 *     expected, over-index, rank/percentile, rarity, acute/chronic). Feeds
 *     the per-card popover / Card Trace / gauges.
 *   • detectPatterns(draws) — the unified significance-ranked feed (cards +
 *     groups, frequency + streak detectors, Bonferroni-corrected). Ready for
 *     the Insights → Patterns feed and the Overview stalker meters.
 *
 * The load-bearing safeguard is the multiple-comparisons correction, not the
 * raw p-value threshold. Validated by Monte-Carlo (see
 * tarot_falsepositive_calibration.py): without it ~half of random
 * light-drawer histories get falsely flagged; with it both cohorts land
 * below the 0.5% target.
 *
 * Deck mapping matches src/lib/tarot.ts buildDeck():
 *   0..21  Major Arcana
 *   22..35 Wands  (Ace..Ten, Page, Knight, Queen, King)
 *   36..49 Cups
 *   50..63 Swords
 *   64..77 Pentacles
 */

export const DECK_SIZE = 78;
export const DEFAULT_WINDOWS = [7, 14, 30, 60, 90, 180, 365];
export const DEFAULT_P_THRESHOLD = 0.005;
export const DEFAULT_MIN_SLOTS = 60;

const DAY_MS = 86_400_000;

export type EngineDraw = { cardId: number; timestamp: number; sessionId?: string };

// ─── numerics: exact binomial tail via regularized incomplete beta ──────────

function lgamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** P(X >= k) for X ~ Binomial(N, p). */
export function binomSF(k: number, N: number, p: number): number {
  if (k <= 0) return 1;
  if (k > N) return 0;
  return betai(k, N - k + 1, p);
}

/** P(a group of size s appears in an n-card session drawn without replacement). */
export function qAppear(s: number, n: number, deck: number = DECK_SIZE): number {
  if (n >= deck) return 1;
  return 1 - Math.exp(logChoose(deck - s, n) - logChoose(deck, n));
}

// ─── card → group memberships (numeric cardId 0..77) ────────────────────────

export type CardMembership = {
  suit: "wands" | "cups" | "swords" | "pentacles" | "majors";
  number: string | null; // "n1".."n10" for pip cards, else null
  court: "page" | "knight" | "queen" | "king" | null;
  isMajor: boolean;
};

const SUIT_KEYS = ["wands", "cups", "swords", "pentacles"] as const;
const COURT_KEYS = ["page", "knight", "queen", "king"] as const;

export function cardMemberships(cardId: number): CardMembership {
  if (cardId >= 0 && cardId <= 21) {
    return { suit: "majors", number: null, court: null, isMajor: true };
  }
  const offset = cardId - 22; // 0..55
  const suitIdx = Math.floor(offset / 14); // 0..3
  const rank = offset % 14; // 0..13: 0=Ace..9=Ten, 10=Page,11=Knight,12=Queen,13=King
  const suit = SUIT_KEYS[suitIdx] ?? "wands";
  if (rank <= 9) {
    return { suit, number: "n" + (rank + 1), court: null, isMajor: false };
  }
  return { suit, number: null, court: COURT_KEYS[rank - 10], isMajor: false };
}

/** Group sizes by dimension, matching standardTarotConfig in the handoff. */
export const GROUP_SIZES: Record<string, Record<string, number>> = {
  suit: { wands: 14, cups: 14, swords: 14, pentacles: 14, majors: 22 },
  number: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ["n" + (i + 1), 4])),
  court: { page: 4, knight: 4, queen: 4, king: 4 },
};

/** Total number of group entities across all dimensions (5 + 10 + 4 = 19). */
function totalGroupCount(): number {
  let n = 0;
  for (const dim of Object.keys(GROUP_SIZES)) n += Object.keys(GROUP_SIZES[dim]).length;
  return n;
}

function memberOf(cardId: number, dim: string, key: string): boolean {
  const m = cardMemberships(cardId);
  if (dim === "suit") return m.suit === key;
  if (dim === "number") return m.number === key;
  if (dim === "court") return m.court === key;
  return false;
}

// ─── per-card comparison (§9) ───────────────────────────────────────────────

export type CardComparisonOpts = {
  deckSize?: number;
  windows?: number[];
  pThreshold?: number;
  minSlots?: number;
  now?: number;
};

export type CardComparison =
  | { status: "gathering"; totalSlots: number; needed: number }
  | {
      status: "ok";
      totalSlots: number;
      observed: number; // all-time count of this card (slots)
      expected: number; // totalSlots / deckSize
      overIndex: number; // observed / expected (0 when expected is 0)
      rank: number; // 1 = most-drawn across the full deck
      deckSize: number;
      percentile: number; // 0..1 — fraction of the deck this card outdraws
      best: {
        window: number;
        observed: number;
        expected: number;
        rawP: number;
        oneInN: number; // round(1 / rawP); Infinity when rawP is 0
      } | null;
      adjustedP: number | null; // Bonferroni-corrected best-window p
      isStalker: boolean; // adjustedP < pThreshold
      kind: "acute" | "chronic" | null;
    };

/**
 * Per-card observed-vs-expected comparison computed from a flat slot-level
 * draw log. `draws` is one entry per card slot across the seeker's history
 * (already filtered to whatever universe the caller wants to compare within).
 */
export function cardComparison(
  cardId: number,
  draws: EngineDraw[],
  opts: CardComparisonOpts = {},
): CardComparison {
  const deck = opts.deckSize ?? DECK_SIZE;
  const windows = opts.windows ?? DEFAULT_WINDOWS;
  const pThreshold = opts.pThreshold ?? DEFAULT_P_THRESHOLD;
  const minSlots = opts.minSlots ?? DEFAULT_MIN_SLOTS;
  const now = opts.now ?? Date.now();

  const totalSlots = draws.length;
  if (totalSlots < minSlots) {
    return { status: "gathering", totalSlots, needed: minSlots };
  }

  // Per-card counts across the whole universe.
  const counts = new Map<number, number>();
  for (const d of draws) counts.set(d.cardId, (counts.get(d.cardId) ?? 0) + 1);

  const observed = counts.get(cardId) ?? 0;
  const expected = totalSlots / deck;
  const overIndex = expected > 0 ? observed / expected : 0;

  // Rank (1 = most-drawn) across the FULL deck — unseen cards count as 0.
  let greater = 0;
  let geCount = 0; // distinct seen cards with count >= observed
  for (const c of counts.values()) {
    if (c > observed) greater++;
    if (c >= observed) geCount++;
  }
  const rank = greater + 1;
  const unseen = deck - counts.size;
  const geAll = geCount + (observed <= 0 ? unseen : 0);
  const lessAll = Math.max(0, deck - geAll);
  const percentile = deck > 0 ? lessAll / deck : 0;

  // Most-surprising window (lowest binomial-tail p, k >= 2).
  let best: {
    window: number;
    observed: number;
    expected: number;
    rawP: number;
    oneInN: number;
  } | null = null;
  for (const W of windows) {
    const cutoff = now - W * DAY_MS;
    let N = 0;
    let k = 0;
    for (const d of draws) {
      if (d.timestamp >= cutoff) {
        N++;
        if (d.cardId === cardId) k++;
      }
    }
    if (k < 2) continue;
    const rawP = binomSF(k, N, 1 / deck);
    if (!best || rawP < best.rawP) {
      best = {
        window: W,
        observed: k,
        expected: Number((N / deck).toFixed(2)),
        rawP,
        oneInN: rawP > 0 ? Math.round(1 / rawP) : Infinity,
      };
    }
  }

  // Bonferroni correction across the full test count (cards + groups × windows
  // + group streaks), matching the validated harness.
  const seenCards = counts.size;
  const nGroups = totalGroupCount();
  const nTests = seenCards * windows.length + nGroups * windows.length + nGroups;
  const adjustedP = best ? Math.min(1, best.rawP * nTests) : null;
  const isStalker = adjustedP !== null && adjustedP < pThreshold;
  const kind = best ? (best.window <= 14 ? "acute" : "chronic") : null;

  return {
    status: "ok",
    totalSlots,
    observed,
    expected,
    overIndex,
    rank,
    deckSize: deck,
    percentile,
    best,
    adjustedP,
    isStalker,
    kind,
  };
}

// ─── unified pattern feed (cards + groups, frequency + streak) ───────────────

export type PatternResult = {
  dimension: "card" | "suit" | "number" | "court";
  label: string; // group key, or String(cardId) for cards
  cardId: number | null; // set when dimension === "card"
  type: "frequency" | "streak";
  window: number | null; // frequency only
  observed: number;
  expected: number | null; // frequency only
  runLength: number | null; // streak only
  rawP: number;
  adjustedP: number;
  kind: "acute" | "chronic";
};

export type DetectOpts = CardComparisonOpts & { topN?: number };

export type DetectResult =
  | { status: "gathering"; totalSlots: number; needed: number; patterns: [] }
  | { status: "ok"; totalSlots: number; nTests: number; patterns: PatternResult[] };

type Entity = {
  dim: "card" | "suit" | "number" | "court";
  key: string;
  cardId: number | null;
  size: number;
  has: (id: number) => boolean;
};

/**
 * The unified significance-ranked pattern feed. Built now and ready for the
 * Patterns feed / Overview meters; not yet wired into a surface.
 */
export function detectPatterns(draws: EngineDraw[], opts: DetectOpts = {}): DetectResult {
  const deck = opts.deckSize ?? DECK_SIZE;
  const windows = opts.windows ?? DEFAULT_WINDOWS;
  const pThreshold = opts.pThreshold ?? DEFAULT_P_THRESHOLD;
  const minSlots = opts.minSlots ?? DEFAULT_MIN_SLOTS;
  const topN = opts.topN ?? 5;
  const now = opts.now ?? Date.now();

  const totalSlots = draws.length;
  if (totalSlots < minSlots) {
    return { status: "gathering", totalSlots, needed: minSlots, patterns: [] };
  }

  // Sessions: group by sessionId, else by calendar day (UTC slice is fine —
  // streak math only needs consistent bucketing, not the seeker's tz).
  const bySession = new Map<string, { t: number; cards: number[] }>();
  for (const d of draws) {
    const key = d.sessionId ?? new Date(d.timestamp).toISOString().slice(0, 10);
    const s = bySession.get(key);
    if (!s) bySession.set(key, { t: d.timestamp, cards: [d.cardId] });
    else {
      s.cards.push(d.cardId);
      s.t = Math.max(s.t, d.timestamp);
    }
  }
  const sessions = [...bySession.values()].sort((a, b) => a.t - b.t);

  // Entities: every distinct card + every group.
  const entities: Entity[] = [];
  const seenCards = new Set(draws.map((d) => d.cardId));
  for (const c of seenCards) {
    entities.push({ dim: "card", key: String(c), cardId: c, size: 1, has: (id) => id === c });
  }
  for (const dim of Object.keys(GROUP_SIZES) as Array<"suit" | "number" | "court">) {
    for (const [key, size] of Object.entries(GROUP_SIZES[dim])) {
      entities.push({ dim, key, cardId: null, size, has: (id) => memberOf(id, dim, key) });
    }
  }

  const nGroups = totalGroupCount();
  const nTests = seenCards.size * windows.length + nGroups * windows.length + nGroups;

  const results: PatternResult[] = [];

  // Frequency tests (stalkers + clusters).
  for (const e of entities) {
    let best: { window: number; observed: number; expected: number; rawP: number } | null = null;
    for (const W of windows) {
      const cutoff = now - W * DAY_MS;
      let N = 0;
      let k = 0;
      for (const d of draws) {
        if (d.timestamp >= cutoff) {
          N++;
          if (e.has(d.cardId)) k++;
        }
      }
      if (k < 2) continue;
      const rawP = binomSF(k, N, e.size / deck);
      if (!best || rawP < best.rawP) {
        best = { window: W, observed: k, expected: Number(((N * e.size) / deck).toFixed(2)), rawP };
      }
    }
    if (best) {
      results.push({
        dimension: e.dim,
        label: e.key,
        cardId: e.cardId,
        type: "frequency",
        window: best.window,
        observed: best.observed,
        expected: best.expected,
        runLength: null,
        rawP: best.rawP,
        adjustedP: Math.min(1, best.rawP * nTests),
        kind: best.window <= 14 ? "acute" : "chronic",
      });
    }
  }

  // Streak tests (groups only — session-size-aware q).
  for (const e of entities) {
    if (e.dim === "card") continue;
    let p = 1;
    let run = 0;
    let runDays = 0;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      if (!s.cards.some((id) => e.has(id))) break;
      p *= qAppear(e.size, s.cards.length, deck);
      run++;
      runDays = Math.round((now - s.t) / DAY_MS) + 1;
    }
    if (run >= 2) {
      results.push({
        dimension: e.dim,
        label: e.key,
        cardId: null,
        type: "streak",
        window: null,
        observed: run,
        expected: null,
        runLength: run,
        rawP: p,
        adjustedP: Math.min(1, p * nTests),
        kind: runDays <= 14 ? "acute" : "chronic",
      });
    }
  }

  // Filter to corrected-significant, rank by raw p, dedupe per entity.
  const sig = results
    .filter((r) => r.adjustedP < pThreshold)
    .sort((a, b) => a.rawP - b.rawP);
  const seen = new Set<string>();
  const out: PatternResult[] = [];
  for (const r of sig) {
    const id = r.dimension + ":" + r.label;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
    if (out.length >= topN) break;
  }

  return { status: "ok", totalSlots, nTests, patterns: out };
}

/** Build a flat slot-level draw log from readings (one entry per card slot). */
export function drawsFromReadings(
  readings: Array<{ created_at: string; card_ids: number[] | null }>,
): EngineDraw[] {
  const draws: EngineDraw[] = [];
  for (const r of readings) {
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) continue;
    for (const id of r.card_ids ?? []) draws.push({ cardId: id, timestamp: t, sessionId: undefined });
  }
  return draws;
}
