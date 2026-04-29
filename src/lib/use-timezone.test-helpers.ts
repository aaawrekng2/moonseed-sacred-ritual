/**
 * Shared helpers for timezone tests.
 *
 * The point of these is to keep individual test files declarative —
 * future contributors should only need to add ONE row to a fixture
 * table to cover a new DST regime, date-line case, or edge instant.
 * If you find yourself writing raw `getDayInTz(getTodayInTz(...), ...)`
 * chains in a test, reach for `walkAroundDay` first.
 */
import { expect } from "vitest";
import {
  getDatePartsInTz,
  getDayInTz,
  getDayOffsetInTz,
  getTodayInTz,
  getYmdInTz,
} from "./use-timezone";

/** Build a UTC instant from an ISO string. Sugar for clarity. */
export const utc = (iso: string): Date => new Date(iso);

/**
 * Bundle of "today + previous + next" calendar keys for a given UTC
 * instant projected into a single timezone. The shape every DST and
 * date-line walk test wants to assert against.
 */
export type DayWalk = {
  prevYmd: string;
  ymd: string;
  nextYmd: string;
  hour: number;
};

/** Compute the day-walk projection of `instant` in `tz`. */
export function dayWalkAt(instant: Date, tz: string): DayWalk {
  const today = getTodayInTz(tz, instant);
  return {
    prevYmd: getYmdInTz(getDayInTz(today, -1, tz), tz),
    ymd: getYmdInTz(today, tz),
    nextYmd: getYmdInTz(getDayInTz(today, 1, tz), tz),
    hour: getDatePartsInTz(today, tz).hour,
  };
}

/**
 * Assert the full ±1 day walk around `instant` in `tz` matches the
 * expected calendar triple. Always also asserts the noon-anchor hour
 * stays at 12 — a invariant we never want to lose silently.
 */
export function expectDayWalk(
  instant: Date,
  tz: string,
  expected: { prev: string; today: string; next: string },
): void {
  const walk = dayWalkAt(instant, tz);
  expect(walk).toEqual({
    prevYmd: expected.prev,
    ymd: expected.today,
    nextYmd: expected.next,
    hour: 12,
  });
}

/**
 * Convenience for "an instant lands on this YMD in this tz". Used by
 * narrow assertions that don't care about the surrounding ±1 days.
 */
export function expectYmd(instant: Date, tz: string, ymd: string): void {
  expect(getYmdInTz(instant, tz)).toBe(ymd);
}

/**
 * Assert getDayOffsetInTz returns the expected integer day diff.
 * Wraps both directions so symmetry is implicit.
 */
export function expectOffset(
  target: Date,
  reference: Date,
  tz: string,
  expectedDays: number,
): void {
  expect(getDayOffsetInTz(target, reference, tz)).toBe(expectedDays);
  // Symmetric direction is implied by the algebra; assert it so any
  // future bug in negative-direction handling fails loudly.
  expect(getDayOffsetInTz(reference, target, tz)).toBe(-expectedDays || 0);
}

/**
 * Canonical zones used by snapshot + cross-zone tests. Centralised here
 * so adding a zone updates every consumer in one place.
 */
export const CANONICAL_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

/**
 * DST + date-line fixtures. Each row is one walk-test: pick an instant,
 * pick a zone, declare what the prev/today/next YMDs should be.
 * Adding a new regime is one new row — no boilerplate.
 */
export type DstFixture = {
  label: string;
  tz: string;
  /** UTC instant that lands at noon LOCAL on `today` after projection. */
  instant: Date;
  prev: string;
  today: string;
  next: string;
};

export const DST_FIXTURES: DstFixture[] = [
  {
    label: "US spring-forward (LA, Mar 8 2026)",
    tz: "America/Los_Angeles",
    instant: utc("2026-03-08T20:00:00Z"), // 13:00 PDT — projects to noon-local via getTodayInTz
    prev: "2026-03-07",
    today: "2026-03-08",
    next: "2026-03-09",
  },
  {
    label: "US fall-back (LA, Nov 1 2026)",
    tz: "America/Los_Angeles",
    instant: utc("2026-11-01T20:00:00Z"),
    prev: "2026-10-31",
    today: "2026-11-01",
    next: "2026-11-02",
  },
  {
    label: "UK BST start (London, Mar 29 2026)",
    tz: "Europe/London",
    instant: utc("2026-03-29T12:00:00Z"),
    prev: "2026-03-28",
    today: "2026-03-29",
    next: "2026-03-30",
  },
  {
    label: "EU CEST start (Berlin, Mar 29 2026)",
    tz: "Europe/Berlin",
    instant: utc("2026-03-29T11:00:00Z"),
    prev: "2026-03-28",
    today: "2026-03-29",
    next: "2026-03-30",
  },
  {
    label: "EU CET return (Berlin, Oct 25 2026)",
    tz: "Europe/Berlin",
    instant: utc("2026-10-25T11:00:00Z"),
    prev: "2026-10-24",
    today: "2026-10-25",
    next: "2026-10-26",
  },
  {
    label: "AU AEDT start (Sydney, Oct 4 2026, southern hemisphere)",
    tz: "Australia/Sydney",
    instant: utc("2026-10-04T01:00:00Z"),
    prev: "2026-10-03",
    today: "2026-10-04",
    next: "2026-10-05",
  },
  {
    label: "AU AEST return (Sydney, Apr 5 2026, southern hemisphere)",
    tz: "Australia/Sydney",
    instant: utc("2026-04-05T02:00:00Z"),
    prev: "2026-04-04",
    today: "2026-04-05",
    next: "2026-04-06",
  },
  {
    label: "NZ NZDT end (Auckland, Apr 5 2026)",
    tz: "Pacific/Auckland",
    instant: utc("2026-04-05T00:00:00Z"), // = Apr 5 13:00 NZDT/NZST cusp
    prev: "2026-04-04",
    today: "2026-04-05",
    next: "2026-04-06",
  },
];
