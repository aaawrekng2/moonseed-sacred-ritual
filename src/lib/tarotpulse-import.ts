/**
 * Q10 — One-time TarotPulse CSV import for theresetgirlmail@gmail.com.
 *
 * Runs after auth resolves; gated by user_preferences.tarotpulse_import_done
 * so it only fires once per user. Idempotent at the row level too: skips
 * any reading whose (user_id, created_at, card_ids) already exists.
 */
import { supabase } from "@/integrations/supabase/client";
import { TAROTPULSE_IMPORT_ROWS } from "./tarotpulse-import-data";

const TARGET_EMAIL = "theresetgirlmail@gmail.com";

export async function maybeRunTarotpulseImport(
  userId: string,
  email: string | null | undefined,
): Promise<void> {
  if (!userId || !email) return;
  if (email.toLowerCase() !== TARGET_EMAIL) return;

  // Gate
  const { data: pref } = await supabase
    .from("user_preferences")
    .select("tarotpulse_import_done")
    .eq("user_id", userId)
    .maybeSingle();
  if (pref?.tarotpulse_import_done) return;

  let inserted = 0;
  let skipped = 0;
  for (const row of TAROTPULSE_IMPORT_ROWS) {
    try {
      // Idempotency check
      const { data: existing } = await supabase
        .from("readings")
        .select("id")
        .eq("user_id", userId)
        .eq("created_at", row.created_at)
        .contains("card_ids", row.card_ids)
        .containedBy("card_ids", row.card_ids)
        .limit(1);
      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }
      const { error } = await supabase.from("readings").insert({
        user_id: userId,
        created_at: row.created_at,
        card_ids: row.card_ids as unknown as number[],
        card_orientations: row.card_orientations as unknown as boolean[],
        spread_type: row.spread_type,
        question: row.question,
        note: row.note,
        tags: row.tags as unknown as string[],
        // `source` column added in Q10 migration; types may lag one cycle.
        source: "imported-tarotpulse",
        entry_mode: "digital",
        mode: "personal",
      } as never);
      if (error) {
        console.warn("[tarotpulse-import] insert error", error, row);
      } else {
        inserted++;
      }
    } catch (err) {
      console.warn("[tarotpulse-import] row failed", err);
    }
  }

  await supabase
    .from("user_preferences")
    .update({ tarotpulse_import_done: true })
    .eq("user_id", userId);

  console.log(
    `[tarotpulse-import] done — inserted=${inserted} skipped=${skipped}`,
  );
}
