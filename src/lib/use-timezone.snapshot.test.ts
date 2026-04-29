import { describe, it, expect } from "vitest";
import {
  getYmdInTz,
  getDayInTz,
  getTodayInTz,
  getDatePartsInTz,
} from "./use-timezone";

/**
 * Snapshot-style regression tests for tz-aware day math.
 *
 * We pin a fixed grid of (instant × timezone) pairs and snapshot the
 * derived YMD keys and ±day walks. Any future refactor that subtly shifts
 * how we project a UTC instant onto a calendar day will surface here as
 * a snapshot diff rather than as a silent peak-drift bug in the carousel.
 *
 * The instants are chosen to cover:
 *   - the May 31 2026 full moon peak (real bug we already chased)
 *   - both US DST transitions (spring-forward, fall-back)
 *   - the UK BST start
 *   - a date-line straddle (UTC midnight vs Tokyo / Auckland / LA)
 *   - a leap-day edge (2028-02-29) and a year boundary
 */

const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

const INSTANTS: Array<{ label: string; iso: string }> = [
  { label: "may-31-2026-full-moon-peak", iso: "2026-05-31T11:00:00Z" },
  { label: "us-spring-forward-2026", iso: "2026-03-08T10:30:00Z" }, // LA: 02:30 → 03:30
  { label: "us-fall-back-2026", iso: "2026-11-01T08:30:00Z" }, // LA: 01:30 PDT, then PST
  { label: "uk-bst-start-2026", iso: "2026-03-29T00:30:00Z" }, // London 00:30 → BST at 01:00
  { label: "eu-cest-start-2026", iso: "2026-03-29T00:30:00Z" }, // Berlin 01:30 → CEST at 02:00→03:00
  { label: "eu-cet-return-2026", iso: "2026-10-25T00:30:00Z" }, // Berlin 02:30 CEST → 02:30 CET
  { label: "au-aedt-start-2026", iso: "2026-10-03T15:30:00Z" }, // Sydney 02:30 → 03:30 AEDT
  { label: "au-aest-return-2026", iso: "2026-04-04T15:30:00Z" }, // Sydney 02:30 AEDT → 02:30 AEST
  { label: "date-line-utc-midnight", iso: "2026-07-15T00:00:00Z" },
  { label: "date-line-utc-near-midnight", iso: "2026-07-14T23:30:00Z" },
  { label: "year-boundary", iso: "2027-01-01T00:00:00Z" },
  { label: "leap-day-2028", iso: "2028-02-29T12:00:00Z" },
  { label: "nz-dst-end-2026", iso: "2026-04-04T13:30:00Z" }, // NZ DST ends 04-05 03:00→02:00
];

describe("YMD snapshot grid (instant × timezone)", () => {
  for (const { label, iso } of INSTANTS) {
    it(`projects ${label} (${iso}) onto each zone's calendar day`, () => {
      const date = new Date(iso);
      const projection: Record<string, { ymd: string; hour: number; minute: number }> = {};
      for (const tz of ZONES) {
        const parts = getDatePartsInTz(date, tz);
        projection[tz] = {
          ymd: getYmdInTz(date, tz),
          hour: parts.hour,
          minute: parts.minute,
        };
      }
      expect(projection).toMatchSnapshot();
    });
  }
});

describe("getDayInTz ±N walk snapshots", () => {
  // For each instant we record what "today / -1 / +1 / +7 / -7" look like
  // when anchored at local-noon in each zone. This is the exact pattern the
  // carousel uses to build its 5-day strip and to project ladder jumps.
  const OFFSETS = [-7, -1, 0, 1, 7];

  for (const { label, iso } of INSTANTS) {
    it(`walks ±N days from ${label} in every zone`, () => {
      const now = new Date(iso);
      const walk: Record<string, Record<string, string>> = {};
      for (const tz of ZONES) {
        const today = getTodayInTz(tz, now);
        const row: Record<string, string> = {};
        for (const off of OFFSETS) {
          const d = getDayInTz(today, off, tz);
          row[String(off)] = getYmdInTz(d, tz);
        }
        walk[tz] = row;
      }
      expect(walk).toMatchSnapshot();
    });
  }
});
