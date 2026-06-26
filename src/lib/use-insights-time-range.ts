// ─── Shared Insights time-range (v2.6) — re-export shim ───────────────
// v2.7 folded the time range into the broader shared filters store so the
// pinned Insights bar and the CardTrace page share ONE source for every
// filter, not just time. This file now re-exports from that store for
// back-compat with existing imports. New code should import directly from
// "@/lib/use-insights-filters".
export {
  useInsightsTimeRange,
  setInsightsTimeRange,
} from "@/lib/use-insights-filters";
