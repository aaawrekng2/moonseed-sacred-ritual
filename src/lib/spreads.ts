/**
 * EJ12 — Tarot spread definitions.
 *
 * Used by the Manual Entry slot row to label each slot with its
 * positional meaning ("Past", "Present", "Future", etc.) when a
 * spread type is selected from the slot-row dropdown. Each spread
 * has a short key, a display label, an array of slot names (in
 * placement order), and a one-line descriptor explaining what the
 * spread is for.
 *
 * Slot names are passed through to the labels row beneath the slot
 * cards. The label row truncates long names visually with CSS; the
 * hover tip surfaces the full name and the spread descriptor. Slots
 * beyond the spread's defined count remain unlabeled (free slots).
 *
 * "None" is the default — no labels render.
 *
 * Verified against widely-cited tarot sources (Waite Pictorial Key,
 * Labyrinthos, Elvi Tarot, Curious Cauldron, The Tarot Guide).
 */

export type SpreadKey =
  | "none"
  | "single"
  | "three_card"
  | "celtic_cross"
  | "yes_no"
  | "horseshoe"
  | "relationship"
  | "year_ahead"
  | "cross_of_decision";

export type SpreadDefinition = {
  /** Stable internal key. */
  key: SpreadKey;
  /** Display label shown in the dropdown trigger and menu. */
  label: string;
  /** One-line descriptor surfaced in label hover tips. */
  descriptor: string;
  /** Slot names in placement order. Empty array = no labels. */
  slotNames: string[];
};

export const SPREADS: ReadonlyArray<SpreadDefinition> = [
  {
    key: "none",
    label: "None",
    descriptor: "No spread selected — slots remain unlabeled.",
    slotNames: [],
  },
  {
    key: "single",
    label: "Single",
    descriptor: "Your card for today; a single focus or daily draw.",
    slotNames: ["The Card"],
  },
  {
    key: "three_card",
    label: "Three Card",
    descriptor: "Past, present, future — or a story arc in three beats.",
    slotNames: ["Past", "Present", "Future"],
  },
  {
    key: "celtic_cross",
    label: "Celtic Cross",
    descriptor:
      "The classic ten-card spread; the deepest read on a single question.",
    slotNames: [
      "The Present",
      "The Cross (Obstacle)",
      "Foundation",
      "Past",
      "Crown (Conscious Goal)",
      "Near Future",
      "Self",
      "Environment",
      "Hopes & Fears",
      "Outcome",
    ],
  },
  {
    key: "yes_no",
    label: "Yes/No",
    descriptor: "A single card; upright is yes, reversed is no.",
    slotNames: ["Answer"],
  },
  {
    key: "horseshoe",
    label: "Horseshoe (7)",
    descriptor: "A broader life-situation reading in seven beats.",
    slotNames: [
      "Past",
      "Present",
      "Hidden Influences",
      "Obstacles",
      "External Influences",
      "Advice",
      "Outcome",
    ],
  },
  {
    key: "relationship",
    label: "Relationship (5)",
    descriptor: "You, them, the bond, the challenge, the outcome.",
    slotNames: [
      "You",
      "Your Partner",
      "The Connection",
      "The Challenge",
      "The Outcome",
    ],
  },
  {
    key: "year_ahead",
    label: "Year Ahead (12)",
    descriptor: "One card per month for the year.",
    slotNames: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
  },
  {
    key: "cross_of_decision",
    label: "Cross of Decision (5)",
    descriptor: "A five-card spread for choosing between two paths.",
    slotNames: [
      "The Situation",
      "Path A",
      "Path B",
      "Hidden Influence",
      "Likely Outcome",
    ],
  },
];

/** Look up a spread by key. Defaults to "none" when not found. */
export function getSpread(key: SpreadKey): SpreadDefinition {
  return (
    SPREADS.find((s) => s.key === key) ?? SPREADS[0]
  );
}

/** localStorage key for the seeker's chosen spread on /constellation. */
export const SPREAD_STORAGE_KEY = "tarotseed:constellation-spread";
