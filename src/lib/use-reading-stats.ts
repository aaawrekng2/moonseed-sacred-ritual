/**
 * Q11 Fix 3 — shared hook surfacing the seeker's total reading count
 * and earliest reading date. Used by Journal, Profile, and Insights.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ReadingStats = { count: number; firstAt: string | null };

export function useReadingStats(userId: string | null | undefined): ReadingStats {
  const [stats, setStats] = useState<ReadingStats>({ count: 0, firstAt: null });
  useEffect(() => {
    if (!userId) {
      setStats({ count: 0, firstAt: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, count } = await supabase
        .from("readings")
        .select("created_at", { count: "exact" })
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1);
      if (cancelled) return;
      setStats({
        count: count ?? 0,
        firstAt: data?.[0]?.created_at ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return stats;
}

export function formatReadingStatsLine(stats: ReadingStats): string | null {
  if (!stats.count) return null;
  const noun = stats.count === 1 ? "reading" : "readings";
  if (!stats.firstAt) return `${stats.count} ${noun}`;
  const d = new Date(stats.firstAt);
  const month = d.toLocaleString(undefined, { month: "long" });
  const year = d.getFullYear();
  return `${stats.count} ${noun} since ${month} ${year}`;
}