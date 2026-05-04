/**
 * EN-1 — Lunation utility.
 * A lunation = one cycle from New Moon to the next New Moon (~29.5 days).
 * Used by Insights Recap to bucket readings into astronomically meaningful
 * units instead of arbitrary calendar months.
 *
 * Implementation note: src/lib/moon.ts exposes `findNextPhaseOccurrence`
 * (returns a *day offset*, not a Date). For lunation boundaries we want
 * actual instants, so we use astronomy-engine's SearchMoonPhase directly
 * (longitude 0° = New Moon).
 */
import * as Astronomy from "astronomy-engine";

export type Lunation = {
  start: Date;        // The New Moon that opens the lunation
  end: Date;          // The next New Moon (exclusive)
  startPhase: "New Moon";
  ordinal: number;    // 1 = most-recent (current) lunation, 2 = previous, etc.
  isCurrent: boolean; // True if today falls within [start, end)
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Find next New Moon at-or-after `from` (within ~45 days). */
function nextNewMoon(from: Date): Date | null {
  const r = Astronomy.SearchMoonPhase(0, from, 45);
  return r ? r.date : null;
}

/** Find the New Moon at-or-before `from` (search back ~45 days). */
function prevNewMoonAtOrBefore(from: Date): Date | null {
  // Step back 45 days then search forward to the first New Moon ≤ from.
  const back = new Date(from.getTime() - 45 * DAY_MS);
  const a = Astronomy.SearchMoonPhase(0, back, 60);
  if (!a) return null;
  if (a.date > from) return null;
  // Find the *latest* New Moon that's still ≤ from.
  let latest = a.date;
  let cursor = new Date(a.date.getTime() + DAY_MS);
  for (let i = 0; i < 3; i += 1) {
    const next = Astronomy.SearchMoonPhase(0, cursor, 45);
    if (!next || next.date > from) break;
    latest = next.date;
    cursor = new Date(next.date.getTime() + DAY_MS);
  }
  return latest;
}

/**
 * Get the lunation that contains the given date.
 * Returns the New Moon that opens the lunation + the next New Moon.
 */
export function getLunationContaining(date: Date): { start: Date; end: Date } {
  const start = prevNewMoonAtOrBefore(date) ?? new Date(date.getTime() - 29 * DAY_MS);
  const end =
    nextNewMoon(new Date(start.getTime() + DAY_MS)) ??
    new Date(start.getTime() + 30 * DAY_MS);
  return { start, end };
}

/**
 * Get all lunations whose start is on-or-after the user's earliest reading.
 * If `earliestReadingDate` is null, returns just the current lunation.
 * Returns most-recent first (ordinal 1 = current).
 */
export function getLunationHistory(earliestReadingDate: Date | null): Lunation[] {
  const today = new Date();
  const current = getLunationContaining(today);
  if (!earliestReadingDate) {
    return [
      {
        start: current.start,
        end: current.end,
        startPhase: "New Moon",
        ordinal: 1,
        isCurrent: true,
      },
    ];
  }
  const lunations: Lunation[] = [];
  let cursorStart = current.start;
  let cursorEnd = current.end;
  let ordinal = 1;
  while (cursorEnd >= earliestReadingDate) {
    lunations.push({
      start: cursorStart,
      end: cursorEnd,
      startPhase: "New Moon",
      ordinal,
      isCurrent: ordinal === 1,
    });
    if (lunations.length > 36) break; // safety cap (~3 years)
    // Step back: find the New Moon before cursorStart.
    const prevStart = prevNewMoonAtOrBefore(new Date(cursorStart.getTime() - DAY_MS));
    if (!prevStart) break;
    cursorEnd = cursorStart;
    cursorStart = prevStart;
    ordinal += 1;
  }
  return lunations;
}

/** Format a lunation date range, e.g. "Mar 5 – Apr 3". */
export function formatLunationRange(l: { start: Date; end: Date }): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(l.start)} – ${fmt(l.end)}`;
}

/** ISO date (YYYY-MM-DD) for a lunation start — used as URL param. */
export function lunationStartParam(d: Date): string {
  return d.toISOString();
}