// ─── Shared Insights time-range ───────────────────────────────────────
// v2.6 — Single source of truth for the Insights time-range window.
//
// WHY THIS EXISTS:
// `/insights` is a layout route. Its tab strip + time-range dropdown are
// STICKY and stay pinned to the top of the viewport. The per-card
// CardTrace page (`/insights/card/$cardId`) mounts inside that layout's
// <Outlet/>, so when the seeker scrolls down to the constellation the
// layout's pinned "Last 90 days" dropdown sits directly above it.
//
// Previously the layout and CardTrace each kept their OWN, independent
// time-range state. Adjusting the pinned dropdown updated the layout's
// filters but never reached CardTrace's constellation/calendar (which
// read CardTrace's own state, hard-defaulted to "all"). Result: changing
// the range "to 30 days" still showed everything.
//
// This module gives both surfaces ONE time-range value. Whichever
// dropdown the seeker touches writes here; the constellation, calendar,
// hero badge, and stats all read here. No desync possible.
//
// Pattern mirrors use-track-reversals.ts: module-level store +
// useSyncExternalStore, with localStorage persistence so the chosen
// window is sticky within and across sessions.

import { useSyncExternalStore } from "react";
import { TIME_RANGES, type TimeRange } from "@/lib/insights.types";

const STORAGE_KEY = "tarotseed-insights-timerange";
const DEFAULT_TIME_RANGE: TimeRange = "90d";

function readInitial(): TimeRange {
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

let current: TimeRange = readInitial();
const listeners = new Set<() => void>();

export function setInsightsTimeRange(next: TimeRange): void {
  if (next === current) return;
  current = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): TimeRange {
  return current;
}

// Stable server snapshot avoids hydration churn; the client re-reads the
// persisted value via getSnapshot after hydration.
function getServerSnapshot(): TimeRange {
  return DEFAULT_TIME_RANGE;
}

export function useInsightsTimeRange(): readonly [
  TimeRange,
  (v: TimeRange) => void,
] {
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return [value, setInsightsTimeRange] as const;
}
