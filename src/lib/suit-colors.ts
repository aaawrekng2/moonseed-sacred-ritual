// v3.131 — single source of truth for suit colors. Element-based and clearly
// distinct on the dark crimson ground: Major = violet, Wands = orange (fire),
// Cups = blue (water), Swords = gold (air), Pentacles = green (earth).
// Includes both "major" and the engine's "majors" key so every caller matches.
export const SUIT_COLORS: Record<string, string> = {
  major: "#a855f7",
  majors: "#a855f7",
  wands: "#f97316",
  cups: "#3b82f6",
  swords: "#eab308",
  pentacles: "#22c55e",
};

export function suitColor(key: string): string {
  return SUIT_COLORS[key] ?? "var(--color-foreground)";
}
