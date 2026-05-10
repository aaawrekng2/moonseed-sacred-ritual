/**
 * Q30 — Story orchestration server function.
 *
 * Generates the entire AI narrative for a Story page in a single
 * Lovable AI Gateway call: story_name, story_description,
 * card_evidence prose, per_reading_roles, remarkable_moments, and
 * (premium-only) a narrative_arc paragraph. Persists results to
 * `symbolic_threads`.
 *
 * Replaces per-thread Q23 generateCardEvidenceProse calls when the
 * Stories revamp is fully wired (Q23 path remains for the legacy
 * threads view until UI fixes 4-13 land).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCardName } from "@/lib/tarot";

const Input = z.object({
  patternId: z.string().uuid(),
  force: z.boolean().optional(),
});

const AI_VERSION = "260509_Q30";
const THRESHOLDS = [3, 5, 10, 25] as const;
const MODEL = "google/gemini-2.5-pro";

type ThreadRow = {
  id: string;
  user_id: string;
  reading_ids: string[] | null;
  card_ids?: number[] | null;
  thread_ids?: string[] | null;
  story_name: string | null;
  story_description: string | null;
  per_reading_roles: { [k: string]: unknown } | null;
  remarkable_moments: unknown[] | null;
  narrative_arc: string | null;
  evidence_prose?: string | null;
  ai_generated_at: string | null;
  ai_version: string | null;
  ai_reading_count_at_gen: number | null;
};

type ReadingRow = {
  id: string;
  created_at: string;
  spread_type: string | null;
  card_ids: number[] | null;
  question: string | null;
  interpretation: string | null;
  card_orientations: boolean[] | null;
  moon_phase: string | null;
};

export type StoryOrchestrationResult =
  | { ok: true; cached: boolean; pattern: {} }
  | {
      ok: false;
      error: "not_found" | "forbidden" | "insufficient_data" | "ai_unavailable";
      cached?: undefined;
      pattern?: undefined;
    };

function thresholdCrossed(prev: number | null, current: number): boolean {
  if (prev == null) return true;
  return THRESHOLDS.some((t) => prev < t && current >= t);
}

export const generateStoryOrchestration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };

    const { data: rawPattern, error: patternErr } = await supabase
      .from("symbolic_threads")
      .select(
        "id, user_id, reading_ids, card_ids, story_name, story_description, per_reading_roles, remarkable_moments, narrative_arc, evidence_prose, ai_generated_at, ai_version, ai_reading_count_at_gen",
      )
      .eq("id", data.patternId)
      .maybeSingle();
    if (patternErr || !rawPattern) return { ok: false, error: "not_found" };
    const pattern = rawPattern as unknown as ThreadRow;
    if (pattern.user_id !== userId) return { ok: false, error: "forbidden" };

    const readingIds = pattern.reading_ids ?? [];
    if (readingIds.length === 0) {
      return { ok: false, error: "insufficient_data" };
    }

    const currentCount = readingIds.length;
    const force = !!data.force;
    const needsGen =
      force ||
      pattern.ai_generated_at == null ||
      pattern.ai_version !== AI_VERSION ||
      thresholdCrossed(pattern.ai_reading_count_at_gen, currentCount);

    if (!needsGen) {
      return { ok: true as const, cached: true, pattern: pattern as {} };
    }

    const { data: readingsRaw, error: readingsErr } = await supabase
      .from("readings")
      .select(
        "id, created_at, spread_type, card_ids, question, interpretation, card_orientations, moon_phase",
      )
      .in("id", readingIds)
      .order("created_at", { ascending: true });
    if (readingsErr) return { ok: false, error: "insufficient_data" };
    const readings = (readingsRaw ?? []) as unknown as ReadingRow[];
    if (readings.length === 0) {
      return { ok: false, error: "insufficient_data" };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      console.error("[story-orchestration] LOVABLE_API_KEY missing");
      return { ok: false, error: "ai_unavailable" };
    }

    const cardNameOf = (id: number): string => {
      try {
        return getCardName(id);
      } catch {
        return `Card #${id}`;
      }
    };

    const recurringCards = (pattern.card_ids ?? []).map((id) => ({
      id,
      name: cardNameOf(id),
    }));

    const firstTs = new Date(readings[0]!.created_at).getTime();
    const lastTs = new Date(readings.at(-1)!.created_at).getTime();
    const spanDays = Math.max(
      1,
      Math.ceil((lastTs - firstTs) / (1000 * 60 * 60 * 24)),
    );

    const userPayload = {
      reading_count: readings.length,
      span_days: spanDays,
      recurring_cards: recurringCards,
      readings: readings.map((r) => ({
        id: r.id,
        date: r.created_at,
        spread: r.spread_type,
        card_ids: r.card_ids ?? [],
        card_names: (r.card_ids ?? []).map(cardNameOf),
        reversed: r.card_orientations ?? [],
        moon_phase: r.moon_phase,
        question: r.question,
        interpretation_excerpt: (r.interpretation ?? "").slice(0, 600),
      })),
    };

    const systemPrompt = [
      "You are a tarot oracle synthesizing a Story — a recurring pattern across a seeker's readings.",
      "Speak in evocative, grounded, sacred language. Avoid analytical or clinical framing.",
      "Output STRICT JSON with exactly these fields and no others:",
      "{",
      '  "story_name": string (MAX 3 WORDS, evocative title),',
      '  "story_description": string (max 3 sentences framing what this story IS),',
      '  "card_evidence": { [cardName: string]: string } (one short paragraph per recurring card),',
      '  "per_reading_roles": { [readingId: string]: string } (one sentence per reading describing its place in the arc, max 25 words each),',
      '  "remarkable_moments": [{ "date": string (ISO), "caption": string, "reading_ids": string[] }] (3-5 standout days)',
      "}",
      "Return ONLY JSON. No prose around it. No code fences.",
    ].join("\n");

    let raw: string;
    try {
      const resp = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: JSON.stringify(userPayload) },
            ],
            response_format: { type: "json_object" },
          }),
        },
      );
      if (!resp.ok) {
        console.error(
          "[story-orchestration] gateway error",
          resp.status,
          await resp.text().catch(() => ""),
        );
        return { ok: false, error: "ai_unavailable" };
      }
      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      raw = json.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      console.error("[story-orchestration] fetch failed", err);
      return { ok: false, error: "ai_unavailable" };
    }

    let parsed: {
      story_name?: unknown;
      story_description?: unknown;
      card_evidence?: unknown;
      per_reading_roles?: unknown;
      remarkable_moments?: unknown;
    };
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0] ?? raw);
    } catch (err) {
      console.error("[story-orchestration] JSON parse failed", err, raw);
      return { ok: false, error: "ai_unavailable" };
    }

    const storyName =
      typeof parsed.story_name === "string"
        ? parsed.story_name.trim().split(/\s+/).slice(0, 3).join(" ")
        : null;
    const storyDescription =
      typeof parsed.story_description === "string"
        ? parsed.story_description.trim()
        : null;

    const perReadingRolesRaw =
      parsed.per_reading_roles && typeof parsed.per_reading_roles === "object"
        ? (parsed.per_reading_roles as Record<string, unknown>)
        : {};
    const generatedAt = new Date().toISOString();
    const perReadingRoles: Record<
      string,
      { role: string; generated_at: string }
    > = {};
    for (const [k, v] of Object.entries(perReadingRolesRaw)) {
      if (typeof v === "string" && v.trim().length > 0) {
        perReadingRoles[k] = { role: v.trim(), generated_at: generatedAt };
      }
    }

    const remarkableMoments = Array.isArray(parsed.remarkable_moments)
      ? (parsed.remarkable_moments as unknown[])
          .filter(
            (m): m is { date: string; caption: string; reading_ids?: string[] } =>
              !!m &&
              typeof m === "object" &&
              typeof (m as { date?: unknown }).date === "string" &&
              typeof (m as { caption?: unknown }).caption === "string",
          )
          .slice(0, 5)
      : [];

    const cardEvidenceObj =
      parsed.card_evidence && typeof parsed.card_evidence === "object"
        ? (parsed.card_evidence as Record<string, string>)
        : {};
    // Flatten card evidence into a single paragraph for the legacy
    // `evidence_prose` column (kept around for back-compat with the
    // current ChamberCardEvidence renderer).
    const evidenceProse = Object.entries(cardEvidenceObj)
      .map(([name, text]) =>
        typeof text === "string" ? `${name}: ${text}` : null,
      )
      .filter((s): s is string => !!s)
      .join("\n\n");

    const updates = {
      story_name: storyName,
      story_description: storyDescription,
      per_reading_roles: perReadingRoles,
      remarkable_moments: remarkableMoments,
      evidence_prose: evidenceProse.length > 0 ? evidenceProse : null,
      ai_generated_at: generatedAt,
      ai_version: AI_VERSION,
      ai_reading_count_at_gen: readings.length,
    };

    const { data: updated, error: updateErr } = await supabase
      .from("symbolic_threads")
      .update(updates)
      .eq("id", data.patternId)
      .select(
        "id, user_id, reading_ids, card_ids, story_name, story_description, per_reading_roles, remarkable_moments, narrative_arc, evidence_prose, ai_generated_at, ai_version, ai_reading_count_at_gen",
      )
      .single();
    if (updateErr || !updated) {
      console.error("[story-orchestration] persist failed", updateErr);
      return { ok: false, error: "ai_unavailable" };
    }

    return {
      ok: true as const,
      cached: false,
      pattern: updated as {},
    };
  });

const ResubmitInput = z.object({ patternId: z.string().uuid() });

export const resubmitStoryToAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ResubmitInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    const { data: pattern } = await supabase
      .from("symbolic_threads")
      .select("user_id")
      .eq("id", data.patternId)
      .maybeSingle();
    if (!pattern) return { ok: false, error: "not_found" };
    if ((pattern as { user_id: string }).user_id !== userId) {
      return { ok: false, error: "forbidden" };
    }
    await supabase
      .from("symbolic_threads")
      .update({
        story_name: null,
        story_description: null,
        per_reading_roles: {},
        remarkable_moments: [],
        narrative_arc: null,
        ai_generated_at: null,
      })
      .eq("id", data.patternId);
    return (await generateStoryOrchestration({
      data: { patternId: data.patternId, force: true },
    })) as StoryOrchestrationResult;
  });
