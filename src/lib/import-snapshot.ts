/**
 * Snapshot-undo for the deck-import wizard (Stamp CB, Group 4).
 *
 * Per-card autosave means that by the time a user has dropped 30 cards
 * from a wrong zip, those rows are already in Supabase. "Discard
 * import" must therefore mean *roll back* — restore the deck to the
 * exact set of `custom_deck_cards` rows (and `card_back_url`) that
 * existed when the workspace opened.
 *
 * Snapshots are device-local IndexedDB blobs, matching the existing
 * import-session pattern. They are captured the moment the user enters
 * the workspace with a fresh zip and consumed only on Discard.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchDeckCards, type CustomDeckCard } from "./custom-decks";
import { makeLimiter, DEFAULT_LIMIT } from "./per-card-save";

const DB_NAME = "moonseed_import_snapshots";
const DB_VERSION = 1;
const STORE = "snapshots";
const KEY_PREFIX = "import_snapshot_";

export type SlotSnapshot = {
  card_id: number;
  display_url: string;
  thumbnail_url: string;
  display_path: string;
  thumbnail_path: string;
  source: string;
};

export type ImportSnapshot = {
  deckId: string;
  takenAt: number;
  cardBackUrl: string | null;
  cardBackThumbUrl: string | null;
  /** card_id -> snapshot row. Slots not present here had no active row. */
  slots: Record<number, SlotSnapshot>;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

const keyFor = (deckId: string) => KEY_PREFIX + deckId;

export async function getSnapshot(deckId: string): Promise<ImportSnapshot | null> {
  if (!isBrowser()) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(keyFor(deckId));
    req.onsuccess = () => resolve((req.result as ImportSnapshot | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putSnapshot(snap: ImportSnapshot): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(snap, keyFor(snap.deckId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSnapshot(deckId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(keyFor(deckId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Capture the deck's current active rows + card back. Idempotent for
 * the same workspace session — once a snapshot exists for a deck we
 * keep the original until it is consumed (discard) or the user closes
 * cleanly (handled by the caller).
 */
export async function captureSnapshotIfMissing(deckId: string): Promise<ImportSnapshot> {
  const existing = await getSnapshot(deckId);
  if (existing) return existing;
  const cards: CustomDeckCard[] = await fetchDeckCards(deckId);
  const { data: deckRow } = await supabase
    .from("custom_decks")
    .select("card_back_url, card_back_thumb_url")
    .eq("id", deckId)
    .maybeSingle();
  const slots: Record<number, SlotSnapshot> = {};
  for (const c of cards) {
    slots[c.card_id] = {
      card_id: c.card_id,
      display_url: c.display_url,
      thumbnail_url: c.thumbnail_url,
      display_path: c.display_path,
      thumbnail_path: c.thumbnail_path,
      source: c.source ?? "imported",
    };
  }
  const snap: ImportSnapshot = {
    deckId,
    takenAt: Date.now(),
    cardBackUrl: (deckRow?.card_back_url as string | null | undefined) ?? null,
    cardBackThumbUrl: (deckRow?.card_back_thumb_url as string | null | undefined) ?? null,
    slots,
  };
  await putSnapshot(snap);
  return snap;
}

/**
 * Restore the deck to the snapshot. For each of the 78 slots:
 *   - If the snapshot has a row, archive whatever's active and insert a
 *     copy of the snapshot row (re-using the same storage paths/URLs).
 *   - If the snapshot had no row, archive the active row (if any).
 * Card back is set back to the snapshot's URL.
 */
export async function restoreSnapshot(args: {
  userId: string;
  deckId: string;
  snapshot: ImportSnapshot;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ ok: boolean; failed: number[] }> {
  const { userId, deckId, snapshot, onProgress } = args;
  const limit = makeLimiter(DEFAULT_LIMIT);
  const failed: number[] = [];
  let done = 0;
  const total = 78 + 1; // +1 for back

  const tasks: Array<Promise<void>> = [];
  for (let i = 0; i < 78; i++) {
    tasks.push(
      limit(async () => {
        try {
          const snap = snapshot.slots[i];
          // Always archive any active row first.
          const { error: archErr } = await supabase
            .from("custom_deck_cards")
            .update({ archived_at: new Date().toISOString() })
            .eq("deck_id", deckId)
            .eq("card_id", i)
            .is("archived_at", null);
          if (archErr) throw archErr;
          if (snap) {
            const { error: insErr } = await supabase
              .from("custom_deck_cards")
              .insert({
                deck_id: deckId,
                user_id: userId,
                card_id: i,
                display_url: snap.display_url,
                thumbnail_url: snap.thumbnail_url,
                display_path: snap.display_path,
                thumbnail_path: snap.thumbnail_path,
                source: snap.source as "photographed" | "imported" | "default",
              });
            if (insErr) throw insErr;
          }
        } catch (err) {
          console.error("[CB-restore] slot fail", i, err);
          failed.push(i);
        } finally {
          done++;
          onProgress?.(done, total);
        }
      }),
    );
  }
  // Restore card back.
  tasks.push(
    limit(async () => {
      try {
        const { error } = await supabase
          .from("custom_decks")
          .update({
            card_back_url: snapshot.cardBackUrl,
            card_back_thumb_url: snapshot.cardBackThumbUrl,
          })
          .eq("id", deckId);
        if (error) throw error;
      } catch (err) {
        console.error("[CB-restore] back fail", err);
        failed.push(-1);
      } finally {
        done++;
        onProgress?.(done, total);
      }
    }),
  );
  await Promise.all(tasks);
  return { ok: failed.length === 0, failed };
}