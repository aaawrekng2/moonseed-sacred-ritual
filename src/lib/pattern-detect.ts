/**
 * v3.32 — Pattern detection for the Insights → Patterns strip.
 *
 * Given the hero card and the filtered reading universe, runs the four ordinal
 * lenses (moon phase / day-of-month / numerology / day-of-week) plus the
 * asterism co-occurrence check, and returns any statistically real pattern —
 * a bucket the hero's draws pile into far more than the seeker's OWN cadence
 * would predict.
 *
 * Method (locked with Cori):
 *  - Null baseline = her own draw-days, NOT uniform. p0 for a bucket = fraction
 *    of ALL her draw-days that fall in it, so tz/calendar/habits are absorbed.
 *  - ±1 calendar-day kernel: ON the pattern day scores 1; day before/after 1/3;
 *    further 0. Same rule in every lens.
 *  - Weighted binomial; exact p by DP convolution over integer weights {0,1,3}.
 *  - Gates: n ≥ 6 draws, ≥ 4 EXACT hits, lift ≥ 2, p ≤ 0.01 / (lenses tested).
 *  - Asterism: support ≥ 3 pulls, lift ≥ 3 vs independence.
 *
 * v3.32 PERF: the caller passes ymd strings already resolved in the seeker's tz.
 * Every feature (weekday, day-of-month, personal day, ±1 neighbour) is therefore
 * a PURE function of that local date — computed with integer math, no Date, no
 * timezone conversion. This removes the tens of thousands of tz conversions the
 * v3.31 build did per run (the slowdown). No @/lib/time dependency; no banned
 * Date methods (Section 25 stays satisfied — nothing here touches a Date).
 */
import { personalDay } from "./numerology";

export type LensKey = "moon" | "day" | "numerology" | "weekday";

export interface PatternReading {
  ymd: string; // local calendar day in the seeker's tz, "YYYY-MM-DD"
  cardIds: number[];
}
export interface PatternInput {
  heroCardId: number;
  readings: PatternReading[];
  newMoons: string[]; // "YYYY-MM-DD" new-moon days spanning the range
  birthDate?: string | null;
  constellationCardIds?: number[];
}
export interface PatternResult {
  lens: LensKey | "asterism" | "stalker";
  bucketLabel: string;
  targetKey: string;
  /** stable identity for the read/unread badge: "cardId:lens:bucket". */
  patternId: string;
  /** the card this pattern belongs to (null for hero-anchored / asterism). */
  cardId: number | null;
  /** for asterism rows: the co-occurring group's card ids (sorted ascending). */
  groupCardIds?: number[];
  draws: number;
  exactHits: number;
  weightedScore: number;
  lift: number;
  pValue: number;
  memberYmds: string[];
  explanation: string;
}
export interface PatternReport {
  primary: PatternResult | null;
  all: PatternResult[];
}

const KERNEL_ADJ = 1 / 3;
const ALPHA = 0.01;
const MIN_DRAWS = 6;
const MIN_EXACT = 4;
const MIN_LIFT = 2;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------- pure local-date helpers (no Date, no timezone) ---------- */
function y(ymd: string) { return Number(ymd.slice(0, 4)); }
function mo(ymd: string) { return Number(ymd.slice(5, 7)); }
function dom(ymd: string) { return Number(ymd.slice(8, 10)); }
function isLeap(yr: number) { return (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0; }
function daysInMonth(yr: number, m: number) {
  return [31, isLeap(yr) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
function pad(n: number, w: number) { return String(n).padStart(w, "0"); }
function mkYmd(yr: number, m: number, d: number) { return `${pad(yr, 4)}-${pad(m, 2)}-${pad(d, 2)}`; }
function prevYmd(ymd: string): string {
  let yr = y(ymd), m = mo(ymd), d = dom(ymd) - 1;
  if (d < 1) { m -= 1; if (m < 1) { m = 12; yr -= 1; } d = daysInMonth(yr, m); }
  return mkYmd(yr, m, d);
}
function nextYmd(ymd: string): string {
  let yr = y(ymd), m = mo(ymd), d = dom(ymd) + 1;
  if (d > daysInMonth(yr, m)) { d = 1; m += 1; if (m > 12) { m = 1; yr += 1; } }
  return mkYmd(yr, m, d);
}
/** Weekday 0=Sunday..6=Saturday via Zeller's congruence (pure). */
function weekday(ymd: string): number {
  let yr = y(ymd); const m = mo(ymd), q = dom(ymd);
  let mm = m; if (mm < 3) { mm += 12; yr -= 1; }
  const K = yr % 100, J = Math.floor(yr / 100);
  const h = (q + Math.floor((13 * (mm + 1)) / 5) + K + Math.floor(K / 4) + Math.floor(J / 4) + 5 * J) % 7;
  return (h + 6) % 7; // Zeller 0=Sat -> shift so 0=Sun
}
function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtP(p: number) { return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`; }

type Bucket = { key: string; label: string; hit: (ymd: string) => boolean };

function buildBuckets(lens: LensKey, input: PatternInput): Bucket[] {
  if (lens === "weekday")
    return WEEKDAY_NAMES.map((name, k) => ({ key: `weekday:${k}`, label: name + "s", hit: (d) => weekday(d) === k }));
  if (lens === "day") {
    const out: Bucket[] = [];
    for (let k = 1; k <= 31; k += 1) out.push({ key: `day:${k}`, label: `the ${ordinal(k)}`, hit: (d) => dom(d) === k });
    return out;
  }
  if (lens === "numerology") {
    if (!input.birthDate) return [];
    const bd = input.birthDate, out: Bucket[] = [];
    for (let k = 1; k <= 9; k += 1)
      out.push({ key: `num:${k}`, label: `personal day ${k}`, hit: (d) => personalDay(bd, y(d), mo(d), dom(d)).digit === k });
    return out;
  }
  const nm = new Set(input.newMoons);
  const full = new Set<string>();
  const sorted = [...input.newMoons].sort();
  for (let i = 0; i < sorted.length - 1; i += 1) {
    // midpoint day between consecutive new moons — pure day stepping, ~14 hops
    let cur = sorted[i];
    let steps = 0, a = sorted[i], b = sorted[i + 1];
    let t = a; while (t !== b) { t = nextYmd(t); steps += 1; }
    const half = Math.round(steps / 2);
    cur = a; for (let s = 0; s < half; s += 1) cur = nextYmd(cur);
    full.add(cur);
  }
  return [
    { key: "moon:new", label: "the New Moon", hit: (d) => nm.has(d) },
    { key: "moon:full", label: "the Full Moon", hit: (d) => full.has(d) },
  ];
}

function weightInt(ymd: string, b: Bucket): number {
  if (b.hit(ymd)) return 3;
  if (b.hit(prevYmd(ymd)) || b.hit(nextYmd(ymd))) return 1;
  return 0;
}

function pValueDP(n: number, q3: number, q1: number, targetInt: number): number {
  const q0 = Math.max(0, 1 - q3 - q1);
  let dist = new Float64Array(1); dist[0] = 1;
  for (let i = 0; i < n; i += 1) {
    const next = new Float64Array(dist.length + 3);
    for (let s = 0; s < dist.length; s += 1) {
      const p = dist[s]; if (p === 0) continue;
      next[s] += p * q0; next[s + 1] += p * q1; next[s + 3] += p * q3;
    }
    dist = next;
  }
  let tail = 0; for (let s = targetInt; s < dist.length; s += 1) tail += dist[s];
  return Math.min(1, tail);
}

function detectLens(lens: LensKey, input: PatternInput, heroDays: string[], allDays: string[], alpha: number): PatternResult | null {
  const buckets = buildBuckets(lens, input);
  if (buckets.length === 0) return null;
  const n = heroDays.length;
  let best: PatternResult | null = null;
  for (const b of buckets) {
    let q3n = 0, q1n = 0;
    for (const d of allDays) { const w = weightInt(d, b); if (w === 3) q3n += 1; else if (w === 1) q1n += 1; }
    const q3 = q3n / allDays.length, q1 = q1n / allDays.length;
    const mu = q3 + q1 * KERNEL_ADJ;
    if (mu <= 0) continue;
    let scoreInt = 0, exactHits = 0; const members: string[] = [];
    for (const d of heroDays) { const w = weightInt(d, b); if (w > 0) members.push(d); if (w === 3) exactHits += 1; scoreInt += w; }
    const weightedScore = scoreInt / 3;
    const lift = weightedScore / n / mu;
    if (exactHits < MIN_EXACT || lift < MIN_LIFT) continue;
    const pValue = pValueDP(n, q3, q1, scoreInt);
    if (pValue > alpha) continue;
    if (!best || pValue < best.pValue)
      best = { lens, bucketLabel: b.label, targetKey: b.key, patternId: `${input.heroCardId}:${b.key}`, cardId: input.heroCardId, draws: n, exactHits, weightedScore, lift, pValue, memberYmds: members,
        explanation: buildExplanation(lens, b.label, exactHits, n, lift, pValue, input, heroDays) };
  }
  return best;
}

function buildExplanation(lens: LensKey, label: string, exactHits: number, n: number, lift: number, p: number, input: PatternInput, heroDays: string[]): string {
  const norm = `${lift.toFixed(1)}× your norm, ${fmtP(p)}`;
  if (lens === "moon") { const cycles = Math.max(1, input.newMoons.length - 1); return `Lands on ${label} in ${exactHits} of ${cycles} cycles — ${norm}. Tap to isolate.`; }
  if (lens === "day") { const months = new Set(heroDays.map((d) => d.slice(0, 7))).size; return `Falls on ${label} in ${exactHits} of ${months} months — ${norm}. Tap to isolate.`; }
  if (lens === "numerology") return `Lands on ${label} in ${exactHits} of ${n} draws — ${norm}. Tap to isolate.`;
  return `Shows up on ${label} ${exactHits} of ${n} draws — ${norm}. Tap to isolate.`;
}

function binomTail(n: number, p: number, k: number): number {
  if (p <= 0) return k > 0 ? 0 : 1; if (p >= 1) return 1;
  let logC = 0, tail = 0;
  for (let i = 0; i <= n; i += 1) { if (i > 0) logC += Math.log((n - i + 1) / i);
    const logPmf = logC + i * Math.log(p) + (n - i) * Math.log(1 - p); if (i >= k) tail += Math.exp(logPmf); }
  return Math.min(1, tail);
}

function detectAsterism(input: PatternInput): PatternResult | null {
  const set = (input.constellationCardIds ?? []).filter((c) => c !== input.heroCardId);
  const full = [input.heroCardId, ...set];
  if (full.length < 2) return null;
  const N = input.readings.length; if (N === 0) return null;
  const support = input.readings.filter((r) => full.every((c) => r.cardIds.includes(c))).length;
  const counts = full.map((c) => input.readings.filter((r) => r.cardIds.includes(c)).length);
  const expected = counts.reduce((acc, ct) => acc * (ct / N), N);
  const lift = expected > 0 ? support / expected : 0;
  if (support < 3 || lift < 3) return null;
  const pValue = binomTail(N, expected / N, support);
  const members = input.readings.filter((r) => full.every((c) => r.cardIds.includes(c))).map((r) => r.ymd);
  const _sorted = full.slice().sort((a, b) => a - b);
  const _tk = "asterism:" + _sorted.join(",");
  return { lens: "asterism", bucketLabel: "these cards travel together",
    targetKey: _tk, patternId: _tk, cardId: null, groupCardIds: _sorted,
    draws: N, exactHits: support, weightedScore: support, lift, pValue, memberYmds: members,
    explanation: `These cards met on ${support} pulls — ${lift.toFixed(1)}× chance, ${fmtP(pValue)}. Tap to trace.` };
}

export function detectPatterns(input: PatternInput): PatternReport {
  const allDays = Array.from(new Set(input.readings.map((r) => r.ymd)));
  const heroDays = Array.from(new Set(input.readings.filter((r) => r.cardIds.includes(input.heroCardId)).map((r) => r.ymd)));
  const lenses: LensKey[] = input.birthDate ? ["moon", "day", "numerology", "weekday"] : ["moon", "day", "weekday"];
  const alpha = ALPHA / lenses.length;
  const all: PatternResult[] = [];
  if (heroDays.length >= MIN_DRAWS && allDays.length > 0)
    for (const lens of lenses) { const r = detectLens(lens, input, heroDays, allDays, alpha); if (r) all.push(r); }
  const ast = detectAsterism(input); if (ast) all.push(ast);
  all.sort((a, b) => a.pValue - b.pValue);
  return { primary: all[0] ?? null, all };
}


/**
 * v3.34 — run detection across EVERY card in one pass, sharing the baseline so
 * the all-patterns view stays cheap regardless of history size.
 *
 * v3.36 — the aggregate the all-patterns modal + read/unread badges read now
 * carries THREE kinds of pattern, each qualifying on its own signal (no lens/
 * filter match required):
 *   • per-card lens patterns (moon / day / numerology / weekday),
 *   • asterisms — pairs & triplets that co-occur far more than chance
 *     (detectAllAsterisms, support ≥ 3, lift ≥ 3), independent of the current
 *     constellation, and
 *   • stalkers — single cards that keep showing up (detectAllStalkers, ≥ 3
 *     readings, matching the Insights → Stalkers tab definition).
 * All three share stable patternIds and are returned strongest-first.
 */
export function detectAllPatterns(
  input: Omit<PatternInput, "heroCardId" | "constellationCardIds">,
): PatternResult[] {
  const allDays = Array.from(new Set(input.readings.map((r) => r.ymd)));
  if (allDays.length === 0) return [];
  const cardIds = Array.from(new Set(input.readings.flatMap((r) => r.cardIds)));
  const lenses: LensKey[] = input.birthDate
    ? ["moon", "day", "numerology", "weekday"]
    : ["moon", "day", "weekday"];
  const alpha = ALPHA / lenses.length;
  type BB = { key: string; label: string; hit: (ymd: string) => boolean; q3: number; q1: number; mu: number };
  const baselines: Record<string, BB[]> = {};
  for (const lens of lenses) {
    const buckets = buildBuckets(lens, { ...input, heroCardId: 0 } as PatternInput);
    baselines[lens] = buckets.map((b) => {
      let q3n = 0, q1n = 0;
      for (const d of allDays) { const w = weightInt(d, b); if (w === 3) q3n += 1; else if (w === 1) q1n += 1; }
      const q3 = q3n / allDays.length, q1 = q1n / allDays.length;
      return { key: b.key, label: b.label, hit: b.hit, q3, q1, mu: q3 + q1 * KERNEL_ADJ };
    });
  }
  const out: PatternResult[] = [];
  for (const cardId of cardIds) {
    const heroDays = Array.from(
      new Set(input.readings.filter((r) => r.cardIds.includes(cardId)).map((r) => r.ymd)),
    );
    const n = heroDays.length;
    if (n < MIN_DRAWS) continue;
    for (const lens of lenses) {
      let best: PatternResult | null = null;
      for (const b of baselines[lens]) {
        if (b.mu <= 0) continue;
        let scoreInt = 0, exactHits = 0;
        const members: string[] = [];
        for (const d of heroDays) {
          const w = b.hit(d) ? 3 : b.hit(prevYmd(d)) || b.hit(nextYmd(d)) ? 1 : 0;
          if (w > 0) members.push(d);
          if (w === 3) exactHits += 1;
          scoreInt += w;
        }
        const weightedScore = scoreInt / 3;
        const lift = weightedScore / n / b.mu;
        if (exactHits < MIN_EXACT || lift < MIN_LIFT) continue;
        const pValue = pValueDP(n, b.q3, b.q1, scoreInt);
        if (pValue > alpha) continue;
        if (!best || pValue < best.pValue) {
          best = {
            lens, bucketLabel: b.label, targetKey: b.key,
            patternId: `${cardId}:${b.key}`, cardId,
            draws: n, exactHits, weightedScore, lift, pValue, memberYmds: members,
            explanation: buildExplanation(lens, b.label, exactHits, n, lift, pValue, input as PatternInput, heroDays),
          };
        }
      }
      if (best) out.push(best);
    }
  }
  // v3.36 — fold in the two non-lens signals so the red all-patterns feed shows
  // co-occurrence (asterism) and recurrence (stalker) patterns too.
  const asterisms = detectAllAsterisms({ readings: input.readings });
  const stalkers = detectAllStalkers({ readings: input.readings });
  const combined = [...out, ...asterisms, ...stalkers];
  combined.sort((a, b) => a.pValue - b.pValue);
  return combined;
}

/**
 * v3.36 — global co-occurrence pass. Scans every pair and triplet that actually
 * appears together across the filtered readings and keeps the ones that travel
 * together far more than independence predicts (support ≥ 3 pulls, lift ≥ 3×).
 * Independent of the current constellation set, so it can feed the all-patterns
 * modal. Emits asterism rows (cardId null; group carried in groupCardIds).
 */
export function detectAllAsterisms(input: Pick<PatternInput, "readings">): PatternResult[] {
  const readings = input.readings;
  const N = readings.length;
  if (N === 0) return [];
  const cardCount = new Map<number, number>();
  for (const r of readings) {
    for (const c of Array.from(new Set(r.cardIds))) cardCount.set(c, (cardCount.get(c) ?? 0) + 1);
  }
  const sup = new Map<string, number>();
  const mem = new Map<string, string[]>();
  const bump = (k: string, ymd: string) => {
    sup.set(k, (sup.get(k) ?? 0) + 1);
    let m = mem.get(k); if (!m) { m = []; mem.set(k, m); } m.push(ymd);
  };
  for (const r of readings) {
    const ids = Array.from(new Set(r.cardIds)).sort((a, b) => a - b);
    const L = ids.length;
    for (let i = 0; i < L; i += 1) {
      for (let j = i + 1; j < L; j += 1) {
        bump(`${ids[i]},${ids[j]}`, r.ymd);
        for (let m = j + 1; m < L; m += 1) bump(`${ids[i]},${ids[j]},${ids[m]}`, r.ymd);
      }
    }
  }
  const out: PatternResult[] = [];
  for (const [key, support] of sup) {
    if (support < 3) continue;
    const ids = key.split(",").map(Number);
    const expected = ids.reduce((acc, c) => acc * ((cardCount.get(c) ?? 0) / N), N);
    const lift = expected > 0 ? support / expected : 0;
    if (lift < 3) continue;
    const pValue = binomTail(N, expected / N, support);
    const patternId = "asterism:" + ids.join(",");
    out.push({
      lens: "asterism", bucketLabel: "travel together",
      targetKey: patternId, patternId, cardId: null, groupCardIds: ids,
      draws: N, exactHits: support, weightedScore: support, lift, pValue,
      memberYmds: mem.get(key) ?? [],
      explanation: `These cards met on ${support} pulls — ${lift.toFixed(1)}× chance, ${fmtP(pValue)}. Tap to trace.`,
    });
  }
  out.sort((a, b) => a.pValue - b.pValue);
  return out;
}

/* ---------- stalker (single-card recurrence) thresholds ---------- */
const STALKER_DECK = 78;
// Need a reasonable amount of history before "more than chance" means anything
// (matches pattern-engine's DEFAULT_MIN_SLOTS).
const STALKER_MIN_SLOTS = 60;
// Bonferroni-corrected significance bar — the same 0.005 the validated
// pattern-engine uses.
const STALKER_ALPHA = 0.005;
// And an intuitive floor: a stalker must appear at least twice its expected rate.
const STALKER_MIN_OVERINDEX = 2;

/**
 * v3.38 — global single-card recurrence pass, rewritten to a real significance
 * test (the v3.36 "≥ 3 appearances" floor let in cards that actually appear
 * LESS than chance). A "stalker" is a card whose observed count is:
 *   • ≥ 2× its expected rate (expected = total card-slots ÷ 78), AND
 *   • statistically significant — binomial P(≥ observed) under a uniform-deck
 *     null, Bonferroni-corrected across every candidate card, below 0.005.
 * On a ~273-reading history that lands the bar around ~25 appearances, not 3.
 * Pure arithmetic — no Date, consistent with the rest of this module.
 */
export function detectAllStalkers(input: Pick<PatternInput, "readings">): PatternResult[] {
  const readings = input.readings;
  const N = readings.length;
  if (N === 0) return [];
  const cardYmds = new Map<number, string[]>();
  let totalSlots = 0;
  for (const r of readings) {
    for (const c of Array.from(new Set(r.cardIds))) {
      let arr = cardYmds.get(c); if (!arr) { arr = []; cardYmds.set(c, arr); }
      arr.push(r.ymd); totalSlots += 1;
    }
  }
  if (totalSlots < STALKER_MIN_SLOTS) return [];
  const expectedPerCard = totalSlots / STALKER_DECK;
  const p0 = 1 / STALKER_DECK;
  const nTests = cardYmds.size; // Bonferroni across the candidate cards
  const out: PatternResult[] = [];
  for (const [cardId, ymds] of cardYmds) {
    const observed = ymds.length;
    const overIndex = expectedPerCard > 0 ? observed / expectedPerCard : 0;
    if (overIndex < STALKER_MIN_OVERINDEX) continue;
    const rawP = binomTail(totalSlots, p0, observed);
    const adjustedP = Math.min(1, rawP * nTests);
    if (adjustedP >= STALKER_ALPHA) continue;
    const patternId = `stalker:${cardId}`;
    out.push({
      lens: "stalker", bucketLabel: "keeps showing up",
      targetKey: patternId, patternId, cardId,
      draws: N, exactHits: observed, weightedScore: observed, lift: overIndex, pValue: adjustedP, memberYmds: ymds,
      explanation: `Showed up ${observed}× vs ~${expectedPerCard.toFixed(0)} expected — ${overIndex.toFixed(1)}× your norm, ${fmtP(adjustedP)}. Tap to isolate.`,
    });
  }
  out.sort((a, b) => a.pValue - b.pValue);
  return out;
}
