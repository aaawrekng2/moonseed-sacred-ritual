/**
 * EG-4 — Map a streak day count to the streak indicator's visual
 * state: which lunar fill (0–1) and which elemental color.
 *
 * Cycle: 4 phases x 12 days each = 48 days. After day 48, the
 * moon stays full + Fire color until the streak breaks.
 *
 * Phases:
 *   Days 1–12  → Earth (muted forest green)
 *   Days 13–24 → Water (cool deep blue)
 *   Days 25–36 → Air   (pale silver-grey)
 *   Days 37–48 → Fire  (deep orange-red)
 *   Days 49+   → Fire stays full
 */

export type StreakElement = "none" | "earth" | "water" | "air" | "fire";

export const STREAK_ELEMENT_COLORS: Record<StreakElement, string> = {
  none: "oklch(0.55 0.02 280)",
  earth: "oklch(0.55 0.10 145)",
  water: "oklch(0.45 0.13 240)",
  air: "oklch(0.78 0.02 250)",
  fire: "oklch(0.62 0.20 35)",
};

export function streakPhaseState(streakDays: number): {
  fillRatio: number;
  element: StreakElement;
  isFull: boolean;
} {
  if (streakDays <= 0) {
    return { fillRatio: 0, element: "none", isFull: false };
  }
  if (streakDays >= 48) {
    return { fillRatio: 1, element: "fire", isFull: true };
  }
  const phaseIndex = Math.floor((streakDays - 1) / 12); // 0–3
  const dayInPhase = ((streakDays - 1) % 12) + 1; // 1–12
  const elements: StreakElement[] = ["earth", "water", "air", "fire"];
  const element = elements[phaseIndex];
  const fillRatio = dayInPhase / 12;
  const isFull = dayInPhase === 12;
  return { fillRatio, element, isFull };
}