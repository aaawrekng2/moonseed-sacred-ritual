/**
 * Atomic Save commit for the deck-import wizard (Stamp BJ Fix 6).
 *
 * "Save deck" is the only path that writes to Supabase or modifies
 * `custom_deck_cards`. The wizard never writes to the database.
 *
 * Flow:
 *   1. Wait for any in-flight encoding to finish.
 *   2. For every assigned slot with an existing active row, archive it
 *      (set archived_at = now()).
 *   3. Upload encoded display + thumbnail blobs to Supabase storage.
 *   4. Insert new custom_deck_cards rows with source='imported'.
 *   5. If 'BACK' is assigned, update custom_decks.card_back_url.
 *   6. Delete the IndexedDB session.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  BACK_KEY,
  deleteSession,
  type EncodedAsset,
  type ImportSession,
} from "./import-session";
import { EncodingQueue, encodeOne, type ProcessOpts } from "./deck-image-pipeline";

const DECK_BUCKET = "custom-deck-images";

export type CommitResult = {
  ok: boolean;
  /** Per-slot upload errors. Successful uploads are not rolled back. */
  failedCardIds: number[];
  cardBackFailed: boolean;
  /** Number of card slots successfully written. */
  written: number;
};

/**
 * Resolve the encoded asset for a given session entry. If encoding
 * never completed (or failed), encode synchronously here so commit
 * still produces a valid asset. Returns null only if the raw blob
 * itself is unusable (e.g. synthetic existing-row marker — those are
 * handled separately upstream).
 */
async function resolveEncoded(
  session: ImportSession,
  imageKey: string,
  opts: ProcessOpts,
): Promise<EncodedAsset | null> {
  const cached = session.encoded[imageKey];
  if (cached) return cached;
  const img = session.unassigned[imageKey] ?? session.skipped[imageKey];
  if (!img || img.existingUrl) return null;
  try {
    return await encodeOne(imageKey, img.rawBlob, opts);
  } catch (e) {
    console.warn("[deck-import-commit] sync encode failed", imageKey, e);
    return null;
  }
}

async function uploadAsset(
  asset: EncodedAsset,
  userId: string,
  deckId: string,
  cardId: number | "BACK",
): Promise<{ display_url: string; display_path: string; thumbnail_url: string; thumbnail_path: string }> {
  const ts = Date.now();
  const slot = cardId === "BACK" ? "back" : `card-${cardId}`;
  const displayPath = `${userId}/${deckId}/${slot}-${ts}.webp`;
  const thumbPath = `${userId}/${deckId}/${slot}-${ts}-thumb.webp`;

  const { error: e1 } = await supabase.storage
    .from(DECK_BUCKET)
    .upload(displayPath, asset.displayBlob, { contentType: "image/webp", upsert: true });
  if (e1) throw e1;
  const { error: e2 } = await supabase.storage
    .from(DECK_BUCKET)
    .upload(thumbPath, asset.thumbnailBlob, { contentType: "image/webp", upsert: true });
  if (e2) throw e2;

  const yearSecs = 60 * 60 * 24 * 365;
  const [{ data: d1 }, { data: d2 }] = await Promise.all([
    supabase.storage.from(DECK_BUCKET).createSignedUrl(displayPath, yearSecs),
    supabase.storage.from(DECK_BUCKET).createSignedUrl(thumbPath, yearSecs),
  ]);
  return {
    display_url: d1?.signedUrl ?? "",
    display_path: displayPath,
    thumbnail_url: d2?.signedUrl ?? d1?.signedUrl ?? "",
    thumbnail_path: thumbPath,
  };
}

export async function commitImportSession(args: {
  session: ImportSession;
  userId: string;
  deckId: string;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  queue?: EncodingQueue;
  /** When true, delete the IndexedDB session after a successful (or
   *  fully-attempted) commit. Defaults to true to preserve old
   *  behavior. The wizard passes false for "Save and continue later". */
  deleteSessionAfter?: boolean;
}): Promise<CommitResult> {
  const {
    session,
    userId,
    deckId,
    shape,
    cornerRadiusPercent,
    queue,
    deleteSessionAfter = true,
  } = args;
  const opts: ProcessOpts = { shape, cornerRadiusPercent };

  // BQ Fix 4B — diagnostic timing.
  console.time("commit_total");
  // 1. Drain any in-flight encoding.
  console.time("commit_drain");
  if (queue) await queue.drain();
  console.timeEnd("commit_drain");

  // Build the work list. Skip 'EXISTING:*' assignments — those represent
  // existing custom_deck_cards rows that don't need to be re-uploaded.
  type Work = { cardId: number | "BACK"; imageKey: string };
  const work: Work[] = [];
  for (const [slot, key] of Object.entries(session.assigned)) {
    if (key.startsWith("EXISTING:")) continue;
    if (slot === BACK_KEY) work.push({ cardId: "BACK", imageKey: key });
    else work.push({ cardId: Number(slot), imageKey: key });
  }

  // Card slots that need their existing active row archived: any
  // numeric assignment AND any existing slot the user explicitly
  // un-assigned (assignments that previously held EXISTING:n but no
  // longer appear). The wizard models the latter via a synthetic
  // 'archive intent' on commit; we collect every numeric slot that
  // currently has a custom_deck_cards row and is NOT in session.assigned.
  const numericSlots = new Set<number>();
  for (const slot of Object.keys(session.assigned)) {
    if (slot !== BACK_KEY) numericSlots.add(Number(slot));
  }

  // Re-archive every slot we're about to write to.
  if (numericSlots.size > 0) {
    const slots = Array.from(numericSlots);
    const { error } = await supabase
      .from("custom_deck_cards")
      .update({ archived_at: new Date().toISOString() })
      .eq("deck_id", deckId)
      .is("archived_at", null)
      .in("card_id", slots);
    if (error) {
      console.error("[deck-import-commit] archive failed", error);
      throw error;
    }
  }

  // 2. Upload + insert per-slot.
  const failedCardIds: number[] = [];
  let cardBackFailed = false;
  let written = 0;

  for (const w of work) {
    const tag = `commit_card_${w.cardId}`;
    console.time(tag);
    try {
      const asset = await resolveEncoded(session, w.imageKey, opts);
      if (!asset) {
        console.error("[BX-save] FAIL no-asset", {
          cardId: w.cardId,
          imageKey: w.imageKey,
        });
        if (w.cardId === "BACK") cardBackFailed = true;
        else failedCardIds.push(w.cardId);
        console.timeEnd(tag);
        continue;
      }
      const uploaded = await uploadAsset(asset, userId, deckId, w.cardId);
      if (w.cardId === "BACK") {
        const { error } = await supabase
          .from("custom_decks")
          .update({
            card_back_url: uploaded.display_url,
            card_back_thumb_url: uploaded.thumbnail_url,
          })
          .eq("id", deckId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("custom_deck_cards").insert({
          deck_id: deckId,
          user_id: userId,
          card_id: w.cardId,
          display_url: uploaded.display_url,
          thumbnail_url: uploaded.thumbnail_url,
          display_path: uploaded.display_path,
          thumbnail_path: uploaded.thumbnail_path,
          source: "imported",
        });
        if (error) throw error;
      }
      written++;
      console.log("[BX-save] OK", {
        cardId: w.cardId,
        imageKey: w.imageKey,
        written,
      });
    } catch (err) {
      console.error("[BX-save] FAIL", {
        cardId: w.cardId,
        imageKey: w.imageKey,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (w.cardId === "BACK") cardBackFailed = true;
      else failedCardIds.push(w.cardId);
    }
    console.timeEnd(tag);
  }

  if (failedCardIds.length === 0 && !cardBackFailed) {
    if (deleteSessionAfter) await deleteSession(deckId);
    console.timeEnd("commit_total");
    return { ok: true, failedCardIds, cardBackFailed, written };
  }

  // Partial failure — keep the session so the user can retry.
  console.timeEnd("commit_total");
  return { ok: false, failedCardIds, cardBackFailed, written };
}