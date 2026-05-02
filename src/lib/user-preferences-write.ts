/**
 * Safe writer for the `user_preferences` table.
 *
 * The row should normally exist for every signed-in user, but legacy
 * accounts or rare race conditions can leave it missing. A bare
 * `.update()` then silently affects 0 rows and the user's choice
 * appears to "not save" after a refresh. `updateUserPreferences`
 * performs an `upsert` keyed on `user_id` so the write succeeds
 * regardless. All other columns either have defaults or are nullable,
 * so a fresh insert with just `user_id` + the patch is safe.
 */
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";

type Patch = TablesUpdate<"user_preferences"> & {
  moon_carousel_size?: "small" | "medium" | "large";
  ui_density?: number;
};

export async function updateUserPreferences(userId: string, patch: Patch) {
  return await supabase
    .from("user_preferences")
    .upsert(
      { user_id: userId, ...patch } as never,
      { onConflict: "user_id" },
    );
}