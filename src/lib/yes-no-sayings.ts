/**
 * Q92 #7 — Tarot-voice sayings shown beneath a Yes/No card after it
 * flips. The card's `yesNo` tendency (yes / maybe / no) from
 * `tarot-meanings.ts` decides which list to draw from. `maybe` is
 * treated as affirmative — the cards rarely refuse outright.
 *
 * The next index is stored in localStorage so the seeker doesn't get
 * the same saying twice in a row.
 */
import { TAROT_MEANINGS } from "@/lib/tarot-meanings";

export const AFFIRMATIVE_SAYINGS: string[] = [
  "The cards speak clearly — yes.",
  "The path ahead is open to you.",
  "The universe nods in your favor.",
  "What you seek is already seeking you.",
  "The answer arrives with the dawn.",
  "Trust this. The signs are aligned.",
  "A door opens where you least expected.",
  "The stars confirm what your heart already knows.",
  "Yes — and sooner than you think.",
  "The current flows in your direction.",
  "This is your green light.",
  "The pieces are falling into place.",
  "Affirmative. Move forward with confidence.",
  "The moon rises on your intention.",
  "You already know the answer. Trust it.",
  "The wheel turns in your favor.",
  "This reading carries a resounding yes.",
  "The veil lifts to reveal good fortune.",
  "All signs point forward.",
  "The cosmos whispers: proceed.",
];

export const NEGATIVE_SAYINGS: string[] = [
  "The cards urge patience — not now.",
  "The path is blocked for a reason.",
  "Not this time. The stars suggest waiting.",
  "The answer is no — but not forever.",
  "The moon hides its face. This is not the moment.",
  "Something unseen holds this back.",
  "The current pulls away. Let it.",
  "The cards see a different path for you.",
  "Not yet. Timing is everything.",
  "The wheel pauses here. Honor the stillness.",
  "This door remains closed for now.",
  "The shadows suggest caution.",
  "Let this one pass. Something better is forming.",
  "The veil stays drawn. Wait for clarity.",
  "No — and there is wisdom in the refusal.",
  "The cosmos says: not this way.",
  "Release this question. The answer will come unbidden.",
  "The night sky is silent on this matter.",
  "Step back. The ground is not yet firm.",
  "What you seek cannot be found on this road.",
];

const AFFIRM_KEY = "tarotseed:yesno-affirm-idx";
const NEG_KEY = "tarotseed:yesno-neg-idx";

function readIdx(key: string, len: number): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw == null ? 0 : Number(raw);
    if (!Number.isFinite(n)) return 0;
    return ((Math.floor(n) % len) + len) % len;
  } catch {
    return 0;
  }
}

function writeIdx(key: string, next: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(next));
  } catch {
    // ignore
  }
}

/**
 * Returns the next saying for a given card and advances the appropriate
 * counter. `maybe` is bucketed with `yes` per spec voice.
 *
 * Q95 — reversal logic: a reversed card flips the verdict.
 *   - tendency "yes"   reversed → NEGATIVE
 *   - tendency "no"    reversed → AFFIRMATIVE
 *   - tendency "maybe" reversed → NEGATIVE (neutral shifts toward no)
 */
export function nextYesNoSaying(cardId: number, isReversed = false): string {
  const tendency = TAROT_MEANINGS[cardId]?.yesNo ?? "maybe";
  // Resolve the effective verdict after reversal.
  let verdict: "yes" | "no";
  if (tendency === "yes") verdict = isReversed ? "no" : "yes";
  else if (tendency === "no") verdict = isReversed ? "yes" : "no";
  else verdict = isReversed ? "no" : "yes"; // maybe → yes upright, no reversed
  if (verdict === "no") {
    const idx = readIdx(NEG_KEY, NEGATIVE_SAYINGS.length);
    const saying = NEGATIVE_SAYINGS[idx];
    writeIdx(NEG_KEY, (idx + 1) % NEGATIVE_SAYINGS.length);
    return saying;
  }
  const idx = readIdx(AFFIRM_KEY, AFFIRMATIVE_SAYINGS.length);
  const saying = AFFIRMATIVE_SAYINGS[idx];
  writeIdx(AFFIRM_KEY, (idx + 1) % AFFIRMATIVE_SAYINGS.length);
  return saying;
}