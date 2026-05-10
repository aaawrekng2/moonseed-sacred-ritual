/**
 * 26-05-08-Q17 — Smart card search index for Manual Entry.
 *
 * Builds an in-memory index over the standard 78-card Rider-Waite deck
 * (and any oracle deck names the caller supplies) and exposes a single
 * `searchCards` function that returns ranked matches using a layered
 * strategy:
 *
 *   1. Group keywords (rank / suit / "majors") — return the whole group
 *   2. Prefix match on the canonical name
 *   3. Word-start match on any word of the canonical name or alias
 *   4. Substring match on canonical name or alias
 *   5. Fuzzy (Levenshtein <= 2) on the canonical name
 *
 * Plus reversed-suffix detection: " (reversed)", " (rev)", " (r)",
 * " reversed", " rev", " r" at the end of the string.
 */

import { TAROT_DECK } from "@/lib/tarot";

export type CardSearchEntry = {
  cardId: number;
  name: string;
  /** Lowercase aliases — abbreviations, "rank suit", etc. */
  aliases: string[];
  rank?: string;
  suit?: string;
  isMajor: boolean;
};

export type CardSearchGroup = {
  /** Heading shown above the rows (e.g. "THREES", "PREFIX MATCH"). */
  label: string;
  entries: CardSearchEntry[];
};

export type CardSearchResult = {
  groups: CardSearchGroup[];
  /** Flat ordered list of entries, used for keyboard navigation. */
  flat: CardSearchEntry[];
};

export type ParsedInput = {
  cleaned: string;
  isReversed: boolean;
};

const RANK_WORDS: Record<string, string> = {
  "1": "Ace", ace: "Ace",
  "2": "Two", two: "Two",
  "3": "Three", three: "Three",
  "4": "Four", four: "Four",
  "5": "Five", five: "Five",
  "6": "Six", six: "Six",
  "7": "Seven", seven: "Seven",
  "8": "Eight", eight: "Eight",
  "9": "Nine", nine: "Nine",
  "10": "Ten", ten: "Ten",
  page: "Page",
  knight: "Knight",
  queen: "Queen",
  king: "King",
};

const SUIT_WORDS: Record<string, string> = {
  wands: "Wands", w: "Wands",
  cups: "Cups", c: "Cups",
  swords: "Swords", s: "Swords",
  pentacles: "Pentacles", p: "Pentacles",
  pents: "Pentacles", coins: "Pentacles",
};

const REVERSED_RE =
  /\s*(?:\(\s*(?:reversed|rev|r)\s*\)|\s(?:reversed|rev|r))\s*$/i;

export function parseReversed(input: string): ParsedInput {
  const m = input.match(REVERSED_RE);
  if (m) {
    return { cleaned: input.slice(0, m.index!).trim(), isReversed: true };
  }
  return { cleaned: input.trim(), isReversed: false };
}

/** Build the search index for the standard tarot deck. */
export function buildTarotSearchIndex(): CardSearchEntry[] {
  const out: CardSearchEntry[] = [];
  for (let id = 0; id < TAROT_DECK.length; id++) {
    const name = TAROT_DECK[id];
    if (id < 22) {
      // Major arcana
      const aliases = new Set<string>();
      aliases.add(name.toLowerCase());
      // strip "the " prefix as alias
      if (name.toLowerCase().startsWith("the ")) {
        aliases.add(name.slice(4).toLowerCase());
      }
      out.push({ cardId: id, name, aliases: [...aliases], isMajor: true });
    } else {
      const m = name.match(/^(\w+) of (\w+)$/);
      const rank = m?.[1] ?? "";
      const suit = m?.[2] ?? "";
      const rankLower = rank.toLowerCase();
      const suitLower = suit.toLowerCase();
      const rankNum = numericForRank(rankLower);
      const aliases = new Set<string>();
      aliases.add(name.toLowerCase());
      aliases.add(`${rankLower} ${suitLower}`);
      aliases.add(`${rankLower}o${suitLower[0]}`);
      aliases.add(`${rankLower}${suitLower[0]}`);
      if (rankNum) {
        aliases.add(`${rankNum}${suitLower[0]}`);
        aliases.add(`${rankNum} of ${suitLower}`);
        aliases.add(`${rankNum} ${suitLower}`);
        aliases.add(`${rankNum}o${suitLower[0]}`);
      }
      // single-letter rank shorthand: "kop" → king of pents
      if (["page", "knight", "queen", "king"].includes(rankLower)) {
        aliases.add(`${rankLower[0]}o${suitLower[0]}`);
        aliases.add(`${rankLower[0]}${suitLower[0]}`);
      }
      out.push({
        cardId: id,
        name,
        aliases: [...aliases],
        rank,
        suit,
        isMajor: false,
      });
    }
  }
  return out;
}

function numericForRank(r: string): string | null {
  switch (r) {
    case "ace": return "1";
    case "two": return "2";
    case "three": return "3";
    case "four": return "4";
    case "five": return "5";
    case "six": return "6";
    case "seven": return "7";
    case "eight": return "8";
    case "nine": return "9";
    case "ten": return "10";
    default: return null;
  }
}

function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  const prev = new Array(lb + 1);
  const cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= lb; j++) prev[j] = cur[j];
  }
  return prev[lb];
}

/**
 * Search the index for the given input (already free of any reversed
 * suffix). Returns grouped + flat results capped at ~20 entries.
 */
export function searchCards(
  index: CardSearchEntry[],
  rawInput: string,
  limit = 20,
): CardSearchResult {
  const q = rawInput.trim().toLowerCase();
  if (!q) return { groups: [], flat: [] };

  // 1. Group keywords
  if (q === "majors" || q === "major" || q === "major arcana") {
    const entries = index.filter((e) => e.isMajor);
    return {
      groups: [{ label: "MAJOR ARCANA", entries }],
      flat: entries,
    };
  }
  const suit = SUIT_WORDS[q];
  if (suit && q.length > 1) {
    const entries = index.filter((e) => e.suit === suit);
    if (entries.length) {
      return {
        groups: [{ label: suit.toUpperCase(), entries }],
        flat: entries,
      };
    }
  }
  const rank = RANK_WORDS[q];
  if (rank) {
    const entries = index.filter((e) => e.rank === rank);
    if (entries.length) {
      const label =
        rank === "Ace"
          ? "ACES"
          : rank.endsWith("e") || rank.endsWith("y")
            ? `${rank.toUpperCase()}S`
            : `${rank.toUpperCase()}S`;
      return { groups: [{ label, entries }], flat: entries };
    }
  }

  // 2-4. Layered match.
  const seen = new Set<number>();
  const prefix: CardSearchEntry[] = [];
  const wordStart: CardSearchEntry[] = [];
  const substring: CardSearchEntry[] = [];
  const fuzzy: CardSearchEntry[] = [];

  const matchesAlias = (
    e: CardSearchEntry,
    pred: (s: string) => boolean,
  ): boolean => {
    if (pred(e.name.toLowerCase())) return true;
    return e.aliases.some(pred);
  };

  for (const e of index) {
    if (matchesAlias(e, (s) => s.startsWith(q))) {
      prefix.push(e);
      seen.add(e.cardId);
      continue;
    }
    if (
      matchesAlias(e, (s) =>
        s.split(/\s+/).some((w) => w.startsWith(q)),
      )
    ) {
      wordStart.push(e);
      seen.add(e.cardId);
      continue;
    }
    if (matchesAlias(e, (s) => s.includes(q))) {
      substring.push(e);
      seen.add(e.cardId);
      continue;
    }
  }

  if (q.length >= 3 && prefix.length + wordStart.length + substring.length === 0) {
    for (const e of index) {
      if (seen.has(e.cardId)) continue;
      const d = levenshtein(q, e.name.toLowerCase(), 2);
      if (d <= 2) {
        fuzzy.push(e);
        seen.add(e.cardId);
      }
    }
  }

  const groups: CardSearchGroup[] = [];
  if (prefix.length) groups.push({ label: "PREFIX MATCH", entries: prefix });
  if (wordStart.length) groups.push({ label: "STARTS WITH", entries: wordStart });
  if (substring.length) groups.push({ label: "CONTAINS", entries: substring });
  if (fuzzy.length) groups.push({ label: "DID YOU MEAN…", entries: fuzzy });

  // Cap.
  let remaining = limit;
  const cappedGroups: CardSearchGroup[] = [];
  for (const g of groups) {
    if (remaining <= 0) break;
    const take = g.entries.slice(0, remaining);
    cappedGroups.push({ label: g.label, entries: take });
    remaining -= take.length;
  }

  const flat = cappedGroups.flatMap((g) => g.entries);
  return { groups: cappedGroups, flat };
}

/**
 * Resolve a single segment (e.g. one entry from a comma-separated paste)
 * to the best card match plus reversed flag. Returns null when nothing
 * matches.
 */
export function resolveSegment(
  index: CardSearchEntry[],
  segment: string,
): { entry: CardSearchEntry; isReversed: boolean; ambiguous: boolean } | null {
  const parsed = parseReversed(segment);
  if (!parsed.cleaned) return null;
  const r = searchCards(index, parsed.cleaned, 5);
  if (r.flat.length === 0) return null;
  // Strong-match heuristic: a single prefix match OR exact name hit.
  const exact = r.flat.find(
    (e) => e.name.toLowerCase() === parsed.cleaned.toLowerCase(),
  );
  if (exact) {
    return { entry: exact, isReversed: parsed.isReversed, ambiguous: false };
  }
  const prefixGroup = r.groups.find((g) => g.label === "PREFIX MATCH");
  const ambiguous = !(prefixGroup && prefixGroup.entries.length === 1) && r.flat.length > 1;
  return {
    entry: r.flat[0],
    isReversed: parsed.isReversed,
    ambiguous,
  };
}