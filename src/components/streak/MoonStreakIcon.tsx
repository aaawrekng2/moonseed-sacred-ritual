/**
 * EG-4 / ES-2 — Streak indicator moon glyph.
 *
 * Driven entirely by streakDays (NOT today's actual moon phase).
 * Waxes from new moon (empty) to full over 12-day phases. On the
 * full day of each phase the moon body takes the elemental color via
 * the MoonPhaseIcon ring; mid-phase days render with the icon's
 * default pearl body so the user sees waxing progress without color
 * contamination before the phase "arrives".
 *
 * ES-2 — switched away from the chord-edge two-circle subtraction
 * (hard linear cut) to MoonPhaseIcon, which already renders proper
 * waxing geometry with a curved terminator. Streak fillRatio is
 * mapped to a waxing phase + illumination so a 10-day streak shows a
 * Waxing Gibbous at ~83% lit (matching the today-cell carousel moon).
 */
import {
  STREAK_ELEMENT_COLORS,
  streakPhaseState,
} from "@/lib/streak-phase";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import type { MoonPhaseName } from "@/lib/moon";

type Props = {
  streakDays: number;
  size?: number;
  className?: string;
};

function fillRatioToPhase(r: number): MoonPhaseName {
  if (r <= 0) return "New Moon";
  if (r < 0.45) return "Waxing Crescent";
  if (r < 0.55) return "First Quarter";
  if (r < 1) return "Waxing Gibbous";
  return "Full Moon";
}

export function MoonStreakIcon({ streakDays, size = 20, className }: Props) {
  const { fillRatio, element, isFull } = streakPhaseState(streakDays);
  const phase = fillRatioToPhase(fillRatio);
  const illumination = Math.round(fillRatio * 100);
  // On full days, paint the elemental color as the ring around the
  // moon body. Other days keep the icon's subtle gold halo only.
  const ring = isFull ? STREAK_ELEMENT_COLORS[element] : null;
  return (
    <MoonPhaseIcon
      phase={phase}
      size={size}
      illumination={illumination}
      ringColor={ring}
      ringWidth={1.5}
      className={className}
    />
  );
}