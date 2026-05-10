/**
 * 26-05-08-Q23 — Card Evidence prose generator.
 *
 * Server function that synthesizes a seeker's REAL reading-history
 * patterns for a given symbolic_thread into a short paragraph of
 * reflective prose. Layered:
 *   - Layer 1 (free): tarot patterns — frequency, position bias,
 *     co-occurrence, seeker question quotes.
 *   - Layer 2 (premium): adds moon-phase observations.
 *
 * Cached on `symbolic_threads.evidence_prose` and only regenerated
 * when the thread's recurrence_count grows or the prompt version
 * bumps. Hallucination-guarded: any tarot card name in the AI prose
 * that isn't in the thread's evidence list triggers a deterministic
 * fallback.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCardName, TAROT_DECK } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { callAnthropicWithFallback } from "@/lib/ai-call.server";

const Input = z.object({
  threadId: z.string().uuid(),
  forceRegenerate: z.boolean().optional(),
});

const SONNET_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514",
];

const PROSE_VERSION = 2;

type ReadingRow = {
  id: string;
  created_at: string;
  spread_type: string;
  card_ids: number[];
  card_orientations: boolean[] | null;
  question: string | null;
  note: string | null;
  moon_phase: string | null;
  tags: string[] | null;
};

type PerCard = {
  cardId: number;
  cardName: string;
  count: number;
  positions: string[];
  reversedCount: number;
  coOccurrence: Record<string, number>;
  moonDist: Record<string, number>;
  questions: string[];
  firstAppearance: string | null;
  lastAppearance: string | null;
};

type SeekerContext = {
  readings: ReadingRow[];
  totalReadings: number;
  perCard: PerCard[];
  isPremium: boolean;
};

type ThreadRow = {
  id: string;
  user_id: string;
  pattern_id: string | null;
  card_ids: number[];
  recurrence_count: number;
  evidence_prose: string | null;
  evidence_prose_version: number | null;
  evidence_prose_layers: Record<string, unknown> | null;
  evidence_prose_reading_count: number | null;
  title: string | null;
};

export type CardEvidenceResult =
  | { ok: true; prose: string; cached: boolean; isPremium?: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "forbidden"
        | "insufficient_data"
        | "ai_unavailable";
    };

export const generateCardEvidenceProse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CardEvidenceResult> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    console.log(`[card-evidence-fn] handler starting`, {
      threadId: data.threadId,
      userId,
      forceRegenerate: data.forceRegenerate ?? false,
    });

    // 1. Premium status (drives Layer 2 inclusion)
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("is_premium")
      .eq("user_id", userId)
      .maybeSingle();
    const isPremium = !!(prefs as { is_premium?: boolean } | null)?.is_premium;

    // 2. Load the thread + verify ownership
    const { data: threadRow } = await supabase
      .from("symbolic_threads")
      .select(
        "id, user_id, pattern_id, card_ids, recurrence_count, evidence_prose, evidence_prose_version, evidence_prose_layers, evidence_prose_reading_count, title",
      )
      .eq("id", data.threadId)
      .maybeSingle();
    if (!threadRow) return { ok: false, error: "not_found" };
    const t = threadRow as unknown as ThreadRow;
    if (t.user_id !== userId) return { ok: false, error: "forbidden" };
    console.log(`[card-evidence-fn] thread loaded`, {
      cardIds: t.card_ids,
      recurrence: t.recurrence_count,
      cachedVersion: t.evidence_prose_version,
      cachedReadingCount: t.evidence_prose_reading_count,
    });

    // 3. Cache hit check
    if (
      !data.forceRegenerate &&
      t.evidence_prose &&
      t.evidence_prose_version === PROSE_VERSION &&
      t.evidence_prose_reading_count === t.recurrence_count
    ) {
      return { ok: true, prose: t.evidence_prose, cached: true };
    }

    // 4. Assemble context — load all readings that include any of
    //    this thread's cards.
    const ctx = await assembleSeekerContext({
      supabase,
      userId,
      cardIds: t.card_ids,
      isPremium,
    });
    console.log(`[card-evidence-fn] context assembled`, {
      totalReadings: ctx.totalReadings,
      matchedReadings: ctx.readings.length,
    });

    if (ctx.readings.length < 2) {
      // Not enough data for meaningful synthesis. Skip AI call.
      return { ok: false, error: "insufficient_data" };
    }

    // 5. Build prompt
    const prompt = buildCardEvidencePrompt({
      threadCards: t.card_ids,
      context: ctx,
      isPremium,
    });

    // 6. Call Anthropic Sonnet via metered chokepoint.
    const aiResult = await callAnthropicWithFallback({
      callType: "card_evidence",
      userId,
      isPremium,
      system: prompt.system,
      user: prompt.user,
      maxTokens: 1200,
      models: SONNET_MODELS,
    });
    if (!aiResult.ok) {
      return { ok: false, error: aiResult.error === "quota_exceeded" ? "quota_exceeded" : "ai_unavailable" };
    }
    let prose = aiResult.content;
    console.log(`[card-evidence-fn] anthropic call done`, {
      proseLength: prose.length,
      preview: prose.slice(0, 100),
    });

    // 7. Hallucination guard — verify only thread cards are mentioned
    const validated = validateProseAgainstThread(prose, t.card_ids);
    console.log(`[card-evidence-fn] validation`, validated);
    if (!validated.ok) {
      console.warn(
        "[card-evidence] hallucination guard rejected",
        validated.violations,
      );
      prose = buildDeterministicFallback(t.card_ids, t.recurrence_count, ctx);
    }

    // 8. Cache the result
    await supabase
      .from("symbolic_threads")
      .update({
        evidence_prose: prose,
        evidence_prose_version: PROSE_VERSION,
        evidence_prose_layers: {
          layer1: prose,
          layer1_at: new Date().toISOString(),
          included_layer2: isPremium,
        },
        evidence_prose_generated_at: new Date().toISOString(),
        evidence_prose_reading_count: t.recurrence_count,
      } as never)
      .eq("id", t.id)
      .eq("user_id", userId);

    return { ok: true, prose, cached: false, isPremium };
  });

// ─── helpers ────────────────────────────────────────────────────────────

async function assembleSeekerContext({
  supabase,
  userId,
  cardIds,
  isPremium,
}: {
  supabase: SupabaseClient;
  userId: string;
  cardIds: number[];
  isPremium: boolean;
}): Promise<SeekerContext> {
  const { data: readingsRaw } = await supabase
    .from("readings")
    .select(
      "id, created_at, spread_type, card_ids, card_orientations, question, note, moon_phase, tags",
    )
    .eq("user_id", userId)
    .overlaps("card_ids", cardIds)
    .order("created_at", { ascending: true });

  const readings = ((readingsRaw ?? []) as unknown as ReadingRow[]).filter(
    (r) => Array.isArray(r.card_ids),
  );

  const { count: totalReadings } = await supabase
    .from("readings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const perCard: PerCard[] = cardIds.map((cardId) => {
    const matches = readings.filter((r) => r.card_ids.includes(cardId));
    const positions = matches
      .map((r) => {
        const idx = r.card_ids.indexOf(cardId);
        const meta = SPREAD_META[r.spread_type as SpreadMode];
        return meta?.positions?.[idx] ?? null;
      })
      .filter((p): p is string => !!p);
    const reversedCount = matches.filter((r) => {
      const idx = r.card_ids.indexOf(cardId);
      return r.card_orientations?.[idx] === true;
    }).length;
    const coOccurrence = computeCoOccurrence(matches, cardId);
    const moonDist = matches.reduce<Record<string, number>>((acc, r) => {
      const phase = r.moon_phase ?? "unknown";
      acc[phase] = (acc[phase] ?? 0) + 1;
      return acc;
    }, {});
    const questions = matches
      .map((r) => r.question?.trim())
      .filter((q): q is string => !!q && q.length > 0)
      .slice(0, 5);
    return {
      cardId,
      cardName: getCardName(cardId),
      count: matches.length,
      positions,
      reversedCount,
      coOccurrence,
      moonDist,
      questions,
      firstAppearance: matches[0]?.created_at ?? null,
      lastAppearance: matches[matches.length - 1]?.created_at ?? null,
    };
  });

  return {
    readings,
    totalReadings: totalReadings ?? 0,
    perCard,
    isPremium,
  };
}

function buildCardEvidencePrompt({
  threadCards: _threadCards,
  context,
  isPremium,
}: {
  threadCards: number[];
  context: SeekerContext;
  isPremium: boolean;
}) {
  const system =
    `You write reflective Card Evidence prose for a tarot journaling app called Moonseed.
Your job is to synthesize REAL PATTERNS from a seeker's reading history into short,
evocative paragraphs that help them see what their cards have been telling them.

STRICT RULES:
1. ONLY discuss cards in the EVIDENCE LIST provided. Never introduce, mention, or
   imply cards outside this list. Hallucinated cards are unacceptable.
2. Write one paragraph per card in the EVIDENCE LIST, in the order given (descending
   frequency).
3. Each paragraph: 80-150 words. Use the seeker's real data — actual frequencies,
   actual question text, actual position bias, actual co-occurrence patterns.
4. Refer to the seeker as "you" / "your". Never third-person.
5. Tone: reflective, observational, slightly mystical, never preachy. Like a wise
   friend who has been paying attention.
6. Quote the seeker's actual question text in quotation marks when it adds insight.
   Maximum once per paragraph.
7. Do NOT use generic tarot meanings. Use the seeker's OWN patterns.
8. Output plain text paragraphs separated by a blank line. No markdown headers, no
   card name labels, no bullet points.
9. End each paragraph with a quiet observation, not a directive.

STRUCTURE PER PARAGRAPH (Layer 1 — free):
- Open with the card name and frequency ("appeared N of M readings")
- Note position bias ("twice in Past positions, three times in Outcome")
- Note co-occurrence ("often paired with X")
- Reference the seeker's questions if relevant
- Close with a quiet pattern observation
` +
    (isPremium
      ? `
STRUCTURE PER PARAGRAPH (Layer 2 — premium ADDS to Layer 1):
- Where moon phase distribution is non-uniform, add a sentence about lunar timing
- If first appearance was within 3 days of a major lunar event, mention it
- Treat moon correlations as observations, not predictions
`
      : "");

  const evidenceList = context.perCard
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((card, idx) => {
      const positionBias =
        card.positions.length > 0
          ? formatPositionBias(card.positions)
          : "no consistent position";
      const reversedRate =
        card.count > 0
          ? Math.round((card.reversedCount / card.count) * 100)
          : 0;
      const topCoOccur = Object.entries(card.coOccurrence)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${getCardName(parseInt(id, 10))} (${n}x)`)
        .join(", ");
      const topMoonPhase = Object.entries(card.moonDist).sort(
        (a, b) => b[1] - a[1],
      )[0];
      const moonNote =
        isPremium && topMoonPhase
          ? `\n      Moon phase distribution: ${formatMoonDist(card.moonDist)}`
          : "";
      const questionsList =
        card.questions.length > 0
          ? `\n      Seeker questions in these readings: ${card.questions
              .map((q) => `"${q}"`)
              .join("; ")}`
          : "";
      return (
        `${idx + 1}. ${card.cardName}\n` +
        `    Appeared in ${card.count} of ${context.totalReadings} total readings\n` +
        `    Position bias: ${positionBias}\n` +
        `    Reversed rate: ${reversedRate}%\n` +
        `    Frequent co-occurrences: ${topCoOccur || "none stand out"}` +
        moonNote +
        questionsList
      );
    })
    .join("\n\n");

  const userMsg =
    `EVIDENCE LIST (in descending frequency — generate paragraphs in this order):\n\n${evidenceList}\n\n` +
    `Write the Card Evidence prose for this Story. Output paragraphs only — no headers, no labels, no markdown.${
      isPremium
        ? " Include the Layer 2 lunar observations where relevant."
        : ""
    }`;

  return { system, user: userMsg };
}

function stripQuotes(text: string): string {
  return text.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
}

function validateProseAgainstThread(
  prose: string,
  threadCardIds: number[],
): { ok: boolean; violations: string[] } {
  const allowedNames = new Set(
    threadCardIds.map((id) => getCardName(id).toLowerCase()),
  );
  const allTarotNames = new Set<string>();
  for (let i = 0; i < TAROT_DECK.length; i++) {
    allTarotNames.add(getCardName(i).toLowerCase());
  }
  // Strip quoted spans so the seeker's question text doesn't false-trigger.
  const proseLower = stripQuotes(prose).toLowerCase();
  const violations: string[] = [];
  for (const name of allTarotNames) {
    if (!name) continue;
    if (!allowedNames.has(name) && proseLower.includes(name)) {
      violations.push(name);
    }
  }
  return { ok: violations.length === 0, violations };
}

function buildDeterministicFallback(
  _cardIds: number[],
  _recurrenceCount: number,
  context: SeekerContext,
): string {
  return context.perCard
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((card) => {
      const positionPhrase =
        card.positions.length > 0
          ? ` It has shown up in ${formatPositionBias(card.positions)} positions.`
          : "";
      const coPhrase = (() => {
        const top = Object.entries(card.coOccurrence).sort(
          (a, b) => b[1] - a[1],
        )[0];
        if (!top || top[1] < 2) return "";
        return ` Often paired with ${getCardName(parseInt(top[0], 10))}.`;
      })();
      return (
        `${card.cardName} appeared in ${card.count} of ${context.totalReadings} readings.` +
        positionPhrase +
        coPhrase
      );
    })
    .join("\n\n");
}

function formatPositionBias(positions: string[]): string {
  const counts = positions.reduce<Record<string, number>>((acc, p) => {
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([pos, n]) =>
        `${n === 1 ? "once" : n === 2 ? "twice" : `${n} times`} in ${pos}`,
    )
    .join(", ");
}

function formatMoonDist(dist: Record<string, number>): string {
  return Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phase, n]) => `${n} during ${phase.replace(/_/g, " ")}`)
    .join(", ");
}

function computeCoOccurrence(
  matches: ReadingRow[],
  cardId: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of matches) {
    for (const otherId of r.card_ids) {
      if (otherId === cardId) continue;
      const key = String(otherId);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}