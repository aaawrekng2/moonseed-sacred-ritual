/**
 * Q102 — useCredits hook (ledger truth).
 *
 * Reads the credits snapshot from getCreditsSnapshot server function,
 * which derives balance from ai_credit_grants − ai_call_log. The
 * previous user_preferences cache columns were dropped in Q102.
 *
 * Spending is intentionally server-only (inside callAI()), so this
 * hook does NOT expose a spend() method.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCreditsSnapshot } from "@/lib/credits.functions";
import { useAuth } from "@/lib/auth";
import { getAuthHeaders } from "@/lib/server-fn-auth";

export type CreditsState = {
  balance: number;
  nextRefillAt: Date | null;
  subscriptionType: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useCredits(): CreditsState {
  const { user } = useAuth();
  const fetchSnapshot = useServerFn(getCreditsSnapshot);
  const [balance, setBalance] = useState<number>(0);
  const [nextRefillAt, setNextRefillAt] = useState<Date | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const snap = await fetchSnapshot({ headers });
      setBalance(typeof snap.balance === "number" ? snap.balance : 0);
      setNextRefillAt(snap.nextRefillAt ? new Date(snap.nextRefillAt) : null);
      setSubscriptionType(snap.subscriptionType ?? null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[credits] snapshot fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, [user, fetchSnapshot]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { balance, nextRefillAt, subscriptionType, loading, refresh };
}
