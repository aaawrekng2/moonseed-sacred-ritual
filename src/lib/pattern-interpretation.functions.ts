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
  /**
   * 9-6-AH continuation — bold declarative WHY headline. 1-2 sentences,
   * names the cards by name, names the theme. Rendered first, large
   * italic accent, as the elevator pitch for why this story exists.
   */
  whyHeadline?: string;
  /** 9-6-AC — short tarot-voice description of the recurring story. */
  whatThisIs?: string;
  /** 9-6-AC — short tarot-voice reading of why this story is here now. */
  whatItCouldMean?: string;
  /** Legacy synthesis paragraph (pre-9-6-AC saved interpretations). */
  body?: string;
  key_cards: { card: string; meaning: string }[];
  reflective_prompts: string[];
  /**
   * 26-05-08-J — 2-4 verbatim phrases pulled from the seeker's
   * questions/notes across the readings in this pattern. Each entry
   * carries the source reading id + ISO date for attribution.
   */
  yourWords?: Array<{
    quote: string;
    source: "question" | "note";
    readingId: string;
    date: string;
  }>;
  /**
   * 9-6-AH continuation — per-reading connector sentence. One entry per
   * reading id linked to the pattern, explaining why THAT specific
   * reading belongs to this story.
   */
  readingConnections?: Array<{ readingId: string; connector: string }>;
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
        .select("id, created_at, spread_type, card_ids, interpretation, question, note")
        .in("id", readingIds)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      const rows = (readings ?? []) as Array<{
        id: string;
        created_at: string;
        spread_type: string;
        card_ids: number[];
        interpretation: string | null;
        question: string | null;
        note: string | null;
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
        const note = (r.note ?? "").trim().slice(0, 200);
        return `Reading ${i + 1} id=${r.id} (${date}, ${r.spread_type}) cards=${cards} question=${r.question ? '"' + r.question + '"' : "(none)"} note=${note ? '"' + note + '"' : "(none)"}\n${interp}`;
      });
      const userPrompt =
        `Story: "${pattern.name}"\n` +
        (pattern.description ? `Seeker's note: ${pattern.description}\n` : "") +
        `\nLinked readings (${rows.length}):\n\n${summaries.join("\n\n---\n\n")}\n\n` +
        `Reply ONLY with valid JSON of shape:\n` +
        `{ "whyHeadline": string, "whatThisIs": string, "whatItCouldMean": string, "key_cards": [{ "card": string, "meaning": string }], "reflective_prompts": [string, string, string], "yourWords": [{ "quote": string, "source": "question" | "note", "readingId": string, "date": string }], "readingConnections": [{ "readingId": string, "connector": string }] }\n\n` +
        `whyHeadline (1-2 sentences, BOLD AND DECLARATIVE): The single "why this story exists" line. Lead with the cards: e.g. "The Emperor and Tower keep emerging because authority structures are crumbling. The cards speak of foundations cracking, of choice meeting consequence." Be specific. Be vivid. NOT vague ("a pattern is forming"). Name the cards by name. Name the theme. This sentence is the entire elevator pitch for why this story exists.\n\n` +
        `whatThisIs (4-6 sentences): Name what the recurring story IS in vivid, image-rich tarot voice. Which cards return? What shape does the pattern carve in their practice? Lead with the spell — "A pattern stirs…" or "The cards keep returning to…" — then show the seeker the architecture of what's emerging. Be specific about cards, themes, what the seeker is being shown. Don't summarize; reveal.\n\n` +
        `whatItCouldMean (4-6 sentences): What is the seeker being asked to see, become, or release? Speak in possibilities, not predictions, but with conviction. Use imagery from the cards themselves — if Death recurs, speak of endings becoming gates; if the Tower keeps appearing, name the structures cracking. Two paragraphs of vivid invocation, not hedged advice. Tarot speaks. Let it speak.\n\n` +
        `key_cards: 2-4 cards that anchor the pattern, each with a 1-sentence meaning specific to THIS seeker's recurrence (not generic dictionary definition).\n\n` +
        `reflective_prompts: 3 questions that crack the seeker open. Not safe questions. Questions that touch the heart of what's surfacing.\n\n` +
        `yourWords (2-4 entries): From the seeker's questions and notes above, extract the most meaningful, evocative, or repeated phrases. Choose phrases that reveal the seeker's emotional core or the architecture of the pattern. NOT mundane ("good morning"). YES vivid and specific ("why does my father not see me?", "something has to break"). Return the EXACT phrase as the seeker wrote it. source="question" if pulled from a question, source="note" if from a note. readingId is the id of the reading containing this phrase. date is the ISO created_at of that reading. Cap quotes at ~120 characters; trim with ellipsis if longer. If there are no meaningful phrases, return an empty array.\n\n` +
        `readingConnections: For EACH reading id listed above, output one connector sentence — vivid, specific to THAT reading, explaining why it belongs to this story. NOT generic ("this reading shows the pattern"). Specific (e.g. "In this Celtic Cross, Death anchors the past — the seeker named what is dying first, then drew the Tower in the future."). Use the exact id strings from the listing.`;
      const systemPrompt =
        "You are a tarot oracle. You speak in invocational, present-tense, " +
        "image-rich tarot voice. Synthesize recurring patterns in a seeker's " +
        "readings. Lead with WHAT the story is and WHY it has appeared. " +
        "Avoid certainty about outcomes — tarot speaks in possibilities — " +
        "but DO speak with conviction about the imagery, the architecture " +
        "of what's emerging. Use the cards' own symbols. Be vivid, not safe. " +
        "Don't hedge into vague advice. Show, don't summarize. " +
        "Output strictly valid JSON, no commentary, no markdown fences.";
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
            max_tokens: 2500,
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
        !Array.isArray(parsed?.key_cards) ||
        !Array.isArray(parsed?.reflective_prompts) ||
        (typeof parsed?.whyHeadline !== "string" &&
          typeof parsed?.whatThisIs !== "string" &&
          typeof parsed?.body !== "string")
      ) {
        return { ok: false, error: "Interpretation was malformed." };
      }
      // 26-05-08-J — sanitize yourWords (filter malformed entries, cap 4).
      if (parsed.yourWords && Array.isArray(parsed.yourWords)) {
        parsed.yourWords = parsed.yourWords
          .filter(
            (w) =>
              typeof w?.quote === "string" &&
              w.quote.length > 0 &&
              (w.source === "question" || w.source === "note") &&
              typeof w?.readingId === "string" &&
              typeof w?.date === "string",
          )
          .slice(0, 4);
      } else {
        parsed.yourWords = [];
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