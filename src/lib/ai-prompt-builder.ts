/**
 * v3.50 — AI-reading prompt builder.
 *
 * Assembles a self-contained prompt the seeker copies into their own AI
 * program (ChatGPT / Claude / etc.). Pure + synchronous: the caller
 * (AiReadingSheet) gathers the async pieces — birth data, Sun/Moon/Rising —
 * and hands them in already resolved. Correspondences and numerology are
 * pre-computed here from Tarot Seed's canonical tables so the pasted prompt
 * gives a strong reading in any chatbot without relying on its guesswork.
 *
 * Privacy: this builder never emits the seeker's name, email, precise
 * coordinates, or account identifiers. Birth PLACE is city-name only, and
 * only when the birthData toggle is on — matching the app's AI data guard.
 */
import { getCardName } from "./tarot";
import { getCardMeaning } from "./tarot-meanings";
import { getCardMeta, majorIdForSign } from "./card-astrology";
import {
  lifePath,
  personalYear,
  numberToMajorArcana,
  type Numerogram,
} from "./numerology";

export type PromptCardInput = {
  cardId: number;
  reversed: boolean;
  position: string;
  /** Resolved display name (respects the seeker's active custom deck). */
  name: string;
};

export type BigThree = {
  sun: string | null;
  moon: string | null;
  moonConfident?: boolean;
  rising: string | null;
  risingConfident?: boolean;
};

export type RecentReadingInput = {
  date: string; // display string
  spread: string;
  cards: string; // comma-joined names
  question: string | null;
};

export type PromptToggles = {
  // Astrology
  sun: boolean;
  moon: boolean;
  rising: boolean;
  correspondences: boolean;
  elementLean: boolean;
  // Numerology
  lifePath: boolean;
  personalYear: boolean;
  // Context
  notes: boolean;
  birthData: boolean;
  recentReadings: boolean;
  patterns: boolean;
  // Delivery
  tone: "gentle" | "direct";
  length: "short" | "medium" | "long";
  journalingPrompts: boolean;
};

export const DEFAULT_TOGGLES: PromptToggles = {
  sun: false,
  moon: false,
  rising: false,
  correspondences: false,
  elementLean: false,
  lifePath: false,
  personalYear: false,
  notes: false,
  birthData: false,
  recentReadings: false,
  patterns: false,
  tone: "gentle",
  length: "medium",
  journalingPrompts: true,
};

export type PromptContext = {
  spreadLabel: string;
  cards: PromptCardInput[];
  question: string | null;
  note: string | null;
  bigThree: BigThree | null;
  birthDate: string | null; // YYYY-MM-DD
  birthCity: string | null; // city name only
  recentReadings: RecentReadingInput[];
  patternsSummary: string | null;
  /** Defaults to the current year for the Personal Year calc. */
  year?: number;
};

function fmtNumerogram(n: Numerogram): string {
  return n.master ? `${n.digit} (master number)` : String(n.digit);
}

/** Build the copy-to-clipboard prompt text from context + toggle state. */
export function buildAiReadingPrompt(
  ctx: PromptContext,
  t: PromptToggles,
): string {
  const year = ctx.year ?? new Date().getFullYear();
  const sections: string[] = [];

  // ---- Role + tone -------------------------------------------------------
  const toneLine =
    t.tone === "direct"
      ? "Read in a clear, direct, grounded voice — warm but plain-spoken, no purple prose."
      : "Read in a gentle, encouraging voice — reflective and kind, never fatalistic.";
  const lengthLine =
    t.length === "short"
      ? "Keep it concise: a few tight paragraphs."
      : t.length === "long"
        ? "Give a thorough, in-depth reading."
        : "Give a balanced reading of moderate length.";
  sections.push(
    [
      "You are an insightful tarot reader working from the Rider-Waite-Smith tradition.",
      toneLine,
      lengthLine,
      "Treat any card meanings and correspondences I provide as the source of truth and weave them together — interpret the spread as a whole, not card-by-card in isolation. This is for reflection, not a prediction or professional advice.",
    ].join(" "),
  );

  // ---- The question ------------------------------------------------------
  if (ctx.question && ctx.question.trim()) {
    sections.push(`My question:\n"${ctx.question.trim()}"`);
  } else {
    sections.push("I drew this spread as an open reflection (no set question).");
  }

  // ---- The cards ---------------------------------------------------------
  const cardLines = ctx.cards.map((c) => {
    const orient = c.reversed ? "reversed" : "upright";
    const parts: string[] = [`- ${c.position}: ${c.name} (${orient})`];
    const canon = getCardMeaning(c.cardId);
    if (canon) {
      const kw = c.reversed ? canon.reversedKeywords : canon.uprightKeywords;
      const mean = c.reversed ? canon.reversedMeaning : canon.uprightMeaning;
      if (kw && kw.length) parts.push(`    Keywords: ${kw.join(", ")}`);
      if (mean) parts.push(`    Meaning: ${mean}`);
    }
    return parts.join("\n");
  });
  sections.push(
    `Spread: ${ctx.spreadLabel}\nCards drawn (in order):\n${cardLines.join("\n")}`,
  );

  // ---- Astrology: big three ---------------------------------------------
  const astroLines: string[] = [];
  if (ctx.bigThree) {
    if (t.sun && ctx.bigThree.sun) {
      astroLines.push(`Sun in ${ctx.bigThree.sun} (core self)`);
    }
    if (t.moon && ctx.bigThree.moon) {
      const c = ctx.bigThree.moonConfident === false ? " (approximate)" : "";
      astroLines.push(`Moon in ${ctx.bigThree.moon}${c} (inner/emotional self)`);
    }
    if (t.rising && ctx.bigThree.rising) {
      const c = ctx.bigThree.risingConfident === false ? " (approximate)" : "";
      astroLines.push(`${ctx.bigThree.rising} rising${c} (outward self)`);
    }
  }
  if (astroLines.length) {
    sections.push(`My astrology:\n${astroLines.map((l) => `- ${l}`).join("\n")}`);
  }

  // ---- Astrology: sign→card correspondences -----------------------------
  if (t.correspondences && ctx.bigThree) {
    const corr: string[] = [];
    const add = (label: string, sign: string | null) => {
      if (!sign) return;
      const id = majorIdForSign(sign);
      if (id != null) corr.push(`- ${label} (${sign}) → ${getCardName(id)}`);
    };
    if (t.sun) add("Sun", ctx.bigThree.sun);
    if (t.moon) add("Moon", ctx.bigThree.moon);
    if (t.rising) add("Rising", ctx.bigThree.rising);
    if (corr.length) {
      sections.push(
        `Tarot cards that correspond to my signs (Golden Dawn attributions) — note if any echo the cards above:\n${corr.join("\n")}`,
      );
    }
  }

  // ---- Astrology: element / suit lean -----------------------------------
  if (t.elementLean && ctx.cards.length) {
    const counts: Record<string, number> = {};
    for (const c of ctx.cards) {
      const el = getCardMeta(c.cardId)?.element;
      if (el) counts[el] = (counts[el] ?? 0) + 1;
    }
    const parts = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([el, n]) => `${el} ×${n}`);
    if (parts.length) {
      sections.push(
        `Elemental lean of this spread (Fire=Wands, Water=Cups, Air=Swords, Earth=Pentacles): ${parts.join(", ")}. Note where this reinforces or challenges my nature.`,
      );
    }
  }

  // ---- Numerology --------------------------------------------------------
  const numLines: string[] = [];
  if (ctx.birthDate) {
    if (t.lifePath) {
      const lp = lifePath(ctx.birthDate);
      const cardId = numberToMajorArcana(lp.digit);
      const card = cardId != null ? ` → ${getCardName(cardId)}` : "";
      numLines.push(`Life Path ${fmtNumerogram(lp)}${card}`);
    }
    if (t.personalYear) {
      const py = personalYear(ctx.birthDate, year);
      const cardId = numberToMajorArcana(py.digit);
      const card = cardId != null ? ` → ${getCardName(cardId)}` : "";
      numLines.push(`Personal Year (${year}) ${fmtNumerogram(py)}${card}`);
    }
  }
  if (numLines.length) {
    sections.push(
      `My numerology:\n${numLines.map((l) => `- ${l}`).join("\n")}`,
    );
  }

  // ---- Context: birth data (city only) ----------------------------------
  if (t.birthData) {
    const bits: string[] = [];
    if (ctx.birthDate) bits.push(`born ${ctx.birthDate}`);
    if (ctx.birthCity) bits.push(`in ${ctx.birthCity}`);
    if (bits.length) sections.push(`About me: ${bits.join(", ")}.`);
  }

  // ---- Context: my notes -------------------------------------------------
  if (t.notes && ctx.note && ctx.note.trim()) {
    sections.push(`My notes on this spread:\n${ctx.note.trim()}`);
  }

  // ---- Context: recent readings -----------------------------------------
  if (t.recentReadings && ctx.recentReadings.length) {
    const lines = ctx.recentReadings.map((r) => {
      const q = r.question ? ` — asked: "${r.question}"` : "";
      return `- ${r.date} (${r.spread}): ${r.cards}${q}`;
    });
    sections.push(
      `My recent readings, for continuity — note any echoes:\n${lines.join("\n")}`,
    );
  }

  // ---- Context: detected patterns ---------------------------------------
  if (t.patterns && ctx.patternsSummary && ctx.patternsSummary.trim()) {
    sections.push(
      `Patterns detected in my practice:\n${ctx.patternsSummary.trim()}`,
    );
  }

  // ---- Closing instruction ----------------------------------------------
  const closing: string[] = [
    "Now interpret the spread as a whole in light of everything above.",
  ];
  if (t.journalingPrompts) {
    closing.push("End with 2–3 journaling prompts and one grounded next step.");
  }
  sections.push(closing.join(" "));

  return sections.join("\n\n");
}
