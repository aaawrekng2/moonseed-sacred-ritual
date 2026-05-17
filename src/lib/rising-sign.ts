/**
 * Dual-method rising-sign calculation (Q78).
 *
 *  - `calculateRisingSignPrecise` — uses circular-natal-horoscope-js with
 *    real coordinates + birth time. Accurate within a couple of minutes.
 *  - `calculateRisingSign` — coarse approximation (no coords required),
 *    used as a fallback when the place can't be geocoded.
 */
import type { SunSign } from "./sun-sign";
import { Origin, Horoscope } from "circular-natal-horoscope-js";

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