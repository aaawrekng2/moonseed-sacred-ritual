/**
 * FU — Shared filter contract used by both the Journal and Insights
 * surfaces. The single canonical filter pattern (see GlobalFilterBar)
 * speaks GlobalFilters; each surface adapts to/from its own internal
 * filter shape (e.g. `InsightsFilters`).
 */

/** Canonical Journal draw types — keys match `readings.spread_type`. */
export type DrawTypeKey = "single" | "three" | "celtic" | "yes_no";

export const DRAW_TYPE_LABEL: Record<string, string> = {
  single: "Single",
  three: "Three Card",
  celtic: "Celtic Cross",
  yes_no: "Yes / No",
  daily: "Daily",
};

export const DRAW_TYPE_KEYS: DrawTypeKey[] = [
  "single",
  "three",
  "celtic",
  "yes_no",
];

/** Canonical 8 moon phase keys (must match `readings.moon_phase`). */
export const MOON_PHASE_KEYS = [
  "new_moon",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
  "full_moon",
  "waning_gibbous",
  "last_quarter",
  "waning_crescent",
] as const;

export const MOON_PHASE_LABEL: Record<string, string> = {
  new_moon: "New",
  waxing_crescent: "Waxing Crescent",
  first_quarter: "First Quarter",
  waxing_gibbous: "Waxing Gibbous",
  full_moon: "Full",
  waning_gibbous: "Waning Gibbous",
  last_quarter: "Last Quarter",
  waning_crescent: "Waning Crescent",
};

/** Sections the drawer can render, in user-facing order. */
export type FilterSectionKey =
  | "tags"
  | "spreadTypes"
  | "depth"
  | "moonPhases"
  | "reversed"
  | "stories";

/**
 * Normalized filter envelope. `tags` carries tag *names* (not ids) for
 * display consistency with the rest of the codebase, where
 * `readings.tags` is a string array.
 */
export type GlobalFilters = {
  /** Insights-only single-select; Journal omits. */
  timeRange?: string;
  tags: string[];
  spreadTypes: string[];
  moonPhases: string[];
  deepOnly: boolean;
  reversedOnly: boolean;
  /** Journal-only. */
  bookmarked: boolean;
  /** Journal-only. */
  storyIds: string[];
  /** Journal-only — only meaningful with 2+ tags selected. */
  tagMode: "any" | "all";
};

export const EMPTY_GLOBAL_FILTERS: GlobalFilters = {
  tags: [],
  spreadTypes: [],
  moonPhases: [],
  deepOnly: false,
  reversedOnly: false,
  bookmarked: false,
  storyIds: [],
  tagMode: "any",
};

export function hasAnyActive(f: GlobalFilters): boolean {
  return (
    f.tags.length > 0 ||
    f.spreadTypes.length > 0 ||
    f.moonPhases.length > 0 ||
    f.deepOnly ||
    f.reversedOnly ||
    f.bookmarked ||
    f.storyIds.length > 0
  );
}

export function clearAll(f: GlobalFilters): GlobalFilters {
  return {
    ...f,
    tags: [],
    spreadTypes: [],
    moonPhases: [],
    deepOnly: false,
    reversedOnly: false,
    bookmarked: false,
    storyIds: [],
    tagMode: "any",
  };
}