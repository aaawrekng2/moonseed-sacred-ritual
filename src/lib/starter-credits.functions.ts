/**
 * Q69 — Starter credit grant.
 *
 * Server function called after sign-in. If the user has zero rows in
 * ai_credit_grants, grants them the starter pack (amount from
 * admin_settings.ai_starter_credits, default 50). Idempotent.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const claimStarterCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { count } = await supabaseAdmin
      .from("ai_credit_grants" as never)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) > 0) return { granted: false, credits: 0 };

    const { data: setting } = await supabaseAdmin
      .from("admin_settings" as never)
      .select("value")
      .eq("key", "ai_starter_credits")
      .maybeSingle();
    const raw = (setting as { value?: unknown } | null)?.value;
    const credits = (() => {
      if (typeof raw === "number") return raw;
      const n = parseInt(String(raw ?? 50), 10);
      return Number.isFinite(n) ? n : 50;
    })();

    await supabaseAdmin.from("ai_credit_grants" as never).insert({
      user_id: userId,
      source: "starter",
      credits_amount: credits,
      expires_at: null,
      metadata: { reason: "new_user_starter_pack" },
    } as never);
    return { granted: true, credits };
  });