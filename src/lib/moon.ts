/**
 * Moon & Lunar utilities — pure JS using astronomy-engine. No network calls.
 */
import * as Astronomy from "astronomy-engine";

export type MoonPhaseName =
  | "New Moon"
  | "Waxing Crescent"
  | "First Quarter"
  | "Waxing Gibbous"
  | "Full Moon"
  | "Waning Gibbous"
  | "Last Quarter"
  | "Waning Crescent";

const PHASE_GLYPHS: Record<MoonPhaseName, string> = {
  "New Moon": "🌑",
  "Waxing Crescent": "🌒",
  "First Quarter": "🌓",
  "Waxing Gibbous": "🌔",
  "Full Moon": "🌕",
  "Waning Gibbous": "🌖",
  "Last Quarter": "🌗",
  "Waning Crescent": "🌘",
};

export const ZODIAC_SIGNS = [
  "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces",
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

const ZODIAC_GLYPHS: Record<ZodiacSign, string> = {
  Aries:"♈", Taurus:"♉", Gemini:"♊", Cancer:"♋", Leo:"♌", Virgo:"♍",
  Libra:"♎", Scorpio:"♏", Sagittarius:"♐", Capricorn:"♑", Aquarius:"♒", Pisces:"♓",
};

export function getZodiacGlyph(sign: ZodiacSign): string {
  return ZODIAC_GLYPHS[sign];
}

function phaseNameFromAngle(angle: number): MoonPhaseName {
  const a = ((angle % 360) + 360) % 360;
  const MILESTONE_ORB = 3;
  if (a < MILESTONE_ORB || a >= 360 - MILESTONE_ORB) return "New Moon";
  if (Math.abs(a - 90) < MILESTONE_ORB) return "First Quarter";
  if (Math.abs(a - 180) < MILESTONE_ORB) return "Full Moon";
  if (Math.abs(a - 270) < MILESTONE_ORB) return "Last Quarter";
  if (a < 90) return "Waxing Crescent";
  if (a < 180) return "Waxing Gibbous";
  if (a < 270) return "Waning Gibbous";
  return "Waning Crescent";
}

export type MoonInfo = {
  date: Date;
  phase: MoonPhaseName;
  glyph: string;
  illumination: number;
  angle: number;
};

export function getCurrentMoonPhase(date: Date = new Date()): MoonInfo {
  const angle = Astronomy.MoonPhase(date);
  const phase = phaseNameFromAngle(angle);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const illumination = Math.round(illum.phase_fraction * 100);
  return { date, phase, glyph: PHASE_GLYPHS[phase], illumination, angle };
}

function moonLongitude(date: Date): number {
  const v = Astronomy.GeoMoon(date);
  const ecl = Astronomy.Ecliptic(v);
  return ((ecl.elon % 360) + 360) % 360;
}

export function getMoonSign(date: Date = new Date()): ZodiacSign {
  const lon = moonLongitude(date);
  const idx = Math.floor(lon / 30) % 12;
  return ZODIAC_SIGNS[idx];
}

/**
 * Find the offset (in days) from `fromDate` to the next/previous occurrence
 * of a given moon phase. If `fromDate` already matches the target phase, the
 * search skips the immediate continuation so the user actually moves to a
 * fresh occurrence rather than staying on a multi-day phase window.
 * Returns 0 if no occurrence is found within ±60 days.
 */
export function findNextPhaseOccurrence(
  targetPhase: MoonPhaseName,
  fromDate: Date,
  direction: "next" | "previous",
): number {
  const step = direction === "next" ? 1 : -1;
  const currentPhase = getCurrentMoonPhase(fromDate).phase;
  const startAlreadyMatches = currentPhase === targetPhase;

  for (let i = 1; i <= 60; i++) {
    const d = new Date(fromDate);
    d.setDate(fromDate.getDate() + step * i);
    const phase = getCurrentMoonPhase(d).phase;
    if (phase === targetPhase) {
      // If start already matched, skip the immediate continuation window so
      // we land on the *next* distinct occurrence.
      if (startAlreadyMatches && i < 3) continue;
      return step * i;
    }
  }
  return 0;
}
