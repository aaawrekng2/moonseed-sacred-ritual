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
  const padded = String(id).padStart(2, "0");
  return `/cards/card-${padded}.jpg`;
}

// Alias kept for newer call sites / docs that reference `getCardImageUrl`.
export const getCardImageUrl = getCardImagePath;