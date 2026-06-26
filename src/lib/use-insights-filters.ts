// ─── Shared Insights filters ──────────────────────────────────────────
// v2.7 — Single source of truth for the ENTIRE Insights fly-out filter
// set (tags, spread types, moon phases, depth, reversed) plus the time
// range.
//
// WHY THIS EXISTS (extends the v2.6 time-range store):
// `/insights` is a layout route whose tab strip + filter bar are STICKY
// and stay pinned above the per-card CardTrace page (which mounts in the
// layout's <Outlet/>). The layout's pinned filter bar and CardTrace each
// kept their OWN, independent filter state. v2.6 unified the time range
// across that boundary, but tags / spread types / moon phases / depth /
// reversed were still split: adjusting the pinned bar updated the
// layout's state and never reached CardTrace's constellation, so a tag
// like "baking" left the hero badge and calendar unchanged.
//
// This store gives both surfaces ONE filter value. Whichever bar the
// seeker touches writes here; the constellation, calendar, hero badge,
// and stats all read here. No desync possible.
//
// Persistence: the time range is sticky (localStorage), matching v2.6.
// The fly-out filters are session-scoped (they reset on a full reload),
// matching the prior per-mount useState behavior — exploratory filters
// shouldn't silently linger across reloads.

import { useSyncExternalStore } from "react";
import { TIME_RANGES, type TimeRange } from "@/lib/insights.types";

export type SharedInsightsFilters = {
  timeRange: TimeRange;
  tags: string[];
  spreadTypes: string[];
  moonPhases: string[];
  deepOnly: boolean;
  reversedOnly: boolean;
};

// Keep the original v2.6 key so a seeker's persisted time range carries
// over. Only the time range is written to storage.
const STORAGE_KEY = "tarotseed-insights-timerange";
const DEFAULT_TIME_RANGE: TimeRange = "90d";

function readInitialTimeRange(): TimeRange {
  if (typeof window === "undefined") return DEFAULT_TIME_RANGE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && (TIME_RANGES as readonly string[]).includes(saved)) {
      return saved as TimeRange;
    }
  } catch {
    /* localStorage blocked — fall through to default */
  }
  return DEFAULT_TIME_RANGE;
}

function emptyFilters(): SharedInsightsFilters {
  return {
    timeRange: DEFAULT_TIME_RANGE,
    tags: [],
    spreadTypes: [],
    moonPhases: [],
    deepOnly: false,
    reversedOnly: false,
  };
}

let current: SharedInsightsFilters = {
  ...emptyFilters(),
  timeRange: readInitialTimeRange(),
};

// Stable identity for SSR — never recreated, so useSyncExternalStore
// won't loop. The client re-reads `current` via getSnapshot after
// hydration.
const SERVER_SNAPSHOT: SharedInsightsFilters = emptyFilters();

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function setInsightsFilters(
  patch: Partial<SharedInsightsFilters>,
): void {
  const next: SharedInsightsFilters = { ...current, ...patch };
  // Shallow-equal short-circuit avoids needless re-renders.
  if (
    next.timeRange === current.timeRange &&
    next.tags === current.tags &&
    next.spreadTypes === current.spreadTypes &&
    next.moonPhases === current.moonPhases &&
    next.deepOnly === current.deepOnly &&
    next.reversedOnly === current.reversedOnly
  ) {
    return;
  }
  current = next;
  // Persist time range only.
  if (typeof window !== "undefined" && patch.timeRange !== undefined) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next.timeRange);
    } catch {
      /* ignore persistence failure */
    }
  }
  emit();
}

export function setInsightsTimeRange(v: TimeRange): void {
  setInsightsFilters({ timeRange: v });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): SharedInsightsFilters {
  return current;
}

function getServerSnapshot(): SharedInsightsFilters {
  return SERVER_SNAPSHOT;
}

export function useInsightsFilters(): readonly [
  SharedInsightsFilters,
  (patch: Partial<SharedInsightsFilters>) => void,
] {
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return [value, setInsightsFilters] as const;
}

// Back-compat convenience slice (time range only).
export function useInsightsTimeRange(): readonly [
  TimeRange,
  (v: TimeRange) => void,
] {
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return [value.timeRange, setInsightsTimeRange] as const;
}
