/**
 * Q103 — Stripe Checkout Session creator.
 *
 * Authenticated user POSTs { pack_sku } (one of 'spark_100' |
 * 'flame_500' | 'bonfire_1500'). We:
 * 1. Verify the JWT and resolve user_id.
 * 2. Look up user_preferences.stripe_customer_id; create the
 *    Stripe Customer if missing and store the id.
 * 3. Resolve pack_sku → Stripe Price ID from env.
 * 4. Create a Checkout Session in mode='payment' (one-time).
 * 5. Set client_reference_id = user_id and metadata.pack_sku so
 *    the webhook can credit the correct user without a customer lookup.
 * 6. Return { url } the frontend redirects to.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://tarot-seed.lovable.app";

const PRICE_ID_BY_SKU: Record<string, string> = {
  spark_100: Deno.env.get("STRIPE_PRICE_SPARK") ?? "",
  flame_500: Deno.env.get("STRIPE_PRICE_FLAME") ?? "",
  bonfire_1500: Deno.env.get("STRIPE_PRICE_BONFIRE") ?? "",
};

const CREDITS_BY_SKU: Record<string, number> = {
  spark_100: 100,
  flame_500: 500,
  bonfire_1500: 1500,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonErr(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonErr("method_not_allowed", 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return jsonErr("missing_auth", 401);

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userRes?.user) return jsonErr("invalid_auth", 401);
    const user = userRes.user;

    const body = (await req.json().catch(() => ({}))) as { pack_sku?: string };
    const sku = String(body.pack_sku ?? "");
    if (!PRICE_ID_BY_SKU[sku] || !CREDITS_BY_SKU[sku]) {
      return jsonErr("unknown_pack_sku", 400);
    }
    const priceId = PRICE_ID_BY_SKU[sku];
    if (!priceId) return jsonErr("price_not_configured", 500);

    const { data: prefRow } = await supabase
      .from("user_preferences")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let stripeCustomerId =
      (prefRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { tarot_seed_user_id: user.id },
      });
      stripeCustomerId = customer.id;
      await supabase
        .from("user_preferences")
        .upsert(
          { user_id: user.id, stripe_customer_id: stripeCustomerId },
          { onConflict: "user_id" },
        );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/credits/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/credits/cancel`,
      metadata: {
        tarot_seed_user_id: user.id,
        pack_sku: sku,
        credits_amount: String(CREDITS_BY_SKU[sku]),
      },
      payment_intent_data: {
        metadata: {
          tarot_seed_user_id: user.id,
          pack_sku: sku,
          credits_amount: String(CREDITS_BY_SKU[sku]),
        },
      },
    });

    return new Response(JSON.stringify({ url: session.url, id: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[create-checkout-session]", e);
    return jsonErr("server_error", 500);
  }
});