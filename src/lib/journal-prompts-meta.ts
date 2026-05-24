/**
 * EJ34 — Journal-prompt meta payloads.
 *
 * Pure builders for two clipboard payloads the deck-edit page hands
 * the user:
 *
 *   1. `buildHydratingMetaPrompt(deckName)` — the interview prompt the
 *      user pastes into ChatGPT / Claude / Gemini. The external AI
 *      asks them 4 questions about THIS deck, then returns a voice
 *      guide they paste back into the edit page.
 *
 *   2. `buildCsvInstructionsPrompt(...)` — the prompt that accompanies
 *      the CSV download. Pre-populated with the user's actual aspects
 *      and voice guide so the AI has everything it needs to fill in
 *      4 prompts per row.
 *
 * Both are pure functions — no AI calls, no network. Live in `lib/`
 * (not `lib/.../server`) so the deck-edit page can call them client-
 * side from a button.
 */
import type { AspectConfig } from "@/lib/custom-decks";

/** Builds the interview meta-prompt for the "Get my hydrating
 *  prompt" clipboard button. Every question is scoped to THIS deck
 *  specifically — the user runs it once per deck.
 *
 *  EJ39 — adds examples to every question (Q3 and Q4 previously
 *  had no anchor examples and felt like blank-page exercises) and
 *  asks the external AI to output a structured response the deck-
 *  edit page can parse with one click: 4 ASPECT/THOUGHT pairs and a
 *  VOICE GUIDE block. Format matches the parser in
 *  settings.decks.$deckId.edit.tsx exactly. */
export function buildHydratingMetaPrompt(deckName: string): string {
  const name = deckName?.trim() || "[my deck]";
  return `I'm setting up custom journaling prompts for a tarot/oracle deck called "${name}" in an app. Interview me one question at a time, waiting for my answer before moving on. Every question is about THIS deck specifically, not my journaling practice in general. For every question, give me a few starter examples to react to so I'm not staring at a blank page.

1. Does THIS deck have a particular feel or job? For example: shadow work, family and fun, career and ambition, creative practice, spiritual reflection, healing, decision-making, daily check-in, grief work, somatic awareness. Tell me what you reach for it for.

2. What tone fits your journaling voice when working with THIS deck? (gentle, blunt, poetic, casual, ceremonial, clinical, irreverent, warm, sharp, playful, hushed)

3. What recurring themes do you want THIS deck to surface for you right now? For example: career transitions, parenting a teenager, grief, creative reawakening, recovery, identity shifts, relationship patterns, body or health awareness, financial decisions, spiritual longing, boundary-setting, midlife reckoning.

4. When you pull from THIS deck, what kinds of prompts would bounce right off you or feel wrong for this deck specifically? For example: too prescriptive, too vague, saccharine spiritual-bypass language, hardcore shadow when you wanted gentle, prompts that demand action when you need to sit, generic "how do you feel" openers, anything performative, anything that names trauma you didn't bring up, anything that ignores the deck's specific feel.

When I'm done answering, produce your output in EXACTLY this format — plain text, no markdown, no preamble, no commentary outside the labeled lines:

ASPECT 1: <a short name for the first journaling angle, 1-3 words>
THOUGHT 1: <one sentence describing what prompts in this aspect should do for this deck>
ASPECT 2: <name>
THOUGHT 2: <one sentence>
ASPECT 3: <name>
THOUGHT 3: <one sentence>
ASPECT 4: <name>
THOUGHT 4: <one sentence>

VOICE GUIDE:
<a short paragraph for the prompt-generating AI describing the deck's feel, job, tone, vocabulary, recurring themes, and what to avoid>

The 4 aspects should fit THIS deck specifically. A shadow-work deck might have aspects like Shadow / Trigger / Pattern / Re-parent. A family-and-fun deck might have aspects like Joy / Memory / Connection / Play. Pick what fits the answers I give you.`;
}

/** Builds the prompt the user copies alongside the CSV download.
 *  Pre-populates the user's actual 4 aspects (with hydrating thoughts)
 *  and voice guide so the AI receiving the CSV has full context. */
export function buildCsvInstructionsPrompt(params: {
  deckName: string;
  cardCount: number;
  aspects: AspectConfig[];
  voiceGuide?: string | null;
}): string {
  const { deckName, cardCount, aspects, voiceGuide } = params;
  const name = deckName?.trim() || "[my deck]";
  const aspectsBlock = aspects
    .slice(0, 4)
    .map((a, i) => {
      const aspectName = (a?.name ?? "").trim() || `Aspect ${i + 1}`;
      const thought = (a?.hydrating_thought ?? "").trim();
      return `Aspect ${i + 1}: ${aspectName}\n  ${thought || "(no hydrating thought set)"}`;
    })
    .join("\n\n");
  const voiceBlock = (voiceGuide ?? "").trim() ? `\n\nVoice guide:\n${voiceGuide!.trim()}` : "";
  return `Attached is a CSV with ${cardCount} cards from my "${name}" oracle/tarot deck. Each row has the card's name and description.

I need you to write 4 journaling prompts for every card. The 4 columns are 4 different "aspects" — each one a distinct angle the prompt should take. The column headers tell you what each aspect is.

${aspectsBlock}${voiceBlock}

For every card, write one prompt per aspect column. Keep each prompt to 1-2 sentences. Address the reader in the second person. Don't explain — just write the prompt. Return the CSV with all four prompt columns filled in.`;
}

/** EJ39 — Parses the external-AI response from the hydrating-prompt
 *  interview into 4 aspects + an optional voice guide. The format
 *  matches what buildHydratingMetaPrompt asks the AI to produce:
 *
 *    ASPECT 1: name
 *    THOUGHT 1: hydrating thought
 *    ASPECT 2: ...
 *    ...
 *    VOICE GUIDE:
 *    paragraph...
 *
 *  Tolerant of: extra whitespace, missing colons (matches "ASPECT 1
 *  name"), case differences, optional emdash / hyphen / bullet
 *  prefixes (some AIs prepend "- " or "* "), and an arbitrary
 *  preamble before the first ASPECT line. Returns null on any aspect
 *  parse failure so the caller can show a clean error and let the
 *  user paste again. Voice guide is optional — returned as null if
 *  the VOICE GUIDE label is missing. */
export function parseHydratingResponse(text: string): {
  aspects: AspectConfig[];
  voiceGuide: string | null;
} | null {
  if (!text?.trim()) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const aspects: AspectConfig[] = [
    { name: "", hydrating_thought: "" },
    { name: "", hydrating_thought: "" },
    { name: "", hydrating_thought: "" },
    { name: "", hydrating_thought: "" },
  ];
  let voiceGuideStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip common list-prefix decorations before pattern matching.
    const cleaned = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!cleaned) continue;
    if (/^voice\s*guide\b/i.test(cleaned)) {
      voiceGuideStart = i + 1;
      break;
    }
    // Match "ASPECT N: text" or "ASPECT N - text" or "ASPECT N text".
    const aspectMatch = cleaned.match(/^aspect\s*(\d)\s*[:\-—–]?\s*(.*)$/i);
    if (aspectMatch) {
      const slot = parseInt(aspectMatch[1], 10) - 1;
      if (slot >= 0 && slot <= 3) {
        aspects[slot].name = aspectMatch[2].trim();
      }
      continue;
    }
    const thoughtMatch = cleaned.match(/^thought\s*(\d)\s*[:\-—–]?\s*(.*)$/i);
    if (thoughtMatch) {
      const slot = parseInt(thoughtMatch[1], 10) - 1;
      if (slot >= 0 && slot <= 3) {
        aspects[slot].hydrating_thought = thoughtMatch[2].trim();
      }
      continue;
    }
  }
  // Voice guide content: everything after the VOICE GUIDE label,
  // joined as a paragraph. Skip blank leading lines.
  let voiceGuide: string | null = null;
  if (voiceGuideStart >= 0) {
    const rest = lines.slice(voiceGuideStart).join("\n").replace(/^\s+/, "").trim();
    voiceGuide = rest.length > 0 ? rest : null;
  }
  // A successful parse needs at least one aspect with a non-empty name;
  // otherwise the format was off and we can't reliably fill the fields.
  const haveAny = aspects.some((a) => a.name.trim().length > 0);
  if (!haveAny) return null;
  return { aspects, voiceGuide };
}
