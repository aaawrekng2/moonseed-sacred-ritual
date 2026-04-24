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
  },
  celtic: {
    label: "Celtic Cross",
    count: 10,
    description: "Ten positions, classic spread",
    positions: [
      "Present",
      "Obstacle",
      "Root",
      "Past",
      "Potential",
      "Future",
      "Self",
      "External",
      "Hopes",
      "Outcome",
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