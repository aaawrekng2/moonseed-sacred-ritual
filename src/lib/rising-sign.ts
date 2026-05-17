/**
 * Dual-method rising-sign calculation (Q78).
 *
 *  - `calculateRisingSignPrecise` — uses circular-natal-horoscope-js with
 *    real coordinates + birth time. Accurate within a couple of minutes.
 *  - `calculateRisingSign` — coarse approximation (no coords required),
 *    used as a fallback when the place can't be geocoded.
 */
import type { SunSign } from "./sun-sign";
// Deep import: the package's "module" field points to a non-existent src/ path,
// so Vite fails to resolve the bare specifier. dist/index.js is the real entry.
import { Origin, Horoscope } from "circular-natal-horoscope-js/dist/index.js";
import { SiderealTime } from "astronomy-engine";

export type RisingSign = SunSign;

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

export const SIGN_EMOJI: Record<SunSign, string> = {
  Aries: "♈",
  Taurus: "♉",
  Gemini: "♊",
  Cancer: "♋",
  Leo: "♌",
  Virgo: "♍",
  Libra: "♎",
  Scorpio: "♏",
  Sagittarius: "♐",
  Capricorn: "♑",
  Aquarius: "♒",
  Pisces: "♓",
};

/**
 * Coarse approximation (sun sign + ~2h blocks). Used only when we
 * can't geocode the birth place to lat/long.
 */
export function calculateRisingSign(
  sunSign: SunSign | null,
  birthTime: string | null,
  _birthPlace: string | null,
): RisingSign | null {
  if (!sunSign || !birthTime) return null;
  const [hStr, mStr] = birthTime.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // Each ~2-hour block advances the rising sign by one position.
  const blocks = Math.floor((h * 60 + m) / 120);
  const startIdx = ORDER.indexOf(sunSign);
  if (startIdx === -1) return null;
  return ORDER[(startIdx + blocks) % ORDER.length];
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Precise rising sign using circular-natal-horoscope-js. Requires a
 * full birth date (YYYY-MM-DD), birth time (HH:MM), and lat/long.
 * Returns null on any failure — caller can fall back to the
 * approximation.
 */
export function calculateRisingSignPrecise(
  birthDate: string | null,
  birthTime: string | null,
  latitude: number | null,
  longitude: number | null,
): RisingSign | null {
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
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(date) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute)
    ) {
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
      Ascendant?: { Sign?: { label?: string; key?: string } };
    };
    const label =
      h.Ascendant?.Sign?.label ??
      (h.Ascendant?.Sign?.key ? capitalize(h.Ascendant.Sign.key) : null);
    if (!label) return null;
    if ((ORDER as string[]).includes(label)) return label as RisingSign;
    const cap = capitalize(label);
    if ((ORDER as string[]).includes(cap)) return cap as RisingSign;
    return null;
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("[rising-sign] precise calc failed", e);
    }
    return null;
  }
}

/**
 * Method 2 — independent computation via astronomy-engine + the
 * classical ascendant formula. Used as a sanity-check on method 1.
 * Timezone is approximated from longitude (offset = round(lon/15)),
 * which is good to within an hour — sufficient for sign-level
 * agreement except very near cusps.
 */
export function calculateRisingSignAstroEngine(
  birthDateStr: string | null,
  birthTimeStr: string | null,
  latitude: number | null,
  longitude: number | null,
): RisingSign | null {
  if (!birthDateStr || !birthTimeStr) return null;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  try {
    const [yStr, monStr, dStr] = birthDateStr.split("-");
    const [hStr, miStr] = birthTimeStr.split(":");
    const year = Number(yStr);
    const month = Number(monStr);
    const day = Number(dStr);
    const hour = Number(hStr);
    const minute = Number(miStr);
    if (
      ![year, month, day, hour, minute].every((n) => Number.isFinite(n))
    ) {
      return null;
    }
    // Approximate local-time → UTC via longitude.
    const tzOffsetHours = Math.round(longitude / 15);
    const utc = new Date(
      Date.UTC(year, month - 1, day, hour - tzOffsetHours, minute, 0),
    );
    // SiderealTime returns Greenwich apparent sidereal time in hours.
    const gstHours = SiderealTime(utc);
    const lstHours = (gstHours + longitude / 15) % 24;
    const ramcDeg = ((lstHours * 15) % 360 + 360) % 360;
    const ramc = (ramcDeg * Math.PI) / 180;
    const eps = (23.4393 * Math.PI) / 180;
    const phi = (latitude * Math.PI) / 180;
    let asc = Math.atan2(
      -Math.cos(ramc),
      Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps),
    );
    let ascDeg = (asc * 180) / Math.PI;
    if (Math.cos(ramc) > 0) ascDeg += 180;
    ascDeg = ((ascDeg % 360) + 360) % 360;
    const idx = Math.floor(ascDeg / 30);
    return ORDER[idx] ?? null;
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("[rising-sign] astro-engine calc failed", e);
    }
    return null;
  }
}

/**
 * Q79b — Cross-check method 1 against method 2 and report
 * confidence. Returns null if method 1 can't be computed.
 */
export function calculateRisingSignWithConfidence(
  birthDate: string | null,
  birthTime: string | null,
  latitude: number | null,
  longitude: number | null,
): { sign: RisingSign; confident: boolean } | null {
  const m1 = calculateRisingSignPrecise(birthDate, birthTime, latitude, longitude);
  if (!m1) return null;
  const m2 = calculateRisingSignAstroEngine(birthDate, birthTime, latitude, longitude);
  return { sign: m1, confident: m2 != null && m2 === m1 };
}