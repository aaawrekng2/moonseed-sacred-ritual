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
  /**
   * EJ14 — short slot names for the labels row. Used when the long
   * name (slotNames[i]) is too long to fit a slot card width without
   * crowding. Same length / order as `slotNames`. Empty array allowed
   * for the "none" key.
   */
  slotNamesShort: string[];
};

export const SPREADS: ReadonlyArray<SpreadDefinition> = [
  {
    key: "none",
    label: "None",
    descriptor: "No spread selected — slots remain unlabeled.",
    slotNames: [],
    slotNamesShort: [],
  },
  {
    key: "single",
    label: "Single",
    descriptor: "Your card for today; a single focus or daily draw.",
    slotNames: ["The Card"],
    slotNamesShort: ["Card"],
  },
  {
    key: "three_card",
    label: "Three Card",
    descriptor: "Past, present, future — or a story arc in three beats.",
    slotNames: ["Past", "Present", "Future"],
    slotNamesShort: ["Past", "Now", "Next"],
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
    slotNamesShort: ["Now", "Cross", "Root", "Past", "Goal", "Soon", "Self", "Env", "Hope", "Out"],
  },
  {
    key: "yes_no",
    label: "Yes/No",
    descriptor: "A single card; upright is yes, reversed is no.",
    slotNames: ["Answer"],
    slotNamesShort: ["Y/N"],
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
    slotNamesShort: ["Past", "Now", "Hid", "Obs", "Ext", "Adv", "Out"],
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
    slotNamesShort: ["You", "Them", "Bond", "Chal", "End"],
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
    slotNamesShort: [
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
    slotNamesShort: ["Now", "A", "B", "Hid", "End"],
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
export type SpreadMode = "daily" | "single" | "three" | "celtic" | "yes_no" | "custom";

export const SPREAD_META: Record<
  SpreadMode,
  {
    label: string;
    count: number;
    description: string;
    positions?: string[];
    /** Compact labels used when slot rail is space-constrained. */
    positionsShort?: string[];
    /**
     * One-line description of each position. Used by the draw-screen whisper
     * to give the user a sentence of guidance about what they're drawing for.
     * Indices line up 1:1 with `positions`.
     */
    positionDescriptions?: string[];
  }
> = {
  daily: { label: "Daily Draw", count: 1, description: "One card for today" },
  single: { label: "Single Reading", count: 1, description: "A single card" },
  three: {
    label: "Past · Present · Future",
    count: 3,
    description: "Three cards across time",
    positions: ["Past", "Present", "Future"],
    positionsShort: ["Past", "Pres", "Fut"],
    positionDescriptions: [
      "Energies and influences moving out",
      "Where you stand right now",
      "Where the energy is heading",
    ],
  },
  celtic: {
    label: "Celtic Cross",
    count: 10,
    description: "Ten positions, classic spread",
    positions: [
      "The Present",
      "The Challenge",
      "The Foundation",
      "The Past",
      "The Goal",
      "Near Future",
      "You / Self",
      "Environment",
      "Hopes & Fears",
      "The Outcome",
    ],
    positionsShort: [
      "Pres",
      "Obs",
      "Root",
      "Past",
      "Pot",
      "Fut",
      "Self",
      "Ext",
      "Hope",
      "Out",
    ],
    positionDescriptions: [
      "What the reading centers on now",
      "What crosses or complicates the situation",
      "Underlying influences, what lies beneath",
      "Recent energies moving out",
      "What is consciously known or sought",
      "What is approaching soon",
      "Your stance, attitude, or role",
      "Outside influences and surrounding energy",
      "Often both live in the same card",
      "Where the energy is tending",
    ],
  },
  yes_no: { label: "Yes / No", count: 1, description: "A single guiding card" },
  // 9-6-O — Custom: count is a placeholder; the runtime count comes
  // from the URL search param ?n= (1-10).
  custom: { label: "Custom", count: 1, description: "Pick how many cards." },
};

export function getSpreadCount(mode: SpreadMode): number {
  return SPREAD_META[mode].count;
}

/**
 * Whether this spread should render the bottom slot rail for selected cards.
 * Single-card flows (daily / single / yes_no) keep the existing in-place
 * selection feel — no slot rail.
 */
export function spreadUsesSlots(mode: SpreadMode, count?: number): boolean {
  if (mode === "custom") return (count ?? 1) >= 2;
  return mode === "three" || mode === "celtic";
}

export function isValidSpreadMode(v: string | undefined | null): v is SpreadMode {
  return v === "daily" || v === "single" || v === "three" || v === "celtic" || v === "yes_no" || v === "custom";
}