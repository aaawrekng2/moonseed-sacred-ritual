import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";

export function spreadLabelOf(spread: string): string {
  if (isValidSpreadMode(spread)) return SPREAD_META[spread as SpreadMode].label;
  return spread;
}