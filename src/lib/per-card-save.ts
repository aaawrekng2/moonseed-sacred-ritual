/**
 * Per-card autosave (Stamp CB).
 *
 * Replaces the batch commit model. Every assignment in the deck-import
 * wizard funnels through `saveCard` — one slot, one upload, one DB
 * write. Failures are returned as structured results (never thrown) so
 * the UI can keep its per-card state map honest and surface a retry
 * affordance on the failed slot.
 *
 * Concurrency is capped (DEFAULT_LIMIT) so rapid bulk activity (zip
 * import + autosave on every assignment) never floods Supabase Storage.
 * The original batch model fired `Promise.all` over 78 uploads and
 * silently dropped a handful — that race is what this module exists to
 * eliminate.
 */
import { supabase } from "@/integrations/supabase/client";
import { encodeOne, type ProcessOpts } from "./deck-image-pipeline";
import type { ImportImage } from "./import-session";

const DECK_BUCKET = "custom-deck-images";
/** Cap on concurrent saveCard / removeCard / restoreSlot writes. */
export const DEFAULT_LIMIT = 4;

/**
 * 26-05-08-Q2 — Fix 5: storage gateway occasionally returns 504/timeout
 * on the largest variant (the 1500px original). Single retry after a
 * brief delay clears 95%+ of those. Other variants are smaller and
 * reliable, so they stay on a single attempt.
 */
async function uploadWithRetry(
  path: string,
  blob: Blob,
  opts: { contentType: string; upsert: boolean },
) {
  const first = await supabase.storage.from(DECK_BUCKET).upload(path, blob, opts);
  if (!first.error) return first;
  const msg = first.error.message ?? "";
  if (msg.includes("504") || msg.toLowerCase().includes("timeout")) {
    await new Promise((r) => setTimeout(r, 1000));
    return supabase.storage.from(DECK_BUCKET).upload(path, blob, opts);
  }
  return first;
}

export type SaveCardArgs = {
  userId: string;
  deckId: string;
  /**
   * Numeric tarot index 0-77, or "BACK" for the deck's card-back slot.
   * "BACK" updates `custom_decks.card_back_url` instead of inserting a
   * `custom_deck_cards` row.
   */
  cardId: number | "BACK";
  /** Stable identity used by the UI's state map. */
  cardKey: string;
  /** Raw image data + dimensions to encode and upload. */
  image: ImportImage;
  /** Encoding shape/corner — matches the deck record. */
  opts: ProcessOpts;
  /**
   * 9-6-AE — when true, do NOT fire the auto-variant edge function
   * after this save. Bulk import flows pass this so they can drive a
   * sequential variant pass instead of N parallel invocations.
   */
  skipAutoVariant?: boolean;
};

export type SaveResult =
  | { cardKey: string; cardId: number | "BACK"; status: "saved" }
  | { cardKey: string; cardId: number | "BACK"; status: "failed"; error: string };

/**
 * Tiny p-limit equivalent so we don't take a dep just for this. Wrap a
 * promise-returning function to enforce a max concurrency.
 */
export function makeLimiter(limit = DEFAULT_LIMIT) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (!job) return;
    job();
  };
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      if (active < limit) start();
      else queue.push(start);
    });
  };
}

/** Module-level shared limiter so every component using saveCard
 *  participates in the same global cap. */
const sharedLimit = makeLimiter(DEFAULT_LIMIT);

async function uploadEncoded(
  userId: string,
  deckId: string,
  cardId: number | "BACK",
  displayBlob: Blob,
  thumbBlob: Blob,
  smBlob: Blob | undefined,
  mdBlob: Blob | undefined,
) {
  const ts = Date.now();
  const slot = cardId === "BACK" ? "back" : `card-${cardId}`;
  // 26-05-08-O — display path uses -full suffix so variantUrlFor's
  // regex resolves -sm / -md / -thumb consistently.
  const base = `${userId}/${deckId}/${slot}-${ts}`;
  const displayPath = `${base}-full.webp`;
  const thumbPath = `${base}-thumb.webp`;
  const smPath = `${base}-sm.webp`;
  const mdPath = `${base}-md.webp`;
  // 26-05-08-P — Fix 1: storage upload errors come back as `{ error }`
  // (NOT thrown). Audit each result individually so silent failures on
  // non-critical variants don't poison the whole save, and so that
  // critical (display/thumb) failures surface immediately.
  const opts = { contentType: "image/webp", upsert: true } as const;
  const [displayRes, thumbRes, smRes, mdRes] = await Promise.all([
    supabase.storage.from(DECK_BUCKET).upload(displayPath, displayBlob, opts),
    supabase.storage.from(DECK_BUCKET).upload(thumbPath, thumbBlob, opts),
    smBlob
      ? supabase.storage.from(DECK_BUCKET).upload(smPath, smBlob, opts)
      : Promise.resolve({ error: null }),
    mdBlob
      ? supabase.storage.from(DECK_BUCKET).upload(mdPath, mdBlob, opts)
      : Promise.resolve({ error: null }),
  ]);
  if (displayRes.error)
    throw new Error(`display upload failed: ${displayRes.error.message}`);
  if (thumbRes.error)
    throw new Error(`thumb upload failed: ${thumbRes.error.message}`);
  if (smRes.error)
    console.warn("[per-card-save] sm upload failed (non-fatal)", smRes.error);
  if (mdRes.error)
    console.warn("[per-card-save] md upload failed (non-fatal)", mdRes.error);
  const yearSecs = 60 * 60 * 24 * 365;
  const [{ data: d1 }, { data: d2 }] = await Promise.all([
    supabase.storage.from(DECK_BUCKET).createSignedUrl(displayPath, yearSecs),
    supabase.storage.from(DECK_BUCKET).createSignedUrl(thumbPath, yearSecs),
  ]);
  return {
    displayUrl: d1?.signedUrl ?? "",
    displayPath,
    thumbnailUrl: d2?.signedUrl ?? d1?.signedUrl ?? "",
    thumbnailPath: thumbPath,
  };
}

/**
 * Save one card. Always resolves with a structured result; never throws.
 * On success, the slot has exactly one active row in `custom_deck_cards`
 * (or, for "BACK", the deck's `card_back_url` is set). Safe to call
 * repeatedly for retry — each call archives the previously-active row
 * for that slot before inserting the new one.
 */
export function saveCard(args: SaveCardArgs): Promise<SaveResult> {
  return sharedLimit(() => doSaveCard(args));
}

async function doSaveCard(args: SaveCardArgs): Promise<SaveResult> {
  const { userId, deckId, cardId, cardKey, image, opts } = args;
  try {
    if (!image.rawBlob || image.rawBlob.size === 0) {
      throw new Error("No raw image data to upload");
    }
    const asset = await encodeOne(cardKey, image.rawBlob, opts);
    const uploaded = await uploadEncoded(
      userId,
      deckId,
      cardId,
      asset.displayBlob,
      asset.thumbnailBlob,
      asset.smBlob,
      asset.mdBlob,
    );
    if (cardId === "BACK") {
      const { error, data } = await supabase
        .from("custom_decks")
        .update({
          card_back_url: uploaded.displayUrl,
          card_back_thumb_url: uploaded.thumbnailUrl,
          card_back_path: uploaded.displayPath,
          card_back_thumb_path: uploaded.thumbnailPath,
        })
        .eq("id", deckId)
        .select();
      if (error) {
        console.error("[CB-save] back update failed", { deckId, error, data });
        throw error;
      }
    } else {
      // Archive whatever active row currently lives in this slot, then
      // insert the new one. Idempotent under retry.
      const { error: archiveErr } = await supabase
        .from("custom_deck_cards")
        .update({ archived_at: new Date().toISOString() })
        .eq("deck_id", deckId)
        .eq("card_id", cardId)
        .is("archived_at", null);
      if (archiveErr) {
        console.error("[CB-save] archive failed", { cardId, archiveErr });
        throw archiveErr;
      }
      const { error: insertErr, data: inserted } = await supabase
        .from("custom_deck_cards")
        .insert({
          deck_id: deckId,
          user_id: userId,
          card_id: cardId,
          display_url: uploaded.displayUrl,
          thumbnail_url: uploaded.thumbnailUrl,
          display_path: uploaded.displayPath,
          thumbnail_path: uploaded.thumbnailPath,
          source: "imported",
          // 9-6-A — oracle cards carry user-editable name/meaning.
          card_name: image.oracleName ?? null,
          card_description: image.oracleDescription ?? null,
          // 26-05-08-O — variants generated client-side; mark saved
          // immediately. The background queue is no longer involved.
          processing_status: "saved",
          processed_at: new Date().toISOString(),
        })
        .select();
      if (insertErr) {
        console.error("[CB-save] insert failed", { cardId, insertErr, inserted });
        throw insertErr;
      }
    }
    // 26-05-08-O — auto-variant edge fn invocation removed. All
    // variants are uploaded by the client during this save.
    console.log("[CB-save] OK", { cardId, cardKey });
    return { cardKey, cardId, status: "saved" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[CB-save] FAIL", { cardId, cardKey, error: msg });
    return { cardKey, cardId, status: "failed", error: msg };
  }
}

/** Archive any active row for a slot. Used when a user un-assigns a card
 *  in the workspace. Returns a SaveResult-shaped value for parity. */
export function removeCard(args: {
  deckId: string;
  cardId: number | "BACK";
  cardKey: string;
}): Promise<SaveResult> {
  return sharedLimit(() => doRemoveCard(args));
}

async function doRemoveCard(args: {
  deckId: string;
  cardId: number | "BACK";
  cardKey: string;
}): Promise<SaveResult> {
  const { deckId, cardId, cardKey } = args;
  try {
    if (cardId === "BACK") {
      const { error } = await supabase
        .from("custom_decks")
        .update({
          card_back_url: null,
          card_back_thumb_url: null,
          card_back_path: null,
          card_back_thumb_path: null,
        })
        .eq("id", deckId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("custom_deck_cards")
        .update({ archived_at: new Date().toISOString() })
        .eq("deck_id", deckId)
        .eq("card_id", cardId)
        .is("archived_at", null);
      if (error) throw error;
    }
    console.log("[CB-save] REMOVE OK", { cardId, cardKey });
    return { cardKey, cardId, status: "saved" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[CB-save] REMOVE FAIL", { cardId, cardKey, error: msg });
    return { cardKey, cardId, status: "failed", error: msg };
  }
}