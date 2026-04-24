export type SpreadMode = "daily" | "single" | "three" | "celtic" | "yes_no";

export const SPREAD_META: Record<
  SpreadMode,
  { label: string; count: number; description: string }
> = {
  daily: { label: "Daily Draw", count: 1, description: "One card for today" },
  single: { label: "Single Reading", count: 1, description: "A single card" },
  three: {
    label: "Past · Present · Future",
    count: 3,
    description: "Three cards across time",
  },
  celtic: {
    label: "Celtic Cross",
    count: 10,
    description: "Ten positions, classic spread",
  },
  yes_no: { label: "Yes / No", count: 1, description: "A single guiding card" },
};

export function getSpreadCount(mode: SpreadMode): number {
  return SPREAD_META[mode].count;
}

export function isValidSpreadMode(v: string | undefined | null): v is SpreadMode {
  return v === "daily" || v === "single" || v === "three" || v === "celtic" || v === "yes_no";
}