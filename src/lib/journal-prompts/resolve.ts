/**
 * 26-05-08-Q12 — Journal-prompt resolver.
 * Standard tarot ids (0..77) come from the static dataset. Oracle/custom
 * cards (id >= 1000) read from `custom_deck_cards.journal_prompts`.
 */
import { STANDARD_TAROT_PROMPTS } from "./standard-tarot-prompts";

export function resolvePromptsForFirstCard(
  cardId: number | undefined,
  customDeckCardPrompts?: string[] | null,
): string[] | null {
  if (cardId == null) return null;
  if (cardId >= 1000) {
    return customDeckCardPrompts && customDeckCardPrompts.length > 0
      ? customDeckCardPrompts
      : null;
  }
  return STANDARD_TAROT_PROMPTS[cardId] ?? null;
}