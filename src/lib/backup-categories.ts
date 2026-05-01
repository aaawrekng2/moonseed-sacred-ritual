/**
 * CG — Backup categories.
 *
 * Each category describes a slice of the user's data that can be
 * independently selected for export. A backup ZIP contains one folder
 * per selected category plus a top-level manifest.json.
 *
 * Categories are intentionally narrow so size estimates are meaningful
 * and a partial restore (future work) can be reasoned about per-folder.
 */
import { supabase } from "@/integrations/supabase/client";

export type BackupCategoryId =
  | "readings"
  | "preferences"
  | "custom_decks"
  | "reading_photos"
  | "patterns_threads_weaves"
  | "tags_streaks_guides";

export type BackupCategory = {
  id: BackupCategoryId;
  label: string;
  description: string;
  /** Returns { count, bytes } estimate for this category. */
  estimate: (userId: string) => Promise<{ count: number; bytes: number }>;
};

/** Rough JSON-row weight when we don't have a true byte count. */
const ROW_WEIGHT_BYTES = 2_000;

async function countRows(table: string, userId: string): Promise<number> {
  const { count } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

export const BACKUP_CATEGORIES: BackupCategory[] = [
  {
    id: "readings",
    label: "Readings",
    description: "Every reading you've saved — cards, notes, interpretations.",
    estimate: async (uid) => {
      const c = await countRows("readings", uid);
      return { count: c, bytes: c * ROW_WEIGHT_BYTES };
    },
  },
  {
    id: "preferences",
    label: "Preferences & profile",
    description: "Your settings, themes, blueprint, and saved themes.",
    estimate: async (uid) => {
      const c = await countRows("user_preferences", uid);
      return { count: c, bytes: c * 4_000 };
    },
  },
  {
    id: "custom_decks",
    label: "Custom decks (data + images)",
    description: "Your photographed decks including all card images.",
    estimate: async (uid) => {
      const { data: decks } = await supabase
        .from("custom_decks")
        .select("id, cards_photographed_count")
        .eq("user_id", uid);
      const deckCount = decks?.length ?? 0;
      const cardCount =
        decks?.reduce((s, d) => s + (d.cards_photographed_count ?? 0), 0) ?? 0;
      // Rough: 250 KB per card image (display + thumb combined).
      return {
        count: deckCount,
        bytes: deckCount * 4_000 + cardCount * 250_000,
      };
    },
  },
  {
    id: "reading_photos",
    label: "Reading photos",
    description: "Photos you attached to readings.",
    estimate: async (uid) => {
      const c = await countRows("reading_photos", uid);
      // Rough: 400 KB per photo.
      return { count: c, bytes: c * 400_000 };
    },
  },
  {
    id: "patterns_threads_weaves",
    label: "Patterns, threads & weaves",
    description: "Detected symbolic structure across your readings.",
    estimate: async (uid) => {
      const [p, t, w] = await Promise.all([
        countRows("patterns", uid),
        countRows("symbolic_threads", uid),
        countRows("weaves", uid),
      ]);
      const total = p + t + w;
      return { count: total, bytes: total * ROW_WEIGHT_BYTES };
    },
  },
  {
    id: "tags_streaks_guides",
    label: "Tags, streaks & custom guides",
    description: "Your tag library, streak history, and custom guides.",
    estimate: async (uid) => {
      const [tags, streaks, guides] = await Promise.all([
        countRows("user_tags", uid),
        countRows("user_streaks", uid),
        countRows("custom_guides", uid),
      ]);
      const total = tags + streaks + guides;
      return { count: total, bytes: total * 800 };
    },
  },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}