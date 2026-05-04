/**
 * generate-deck-variants (Phase EZ-6)
 *
 * Server-side image resizer for custom deck card art. Takes a
 * `deckId`, fetches each photographed card from the
 * `custom-deck-images` bucket, downsizes to two JPEG variants
 * (200px wide "sm", 400px wide "md") and uploads them as sibling
 * objects with predictable suffixes:
 *
 *   <userId>/<deckId>/card-<N>-<ts>.webp        (original)
 *   <userId>/<deckId>/card-<N>-<ts>-sm.jpg      (≤ 200 px wide)
 *   <userId>/<deckId>/card-<N>-<ts>-md.jpg      (≤ 400 px wide)
 *
 * The client (CardImage + variantUrlFor) derives variant URLs by
 * rewriting the filename portion of the signed URL — no DB schema
 * changes required. If a variant doesn't exist (deck not yet
 * backfilled), the IMG `onError` retries with the original URL.
 *
 * Auth: caller must be the deck owner. We validate the JWT supplied
 * in the Authorization header against custom_decks.user_id.
 *
 * Idempotent: existing variants are skipped via `upsert: false`
 * combined with a HEAD probe — re-running on a fully-backfilled
 * deck is cheap.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const BUCKET = "custom-deck-images";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CardRow = {
  card_id: number;
  display_path: string | null;
};

type VariantSpec = { suffix: "sm" | "md"; width: number };
const VARIANTS: VariantSpec[] = [
  { suffix: "sm", width: 200 },
  { suffix: "md", width: 400 },
];

function variantPathFor(originalPath: string, suffix: "sm" | "md"): string | null {
  // Match `<...>/card-N-TS(-thumb)?.<ext>` and replace the filename.
  const m = originalPath.match(
    /^(.*\/card-\d+-\d+)(?:-thumb)?\.(?:webp|png|jpe?g)$/i,
  );
  if (!m) return null;
  return `${m[1]}-${suffix}.jpg`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) Identify the caller from the JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const deckId = typeof body?.deckId === "string" ? body.deckId : null;
    if (!deckId) {
      return new Response(JSON.stringify({ error: "missing_deckId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Service-role client for storage + privileged reads.
    const admin = createClient(supabaseUrl, serviceKey);

    // 3) Verify deck ownership.
    const { data: deck, error: deckErr } = await admin
      .from("custom_decks")
      .select("id, user_id")
      .eq("id", deckId)
      .maybeSingle();
    if (deckErr || !deck || deck.user_id !== userId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) List active cards for the deck.
    const { data: cards, error: cardsErr } = await admin
      .from("custom_deck_cards")
      .select("card_id, display_path")
      .eq("deck_id", deckId)
      .is("archived_at", null);
    if (cardsErr) {
      return new Response(JSON.stringify({ error: cardsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: { card_id: number; reason: string }[] = [];

    for (const c of (cards ?? []) as CardRow[]) {
      if (!c.display_path) {
        skipped++;
        continue;
      }
      try {
        // Lazy decode — only read the original once, even though we
        // produce two variants from it.
        let decoded: Image | null = null;

        for (const v of VARIANTS) {
          const variantPath = variantPathFor(c.display_path, v.suffix);
          if (!variantPath) {
            failed++;
            errors.push({
              card_id: c.card_id,
              reason: "unrecognized path layout",
            });
            continue;
          }

          // Idempotency: skip if a variant already exists.
          const { data: existing } = await admin.storage
            .from(BUCKET)
            .list(variantPath.substring(0, variantPath.lastIndexOf("/")), {
              limit: 100,
              search: variantPath.substring(variantPath.lastIndexOf("/") + 1),
            });
          const filename = variantPath.substring(
            variantPath.lastIndexOf("/") + 1,
          );
          if ((existing ?? []).some((row) => row.name === filename)) {
            skipped++;
            continue;
          }

          if (!decoded) {
            const dl = await admin.storage
              .from(BUCKET)
              .download(c.display_path);
            if (dl.error || !dl.data) {
              throw dl.error ?? new Error("download failed");
            }
            const bytes = new Uint8Array(await dl.data.arrayBuffer());
            decoded = await Image.decode(bytes);
          }

          const ratio = v.width / decoded.width;
          const targetH = Math.max(1, Math.round(decoded.height * ratio));
          const resized = decoded.clone().resize(v.width, targetH);
          const jpeg = await resized.encodeJPEG(85);

          const up = await admin.storage
            .from(BUCKET)
            .upload(variantPath, jpeg, {
              contentType: "image/jpeg",
              upsert: false,
            });
          if (up.error) throw up.error;
          generated++;
        }
      } catch (err) {
        failed++;
        errors.push({
          card_id: c.card_id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        deckId,
        cardCount: (cards ?? []).length,
        generated,
        skipped,
        failed,
        errors: errors.slice(0, 20),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
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