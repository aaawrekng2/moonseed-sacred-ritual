import { describe, it, expect } from "vitest";
import {
  getYmdInTz,
  getDayInTz,
  getTodayInTz,
  getDatePartsInTz,
} from "./use-timezone";
import { CANONICAL_ZONES, utc } from "./use-timezone.test-helpers";

/**
 * Snapshot-style regression grid for tz-aware day math.
 *
 * Adding a new instant to INSTANTS auto-extends the matrix; adding a
 * new zone to CANONICAL_ZONES (in test-helpers) extends every row.
 * Snapshots will then need a one-time refresh via `vitest -u`.
 */

const INSTANTS: Array<{ label: string; instant: Date }> = [
  { label: "may-31-2026-full-moon-peak", instant: utc("2026-05-31T11:00:00Z") },
  { label: "us-spring-forward-2026", instant: utc("2026-03-08T10:30:00Z") },
  { label: "us-fall-back-2026", instant: utc("2026-11-01T08:30:00Z") },
  { label: "uk-bst-start-2026", instant: utc("2026-03-29T00:30:00Z") },
  { label: "eu-cest-start-2026", instant: utc("2026-03-29T00:30:00Z") },
  { label: "eu-cet-return-2026", instant: utc("2026-10-25T00:30:00Z") },
  { label: "au-aedt-start-2026", instant: utc("2026-10-03T15:30:00Z") },
  { label: "au-aest-return-2026", instant: utc("2026-04-04T15:30:00Z") },
  { label: "date-line-utc-midnight", instant: utc("2026-07-15T00:00:00Z") },
  { label: "date-line-utc-near-midnight", instant: utc("2026-07-14T23:30:00Z") },
  { label: "year-boundary", instant: utc("2027-01-01T00:00:00Z") },
  { label: "leap-day-2028", instant: utc("2028-02-29T12:00:00Z") },
  { label: "nz-dst-end-2026", instant: utc("2026-04-04T13:30:00Z") },
];

describe("YMD snapshot grid (instant × timezone)", () => {
  for (const { label, instant } of INSTANTS) {
    it(`projects ${label} (${instant.toISOString()}) onto each zone's calendar day`, () => {
      const projection: Record<string, { ymd: string; hour: number; minute: number }> = {};
      for (const tz of CANONICAL_ZONES) {
        const parts = getDatePartsInTz(instant, tz);
        projection[tz] = {
          ymd: getYmdInTz(instant, tz),
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

  for (const { label, instant } of INSTANTS) {
    it(`walks ±N days from ${label} in every zone`, () => {
      const walk: Record<string, Record<string, string>> = {};
      for (const tz of CANONICAL_ZONES) {
        const today = getTodayInTz(tz, instant);
        const row: Record<string, string> = {};
        for (const off of OFFSETS) {
          row[String(off)] = getYmdInTz(getDayInTz(today, off, tz), tz);
        }
        walk[tz] = row;
      }
      expect(walk).toMatchSnapshot();
    });
  }
});
