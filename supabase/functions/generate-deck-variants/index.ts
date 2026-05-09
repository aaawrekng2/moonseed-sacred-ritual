/**
 * generate-deck-variants (Phase EZ-6, extended FD-3)
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
 * FD-3 — single-card mode. When the request includes `cardId` (in
 * addition to `deckId`), the function processes ONLY that card and
 * additionally bakes a rounded-corner alpha mask into a transparent
 * WebP `-full` variant. The radius is taken from the per-card
 * `corner_radius_percent` if set, otherwise from the deck-level
 * default. The original storage object is never overwritten — the
 * `original_path` column tracks where to re-fetch source bytes for
 * subsequent re-edits. After a successful run the card row's
 * `processing_status` is set to `saved` and `processed_at` to now.
 *
 * The client (CardImage + variantUrlFor) derives variant URLs by
 * rewriting the filename portion of the signed URL — no DB schema
 * changes required for the sm/md path. If a variant doesn't exist
 * (deck not yet backfilled), the IMG `onError` retries with the
 * original URL.
 *
 * Auth: caller must be the deck owner. We validate the JWT supplied
 * in the Authorization header against custom_decks.user_id.
 *
 * Idempotent: existing variants are skipped via `upsert: false`
 * combined with a HEAD probe — re-running on a fully-backfilled
 * deck is cheap. Single-card mode always re-renders (so a user who
 * adjusts the slider gets fresh output).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
// FI-1 — bump to current published version. 0.0.30 was stale and
// auto-init tries XMLHttpRequest which isn't available in Edge Runtime,
// causing the function to fail to boot ("Invalid URL: 'magick.wasm'").
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "npm:@imagemagick/magick-wasm@0.0.40";

// FI-1 — Always use explicit wasm load. Auto-load uses XMLHttpRequest
// which isn't available in Deno Edge Runtime.
// Reference: https://github.com/dlemstra/magick-wasm/issues/81
let magickReady: Promise<void> | null = null;
function ensureMagick(): Promise<void> {
  if (!magickReady) {
    magickReady = (async () => {
      const wasmUrl = new URL(
        "magick.wasm",
        import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.40"),
      );
      let wasmBytes: Uint8Array;
      try {
        wasmBytes = await Deno.readFile(wasmUrl);
      } catch {
        const resp = await fetch(wasmUrl);
        if (!resp.ok) {
          throw new Error(`Failed to fetch magick.wasm: ${resp.status}`);
        }
        wasmBytes = new Uint8Array(await resp.arrayBuffer());
      }
      await initializeImageMagick(wasmBytes);
    })();
  }
  return magickReady;
}

/**
 * FE-1 — decode arbitrary image bytes (WebP/PNG/JPEG) into an
 * imagescript Image. WebP is routed through imagemagick_deno first
 * and re-encoded as PNG (lossless, preserves alpha) so imagescript
 * can take over for the rounded-mask and resize work it does well.
 */
async function decodeAny(bytes: Uint8Array): Promise<Image> {
  // 9-6-R — try imagescript directly first. Avoids the PNG round-trip's
  // ~30 MB intermediate buffer when imagescript can decode the WebP itself.
  try {
    return await Image.decode(bytes);
  } catch {
    // Fall through to ImageMagick path.
  }
  const isWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isWebp) return await Image.decode(bytes);

  await ensureMagick();
  const png: Uint8Array = await new Promise((resolve, reject) => {
    try {
      ImageMagick.read(bytes, (img) => {
        img.write(MagickFormat.Png, (data) => resolve(new Uint8Array(data)));
      });
    } catch (e) {
      reject(e);
    }
  });
  return await Image.decode(png);
}

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
  corner_radius_percent?: number | null;
};

type VariantSpec = { suffix: "sm" | "md"; width: number };
const VARIANTS: VariantSpec[] = [
  { suffix: "sm", width: 200 },
  { suffix: "md", width: 400 }, // 26-05-08-L — reverted from 600 to ease CPU
];

// FB-6 — process cards in CHUNKS to stay well under the 150s
// Edge Function timeout. The client (Settings → Decks Optimize
// button) loops the call with the returned cursor until null.
// 9-6-S — reduced to 1. WORKER_RESOURCE_LIMIT (CPU time) was triggering
// at BATCH_SIZE=3 on oracle decks. The batch loop now uses pure
// ImageMagick (WASM) for resize/encode, which is dramatically faster
// than imagescript's JS pipeline, but a single card per invocation
// still gives the safest CPU budget.
const BATCH_SIZE = 1;

// 9-6-R — downscale source to this width immediately after decode.
// 2x our largest variant (400px) for downscale quality, but small
// enough to keep raw RGBA buffers ~MB instead of tens of MB.
const WORKING_WIDTH = 600;

// 9-6-AG — cap the working resolution for the -full.webp encode.
// The decode + applyRoundedMask + encode-PNG + re-encode-WebP chain
// at full source resolution (often 2000+ px) was burning the entire
// 2s edge-function CPU quota and tripping CPU_TIME_EXCEEDED on bulk
// imports. 1500px keeps the result indistinguishable from full-res
// for typical card display sizes (max ~800-1200 px) while cutting
// CPU work by ~4x.
// 26-05-08-J — bumped from 1500 to 2000. Background queue processes
// 1-2 cards per 30s tick so the extra CPU is well within budget.
// 26-05-08-K — reverted from 2000; 2000 was too aggressive for CPU budget.
const FULL_WIDTH_CAP = 1500;

function variantPathFor(originalPath: string, suffix: "sm" | "md"): string | null {
  // Match `<...>/card-N-TS(-thumb)?.<ext>` and replace the filename.
  const m = originalPath.match(
    /^(.*\/card-\d+-\d+)(?:-thumb|-full)?\.(?:webp|png|jpe?g)$/i,
  );
  if (!m) return null;
  // 9-6-W — variants are now WebP with rounded alpha mask baked in.
  return `${m[1]}-${suffix}.webp`;
}

// FD-3 — alpha WebP variant. Same filename stem, `-full.webp`.
function fullWebpPathFor(originalPath: string): string | null {
  const m = originalPath.match(
    /^(.*\/card-\d+-\d+)(?:-thumb)?\.(?:webp|png|jpe?g)$/i,
  );
  if (!m) return null;
  return `${m[1]}-full.webp`;
}

/**
 * FD-3 — apply a rounded-corner alpha mask in-place. Pixels in the
 * 4 corner regions outside the rounded path get alpha=0; everything
 * else is preserved. `radiusPercent` is the % of the SHORTER side
 * (matches the client/Canvas convention used in deck import).
 */
function applyRoundedMask(img: Image, radiusPercent: number): void {
  const w = img.width;
  const h = img.height;
  const r = Math.max(0, Math.min(
    Math.floor(Math.min(w, h) / 2),
    Math.round((Math.min(w, h) * radiusPercent) / 100),
  ));
  if (r <= 0) return;
  const r2 = r * r;
  // Corner centers (where the rounded arc is centered).
  const corners: { cx: number; cy: number; xStart: number; xEnd: number; yStart: number; yEnd: number }[] = [
    { cx: r,     cy: r,     xStart: 0,     xEnd: r, yStart: 0,     yEnd: r }, // TL
    { cx: w - r, cy: r,     xStart: w - r, xEnd: w, yStart: 0,     yEnd: r }, // TR
    { cx: r,     cy: h - r, xStart: 0,     xEnd: r, yStart: h - r, yEnd: h }, // BL
    { cx: w - r, cy: h - r, xStart: w - r, xEnd: w, yStart: h - r, yEnd: h }, // BR
  ];
  for (const c of corners) {
    for (let y = c.yStart; y < c.yEnd; y++) {
      for (let x = c.xStart; x < c.xEnd; x++) {
        const dx = x - c.cx;
        const dy = y - c.cy;
        if (dx * dx + dy * dy > r2) {
          // imagescript pixels are RGBA packed into a Uint32. We use
          // setPixelAt to overwrite alpha=0 cleanly.
          img.setPixelAt(x + 1, y + 1, 0x00000000);
        }
      }
    }
  }
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 9-6-AH — server-to-server invocation from the background
    // queue (process-variant-queue) authenticates with the service-
    // role key and supplies the row's user_id via x-queue-user-id.
    // Otherwise we identify the caller from a user JWT.
    const queueInternal = req.headers.get("x-queue-internal") === "1";
    const queueUserId = req.headers.get("x-queue-user-id") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    // 26-05-08-J — string-compare against the env service key was
    // brittle (whitespace / env-mismatch); decode the JWT payload and
    // accept any token whose role is service_role. The platform's
    // verify_jwt=true already validates the signature upstream.
    function isServiceRoleJwt(t: string): boolean {
      try {
        const parts = t.split(".");
        if (parts.length !== 3) return false;
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = (4 - (b64.length % 4)) % 4;
        const json = JSON.parse(atob(b64 + "=".repeat(pad)));
        return json?.role === "service_role";
      } catch {
        return false;
      }
    }
    let userId: string;
    if (queueInternal && isServiceRoleJwt(jwt) && queueUserId) {
      userId = queueUserId;
    } else {
      if (!jwt) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userData, error: userErr } =
        await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const deckId = typeof body?.deckId === "string" ? body.deckId : null;
    // FD-3 — if cardId is supplied we run the single-card pipeline
    // (which also bakes a rounded WebP variant). Otherwise the
    // existing chunked sm/md backfill runs.
    const singleCardId =
      typeof body?.cardId === "number" && Number.isFinite(body.cardId)
        ? Math.floor(body.cardId)
        : null;
    // 9-5-H — process the deck card back image (apply rounded mask).
    const processBack = body?.processBack === true;
    // FB-6 — chunk cursor (0-indexed offset into the card list).
    const cursor =
      typeof body?.cursor === "number" && Number.isFinite(body.cursor)
        ? Math.max(0, Math.floor(body.cursor))
        : 0;
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
      .select(
        "id, user_id, corner_radius_percent, card_back_path",
      )
      .eq("id", deckId)
      .maybeSingle();
    if (deckErr || !deck || deck.user_id !== userId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ----------------------------------------------------------------
    // 9-5-H — card back mode: bake the deck-level corner radius into
    // custom_decks.card_back_path so the back matches the faces.
    // ----------------------------------------------------------------
    if (processBack && singleCardId === null) {
      const backPath = (deck as { card_back_path?: string | null })
        .card_back_path;
      if (!backPath) {
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "no card_back_path" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const radius =
        typeof (deck as { corner_radius_percent?: number })
          .corner_radius_percent === "number"
          ? (deck as { corner_radius_percent: number }).corner_radius_percent
          : 0;
      try {
        const dl = await admin.storage.from(BUCKET).download(backPath);
        if (dl.error || !dl.data) throw dl.error ?? new Error("download failed");
        const bytes = new Uint8Array(await dl.data.arrayBuffer());
        const decoded = await decodeAny(bytes);
        // 9-6-AG — downscale before mask + encode to stay under CPU quota.
        const full = decoded.width > FULL_WIDTH_CAP
          ? decoded.clone().resize(
              FULL_WIDTH_CAP,
              Math.max(1, Math.round(decoded.height * (FULL_WIDTH_CAP / decoded.width))),
            )
          : decoded.clone();
        applyRoundedMask(full, radius);
        const fullPng = await full.encode();
        let fullPath = fullWebpPathFor(backPath);
        if (!fullPath) throw new Error("unrecognized back path layout");
        let fullBytes: Uint8Array;
        let fullContentType = "image/webp";
        try {
          await ensureMagick();
          fullBytes = await new Promise<Uint8Array>((resolve, reject) => {
            try {
              ImageMagick.read(fullPng, (img) => {
                img.write(MagickFormat.Webp, (data) => {
                  resolve(new Uint8Array(data));
                });
              });
            } catch (e) {
              reject(e);
            }
          });
        } catch (e) {
          console.error(
            "[generate-deck-variants] back WebP encode failed; falling back to PNG",
            {
              error: e instanceof Error ? e.message : String(e),
              stack: e instanceof Error ? e.stack : undefined,
            },
          );
          fullBytes = fullPng;
          fullContentType = "image/png";
          // 9-6-AF — write PNG bytes to a .png path so Chrome ORB
          // doesn't block the response on extension/content mismatch.
          fullPath = fullPath.replace(/\.webp$/, ".png");
        }
        const upFull = await admin.storage.from(BUCKET).upload(
          fullPath,
          fullBytes,
          { contentType: fullContentType, upsert: true },
        );
        if (upFull.error) throw upFull.error;
        if (fullContentType === "image/png") {
          await admin.storage
            .from(BUCKET)
            .remove([fullPath.replace(/\.png$/, ".webp")])
            .catch(() => {});
        }
        await admin
          .from("custom_decks")
          .update({ card_back_path: fullPath })
          .eq("id", deckId);
        return new Response(
          JSON.stringify({ ok: true, mode: "back", fullPath }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (err) {
        console.error("[generate-deck-variants] back processing failed", err);
        return new Response(
          JSON.stringify({
            ok: false,
            mode: "back",
            error: err instanceof Error ? err.message : String(err),
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // ----------------------------------------------------------------
    // FD-3 — single-card mode
    // ----------------------------------------------------------------
    if (singleCardId !== null) {
      const { data: row, error: rowErr } = await admin
        .from("custom_deck_cards")
        .select("id, card_id, display_path, original_path, corner_radius_percent")
        .eq("deck_id", deckId)
        .eq("card_id", singleCardId)
        .is("archived_at", null)
        .maybeSingle();
      if (rowErr || !row) {
        return new Response(JSON.stringify({ error: "card_not_found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // FD-6 — always read from the original (preserved) source if we
      // have one; otherwise the current display_path IS the original
      // and we record that fact for future re-edits.
      const sourcePath = row.original_path ?? row.display_path;
      if (!sourcePath) {
        return new Response(JSON.stringify({ error: "no_source_image" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const radius =
        typeof row.corner_radius_percent === "number"
          ? row.corner_radius_percent
          : (deck as { corner_radius_percent?: number }).corner_radius_percent ?? 0;

      // FG-1 — named-step error reporting so the client (and logs)
      // can pinpoint exactly where the single-card pipeline fails.
      let step = "start";
      let usedFallbackPng = false;
      const tStart = Date.now();
      console.log(`[gdv] start cardId=${row.card_id} deckId=${deckId} radius=${radius}`);
      try {
        step = "download_source";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        const dl = await admin.storage.from(BUCKET).download(sourcePath);
        if (dl.error || !dl.data) throw dl.error ?? new Error("download failed");

        step = "decode_source";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        const bytes = new Uint8Array(await dl.data.arrayBuffer());
        const decoded = await decodeAny(bytes);

        step = "prepare_full";
        console.log(`[gdv] step=${step} cardId=${row.card_id} srcW=${decoded.width}`);
        // 9-6-AG — downscale to FULL_WIDTH_CAP BEFORE mask + encode.
        // This is the single biggest CPU win: avoids running the
        // pixel-walk mask and PNG encode on 2000-3000 px sources.
        const full = decoded.width > FULL_WIDTH_CAP
          ? decoded.clone().resize(
              FULL_WIDTH_CAP,
              Math.max(1, Math.round(decoded.height * (FULL_WIDTH_CAP / decoded.width))),
            )
          : decoded.clone();
        applyRoundedMask(full, radius);

        step = "encode_png";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        const fullPng = await full.encode();

        // FG-1 — try WebP via imagemagick; fall back to PNG bytes
        // (still alpha-correct) under a .webp filename if the WebP
        // encoder is missing or throws on this Magick build.
        step = "reencode_webp";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        let fullBytes: Uint8Array;
        let fullContentType = "image/webp";
        try {
          await ensureMagick();
          fullBytes = await new Promise<Uint8Array>((resolve, reject) => {
            try {
              ImageMagick.read(fullPng, (img) => {
                img.write(MagickFormat.Webp, (data) => {
                  resolve(new Uint8Array(data));
                });
              });
            } catch (e) {
              reject(e);
            }
          });
        } catch (webpErr) {
          console.error(
            "[generate-deck-variants] single-card WebP encode failed; falling back to PNG",
            {
              cardId: row.card_id,
              error: webpErr instanceof Error ? webpErr.message : String(webpErr),
              stack: webpErr instanceof Error ? webpErr.stack : undefined,
            },
          );
          usedFallbackPng = true;
          fullBytes = fullPng;
          fullContentType = "image/png";
        }

        step = "resolve_full_path";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        let fullPath = fullWebpPathFor(row.display_path ?? sourcePath);
        if (!fullPath) throw new Error("unrecognized path layout");
        // 9-6-AF — when the WebP encoder failed and we're uploading raw
        // PNG bytes, write to a `.png` path. Chrome's Opaque Response
        // Blocking refuses to render `image/png` bytes served from a
        // `.webp` URL, which broke EVERY image after import.
        if (fullContentType === "image/png") {
          fullPath = fullPath.replace(/\.webp$/, ".png");
        }

        step = "upload_full";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        const upFull = await admin.storage.from(BUCKET).upload(
          fullPath,
          fullBytes,
          { contentType: fullContentType, upsert: true },
        );
        if (upFull.error) throw upFull.error;
        if (fullContentType === "image/png") {
          // Remove any stale .webp sibling from a previous run.
          await admin.storage
            .from(BUCKET)
            .remove([fullPath.replace(/\.png$/, ".webp")])
            .catch(() => {});
        }

        step = "variants";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        // 9-6-R — downscale once for variant generation. `full` (full-res
        // with mask) is still needed for the -full.webp upload above.
        const workingForVariants = decoded.width > WORKING_WIDTH
          ? decoded.clone().resize(
              WORKING_WIDTH,
              Math.max(1, Math.round(decoded.height * (WORKING_WIDTH / decoded.width))),
            )
          : decoded;
        for (const v of VARIANTS) {
          let vPath = variantPathFor(row.display_path ?? sourcePath, v.suffix);
          if (!vPath) continue;
          const ratio = v.width / workingForVariants.width;
          const targetH = Math.max(1, Math.round(workingForVariants.height * ratio));
          const small = workingForVariants.clone().resize(v.width, targetH);
          // 9-6-W — apply rounded alpha mask BEFORE encoding to WebP so
          // sm/md variants share the same rounded silhouette as -full.webp.
          if (radius > 0) applyRoundedMask(small, radius);
          const smallPng = await small.encode();
          let vBytes: Uint8Array;
          let vContentType = "image/webp";
          try {
            await ensureMagick();
            vBytes = await new Promise<Uint8Array>((resolve, reject) => {
              try {
                ImageMagick.read(smallPng, (img) => {
                  img.write(MagickFormat.Webp, (data) =>
                    resolve(new Uint8Array(data)),
                  );
                });
              } catch (e) {
                reject(e);
              }
            });
          } catch (e) {
            // 9-6-AF — same PNG fallback for sm/md variants.
            console.error(
              "[generate-deck-variants] variant WebP encode failed; falling back to PNG",
              {
                cardId: row.card_id,
                variant: v.suffix,
                error: e instanceof Error ? e.message : String(e),
              },
            );
            vBytes = smallPng;
            vContentType = "image/png";
            vPath = vPath.replace(/\.webp$/, ".png");
          }
          const upV = await admin.storage.from(BUCKET).upload(
            vPath,
            vBytes,
            { contentType: vContentType, upsert: true },
          );
          if (upV.error) throw upV.error;
          // 9-6-W / 9-6-AF — best-effort cleanup of stale siblings.
          await admin.storage
            .from(BUCKET)
            .remove([
              vPath.replace(/\.(webp|png)$/, ".jpg"),
              vContentType === "image/png"
                ? vPath.replace(/\.png$/, ".webp")
                : vPath.replace(/\.webp$/, ".png"),
            ])
            .catch(() => {});
        }

        step = "db_update";
        console.log(`[gdv] step=${step} cardId=${row.card_id}`);
        const patch: Record<string, unknown> = {
          processing_status: "saved",
          processed_at: new Date().toISOString(),
          corner_radius_percent: radius,
          display_path: fullPath,
        };
        if (!row.original_path && row.display_path) {
          patch.original_path = row.display_path;
        }
        const { error: updErr } = await admin
          .from("custom_deck_cards")
          .update(patch)
          .eq("id", row.id);
        if (updErr) throw updErr;

        console.log(`[gdv] success cardId=${row.card_id} elapsedMs=${Date.now() - tStart}`);
        return new Response(
          JSON.stringify({
            ok: true,
            mode: "single",
            cardId: row.card_id,
            radius,
            fullPath,
            usedFallbackPng,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (err) {
        console.error(
          `[generate-deck-variants] single-card failed at step '${step}'`,
          err,
        );
        await admin
          .from("custom_deck_cards")
          .update({ processing_status: "failed" })
          .eq("id", row.id);
        return new Response(
          JSON.stringify({
            ok: false,
            mode: "single",
            cardId: singleCardId,
            step,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // 4) List active cards for the deck.
    const { data: cards, error: cardsErr } = await admin
      .from("custom_deck_cards")
      .select("id, card_id, display_path, original_path, corner_radius_percent")
      .eq("deck_id", deckId)
      .is("archived_at", null)
      .order("card_id", { ascending: true });
    if (cardsErr) {
      return new Response(JSON.stringify({ error: cardsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FB-6 — slice this invocation's batch off the full list.
    const allCards = (cards ?? []) as (CardRow & {
      id?: string;
      original_path?: string | null;
    })[];
    const totalCards = allCards.length;
    const batch = allCards.slice(cursor, cursor + BATCH_SIZE);

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: { card_id: number; reason: string }[] = [];

    for (const c of batch) {
      if (!c.display_path) {
        skipped++;
        continue;
      }
      let sourceBytes: Uint8Array | null = null;
      let decodedSource: Image | null = null;
      try {
        // 9-6-Y — batch mode reverted to sm/md ONLY. -full.webp is
        // generated via the single-card pass orchestrated client-side
        // to avoid OOM (worker memory ~256MB).
        let bothExist = true;
        for (const v of VARIANTS) {
          const variantPath = variantPathFor(c.display_path, v.suffix);
          if (!variantPath) { bothExist = false; break; }
          const dir = variantPath.substring(0, variantPath.lastIndexOf("/"));
          const filename = variantPath.substring(variantPath.lastIndexOf("/") + 1);
          const { data: existing } = await admin.storage
            .from(BUCKET)
            .list(dir, { limit: 100, search: filename });
          if (!(existing ?? []).some((row) => row.name === filename)) {
            bothExist = false;
            break;
          }
        }
        if (bothExist) {
          skipped += VARIANTS.length;
          continue;
        }
        // 9-6-W — per-card override falls back to deck-level radius.
        const radius =
          typeof c.corner_radius_percent === "number"
            ? c.corner_radius_percent
            : (deck as { corner_radius_percent?: number }).corner_radius_percent ?? 0;

        // Source download + decode happens at most once per card.
        const ensureSource = async () => {
          if (decodedSource) return;
          const sourcePath = c.original_path ?? c.display_path!;
          const dl = await admin.storage.from(BUCKET).download(sourcePath);
          if (dl.error || !dl.data) {
            throw dl.error ?? new Error("download failed");
          }
          sourceBytes = new Uint8Array(await dl.data.arrayBuffer());
          await ensureMagick();
          decodedSource = await decodeAny(sourceBytes);
        };

        for (const v of VARIANTS) {
          let variantPath = variantPathFor(c.display_path, v.suffix);
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

          await ensureSource();

          // 9-6-W — resize via imagescript, apply rounded alpha mask,
          // then re-encode through ImageMagick for WebP (preserves alpha).
          // 9-6-AG — work from a downscaled buffer (matches WORKING_WIDTH
          // logic in single-card mode) to keep CPU well under budget.
          const srcForBatch = decodedSource!.width > WORKING_WIDTH
            ? decodedSource!.clone().resize(
                WORKING_WIDTH,
                Math.max(1, Math.round(decodedSource!.height * (WORKING_WIDTH / decodedSource!.width))),
              )
            : decodedSource!;
          const ratio = v.width / srcForBatch.width;
          const targetH = Math.max(1, Math.round(srcForBatch.height * ratio));
          const resized = srcForBatch.clone().resize(v.width, targetH);
          if (radius > 0) applyRoundedMask(resized, radius);
          const png = await resized.encode();
          let outBytes: Uint8Array;
          let outContentType = "image/webp";
          try {
            outBytes = await new Promise<Uint8Array>((resolve, reject) => {
              try {
                ImageMagick.read(png, (img) => {
                  img.write(MagickFormat.Webp, (data) =>
                    resolve(new Uint8Array(data)),
                  );
                });
              } catch (e) {
                reject(e);
              }
            });
          } catch (e) {
            // 9-6-AF — PNG fallback for batch-mode variants.
            console.error(
              "[generate-deck-variants] batch variant WebP encode failed; falling back to PNG",
              {
                cardId: c.card_id,
                variant: v.suffix,
                error: e instanceof Error ? e.message : String(e),
              },
            );
            outBytes = png;
            outContentType = "image/png";
            variantPath = variantPath.replace(/\.webp$/, ".png");
          }

          const up = await admin.storage
            .from(BUCKET)
            .upload(variantPath, outBytes, {
              contentType: outContentType,
              upsert: true,
            });
          if (up.error) throw up.error;
          await admin.storage
            .from(BUCKET)
            .remove([
              variantPath.replace(/\.(webp|png)$/, ".jpg"),
              outContentType === "image/png"
                ? variantPath.replace(/\.png$/, ".webp")
                : variantPath.replace(/\.webp$/, ".png"),
            ])
            .catch(() => {});
          generated++;
        }
      } catch (err) {
        failed++;
        const reason = err instanceof Error ? err.message : String(err);
        errors.push({ card_id: c.card_id, reason });
        console.error(
          `[generate-deck-variants] card ${c.card_id} failed:`,
          reason,
        );
      } finally {
        // 9-6-S — drop reference to source bytes so they're GC-eligible.
        sourceBytes = null;
        decodedSource = null;
      }
    }

    const processed = cursor + batch.length;
    const nextCursor = processed < totalCards ? processed : null;

    return new Response(
      JSON.stringify({
        ok: true,
        deckId,
        cardCount: totalCards,
        totalCards,
        processed,
        nextCursor,
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