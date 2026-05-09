/**
 * Filename → tarot-card auto-matcher (Stamp BH).
 *
 * Tokenizes a filename and scores against each of the 78 cards.
 * Returns the assigned card_id (0..77) for the highest-scoring match,
 * or null if no match scored above zero. The caller resolves ties by
 * keeping the first filename to claim a slot.
 */
import { getCardName } from "@/lib/tarot";

const SUITS: Record<string, "wands" | "cups" | "swords" | "pentacles"> = {
  wands: "wands",
  cups: "cups",
  swords: "swords",
  pentacles: "pentacles",
  coins: "pentacles",
  disks: "pentacles",
};

const RANK_ALIASES: Record<string, string> = {
  ace: "ace",
  one: "ace",
  "1": "ace",
  two: "two",
  "2": "two",
  three: "three",
  "3": "three",
  four: "four",
  "4": "four",
  five: "five",
  "5": "five",
  six: "six",
  "6": "six",
  seven: "seven",
  "7": "seven",
  eight: "eight",
  "8": "eight",
  nine: "nine",
  "9": "nine",
  ten: "ten",
  "10": "ten",
  page: "page",
  jack: "page",
  princess: "page",
  knight: "knight",
  prince: "knight",
  queen: "queen",
  king: "king",
};

const RANK_ORDER = [
  "ace",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "page",
  "knight",
  "queen",
  "king",
];

/** A unique single-token name for each Major arcana (lowercase, last word). */
const MAJOR_KEYWORDS: Record<number, string[]> = {
  0: ["fool"],
  1: ["magician"],
  2: ["priestess", "highpriestess"],
  3: ["empress"],
  4: ["emperor"],
  5: ["hierophant"],
  6: ["lovers"],
  7: ["chariot"],
  8: ["strength"],
  9: ["hermit"],
  10: ["fortune", "wheel"],
  11: ["justice"],
  12: ["hanged", "hangedman"],
  13: ["death"],
  14: ["temperance"],
  15: ["devil"],
  16: ["tower"],
  17: ["star"],
  18: ["moon"],
  19: ["sun"],
  20: ["judgement", "judgment"],
  21: ["world"],
};

export function tokenizeFilename(name: string): string[] {
  const noExt = name.replace(/\.[a-z0-9]+$/i, "");
  const lower = noExt.toLowerCase();
  const cleaned = lower.replace(/[-_.\s]+/g, " ").trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens.map((t) => t.replace(/^0+(?=\d)/, ""));
}

export function isCardBackFilename(name: string): boolean {
  // 26-05-08-K — broaden detection to catch common naming variants.
  const lower = name.toLowerCase();
  return (
    /^back[\s_.\-]/i.test(name) ||
    /\bback\.[a-z0-9]+$/i.test(name) ||
    /card[_\-]?back/i.test(lower) ||
    /back[_\-]?card/i.test(lower) ||
    /[_\-]back\.[a-z0-9]+$/i.test(lower)
  );
}

/** Score how well tokens match a particular card_id. Higher = better. */
function scoreCard(tokens: Set<string>, cardId: number): number {
  if (cardId < 22) {
    const numToken = String(cardId);
    const keywords = MAJOR_KEYWORDS[cardId] ?? [];
    const hasKeyword = keywords.some((k) => tokens.has(k));
    const hasNumber = tokens.has(numToken);
    if (hasNumber && (hasKeyword || tokens.has("the"))) return 10;
    if (hasKeyword) return 5;
    return 0;
  }
  // Minor: card_id 22..77
  const minorIdx = cardId - 22;
  const suitIdx = Math.floor(minorIdx / 14);
  const rankIdx = minorIdx % 14;
  const suitName = (["wands", "cups", "swords", "pentacles"] as const)[suitIdx];
  const rank = RANK_ORDER[rankIdx];

  // Check if any token resolves to our suit
  let suitHit = false;
  for (const t of tokens) {
    if (SUITS[t] === suitName) {
      suitHit = true;
      break;
    }
  }
  if (!suitHit) return 0;

  // Check if any token resolves to our rank
  let rankHit = false;
  for (const t of tokens) {
    if (RANK_ALIASES[t] === rank) {
      rankHit = true;
      break;
    }
  }
  if (rankHit) return 10;
  return 0;
}

export type MatchResult = {
  /** Filename → card_id assignments. */
  assignments: Map<string, number>;
  /** 9-6-AB — same map but with the matcher score for each entry, so
   *  callers can categorise high-confidence vs ambiguous matches. */
  scoredAssignments: Map<string, { cardId: number; score: number }>;
  /** Filenames that did not match any card (excluding the back). */
  unmatched: string[];
  /** The detected card-back filename if any. */
  cardBackFile: string | null;
};

/** Match every filename to its best card slot (first-come on ties). */
export function matchFilenames(filenames: string[]): MatchResult {
  const assignments = new Map<string, number>();
  const scoredAssignments = new Map<string, { cardId: number; score: number }>();
  const usedCards = new Set<number>();
  const unmatched: string[] = [];
  let cardBackFile: string | null = null;

  // Pre-compute scores for stable assignment.
  const scored: Array<{
    file: string;
    bestId: number | null;
    bestScore: number;
  }> = [];
  for (const file of filenames) {
    if (cardBackFile === null && isCardBackFilename(file)) {
      cardBackFile = file;
      continue;
    }
    const tokens = new Set(tokenizeFilename(file));
    let bestId: number | null = null;
    let bestScore = 0;
    for (let id = 0; id < 78; id++) {
      const s = scoreCard(tokens, id);
      if (s > bestScore) {
        bestScore = s;
        bestId = id;
      }
    }
    scored.push({ file, bestId, bestScore });
  }

  // Sort high-to-low so strongest matches claim slots first.
  scored.sort((a, b) => b.bestScore - a.bestScore);
  for (const { file, bestId, bestScore } of scored) {
    if (bestId === null || bestScore === 0 || usedCards.has(bestId)) {
      unmatched.push(file);
    } else {
      assignments.set(file, bestId);
      scoredAssignments.set(file, { cardId: bestId, score: bestScore });
      usedCards.add(bestId);
    }
  }

  return { assignments, scoredAssignments, unmatched, cardBackFile };
}

/** Convenience helper used by UI to label a card slot. */
export function cardLabel(cardId: number): string {
  return getCardName(cardId);
}

/** Canonical order of cards: Majors 0-21, then Cups, Wands, Swords, Pentacles
 * each Ace→King. Used by the sequential wizard. */
export function canonicalOrder(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 22; i++) out.push(i);
  // Cups = suitIdx 1, Wands = 0, Swords = 2, Pentacles = 3 in our scheme.
  // Spec asks for Cups, Wands, Swords, Pentacles order.
  const order: Array<0 | 1 | 2 | 3> = [1, 0, 2, 3];
  for (const suitIdx of order) {
    for (let r = 0; r < 14; r++) out.push(22 + suitIdx * 14 + r);
  }
  return out;
}