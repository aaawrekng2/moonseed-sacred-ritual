/**
 * Sun-sign calculation. Given a birth date, returns the western
 * tropical zodiac sign the sun is in. Pure function — no I/O.
 */
export type SunSign =
  | "Aries"
  | "Taurus"
  | "Gemini"
  | "Cancer"
  | "Leo"
  | "Virgo"
  | "Libra"
  | "Scorpio"
  | "Sagittarius"
  | "Capricorn"
  | "Aquarius"
  | "Pisces";

// Each entry: [sign, startMonth (1-12), startDay].
const RANGES: Array<[SunSign, number, number]> = [
  ["Capricorn", 12, 22],
  ["Sagittarius", 11, 22],
  ["Scorpio", 10, 23],
  ["Libra", 9, 23],
  ["Virgo", 8, 23],
  ["Leo", 7, 23],
  ["Cancer", 6, 21],
  ["Gemini", 5, 21],
  ["Taurus", 4, 20],
  ["Aries", 3, 21],
  ["Pisces", 2, 19],
  ["Aquarius", 1, 20],
];

export function getSunSign(date: Date): SunSign {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  for (const [sign, sm, sd] of RANGES) {
    if (m > sm || (m === sm && d >= sd)) return sign;
  }
  // Dates Jan 1–19 fall through → Capricorn (carries over from Dec 22).
  return "Capricorn";
}