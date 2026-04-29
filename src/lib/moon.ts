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

  // Step in absolute 24h chunks so DST transitions can never shift the
  // probe instant onto the wrong astronomical day. Calendar-day classification
  // happens later via tz-aware helpers — here we only care that each probe
  // is exactly N * 24h away from `fromDate`.
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let i = 1; i <= 60; i++) {
    const d = new Date(fromDate.getTime() + step * i * DAY_MS);
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

/**
 * Find the offset (in days) to the *nearest* occurrence of a target phase in
 * either direction from `fromDate`. Used when tapping a ladder rung — the
 * user wants to land on the closest matching phase, not always the next/prev.
 * Returns 0 if no occurrence is found within ±60 days or if today already
 * matches the target phase.
 */
export function findNearestPhaseOccurrence(
  targetPhase: MoonPhaseName,
  fromDate: Date,
): number {
  const next = findNextPhaseOccurrence(targetPhase, fromDate, "next");
  const prev = findNextPhaseOccurrence(targetPhase, fromDate, "previous");
  if (next === 0) return prev;
  if (prev === 0) return next;
  return Math.abs(next) <= Math.abs(prev) ? next : prev;
}

/**
 * Pre-compute every occurrence of `targetPhase` in the window
 * [fromDate, fromDate + monthsAhead months]. Each occurrence is the day
 * the phase first appears within that lunar cycle.
 *
 * This is the source of truth for the moon ladder: the carousel calls
 * this once at mount per phase, stores the full list, and advances
 * through it on each tap. After the last occurrence we wrap to the
 * first — guaranteeing the user can endlessly walk the year of full
 * moons (or any other phase) without it cycling between just two.
 *
 * Implementation: for the four quarter phases (New / First Quarter /
 * Full / Last Quarter) we use astronomy-engine's `SearchMoonPhase`,
 * which returns the precise UTC moment the moon's ecliptic longitude
 * crosses the target angle (0°, 90°, 180°, 270°). For the multi-day
 * intermediate phases (Waxing Crescent / Waxing Gibbous / Waning
 * Gibbous / Waning Crescent) we still scan day-by-day and record the
 * first day of each matching streak — those phases cover a multi-day
 * window, so an exact moment isn't meaningful.
 */
export function getPhaseOccurrences(
  targetPhase: MoonPhaseName,
  fromDate: Date,
  monthsAhead = 13,
): Date[] {
  const out: Date[] = [];
  // Search bounds are absolute UTC instants. We anchor at the same wall
  // time as `fromDate` (no setHours), and treat `monthsAhead` as
  // 30-day chunks of pure milliseconds so DST cannot expand or shrink
  // the window. astronomy-engine works in absolute UTC, so this is the
  // honest representation; calendar-day projection is done later with
  // tz helpers when needed.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = new Date(fromDate.getTime());
  const end = new Date(start.getTime() + monthsAhead * 30 * DAY_MS);

  // Quarter-phase fast path using SearchMoonPhase.
  const QUARTER_LON: Partial<Record<MoonPhaseName, number>> = {
    "New Moon": 0,
    "First Quarter": 90,
    "Full Moon": 180,
    "Last Quarter": 270,
  };
  const targetLon = QUARTER_LON[targetPhase];
  if (targetLon !== undefined) {
    let searchStart: Date = start;
    // 13 cycles = ~13 lunar months — guaranteed enough to cover monthsAhead.
    for (let i = 0; i < 24; i++) {
      const result = Astronomy.SearchMoonPhase(targetLon, searchStart, 40);
      if (!result) break;
      const occ = result.date;
      if (occ > end) break;
      out.push(occ);
      // Resume search 1 day after the found moment.
      searchStart = new Date(occ.getTime() + 24 * 60 * 60 * 1000);
    }
    return out;
  }

  // Intermediate-phase day-scan fallback.
  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const phase = getCurrentMoonPhase(cursor).phase;
    if (phase === targetPhase) {
      out.push(new Date(cursor));
      // Skip past the rest of this phase window (~80% of a lunar cycle)
      // so we don't record the same occurrence multiple days running.
      cursor = new Date(cursor.getTime() + 24 * DAY_MS);
      continue;
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return out;
}
