/**
 * 26-05-08-Q12 — Premium "tailored journaling prompt" generator.
 *
 * One short reflective question, generated from cards + spread + the
 * seeker's question. Uses Anthropic Haiku for cost. Result is cached
 * onto `readings.tailored_prompt` so subsequent visits skip the call.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCardName } from "@/lib/tarot";
import { SPREAD_META } from "@/lib/spreads";

const Input = z.object({
  readingId: z.string().uuid(),
});

const HAIKU_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-3-5-haiku-20241022",
];

export const generateTailoredPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, user } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      user: { id: string };
    };

    // Premium gate
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("is_premium")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!(prefs as { is_premium?: boolean } | null)?.is_premium) {
      return { ok: false as const, error: "premium_required" };
    }

    const { data: reading } = await supabase
      .from("readings")
      .select("id, user_id, card_ids, card_orientations, spread_type, question, tailored_prompt")
      .eq("id", data.readingId)
      .maybeSingle();
    if (!reading || (reading as { user_id: string }).user_id !== user.id) {
      return { ok: false as const, error: "not_found" };
    }
    const r = reading as {
      id: string;
      card_ids: number[];
      card_orientations: boolean[];
      spread_type: string;
      question: string | null;
      tailored_prompt: string | null;
    };
    if (r.tailored_prompt) {
      return { ok: true as const, prompt: r.tailored_prompt, cached: true };
    }
    const question = (r.question ?? "").trim();
    if (!question) {
      return { ok: false as const, error: "question_required" };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "ai_unavailable" };
    }

    const spreadLabel =
      (SPREAD_META as Record<string, { label?: string }>)[r.spread_type]?.label ??
      r.spread_type;
    const cardLines = r.card_ids
      .map((cid, i) => {
        const reversed = r.card_orientations?.[i] ? " (reversed)" : "";
        return `- ${getCardName(cid)}${reversed}`;
      })
      .join("\n");

    const system =
      "You generate a single reflective journaling prompt for a tarot reading. " +
      "The prompt should be open-ended, second-person, introspective, around 80-150 characters. " +
      "Return ONLY the prompt text — no preamble, no quotation marks, no trailing period if it isn't a complete sentence.";
    const userMsg =
      `Spread: ${spreadLabel}\nCards:\n${cardLines}\nSeeker's question: ${question}\n\n` +
      `Write one personalized journaling prompt that helps the seeker reflect on this reading in light of their question.`;

    let text = "";
    for (const model of HAIKU_MODELS) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 100,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      if (!resp.ok) {
        if (resp.status === 404 || resp.status === 410) continue;
        const errText = await resp.text().catch(() => "");
        console.error("[tailored-prompt] anthropic error", resp.status, errText.slice(0, 300));
        return { ok: false as const, error: "ai_unavailable" };
      }
      const json = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      text = (json.content?.find((c) => c.type === "text")?.text ?? "").trim();
      if (text) break;
    }
    text = text.replace(/^["'""]+|["'""]+$/g, "").trim();
    if (!text) {
      return { ok: false as const, error: "ai_unavailable" };
    }

    await supabase
      .from("readings")
      .update({ tailored_prompt: text })
      .eq("id", r.id)
      .eq("user_id", user.id);

    return { ok: true as const, prompt: text, cached: false };
  });