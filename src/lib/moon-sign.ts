/**
 * v3.50 — Natal Moon-sign calculation.
 *
 * Completes the "big three" (Sun + Rising already existed; this adds the
 * birth Moon sign). Mirrors the dual-method pattern in `rising-sign.ts`:
 *
 *  - `calculateMoonSignPrecise` — circular-natal-horoscope-js with real
 *    coordinates + birth time. Reads the Moon's tropical sign from the
 *    computed chart's CelestialBodies.
 *  - `calculateMoonSignAstro` — independent computation via astronomy-engine
 *    (geocentric ecliptic longitude of the Moon). Used as a cross-check and
 *    as a coarse fallback when the place can't be geocoded. The Moon's
 *    zodiac sign does not depend on the observer's location, only on the
 *    UT instant — so this stays usable with just date + time.
 *
 * Every path is wrapped so a missing/renamed dependency degrades to `null`
 * ("Moon unavailable") rather than throwing. Requires birth time; without
 * it the Moon sign is genuinely indeterminate and we return null.
 */
import type { SunSign } from "./sun-sign";
import { Origin, Horoscope } from "circular-natal-horoscope-js/dist/index.js";
import * as Astronomy from "astronomy-engine";

export type MoonSign = SunSign;

const ORDER: SunSign[] = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Precise natal Moon sign via circular-natal-horoscope-js. Requires a full
 * birth date (YYYY-MM-DD), birth time (HH:MM), and lat/long. Returns null on
 * any failure — caller can fall back to the astronomy-engine method.
 */
export function calculateMoonSignPrecise(
  birthDate: string | null,
  birthTime: string | null,
  latitude: number | null,
  longitude: number | null,
): MoonSign | null {
  if (!birthDate || !birthTime) return null;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  try {
    const [yStr, monStr, dStr] = birthDate.split("-");
    const [hStr, miStr] = birthTime.split(":");
    const year = Number(yStr);
    const month = Number(monStr) - 1; // library expects 0-indexed
    const date = Number(dStr);
    const hour = Number(hStr);
    const minute = Number(miStr);
    if (![year, month, date, hour, minute].every((n) => Number.isFinite(n))) {
      return null;
    }
    const origin = new Origin({
      year,
      month,
      date,
      hour,
      minute,
      latitude,
      longitude,
    } as never);
    const h = new Horoscope({
      origin,
      houseSystem: "whole-sign",
      zodiac: "tropical",
      language: "en",
    } as never) as {
      CelestialBodies?: {
        moon?: { Sign?: { label?: string; key?: string } };
      };
    };
    const moon = h.CelestialBodies?.moon;
    const label =
      moon?.Sign?.label ?? (moon?.Sign?.key ? capitalize(moon.Sign.key) : null);
    if (!label) return null;
    if ((ORDER as string[]).includes(label)) return label as MoonSign;
    const cap = capitalize(label);
    if ((ORDER as string[]).includes(cap)) return cap as MoonSign;
    return null;
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("[moon-sign] precise calc failed", e);
    }
    return null;
  }
}

/**
 * Independent Moon sign via astronomy-engine's geocentric ecliptic longitude.
 * Location is only used to approximate the local-time → UTC offset
 * (offset = round(long/15)); when longitude is absent we treat the birth
 * time as UTC, which is coarse but still usually lands the correct sign
 * (the Moon moves ~0.5°/hour). Returns null on any failure.
 */
export function calculateMoonSignAstro(
  birthDate: string | null,
  birthTime: string | null,
  longitude: number | null,
): MoonSign | null {
  if (!birthDate || !birthTime) return null;
  try {
    const [yStr, monStr, dStr] = birthDate.split("-");
    const [hStr, miStr] = birthTime.split(":");
    const year = Number(yStr);
    const month = Number(monStr);
    const day = Number(dStr);
    const hour = Number(hStr);
    const minute = Number(miStr);
    if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) {
      return null;
    }
    const tzOffsetHours =
      typeof longitude === "number" && Number.isFinite(longitude)
        ? Math.round(longitude / 15)
        : 0;
    const utc = new Date(
      Date.UTC(year, month - 1, day, hour - tzOffsetHours, minute, 0),
    );
    // EclipticGeoMoon returns the Moon's true ecliptic coordinates of date;
    // `.elon` is the ecliptic longitude in degrees.
    const geoMoon = (Astronomy as unknown as {
      EclipticGeoMoon?: (d: Date) => { elon?: number; lon?: number };
    }).EclipticGeoMoon;
    if (typeof geoMoon !== "function") return null;
    const ecl = geoMoon(utc);
    const lon = typeof ecl.elon === "number" ? ecl.elon : ecl.lon;
    if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
    const norm = ((lon % 360) + 360) % 360;
    const idx = Math.floor(norm / 30);
    return ORDER[idx] ?? null;
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("[moon-sign] astro calc failed", e);
    }
    return null;
  }
}

/**
 * Preferred entry point. Tries the precise chart method first, then the
 * astronomy-engine method (which also works without coordinates). Reports
 * `confident: true` only when both methods are available and agree, or when
 * the precise method succeeded and the coarse method matched it.
 * Returns null only when the Moon sign truly can't be determined (no time).
 */
export function calculateMoonSignWithConfidence(
  birthDate: string | null,
  birthTime: string | null,
  latitude: number | null,
  longitude: number | null,
): { sign: MoonSign; confident: boolean } | null {
  const precise = calculateMoonSignPrecise(
    birthDate,
    birthTime,
    latitude,
    longitude,
  );
  const astro = calculateMoonSignAstro(birthDate, birthTime, longitude);
  if (precise) {
    return { sign: precise, confident: astro != null && astro === precise };
  }
  if (astro) {
    // No chart (missing coords) — coarse but usable. Lower confidence.
    return {
      sign: astro,
      confident:
        typeof longitude === "number" && Number.isFinite(longitude),
    };
  }
  return null;
}
