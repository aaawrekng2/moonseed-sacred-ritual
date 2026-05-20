/**
 * Phase 8 — Deep Reading client-side helpers.
 *
 * Two responsibilities, both pure / no AI calls:
 *  - `computeMistIntensity` — turns a slice of recent readings into a
 *    0-4 mist intensity level + a plain teaser sentence the limit
 *    overlay can surface without paying for an AI call.
 *  - `getNextDawn` — formats the user's local "next 5am" so the
 *    overlay can whisper a return time when the daily gate is hit.
 *  - `dawnCycleDateLocal` — the YYYY-MM-DD bucket used by the server
 *    to count free-tier deep readings per local day.
 */
import { getCardName } from "@/lib/tarot";
import { isoDayInTz, addDaysInTz, formatTimeInTz } from "@/lib/time";

export type MistIntensity = 0 | 1 | 2 | 3 | 4;

export type MistState = {
  level: MistIntensity;
  /** Plain serif-italic line shown floating inside the mist. */
  whisper: string;
  /** True when a recurring card / suit pattern was detected. */
  patternDetected: boolean;
  /** One-sentence teaser used by the limit overlay. May be empty. */
  patternTeaser: string;
};

const SUIT_RANGES: Array<{ name: string; from: number; to: number }> = [
  // Tarot deck index: 0..21 majors, 22..35 Wands, 36..49 Cups,
  // 50..63 Swords, 64..77 Pentacles. Mirrors src/lib/tarot.ts buildDeck().
  { name: "Wands", from: 22, to: 35 },
  { name: "Cups", from: 36, to: 49 },
  { name: "Swords", from: 50, to: 63 },
  { name: "Pentacles", from: 64, to: 77 },
];

function suitOf(cardId: number): string | null {
  for (const s of SUIT_RANGES) {
    if (cardId >= s.from && cardId <= s.to) return s.name;
  }
  return null;
}

const WHISPERS: Record<MistIntensity, string> = {
  0: "The cards are listening.",
  1: "Something stirs beneath the surface.",
  2: "A thread is beginning to weave.",
  3: "Something is emerging in your practice.",
  4: "The deeper layer is ready for you.",
};

/**
 * Compute mist intensity from the user's last ~30 readings.
 * Pass each reading's `card_ids` array (newest first or any order —
 * order does not affect the level).
 */
export function computeMistIntensity(
  recentReadings: ReadonlyArray<{ card_ids: number[] | null }>,
): MistState {
  const total = recentReadings.length;

  // Count card and suit occurrences across the last 30 spreads.
  const cardCounts: Record<number, number> = {};
  const suitSpreads: Record<string, number> = {};

  for (const r of recentReadings) {
    const ids = r.card_ids ?? [];
    const suitsThisSpread = new Set<string>();
    for (const id of ids) {
      cardCounts[id] = (cardCounts[id] ?? 0) + 1;
      const s = suitOf(id);
      if (s) suitsThisSpread.add(s);
    }
    for (const s of suitsThisSpread) {
      suitSpreads[s] = (suitSpreads[s] ?? 0) + 1;
    }
  }

  // Recurring card: any card name appearing 3+ times.
  let topCardId: number | null = null;
  let topCardCount = 0;
  for (const [idStr, count] of Object.entries(cardCounts)) {
    if (count > topCardCount) {
      topCardCount = count;
      topCardId = Number(idStr);
    }
  }
  const cardPattern = topCardCount >= 3;

  // Dominant suit: appears in >50% of recent spreads (only meaningful
  // once a few readings exist — guard against tiny samples).
  let dominantSuit: string | null = null;
  let dominantSuitRatio = 0;
  if (total >= 4) {
    for (const [suit, count] of Object.entries(suitSpreads)) {
      const ratio = count / total;
      if (ratio > 0.5 && ratio > dominantSuitRatio) {
        dominantSuit = suit;
        dominantSuitRatio = ratio;
      }
    }
  }

  const patternDetected = cardPattern || dominantSuit !== null;

  // Compose teaser sentence (used by the limit overlay).
  let patternTeaser = "";
  if (cardPattern && topCardId !== null) {
    patternTeaser = `${getCardName(topCardId)} has appeared in ${topCardCount} of your last ${total} readings.`;
  } else if (dominantSuit) {
    patternTeaser = `${dominantSuit} have dominated your spreads this week.`;
  }

  // Map to intensity level per spec.
  let level: MistIntensity;
  if (total >= 30 && patternDetected) level = 4;
  else if (patternDetected) level = 3;
  else if (total >= 11) level = 2;
  else if (total >= 3) level = 1;
  else level = 0;

  return {
    level,
    whisper: WHISPERS[level],
    patternDetected,
    patternTeaser,
  };
}

/**
 * Local-time YYYY-MM-DD for the user's "current dawn cycle". A new
 * cycle starts at 5am local — so any reading drawn between midnight
 * and 4:59am still belongs to the *previous* day's cycle. Dawn is
 * tz-sensitive (happens at the seeker's location), so the caller MUST
 * pass their IANA timezone.
 */
export function dawnCycleDateLocal(tz: string, now: Date = new Date()): string {
  // Detect pre-5am in seeker's tz using formatTimeInTz hour parse.
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = Number(hourStr.replace(/[^0-9]/g, "")) || 0;
  const d = hour < 5 ? addDaysInTz(now, -1, tz) : now;
  return isoDayInTz(d, tz);
}

/**
 * The next 5:00am in the seeker's local tz, returned as ISO + a short
 * "5:25 am"-style label the overlay can render without re-parsing.
 */
export function getNextDawn(tz: string, now: Date = new Date()): { iso: string; label: string } {
  // Anchor on today's calendar day in tz, then walk to 5am-of-that-day.
  const today = isoDayInTz(now, tz);
  const [y, m, d] = today.split("-").map(Number);
  // Build a candidate Date at 05:00 in tz by stepping from midnight-in-tz.
  // parseIsoDay returns midnight-in-tz as a UTC instant; add 5h.
  // To avoid importing parseIsoDay separately, reuse addDaysInTz semantics:
  // construct via Date.UTC fallback approximation, then nudge into tz window.
  let candidate = new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0));
  // Probe: shift by the offset between candidate's tz-hour and target 5.
  for (let i = 0; i < 4; i++) {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(candidate);
    const obsHour = Number(hourStr.replace(/[^0-9]/g, "")) || 0;
    if (obsHour === 5) break;
    candidate = new Date(candidate.getTime() + (5 - obsHour) * 3_600_000);
  }
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 3_600_000);
  }
  return { iso: candidate.toISOString(), label: formatTimeInTz(candidate, tz) };
}