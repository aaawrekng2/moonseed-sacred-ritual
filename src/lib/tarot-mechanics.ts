/**
 * Tarot draw mechanics constants — Phase 9.55.
 *
 * Single source of truth for tunable mechanics like reversal probability.
 * Tweak here, never inline in draw logic.
 */

/**
 * Percentage chance a card is drawn reversed when the seeker has
 * `allow_reversed_cards` enabled. Real-world tarot shuffling produces
 * roughly 15–30% reversals depending on technique; 0.28 sits in that
 * range and gives meaningful but not overwhelming reversal frequency
 * (~1 in 3–4 cards lands reversed).
 */
export const REVERSED_CARD_PROBABILITY = 0.28;

/**
 * Single probability roll. The caller is responsible for checking the
 * seeker's `allow_reversed_cards` preference first — this only handles
 * the dice.
 */
export function rollReversed(): boolean {
  return Math.random() < REVERSED_CARD_PROBABILITY;
}

/**
 * Build a parallel `boolean[]` of orientations for a draw of `count`
 * cards. Returns all-false when reversals are disabled, so callers can
 * unconditionally write `card_orientations` to Supabase.
 */
export function generateOrientations(
  count: number,
  allowReversed: boolean,
): boolean[] {
  if (!allowReversed) return new Array(count).fill(false);
  return Array.from({ length: count }, () => rollReversed());
}

/**
 * Defensive read: returns whether the card at `index` was drawn
 * reversed, treating a missing or short `card_orientations` array as
 * upright. Use everywhere orientation is read from a saved reading.
 */
export function isCardReversed(
  orientations: boolean[] | null | undefined,
  index: number,
): boolean {
  return orientations?.[index] ?? false;
}