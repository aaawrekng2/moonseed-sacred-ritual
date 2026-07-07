/**
 * v3.03 — encode/decode the /lunations view state to/from readable URL query
 * params, so a bookmarked/shared URL reconstructs the full view: the slot cards
 * (in order = position, with an "r" suffix for reversed), the strip lens, the
 * asterism (teal) selection, the range, and the hero slot.
 *
 * decode never throws: malformed or out-of-range values are dropped and fall
 * back to defaults, so a bad URL degrades to an empty/default view rather than
 * breaking the page.
 *
 * Params:
 *   cards=17,42r,3   ordered slot cardIndexes; trailing "r" = reversed
 *   lens=moon|day    strip lens
 *   stars=42,3       asterism / teal-selected cardIndexes
 *   range=365d       timeframe
 *   hero=0           hero slot index (0-based)
 */
import { TAROT_DECK } from "@/lib/tarot";

export type LunationCard = { cardIndex: number; isReversed: boolean };

export type LunationView = {
  cards: LunationCard[];
  lens: "moon" | "day" | "calendar" | "numerology" | "weekday";
  stars: number[];
  range: string;
  heroIdx: number | null;
};

const validCard = (n: number) =>
  Number.isInteger(n) && n >= 0 && n < TAROT_DECK.length;

export function encodeLunationView(v: LunationView): string {
  const p = new URLSearchParams();
  if (v.cards.length) {
    p.set(
      "cards",
      v.cards
        .map((c) => `${c.cardIndex}${c.isReversed ? "r" : ""}`)
        .join(","),
    );
  }
  if (v.lens) p.set("lens", v.lens);
  if (v.stars.length) p.set("stars", v.stars.join(","));
  if (v.range) p.set("range", v.range);
  if (v.heroIdx != null && v.heroIdx >= 0) p.set("hero", String(v.heroIdx));
  return p.toString();
}

export function decodeLunationView(search: string): Partial<LunationView> {
  const p = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const out: Partial<LunationView> = {};

  const cardsRaw = p.get("cards");
  if (cardsRaw) {
    const cards: LunationCard[] = [];
    for (const tok of cardsRaw.split(",")) {
      const m = /^(\d+)(r?)$/.exec(tok.trim());
      if (!m) continue;
      const idx = Number(m[1]);
      if (!validCard(idx)) continue;
      cards.push({ cardIndex: idx, isReversed: m[2] === "r" });
    }
    if (cards.length) out.cards = cards;
  }

  const lens = p.get("lens");
  if (
    lens === "moon" ||
    lens === "day" ||
    lens === "calendar" ||
    lens === "numerology" ||
    lens === "weekday"
  )
    out.lens = lens;

  const starsRaw = p.get("stars");
  if (starsRaw) {
    const stars = starsRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(validCard);
    out.stars = stars;
  }

  const range = p.get("range");
  if (range && /^(\d+d|all)$/.test(range)) out.range = range;

  const hero = p.get("hero");
  if (hero != null) {
    const h = Number(hero);
    if (Number.isInteger(h) && h >= 0) out.heroIdx = h;
  }

  return out;
}
