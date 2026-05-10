import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SPREAD_META, isValidSpreadMode } from "@/lib/spreads";
import { getCardName } from "@/lib/tarot";
import { buildGuideSystemPrompt } from "@/lib/guides";
import { callAI, isUserPremium } from "@/lib/ai-call.server";

/**
 * Map a Lens id (UI-facing kebab-case) to the snapshot_type column value
 * (snake_case) used in `memory_snapshots`. Anything unknown falls through
 * to deeper_threads — the safest middle ground.
 */
function snapshotTypeForLens(
  lensId: string | undefined,
): "recent_echoes" | "deeper_threads" | "full_archive" {
  switch (lensId) {
    case "recent-echoes":
      return "recent_echoes";
    case "full-archive":
      return "full_archive";
    case "deeper-threads":
    default:
      return "deeper_threads";
  }
}

const InterpretInput = z.object({
  spread: z.string().refine(isValidSpreadMode, "Unknown spread"),
  picks: z
    .array(
      z.object({
        id: z.number().int(),
        cardIndex: z.number().int().min(0).max(77),
        // Phase 9.55 — optional so older clients keep working. Missing
        // means upright. The server stores the parallel array on the
        // readings row and threads orientation into the AI prompt.
        isReversed: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(10),
  /**
   * Phase 5 Guides — optional so older clients (and any cached fetch
   * already in flight when this lands) keep working. The prompt builder
   * falls back to The Moon Oracle / Deeper Threads when missing.
   */
  guideId: z.string().optional(),
  lensId: z.string().optional(),
  facetIds: z.array(z.string()).max(5).optional(),
  /**
   * Dev override: bypass the daily-quota check on this request. Used by
   * the "Submit Anyway" affordance under the limit-reached message so we
   * can still iterate on readings while testing. Premium gating (Phase
   * 10) will replace this knob with a proper entitlement check.
   */
  allowOverride: z.boolean().optional(),
  /**
   * The seeker's question for this draw, surfaced from the home-screen
   * QuestionBox. Optional — readings may be done without one.
   */
  question: z.string().max(500).optional(),
});

export type InterpretedPosition = {
  position: string;
  card: string;
  interpretation: string;
};

export type InterpretationPayload = {
  overview: string;
  positions: InterpretedPosition[];
  closing: string;
};

export type InterpretSuccess = {
  ok: true;
  readingId: string;
  interpretation: InterpretationPayload;
};

export type InterpretError = {
  ok: false;
  /** Stable codes the UI can branch on. */
  error: "daily_limit_reached" | "ai_unavailable" | "invalid_response" | "internal";
  message: string;
};

/**
 * Server-side gate + Claude call. Lives in `.functions.ts` so the TanStack
 * server-fn plugin replaces the body with an RPC stub for the client bundle
 * (the ANTHROPIC_API_KEY never reaches the browser).
 */
export const interpretReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InterpretInput.parse(raw))
  .handler(async ({ data, context }): Promise<InterpretSuccess | InterpretError> => {
    // Top-level safety net — every code path inside should already return
    // a typed InterpretError, but if anything unexpectedly throws (network
    // panics, runtime quirks) we still want a structured response so the
    // UI can show its error state instead of hanging on "Reading…".
    try {
      const { supabase, userId } = context;
      const spread = data.spread as keyof typeof SPREAD_META;
      const meta = SPREAD_META[spread];
      console.log("[interpretReading] start", { userId, spread, picks: data.picks.length });

      // Standard readings are unlimited for all users (free + premium).
      // Only Deep Readings are gated (1 per dawn cycle for free users),
      // enforced separately in interpret-deep-reading.

      // 2. Build the user prompt from the picks + spread metadata.
      const positionLabels: string[] =
        meta.positions ?? data.picks.map((_, i) => `Card ${i + 1}`);
      // 26-05-08-Q — Fix 8: when the seeker has an active custom deck,
      // override the card name with their per-card label and append any
      // user-authored description so the AI reads from the deck the
      // seeker is actually using.
      const customMetaByCardId = new Map<
        number,
        { name: string | null; description: string | null }
      >();
      try {
        const { data: activeDeck } = await supabase
          .from("custom_decks")
          .select("id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();
        const deckId = (activeDeck as { id?: string } | null)?.id ?? null;
        if (deckId) {
          const ids = data.picks.map((p) => p.cardIndex);
          const { data: rows } = await supabase
            .from("custom_deck_cards")
            .select("card_id, card_name, card_description")
            .eq("deck_id", deckId)
            .is("archived_at", null)
            .in("card_id", ids);
          for (const r of (rows ?? []) as Array<{
            card_id: number;
            card_name: string | null;
            card_description: string | null;
          }>) {
            customMetaByCardId.set(r.card_id, {
              name: r.card_name,
              description: r.card_description,
            });
          }
        }
      } catch (e) {
        console.warn("[interpretReading] custom deck meta lookup failed", e);
      }
      const lines = data.picks.map((p, i) => {
        const meta = customMetaByCardId.get(p.cardIndex);
        const name =
          (meta?.name && meta.name.trim()) || getCardName(p.cardIndex);
        const label = positionLabels[i] ?? `Card ${i + 1}`;
        const head = `- ${label}: ${p.isReversed ? `${name} (reversed)` : name}`;
        const desc = meta?.description?.trim();
        return desc ? `${head}\n    Seeker's notes on this card: ${desc}` : head;
      });
      const userPrompt = `Spread: ${meta.label}\nCards drawn:\n${lines.join("\n")}\n\nPlease interpret this reading.`;
      const userPromptWithQuestion = data.question
        ? `${userPrompt}\n\nThe seeker's question: "${data.question}"`
        : userPrompt;

      // Build the per-request system prompt from the active Guide / Lens /
      // Facets. Falls back to defaults when the client did not send them.
      const systemPrompt = buildGuideSystemPrompt({
        guideId: data.guideId,
        lensId: data.lensId,
        facetIds: data.facetIds ?? [],
      });

      // Phase 9.55 — when any drawn card is reversed, prepend a brief
      // instruction so the model interprets reversal as nuance rather
      // than negation. We only add this when reversals are present so
      // upright-only readings stay token-clean.
      const hasReversed = data.picks.some((p) => p.isReversed);
      const systemPromptWithReversal = hasReversed
        ? `${systemPrompt}\n\nWhen a card is marked (reversed), interpret it with awareness of reversal — its energy may be blocked, internalized, delayed, or expressed as its shadow. Reversed does not mean negative; it means nuanced.`
        : systemPrompt;

      // ---- Memory context (Phase 7) -----------------------------------
      // If the user has memory_ai_permission enabled and a non-expired
      // snapshot exists for the chosen Lens, prepend it to the user prompt
      // as symbolic context. Strictly summaries — never raw past
      // interpretation text. All failures are silent: a missing snapshot
      // simply means the model gets no memory this turn.
      let memoryPreamble = "";
      try {
        const { data: prefs } = await supabase
          .from("user_preferences")
          .select("memory_ai_permission")
          .eq("user_id", userId)
          .maybeSingle();
        const permitted =
          (prefs as { memory_ai_permission?: boolean } | null)
            ?.memory_ai_permission !== false;
        if (permitted) {
          const snapshotType = snapshotTypeForLens(data.lensId);
          const { data: snap } = await supabase
            .from("memory_snapshots")
            .select("active_patterns_summary, active_threads_summary, expires_at")
            .eq("snapshot_type", snapshotType)
            .maybeSingle();
          const snapshot = snap as
            | {
                active_patterns_summary: string | null;
                active_threads_summary: string | null;
                expires_at: string;
              }
            | null;
          const isFresh =
            snapshot && new Date(snapshot.expires_at).getTime() > Date.now();
          if (isFresh) {
            const parts: string[] = [];
            if (snapshot.active_patterns_summary) {
              parts.push(
                `Recurring patterns in this seeker's practice:\n${snapshot.active_patterns_summary}`,
              );
            }
            if (snapshot.active_threads_summary) {
              parts.push(
                `Active symbolic threads:\n${snapshot.active_threads_summary}`,
              );
            }
            if (parts.length > 0) {
              memoryPreamble = `Symbolic memory (for context, do not quote literally):\n${parts.join("\n\n")}\n\n`;
            }
          }
        }
      } catch (e) {
        console.warn("[interpretReading] memory lookup failed (non-fatal)", e);
      }

      const userPromptWithMemory = memoryPreamble
        ? `${memoryPreamble}${userPromptWithQuestion}`
        : userPromptWithQuestion;

      // 3. Call AI through the metered chokepoint.
      const maxTokens = Math.min(4096, 600 + data.picks.length * 150);
      const isPremium = await isUserPremium(userId);
      const aiResult = await callAI({
        callType: "interpretation",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        userId,
        isPremium,
        messages: [{ role: "user", content: userPromptWithMemory }],
        system: systemPromptWithReversal,
        maxTokens,
      });
      if (!aiResult.ok) {
        if (aiResult.error === "quota_exceeded" || aiResult.error === "ai_disabled" || aiResult.error === "rate_limited") {
          return { ok: false, error: "daily_limit_reached", message: "You've reached your AI quota for this cycle." };
        }
        return { ok: false, error: "ai_unavailable", message: "The reader could not be reached. Please try again." };
      }
      const rawText = aiResult.content;

      // 4. Parse the JSON response. Models occasionally wrap output in
      // ```json fences even when told not to — strip them defensively.
      let interpretation: InterpretationPayload;
      try {
        const cleaned = rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        interpretation = JSON.parse(cleaned) as InterpretationPayload;

        if (
          typeof interpretation.overview !== "string" ||
          typeof interpretation.closing !== "string" ||
          !Array.isArray(interpretation.positions)
        ) {
          throw new Error("Malformed interpretation shape");
        }
      } catch (parseErr) {
        console.error("[interpretReading] JSON parse failed", {
          error: parseErr,
          rawText: rawText.slice(0, 1000),
        });
        return {
          ok: false,
          error: "invalid_response",
          message: "The reading came back garbled. Please try again.",
        };
      }

      // 5. Persist the reading. RLS ensures user_id must equal auth.uid().
      try {
        const { data: inserted, error: insertErr } = await supabase
          .from("readings")
          .insert({
            user_id: userId,
            spread_type: spread,
            card_ids: data.picks.map((p) => p.cardIndex),
            card_orientations: data.picks.map((p) => p.isReversed ?? false),
            interpretation: JSON.stringify(interpretation),
            question: data.question ?? null,
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          console.error("[interpretReading] insert failed", insertErr);
          return { ok: false, error: "internal", message: "Could not save reading." };
        }

        console.log("[interpretReading] success", { readingId: inserted.id });
        return { ok: true, readingId: inserted.id, interpretation };
      } catch (insertThrow) {
        console.error("[interpretReading] insert threw", insertThrow);
        return { ok: false, error: "internal", message: "Could not save reading." };
      }
    } catch (unexpected) {
      // Last-resort safety net — guarantees the client never hangs because
      // a server function rejected with no JSON body.
      console.error("[interpretReading] unexpected failure", unexpected);
      return {
        ok: false,
        error: "internal",
        message: "Something went wrong. Please try again.",
      };
    }
  });