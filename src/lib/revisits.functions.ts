/**
 * v2.10 — Revisit feature server functions.
 *
 * Schedule a saved reading to resurface later, surface the ones that are
 * due, and record a dated reflection. All date bucketing is timezone-aware
 * via @/lib/time (the seeker's tz is passed in, never server-local).
 *
 * All callers include an Authorization Bearer header (handled by the
 * existing requireSupabaseAuth middleware).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nowYmdInTz } from "@/lib/time";

const TABLE = "reading_revisits";

/* ---------- scheduleRevisit ---------- */
/** Upserts the single pending revisit for a reading. resurfaceOn is a
 *  YYYY-MM-DD computed client-side in the seeker's tz. */
export const scheduleRevisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        readingId: z.string().uuid(),
        resurfaceOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        prompt: z.string().max(200).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const prompt = data.prompt?.trim() || null;
    const { data: existing } = await supabaseAdmin
      .from(TABLE as never)
      .select("id")
      .eq("user_id", userId)
      .eq("reading_id", data.readingId)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      const id = (existing as { id: string }).id;
      const { error } = await supabaseAdmin
        .from(TABLE as never)
        .update({
          resurface_on: data.resurfaceOn,
          prompt,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { id, updated: true };
    }
    const { data: row, error } = await supabaseAdmin
      .from(TABLE as never)
      .insert({
        user_id: userId,
        reading_id: data.readingId,
        resurface_on: data.resurfaceOn,
        prompt,
        status: "pending",
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string }).id, updated: false };
  });

/* ---------- getRevisitForReading ---------- */
/** The pending revisit (if any) for a single reading — drives the revisit
 *  section in the reading detail. */
export const getRevisitForReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ readingId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("id, resurface_on, prompt, status")
      .eq("user_id", userId)
      .eq("reading_id", data.readingId)
      .eq("status", "pending")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      (row as {
        id: string;
        resurface_on: string;
        prompt: string | null;
        status: string;
      } | null) ?? null
    );
  });

/* ---------- getDueRevisits ---------- */
/** Pending revisits due on/before today in the seeker's tz. Returns the
 *  count + reading_ids — for the Today line and the journal filter. */
export const getDueRevisits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tz: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const today = nowYmdInTz(data.tz);
    const { data: rows, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("reading_id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("resurface_on", today);
    if (error) throw new Error(error.message);
    const readingIds = ((rows as { reading_id: string }[] | null) ?? []).map(
      (r) => r.reading_id,
    );
    return { count: readingIds.length, readingIds };
  });

/* ---------- recordReflection ---------- */
/** Stores a dated reflection on the pending revisit and closes it. */
export const recordReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        readingId: z.string().uuid(),
        reflection: z.string().max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from(TABLE as never)
      .update({
        reflection: data.reflection.trim() || null,
        reflected_at: new Date().toISOString(),
        status: "reflected",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("user_id", userId)
      .eq("reading_id", data.readingId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- dismissRevisit ---------- */
/** Closes the pending revisit without a reflection. */
export const dismissRevisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ readingId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from(TABLE as never)
      .update({
        status: "dismissed",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("user_id", userId)
      .eq("reading_id", data.readingId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
