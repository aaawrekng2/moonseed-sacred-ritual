import { describe, it, expect } from "vitest";
import {
  getTodayInTz,
  getDayInTz,
  getDayOffsetInTz,
  getYmdInTz,
  getDatePartsInTz,
} from "./use-timezone";

/**
 * Regression tests for timezone-aware day math. These guard against the
 * "peak drift" class of bugs where moon events landed on the wrong carousel
 * day after DST transitions or near the international date line.
 *
 * IMPORTANT: every assertion is timezone-explicit. We never rely on the
 * test runner's local timezone — that would make these tests flaky on CI
 * machines configured to non-UTC zones.
 */

describe("getTodayInTz", () => {
  it("returns the local calendar day, not the UTC day", () => {
    // 2026-01-15 03:00 UTC = 2026-01-14 19:00 in LA (PST, UTC-8)
    const now = new Date("2026-01-15T03:00:00Z");
    const today = getTodayInTz("America/Los_Angeles", now);
    expect(getYmdInTz(today, "America/Los_Angeles")).toBe("2026-01-14");
  });

  it("returns the local calendar day across the date line (Tokyo)", () => {
    // 2026-01-14 23:00 UTC = 2026-01-15 08:00 in Tokyo (UTC+9)
    const now = new Date("2026-01-14T23:00:00Z");
    const today = getTodayInTz("Asia/Tokyo", now);
    expect(getYmdInTz(today, "Asia/Tokyo")).toBe("2026-01-15");
  });

  it("handles a moment exactly on local midnight", () => {
    // 2026-06-01 00:00 in London (BST) = 2026-05-31 23:00 UTC
    const now = new Date("2026-05-31T23:00:00Z");
    const today = getTodayInTz("Europe/London", now);
    expect(getYmdInTz(today, "Europe/London")).toBe("2026-06-01");
  });
});

describe("getDayInTz", () => {
  it("walks +/- one day across spring-forward DST (US)", () => {
    // DST start: 2026-03-08 02:00 → 03:00 in America/Los_Angeles.
    // Anchor on Mar 8 noon local; +/-1 must still land on Mar 7 / Mar 9.
    const anchor = getTodayInTz(
      "America/Los_Angeles",
      new Date("2026-03-08T20:00:00Z"), // = Mar 8 13:00 PDT
    );
    const prev = getDayInTz(anchor, -1, "America/Los_Angeles");
    const next = getDayInTz(anchor, 1, "America/Los_Angeles");
    expect(getYmdInTz(prev, "America/Los_Angeles")).toBe("2026-03-07");
    expect(getYmdInTz(anchor, "America/Los_Angeles")).toBe("2026-03-08");
    expect(getYmdInTz(next, "America/Los_Angeles")).toBe("2026-03-09");
  });

  it("walks +/- one day across fall-back DST (US)", () => {
    // DST end: 2026-11-01 02:00 → 01:00 in America/Los_Angeles.
    const anchor = getTodayInTz(
      "America/Los_Angeles",
      new Date("2026-11-01T20:00:00Z"), // = Nov 1 12:00 PST
    );
    expect(getYmdInTz(anchor, "America/Los_Angeles")).toBe("2026-11-01");
    expect(getYmdInTz(getDayInTz(anchor, -1, "America/Los_Angeles"), "America/Los_Angeles"))
      .toBe("2026-10-31");
    expect(getYmdInTz(getDayInTz(anchor, 1, "America/Los_Angeles"), "America/Los_Angeles"))
      .toBe("2026-11-02");
  });

  it("walks +/- one day across UK BST start (Europe/London)", () => {
    // BST start: 2026-03-29 01:00 UTC → 02:00 BST.
    const anchor = getTodayInTz(
      "Europe/London",
      new Date("2026-03-29T12:00:00Z"),
    );
    expect(getYmdInTz(anchor, "Europe/London")).toBe("2026-03-29");
    expect(getYmdInTz(getDayInTz(anchor, -1, "Europe/London"), "Europe/London"))
      .toBe("2026-03-28");
    expect(getYmdInTz(getDayInTz(anchor, 1, "Europe/London"), "Europe/London"))
      .toBe("2026-03-30");
  });

  it("walks across the May 31 full moon date line (Pacific vs Tokyo)", () => {
    // Conceptual peak instant: 2026-05-31 11:00 UTC.
    //   - LA (PDT, UTC-7): 2026-05-31 04:00  → peak day = May 31
    //   - Tokyo (UTC+9):   2026-05-31 20:00  → peak day = May 31
    //   - Auckland (UTC+12 NZST): 2026-05-31 23:00 → peak day = May 31
    // Verify each zone's "today" + day walk all line up.
    const peak = new Date("2026-05-31T11:00:00Z");
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland"]) {
      const today = getTodayInTz(tz, peak);
      expect(getYmdInTz(today, tz)).toBe("2026-05-31");
      expect(getYmdInTz(getDayInTz(today, -1, tz), tz)).toBe("2026-05-30");
      expect(getYmdInTz(getDayInTz(today, 1, tz), tz)).toBe("2026-06-01");
    }
  });

  it("walks +30 days forward without losing a day to DST", () => {
    // Span the LA spring-forward boundary: Feb 20 + 30 days = Mar 22.
    const anchor = getTodayInTz(
      "America/Los_Angeles",
      new Date("2026-02-20T20:00:00Z"),
    );
    const plus30 = getDayInTz(anchor, 30, "America/Los_Angeles");
    expect(getYmdInTz(plus30, "America/Los_Angeles")).toBe("2026-03-22");
  });

  it("preserves local noon hour across DST", () => {
    // After spring-forward, noon-local should still report hour=12.
    const anchor = getTodayInTz(
      "America/Los_Angeles",
      new Date("2026-03-09T19:00:00Z"),
    );
    expect(getDatePartsInTz(anchor, "America/Los_Angeles").hour).toBe(12);
  });
});

describe("getDayOffsetInTz", () => {
  it("returns 0 for two moments on the same local day", () => {
    // Both are 2026-05-31 in LA, even though they straddle UTC midnight.
    const a = new Date("2026-05-31T08:00:00Z"); // 01:00 PDT
    const b = new Date("2026-06-01T06:00:00Z"); // 23:00 PDT (still May 31)
    expect(getDayOffsetInTz(a, b, "America/Los_Angeles")).toBe(0);
  });

  it("returns 1 across a date-line midnight (Tokyo)", () => {
    // 2026-05-31 23:00 Tokyo vs 2026-06-01 01:00 Tokyo
    const a = new Date("2026-05-31T16:00:00Z"); // = 06-01 01:00 JST
    const b = new Date("2026-05-31T14:00:00Z"); // = 05-31 23:00 JST
    expect(getDayOffsetInTz(a, b, "Asia/Tokyo")).toBe(1);
  });

  it("returns -1 across spring-forward DST (still 24h calendar diff)", () => {
    // Mar 7 noon vs Mar 8 noon LA — calendar diff is exactly 1 day even
    // though the UTC delta is only 23h thanks to spring-forward.
    const mar7Noon = new Date("2026-03-07T20:00:00Z"); // 12:00 PST
    const mar8Noon = new Date("2026-03-08T19:00:00Z"); // 12:00 PDT
    expect(getDayOffsetInTz(mar7Noon, mar8Noon, "America/Los_Angeles")).toBe(-1);
    expect(getDayOffsetInTz(mar8Noon, mar7Noon, "America/Los_Angeles")).toBe(1);
  });

  it("returns +1 across fall-back DST (25h UTC delta still = 1 day)", () => {
    const oct31Noon = new Date("2026-10-31T19:00:00Z"); // 12:00 PDT
    const nov1Noon = new Date("2026-11-01T20:00:00Z");  // 12:00 PST
    expect(getDayOffsetInTz(nov1Noon, oct31Noon, "America/Los_Angeles")).toBe(1);
  });

  it("computes large offsets correctly across multiple DST boundaries", () => {
    // Feb 1 → Apr 1 in LA spans spring-forward: 59 calendar days.
    const feb1 = new Date("2026-02-01T20:00:00Z");
    const apr1 = new Date("2026-04-01T19:00:00Z");
    expect(getDayOffsetInTz(apr1, feb1, "America/Los_Angeles")).toBe(59);
  });

  it("differs between zones when the same instant straddles midnight", () => {
    // 2026-05-31 11:00 UTC:
    //   - LA: May 31, 04:00
    //   - Tokyo: May 31, 20:00
    // Reference = 2026-05-30 12:00 UTC:
    //   - LA: May 30, 05:00
    //   - Tokyo: May 30, 21:00
    const target = new Date("2026-05-31T11:00:00Z");
    const reference = new Date("2026-05-30T12:00:00Z");
    expect(getDayOffsetInTz(target, reference, "America/Los_Angeles")).toBe(1);
    expect(getDayOffsetInTz(target, reference, "Asia/Tokyo")).toBe(1);
  });
});
