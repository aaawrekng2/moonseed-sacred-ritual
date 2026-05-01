/**
 * CSV import — server functions (CS).
 *
 * `executeImport` inserts a prepared array of reading rows under a
 * single `import_batch_id` so the user can undo the entire batch in
 * one click. Per-row failures are captured (not thrown) so a single
 * bad row never aborts a 1000-row import.
 *
 * `undoImport` deletes every reading tagged with the given batch and
 * clears the matching `import_batches` row. Both functions verify the
 * batch belongs to the caller before any destructive op.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ReadingInput = z.object({
  spread_type: z.enum(["single", "three", "celtic"]),
  card_ids: z.array(z.number().int().min(0).max(77)),
  card_orientations: z.array(z.boolean()),
  question: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.string().optional(), // ISO timestamp
});

const ExecuteImportInput = z.object({
  readings: z.array(ReadingInput).min(1).max(20000),
  sourceFormat: z.string().min(1).max(64),
});

export const executeImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ExecuteImportInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const batchId = crypto.randomUUID();
    const failed: number[] = [];
    let imported = 0;

    // CT — Sync imported tags into the normalized `user_tags` table so
    // they appear in the Journal Filters drawer. The CS importer wrote
    // only to `readings.tags`, leaving imported tags invisible to
    // global filters. Run BEFORE the readings insert; if it fails we
    // log and continue (lost tag visibility is recoverable; lost
    // readings are not).
    //
    // Note: `undoImport` does NOT delete these `user_tags` rows on
    // purpose — those tag names may already be in use elsewhere, and
    // users may want to keep them in their tag library after removing
    // the imported readings.
    try {
      const allTagNames = new Set<string>();
      for (const r of data.readings) {
        for (const tag of r.tags ?? []) {
          const trimmed = tag.trim();
          if (trimmed) allTagNames.add(trimmed);
        }
      }
      if (allTagNames.size > 0) {
        const { data: existing } = await supabaseAdmin
          .from("user_tags")
          .select("name")
          .eq("user_id", userId);
        const existingLowered = new Set(
          (existing ?? []).map((t: { name: string }) => t.name.toLowerCase()),
        );
        const missing = Array.from(allTagNames).filter(
          (name) => !existingLowered.has(name.toLowerCase()),
        );
        if (missing.length > 0) {
          const { error: tagErr } = await supabaseAdmin
            .from("user_tags")
            .insert(
              missing.map((name) => ({
                user_id: userId,
                name,
                usage_count: 1,
              })),
            );
          if (tagErr) {
            // eslint-disable-next-line no-console
            console.warn("[import] user_tags sync failed", tagErr.message);
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[import] user_tags sync threw", (e as Error).message);
    }

    const CHUNK = 50;
    for (let i = 0; i < data.readings.length; i += CHUNK) {
      const chunk = data.readings.slice(i, i + CHUNK).map((r) => ({
        user_id: userId,
        spread_type: r.spread_type,
        card_ids: r.card_ids,
        card_orientations: r.card_orientations,
        question: r.question ?? null,
        note: r.note ?? null,
        tags: r.tags ?? [],
        created_at: r.created_at ?? new Date().toISOString(),
        entry_mode: "manual",
        mode: "personal",
        import_batch_id: batchId,
      }));
      const { error } = await supabaseAdmin.from("readings").insert(chunk);
      if (error) {
        // Mark every row in this chunk as failed and continue.
        for (let j = 0; j < chunk.length; j++) failed.push(i + j);
        // eslint-disable-next-line no-console
        console.warn("[import] chunk insert failed", error.message);
      } else {
        imported += chunk.length;
      }
    }

    await supabaseAdmin.from("import_batches").insert({
      id: batchId,
      user_id: userId,
      source_format: data.sourceFormat,
      row_count: imported,
      skipped_count: failed.length,
    });

    return { batchId, imported, failed: failed.length };
  });

const UndoInput = z.object({
  batchId: z.string().uuid(),
});

export const undoImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UndoInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Defense-in-depth: confirm the batch belongs to this caller
    // before deleting anything.
    const { data: batch, error: bErr } = await supabaseAdmin
      .from("import_batches")
      .select("user_id")
      .eq("id", data.batchId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!batch || batch.user_id !== userId) {
      throw new Error("Not your batch");
    }

    const { count, error: dErr } = await supabaseAdmin
      .from("readings")
      .delete({ count: "exact" })
      .eq("import_batch_id", data.batchId)
      .eq("user_id", userId);
    if (dErr) throw new Error(dErr.message);

    await supabaseAdmin
      .from("import_batches")
      .delete()
      .eq("id", data.batchId)
      .eq("user_id", userId);

    return { deleted: count ?? 0 };
  });