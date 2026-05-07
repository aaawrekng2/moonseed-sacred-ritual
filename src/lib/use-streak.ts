import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/** YYYY-MM-DD in the user's local timezone. */
function todayLocalISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
} {
  const { user, loading: authLoading } = useAuth();
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [lastDrawDate, setLastDrawDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_streaks")
        .select("current_streak, longest_streak, last_draw_date")
        .eq("user_id", user.id)
        .maybeSingle<StreakRow>();
      if (cancelled) return;
      if (data) {
        setCurrentStreak(data.current_streak);
        setLongestStreak(data.longest_streak);
        setLastDrawDate(data.last_draw_date);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const recordDraw = useCallback(async () => {
    if (!user) return;
    const today = todayLocalISO();
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
  }, [user, lastDrawDate, currentStreak, longestStreak]);

  return { currentStreak, longestStreak, lastDrawDate, loading, recordDraw };
}