/**
 * Q111 Phase 2 — Static metadata for the 78-card Rider-Waite deck.
 *
 * One lookup per cardId (0..77) exposing:
 *   - element (Fire / Water / Air / Earth)
 *   - planet / sign (Golden Dawn decans for minor pips)
 *   - numerological root (1..9) — for courts this is null
 *   - cardNumber (for majors: the major number; for minors: 1..10 for
 *     pips, null for courts)
 *   - suit (null for majors)
 *   - rankLabel ("Ace".."10", "Page".."King", or null for majors)
 *
 * Used by QuickLog's hero descriptor and the astrology / numerology
 * chips. Returns null for oracle cards (cardId >= 1000) and any
 * out-of-range id.
 */

export type CardMeta = {
  element: "Fire" | "Water" | "Air" | "Earth";
  planetOrSign: string | null;
  /** Root reduction (1..9), or null for courts / unknown. */
  root: number | null;
  /** Major number (0..21) for majors, 1..10 for pips, null for courts. */
  cardNumber: number | null;
  suit: "Wands" | "Cups" | "Swords" | "Pentacles" | null;
  rankLabel: string | null;
};

const MAJORS: Array<{ planet: string; element: CardMeta["element"] }> = [
  { planet: "Uranus", element: "Air" }, // 0 Fool
  { planet: "Mercury", element: "Air" }, // 1 Magician
  { planet: "Moon", element: "Water" }, // 2 High Priestess
  { planet: "Venus", element: "Earth" }, // 3 Empress
  { planet: "Aries", element: "Fire" }, // 4 Emperor
  { planet: "Taurus", element: "Earth" }, // 5 Hierophant
  { planet: "Gemini", element: "Air" }, // 6 Lovers
  { planet: "Cancer", element: "Water" }, // 7 Chariot
  { planet: "Leo", element: "Fire" }, // 8 Strength
  { planet: "Virgo", element: "Earth" }, // 9 Hermit
  { planet: "Jupiter", element: "Fire" }, // 10 Wheel
  { planet: "Libra", element: "Air" }, // 11 Justice
  { planet: "Neptune", element: "Water" }, // 12 Hanged Man
  { planet: "Scorpio", element: "Water" }, // 13 Death
  { planet: "Sagittarius", element: "Fire" }, // 14 Temperance
  { planet: "Capricorn", element: "Earth" }, // 15 Devil
  { planet: "Mars", element: "Fire" }, // 16 Tower
  { planet: "Aquarius", element: "Air" }, // 17 Star
  { planet: "Pisces", element: "Water" }, // 18 Moon
  { planet: "Sun", element: "Fire" }, // 19 Sun
  { planet: "Pluto", element: "Fire" }, // 20 Judgement
  { planet: "Saturn", element: "Earth" }, // 21 World
];

const SUITS: Array<CardMeta["suit"]> = ["Wands", "Cups", "Swords", "Pentacles"];
const SUIT_ELEMENT: Record<NonNullable<CardMeta["suit"]>, CardMeta["element"]> = {
  Wands: "Fire",
  Cups: "Water",
  Swords: "Air",
  Pentacles: "Earth",
};
const RANKS = [
  "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Page", "Knight", "Queen", "King",
];

// Golden Dawn decan rulers for pips 2..10. Index = rank - 2.
const PIP_PLANETS: Record<NonNullable<CardMeta["suit"]>, string[]> = {
  Wands: ["Mars", "Sun", "Venus", "Saturn", "Jupiter", "Mars", "Mercury", "Moon", "Saturn"],
  Cups:  ["Venus", "Mercury", "Moon", "Mars", "Sun", "Venus", "Saturn", "Jupiter", "Mars"],
  Swords:["Moon", "Saturn", "Jupiter", "Venus", "Mercury", "Moon", "Jupiter", "Mars", "Sun"],
  Pentacles:["Jupiter", "Mars", "Sun", "Mercury", "Moon", "Saturn", "Sun", "Venus", "Mercury"],
};

function reduceToRoot(n: number): number {
  let v = Math.abs(n);
  while (v > 9) {
    v = String(v).split("").reduce((s, d) => s + Number(d), 0);
  }
  return v;
}

export function getCardMeta(cardId: number): CardMeta | null {
  if (!Number.isFinite(cardId) || cardId < 0 || cardId >= 78) return null;
  if (cardId < 22) {
    const m = MAJORS[cardId];
    return {
      element: m.element,
      planetOrSign: m.planet,
      root: reduceToRoot(cardId === 0 ? 0 : cardId),
      cardNumber: cardId,
      suit: null,
      rankLabel: null,
    };
  }
  const idx = cardId - 22;
  const suit = SUITS[Math.floor(idx / 14)]!;
  const rankIdx = idx % 14;
  const rankLabel = RANKS[rankIdx];
  const element = SUIT_ELEMENT[suit];
  // Aces + courts: no decan; use suit element as fallback descriptor.
  if (rankIdx === 0) {
    return {
      element,
      planetOrSign: null,
      root: 1,
      cardNumber: 1,
      suit,
      rankLabel,
    };
  }
  if (rankIdx >= 10) {
    return {
      element,
      planetOrSign: null,
      root: null,
      cardNumber: null,
      suit,
      rankLabel,
    };
  }
  // Pips 2..10
  const rankNum = rankIdx + 1; // 2..10
  return {
    element,
    planetOrSign: PIP_PLANETS[suit][rankIdx - 1] ?? null,
    root: rankNum === 10 ? 1 : rankNum,
    cardNumber: rankNum,
    suit,
    rankLabel,
  };
}

export function buildCardDescriptor(cardId: number): string | null {
  const meta = getCardMeta(cardId);
  if (!meta) return null;
  // Major arcana
  if (meta.suit === null) {
    const parts = [
      `Card ${meta.cardNumber}`,
      meta.planetOrSign,
      meta.element,
      meta.root != null ? `reduces to ${meta.root}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  // Courts
  if (meta.cardNumber === null) {
    return `${meta.suit} · ${meta.rankLabel} · ${meta.element}`;
  }
  // Pips + Ace
  return `${meta.suit} · Card ${meta.cardNumber} · ${meta.element}${
    meta.root != null ? ` · reduces to ${meta.root}` : ""
  }`;
}

export function getCardRoot(cardId: number): number | null {
  return getCardMeta(cardId)?.root ?? null;
}

export function getCardRulership(cardId: number): string | null {
  return getCardMeta(cardId)?.planetOrSign ?? null;
}
