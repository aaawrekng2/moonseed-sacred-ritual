import { describe, it, expect } from "vitest";
import {
  getTodayInTz,
  getDayInTz,
  getDayOffsetInTz,
  getYmdInTz,
  getDatePartsInTz,
} from "./use-timezone";
import {
  DST_FIXTURES,
  dayWalkAt,
  expectDayWalk,
  expectOffset,
  expectYmd,
  utc,
} from "./use-timezone.test-helpers";

/**
 * Regression tests for timezone-aware day math. These guard against the
 * "peak drift" class of bugs where moon events landed on the wrong
 * carousel day after DST transitions or near the international date line.
 *
 * Adding a new DST regime is one row in DST_FIXTURES — keep that file
 * lean and let the parameterised block below cover ±1 day walks for free.
 * Use the inline tests in this file only for cases that don't fit the
 * "walk around a single anchor day" shape (date-line forks, large jumps,
 * symmetric offsets).
 *
 * IMPORTANT: every assertion is timezone-explicit. We never rely on the
 * test runner's local timezone — that would make these tests flaky on CI
 * machines configured to non-UTC zones.
 */

describe("getTodayInTz", () => {
  it("returns the local calendar day, not the UTC day (LA midnight crossing)", () => {
    // 2026-01-15 03:00 UTC = 2026-01-14 19:00 in LA (PST, UTC-8)
    expectYmd(
      getTodayInTz("America/Los_Angeles", utc("2026-01-15T03:00:00Z")),
      "America/Los_Angeles",
      "2026-01-14",
    );
  });

  it("returns the local calendar day across the date line (Tokyo)", () => {
    // 2026-01-14 23:00 UTC = 2026-01-15 08:00 in Tokyo (UTC+9)
    expectYmd(
      getTodayInTz("Asia/Tokyo", utc("2026-01-14T23:00:00Z")),
      "Asia/Tokyo",
      "2026-01-15",
    );
  });

  it("handles a moment exactly on local midnight (London BST)", () => {
    // 2026-06-01 00:00 in London (BST) = 2026-05-31 23:00 UTC
    expectYmd(
      getTodayInTz("Europe/London", utc("2026-05-31T23:00:00Z")),
      "Europe/London",
      "2026-06-01",
    );
  });
});

describe("getDayInTz — DST + date-line walks (data-driven)", () => {
  // Every row in DST_FIXTURES becomes one test. Add new regimes there,
  // not here.
  for (const fx of DST_FIXTURES) {
    it(`walks ±1 day correctly: ${fx.label}`, () => {
      expectDayWalk(fx.instant, fx.tz, {
        prev: fx.prev,
        today: fx.today,
        next: fx.next,
      });
    });
  }
});

describe("getDayInTz — long-range and noon-stability invariants", () => {
  it("walks +30 days forward without losing a day to DST (LA)", () => {
    const anchor = getTodayInTz("America/Los_Angeles", utc("2026-02-20T20:00:00Z"));
    const plus30 = getDayInTz(anchor, 30, "America/Los_Angeles");
    expectYmd(plus30, "America/Los_Angeles", "2026-03-22");
  });

  it("preserves local noon hour across spring-forward (LA)", () => {
    const anchor = getTodayInTz("America/Los_Angeles", utc("2026-03-09T19:00:00Z"));
    expect(getDatePartsInTz(anchor, "America/Los_Angeles").hour).toBe(12);
  });

  it("preserves local noon hour across fall-back (Berlin)", () => {
    const { hour } = dayWalkAt(utc("2026-10-25T11:00:00Z"), "Europe/Berlin");
    expect(hour).toBe(12);
  });

  it("walks across the May 31 full moon date line (3 zones)", () => {
    // Conceptual peak: 2026-05-31 11:00 UTC. Every zone listed should
    // agree the peak day is May 31 with May 30 and Jun 1 as neighbors.
    const peak = utc("2026-05-31T11:00:00Z");
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland"]) {
      expectDayWalk(peak, tz, {
        prev: "2026-05-30",
        today: "2026-05-31",
        next: "2026-06-01",
      });
    }
  });
});

describe("getDayOffsetInTz", () => {
  it("returns 0 for two moments on the same local day (LA)", () => {
    // Both are 2026-05-31 in LA, even though they straddle UTC midnight.
    expectOffset(
      utc("2026-05-31T08:00:00Z"), // 01:00 PDT
      utc("2026-06-01T06:00:00Z"), // 23:00 PDT (still May 31)
      "America/Los_Angeles",
      0,
    );
  });

  it("returns 1 across a date-line midnight (Tokyo)", () => {
    expectOffset(
      utc("2026-05-31T16:00:00Z"), // = 06-01 01:00 JST
      utc("2026-05-31T14:00:00Z"), // = 05-31 23:00 JST
      "Asia/Tokyo",
      1,
    );
  });

  it("returns ±1 across spring-forward (calendar diff, not 23h diff)", () => {
    expectOffset(
      utc("2026-03-08T19:00:00Z"), // 12:00 PDT, Mar 8
      utc("2026-03-07T20:00:00Z"), // 12:00 PST, Mar 7
      "America/Los_Angeles",
      1,
    );
  });

  it("returns ±1 across fall-back (calendar diff, not 25h diff)", () => {
    expectOffset(
      utc("2026-11-01T20:00:00Z"), // 12:00 PST, Nov 1
      utc("2026-10-31T19:00:00Z"), // 12:00 PDT, Oct 31
      "America/Los_Angeles",
      1,
    );
  });

  it("computes large offsets across multiple DST boundaries (LA, Feb→Apr)", () => {
    expectOffset(
      utc("2026-04-01T19:00:00Z"),
      utc("2026-02-01T20:00:00Z"),
      "America/Los_Angeles",
      59,
    );
  });

  it("yields the same magnitude in different zones when both straddle midnight", () => {
    const target = utc("2026-05-31T11:00:00Z");
    const reference = utc("2026-05-30T12:00:00Z");
    expect(getDayOffsetInTz(target, reference, "America/Los_Angeles")).toBe(1);
    expect(getDayOffsetInTz(target, reference, "Asia/Tokyo")).toBe(1);
  });
});

describe("getDayInTz — type-required timezone (no UTC fallback)", () => {
  it("honors the seeker's tz on a DST boundary (Auckland NZDT end)", () => {
    // NZDT ends 2026-04-05 03:00 → 02:00. A UTC fallback path could
    // mis-anchor noon-local; the tz-aware path must keep hour=12.
    const today = getTodayInTz("Pacific/Auckland", utc("2026-04-04T13:00:00Z"));
    const next = getDayInTz(today, 1, "Pacific/Auckland");
    expectYmd(next, "Pacific/Auckland", "2026-04-06");
    expect(getDatePartsInTz(next, "Pacific/Auckland").hour).toBe(12);
  });
});
