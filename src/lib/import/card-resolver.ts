/**
 * CSV import — card resolver (CS).
 *
 * Resolves arbitrary tarot-card name strings (across many app exports
 * and notational quirks) into Tarot Seed's canonical 0..77 deck index.
 *
 * Coverage:
 *   - 22 Major Arcana (full / short / Roman / Arabic / all-caps)
 *   - 56 Minor Arcana with suit synonyms
 *     (Pentacles = Coins = Disks; Wands = Staves = Rods;
 *      Swords = Blades; Cups = Chalices)
 *   - Court cards Page/Knight/Queen/King with Thoth aliases
 *     (Princess = Page, Prince = Knight)
 *   - Levenshtein-1/2 fuzzy fallback for typos.
 *
 * Reversal markers (suffix "(R)", "reversed", " - reversed", etc.) are
 * stripped before lookup; see {@link normalizeReversal} for the
 * orientation parser.
 */
import { TAROT_DECK, getCardName } from "@/lib/tarot";

export type CardResolveResult =
  | { kind: "matched"; cardIndex: number; confidence: number; canonical: string }
  | { kind: "probable"; cardIndex: number; confidence: number; canonical: string }
  | { kind: "unmatched"; rawName: string };

const MAJOR_NAMES = TAROT_DECK.slice(0, 22) as readonly string[];

const ROMAN_TO_NUM: Record<string, number> = {
  "0": 0, O: 0,
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17,
  XVIII: 18, XIX: 19, XX: 20, XXI: 21,
};

const SUIT_CANONICAL: Record<string, "Wands" | "Cups" | "Swords" | "Pentacles"> = {
  wands: "Wands", wand: "Wands", staves: "Wands", stave: "Wands",
  rods: "Wands", rod: "Wands", batons: "Wands", baton: "Wands",
  cups: "Cups", cup: "Cups", chalices: "Cups", chalice: "Cups",
  hearts: "Cups",
  swords: "Swords", sword: "Swords", blades: "Swords", blade: "Swords",
  spades: "Swords",
  pentacles: "Pentacles", pentacle: "Pentacles",
  coins: "Pentacles", coin: "Pentacles",
  disks: "Pentacles", disk: "Pentacles", discs: "Pentacles", disc: "Pentacles",
  diamonds: "Pentacles",
};

const RANK_CANONICAL: Record<string, string> = {
  ace: "Ace", "1": "Ace", i: "Ace",
  two: "Two", "2": "Two", ii: "Two",
  three: "Three", "3": "Three", iii: "Three",
  four: "Four", "4": "Four", iv: "Four",
  five: "Five", "5": "Five", v: "Five",
  six: "Six", "6": "Six", vi: "Six",
  seven: "Seven", "7": "Seven", vii: "Seven",
  eight: "Eight", "8": "Eight", viii: "Eight",
  nine: "Nine", "9": "Nine", ix: "Nine",
  ten: "Ten", "10": "Ten", x: "Ten",
  page: "Page", princess: "Page", jack: "Page",
  knight: "Knight", prince: "Knight",
  queen: "Queen",
  king: "King",
};

/* ------------------------- Normalization ------------------------- */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[._\-:;,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip reversal markers from a raw card string. */
function stripReversal(raw: string): string {
  return raw
    .replace(/\s*\(\s*r\s*\)\s*$/i, "")
    .replace(/\s*\(\s*reversed\s*\)\s*$/i, "")
    .replace(/\s*\breversed\b\s*$/i, "")
    .replace(/\s*\brev\b\s*$/i, "")
    .replace(/\s*\bupright\b\s*$/i, "")
    .replace(/\s*-\s*reversed\s*$/i, "")
    .trim();
}

/** Detect reversal from a free-form value (boolean, string, suffix). */
export function normalizeReversal(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  if (["true", "t", "yes", "y", "1", "reversed", "rev", "r", "down", "inverted"].includes(s)) {
    return true;
  }
  if (["false", "f", "no", "n", "0", "upright", "up", "normal"].includes(s)) {
    return false;
  }
  // Suffix on the card name itself.
  return /\b(reversed|reverse|inverted)\b|\(r\)\s*$/i.test(s);
}

/** Detect & strip reversal in a single pass. */
export function splitOrientation(raw: string): { name: string; reversed: boolean } {
  const reversed = normalizeReversal(raw);
  return { name: stripReversal(raw), reversed };
}

/* ------------------------- Index helpers ------------------------- */

const SUIT_OFFSET: Record<string, number> = {
  Wands: 22,
  Cups: 22 + 14,
  Swords: 22 + 28,
  Pentacles: 22 + 42,
};
const RANK_INDEX: Record<string, number> = {
  Ace: 0, Two: 1, Three: 2, Four: 3, Five: 4, Six: 5, Seven: 6,
  Eight: 7, Nine: 8, Ten: 9, Page: 10, Knight: 11, Queen: 12, King: 13,
};

function minorIndex(rank: string, suit: string): number | null {
  const r = RANK_INDEX[rank];
  const off = SUIT_OFFSET[suit];
  if (r == null || off == null) return null;
  return off + r;
}

/* ------------------------- Dictionary build ------------------------- */

const DICT = new Map<string, number>();

function add(key: string, idx: number) {
  const k = normalize(key);
  if (k && !DICT.has(k)) DICT.set(k, idx);
}

// Major arcana variants
for (let i = 0; i < MAJOR_NAMES.length; i++) {
  const full = MAJOR_NAMES[i];
  add(full, i);
  // Without "The"
  const short = full.replace(/^the\s+/i, "");
  add(short, i);
  // With Roman numeral prefixes/suffixes
  const romanEntry = Object.entries(ROMAN_TO_NUM).find(([, n]) => n === i);
  const roman = romanEntry?.[0];
  if (roman) {
    add(`${roman} ${full}`, i);
    add(`${roman} ${short}`, i);
    add(`${roman} - ${full}`, i);
    add(`${roman} - ${short}`, i);
    add(`${roman}. ${full}`, i);
    add(`${roman}. ${short}`, i);
    add(`${full} ${roman}`, i);
  }
  // Arabic numeral
  add(`${i} ${full}`, i);
  add(`${i} ${short}`, i);
  add(`${i}. ${full}`, i);
  add(`${i} - ${full}`, i);
}

// Minor arcana variants
for (const suit of ["Wands", "Cups", "Swords", "Pentacles"] as const) {
  for (const [rankKey, rank] of Object.entries(RANK_INDEX)) {
    const idx = SUIT_OFFSET[suit] + rank;
    add(`${rankKey} of ${suit}`, idx);
    // Suit synonyms
    for (const [synSuit, canon] of Object.entries(SUIT_CANONICAL)) {
      if (canon !== suit) continue;
      add(`${rankKey} of ${synSuit}`, idx);
      // Compact forms like "3W", "3-Wands", "3 Wands"
      const rankCompact = rankKey === "Ace" ? "1"
        : rankKey === "Two" ? "2"
        : rankKey === "Three" ? "3"
        : rankKey === "Four" ? "4"
        : rankKey === "Five" ? "5"
        : rankKey === "Six" ? "6"
        : rankKey === "Seven" ? "7"
        : rankKey === "Eight" ? "8"
        : rankKey === "Nine" ? "9"
        : rankKey === "Ten" ? "10"
        : rankKey.charAt(0); // P, Kn, Q, K — covered as Page/Knight/Queen/King below
      add(`${rankCompact} ${synSuit}`, idx);
      add(`${rankCompact} of ${synSuit}`, idx);
    }
    // Roman numerals for minor pip cards (1-10)
    const romanEntry = Object.entries(ROMAN_TO_NUM).find(([, n]) => {
      if (rankKey === "Ace") return n === 1;
      const map: Record<string, number> = {
        Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7,
        Eight: 8, Nine: 9, Ten: 10,
      };
      return map[rankKey] === n;
    });
    if (romanEntry) {
      const [roman] = romanEntry;
      add(`${roman} of ${suit}`, idx);
      for (const [synSuit, canon] of Object.entries(SUIT_CANONICAL)) {
        if (canon !== suit) continue;
        add(`${roman} of ${synSuit}`, idx);
      }
    }
    // Thoth aliases (Princess = Page, Prince = Knight)
    if (rankKey === "Page") {
      add(`Princess of ${suit}`, idx);
      for (const [synSuit, canon] of Object.entries(SUIT_CANONICAL)) {
        if (canon === suit) add(`Princess of ${synSuit}`, idx);
      }
    }
    if (rankKey === "Knight") {
      add(`Prince of ${suit}`, idx);
      for (const [synSuit, canon] of Object.entries(SUIT_CANONICAL)) {
        if (canon === suit) add(`Prince of ${synSuit}`, idx);
      }
    }
  }
}

/* ------------------------- Resolver ------------------------- */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function tryParseRoman(s: string): number | null {
  const m = s.toUpperCase().match(/\b([IVX]+)\b/);
  if (!m) return null;
  const n = ROMAN_TO_NUM[m[1]];
  return n != null && n <= 21 ? n : null;
}

function tryParseLeadingNumber(s: string): number | null {
  const m = s.match(/^\s*(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 21 ? n : null;
}

function tryRankSuitParse(s: string): number | null {
  // Match patterns like "{rank} of {suit}" or "{rank} {suit}" or "{rank}-{suit}"
  const tokens = s.split(/\s+/).filter((t) => t !== "of");
  if (tokens.length < 2) return null;
  // Try: first token = rank, last token = suit
  const rankTok = tokens[0];
  const suitTok = tokens[tokens.length - 1];
  const rank = RANK_CANONICAL[rankTok];
  const suit = SUIT_CANONICAL[suitTok];
  if (rank && suit) return minorIndex(rank, suit);
  // Try reversed order: "{suit} {rank}"
  const rank2 = RANK_CANONICAL[suitTok];
  const suit2 = SUIT_CANONICAL[rankTok];
  if (rank2 && suit2) return minorIndex(rank2, suit2);
  return null;
}

/** Resolve a raw user-supplied card name to a deck index. */
export function resolveCardName(raw: string): CardResolveResult {
  const stripped = stripReversal(String(raw ?? ""));
  const norm = normalize(stripped);
  if (!norm) return { kind: "unmatched", rawName: raw };

  // 1. Direct dictionary hit
  const direct = DICT.get(norm);
  if (direct != null) {
    return {
      kind: "matched",
      cardIndex: direct,
      confidence: 1.0,
      canonical: getCardName(direct),
    };
  }

  // 2. Rank+suit token parse (handles synonyms like "Knight of Coins")
  const rs = tryRankSuitParse(norm);
  if (rs != null) {
    return {
      kind: "matched",
      cardIndex: rs,
      confidence: 0.98,
      canonical: getCardName(rs),
    };
  }

  // 3. Major arcana via Roman or Arabic numeral
  const roman = tryParseRoman(norm);
  if (roman != null) {
    return {
      kind: "matched",
      cardIndex: roman,
      confidence: 0.95,
      canonical: getCardName(roman),
    };
  }
  const arabic = tryParseLeadingNumber(norm);
  if (arabic != null) {
    return {
      kind: "matched",
      cardIndex: arabic,
      confidence: 0.9,
      canonical: getCardName(arabic),
    };
  }

  // 4. Levenshtein fuzzy match against canonical names
  let best: { idx: number; dist: number } | null = null;
  for (let i = 0; i < TAROT_DECK.length; i++) {
    const candidate = normalize(TAROT_DECK[i]);
    const d = levenshtein(norm, candidate);
    if (best == null || d < best.dist) best = { idx: i, dist: d };
    if (d === 0) break;
  }
  if (best && best.dist <= 2) {
    const conf = best.dist === 1 ? 0.8 : 0.65;
    return {
      kind: "probable",
      cardIndex: best.idx,
      confidence: conf,
      canonical: getCardName(best.idx),
    };
  }

  return { kind: "unmatched", rawName: raw };
}

export function getCanonicalName(cardIndex: number): string {
  return getCardName(cardIndex);
}

export function getAllCardOptions(): { index: number; name: string }[] {
  return TAROT_DECK.map((name, index) => ({ index, name }));
}