/**
 * v3.41 — live per-spread structural signals for the draw table.
 *
 * Pure functions, no React. Given the current cast (the cards placed on the
 * table), compute the "composition" patterns from the Pattern Detection
 * reference §1: suit dominance / missing suit, rank multiples (two/three/four
 * of a kind) with the numerology keyword, court density + court multiples,
 * major/minor lean, and reversal density.
 *
 * These are whole-spread signals — the message is in the composition, not in
 * any single card's lore. Card→group membership reuses the validated
 * cardMemberships() from pattern-engine so suit/rank/court are defined once.
 */
import { cardMemberships } from "./pattern-engine";

export type SpreadPick = { cardIndex: number; isReversed: boolean };

export type SpreadSignal = {
  /** stable-ish key for React lists */
  key: string;
  /** short headline, e.g. "Cups-dominant" or "Three Sevens" */
  label: string;
  /** the meaning / why-it-matters line */
  detail: string;
};

export type SpreadStructure = { total: number; signals: SpreadSignal[] };

const SUIT_LABEL: Record<string, string> = {
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pentacles",
};
const SUIT_THEME: Record<string, string> = {
  wands: "energy, drive, creativity",
  cups: "emotions, relationships, the heart",
  swords: "intellect, conflict, communication",
  pentacles: "money, work, the material world",
};
const SUIT_ABSENCE: Record<string, string> = {
  wands: "low motivation — drive needs reigniting",
  cups: "blocked emotional flow",
  swords: "fuzzy thinking or communication",
  pentacles: "ungrounded — hard to manifest",
};

const RANK_NAME = ["Aces", "Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens"];
const RANK_THEME = [
  "beginnings, a singular focus",
  "balance, partnership, a decision",
  "growth, groups, creativity",
  "stability, foundations (or stagnation)",
  "conflict, loss, instability",
  "harmony, resolution, transition",
  "assessment, reflection, testing",
  "movement, power, mastery",
  "near-completion, intensity",
  "completion, a cycle ending",
];
const COUNT_WORD = ["", "", "Two", "Three", "Four"];

const COURT_LABEL: Record<string, string> = { page: "Pages", knight: "Knights", queen: "Queens", king: "Kings" };
const COURT_THEME: Record<string, string> = {
  page: "learning, fresh ideas, youth",
  knight: "events in motion, movement",
  queen: "social & friendship dynamics",
  king: "authority, recognition, mastery",
};

const MINOR_SUITS = ["wands", "cups", "swords", "pentacles"] as const;

const DOMINANT_FRACTION = 0.4; // a suit at >=40% of the spread reads as dominant
const REVERSAL_HEAVY_FRACTION = 0.5; // >=50% reversed reads as blocked/internalized
const MISSING_SUIT_MIN = 4; // only flag an absent suit once the spread is this big

/**
 * Analyze the current cast. Returns [] of signals (empty for spreads < 2 cards,
 * where composition has nothing to say).
 */
export function analyzeSpread(picks: SpreadPick[]): SpreadStructure {
  const total = picks.length;
  if (total < 2) return { total, signals: [] };

  const suitCount: Record<string, number> = { wands: 0, cups: 0, swords: 0, pentacles: 0, majors: 0 };
  const rankCount = new Array<number>(11).fill(0); // index 1..10
  const rankSuits: Array<Set<string>> = Array.from({ length: 11 }, () => new Set<string>());
  const courtCount: Record<string, number> = { page: 0, knight: 0, queen: 0, king: 0 };
  let majorCount = 0;
  let reversedCount = 0;

  for (const p of picks) {
    const m = cardMemberships(p.cardIndex);
    suitCount[m.suit] = (suitCount[m.suit] ?? 0) + 1;
    if (m.isMajor) majorCount += 1;
    if (m.number) {
      const n = Number(m.number.replace("n", ""));
      rankCount[n] += 1;
      rankSuits[n].add(m.suit);
    }
    if (m.court) courtCount[m.court] += 1;
    if (p.isReversed) reversedCount += 1;
  }

  const signals: SpreadSignal[] = [];

  // Rank multiples (two/three/four of a kind) — strongest signals first.
  for (let n = 1; n <= 10; n += 1) {
    const c = rankCount[n];
    if (c < 2) continue;
    const word = COUNT_WORD[Math.min(c, 4)];
    let detail = RANK_THEME[n - 1] + ".";
    if (c === 3) {
      const present = rankSuits[n];
      const missing = MINOR_SUITS.filter((s) => !present.has(s)).map((s) => SUIT_LABEL[s]);
      if (missing.length === 1) detail += ` Missing ${missing[0]} — note its absence.`;
    }
    signals.push({
      key: `rank-${n}`,
      label: `${word} ${RANK_NAME[n - 1]}`,
      detail: c >= 4 ? `A concentrated message: ${detail}` : detail,
    });
  }

  // Suit dominance (minor suits only; majors handled by the major/minor lean).
  let domSuit: string | null = null;
  let domN = 0;
  for (const s of MINOR_SUITS) {
    if (suitCount[s] > domN) {
      domN = suitCount[s];
      domSuit = s;
    }
  }
  if (domSuit && domN >= 2 && domN / total >= DOMINANT_FRACTION) {
    signals.push({
      key: `dom-${domSuit}`,
      label: `${SUIT_LABEL[domSuit]}-dominant`,
      detail: `${SUIT_THEME[domSuit]} is centre stage (${domN} of ${total}).`,
    });
  }

  // Major / minor lean.
  if (majorCount >= 2 && majorCount / total >= 0.5) {
    signals.push({
      key: "major-heavy",
      label: "Major-heavy",
      detail: `Big-picture, fated forces (${majorCount} of ${total} Majors) — give it weight.`,
    });
  } else if (majorCount === 0 && total >= 3) {
    signals.push({
      key: "all-minor",
      label: "All Minors",
      detail: "Everyday, practical, within your control.",
    });
  }

  // Court density + court multiples.
  const totalCourts = courtCount.page + courtCount.knight + courtCount.queen + courtCount.king;
  if (totalCourts >= 3) {
    signals.push({
      key: "court-heavy",
      label: "Crowded with people",
      detail: `${totalCourts} court cards — the situation is full of other people's influence.`,
    });
  }
  for (const rank of ["page", "knight", "queen", "king"] as const) {
    const c = courtCount[rank];
    if (c >= 2) {
      signals.push({
        key: `court-${rank}`,
        label: `${COUNT_WORD[Math.min(c, 4)]} ${COURT_LABEL[rank]}`,
        detail: COURT_THEME[rank] + ".",
      });
    }
  }

  // Reversal density.
  if (total >= 2 && reversedCount / total >= REVERSAL_HEAVY_FRACTION) {
    const pct = Math.round((reversedCount / total) * 100);
    signals.push({
      key: "reversed-heavy",
      label: "Heavily reversed",
      detail: `${reversedCount} of ${total} reversed (${pct}%) — blocked or internalized energy.`,
    });
  }

  // Missing suit — only when exactly ONE minor suit is conspicuously absent
  // (the other three present) in a fuller spread. Two-or-more missing suits
  // just means a small or Major-heavy spread, which isn't itself a signal.
  if (total >= MISSING_SUIT_MIN) {
    const absent = MINOR_SUITS.filter((s) => suitCount[s] === 0);
    if (absent.length === 1) {
      const s = absent[0];
      signals.push({
        key: `missing-${s}`,
        label: `No ${SUIT_LABEL[s]}`,
        detail: SUIT_ABSENCE[s] + ".",
      });
    }
  }

  return { total, signals };
}
