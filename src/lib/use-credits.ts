/**
 * Q101 #8 — useCredits hook.
 *
 * Reads/writes credits state from public.user_preferences. Spend
 * decrements the balance and returns the new value. The seeker must
 * have run this SQL in Supabase before this hook works:
 *
 *   ALTER TABLE user_preferences
 *     ADD COLUMN IF NOT EXISTS credits_balance integer NOT NULL DEFAULT 100,
 *     ADD COLUMN IF NOT EXISTS credits_next_refill_at timestamptz,
 *     ADD COLUMN IF NOT EXISTS credits_subscription_type text;
 *
 * Module is intentionally drop-in: not yet wired to any spending action.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type CreditsState = {
  balance: number;
  nextRefillAt: Date | null;
  subscriptionType: string | null;
  loading: boolean;
  spend: (amount: number, label?: string) => Promise<number>;
  refresh: () => Promise<void>;
};

export function useCredits(): CreditsState {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [nextRefillAt, setNextRefillAt] = useState<Date | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("user_preferences")
      .select("credits_balance, credits_next_refill_at, credits_subscription_type")
      .eq("user_id", user.id)
      .maybeSingle();
    const row = (data ?? {}) as {
      credits_balance?: number;
      credits_next_refill_at?: string | null;
      credits_subscription_type?: string | null;
    };
    setBalance(typeof row.credits_balance === "number" ? row.credits_balance : 0);
    setNextRefillAt(row.credits_next_refill_at ? new Date(row.credits_next_refill_at) : null);
    setSubscriptionType(row.credits_subscription_type ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const spend = useCallback(
    async (amount: number, label?: string): Promise<number> => {
      if (!user) return balance;
      const next = Math.max(0, balance - Math.max(0, amount));
      const { error } = await supabase
        .from("user_preferences")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ credits_balance: next } as any)
        .eq("user_id", user.id);
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("[credits] spend failed", { label, amount, error });
        return balance;
      }
      setBalance(next);
      // eslint-disable-next-line no-console
      console.log("[credits] spent", { amount, label, newBalance: next });
      return next;
    },
    [user, balance],
  );

  return { balance, nextRefillAt, subscriptionType, loading, spend, refresh };
}