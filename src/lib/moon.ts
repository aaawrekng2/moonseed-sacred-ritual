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

export type ZodiacSign =
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

export interface MoonInfo {
  date: Date;
  phase: MoonPhaseName;
  glyph: string;
  illumination: number;
  angle: number;
}

export const PHASE_GLYPHS: Record<MoonPhaseName, string> = {
  "New Moon": "🌑",
  "Waxing Crescent": "🌒",
  "First Quarter": "🌓",
  "Waxing Gibbous": "🌔",
  "Full Moon": "🌕",
  "Waning Gibbous": "🌖",
  "Last Quarter": "🌗",
  "Waning Crescent": "🌘",
};

export const ZODIAC_SIGNS: ZodiacSign[] = [
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

function classifyPhase(angle: number): MoonPhaseName {
  const orb = 3;
  if (angle <= orb || angle >= 360 - orb) return "New Moon";
  if (Math.abs(angle - 90) <= orb) return "First Quarter";
  if (Math.abs(angle - 180) <= orb) return "Full Moon";
  if (Math.abs(angle - 270) <= orb) return "Last Quarter";
  if (angle > 0 && angle < 90) return "Waxing Crescent";
  if (angle > 90 && angle < 180) return "Waxing Gibbous";
  if (angle > 180 && angle < 270) return "Waning Gibbous";
  return "Waning Crescent";
}

export function getCurrentMoonPhase(date: Date = new Date()): MoonInfo {
  const angle = Astronomy.MoonPhase(date);
  const phase = classifyPhase(angle);
  const illumination = Math.round(
    Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction * 100,
  );
  return {
    date,
    phase,
    glyph: PHASE_GLYPHS[phase],
    illumination,
    angle,
  };
}

export function getMoonSign(date: Date = new Date()): ZodiacSign {
  const v = Astronomy.GeoMoon(date);
  const ecl = Astronomy.Ecliptic(v);
  const longitude = ((ecl.elon % 360) + 360) % 360;
  return ZODIAC_SIGNS[Math.floor(longitude / 30) % 12];
}