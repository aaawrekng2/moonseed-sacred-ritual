import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCardName } from "@/lib/tarot";

/**
 * 9-6-T — Synthesize a Story (Pattern) interpretation from its linked
 * readings. Saves the result on patterns.interpretation as JSON of
 * { body, key_cards, reflective_prompts }.
 */
const Input = z.object({
  patternId: z.string().uuid(),
  /** Force regeneration even if interpretation already saved. */
  force: z.boolean().optional(),
});

export type PatternInterpretation = {
  body: string;
  key_cards: { card: string; meaning: string }[];
  reflective_prompts: string[];
};

export type PatternInterpretResult =
  | { ok: true; interpretation: PatternInterpretation; cached: boolean }
  | { ok: false; error: string };

const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
] as const;

export const generatePatternInterpretation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<PatternInterpretResult> => {
    try {
      const { supabase, userId } = context;
      const { data: pattern, error: pErr } = await supabase
        .from("patterns")
        .select("id, name, description, reading_ids, interpretation")
        .eq("id", data.patternId)
        .eq("user_id", userId)
        .maybeSingle();
      if (pErr || !pattern) {
        return { ok: false, error: "Pattern not found." };
      }
      const existing = (pattern as { interpretation: PatternInterpretation | null })
        .interpretation;
      if (existing && !data.force) {
        return { ok: true, interpretation: existing, cached: true };
      }
      const readingIds = (pattern.reading_ids as string[]) ?? [];
      if (readingIds.length === 0) {
        return { ok: false, error: "No readings linked to this story yet." };
      }
      const { data: readings } = await supabase
        .from("readings")
        .select("id, created_at, spread_type, card_ids, interpretation")
        .in("id", readingIds)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      const rows = (readings ?? []) as Array<{
        id: string;
        created_at: string;
        spread_type: string;
        card_ids: number[];
        interpretation: string | null;
      }>;
      if (rows.length === 0) {
        return { ok: false, error: "Linked readings could not be loaded." };
      }
      const summaries = rows.map((r, i) => {
        const cards = (r.card_ids ?? [])
          .map((c) => getCardName(c))
          .join(", ");
        const date = new Date(r.created_at).toISOString().slice(0, 10);
        const interp = (r.interpretation ?? "").trim().slice(0, 800);
        return `Reading ${i + 1} (${date}, ${r.spread_type}): ${cards}\n${interp}`;
      });
      const userPrompt =
        `Story: "${pattern.name}"\n` +
        (pattern.description ? `Seeker's note: ${pattern.description}\n` : "") +
        `\nLinked readings (${rows.length}):\n\n${summaries.join("\n\n---\n\n")}\n\n` +
        `Synthesize this story. Reply ONLY with valid JSON of shape:\n` +
        `{ "body": string, "key_cards": [{ "card": string, "meaning": string }], "reflective_prompts": [string, string, string] }\n` +
        `body: 2-3 short paragraphs naming the through-line. ` +
        `key_cards: 2-4 cards that recur or carry the most weight. ` +
        `reflective_prompts: 3 brief questions for the seeker.`;
      const systemPrompt =
        "You are a contemplative tarot reader synthesizing a recurring " +
        "pattern across multiple readings. Speak warmly, in plain prose. " +
        "Never moralize. Output strictly valid JSON, no commentary.";
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return { ok: false, error: "Interpreter not configured." };
      let rawText = "";
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
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
        });
        if (!resp.ok) {
          if (resp.status === 404 || resp.status === 410) continue;
          return { ok: false, error: "Interpreter unreachable." };
        }
        const json = (await resp.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        rawText = json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
        if (rawText) break;
      }
      if (!rawText) return { ok: false, error: "Interpreter returned nothing." };
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      let parsed: PatternInterpretation;
      try {
        parsed = JSON.parse(cleaned) as PatternInterpretation;
      } catch {
        return { ok: false, error: "Interpretation was not valid JSON." };
      }
      if (
        typeof parsed?.body !== "string" ||
        !Array.isArray(parsed?.key_cards) ||
        !Array.isArray(parsed?.reflective_prompts)
      ) {
        return { ok: false, error: "Interpretation was malformed." };
      }
      await supabase
        .from("patterns")
        .update({ interpretation: parsed })
        .eq("id", data.patternId)
        .eq("user_id", userId);
      return { ok: true, interpretation: parsed, cached: false };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error.",
      };
    }
  });