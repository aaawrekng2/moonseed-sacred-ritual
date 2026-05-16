/**
 * EJ — shared types for the Insights surface.
 * Filters live in the parent route; server functions consume the same shape.
 */
import { z } from "zod";
import type { MoonPhaseName } from "@/lib/moon";

// FK-4 — renamed "12m" → "365d" so all bounded ranges follow the
// "Last X days" pattern.
export const TIME_RANGES = ["7d", "30d", "90d", "365d", "all"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

// Q56 — Cards tab grouping and sorting options.
export const CARD_GROUP_BY = ["none", "suit", "number", "type"] as const;
export type CardGroupBy = (typeof CARD_GROUP_BY)[number];

export const CARD_SORT_BY = [
  "frequency",
  "recent",
  "suit_order",
  "card_number",
  "reversed_pct",
  "alpha",
] as const;
export type CardSortBy = (typeof CARD_SORT_BY)[number];

export const CARD_GROUP_BY_LABEL: Record<CardGroupBy, string> = {
  none: "None",
  suit: "Suit",
  number: "Number",
  type: "Type",
};

export const CARD_SORT_BY_LABEL: Record<CardSortBy, string> = {
  frequency: "Frequency",
  recent: "Recent",
  suit_order: "Suit order",
  card_number: "Card number",
  reversed_pct: "Reversed %",
  alpha: "A–Z",
};

export const InsightsFiltersSchema = z.object({
  timeRange: z.enum(TIME_RANGES).default("90d"),
  moonPhases: z.array(z.string()).default([]),
  spreadTypes: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  deckIds: z.array(z.string()).default([]),
  reversedOnly: z.boolean().default(false),
  deepOnly: z.boolean().default(false),
  cardGroupBy: z.enum(CARD_GROUP_BY).optional().default("none"),
  cardSortBy: z.enum(CARD_SORT_BY).optional().default("frequency"),
});

export type InsightsFilters = {
  timeRange: TimeRange;
  moonPhases: MoonPhaseName[];
  spreadTypes: string[];
  tagIds: string[];
  deckIds: string[];
  reversedOnly: boolean;
  deepOnly: boolean;
  cardGroupBy?: CardGroupBy;
  cardSortBy?: CardSortBy;
};

export const DEFAULT_FILTERS: InsightsFilters = {
  timeRange: "90d",
  moonPhases: [],
  spreadTypes: [],
  tagIds: [],
  deckIds: [],
  reversedOnly: false,
  deepOnly: false,
  cardGroupBy: "none",
  cardSortBy: "frequency",
};

export type InsightsOverview = {
  totalReadings: number;
  suitBalance: { major: number; wands: number; cups: number; swords: number; pentacles: number };
  majorMinor: { major: number; minor: number };
  moonPhaseDistribution: Record<string, number>;
  reversalRate: number;
  readingsByDay: Array<{ date: string; count: number }>;
  topGuide: { guideId: string; name: string; count: number } | null;
  topLens: { lensId: string; name: string; count: number } | null;
  deepReadingsCount: number;
  dataCapped: boolean;
  /** Q75 — unique spread_type values present in the filtered readings. */
  availableSpreadTypes: string[];
  /** Q75 — unique moon_phase values present in the filtered readings. */
  availableMoonPhases: string[];
  /** Q76 — unique tag names present in the time-window readings. */
  availableTags: string[];
};

export type StalkerCard = {
  cardId: number;
  cardName: string;
  count: number;
  appearances: Array<{ readingId: string; date: string }>;
};

export type StalkerCardsResult = {
  stalkerCards: StalkerCard[];
  topCard: { cardId: number; count: number } | null;
  totalReadings: number;
};

// FP-1 — Cooccurrence definition for twins/triplets.
export const COOCCURRENCE_MODES = ["reading", "day"] as const;
export type CooccurrenceMode = (typeof COOCCURRENCE_MODES)[number];

// FP-1 — Twin stalker types.
export type StalkerTwin = {
  cardA: number;
  cardB: number;
  cardAName: string;
  cardBName: string;
  count: number;
  appearances: Array<{ readingId: string; date: string }>;
};

export type StalkerTwinsResult = {
  twins: StalkerTwin[];
};

// FP-2 — Triplet stalker types.
export type StalkerTriplet = {
  cardIds: [number, number, number];
  cardNames: [string, string, string];
  count: number;
  appearances: Array<{ readingId: string; date: string }>;
};

export type StalkerTripletsResult = {
  triplets: StalkerTriplet[];
};

// FP-3 — Reversed stalker types.
export type ReversedStalker = {
  cardId: number;
  cardName: string;
  reversedCount: number;
  appearances: Array<{ readingId: string; date: string }>;
};

export type ReversedStalkersResult = {
  reversedStalkers: ReversedStalker[];
};