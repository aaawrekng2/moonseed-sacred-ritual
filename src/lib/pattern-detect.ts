/**
 * v3.31 — Pattern detection for the Insights → Patterns strip.
 *
 * Given the hero card and the filtered reading universe, this runs the four
 * ordinal lenses (moon phase / day-of-month / numerology / day-of-week) plus
 * the asterism co-occurrence check, and returns any statistically real pattern
 * — a bucket the hero's draws pile into far more than the seeker's OWN cadence
 * would predict.
 *
 * Method (locked with Cori):
 *  - Null baseline = her own draw-days, NOT uniform random. p0 for a bucket is
 *    the fraction of ALL her draw-days that fall in it, so timezone, calendar,
 *    month length and her habits are absorbed automatically.
 *  - ±1 calendar-day kernel: a draw ON the pattern day scores 1; the day before
 *    or after scores 1/3; further scores 0. Same rule in every lens.
 *  - Weighted binomial: observed weighted score vs expected-under-null, exact
 *    p-value by DP convolution over integer weights {0,1,3} (=3×{0,⅓,1}).
 *  - Gates: n ≥ 6 draws, ≥ 4 EXACT hits (a real core, not adjacency alone),
 *    lift ≥ 2, p ≤ 0.01 / (lenses tested)  [Bonferroni across lenses].
 *  - Asterism: support ≥ 3 pulls and lift ≥ 3 vs independence.
 *
 * Pure module. Bucketing uses ymd strings already resolved in the seeker's tz
 * by the caller; ±1-day math routes through @/lib/time so it stays DST-safe and
 * never calls a raw Date method (Section 25 contract).
 */
import { parseIsoDay, addDaysInTz, isoDayInTz, dayOfWeekInTz } from "@/lib/time";
import { personalDay } from "./numerology";

export type LensKey = "moon" | "day" | "numerology" | "weekday";

export interface PatternReading {
  /** local calendar day in the seeker's tz, "YYYY-MM-DD" */
  ymd: string;
  cardIds: number[];
}

export interface PatternInput {
  tz: string;
  heroCardId: number;
  readings: PatternReading[];
  /** New-moon calendar days ("YYYY-MM-DD", seeker tz) spanning the range. */
  newMoons: string[];
  /** Birth date "YYYY-MM-DD" — enables the numerology lens when present. */
  birthDate?: string | null;
  /** Optional: the current constellation set (hero + companions) for asterism. */
  constellationCardIds?: number[];
}

export interface PatternResult {
  lens: LensKey | "asterism";
  bucketLabel: string;
  /** machine target the UI uses to isolate the lens, e.g. "weekday:0", "moon:new". */
  targetKey: string;
  draws: number;
  exactHits: number;
  weightedScore: number;
  lift: number;
  pValue: number;
  /** hero draw-days that count toward the pattern (weight > 0) — for cell stroking. */
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

function prevYmd(ymd: string, tz: string): string {
  return isoDayInTz(addDaysInTz(parseIsoDay(ymd, tz), -1, tz), tz);
}
function nextYmd(ymd: string, tz: string): string {
  return isoDayInTz(addDaysInTz(parseIsoDay(ymd, tz), 1, tz), tz);
}
function domOf(ymd: string): number {
  return Number(ymd.slice(8, 10));
}
function partsOf(ymd: string): [number, number, number] {
  return [Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), Number(ymd.slice(8, 10))];
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtP(p: number): string {
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
}

/** A lens is a predicate factory over candidate buckets. */
type Bucket = { key: string; label: string; hit: (ymd: string) => boolean };

function buildBuckets(lens: LensKey, input: PatternInput): Bucket[] {
  const tz = input.tz;
  if (lens === "weekday") {
    return WEEKDAY_NAMES.map((name, k) => ({
      key: `weekday:${k}`,
      label: name + "s",
      hit: (ymd) => dayOfWeekInTz(parseIsoDay(ymd, tz), tz) === k,
    }));
  }
  if (lens === "day") {
    const out: Bucket[] = [];
    for (let k = 1; k <= 31; k += 1) {
      out.push({ key: `day:${k}`, label: `the ${ordinal(k)}`, hit: (ymd) => domOf(ymd) === k });
    }
    return out;
  }
  if (lens === "numerology") {
    if (!input.birthDate) return [];
    const bd = input.birthDate;
    const out: Bucket[] = [];
    for (let k = 1; k <= 9; k += 1) {
      out.push({
        key: `num:${k}`,
        label: `personal day ${k}`,
        hit: (ymd) => {
          const [y, m, d] = partsOf(ymd);
          return personalDay(bd, y, m, d).digit === k;
        },
      });
    }
    return out;
  }
  // moon — anchor on the real new moons (and their full-moon midpoints)
  const nm = new Set(input.newMoons);
  const full = new Set<string>();
  const sorted = [...input.newMoons].sort();
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = parseIsoDay(sorted[i], tz);
    const b = parseIsoDay(sorted[i + 1], tz);
    const midDays = Math.round((b.getTime() - a.getTime()) / 86400000 / 2);
    full.add(isoDayInTz(addDaysInTz(a, midDays, tz), tz));
  }
  return [
    { key: "moon:new", label: "the New Moon", hit: (ymd) => nm.has(ymd) },
    { key: "moon:full", label: "the Full Moon", hit: (ymd) => full.has(ymd) },
  ];
}

/** Integer weight {0,1,3} = 3 × {0, ⅓, 1} for a day vs a bucket predicate. */
function weightInt(ymd: string, b: Bucket, tz: string): number {
  if (b.hit(ymd)) return 3;
  if (b.hit(prevYmd(ymd, tz)) || b.hit(nextYmd(ymd, tz))) return 1;
  return 0;
}

/** Exact upper-tail P(S ≥ target) for S = sum of n iid vars taking 3,1,0. */
function pValueDP(n: number, q3: number, q1: number, targetInt: number): number {
  const q0 = Math.max(0, 1 - q3 - q1);
  let dist = new Float64Array(1);
  dist[0] = 1;
  for (let i = 0; i < n; i += 1) {
    const next = new Float64Array(dist.length + 3);
    for (let s = 0; s < dist.length; s += 1) {
      const p = dist[s];
      if (p === 0) continue;
      next[s] += p * q0;
      next[s + 1] += p * q1;
      next[s + 3] += p * q3;
    }
    dist = next;
  }
  let tail = 0;
  for (let s = targetInt; s < dist.length; s += 1) tail += dist[s];
  return Math.min(1, tail);
}

function detectLens(
  lens: LensKey,
  input: PatternInput,
  heroDays: string[],
  allDays: string[],
  alpha: number,
): PatternResult | null {
  const tz = input.tz;
  const buckets = buildBuckets(lens, input);
  if (buckets.length === 0) return null;
  const n = heroDays.length;
  let best: PatternResult | null = null;

  for (const b of buckets) {
    let q3n = 0, q1n = 0;
    for (const d of allDays) {
      const w = weightInt(d, b, tz);
      if (w === 3) q3n += 1;
      else if (w === 1) q1n += 1;
    }
    const q3 = q3n / allDays.length;
    const q1 = q1n / allDays.length;
    const mu = q3 * 1 + q1 * KERNEL_ADJ; // expected weight per draw
    if (mu <= 0) continue;

    let scoreInt = 0, exactHits = 0;
    const members: string[] = [];
    for (const d of heroDays) {
      const w = weightInt(d, b, tz);
      if (w > 0) members.push(d);
      if (w === 3) exactHits += 1;
      scoreInt += w;
    }
    const weightedScore = scoreInt / 3;
    const lift = weightedScore / n / mu;
    if (exactHits < MIN_EXACT || lift < MIN_LIFT) continue;

    const pValue = pValueDP(n, q3, q1, scoreInt);
    if (pValue > alpha) continue;

    if (!best || pValue < best.pValue) {
      best = {
        lens,
        bucketLabel: b.label,
        targetKey: b.key,
        draws: n,
        exactHits,
        weightedScore,
        lift,
        pValue,
        memberYmds: members,
        explanation: buildExplanation(lens, b.label, exactHits, n, lift, pValue, input, heroDays),
      };
    }
  }
  return best;
}

function buildExplanation(
  lens: LensKey,
  label: string,
  exactHits: number,
  n: number,
  lift: number,
  p: number,
  input: PatternInput,
  heroDays: string[],
): string {
  const norm = `${lift.toFixed(1)}× your norm, ${fmtP(p)}`;
  if (lens === "moon") {
    const cycles = Math.max(1, input.newMoons.length - 1);
    return `Lands on ${label} in ${exactHits} of ${cycles} cycles — ${norm}. Tap to isolate.`;
  }
  if (lens === "day") {
    const months = new Set(heroDays.map((d) => d.slice(0, 7))).size;
    return `Falls on ${label} in ${exactHits} of ${months} months — ${norm}. Tap to isolate.`;
  }
  if (lens === "numerology") {
    return `Lands on ${label} in ${exactHits} of ${n} draws — ${norm}. Tap to isolate.`;
  }
  return `Shows up on ${label} ${exactHits} of ${n} draws — ${norm}. Tap to isolate.`;
}

function detectAsterism(input: PatternInput): PatternResult | null {
  const set = (input.constellationCardIds ?? []).filter((c) => c !== input.heroCardId);
  const full = [input.heroCardId, ...set];
  if (full.length < 2) return null;
  const N = input.readings.length;
  if (N === 0) return null;

  const support = input.readings.filter((r) => full.every((c) => r.cardIds.includes(c))).length;
  const counts = full.map((c) => input.readings.filter((r) => r.cardIds.includes(c)).length);
  const expected = counts.reduce((acc, ct) => acc * (ct / N), N);
  const lift = expected > 0 ? support / expected : 0;
  if (support < 3 || lift < 3) return null;

  const p = expected / N;
  const pValue = binomTail(N, p, support);
  const members = input.readings.filter((r) => full.every((c) => r.cardIds.includes(c))).map((r) => r.ymd);
  return {
    lens: "asterism",
    bucketLabel: "these cards travel together",
    targetKey: "asterism:" + full.slice().sort((a, b) => a - b).join(","),
    draws: N,
    exactHits: support,
    weightedScore: support,
    lift,
    pValue,
    memberYmds: members,
    explanation: `These cards met on ${support} pulls — ${lift.toFixed(1)}× chance, ${fmtP(pValue)}. Tap to trace.`,
  };
}

function binomTail(n: number, p: number, k: number): number {
  if (p <= 0) return k > 0 ? 0 : 1;
  if (p >= 1) return 1;
  let logC = 0, tail = 0;
  for (let i = 0; i <= n; i += 1) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    const logPmf = logC + i * Math.log(p) + (n - i) * Math.log(1 - p);
    if (i >= k) tail += Math.exp(logPmf);
  }
  return Math.min(1, tail);
}

export function detectPatterns(input: PatternInput): PatternReport {
  // Unique day-sets (the lens views are day-positioned; multi-draw days count once).
  const allDays = Array.from(new Set(input.readings.map((r) => r.ymd)));
  const heroDays = Array.from(
    new Set(input.readings.filter((r) => r.cardIds.includes(input.heroCardId)).map((r) => r.ymd)),
  );

  const lenses: LensKey[] = input.birthDate
    ? ["moon", "day", "numerology", "weekday"]
    : ["moon", "day", "weekday"];
  const alpha = ALPHA / lenses.length; // Bonferroni across the lenses tested

  const all: PatternResult[] = [];
  if (heroDays.length >= MIN_DRAWS && allDays.length > 0) {
    for (const lens of lenses) {
      const r = detectLens(lens, input, heroDays, allDays, alpha);
      if (r) all.push(r);
    }
  }
  const ast = detectAsterism(input);
  if (ast) all.push(ast);

  all.sort((a, b) => a.pValue - b.pValue);
  return { primary: all[0] ?? null, all };
}
