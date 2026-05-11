/**
 * Q42 — read `user_preferences.reduce_premium_prompts` for the seeker.
 * When true, the app collapses premium teasers to a single muted line
 * (no blurred previews, no upgrade CTAs).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useReducePremiumPrompts(userId: string | undefined): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (!userId) {
      setReduce(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("reduce_premium_prompts")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { reduce_premium_prompts?: boolean } | null;
      setReduce(Boolean(row?.reduce_premium_prompts));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return reduce;
}