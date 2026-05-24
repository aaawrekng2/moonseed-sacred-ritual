/**
 * EJ34 — Journal-prompt generation server functions.
 *
 * Generates per-card journal prompts for the seeker's custom decks.
 * Every card gets exactly 4 prompts, one per aspect slot defined on
 * the deck (deck.aspect_config). New text resets the parallel
 * prompt_status entry to null (pending review); user accepts (✓) or
 * rejects (✗) each one from the deck-edit page.
 *
 * Functions:
 *   - setDeckAspectConfig: save the 4 aspects + hydrating thoughts
 *   - setDeckVoiceGuide:   save the pasted external-AI voice guide
 *   - generateDeckPrompts: full pass over all eligible cards
 *   - regenerateAspect:    refresh one aspect column across all cards
 *   - regenerateCard:      refresh some / all slots on one card
 *   - regenerateRejected:  batch-regenerate every ✗-marked slot
 *   - updateCardPrompt:    inline edit one prompt slot
 *   - updatePromptStatus:  mark a single slot ✓ / ✗ / null
 *   - bulkPromptStatus:    mark many slots at once (column bulk-select)
 *   - exportDeckPromptsCsv: returns the CSV blob the user downloads
 *   - importDeckPromptsCsv: applies an edited CSV, diffing vs current
 *
 * Cost model: 1 credit per CARD per generation pass. Whether the AI
 * writes 1 prompt or 4 for that card, it's 1 credit (the model has
 * to load the card's context either way).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callAI } from "@/lib/ai-call.server";

/* ─────────────────────────────────────────────────────────────────
   Shared types & validators
   ───────────────────────────────────────────────────────────────── */

const AspectInput = z.object({
  name: z.string().min(1).max(40),
  hydrating_thought: z.string().min(0).max(500),
});
const AspectConfigInput = z.array(AspectInput).length(4);

type Aspect = z.infer<typeof AspectInput>;

type DeckRow = {
  id: string;
  user_id: string;
  name: string;
  aspect_config: Aspect[] | null;
  ai_voice_guide: string | null;
  deck_type: string;
};

type CardRow = {
  id: string;
  deck_id: string;
  user_id: string;
  card_id: number;
  card_name: string | null;
  card_description: string | null;
  journal_prompts: string[] | null;
  prompt_status: (string | null)[] | null;
};

/** Loads + authorizes a deck for the caller. Throws on miss / forbidden. */
async function loadOwnedDeck(deckId: string, userId: string): Promise<DeckRow> {
  const { data, error } = await supabaseAdmin
    .from("custom_decks")
    .select("id, user_id, name, aspect_config, ai_voice_guide, deck_type")
    .eq("id", deckId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Deck not found");
  const deck = data as unknown as DeckRow;
  if (deck.user_id !== userId) throw new Error("Forbidden");
  return deck;
}

/** Loads non-archived cards for a deck (no auth check here — caller
 *  must have already loaded the deck via loadOwnedDeck). */
async function loadDeckCards(deckId: string): Promise<CardRow[]> {
  const { data, error } = await supabaseAdmin
    .from("custom_deck_cards")
    .select(
      "id, deck_id, user_id, card_id, card_name, card_description, journal_prompts, prompt_status",
    )
    .eq("deck_id", deckId)
    .is("archived_at", null)
    .order("card_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CardRow[];
}

/* ─────────────────────────────────────────────────────────────────
   AI prompt construction
   ───────────────────────────────────────────────────────────────── */

/** Builds the system prompt the model uses for journal-prompt
 *  generation. Frames it in the seeker's voice, names the 4 aspects,
 *  and incorporates the optional voice guide. */
function buildSystemPrompt(deck: DeckRow): string {
  const aspects = deck.aspect_config ?? [];
  const aspectLines = aspects
    .map(
      (a, i) => `  Aspect ${i + 1} — ${a.name}: ${a.hydrating_thought || "(no hydrating thought)"}`,
    )
    .join("\n");
  const voiceBlock = deck.ai_voice_guide?.trim()
    ? `\n\nDeck voice guide (follow this carefully):\n${deck.ai_voice_guide.trim()}`
    : "";
  return `You are a journaling-prompt generator for a tarot/oracle deck named "${deck.name}".

For every card I send you, write exactly 4 journaling prompts, one for each of these aspects in this order:

${aspectLines}

Rules:
- Each prompt is 1-2 sentences.
- Second person ("you").
- Open-ended — invite reflection, never tell the reader what to feel.
- Stay specific to the card's description.
- Match the aspect's angle precisely; don't blur them together.
- No preamble, no "this card asks…", no quotation marks, no trailing periods on fragments.${voiceBlock}

Output: JSON only, in this exact shape:
{
  "results": [
    { "card_id": <number>, "prompts": ["aspect-1 prompt", "aspect-2 prompt", "aspect-3 prompt", "aspect-4 prompt"] },
    ...
  ]
}

No prose outside the JSON.`;
}

/** Builds the user message describing the batch of cards to process. */
function buildUserMessage(
  cards: Array<{ card_id: number; card_name: string; card_description: string }>,
): string {
  return (
    "Write 4 prompts for each of these cards:\n\n" +
    cards
      .map((c) => `card_id ${c.card_id} — "${c.card_name}"\n  ${c.card_description}`)
      .join("\n\n")
  );
}

/** Parses the AI response into a result map. Tolerant of code fences
 *  and stray prose, but requires valid JSON for the "results" array. */
function parseAiResponse(text: string): Map<number, string[]> {
  let body = text.trim();
  // Strip code fences if the model wrapped them.
  body = body
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  // Find the first '{' and last '}' to be forgiving of stray prose.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as {
      results?: Array<{ card_id?: number; prompts?: string[] }>;
    };
    const map = new Map<number, string[]>();
    for (const r of parsed.results ?? []) {
      if (typeof r.card_id !== "number") continue;
      if (!Array.isArray(r.prompts)) continue;
      const cleaned = r.prompts.slice(0, 4).map((p) => String(p ?? "").trim());
      while (cleaned.length < 4) cleaned.push("");
      map.set(r.card_id, cleaned);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Runs a single AI batch and returns the generated prompts per card.
 *  Cards not present in the AI response are silently dropped — the
 *  caller can retry with whatever is missing. */
async function runAiBatch(
  deck: DeckRow,
  userId: string,
  cards: CardRow[],
): Promise<
  { ok: true; map: Map<number, string[]>; credits: number } | { ok: false; error: string }
> {
  const cardPayload = cards
    .map((c) => ({
      card_id: c.card_id,
      card_name: c.card_name ?? "",
      card_description: c.card_description ?? "",
    }))
    .filter((c) => c.card_description.trim().length > 0);
  if (cardPayload.length === 0) {
    return { ok: true, map: new Map(), credits: 0 };
  }
  const system = buildSystemPrompt(deck);
  const userMsg = buildUserMessage(cardPayload);
  // Token budget — 4 prompts × ~120 chars = ~480 chars per card,
  // ~120 tokens. Plus JSON scaffolding ~20 tokens per card.
  // 10 cards => ~1400 tokens output. Allow 500/card to be safe.
  const maxTokens = Math.min(8000, Math.max(800, cardPayload.length * 500));
  const r = await callAI({
    callType: "journal_prompts",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    userId,
    isPremium: true,
    messages: [{ role: "user", content: userMsg }],
    system,
    maxTokens,
  });
  if (!r.ok) {
    const code =
      r.error === "quota_exceeded" || r.error === "ai_disabled" || r.error === "rate_limited"
        ? r.error
        : "ai_unavailable";
    return { ok: false, error: code };
  }
  const map = parseAiResponse(r.content);
  return { ok: true, map, credits: r.creditsConsumed };
}

/** Splits an array into chunks of `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const BATCH_SIZE = 8;

/* ─────────────────────────────────────────────────────────────────
   setDeckAspectConfig
   ───────────────────────────────────────────────────────────────── */

const SetAspectsInput = z.object({
  deckId: z.string().uuid(),
  aspects: AspectConfigInput,
});

export const setDeckAspectConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SetAspectsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await loadOwnedDeck(data.deckId, userId);
    const { error } = await supabaseAdmin
      .from("custom_decks")
      .update({ aspect_config: data.aspects } as never)
      .eq("id", data.deckId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ─────────────────────────────────────────────────────────────────
   setDeckVoiceGuide
   ───────────────────────────────────────────────────────────────── */

const SetVoiceGuideInput = z.object({
  deckId: z.string().uuid(),
  voiceGuide: z.string().max(8000).nullable(),
});

export const setDeckVoiceGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SetVoiceGuideInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await loadOwnedDeck(data.deckId, userId);
    const value = data.voiceGuide?.trim() || null;
    const { error } = await supabaseAdmin
      .from("custom_decks")
      .update({ ai_voice_guide: value } as never)
      .eq("id", data.deckId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ─────────────────────────────────────────────────────────────────
   generateDeckPrompts — full pass
   ───────────────────────────────────────────────────────────────── */

const GenerateDeckInput = z.object({
  deckId: z.string().uuid(),
  /** When true (default), skip cards that already have all 4
   *  prompts filled. Set false to force a full overwrite. */
  onlyMissing: z.boolean().optional(),
});

export const generateDeckPrompts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => GenerateDeckInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const deck = await loadOwnedDeck(data.deckId, userId);
    if (!deck.aspect_config || deck.aspect_config.length !== 4) {
      return { ok: false as const, error: "aspects_not_configured" };
    }
    const cards = await loadDeckCards(data.deckId);
    const eligible = cards.filter((c) => (c.card_description ?? "").trim().length > 0);
    if (eligible.length === 0) {
      return { ok: false as const, error: "no_descriptions" };
    }
    const onlyMissing = data.onlyMissing !== false; // default true
    const targets = onlyMissing
      ? eligible.filter(
          (c) =>
            !c.journal_prompts ||
            c.journal_prompts.length < 4 ||
            c.journal_prompts.some((p) => !p?.trim()),
        )
      : eligible;
    if (targets.length === 0) {
      return { ok: true as const, generated: 0, failed: 0, creditsUsed: 0 };
    }
    let generated = 0;
    let failed = 0;
    let creditsUsed = 0;
    const batches = chunk(targets, BATCH_SIZE);
    for (const b of batches) {
      const r = await runAiBatch(deck, userId, b);
      if (!r.ok) {
        failed += b.length;
        if (r.error === "quota_exceeded" || r.error === "ai_disabled") {
          // Stop early; no point hammering with more batches.
          return {
            ok: false as const,
            error: r.error,
            generated,
            failed,
            creditsUsed,
          };
        }
        continue;
      }
      creditsUsed += r.credits;
      for (const card of b) {
        const prompts = r.map.get(card.card_id);
        if (!prompts) {
          failed += 1;
          continue;
        }
        const status: (string | null)[] = [null, null, null, null];
        const { error } = await supabaseAdmin
          .from("custom_deck_cards")
          .update({
            journal_prompts: prompts,
            prompt_status: status,
          } as never)
          .eq("id", card.id);
        if (error) {
          failed += 1;
          continue;
        }
        generated += 1;
      }
    }
    return { ok: true as const, generated, failed, creditsUsed };
  });

/* ─────────────────────────────────────────────────────────────────
   regenerateAspect — one column across all cards
   ───────────────────────────────────────────────────────────────── */

const RegenAspectInput = z.object({
  deckId: z.string().uuid(),
  aspectIndex: z.number().int().min(0).max(3),
});

export const regenerateAspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RegenAspectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const deck = await loadOwnedDeck(data.deckId, userId);
    if (!deck.aspect_config || deck.aspect_config.length !== 4) {
      return { ok: false as const, error: "aspects_not_configured" };
    }
    const cards = await loadDeckCards(data.deckId);
    const eligible = cards.filter((c) => (c.card_description ?? "").trim().length > 0);
    if (eligible.length === 0) {
      return { ok: false as const, error: "no_descriptions" };
    }
    let updated = 0;
    let failed = 0;
    let creditsUsed = 0;
    const batches = chunk(eligible, BATCH_SIZE);
    for (const b of batches) {
      const r = await runAiBatch(deck, userId, b);
      if (!r.ok) {
        failed += b.length;
        if (r.error === "quota_exceeded" || r.error === "ai_disabled") {
          return {
            ok: false as const,
            error: r.error,
            updated,
            failed,
            creditsUsed,
          };
        }
        continue;
      }
      creditsUsed += r.credits;
      for (const card of b) {
        const fresh = r.map.get(card.card_id);
        if (!fresh) {
          failed += 1;
          continue;
        }
        const merged = [...(card.journal_prompts ?? ["", "", "", ""])];
        while (merged.length < 4) merged.push("");
        merged[data.aspectIndex] = fresh[data.aspectIndex] ?? "";
        const status = [...(card.prompt_status ?? [null, null, null, null])];
        while (status.length < 4) status.push(null);
        status[data.aspectIndex] = null;
        const { error } = await supabaseAdmin
          .from("custom_deck_cards")
          .update({
            journal_prompts: merged,
            prompt_status: status,
          } as never)
          .eq("id", card.id);
        if (error) {
          failed += 1;
          continue;
        }
        updated += 1;
      }
    }
    return { ok: true as const, updated, failed, creditsUsed };
  });

/* ─────────────────────────────────────────────────────────────────
   regenerateCard — one card, optionally a subset of slots
   ───────────────────────────────────────────────────────────────── */

const RegenCardInput = z.object({
  deckId: z.string().uuid(),
  cardId: z.number().int().min(0).max(10000),
  /** Which slots to regenerate. Omit / empty for all 4. */
  aspectIndices: z.array(z.number().int().min(0).max(3)).optional(),
});

export const regenerateCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RegenCardInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const deck = await loadOwnedDeck(data.deckId, userId);
    if (!deck.aspect_config || deck.aspect_config.length !== 4) {
      return { ok: false as const, error: "aspects_not_configured" };
    }
    const cards = await loadDeckCards(data.deckId);
    const card = cards.find((c) => c.card_id === data.cardId);
    if (!card) return { ok: false as const, error: "card_not_found" };
    if (!(card.card_description ?? "").trim()) {
      return { ok: false as const, error: "no_description" };
    }
    const r = await runAiBatch(deck, userId, [card]);
    if (!r.ok) return { ok: false as const, error: r.error };
    const fresh = r.map.get(card.card_id);
    if (!fresh) return { ok: false as const, error: "ai_unavailable" };
    const slots =
      data.aspectIndices && data.aspectIndices.length > 0
        ? Array.from(new Set(data.aspectIndices))
        : [0, 1, 2, 3];
    const merged = [...(card.journal_prompts ?? ["", "", "", ""])];
    while (merged.length < 4) merged.push("");
    const status = [...(card.prompt_status ?? [null, null, null, null])];
    while (status.length < 4) status.push(null);
    for (const i of slots) {
      merged[i] = fresh[i] ?? "";
      status[i] = null;
    }
    const { error } = await supabaseAdmin
      .from("custom_deck_cards")
      .update({
        journal_prompts: merged,
        prompt_status: status,
      } as never)
      .eq("id", card.id);
    if (error) return { ok: false as const, error: "db_error" };
    return {
      ok: true as const,
      updated: 1,
      slots: slots.length,
      creditsUsed: r.credits,
    };
  });

/* ─────────────────────────────────────────────────────────────────
   regenerateRejected — every ✗ across the deck
   ───────────────────────────────────────────────────────────────── */

const RegenRejectedInput = z.object({
  deckId: z.string().uuid(),
});

export const regenerateRejected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RegenRejectedInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const deck = await loadOwnedDeck(data.deckId, userId);
    if (!deck.aspect_config || deck.aspect_config.length !== 4) {
      return { ok: false as const, error: "aspects_not_configured" };
    }
    const cards = await loadDeckCards(data.deckId);
    // Identify cards that have at least one rejection AND a description.
    const targets = cards
      .filter((c) => (c.card_description ?? "").trim().length > 0)
      .filter((c) => (c.prompt_status ?? []).some((s) => s === "rejected"));
    if (targets.length === 0) {
      return { ok: true as const, updated: 0, failed: 0, creditsUsed: 0 };
    }
    let updated = 0;
    let failed = 0;
    let creditsUsed = 0;
    const batches = chunk(targets, BATCH_SIZE);
    for (const b of batches) {
      const r = await runAiBatch(deck, userId, b);
      if (!r.ok) {
        failed += b.length;
        if (r.error === "quota_exceeded" || r.error === "ai_disabled") {
          return {
            ok: false as const,
            error: r.error,
            updated,
            failed,
            creditsUsed,
          };
        }
        continue;
      }
      creditsUsed += r.credits;
      for (const card of b) {
        const fresh = r.map.get(card.card_id);
        if (!fresh) {
          failed += 1;
          continue;
        }
        const merged = [...(card.journal_prompts ?? ["", "", "", ""])];
        while (merged.length < 4) merged.push("");
        const status = [...(card.prompt_status ?? [null, null, null, null])];
        while (status.length < 4) status.push(null);
        // Replace only the rejected slots; keep approved + pending.
        let touched = 0;
        for (let i = 0; i < 4; i++) {
          if (status[i] === "rejected") {
            merged[i] = fresh[i] ?? "";
            status[i] = null;
            touched += 1;
          }
        }
        if (touched === 0) continue;
        const { error } = await supabaseAdmin
          .from("custom_deck_cards")
          .update({
            journal_prompts: merged,
            prompt_status: status,
          } as never)
          .eq("id", card.id);
        if (error) {
          failed += 1;
          continue;
        }
        updated += 1;
      }
    }
    return { ok: true as const, updated, failed, creditsUsed };
  });

/* ─────────────────────────────────────────────────────────────────
   updateCardPrompt — inline edit of one slot (auto-approves)
   ───────────────────────────────────────────────────────────────── */

const UpdateCardPromptInput = z.object({
  deckId: z.string().uuid(),
  cardId: z.number().int().min(0).max(10000),
  aspectIndex: z.number().int().min(0).max(3),
  prompt: z.string().max(500),
});

export const updateCardPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateCardPromptInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await loadOwnedDeck(data.deckId, userId);
    const cards = await loadDeckCards(data.deckId);
    const card = cards.find((c) => c.card_id === data.cardId);
    if (!card) return { ok: false as const, error: "card_not_found" };
    const merged = [...(card.journal_prompts ?? ["", "", "", ""])];
    while (merged.length < 4) merged.push("");
    merged[data.aspectIndex] = data.prompt.trim();
    const status = [...(card.prompt_status ?? [null, null, null, null])];
    while (status.length < 4) status.push(null);
    // Manual edits auto-approve — the edit IS the approval.
    status[data.aspectIndex] = data.prompt.trim() ? "approved" : null;
    const { error } = await supabaseAdmin
      .from("custom_deck_cards")
      .update({
        journal_prompts: merged,
        prompt_status: status,
      } as never)
      .eq("id", card.id);
    if (error) return { ok: false as const, error: "db_error" };
    return { ok: true as const };
  });

/* ─────────────────────────────────────────────────────────────────
   updatePromptStatus — accept / reject / clear a single slot
   ───────────────────────────────────────────────────────────────── */

const UpdateStatusInput = z.object({
  deckId: z.string().uuid(),
  cardId: z.number().int().min(0).max(10000),
  aspectIndex: z.number().int().min(0).max(3),
  status: z.enum(["approved", "rejected"]).nullable(),
});

export const updatePromptStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await loadOwnedDeck(data.deckId, userId);
    const cards = await loadDeckCards(data.deckId);
    const card = cards.find((c) => c.card_id === data.cardId);
    if (!card) return { ok: false as const, error: "card_not_found" };
    const status = [...(card.prompt_status ?? [null, null, null, null])];
    while (status.length < 4) status.push(null);
    status[data.aspectIndex] = data.status;
    const { error } = await supabaseAdmin
      .from("custom_deck_cards")
      .update({ prompt_status: status } as never)
      .eq("id", card.id);
    if (error) return { ok: false as const, error: "db_error" };
    return { ok: true as const };
  });

/* ─────────────────────────────────────────────────────────────────
   bulkPromptStatus — column-header bulk-select
   ───────────────────────────────────────────────────────────────── */

const BulkStatusInput = z.object({
  deckId: z.string().uuid(),
  aspectIndex: z.number().int().min(0).max(3),
  status: z.enum(["approved", "rejected"]).nullable(),
});

export const bulkPromptStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BulkStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await loadOwnedDeck(data.deckId, userId);
    const cards = await loadDeckCards(data.deckId);
    // Only touch cards that actually have a prompt in this slot.
    let updated = 0;
    for (const c of cards) {
      const prompts = c.journal_prompts ?? [];
      const promptAtIdx = (prompts[data.aspectIndex] ?? "").trim();
      if (!promptAtIdx) continue;
      const status = [...(c.prompt_status ?? [null, null, null, null])];
      while (status.length < 4) status.push(null);
      if (status[data.aspectIndex] === data.status) continue;
      status[data.aspectIndex] = data.status;
      const { error } = await supabaseAdmin
        .from("custom_deck_cards")
        .update({ prompt_status: status } as never)
        .eq("id", c.id);
      if (!error) updated += 1;
    }
    return { ok: true as const, updated };
  });

/* ─────────────────────────────────────────────────────────────────
   CSV import — accepts the user's edited CSV
   ───────────────────────────────────────────────────────────────── */

const ImportCsvInput = z.object({
  deckId: z.string().uuid(),
  csv: z.string().min(1).max(2_000_000),
});

/** Tiny CSV parser. RFC-4180 quoted fields + escaped quotes. No
 *  newline-in-field support beyond what RFC 4180 says (newlines
 *  inside quoted fields are honored). Returns rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

export const importDeckPromptsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ImportCsvInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await loadOwnedDeck(data.deckId, userId);
    const rows = parseCsv(data.csv);
    if (rows.length < 2) {
      return { ok: false as const, error: "empty_csv" };
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const cardIdIdx = header.indexOf("card_id");
    if (cardIdIdx < 0) {
      return { ok: false as const, error: "missing_card_id_column" };
    }
    // The 4 prompt columns are identified by their position in the
    // header: any column whose header begins with "aspect 1:", etc.
    // Fallback: the last 4 columns are treated as the 4 aspects in
    // order. This lets users edit headers manually without breaking.
    const promptColIdx: number[] = [-1, -1, -1, -1];
    for (let i = 0; i < header.length; i++) {
      const h = header[i];
      const m = h.match(/^aspect\s*(\d)/);
      if (m) {
        const slot = parseInt(m[1], 10) - 1;
        if (slot >= 0 && slot <= 3) promptColIdx[slot] = i;
      }
    }
    // Backfill any unset slots with the trailing columns in order.
    if (promptColIdx.some((i) => i < 0)) {
      const trailing = header.length - 4;
      for (let s = 0; s < 4; s++) {
        if (promptColIdx[s] < 0 && trailing + s >= 0) {
          promptColIdx[s] = trailing + s;
        }
      }
    }
    if (promptColIdx.some((i) => i < 0 || i >= header.length)) {
      return { ok: false as const, error: "missing_prompt_columns" };
    }
    // Load existing cards once.
    const existing = await loadDeckCards(data.deckId);
    const byCardId = new Map<number, CardRow>();
    for (const c of existing) byCardId.set(c.card_id, c);
    let updatedCards = 0;
    let changedSlots = 0;
    let preservedSlots = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const idStr = (row[cardIdIdx] ?? "").trim();
      if (!idStr) continue;
      const cardId = parseInt(idStr, 10);
      if (Number.isNaN(cardId)) continue;
      const card = byCardId.get(cardId);
      if (!card) continue;
      const existingPrompts = [...(card.journal_prompts ?? ["", "", "", ""])];
      while (existingPrompts.length < 4) existingPrompts.push("");
      const existingStatus = [...(card.prompt_status ?? [null, null, null, null])];
      while (existingStatus.length < 4) existingStatus.push(null);
      const mergedPrompts = [...existingPrompts];
      const mergedStatus = [...existingStatus];
      let touched = false;
      for (let s = 0; s < 4; s++) {
        const newText = (row[promptColIdx[s]] ?? "").trim();
        const oldText = (existingPrompts[s] ?? "").trim();
        if (newText === oldText) {
          preservedSlots += 1;
          continue;
        }
        mergedPrompts[s] = newText;
        // New text resets status to pending. The user can re-approve.
        mergedStatus[s] = null;
        changedSlots += 1;
        touched = true;
      }
      if (!touched) continue;
      const { error } = await supabaseAdmin
        .from("custom_deck_cards")
        .update({
          journal_prompts: mergedPrompts,
          prompt_status: mergedStatus,
        } as never)
        .eq("id", card.id);
      if (error) continue;
      updatedCards += 1;
    }
    return {
      ok: true as const,
      updatedCards,
      changedSlots,
      preservedSlots,
    };
  });
