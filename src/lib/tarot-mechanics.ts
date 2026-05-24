/**
 * Tarot draw mechanics constants — Phase 9.55.
 *
 * Single source of truth for tunable mechanics like reversal probability.
 * Tweak here, never inline in draw logic.
 */

/**
 * Default reversal probability when the seeker hasn't set their own
 * value (or for any caller that doesn't have access to user prefs).
 *
 * EJ47 — bumped to 50 (was 28). The new
 * `user_preferences.reversal_chance_pct` field overrides this per
 * seeker. Realistic shuffling produces about 15-30% reversals; we
 * default to the symmetric 50/50 mathematically and let the seeker
 * tune to taste in Settings → Preferences.
 */
export const REVERSED_CARD_PROBABILITY = 0.5;

/**
 * Normalize a user-supplied chance value into a probability in [0, 1].
 * Accepts:
 *   • A whole percent (1..99) — e.g. 28 → 0.28
 *   • A 0..1 probability already — e.g. 0.28 → 0.28
 *   • null/undefined/non-finite — falls back to REVERSED_CARD_PROBABILITY
 *
 * EJ47 — caller flexibility helper. All draw sites should ultimately
 * pass the seeker's `reversal_chance_pct` (1..99 integer), but we
 * accept either shape to make the function easy to call defensively.
 */
function normalizeChance(chance: number | null | undefined): number {
  if (chance === null || chance === undefined) return REVERSED_CARD_PROBABILITY;
  if (!Number.isFinite(chance)) return REVERSED_CARD_PROBABILITY;
  // EJ49 bugfix — was `chance > 1` which excluded the value 1
  // itself, treating "1%" as a probability of 1.0 (always reversed).
  // Now `chance >= 1` so any integer 1..99 from the user's
  // `reversal_chance_pct` setting is correctly interpreted as a
  // percent and divided by 100.
  if (chance >= 1) return Math.max(0.01, Math.min(0.99, chance / 100));
  // 0..1 (exclusive of 1) — treat as already-a-probability, but
  // clamp to sensible bounds so we never silently roll 100% or 0%.
  return Math.max(0.01, Math.min(0.99, chance));
}

/**
 * Single probability roll. The caller is responsible for checking the
 * seeker's `allow_reversed_cards` preference first — this only handles
 * the dice.
 *
 * EJ47 — accepts an optional `chance`. May be a 1..99 percent or a
 * 0..1 probability. Omit/pass null to use the default.
 */
export function rollReversed(chance?: number | null): boolean {
  return Math.random() < normalizeChance(chance);
}

/**
 * Build a parallel `boolean[]` of orientations for a draw of `count`
 * cards. Returns all-false when reversals are disabled, so callers can
 * unconditionally write `card_orientations` to Supabase.
 *
 * EJ47 — accepts an optional `chance` (percent 1..99 or probability
 * 0..1). When omitted, uses REVERSED_CARD_PROBABILITY.
 */
export function generateOrientations(
  count: number,
  allowReversed: boolean,
  chance?: number | null,
): boolean[] {
  if (!allowReversed) return new Array(count).fill(false);
  const p = normalizeChance(chance);
  return Array.from({ length: count }, () => Math.random() < p);
}

/**
 * Defensive read: returns whether the card at `index` was drawn
 * reversed, treating a missing or short `card_orientations` array as
 * upright. Use everywhere orientation is read from a saved reading.
 */
export function isCardReversed(orientations: boolean[] | null | undefined, index: number): boolean {
  return orientations?.[index] ?? false;
}
