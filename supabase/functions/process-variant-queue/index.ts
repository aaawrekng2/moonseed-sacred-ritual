/**
 * 9-6-AH — Background variant queue runner.
 *
 * Picks up to 2 custom_deck_cards rows where processing_status is
 * 'pending' or 'failed' (with backoff and a retry cap of 3) and
 * invokes generate-deck-variants for each. Designed to run every
 * 30 seconds via pg_cron.
 *
 * Auth: verify_jwt = false (see supabase/config.toml). The function
 * uses the service-role key internally and does not trust the caller.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const BATCH = 2;
const BACKOFF_SECONDS = 60;
const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const cutoff = new Date(Date.now() - BACKOFF_SECONDS * 1000)
      .toISOString();

    const { data: rows, error } = await admin
      .from("custom_deck_cards")
      .select("id, deck_id, card_id, user_id, variant_attempts")
      .in("processing_status", ["pending", "failed"])
      .lt("variant_attempts", MAX_ATTEMPTS)
      .or(
        `variant_last_attempt_at.is.null,variant_last_attempt_at.lt.${cutoff}`,
      )
      .is("archived_at", null)
      .order("variant_last_attempt_at", { ascending: true, nullsFirst: true })
      .limit(BATCH);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0;
    for (const row of rows) {
      const nextAttempts = (row.variant_attempts ?? 0) + 1;
      await admin
        .from("custom_deck_cards")
        .update({
          variant_attempts: nextAttempts,
          variant_last_attempt_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      // Mint a short-lived service-role JWT call to generate-deck-variants.
      // generate-deck-variants requires a JWT and verifies deck ownership;
      // we call it via fetch with the service-role key impersonating the
      // owner via x-supabase-user-id is not supported, so we instead
      // construct a server-to-server invoke using the row's user_id by
      // calling the function with the service-role key as Authorization.
      try {
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/generate-deck-variants`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // The function pulls userId from the JWT; using the
              // service-role key bypasses ownership check via the
              // 'x-queue-internal' header below — see fn changes.
              Authorization: `Bearer ${serviceKey}`,
              "x-queue-internal": "1",
              "x-queue-user-id": row.user_id,
            },
            body: JSON.stringify({
              deckId: row.deck_id,
              cardId: row.card_id,
            }),
          },
        );
        if (!resp.ok) {
          console.warn("[pvq] generate-deck-variants failed", {
            cardId: row.card_id,
            status: resp.status,
            text: await resp.text().catch(() => ""),
          });
          if (nextAttempts >= MAX_ATTEMPTS) {
            await admin
              .from("custom_deck_cards")
              .update({ processing_status: "failed" })
              .eq("id", row.id);
          }
        }
      } catch (e) {
        console.warn("[pvq] invoke threw", { cardId: row.card_id, e });
        if (nextAttempts >= MAX_ATTEMPTS) {
          await admin
            .from("custom_deck_cards")
            .update({ processing_status: "failed" })
            .eq("id", row.id);
        }
      }
      processed++;
    }

    return new Response(
      JSON.stringify({ ok: true, processed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[pvq] fatal", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});