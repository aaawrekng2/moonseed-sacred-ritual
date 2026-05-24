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
 *  specifically — the user runs it once per deck. */
export function buildHydratingMetaPrompt(deckName: string): string {
  const name = deckName?.trim() || "[my deck]";
  return `I'm setting up custom journaling prompts for a tarot/oracle deck called "${name}" in an app. Interview me one question at a time, waiting for my answer before moving on. Every question is about THIS deck specifically, not my journaling practice in general.

1. Does THIS deck have a particular feel or job? For example: shadow work, family and fun, career, creative practice, spiritual reflection, healing, decision-making, daily check-in. Tell me what you reach for it for.

2. What tone fits your journaling voice when working with THIS deck? (gentle, blunt, poetic, casual, ceremonial, clinical, irreverent)

3. What recurring themes do you want THIS deck to surface for you right now?

4. When you pull from THIS deck, what kinds of prompts would bounce right off you? What feels wrong for this deck specifically?

When I'm done, write me a short "voice guide" for an AI that will generate journaling prompts for this deck. Tell that AI:
- The deck's feel, job, and tone
- Vocabulary and register that fit this deck
- Recurring themes to weave in when relevant
- What to avoid for this deck

Just the voice guide. Plain text, no preamble.`;
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
