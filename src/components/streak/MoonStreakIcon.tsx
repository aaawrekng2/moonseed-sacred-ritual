/**
 * EG-4 — Streak indicator moon glyph.
 *
 * Driven entirely by streakDays (NOT today's actual moon phase).
 * Waxes from new moon (empty) to full over 12-day phases. On the
 * full day of each phase the moon body takes the elemental color;
 * mid-phase days render in pale silver so the user sees waxing
 * progress without color contamination before the phase "arrives".
 */
import {
  STREAK_ELEMENT_COLORS,
  streakPhaseState,
} from "@/lib/streak-phase";

type Props = {
  streakDays: number;
  size?: number;
  className?: string;
};

export function MoonStreakIcon({ streakDays, size = 20, className }: Props) {
  const { fillRatio, element, isFull } = streakPhaseState(streakDays);
  const fillColor = isFull
    ? STREAK_ELEMENT_COLORS[element]
    : "oklch(0.85 0.02 250)";
  const r = 28;
  const cx = 32;
  const cy = 32;
  // ER-5 — Offset a "background" circle to the right to mask the
  // unilluminated right portion of the moon body. As fillRatio grows,
  // the mask slides further right, REVEALING more of the lit moon
  // (waxing from the left). The previous (1 - fillRatio) inverted this.
  const offset = fillRatio * (r * 2);
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(212,175,55,0.25)"
        strokeWidth={1}
      />
      <circle cx={cx} cy={cy} r={r} fill={fillColor} />
      {fillRatio < 1 && (
        <circle
          cx={cx + offset}
          cy={cy}
          r={r}
          fill="var(--background, #06051a)"
        />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(212,175,55,0.35)"
        strokeWidth={1.5}
      />
    </svg>
  );
}