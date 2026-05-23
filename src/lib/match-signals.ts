/**
 * EJ30 — shared visual-signal computation for calendar day cells AND
 * readings modal rows. Single source of truth. When the calendar
 * indicators evolve, both surfaces stay in sync.
 *
 * Input is a "matchable" — either a day (calendar) or a reading row
 * (modal). The caller assembles:
 *   - heroDrawn:  was the hero card in this match? (day = hero drawn
 *                 that day; row = hero card present in this reading)
 *   - matchCount: how many of the seeker's current slot-row cards
 *                 are present in this match
 *   - pullSize:   total cards in the seeker's current slot row
 *   - maxMatchCount: max matchCount across the entire universe being
 *                    rendered (used for "best available" dashed ring)
 *   - asterismHit: are all teal-selected cards present in this match?
 *   - asterismSize: how many cards in the teal selection (must be 2+
 *                   for asterism logic to activate)
 *
 * Output is the visual signal bundle:
 *   - bg:           CSS background color
 *   - opacity:      0..1, applied to bg
 *   - textColor:    primary text color
 *   - border:       CSS border shorthand (perfect-match solid, or
 *                   "best available" dashed, or subtle baseline)
 *   - outline:      CSS outline shorthand (teal asterism ring or none)
 *   - outlineOffset: px offset for the outline
 */
export type MatchSignalsInput = {
  heroDrawn: boolean;
  matchCount: number;
  pullSize: number;
  maxMatchCount: number;
  asterismHit: boolean;
  asterismSize: number;
};

export type MatchSignals = {
  bg: string;
  opacity: number;
  textColor: string;
  border: string;
  outline: string;
  outlineOffset: number;
  isPerfectMatch: boolean;
  isBestAvailable: boolean;
};

const TRACE_VAR = "var(--trace-color, #5cead4)";

/** Calendar accent opacity formula. 0.15 baseline + scaled match %,
 *  caps at 0.95. */
export function matchOpacity(matchCount: number, pullSize: number): number {
  if (matchCount <= 0 || pullSize <= 0) return 0;
  const pct = matchCount / pullSize;
  return 0.15 + pct * 0.8;
}

export function computeMatchSignals(input: MatchSignalsInput): MatchSignals {
  const { heroDrawn, matchCount, pullSize, maxMatchCount, asterismHit, asterismSize } = input;

  // BG + opacity priority: hero gold > accent match > neutral.
  let bg = "var(--color-foreground)";
  let opacity = 0.18;
  if (heroDrawn) {
    bg = "var(--gold, var(--accent))";
    opacity = 0.9;
  } else if (matchCount > 0) {
    const op = matchOpacity(matchCount, pullSize);
    if (op > 0) {
      bg = "var(--accent, var(--gold))";
      opacity = op;
    }
  }

  // Text color: hero day = background-on-gold; accent day = theme-
  // defined accent-foreground; neutral = normal foreground.
  let textColor: string;
  if (heroDrawn) {
    textColor = "var(--background)";
  } else if (matchCount > 0) {
    textColor = "var(--accent-foreground, var(--background))";
  } else {
    textColor = "var(--color-foreground)";
  }

  // Ring: perfect match (every slot card landed here) = solid 2px;
  // best-available (tied for highest match in the universe, not
  // perfect, only when pullSize > 1) = dashed 1.5px; otherwise the
  // baseline subtle border.
  const isPerfectMatch = pullSize > 0 && matchCount === pullSize;
  const isBestAvailable =
    !isPerfectMatch && matchCount > 0 && matchCount === maxMatchCount && pullSize > 1;

  let border: string;
  if (isPerfectMatch) {
    border = "2px solid var(--accent, var(--gold))";
  } else if (isBestAvailable) {
    border = "1.5px dashed var(--accent, var(--gold))";
  } else {
    border = "1px solid var(--border-subtle)";
  }

  // Asterism outline: only when 2+ teal cards selected AND all of
  // them are present in this match. Sits OUTSIDE the border as a
  // separate ring.
  const outline = asterismHit && asterismSize >= 2 ? `2px solid ${TRACE_VAR}` : "none";
  const outlineOffset = asterismHit && asterismSize >= 2 ? 2 : 0;

  return {
    bg,
    opacity,
    textColor,
    border,
    outline,
    outlineOffset,
    isPerfectMatch,
    isBestAvailable,
  };
}
