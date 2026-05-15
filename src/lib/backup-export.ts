/**
 * CG — Backup export.
 *
 * Streams selected user data into a ZIP using JSZip, fetching binary
 * assets (deck images, reading photos) via short-lived signed URLs.
 * Each category lives in its own folder; a top-level manifest.json
 * records what was exported and when.
 *
 * The export is a pure client-side operation — no server function
 * required because every read goes through RLS as the signed-in user.
 */
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import type { BackupCategoryId } from "./backup-categories";

const DECK_BUCKET = "custom-deck-images";
const PHOTO_BUCKET = "reading-photos";

/**
 * Bumped on any breaking change to the on-disk backup format.
 * Restore (CJ) will refuse archives with an unknown schema_version.
 */
export const BACKUP_SCHEMA_VERSION = 1;

export type BackupProgress = {
  phase: string;
  current: number;
  total: number;
  /** DC-6.3 — 0..100 fine-grained percent for the current phase. */
  pct?: number;
};

type Opts = {
  userId: string;
  categories: BackupCategoryId[];
  isPremium: boolean;
  onProgress?: (p: BackupProgress) => void;
};

async function fetchBlob(bucket: string, path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return null;
  try {
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
}

/**
 * Derive a storage path inside DECK_BUCKET from a public URL like
 * `https://<project>.supabase.co/storage/v1/object/public/custom-deck-images/<path>`.
 * Returns null if the URL doesn't point at the deck bucket.
 */
function deriveDeckStoragePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${DECK_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split("?")[0];
  return path || null;
}

export async function createBackup({
  userId,
  categories,
  isPremium,
  onProgress,
}: Opts): Promise<Blob> {
  const zip = new JSZip();
  const manifest: Record<string, unknown> = {
    app: "Tarot Seed",
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    user_id: userId,
    categories: categories,
    contents: {} as Record<string, { rows?: number; files?: number }>,
  };
  const contents = manifest.contents as Record<
    string,
    { rows?: number; files?: number }
  >;

  const total = categories.length;
  let step = 0;
  const tick = (phase: string) => {
    step += 1;
    onProgress?.({ phase, current: step, total });
  };

  if (categories.includes("readings")) {
    const { data } = await supabase
      .from("readings")
      .select("*")
      .eq("user_id", userId);
    zip.folder("readings")?.file("readings.json", JSON.stringify(data ?? [], null, 2));
    contents.readings = { rows: data?.length ?? 0 };
    tick("Readings");
  }

  if (categories.includes("preferences")) {
    const { data } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    zip.folder("preferences")?.file(
      "preferences.json",
      JSON.stringify(data ?? {}, null, 2),
    );
    contents.preferences = { rows: data ? 1 : 0 };
    tick("Preferences");
  }

  if (categories.includes("custom_decks") && isPremium) {
    const folder = zip.folder("custom_decks")!;
    const { data: decks } = await supabase
      .from("custom_decks")
      .select("*")
      .eq("user_id", userId);
    folder.file("decks.json", JSON.stringify(decks ?? [], null, 2));
    let fileCount = 0;
    // DC-6.3 — collect every image fetch task, then run in parallel
    // batches of 8 with intra-phase progress.
    type ImgTask = {
      bucket: string;
      path: string;
      write: (blob: Blob) => void;
    };
    const imageTasks: ImgTask[] = [];
    for (const deck of decks ?? []) {
      const deckFolder = folder.folder(safeName(`${deck.name}_${deck.id}`))!;
      if (deck.card_back_url) {
        const backPath = deriveDeckStoragePath(deck.card_back_url);
        if (backPath) {
          const ext = backPath.split(".").pop() || "webp";
          imageTasks.push({
            bucket: DECK_BUCKET,
            path: backPath,
            write: (blob) => {
              deckFolder.file(`back.${ext}`, blob);
            },
          });
        }
      }
      const { data: cards } = await supabase
        .from("custom_deck_cards")
        .select("*")
        .eq("deck_id", deck.id)
        .is("archived_at", null);
      deckFolder.file("cards.json", JSON.stringify(cards ?? [], null, 2));
      const imgs = deckFolder.folder("images")!;
      for (const card of cards ?? []) {
        if (card.source === "default") continue;
        if (card.display_path) {
          const ext = card.display_path.split(".").pop() || "jpg";
          const cardId = card.card_id;
          imageTasks.push({
            bucket: DECK_BUCKET,
            path: card.display_path,
            write: (blob) => {
              imgs.file(`card_${cardId}.${ext}`, blob);
            },
          });
        }
      }
    }
    // Parallel batched fetch with intra-phase progress.
    const BATCH = 8;
    let completed = 0;
    const totalImgs = imageTasks.length;
    for (let i = 0; i < totalImgs; i += BATCH) {
      const slice = imageTasks.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map(async (t) => ({ t, blob: await fetchBlob(t.bucket, t.path) })),
      );
      for (const { t, blob } of results) {
        if (blob) {
          t.write(blob);
          fileCount += 1;
        }
        completed += 1;
        onProgress?.({
          phase: "Packing images",
          current: completed,
          total: totalImgs,
          pct: totalImgs > 0 ? (completed / totalImgs) * 100 : 100,
        });
      }
    }
    contents.custom_decks = { rows: decks?.length ?? 0, files: fileCount };
    tick("Custom decks");
  }

  if (categories.includes("reading_photos") && isPremium) {
    const folder = zip.folder("reading_photos")!;
    const { data: photos } = await supabase
      .from("reading_photos")
      .select("*")
      .eq("user_id", userId);
    folder.file("photos.json", JSON.stringify(photos ?? [], null, 2));
    const imgs = folder.folder("images")!;
    let fileCount = 0;
    const tasks = (photos ?? []).filter((p) => !!p.storage_path);
    const BATCH = 8;
    let completed = 0;
    const totalP = tasks.length;
    for (let i = 0; i < totalP; i += BATCH) {
      const slice = tasks.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map(async (photo) => ({
          photo,
          blob: await fetchBlob(PHOTO_BUCKET, photo.storage_path as string),
        })),
      );
      for (const { photo, blob } of results) {
        if (blob) {
          const ext =
            (photo.storage_path as string).split(".").pop() || "jpg";
          imgs.file(`${photo.id}.${ext}`, blob);
          fileCount += 1;
        }
        completed += 1;
        onProgress?.({
          phase: "Packing photos",
          current: completed,
          total: totalP,
          pct: totalP > 0 ? (completed / totalP) * 100 : 100,
        });
      }
    }
    contents.reading_photos = { rows: photos?.length ?? 0, files: fileCount };
    tick("Reading photos");
  }

  if (categories.includes("user_tags")) {
    const { data } = await supabase
      .from("user_tags")
      .select("*")
      .eq("user_id", userId);
    zip.folder("user_tags")?.file(
      "tags.json",
      JSON.stringify(data ?? [], null, 2),
    );
    contents.user_tags = { rows: data?.length ?? 0 };
    tick("Tags");
  }

  if (categories.includes("user_streaks")) {
    const { data } = await supabase
      .from("user_streaks")
      .select("*")
      .eq("user_id", userId);
    zip.folder("user_streaks")?.file(
      "streaks.json",
      JSON.stringify(data ?? [], null, 2),
    );
    contents.user_streaks = { rows: data?.length ?? 0 };
    tick("Streak history");
  }

  if (categories.includes("custom_guides")) {
    const { data } = await supabase
      .from("custom_guides")
      .select("*")
      .eq("user_id", userId);
    zip.folder("custom_guides")?.file(
      "guides.json",
      JSON.stringify(data ?? [], null, 2),
    );
    contents.custom_guides = { rows: data?.length ?? 0 };
    tick("Custom guides");
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}