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

export const InsightsFiltersSchema = z.object({
  timeRange: z.enum(TIME_RANGES).default("90d"),
  moonPhases: z.array(z.string()).default([]),
  spreadTypes: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  deckIds: z.array(z.string()).default([]),
  reversedOnly: z.boolean().default(false),
  deepOnly: z.boolean().default(false),
});

export type InsightsFilters = {
  timeRange: TimeRange;
  moonPhases: MoonPhaseName[];
  spreadTypes: string[];
  tagIds: string[];
  deckIds: string[];
  reversedOnly: boolean;
  deepOnly: boolean;
};

export const DEFAULT_FILTERS: InsightsFilters = {
  timeRange: "90d",
  moonPhases: [],
  spreadTypes: [],
  tagIds: [],
  deckIds: [],
  reversedOnly: false,
  deepOnly: false,
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