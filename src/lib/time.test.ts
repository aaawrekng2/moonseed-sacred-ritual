import { describe, it, expect } from "vitest";
import {
  isoDayInTz,
  parseIsoDay,
  addDaysInTz,
  calendarDaysBetween,
  dayOfWeekInTz,
  currentTzOrFallback,
} from "@/lib/time";

describe("isoDayInTz", () => {
  it("returns same UTC day for UTC zone", () => {
    const d = new Date("2026-05-16T10:00:00Z");
    expect(isoDayInTz(d, "UTC")).toBe("2026-05-16");
  });

  it("the 11pm Pacific bug — May 16 23:00 PT is still May 16 in LA", () => {
    const d = new Date("2026-05-17T06:00:00Z");
    expect(isoDayInTz(d, "America/Los_Angeles")).toBe("2026-05-16");
    expect(isoDayInTz(d, "UTC")).toBe("2026-05-17");
  });

  it("falls back to UTC on invalid tz", () => {
    const d = new Date("2026-05-16T10:00:00Z");
    expect(isoDayInTz(d, "Not/Real")).toBe("2026-05-16");
  });

  it("DST fall-back 2025-11-02 in LA", () => {
    const d = new Date("2025-11-02T08:30:00Z");
    expect(isoDayInTz(d, "America/Los_Angeles")).toBe("2025-11-02");
  });

  it("year boundary in non-UTC zone", () => {
    const d = new Date("2026-01-01T03:00:00Z");
    expect(isoDayInTz(d, "America/New_York")).toBe("2025-12-31");
    expect(isoDayInTz(d, "UTC")).toBe("2026-01-01");
  });

  it("half-hour offset Asia/Kolkata (+5:30)", () => {
    const d = new Date("2026-05-16T20:00:00Z");
    expect(isoDayInTz(d, "Asia/Kolkata")).toBe("2026-05-17");
  });

  it("quarter-hour offset Pacific/Chatham (+12:45)", () => {
    const d = new Date("2026-05-16T12:00:00Z");
    expect(isoDayInTz(d, "Pacific/Chatham")).toBe("2026-05-17");
  });
});

describe("addDaysInTz", () => {
  it("adds 1 day across DST spring-forward in LA", () => {
    const d = new Date("2026-03-07T20:00:00Z");
    const next = addDaysInTz(d, 1, "America/Los_Angeles");
    expect(isoDayInTz(next, "America/Los_Angeles")).toBe("2026-03-08");
  });

  it("subtracts 1 day across month boundary", () => {
    const d = parseIsoDay("2026-05-01", "America/Los_Angeles");
    const prev = addDaysInTz(d, -1, "America/Los_Angeles");
    expect(isoDayInTz(prev, "America/Los_Angeles")).toBe("2026-04-30");
  });
});

describe("calendarDaysBetween", () => {
  it("counts days correctly across DST", () => {
    const a = parseIsoDay("2026-03-07", "America/Los_Angeles");
    const b = parseIsoDay("2026-03-09", "America/Los_Angeles");
    expect(calendarDaysBetween(a, b, "America/Los_Angeles")).toBe(2);
  });
});

describe("currentTzOrFallback", () => {
  it("returns UTC when input is empty", () => {
    expect(currentTzOrFallback()).toBe("UTC");
    expect(currentTzOrFallback("")).toBe("UTC");
    expect(currentTzOrFallback(null)).toBe("UTC");
  });
  it("passes through valid tz", () => {
    expect(currentTzOrFallback("America/Los_Angeles")).toBe("America/Los_Angeles");
  });
});

describe("dayOfWeekInTz", () => {
  it("returns 0 for Sunday in UTC", () => {
    const d = new Date("2026-05-17T12:00:00Z");
    expect(dayOfWeekInTz(d, "UTC")).toBe(0);
  });
});