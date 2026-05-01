/**
 * CJ — Backup restore.
 *
 * Reads ZIP archives produced by `createBackup` (CG/CI), validates the
 * manifest, and replays selected categories into the current user's
 * account. Conflict policy: row-merge by primary key (skip duplicates).
 * Preferences is the only category that overwrites — surfaced in the
 * UI so the user explicitly opts in.
 *
 * Premium-tier image bytes (custom deck images, reading photos) are
 * uploaded to Storage only when `isPremium` is true; metadata rows are
 * always inserted. Multi-part backups are supported: pass the parts in
 * any order — they are validated and sorted by `part_index` here.
 */
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

const DECK_BUCKET = "custom-deck-images";
const PHOTO_BUCKET = "reading-photos";
const IMAGE_CONCURRENCY = 4;

export type BackupManifestV1 = {
  app: "Moonseed";
  schema_version: 1;
  exported_at: string;
  user_id: string;
  categories: string[];
  contents: Record<string, { rows?: number; files?: number }>;
  part_index?: number;
  total_parts?: number;
};

export type CategoryRestoreResult = {
  inserted: number;
  skipped: number;
  failed: number;
  filesUploaded: number;
  filesSkippedPremium: number;
  overwrote?: boolean;
};

export type RestoreResult = {
  perCategory: Record<string, CategoryRestoreResult>;
};

const FREE_CATEGORIES = new Set([
  "readings",
  "preferences",
  "user_tags",
  "user_streaks",
  "custom_guides",
]);
const PREMIUM_CATEGORIES = new Set(["custom_decks", "reading_photos"]);

function emptyResult(): CategoryRestoreResult {
  return {
    inserted: 0,
    skipped: 0,
    failed: 0,
    filesUploaded: 0,
    filesSkippedPremium: 0,
  };
}

export async function readBackupManifest(file: File): Promise<{
  manifest: BackupManifestV1;
  zip: JSZip;
}> {
  const buf = await file.arrayBuffer();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("Invalid backup file.");
  }
  const entry = zip.file("manifest.json");
  if (!entry) throw new Error("Invalid backup file.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await entry.async("string"));
  } catch {
    throw new Error("Invalid backup file.");
  }
  const m = parsed as Partial<BackupManifestV1> | null;
  if (!m || typeof m !== "object") throw new Error("Invalid backup file.");
  if (m.app !== "Moonseed" || m.schema_version !== 1) {
    throw new Error(
      "This backup was made with a different version of Moonseed and cannot be restored.",
    );
  }
  if (!Array.isArray(m.categories)) throw new Error("Invalid backup file.");
  const manifest: BackupManifestV1 = {
    app: "Moonseed",
    schema_version: 1,
    exported_at: String(m.exported_at ?? ""),
    user_id: String(m.user_id ?? ""),
    categories: m.categories.map((c) => String(c)),
    contents: (m.contents as BackupManifestV1["contents"]) ?? {},
    part_index: typeof m.part_index === "number" ? m.part_index : 1,
    total_parts: typeof m.total_parts === "number" ? m.total_parts : 1,
  };
  return { manifest, zip };
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "bin" : name.slice(i + 1).toLowerCase();
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/** Run jobs with bounded concurrency. */
async function runPool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  limit = IMAGE_CONCURRENCY,
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(
      (async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

type FileIndex = Map<string, JSZip>;

function indexFiles(zips: JSZip[]): FileIndex {
  const map: FileIndex = new Map();
  for (const zip of zips) {
    zip.forEach((relPath, entry) => {
      if (!entry.dir) map.set(relPath, zip);
    });
  }
  return map;
}

async function readJson<T>(zip: JSZip | undefined, path: string): Promise<T[]> {
  if (!zip) return [];
  const entry = zip.file(path);
  if (!entry) return [];
  try {
    const parsed = JSON.parse(await entry.async("string")) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function readJsonObject<T>(
  zip: JSZip | undefined,
  path: string,
): Promise<T | null> {
  if (!zip) return null;
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    const parsed = JSON.parse(await entry.async("string")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Insert rows one-by-one, treating Postgres unique-violation (23505) as
 * "already present". Returns inserted/skipped/failed tallies.
 */
async function insertRowsMerge(
  table:
    | "readings"
    | "user_tags"
    | "user_streaks"
    | "custom_guides"
    | "custom_decks"
    | "custom_deck_cards"
    | "reading_photos",
  rows: Record<string, unknown>[],
  userId: string,
): Promise<CategoryRestoreResult> {
  const result = emptyResult();
  for (const raw of rows) {
    const row = { ...raw, user_id: userId };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table as any) as any).insert(row);
    if (!error) {
      result.inserted += 1;
    } else if (
      error.code === "23505" ||
      /duplicate key/i.test(error.message ?? "")
    ) {
      result.skipped += 1;
    } else {
      result.failed += 1;
      console.warn(`[restore] ${table} insert failed`, error);
    }
  }
  return result;
}

async function uploadIfMissing(
  bucket: string,
  path: string,
  blob: Blob,
): Promise<boolean> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: false });
  if (!error) return true;
  // Already exists → treat as success (image is in place).
  if (/exists/i.test(error.message ?? "")) return true;
  console.warn(`[restore] storage upload failed`, bucket, path, error);
  return false;
}

export async function executeRestore(params: {
  zips: JSZip[];
  selectedCategories: string[];
  userId: string;
  isPremium: boolean;
  onProgress?: (msg: string, pct: number) => void;
}): Promise<RestoreResult> {
  const { zips, selectedCategories, userId, isPremium, onProgress } = params;
  const result: RestoreResult = { perCategory: {} };

  onProgress?.("Validating backup…", 0);

  // ---- Validate parts ----
  const manifests: BackupManifestV1[] = [];
  for (const zip of zips) {
    const entry = zip.file("manifest.json");
    if (!entry) throw new Error("One of the backup parts is missing its manifest.");
    const m = JSON.parse(await entry.async("string")) as Partial<BackupManifestV1>;
    if (m.app !== "Moonseed" || m.schema_version !== 1) {
      throw new Error(
        "This backup was made with a different version of Moonseed and cannot be restored.",
      );
    }
    manifests.push({
      app: "Moonseed",
      schema_version: 1,
      exported_at: String(m.exported_at ?? ""),
      user_id: String(m.user_id ?? ""),
      categories: Array.isArray(m.categories) ? m.categories.map(String) : [],
      contents: (m.contents as BackupManifestV1["contents"]) ?? {},
      part_index: typeof m.part_index === "number" ? m.part_index : 1,
      total_parts: typeof m.total_parts === "number" ? m.total_parts : 1,
    });
  }
  const exportedAts = new Set(manifests.map((m) => m.exported_at));
  if (exportedAts.size > 1) {
    throw new Error("Backup parts come from different exports. Upload parts from the same backup.");
  }
  const totalParts = manifests[0]?.total_parts ?? 1;
  if (manifests.length !== totalParts) {
    throw new Error(
      `Backup is incomplete. Expected ${totalParts} part(s), got ${manifests.length}.`,
    );
  }
  const seen = new Set<number>();
  for (const m of manifests) {
    const idx = m.part_index ?? 1;
    if (idx < 1 || idx > totalParts || seen.has(idx)) {
      throw new Error("Backup parts are mismatched or duplicated.");
    }
    seen.add(idx);
  }
  // Sort and pick part 1 for JSON reads.
  const ordered = [...zips].sort((a, b) => {
    const ai = manifests[zips.indexOf(a)].part_index ?? 1;
    const bi = manifests[zips.indexOf(b)].part_index ?? 1;
    return ai - bi;
  });
  const part1 = ordered[0];
  const fileIndex = indexFiles(ordered);

  const wanted = new Set(selectedCategories);

  // ---- Readings ----
  if (wanted.has("readings") && FREE_CATEGORIES.has("readings")) {
    onProgress?.("Restoring readings…", 0.1);
    const rows = await readJson<Record<string, unknown>>(
      part1,
      "readings/readings.json",
    );
    result.perCategory.readings = await insertRowsMerge("readings", rows, userId);
  }

  // ---- Preferences (overwrite) ----
  if (wanted.has("preferences")) {
    onProgress?.("Restoring preferences…", 0.2);
    const obj = await readJsonObject<Record<string, unknown>>(
      part1,
      "preferences/preferences.json",
    );
    const r = emptyResult();
    if (obj && Object.keys(obj).length > 0) {
      const row = { ...obj, user_id: userId };
      const { error } = await supabase
        .from("user_preferences")
        .upsert(row as never, { onConflict: "user_id" });
      if (!error) {
        r.inserted = 1;
        r.overwrote = true;
      } else {
        r.failed = 1;
        console.warn("[restore] preferences upsert failed", error);
      }
    }
    result.perCategory.preferences = r;
  }

  // ---- Tags / Streaks / Guides ----
  if (wanted.has("user_tags")) {
    onProgress?.("Restoring tags…", 0.3);
    const rows = await readJson<Record<string, unknown>>(part1, "user_tags/tags.json");
    result.perCategory.user_tags = await insertRowsMerge("user_tags", rows, userId);
  }
  if (wanted.has("user_streaks")) {
    onProgress?.("Restoring streak history…", 0.35);
    const rows = await readJson<Record<string, unknown>>(part1, "user_streaks/streaks.json");
    result.perCategory.user_streaks = await insertRowsMerge("user_streaks", rows, userId);
  }
  if (wanted.has("custom_guides")) {
    onProgress?.("Restoring custom guides…", 0.4);
    const rows = await readJson<Record<string, unknown>>(part1, "custom_guides/guides.json");
    result.perCategory.custom_guides = await insertRowsMerge("custom_guides", rows, userId);
  }

  // ---- Custom decks ----
  if (wanted.has("custom_decks") && PREMIUM_CATEGORIES.has("custom_decks")) {
    onProgress?.("Restoring custom decks…", 0.5);
    const decks = await readJson<Record<string, unknown>>(part1, "custom_decks/decks.json");
    const deckResult = emptyResult();

    // Build a lookup: deck.id → its folder name in the zip. The export
    // stores folders as `<safeName(deck.name)>_<deck.id>` so we look for
    // any path beginning with the deck id suffix.
    const deckFolderById = new Map<string, string>();
    fileIndex.forEach((_zip, p) => {
      const m = /^custom_decks\/([^/]+)\//.exec(p);
      if (!m) return;
      const folder = m[1];
      const id = folder.split("_").pop() ?? "";
      if (id && !deckFolderById.has(id)) deckFolderById.set(id, folder);
    });

    for (const deck of decks) {
      const deckId = String(deck.id ?? "");
      const folder = deckFolderById.get(deckId);
      let backUrl: string | null = (deck.card_back_url as string) ?? null;
      let backThumb: string | null = (deck.card_back_thumb_url as string) ?? null;

      // Upload card back first so deck row points at the new URL.
      if (folder) {
        const backEntry = [...fileIndex.entries()].find(([p]) =>
          new RegExp(`^custom_decks/${folder}/back\\.[a-z0-9]+$`).test(p),
        );
        if (backEntry) {
          if (!isPremium) {
            deckResult.filesSkippedPremium += 1;
            backUrl = null;
            backThumb = null;
          } else {
            const [path, zip] = backEntry;
            const blob = await zip
              .file(path)!
              .async("blob")
              .then((b) => new Blob([b], { type: contentTypeFor(extOf(path)) }));
            const ext = extOf(path);
            const storagePath = `${userId}/${deckId}/back-${Date.now()}.${ext}`;
            const ok = await uploadIfMissing(DECK_BUCKET, storagePath, blob);
            if (ok) {
              const { data: signed } = await supabase.storage
                .from(DECK_BUCKET)
                .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
              backUrl = signed?.signedUrl ?? backUrl;
              backThumb = signed?.signedUrl ?? backThumb;
              deckResult.filesUploaded += 1;
            }
          }
        }
      }

      // Insert the deck row (skip on duplicate id).
      const deckRow = {
        ...deck,
        user_id: userId,
        card_back_url: backUrl,
        card_back_thumb_url: backThumb,
      } as Record<string, unknown>;
      const { error: deckErr } = await supabase
        .from("custom_decks")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(deckRow as any);
      if (deckErr) {
        if (deckErr.code === "23505") {
          deckResult.skipped += 1;
        } else {
          deckResult.failed += 1;
          console.warn("[restore] custom_decks insert failed", deckErr);
          continue;
        }
      } else {
        deckResult.inserted += 1;
      }

      // Cards for this deck.
      const cards = folder
        ? await readJson<Record<string, unknown>>(
            fileIndex.get(`custom_decks/${folder}/cards.json`),
            `custom_decks/${folder}/cards.json`,
          )
        : [];

      const cardJobs = cards.map((card) => async () => {
        const cardId = card.card_id;
        let displayPath = (card.display_path as string) ?? "";
        let displayUrl = (card.display_url as string) ?? "";
        let thumbnailPath = (card.thumbnail_path as string) ?? "";
        let thumbnailUrl = (card.thumbnail_url as string) ?? "";

        if (folder && cardId != null) {
          const imgEntry = [...fileIndex.entries()].find(([p]) =>
            new RegExp(`^custom_decks/${folder}/images/card_${cardId}\\.[a-z0-9]+$`).test(p),
          );
          if (imgEntry) {
            if (!isPremium) {
              deckResult.filesSkippedPremium += 1;
              displayPath = "";
              displayUrl = "";
              thumbnailPath = "";
              thumbnailUrl = "";
            } else {
              const [path, zip] = imgEntry;
              const ext = extOf(path);
              const blob = await zip
                .file(path)!
                .async("blob")
                .then((b) => new Blob([b], { type: contentTypeFor(ext) }));
              const newPath = `${userId}/${deckId}/card-${cardId}-${Date.now()}.${ext}`;
              const ok = await uploadIfMissing(DECK_BUCKET, newPath, blob);
              if (ok) {
                const { data: signed } = await supabase.storage
                  .from(DECK_BUCKET)
                  .createSignedUrl(newPath, 60 * 60 * 24 * 365);
                displayPath = newPath;
                displayUrl = signed?.signedUrl ?? "";
                thumbnailPath = newPath;
                thumbnailUrl = signed?.signedUrl ?? "";
                deckResult.filesUploaded += 1;
              }
            }
          }
        }

        const cardRow = {
          ...card,
          user_id: userId,
          deck_id: deckId,
          display_path: displayPath,
          display_url: displayUrl,
          thumbnail_path: thumbnailPath,
          thumbnail_url: thumbnailUrl,
        } as Record<string, unknown>;
        const { error } = await supabase
          .from("custom_deck_cards")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert(cardRow as any);
        if (error) {
          if (error.code === "23505") deckResult.skipped += 1;
          else {
            deckResult.failed += 1;
            console.warn("[restore] custom_deck_cards insert failed", error);
          }
        } else {
          deckResult.inserted += 1;
        }
      });

      let cursor = 0;
      const runners: Promise<void>[] = [];
      for (let i = 0; i < Math.min(IMAGE_CONCURRENCY, cardJobs.length); i++) {
        runners.push(
          (async () => {
            while (cursor < cardJobs.length) {
              const idx = cursor++;
              await cardJobs[idx]();
            }
          })(),
        );
      }
      await Promise.all(runners);
    }
    result.perCategory.custom_decks = deckResult;
  }

  // ---- Reading photos ----
  if (wanted.has("reading_photos") && PREMIUM_CATEGORIES.has("reading_photos")) {
    onProgress?.("Restoring reading photos…", 0.8);
    const photos = await readJson<Record<string, unknown>>(
      part1,
      "reading_photos/photos.json",
    );
    const photoResult = emptyResult();

    await runPool(photos, async (photo) => {
      const photoId = String(photo.id ?? "");
      let storagePath = (photo.storage_path as string) ?? "";

      const imgEntry = [...fileIndex.entries()].find(([p]) =>
        new RegExp(`^reading_photos/images/${photoId}\\.[a-z0-9]+$`).test(p),
      );
      if (imgEntry) {
        if (!isPremium) {
          photoResult.filesSkippedPremium += 1;
          storagePath = "";
        } else {
          const [path, zip] = imgEntry;
          const ext = extOf(path);
          const blob = await zip
            .file(path)!
            .async("blob")
            .then((b) => new Blob([b], { type: contentTypeFor(ext) }));
          const newPath = `${userId}/${photoId}.${ext}`;
          const ok = await uploadIfMissing(PHOTO_BUCKET, newPath, blob);
          if (ok) {
            storagePath = newPath;
            photoResult.filesUploaded += 1;
          }
        }
      }

      const row = { ...photo, user_id: userId, storage_path: storagePath };
      // Free user with no metadata storage_path → still insert row with empty path? schema requires non-null.
      if (!storagePath) {
        photoResult.failed += 1;
        return;
      }
      const { error } = await supabase
        .from("reading_photos")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(row as any);
      if (error) {
        if (error.code === "23505") photoResult.skipped += 1;
        else {
          photoResult.failed += 1;
          console.warn("[restore] reading_photos insert failed", error);
        }
      } else {
        photoResult.inserted += 1;
      }
    });
    result.perCategory.reading_photos = photoResult;
  }

  onProgress?.("Done", 1);
  return result;
}