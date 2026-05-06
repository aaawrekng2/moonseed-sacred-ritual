/**
 * IndexedDB-backed wizard session for the deck-import flow (Stamp BJ).
 *
 * The deck-import wizard is a "living" surface — users can move
 * images between unassigned / assigned / skipped freely, and the
 * database is only written when they explicitly tap Save. We persist
 * the in-flight session (including raw + encoded blobs) in IndexedDB
 * so navigation, page refresh, and even browser close don't lose
 * progress. One session per deck; multi-device collisions are out of
 * scope (last writer wins).
 */

const DB_NAME = "moonseed_import_sessions";
const DB_VERSION = 1;
const STORE = "sessions";
const KEY_PREFIX = "import_session_v1::";

/** Identifier used in `assigned` for the deck's card-back slot. */
export const BACK_KEY = "BACK";

export interface ImportImage {
  /** Stable hash: filename + size + first-128-byte hex. */
  key: string;
  filename: string;
  /** Original blob from the zip, retained so the user can re-encode. */
  rawBlob: Blob;
  width: number;
  height: number;
  /** Optional: marker for synthetic entries representing existing
   *  custom_deck_cards rows (re-import flow). When present, rawBlob
   *  is a 1x1 placeholder and `existingUrl` should be displayed. */
  existingUrl?: string;
  /** 9-6-A — oracle decks attach a user-editable name/description per
   *  card. Pre-populated from filename or sidecar CSV at import. */
  oracleName?: string;
  oracleDescription?: string;
}

export interface EncodedAsset {
  key: string;
  displayBlob: Blob;
  thumbnailBlob: Blob;
}

export interface ImportSession {
  deckId: string;
  createdAt: number;
  updatedAt: number;
  /** key → image */
  unassigned: Record<string, ImportImage>;
  /** card_id (0..77) or 'BACK' → image_key */
  assigned: Record<string, string>;
  /** key → image */
  skipped: Record<string, ImportImage>;
  /** key → encoded asset */
  encoded: Record<string, EncodedAsset>;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function openSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

function keyFor(deckId: string): string {
  return KEY_PREFIX + deckId;
}

export async function getSession(deckId: string): Promise<ImportSession | null> {
  if (!isBrowser()) return null;
  const db = await openSessionDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(keyFor(deckId));
    req.onsuccess = () => resolve((req.result as ImportSession | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(session: ImportSession): Promise<void> {
  if (!isBrowser()) return;
  session.updatedAt = Date.now();
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(session, keyFor(session.deckId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSession(deckId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(keyFor(deckId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Stale = older than `maxAgeMs`. Returns deck_ids of stale sessions. */
export async function listStaleSessions(
  maxAgeMs = 30 * 24 * 60 * 60 * 1000,
): Promise<string[]> {
  if (!isBrowser()) return [];
  const db = await openSessionDb();
  const cutoff = Date.now() - maxAgeMs;
  return await new Promise((resolve, reject) => {
    const stale: string[] = [];
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) {
        resolve(stale);
        return;
      }
      const v = cur.value as ImportSession | undefined;
      const stamp = v?.updatedAt ?? v?.createdAt ?? 0;
      if (stamp && stamp < cutoff && v?.deckId) stale.push(v.deckId);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function cleanupStaleSessions(): Promise<number> {
  if (!isBrowser()) return 0;
  try {
    const ids = await listStaleSessions();
    for (const id of ids) {
      await deleteSession(id);
    }
    return ids.length;
  } catch (err) {
    console.warn("[import-session] cleanup failed", err);
    return 0;
  }
}

/**
 * Compute a stable identity for an image. Combines filename, size, and
 * the hex of the first 128 bytes — collision-resistant enough for
 * within-deck use without dragging in a crypto library.
 */
export async function computeImageKey(
  filename: string,
  blob: Blob,
): Promise<string> {
  const head = await blob.slice(0, 128).arrayBuffer();
  const bytes = new Uint8Array(head);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${filename}|${blob.size}|${hex}`;
}

/** Throttled saver. Coalesces rapid mutations into one write per 250ms. */
export function makeThrottledSaver(deckId: string) {
  let pending: ImportSession | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(session: ImportSession) {
      pending = session;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const s = pending;
        pending = null;
        if (s) void saveSession(s).catch((e) => console.warn("[import-session] save failed", e));
      }, 250);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const s = pending;
      pending = null;
      if (s) await saveSession(s);
    },
    deckId,
  };
}

/** Quota probe — returns `null` if the API isn't available. */
export async function checkStorageQuota(): Promise<{
  availableBytes: number;
  warn: boolean;
} | null> {
  if (typeof navigator === "undefined") return null;
  if (!("storage" in navigator) || !("estimate" in navigator.storage)) return null;
  try {
    const est = await navigator.storage.estimate();
    const available = (est.quota ?? 0) - (est.usage ?? 0);
    return { availableBytes: available, warn: available < 100 * 1024 * 1024 };
  } catch {
    return null;
  }
}