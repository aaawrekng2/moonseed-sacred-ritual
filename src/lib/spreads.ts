export type SpreadMode = "daily" | "single" | "three" | "celtic" | "yes_no";

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
};

export function getSpreadCount(mode: SpreadMode): number {
  return SPREAD_META[mode].count;
}

/**
 * Whether this spread should render the bottom slot rail for selected cards.
 * Single-card flows (daily / single / yes_no) keep the existing in-place
 * selection feel — no slot rail.
 */
export function spreadUsesSlots(mode: SpreadMode): boolean {
  return mode === "three" || mode === "celtic";
}

export function isValidSpreadMode(v: string | undefined | null): v is SpreadMode {
  return v === "daily" || v === "single" || v === "three" || v === "celtic" || v === "yes_no";
}