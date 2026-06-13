/**
 * EK134 — Atlas asterism pattern detection.
 *
 * Pure functions, no React. Given the asterism's matched (stroked) calendar
 * days — already filtered through the active filter stack upstream — this
 * looks for rhythm in WHEN those days fall: weekday lean, steady cadence,
 * recent trend, moon lean, and bursts.
 *
 * EVERY detector is chance-gated. A finding is returned ONLY when the observed
 * signal clearly beats what random chance would produce; otherwise that
 * detector returns nothing. No "almost" cards, no decorative near-misses. When
 * nothing beats chance, the result is an empty array and the panel does not
 * render at all.
 *
 * All day keys are YYYY-MM-DD in UTC (the same keys the calendar strokes).
 */

import {
  parseIsoDay,
  calendarDaysBetween,
  dayOfWeekInTz,
} from "@/lib/time";

const TZ = "UTC";

const WEEKDAY_PLURAL = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

export type AtlasPattern = {
  kind: "weekday" | "cadence" | "trend" | "moon" | "burst";
  /** Plain-language finding. */
  title: string;
  /** Supporting one-liner. */
  detail: string;
  /** For the moon card, which phase fired (drives the icon). */
  moonPhase?: "Full Moon" | "New Moon";
};

export type DetectAtlasPatternsInput = {
  /** Matched (stroked) day keys, YYYY-MM-DD UTC. Any order. */
  strokedDays: string[];
  /** Size of the active time-range window, in days. */
  windowDays: number;
  /** Marked full-moon day keys within the data range. */
  moonFullDays: Set<string>;
  /** Marked new-moon day keys within the data range. */
  moonNewDays: Set<string>;
  /** Today, YYYY-MM-DD UTC. */
  todayYmd: string;
};

// Upper-tail binomial probability: P(X >= k) for X ~ Binomial(n, p).
// Iterative pmf to stay stable for the small n we see (matched-day counts).
function binomUpperTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return k <= 0 ? 1 : 0;
  if (p >= 1) return 1;
  let pmf = Math.pow(1 - p, n); // i = 0
  let cdfBelow = pmf; // P(X <= 0)
  const ratio = p / (1 - p);
  for (let i = 1; i < k; i++) {
    pmf = pmf * (ratio * (n - i + 1)) / i;
    cdfBelow += pmf;
  }
  const tail = 1 - cdfBelow;
  return tail < 0 ? 0 : tail > 1 ? 1 : tail;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function detectAtlasPatterns(
  input: DetectAtlasPatternsInput,
): AtlasPattern[] {
  const { windowDays, moonFullDays, moonNewDays, todayYmd } = input;
  const days = Array.from(new Set(input.strokedDays)).sort();
  const n = days.length;
  const out: AtlasPattern[] = [];
  if (n < 5) return out; // too few matched days to call any rhythm

  const dates = days.map((d) => parseIsoDay(d, TZ));
  const today = parseIsoDay(todayYmd, TZ);

  // 1 — WEEKDAY LEAN. Binomial test on the most common weekday vs uniform
  // 1/7, Bonferroni-corrected for testing all 7 weekdays.
  {
    const counts = new Array(7).fill(0);
    for (const dt of dates) counts[dayOfWeekInTz(dt, TZ)]++;
    let wMax = 0;
    for (let w = 1; w < 7; w++) if (counts[w] > counts[wMax]) wMax = w;
    const k = counts[wMax];
    const p = binomUpperTail(k, n, 1 / 7);
    if (k >= 3 && p < 0.05 / 7) {
      out.push({
        kind: "weekday",
        title: `These land on ${WEEKDAY_PLURAL[wMax]} — ${k} of ${n}.`,
        detail: `Well past the ${Math.round(n / 7)} or so you'd expect by chance.`,
      });
    }
  }

  // 2 — CADENCE. Steady spacing: gaps tightly clustered and within a month.
  if (n >= 5) {
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const g = Math.abs(calendarDaysBetween(dates[i - 1], dates[i], TZ));
      if (g > 0) gaps.push(g);
    }
    if (gaps.length >= 4) {
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const variance =
        gaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gaps.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      const period = Math.round(median(gaps));
      if (mean <= 31 && cv < 0.35 && period >= 2) {
        out.push({
          kind: "cadence",
          title: `A steady rhythm — roughly every ${period} days.`,
          detail: `The spacing between these days stays close to ${period}.`,
        });
      }
    }
  }

  // 3 — RECENT TREND. Recent half vs earlier half of the window.
  if (n >= 6) {
    const halfAgo = Math.max(1, Math.round(windowDays / 2));
    let recent = 0;
    let earlier = 0;
    for (const dt of dates) {
      const ago = calendarDaysBetween(dt, today, TZ); // >= 0, days before today
      if (ago <= halfAgo) recent++;
      else earlier++;
    }
    if (recent >= 2 * Math.max(earlier, 1) && recent - earlier >= 2) {
      out.push({
        kind: "trend",
        title: `Picking up lately — ${recent} of ${n} recently.`,
        detail: `More frequent in the recent half of this window than before.`,
      });
    } else if (earlier >= 2 * Math.max(recent, 1) && earlier - recent >= 2) {
      out.push({
        kind: "trend",
        title: `Easing off lately — ${recent} of ${n} recently.`,
        detail: `Less frequent in the recent half of this window than before.`,
      });
    }
  }

  // 4 — MOON LEAN. Stroked days landing on marked full/new-moon days, vs the
  // chance rate of those marked days across the window. Stronger of the two.
  {
    const winStart = Math.max(1, Math.round(windowDays));
    const inWindow = (set: Set<string>) => {
      let c = 0;
      for (const d of set) {
        const ago = calendarDaysBetween(parseIsoDay(d, TZ), today, TZ);
        if (ago >= 0 && ago <= winStart) c++;
      }
      return c;
    };
    const candidates: Array<{
      phase: "Full Moon" | "New Moon";
      set: Set<string>;
    }> = [
      { phase: "Full Moon", set: moonFullDays },
      { phase: "New Moon", set: moonNewDays },
    ];
    let best: { p: number; k: number; phase: "Full Moon" | "New Moon" } | null =
      null;
    for (const c of candidates) {
      const marked = inWindow(c.set);
      if (marked <= 0) continue;
      const p0 = marked / winStart;
      let k = 0;
      for (const d of days) if (c.set.has(d)) k++;
      if (k < 3) continue;
      const p = binomUpperTail(k, n, p0);
      if (p < 0.05 / 2 && (!best || p < best.p)) {
        best = { p, k, phase: c.phase };
      }
    }
    if (best) {
      const word = best.phase === "Full Moon" ? "full" : "new";
      out.push({
        kind: "moon",
        moonPhase: best.phase,
        title: `Leans toward the ${word} moon — ${best.k} of ${n}.`,
        detail: `On ${word}-moon days more than the calendar would predict.`,
      });
    }
  }

  // 5 — BURST. A 7-day window holding far more than the usual pace.
  if (n >= 6) {
    const epochDays = dates
      .map((d) => Math.round(d.getTime() / 86400000))
      .sort((a, b) => a - b);
    let maxInWeek = 1;
    for (let i = 0; i < epochDays.length; i++) {
      let c = 1;
      for (let j = i + 1; j < epochDays.length; j++) {
        if (epochDays[j] - epochDays[i] <= 6) c++;
        else break;
      }
      if (c > maxInWeek) maxInWeek = c;
    }
    const expectedPerWeek = (n * 7) / Math.max(1, windowDays);
    if (maxInWeek >= 3 && expectedPerWeek < 1.5 && maxInWeek >= 3 * expectedPerWeek) {
      out.push({
        kind: "burst",
        title: `Came in a burst — ${maxInWeek} within one week.`,
        detail: `Well above the usual pace for these days.`,
      });
    }
  }

  return out;
}
