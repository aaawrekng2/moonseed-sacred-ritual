/**
 * Q103 — Stripe webhook receiver.
 *
 * Stripe sends events here. We verify the signature, write the raw
 * event to stripe_events (idempotency via the unique event_id index),
 * then process specific event types:
 *
 *  - checkout.session.completed → insert ai_credit_grants row with
 *    source='stripe_purchase', positive credits_amount per pack_sku.
 *  - charge.refunded → insert ai_credit_grants row with
 *    source='stripe_refund', NEGATIVE credits_amount.
 *  - charge.dispute.created → store the event only; admin alert
 *    in Q105 will surface it.
 *
 * All credit additions live in ai_credit_grants. Balance is
 * computed live by getAvailableCredits() — no caches to invalidate.
 *
 * IMPORTANT: this function must run without JWT verification because
 * Stripe is the caller. verify_jwt=false is set in supabase/config.toml.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CREDITS_BY_SKU: Record<string, number> = {
  spark_100: 100,
  flame_500: 500,
  bonfire_1500: 1500,
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const sig = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[stripe-webhook] signature verification failed", e);
    return new Response("bad_signature", { status: 400 });
  }

  // Persist the raw event first (idempotency). event_id is UNIQUE.
  const { error: insErr } = await supabase.from("stripe_events").insert({
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      console.log("[stripe-webhook] duplicate event ignored", event.id);
      return new Response("ok_duplicate", { status: 200 });
    }
    console.error("[stripe-webhook] event insert failed", insErr);
    return new Response("db_error", { status: 500 });
  }

  let processingError: string | null = null;
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          session.client_reference_id ?? session.metadata?.tarot_seed_user_id;
        const sku = session.metadata?.pack_sku ?? "";
        const credits = CREDITS_BY_SKU[sku] ?? 0;
        if (userId && credits > 0) {
          const { error } = await supabase.from("ai_credit_grants").insert({
            user_id: userId,
            source: "stripe_purchase",
            credits_amount: credits,
            expires_at: null,
            stripe_session_id: session.id,
            pack_sku: sku,
            metadata: {
              amount_total_cents: session.amount_total,
              currency: session.currency,
              payment_intent: session.payment_intent,
            },
          });
          if (error) processingError = `grant_insert_failed: ${error.message}`;
        } else {
          processingError = "missing_user_or_sku";
        }
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const userId = charge.metadata?.tarot_seed_user_id;
        const sku = charge.metadata?.pack_sku ?? "";
        const credits = CREDITS_BY_SKU[sku] ?? 0;
        if (userId && credits > 0) {
          const { error } = await supabase.from("ai_credit_grants").insert({
            user_id: userId,
            source: "stripe_refund",
            credits_amount: -credits,
            expires_at: null,
            stripe_session_id: null,
            pack_sku: sku,
            metadata: {
              refund_charge_id: charge.id,
              refunded_amount_cents: charge.amount_refunded,
            },
          });
          if (error) processingError = `refund_insert_failed: ${error.message}`;
        }
        break;
      }
      case "charge.dispute.created":
        // Stored in stripe_events; Q105 alerting will surface it.
        break;
      default:
        // Stored for audit; no action needed.
        break;
    }
  } catch (e) {
    processingError = String(e instanceof Error ? e.message : e).slice(0, 300);
  }

  await supabase
    .from("stripe_events")
    .update({
      processed_at: new Date().toISOString(),
      error_message: processingError,
    })
    .eq("event_id", event.id);

  if (processingError) {
    console.error("[stripe-webhook] processing error", event.id, processingError);
  }
  return new Response("ok", { status: 200 });
});