/* eslint-disable no-restricted-syntax -- this module is the canonical exception */
/**
 * src/lib/time.ts — canonical timezone-aware date helpers.
 *
 * Tarot Seed has had production timezone bugs from server functions
 * calling .getDate() or .toISOString().slice() in server-local or UTC time
 * while the seeker experienced the date in their local IANA zone. This
 * module is the ONLY way date operations should happen anywhere in the
 * codebase. ESLint enforces (see eslint.config.js).
 *
 * Pure functions. No React. Importable from server and client.
 */

/** Returns tz if non-empty, else "UTC". */
export function currentTzOrFallback(tz?: string | null): string {
  return tz && tz.length > 0 ? tz : "UTC";
}

/** Format a Date as YYYY-MM-DD in the given IANA tz. Falls back to UTC on invalid tz. */
export function isoDayInTz(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().substring(0, 10);
  }
}

/** Current YYYY-MM-DD in the given tz. */
export function nowYmdInTz(tz: string): string {
  return isoDayInTz(new Date(), tz);
}

/**
 * Parse a YYYY-MM-DD string back to the UTC instant that corresponds to
 * midnight on that day in the given tz. DST-safe via offset probing.
 */
export function parseIsoDay(yyyyMmDd: string, tz: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  // Probe wall time of UTC midnight as observed in the tz, then offset.
  let candidate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const gy = Number(parts.find((p) => p.type === "year")?.value ?? "0");
    const gm = Number(parts.find((p) => p.type === "month")?.value ?? "0");
    const gd = Number(parts.find((p) => p.type === "day")?.value ?? "0");
    const gh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const gmin = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    // Diff between observed wall-time and desired (y, m, d, 0, 0).
    const observedMs = Date.UTC(gy, gm - 1, gd, gh, gmin, 0, 0);
    const targetMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    const diff = targetMs - observedMs;
    if (diff === 0) return candidate;
    candidate = new Date(candidate.getTime() + diff);
  }
  return candidate;
}

/** Date at 00:00:00 in the given tz for the same calendar day. */
export function startOfDayInTz(date: Date, tz: string): Date {
  return parseIsoDay(isoDayInTz(date, tz), tz);
}

/** Date at 23:59:59.999 in the given tz for the same calendar day. */
export function endOfDayInTz(date: Date, tz: string): Date {
  const start = startOfDayInTz(date, tz);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Date at midnight of the 1st of the same calendar month in the given tz. */
export function startOfMonthInTz(date: Date, tz: string): Date {
  const ymd = isoDayInTz(date, tz);
  const [y, m] = ymd.split("-").map(Number);
  return parseIsoDay(`${y}-${String(m).padStart(2, "0")}-01`, tz);
}

/** Date at end-of-day of the last day of the same calendar month in the given tz. */
export function endOfMonthInTz(date: Date, tz: string): Date {
  const ymd = isoDayInTz(date, tz);
  const [y, m] = ymd.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = parseIsoDay(
    `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    tz,
  );
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Add (or subtract) n calendar days in the given tz. DST-safe. */
export function addDaysInTz(date: Date, n: number, tz: string): Date {
  const ymd = isoDayInTz(date, tz);
  const [y, m, d] = ymd.split("-").map(Number);
  const advanced = new Date(Date.UTC(y, m - 1, d + n));
  const targetYmd = `${advanced.getUTCFullYear()}-${String(advanced.getUTCMonth() + 1).padStart(2, "0")}-${String(advanced.getUTCDate()).padStart(2, "0")}`;
  return parseIsoDay(targetYmd, tz);
}

/** Integer count of calendar days between two dates in the given tz. Sign indicates direction. */
export function calendarDaysBetween(a: Date, b: Date, tz: string): number {
  const aYmd = isoDayInTz(a, tz);
  const bYmd = isoDayInTz(b, tz);
  const [ay, am, ad] = aYmd.split("-").map(Number);
  const [by, bm, bd] = bYmd.split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / (24 * 60 * 60 * 1000));
}

/** True if a and b fall on the same calendar day in the given tz. */
export function isSameDayInTz(a: Date, b: Date, tz: string): boolean {
  return isoDayInTz(a, tz) === isoDayInTz(b, tz);
}

/** True if the date is today in the given tz. */
export function isTodayInTz(date: Date, tz: string): boolean {
  return isoDayInTz(date, tz) === nowYmdInTz(tz);
}

/** True if the date is yesterday in the given tz. */
export function isYesterdayInTz(date: Date, tz: string): boolean {
  const yesterday = addDaysInTz(new Date(), -1, tz);
  return isSameDayInTz(date, yesterday, tz);
}

/** Integer 0-6 (Sunday = 0) representing day of week in the given tz. */
export function dayOfWeekInTz(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });
  const weekday = fmt.format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

/** Display a time in the given tz, formatted per locale. */
export function formatTimeInTz(date: Date, tz: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}