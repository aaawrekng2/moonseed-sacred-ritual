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
 * Watches the `patterns` table for the current user and returns the
 * count. The Threads bottom-nav tab uses this — when count > 0 it
 * fades in. Realtime: we subscribe to inserts so the tab appears the
 * moment a pattern is born.
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

    const channel = supabase
      .channel(`patterns-count-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patterns", filter: `user_id=eq.${userId}` },
        () => {
          void (async () => {
            const { count: c } = await supabase
              .from("patterns")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId);
            if (!cancelled) setCount(c ?? 0);
          })();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return { count, loading };
}

/**
 * Format a relative time span like "2 weeks ago" or "Active since March".
 */
export function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < day) return "today";
  if (ms < 7 * day) return `${Math.floor(ms / day)} day${Math.floor(ms / day) === 1 ? "" : "s"} ago`;
  if (ms < 30 * day) {
    const weeks = Math.floor(ms / (7 * day));
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (ms < 365 * day) {
    const months = Math.floor(ms / (30 * day));
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(ms / (365 * day));
  return `${years} year${years === 1 ? "" : "s"} ago`;
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

export function formatDateSpan(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString(undefined, {
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endStr = end.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}