/**
 * DV — Archive system for saved readings.
 *
 * Soft-delete: setting `archived_at` to a timestamp moves a reading to
 * the Archive view. Restoring clears the timestamp. After 30 days the
 * daily `purge_archived_readings` cron permanently deletes the row and
 * scrubs the readingId from any pattern.reading_ids array (Stories
 * with no remaining readings are marked `dormant`).
 *
 * `deleteReadingForever` performs the same cleanup synchronously when
 * the seeker chooses to permanently delete from the Archive UI.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ReadingIdInput = z.object({ readingId: z.string().uuid() });

export const archiveReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReadingIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("readings")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.readingId)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message ?? null };
  });

export const restoreReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReadingIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("readings")
      .update({ archived_at: null })
      .eq("id", data.readingId)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message ?? null };
  });

export const deleteReadingForever = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReadingIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // 1. Find patterns referencing this reading.
    const { data: patterns } = await supabase
      .from("patterns")
      .select("id, reading_ids, lifecycle_state")
      .eq("user_id", userId)
      .contains("reading_ids", [data.readingId]);
    // 2. Strip the readingId; mark dormant if list empties.
    for (const p of (patterns ?? []) as Array<{
      id: string;
      reading_ids: string[] | null;
      lifecycle_state: string;
    }>) {
      const newIds = (p.reading_ids ?? []).filter(
        (rid) => rid !== data.readingId,
      );
      const updates: { reading_ids: string[]; lifecycle_state?: string } = {
        reading_ids: newIds,
      };
      if (newIds.length === 0) updates.lifecycle_state = "dormant";
      await supabase.from("patterns").update(updates).eq("id", p.id);
    }
    // 3. Hard-delete the reading.
    const { error } = await supabase
      .from("readings")
      .delete()
      .eq("id", data.readingId)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message ?? null };
  });

export const fetchArchivedReadings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("readings")
      .select("*")
      .eq("user_id", userId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    if (error) {
      console.error("[fetchArchivedReadings] error", error);
    } else {
      console.log(
        "[fetchArchivedReadings] userId=",
        userId,
        "count=",
        data?.length ?? 0,
      );
    }
    return { readings: data ?? [], error: error?.message ?? null };
  });

/**
 * Days remaining until the 30-day auto-purge fires for a row archived
 * at `archivedAt`. Pure math; safe on client. Returns 0 if past due.
 */
export function daysUntilPurge(archivedAt: string): number {
  const archived = new Date(archivedAt).getTime();
  const purge = archived + 30 * 24 * 60 * 60 * 1000;
  const remaining = purge - Date.now();
  if (remaining <= 0) return 0;
  return Math.floor(remaining / (24 * 60 * 60 * 1000));
}