import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTimezone } from "@/lib/use-timezone";

/**
 * YYYY-MM-DD in the supplied IANA timezone (falls back to device tz).
 * Q78 — streaks must follow the seeker's saved timezone, not whatever
 * tz the device happens to be in (travel days were resetting streaks).
 */
function todayInTz(tz: string | null | undefined): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // en-CA renders as YYYY-MM-DD.
    return fmt.format(new Date());
  } catch {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

function isYesterday(lastISO: string, todayISO: string): boolean {
  const last = new Date(`${lastISO}T00:00:00`);
  const today = new Date(`${todayISO}T00:00:00`);
  const diffMs = today.getTime() - last.getTime();
  return diffMs > 0 && diffMs <= 1000 * 60 * 60 * 24 + 1000 * 60 * 60; // ~1d, tolerant of DST
}

type StreakRow = {
  current_streak: number;
  longest_streak: number;
  last_draw_date: string | null;
};

export function useStreak(): {
  currentStreak: number;
  longestStreak: number;
  lastDrawDate: string | null;
  loading: boolean;
  recordDraw: () => Promise<void>;
  recomputeStreak: () => Promise<void>;
} {
  const { user, loading: authLoading } = useAuth();
  const { effectiveTz } = useTimezone();
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [lastDrawDate, setLastDrawDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStreak = useCallback(async () => {
    if (!user) {
      setCurrentStreak(0);
      setLongestStreak(0);
      setLastDrawDate(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("user_streaks")
      .select("current_streak, longest_streak, last_draw_date")
      .eq("user_id", user.id)
      .maybeSingle<StreakRow>();
    if (data) {
      setCurrentStreak(data.current_streak);
      setLongestStreak(data.longest_streak);
      setLastDrawDate(data.last_draw_date);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void loadStreak();
  }, [authLoading, loadStreak]);

  // 9-6-N — listen for cross-instance updates so the home page's
  // streak modal sees today's draw recorded by /draw.
  useEffect(() => {
    const onUpdate = () => {
      void loadStreak();
    };
    window.addEventListener("arcana:streak-updated", onUpdate);
    return () =>
      window.removeEventListener("arcana:streak-updated", onUpdate);
  }, [loadStreak]);

  // Q92 #6 — Recompute on app open / resume from background. PWA tabs
  // can sit suspended overnight; on visibility change we refetch so the
  // streak reflects today's reality, not the snapshot from last session.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadStreak();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [loadStreak]);

  const recordDraw = useCallback(async () => {
    if (!user) return;
    const today = todayInTz(effectiveTz);
    if (lastDrawDate === today) return;

    let nextStreak: number;
    if (lastDrawDate && isYesterday(lastDrawDate, today)) {
      nextStreak = currentStreak + 1;
    } else {
      nextStreak = 1;
    }
    const nextLongest = Math.max(longestStreak, nextStreak);

    setCurrentStreak(nextStreak);
    setLongestStreak(nextLongest);
    setLastDrawDate(today);

    await supabase.from("user_streaks").upsert(
      {
        user_id: user.id,
        current_streak: nextStreak,
        longest_streak: nextLongest,
        last_draw_date: today,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    // 9-6-N — notify other useStreak instances to refetch.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("arcana:streak-updated"));
    }
  }, [user, lastDrawDate, currentStreak, longestStreak, effectiveTz]);

  // Q93 #7 — Full recompute from readings history. Required after
  // backdated manual entries: a draw "for yesterday" can't be modelled
  // by recordDraw (which assumes today), so we replay the timeline.
  const recomputeStreak = useCallback(async () => {
    if (!user) return;
    const today = todayInTz(effectiveTz);
    const { data, error } = await supabase
      .from("readings")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return;
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: effectiveTz || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const days = new Set<string>();
    for (const row of data ?? []) {
      try {
        days.add(dayFmt.format(new Date((row as { created_at: string }).created_at)));
      } catch {
        // ignore
      }
    }
    // Walk back from today (or yesterday if today empty) to count
    // consecutive days with at least one reading.
    let streak = 0;
    let cursor = new Date(`${today}T12:00:00`);
    // If no draw today, allow yesterday to anchor the streak.
    if (!days.has(dayFmt.format(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(dayFmt.format(cursor))) {
        streak = 0;
        cursor = new Date(`${today}T12:00:00`); // reset
      }
    }
    while (days.has(dayFmt.format(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    const sortedDays = Array.from(days).sort();
    const lastDay = sortedDays.length ? sortedDays[sortedDays.length - 1] : null;
    const nextLongest = Math.max(longestStreak, streak);
    setCurrentStreak(streak);
    setLongestStreak(nextLongest);
    setLastDrawDate(lastDay);
    await supabase.from("user_streaks").upsert(
      {
        user_id: user.id,
        current_streak: streak,
        longest_streak: nextLongest,
        last_draw_date: lastDay,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("arcana:streak-updated"));
    }
  }, [user, effectiveTz, longestStreak]);

  return { currentStreak, longestStreak, lastDrawDate, loading, recordDraw, recomputeStreak };
}