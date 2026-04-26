import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SPREAD_META, isValidSpreadMode } from "@/lib/spreads";
import { getCardName } from "@/lib/tarot";
import { buildGuideSystemPrompt } from "@/lib/guides";

/** Maximum readings any single user may create in a UTC day. */
const DAILY_LIMIT = 3;

const InterpretInput = z.object({
  spread: z.string().refine(isValidSpreadMode, "Unknown spread"),
  picks: z
    .array(
      z.object({
        id: z.number().int(),
        cardIndex: z.number().int().min(0).max(77),
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

const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
] as const;

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

      // 1. Enforce the 3/day UTC limit using the user's own RLS-scoped client.
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const { count, error: countErr } = await supabase
        .from("readings")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString());

      if (countErr) {
        console.error("[interpretReading] daily-count query failed", countErr);
        return { ok: false, error: "internal", message: "Could not check daily quota." };
      }
      if ((count ?? 0) >= DAILY_LIMIT) {
        console.log("[interpretReading] daily limit reached", { count });
        return {
          ok: false,
          error: "daily_limit_reached",
          message: "You have drawn your three readings for today.",
        };
      }

      // 2. Build the user prompt from the picks + spread metadata.
      const positionLabels: string[] =
        meta.positions ?? data.picks.map((_, i) => `Card ${i + 1}`);
      const lines = data.picks.map(
        (p, i) => `- ${positionLabels[i] ?? `Card ${i + 1}`}: ${getCardName(p.cardIndex)}`,
      );
      const userPrompt = `Spread: ${meta.label}\nCards drawn:\n${lines.join("\n")}\n\nPlease interpret this reading.`;

      // Build the per-request system prompt from the active Guide / Lens /
      // Facets. Falls back to defaults when the client did not send them.
      const systemPrompt = buildGuideSystemPrompt({
        guideId: data.guideId,
        lensId: data.lensId,
        facetIds: data.facetIds ?? [],
      });

      // 3. Call the Anthropic Messages API.
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.error("[interpretReading] ANTHROPIC_API_KEY is not set");
        return { ok: false, error: "ai_unavailable", message: "Interpreter is not configured." };
      }

      let rawText = "";
      let lastProviderError = "";
      // Scale max_tokens with spread size so large spreads (Celtic Cross
      // = 10 cards) don't get cut off mid-JSON. Base 600 tokens overhead
      // + 150 per position. Celtic = 600 + 1500 = 2100. Cap at 4096.
      const maxTokens = Math.min(4096, 600 + data.picks.length * 150);
      try {
        for (const model of ANTHROPIC_MODELS) {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              system: systemPrompt,
              messages: [{ role: "user", content: userPrompt }],
            }),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            lastProviderError = errText;
            console.error("[interpretReading] Anthropic API error", {
              model,
              status: resp.status,
              statusText: resp.statusText,
              body: errText.slice(0, 500),
            });

            // If a model has been retired or is not enabled for this key,
            // try the next currently-listed model before failing the reading.
            if (resp.status === 404 || resp.status === 410) {
              continue;
            }

            return {
              ok: false,
              error: "ai_unavailable",
              message: "The reader could not be reached. Please try again.",
            };
          }

          const json = (await resp.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          rawText =
            json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
          console.log("[interpretReading] Anthropic OK", { model, textLen: rawText.length });
          break;
        }

        if (!rawText) {
          console.error("[interpretReading] Anthropic exhausted all fallback models", {
            models: ANTHROPIC_MODELS,
            lastProviderError: lastProviderError.slice(0, 500),
          });
          return {
            ok: false,
            error: "ai_unavailable",
            message: "The reader could not be reached. Please try again.",
          };
        }
      } catch (networkErr) {
        console.error("[interpretReading] Anthropic network/fetch failure", networkErr);
        return {
          ok: false,
          error: "ai_unavailable",
          message: "The reader could not be reached. Please try again.",
        };
      }

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
            interpretation: JSON.stringify(interpretation),
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