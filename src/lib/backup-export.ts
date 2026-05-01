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

export type BackupProgress = {
  phase: string;
  current: number;
  total: number;
};

type Opts = {
  userId: string;
  categories: BackupCategoryId[];
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

export async function createBackup({
  userId,
  categories,
  onProgress,
}: Opts): Promise<Blob> {
  const zip = new JSZip();
  const manifest: Record<string, unknown> = {
    app: "Moonseed",
    version: "CG",
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

  if (categories.includes("custom_decks")) {
    const folder = zip.folder("custom_decks")!;
    const { data: decks } = await supabase
      .from("custom_decks")
      .select("*")
      .eq("user_id", userId);
    folder.file("decks.json", JSON.stringify(decks ?? [], null, 2));
    let fileCount = 0;
    for (const deck of decks ?? []) {
      const deckFolder = folder.folder(safeName(`${deck.name}_${deck.id}`))!;
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
          const blob = await fetchBlob(DECK_BUCKET, card.display_path);
          if (blob) {
            const ext = card.display_path.split(".").pop() || "jpg";
            imgs.file(`card_${card.card_id}.${ext}`, blob);
            fileCount += 1;
          }
        }
      }
    }
    contents.custom_decks = { rows: decks?.length ?? 0, files: fileCount };
    tick("Custom decks");
  }

  if (categories.includes("reading_photos")) {
    const folder = zip.folder("reading_photos")!;
    const { data: photos } = await supabase
      .from("reading_photos")
      .select("*")
      .eq("user_id", userId);
    folder.file("photos.json", JSON.stringify(photos ?? [], null, 2));
    const imgs = folder.folder("images")!;
    let fileCount = 0;
    for (const photo of photos ?? []) {
      if (!photo.storage_path) continue;
      const blob = await fetchBlob(PHOTO_BUCKET, photo.storage_path);
      if (blob) {
        const ext = photo.storage_path.split(".").pop() || "jpg";
        imgs.file(`${photo.id}.${ext}`, blob);
        fileCount += 1;
      }
    }
    contents.reading_photos = { rows: photos?.length ?? 0, files: fileCount };
    tick("Reading photos");
  }

  if (categories.includes("patterns_threads_weaves")) {
    const folder = zip.folder("patterns_threads_weaves")!;
    const [{ data: patterns }, { data: threads }, { data: weaves }] =
      await Promise.all([
        supabase.from("patterns").select("*").eq("user_id", userId),
        supabase.from("symbolic_threads").select("*").eq("user_id", userId),
        supabase.from("weaves").select("*").eq("user_id", userId),
      ]);
    folder.file("patterns.json", JSON.stringify(patterns ?? [], null, 2));
    folder.file("threads.json", JSON.stringify(threads ?? [], null, 2));
    folder.file("weaves.json", JSON.stringify(weaves ?? [], null, 2));
    contents.patterns_threads_weaves = {
      rows:
        (patterns?.length ?? 0) +
        (threads?.length ?? 0) +
        (weaves?.length ?? 0),
    };
    tick("Patterns, threads & weaves");
  }

  if (categories.includes("tags_streaks_guides")) {
    const folder = zip.folder("tags_streaks_guides")!;
    const [{ data: tags }, { data: streaks }, { data: guides }] =
      await Promise.all([
        supabase.from("user_tags").select("*").eq("user_id", userId),
        supabase.from("user_streaks").select("*").eq("user_id", userId),
        supabase.from("custom_guides").select("*").eq("user_id", userId),
      ]);
    folder.file("tags.json", JSON.stringify(tags ?? [], null, 2));
    folder.file("streaks.json", JSON.stringify(streaks ?? [], null, 2));
    folder.file("guides.json", JSON.stringify(guides ?? [], null, 2));
    contents.tags_streaks_guides = {
      rows:
        (tags?.length ?? 0) +
        (streaks?.length ?? 0) +
        (guides?.length ?? 0),
    };
    tick("Tags, streaks & guides");
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}