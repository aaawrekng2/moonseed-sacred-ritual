import { supabase } from "@/integrations/supabase/client";

const CLEANUP_KEY = "tarotseed_q4_storage_cleanup_done";
const DECK_BUCKET = "custom-deck-images";

/**
 * 26-05-08-Q4 — One-time best-effort cleanup of orphan storage folders
 * left behind from the pre-cascade-delete era. Runs once per browser
 * (gated by a localStorage flag) after auth resolves. Failures are
 * non-fatal — the user just gets a warning in the console.
 */
export async function runQ4StorageCleanup(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(CLEANUP_KEY) === "done") return;
  try {
    const { data: deckFolders } = await supabase.storage
      .from(DECK_BUCKET)
      .list(userId, { limit: 1000 });
    if (!deckFolders) {
      window.localStorage.setItem(CLEANUP_KEY, "done");
      return;
    }
    const { data: validDecks } = await supabase
      .from("custom_decks")
      .select("id")
      .eq("user_id", userId);
    const validDeckIds = new Set((validDecks ?? []).map((d) => d.id));
    let deletedCount = 0;
    for (const folder of deckFolders) {
      if (validDeckIds.has(folder.name)) continue;
      const { data: files } = await supabase.storage
        .from(DECK_BUCKET)
        .list(`${userId}/${folder.name}`, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map(
          (f) => `${userId}/${folder.name}/${f.name}`,
        );
        const { error } = await supabase.storage
          .from(DECK_BUCKET)
          .remove(paths);
        if (!error) deletedCount += paths.length;
      }
    }
    console.log(`[q4-cleanup] removed ${deletedCount} orphan storage files`);
    window.localStorage.setItem(CLEANUP_KEY, "done");
  } catch (err) {
    console.warn("[q4-cleanup] failed (non-fatal)", err);
  }
}
