/**
 * Lightweight rising-sign approximation.
 *
 * The full astrological calculation requires precise coordinates,
 * sidereal time, and obliquity tables. For the Settings → Blueprint
 * preview we use a coarse but stable approximation: starting from the
 * sun sign, advance through the zodiac by roughly two signs per
 * four-hour block of birth time. The exact value is refined
 * server-side when premium astrology features are enabled; this is
 * only ever used to surface a friendly badge in the UI.
 */
import type { SunSign } from "./sun-sign";

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
 * Returns a rising sign estimate, or `null` when birth time is missing
 * (rising sign requires the time of day to be known).
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