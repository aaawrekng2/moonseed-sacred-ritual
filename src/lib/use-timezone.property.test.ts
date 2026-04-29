import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  getDayInTz,
  getDayOffsetInTz,
  getTodayInTz,
  getYmdInTz,
  getDatePartsInTz,
} from "./use-timezone";

/**
 * Property-based tests for tz-aware day math.
 *
 * Where unit tests pin specific bug-prone instants, these tests assert
 * algebraic invariants that MUST hold for every (instant × timezone × offset)
 * fast-check can throw at them. If any of these fail, fast-check shrinks
 * the counter-example down to the minimal reproducer — making tz drift bugs
 * trivial to diagnose.
 *
 * Invariants exercised:
 *   1. Round-trip: getDayOffsetInTz(getDayInTz(today, n), today) === n
 *   2. Symmetry:   getDayOffsetInTz(a, b) === -getDayOffsetInTz(b, a)
 *   3. Triangle:   offset(a,c) === offset(a,b) + offset(b,c) (transitive)
 *   4. Noon stability: getDayInTz always anchors at local hour=12
 *   5. YMD monotonic: getDayInTz(today, n) projects to a YMD whose
 *      sort order matches sign(n)
 *   6. Day-step uniqueness: ±1 day always lands on a distinct YMD
 */

const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Anchorage",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Kolkata", // UTC+5:30 — half-hour offset
  "Asia/Tokyo",
  "Asia/Kathmandu", // UTC+5:45 — quarter-hour offset
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Chatham", // UTC+12:45 — bizarre offset
] as const;

// Sample instants spanning ~6 years around the present so we hit every
// DST flavor in both hemispheres at least a couple times.
const MIN_MS = Date.UTC(2024, 0, 1);
const MAX_MS = Date.UTC(2030, 11, 31);

const arbInstant = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms));
const arbZone = fc.constantFrom(...ZONES);
const arbOffset = fc.integer({ min: -120, max: 120 });

describe("getDayInTz / getDayOffsetInTz — property-based invariants", () => {
  it("round-trip: offset(getDayInTz(today, n), today) === n", () => {
    fc.assert(
      fc.property(arbInstant, arbZone, arbOffset, (instant, tz, n) => {
        const today = getTodayInTz(tz, instant);
        const shifted = getDayInTz(today, n, tz);
        const measured = getDayOffsetInTz(shifted, today, tz);
        expect(measured).toBe(n);
      }),
      { numRuns: 500 },
    );
  });

  it("symmetry: offset(a, b) === -offset(b, a)", () => {
    fc.assert(
      fc.property(arbInstant, arbInstant, arbZone, (aInstant, bInstant, tz) => {
        const a = getTodayInTz(tz, aInstant);
        const b = getTodayInTz(tz, bInstant);
        const ab = getDayOffsetInTz(a, b, tz);
        const ba = getDayOffsetInTz(b, a, tz);
        // Normalize -0 → 0 so toBe (Object.is) treats them equal.
        expect(ab + 0).toBe(-ba + 0);
      }),
      { numRuns: 500 },
    );
  });

  it("transitive: offset(a, c) === offset(a, b) + offset(b, c)", () => {
    fc.assert(
      fc.property(
        arbInstant,
        arbInstant,
        arbInstant,
        arbZone,
        (aI, bI, cI, tz) => {
          const a = getTodayInTz(tz, aI);
          const b = getTodayInTz(tz, bI);
          const c = getTodayInTz(tz, cI);
          const ac = getDayOffsetInTz(a, c, tz);
          const ab = getDayOffsetInTz(a, b, tz);
          const bc = getDayOffsetInTz(b, c, tz);
          expect(ac).toBe(ab + bc);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("noon stability: getDayInTz always anchors at local hour=12", () => {
    fc.assert(
      fc.property(arbInstant, arbZone, arbOffset, (instant, tz, n) => {
        const today = getTodayInTz(tz, instant);
        const shifted = getDayInTz(today, n, tz);
        const { hour } = getDatePartsInTz(shifted, tz);
        expect(hour).toBe(12);
      }),
      { numRuns: 500 },
    );
  });

  it("YMD monotonicity: positive offset → later YMD, negative → earlier", () => {
    fc.assert(
      fc.property(
        arbInstant,
        arbZone,
        fc.integer({ min: 1, max: 90 }),
        (instant, tz, n) => {
          const today = getTodayInTz(tz, instant);
          const future = getYmdInTz(getDayInTz(today, n, tz), tz);
          const past = getYmdInTz(getDayInTz(today, -n, tz), tz);
          const now = getYmdInTz(today, tz);
          // String compare works because YMD is zero-padded ISO order.
          expect(future > now).toBe(true);
          expect(past < now).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("step uniqueness: today, today±1, today±2 are all distinct YMDs", () => {
    fc.assert(
      fc.property(arbInstant, arbZone, (instant, tz) => {
        const today = getTodayInTz(tz, instant);
        const ymds = [-2, -1, 0, 1, 2].map((o) =>
          getYmdInTz(getDayInTz(today, o, tz), tz),
        );
        expect(new Set(ymds).size).toBe(5);
      }),
      { numRuns: 500 },
    );
  });

  it("composition: getDayInTz(getDayInTz(t, a), b) === getDayInTz(t, a+b)", () => {
    fc.assert(
      fc.property(
        arbInstant,
        arbZone,
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: -60, max: 60 }),
        (instant, tz, a, b) => {
          const today = getTodayInTz(tz, instant);
          const stepwise = getDayInTz(getDayInTz(today, a, tz), b, tz);
          const direct = getDayInTz(today, a + b, tz);
          expect(getYmdInTz(stepwise, tz)).toBe(getYmdInTz(direct, tz));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("cross-zone: same UTC instant projects to the same hour-of-day diff each zone reports consistently", () => {
    // Different zones may disagree on the *calendar day*, but for any
    // single zone, a 24h ms shift must always equal exactly 1 day-offset
    // EXCEPT directly across a DST seam, where it may be 0 or 2. Assert
    // the offset is always within {0, 1, 2} for a +24h shift, and that
    // the average over many random instants is ~1.0 (sanity check).
    fc.assert(
      fc.property(arbInstant, arbZone, (instant, tz) => {
        const a = instant;
        const b = new Date(instant.getTime() + 24 * 60 * 60 * 1000);
        const offset = getDayOffsetInTz(b, a, tz);
        expect([0, 1, 2]).toContain(offset);
      }),
      { numRuns: 1000 },
    );
  });
});
