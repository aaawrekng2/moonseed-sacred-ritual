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
        // EK31 — Was `.min(0).max(77)`. The 77 ceiling was the canonical
        // tarot range (78 cards: 0..77), but oracle deck cards use ids
        // that start at 1000 (and can go much higher) so the validator
        // rejected every manual save containing an oracle pick — the
        // user saw "Number must be less than or equal to 77" with no
        // recovery. Schema now accepts any non-negative integer; the
        // server still records the deck the card came from via the
        // `deckId` field below so the row remains queryable per-deck.
        cardIndex: z.number().int().min(0),
        isReversed: z.boolean().optional(),
        /**
         * EK31 — Source deck for this specific pick. null means the
         * seeker's active deck at save time (resolved server-side using
         * the top-level `activeDeckId`). Different picks within one
         * reading can reference different decks (oracle + tarot in one
         * spread is supported); the per-pick array is stored as
         * `card_deck_ids` on the readings row.
         */
        deckId: z.string().nullable().optional(),
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
  /**
   * EK31 — Seeker's active deck at the moment of save. Used to resolve
   * `null` `deckId` values on picks (a null pick deck means "drawn
   * from the deck currently active in the app," which the client
   * knows but the server otherwise wouldn't). If no picks have a
   * deckId AND activeDeckId is null, the row's deck_id stays null
   * and card_deck_ids is a list of nulls — same shape the legacy
   * tarot-only path produced.
   */
  activeDeckId: z.string().nullable().optional(),
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
        // EK31 — Resolve per-pick deck ids using activeDeckId as fallback
        // for any pick whose deckId is null/undefined ("drawn from the
        // currently-active deck"). The result is the heterogeneous-per-
        // card array stored on `card_deck_ids`. Picks that still have no
        // resolvable deck stay null in the array — same shape the legacy
        // tarot-only path produced before EK31.
        const fallbackDeckId = data.activeDeckId ?? null;
        const cardDeckIds = data.picks.map((p) =>
          p.deckId !== undefined && p.deckId !== null
            ? p.deckId
            : fallbackDeckId,
        );
        // EK31 — Primary deck for the row is whichever deck contributed
        // the most picks. Used by Insights filtering (which queries on
        // the single `deck_id` column) so manual oracle readings show up
        // when the seeker filters by that deck. Mirrors the algorithm
        // used by the import-batch path.
        const counts = new Map<string, number>();
        for (const d of cardDeckIds) {
          if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
        }
        let primaryDeckId: string | null = null;
        let topCount = 0;
        for (const [deckIdEntry, count] of counts) {
          if (count > topCount) {
            primaryDeckId = deckIdEntry;
            topCount = count;
          }
        }
        const { data: inserted, error: insertErr } = await supabase
          .from("readings")
          .insert({
            user_id: userId,
            spread_type: data.spread,
            card_ids: data.picks.map((p) => p.cardIndex),
            card_orientations: data.picks.map((p) => p.isReversed ?? false),
            // EK31 — Per-card deck attribution + primary deck for the row.
            card_deck_ids: cardDeckIds,
            deck_id: primaryDeckId,
            // EK31 — Mirror the import-batch path's metadata so manual
            // entries show up correctly in entry-mode filters and admin
            // queries.
            entry_mode: "manual",
            mode: "personal",
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
