/**
 * Phase 9 — Patterns / Threads / Weaves shared types and hooks.
 *
 * The Phase 9 spec describes "patterns" (top-level symbolic chambers
 * built from threads), "threads" (the existing detect-threads output —
 * stored in `symbolic_threads`), and "weaves" (relational structures
 * between patterns or Deep Reading mirrors).
 *
 * This module is a small client-side helper layer used by the bottom
 * nav (to know whether to render the Threads tab), by the /threads
 * route, and by the pattern chamber detail view.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PatternLifecycleState =
  | "emerging"
  | "active"
  | "quieting"
  | "retired"
  | "reawakened";

export type ThreadStatus =
  | "emerging"
  | "active"
  | "quieting"
  | "retired"
  | "reawakened";

export type Pattern = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  lifecycle_state: PatternLifecycleState;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
  thread_ids: string[];
  reading_ids: string[];
  is_premium: boolean;
  is_user_named: boolean;
};

export type Thread = {
  id: string;
  user_id: string;
  title: string | null;
  summary: string;
  description: string | null;
  card_ids: number[];
  tags: string[];
  reading_ids: string[];
  status: ThreadStatus;
  pattern_id: string | null;
  recurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  detected_at: string;
  updated_at: string;
};

export type WeaveType = "pattern_weave" | "mirror_weave";

export type Weave = {
  id: string;
  user_id: string;
  weave_type: WeaveType;
  title: string;
  description: string | null;
  pattern_ids: string[];
  reading_ids: string[];
  created_at: string;
  is_premium: boolean;
};

export function lifecycleLabel(state: PatternLifecycleState): string {
  switch (state) {
    case "emerging":
      return "Emerging";
    case "active":
      return "Active";
    case "quieting":
      return "Quieting";
    case "retired":
      return "Retired";
    case "reawakened":
      return "Reawakened";
  }
}

export function lifecycleOpacity(state: PatternLifecycleState): number {
  switch (state) {
    case "emerging":
      return 0.5;
    case "active":
      return 1.0;
    case "quieting":
      return 0.6;
    case "retired":
      return 0.4;
    case "reawakened":
      return 1.0;
  }
}

/**
 * Hue (in degrees) used to color a pattern node or weave edge by its
 * lifecycle state. Designed to read alongside the gold accent without
 * fighting it: emerging is moonlit silver-blue, active is full gold,
 * quieting fades to mauve, retired is cool slate, reawakened glows rose.
 */
export function lifecycleColor(
  state: PatternLifecycleState,
  alpha = 1,
): string {
  switch (state) {
    case "emerging":
      // soft moon-silver
      return `rgba(170, 195, 230, ${alpha})`;
    case "active":
      // chamber gold
      return `rgba(212, 175, 90, ${alpha})`;
    case "quieting":
      // dusk mauve
      return `rgba(180, 150, 200, ${alpha})`;
    case "retired":
      // cool slate
      return `rgba(140, 150, 170, ${alpha})`;
    case "reawakened":
      // rekindled rose
      return `rgba(232, 145, 160, ${alpha})`;
  }
}

/**
 * Color a weave edge spanning two patterns. Uses the brighter (more
 * "alive") endpoint as the dominant tone so an edge from an active to a
 * retired pattern still reads as gold rather than slate. Equal-rank
 * states fall back to the source's color.
 */
export function lifecycleEdgeColor(
  a: PatternLifecycleState,
  b: PatternLifecycleState,
  alpha = 1,
): string {
  const rank: Record<PatternLifecycleState, number> = {
    active: 5,
    reawakened: 5,
    emerging: 4,
    quieting: 3,
    retired: 2,
  };
  const dominant = rank[a] >= rank[b] ? a : b;
  return lifecycleColor(dominant, alpha);
}

/**
 * Watches the `patterns` table for the current user and returns the
 * count. The Threads bottom-nav tab uses this — when count > 0 it
 * fades in. We deliberately do NOT subscribe to realtime here:
 * the BottomNav is mounted on every screen, and a long-lived
 * `postgres_changes` channel on `patterns` was conflicting with the
 * /threads route's own queries ("cannot add postgres_changes
 * callbacks after subscribe()"), causing /threads to render empty
 * when arriving from the bottom nav. A one-shot count on mount is
 * enough — patterns appear via async detect-threads anyway, so a
 * brand-new pattern simply shows up on next navigation.
 */
export function usePatternsCount(userId: string | undefined): {
  count: number;
  loading: boolean;
} {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { count: c } = await supabase
        .from("patterns")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (cancelled) return;
      setCount(c ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { count, loading };
}

export function formatMonthSince(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}