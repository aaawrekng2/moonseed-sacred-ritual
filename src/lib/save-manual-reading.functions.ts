/**
 * DY — Save Manual Reading (no AI).
 *
 * Server function for the "Save to Journal" path on /constellation. Writes
 * a readings row with picks + question + note + optional backdate, leaving
 * the `interpretation` column null so the journal can distinguish manual
 * entries from AI-interpreted readings.
 *
 * Lives in its own file so the AI pipeline in interpret.functions stays
 * focused on the AI flow.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidSpreadMode } from "@/lib/spreads";

const SaveManualInput = z.object({
  spread: z.string().refine(isValidSpreadMode, "Unknown spread"),
  picks: z
    .array(
      z.object({
        id: z.number().int(),
        cardIndex: z.number().int().min(0).max(77),
        isReversed: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(10),
  /** Seeker's question for this draw. Optional. */
  question: z.string().max(500).optional(),
  /** Free-form notes the seeker wrote on /constellation. Optional. */
  note: z.string().max(10000).optional(),
  /** Optional ISO timestamp for backdated entries. */
  createdAt: z.string().datetime().optional(),
});

export type SaveManualSuccess = { ok: true; readingId: string };
export type SaveManualError = {
  ok: false;
  error: "internal";
  message: string;
};

export const saveManualReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveManualInput.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<SaveManualSuccess | SaveManualError> => {
      const { supabase, userId } = context;
      try {
        const { data: inserted, error: insertErr } = await supabase
          .from("readings")
          .insert({
            user_id: userId,
            spread_type: data.spread,
            card_ids: data.picks.map((p) => p.cardIndex),
            card_orientations: data.picks.map((p) => p.isReversed ?? false),
            interpretation: null,
            question: data.question ?? null,
            note: data.note ?? null,
            ...(data.createdAt ? { created_at: data.createdAt } : {}),
          })
          .select("id")
          .single();
        if (insertErr || !inserted) {
          console.error("[saveManualReading] insert failed", insertErr);
          return {
            ok: false,
            error: "internal",
            message: "Could not save reading.",
          };
        }
        return { ok: true, readingId: inserted.id };
      } catch (e) {
        console.error("[saveManualReading] unexpected", e);
        return {
          ok: false,
          error: "internal",
          message: "Something went wrong. Please try again.",
        };
      }
    },
  );
