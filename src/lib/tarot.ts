// Canonical Rider-Waite 78-card index. Names only — face images live in
// public/cards/card-00.jpg .. card-77.jpg (loaded lazily on reveal).

export type TarotCardId = number; // 0..77

const MAJORS = [
  "The Fool",
  "The Magician",
  "The High Priestess",
  "The Empress",
  "The Emperor",
  "The Hierophant",
  "The Lovers",
  "The Chariot",
  "Strength",
  "The Hermit",
  "Wheel of Fortune",
  "Justice",
  "The Hanged Man",
  "Death",
  "Temperance",
  "The Devil",
  "The Tower",
  "The Star",
  "The Moon",
  "The Sun",
  "Judgement",
  "The World",
];

const RANKS = [
  "Ace",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Page",
  "Knight",
  "Queen",
  "King",
];

const SUITS = ["Wands", "Cups", "Swords", "Pentacles"] as const;

function buildDeck(): string[] {
  const out = [...MAJORS];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push(`${rank} of ${suit}`);
    }
  }
  return out;
}

export const TAROT_DECK: readonly string[] = buildDeck();

export function getCardName(id: TarotCardId): string {
  return TAROT_DECK[id] ?? `Card ${id}`;
}

export function getCardImagePath(id: TarotCardId): string {
  // 26-05-08-Q2 — Fix 1: oracle ids (>=1000) have no static fallback
  // image. Returning the constructed `/cards/card-1042.jpg` path
  // produces a hard 404 in the network panel and a broken IMG.
  // Callers that resolve through a custom deck already short-circuit
  // before reaching here; this guard catches the few remaining sites
  // that fall through to the default path.
  if (id >= 1000) return "";
  const padded = String(id).padStart(2, "0");
  return `/cards/card-${padded}.jpg`;
}

// Alias kept for newer call sites / docs that reference `getCardImageUrl`.
export const getCardImageUrl = getCardImagePath;

/**
 * EJ — suit + arcana helpers used by the Insights aggregations.
 * Matches the canonical 0..77 deck order built above:
 *   0..21  — Major Arcana
 *   22..35 — Wands
 *   36..49 — Cups
 *   50..63 — Swords
 *   64..77 — Pentacles
 */
export type CardSuit = "Wands" | "Cups" | "Swords" | "Pentacles" | "Major";

export function getCardArcana(id: TarotCardId): "major" | "minor" {
  return id >= 0 && id <= 21 ? "major" : "minor";
}

export function getCardSuit(id: TarotCardId): CardSuit {
  if (id <= 21) return "Major";
  if (id <= 35) return "Wands";
  if (id <= 49) return "Cups";
  if (id <= 63) return "Swords";
  return "Pentacles";
}

// Q52d — Map a tarot card id (0-77) to its raw numerology number.
// Majors: The Fool (0) is unnumbered; Majors 1-21 use their card number.
// Minors Ace-Ten: rank 1-10. Courts and oracle cards return null.
export function cardNumerologyNumber(cardId: TarotCardId): number | null {
  if (cardId < 0) return null;
  if (cardId >= 1000) return null; // oracle cards out of scope
  if (cardId <= 21) {
    if (cardId === 0) return null;
    return cardId;
  }
  if (cardId > 77) return null;
  const positionInSuit = (cardId - 22) % 14;
  if (positionInSuit >= 0 && positionInSuit <= 9) {
    return positionInSuit + 1;
  }
  return null; // courts
}

// Q52d — Reduce a card's numerology to a single digit (or master 11/22/33).
// Returns null when the card has no numerology (courts, Fool, oracle).
export function cardNumerologyReduced(cardId: TarotCardId): number | null {
  const n = cardNumerologyNumber(cardId);
  if (n === null) return null;
  let v = n;
  while (v > 9 && v !== 11 && v !== 22 && v !== 33) {
    v = String(v).split("").reduce((s, c) => s + Number(c), 0);
  }
  return v;
}