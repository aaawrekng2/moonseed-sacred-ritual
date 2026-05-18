/**
 * Q102 — Credits snapshot server function.
 *
 * Returns the authenticated user's current credit balance, next refill
 * timestamp, and subscription label by reading the ledger
 * (ai_credit_grants + ai_call_log) via the existing battle-tested
 * getAvailableCredits() helper. The cache columns on
 * user_preferences were dropped in Q102 — this is now the only path.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAvailableCredits, getNextResetDate } from "@/lib/ai-call.server";

export const getCreditsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const [balance, nextRefillIso, prefsRes] = await Promise.all([
      getAvailableCredits(userId),
      getNextResetDate(userId),
      supabaseAdmin
        .from("user_preferences" as never)
        .select("subscription_type, is_premium, premium_tier")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const prefs = (prefsRes.data ?? null) as {
      subscription_type?: string | null;
      is_premium?: boolean | null;
      premium_tier?: string | null;
    } | null;
    const subscriptionType =
      prefs?.premium_tier ?? (prefs?.is_premium ? "premium" : prefs?.subscription_type ?? "free");
    return {
      balance,
      nextRefillAt: nextRefillIso,
      subscriptionType,
    };
  });
