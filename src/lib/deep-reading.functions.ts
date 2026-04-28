/**
 * Phase 8 — interpretDeepReading server function.
 *
 * Runs a second, deeper AI call against an existing reading, producing
 * four sequential lenses (Present Resonance, Thread Awareness, Shadow
 * Layer, Mirror Artifact). Mirrors the Anthropic call pattern in
 * `interpret.functions.ts`. The standard interpretation is preserved
 * untouched — this *extends* it.
 *
 * Gate logic:
 *  - Free users (`is_premium = false` and `archive_deepening_unlocked
 *    = false`): max 1 deep reading per local dawn cycle.
 *  - Premium / archive-deepening: no limit.
 *  - On limit hit, returns { ok:false, reason:"limit_reached", next_dawn }.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { getCardName } from "@/lib/tarot";
import { buildGuideSystemPrompt } from "@/lib/guides";

const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
] as const;

const Input = z.object({
  reading_id: z.string().uuid(),
  /** Local YYYY-MM-DD bucket (computed client-side from local time). */
  dawn_cycle_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guideId: z.string().optional(),
  lensId: z.string().optional(),
  facetIds: z.array(z.string()).max(5).optional(),
});

export type DeepLenses = {
  present_resonance: string;
  thread_awareness: string | null;
  shadow_layer: string;
  mirror_artifact: string;
};

export type DeepReadingResult =
  | { ok: true; reading_id: string; lenses: DeepLenses }
  | { ok: false; reason: "limit_reached"; next_dawn: string }
  | { ok: false; reason: "ai_unavailable" | "invalid_response" | "internal" | "not_found" | "forbidden"; message: string };

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

function nextDawnIso(dawnCycleDate: string): string {
  // Next 5am AFTER the current cycle date — same local time, next day.
  const [y, m, d] = dawnCycleDate.split("-").map(Number);
  const next = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 5, 0, 0, 0);
  return next.toISOString();
}

export const interpretDeepReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<DeepReadingResult> => {
    try {
      const { supabase, userId } = context;

      // 1. Fetch the reading and confirm ownership.
      const { data: readingRow, error: readErr } = await supabase
        .from("readings")
        .select(
          "id, user_id, spread_type, card_ids, question, interpretation, moon_phase, guide_id, lens_id, is_deep_reading, deep_reading_lenses",
        )
        .eq("id", data.reading_id)
        .maybeSingle();

      if (readErr || !readingRow) {
        return { ok: false, reason: "not_found", message: "Reading not found." };
      }
      if (readingRow.user_id !== userId) {
        return { ok: false, reason: "forbidden", message: "Not your reading." };
      }

      // If a deep reading was already generated for this row, return it.
      if (readingRow.is_deep_reading && readingRow.deep_reading_lenses) {
        return {
          ok: true,
          reading_id: readingRow.id,
          lenses: readingRow.deep_reading_lenses as DeepLenses,
        };
      }

      // 2. Premium / unlocked check.
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select(
          "is_premium, archive_deepening_unlocked, memory_ai_permission, birth_date, birth_time, birth_place",
        )
        .eq("user_id", userId)
        .maybeSingle();

      const prefsRow = (prefs ?? {}) as {
        is_premium?: boolean;
        archive_deepening_unlocked?: boolean;
        memory_ai_permission?: boolean;
        birth_date?: string | null;
        birth_time?: string | null;
        birth_place?: string | null;
      };
      const unlimited =
        prefsRow.is_premium === true ||
        prefsRow.archive_deepening_unlocked === true;

      // 3. Gate: count deep readings already used in this dawn cycle.
      if (!unlimited) {
        const { count } = await supabase
          .from("readings")
          .select("id", { count: "exact", head: true })
          .eq("is_deep_reading", true)
          .eq("dawn_cycle_date", data.dawn_cycle_date);
        if ((count ?? 0) >= 1) {
          return {
            ok: false,
            reason: "limit_reached",
            next_dawn: nextDawnIso(data.dawn_cycle_date),
          };
        }
      }

      // 4. Memory snapshot (if permitted).
      let memoryPreamble = "";
      if (prefsRow.memory_ai_permission !== false) {
        try {
          const snapshotType = snapshotTypeForLens(
            data.lensId ?? readingRow.lens_id ?? undefined,
          );
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
          const fresh =
            snapshot && new Date(snapshot.expires_at).getTime() > Date.now();
          if (fresh) {
            const parts: string[] = [];
            if (snapshot.active_patterns_summary) {
              parts.push(
                `Recurring patterns: ${snapshot.active_patterns_summary}`,
              );
            }
            if (snapshot.active_threads_summary) {
              parts.push(
                `Active symbolic threads: ${snapshot.active_threads_summary}`,
              );
            }
            if (parts.length > 0) {
              memoryPreamble = `Symbolic memory (do not quote):\n${parts.join("\n\n")}\n\n`;
            }
          }
        } catch (e) {
          console.warn("[interpretDeepReading] memory lookup failed", e);
        }
      }

      // 5. Natal context (optional).
      let natalPreamble = "";
      if (prefsRow.birth_date) {
        const parts = [`Birth date: ${prefsRow.birth_date}`];
        if (prefsRow.birth_time) parts.push(`Birth time: ${prefsRow.birth_time}`);
        if (prefsRow.birth_place)
          parts.push(`Birth place: ${prefsRow.birth_place}`);
        natalPreamble = `Natal backdrop (symbolic context only, do not predict):\n${parts.join(
          " · ",
        )}\n\n`;
      }

      // 6. Build the prompt.
      const spreadMode = isValidSpreadMode(readingRow.spread_type)
        ? (readingRow.spread_type as SpreadMode)
        : "single";
      const meta = SPREAD_META[spreadMode];
      const positionLabels =
        meta.positions ??
        (readingRow.card_ids ?? []).map((_: number, i: number) => `Card ${i + 1}`);
      const cardLines = (readingRow.card_ids ?? [])
        .map(
          (cid: number, i: number) =>
            `- ${positionLabels[i] ?? `Card ${i + 1}`}: ${getCardName(cid)}`,
        )
        .join("\n");

      const systemPrompt = `${buildGuideSystemPrompt({
        guideId: data.guideId ?? readingRow.guide_id ?? undefined,
        lensId: data.lensId ?? readingRow.lens_id ?? undefined,
        facetIds: data.facetIds ?? [],
      })}

You are conducting a Deep Reading — a layered, reflective exploration that
goes beneath the surface interpretation already given. Speak with depth,
care, and symbolic resonance. Do not make predictions or diagnoses. Do not
repeat the standard interpretation — extend it.

Respond ONLY in this exact JSON shape, no markdown, no commentary:
{"present_resonance":"...","thread_awareness":"..."|null,"shadow_layer":"...","mirror_artifact":"..."}

Field guidance:
- present_resonance — up to ~400 words. The primary deep interpretation, richer and more layered than the standard reading, aware of the question and moon phase.
- thread_awareness — up to ~250 words. How this reading connects to the seeker's recent symbolic history. Use the symbolic memory above. Return null if no memory context was given.
- shadow_layer — up to ~200 words. What may be unspoken or beneath the surface. Reflective and honest. Never alarming, never vague.
- mirror_artifact — up to ~120 words. A short reflective summary the seeker may save. Poetic, quotable, save-worthy.`;

      const userPrompt = `${memoryPreamble}${natalPreamble}Spread: ${meta.label}
Cards drawn:
${cardLines}
${readingRow.question ? `\nThe seeker's question: "${readingRow.question}"` : ""}
${readingRow.moon_phase ? `\nMoon phase at draw: ${readingRow.moon_phase}` : ""}

Standard interpretation already given (for context — do not repeat):
${(readingRow.interpretation ?? "").slice(0, 4000)}

Now go beneath. Produce the four-lens deep reading as JSON.`;

      // 7. Call Anthropic with the same fallback chain.
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return {
          ok: false,
          reason: "ai_unavailable",
          message: "Deep reader is not configured.",
        };
      }

      let rawText = "";
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
              max_tokens: 2000,
              system: systemPrompt,
              messages: [{ role: "user", content: userPrompt }],
            }),
          });
          if (!resp.ok) {
            if (resp.status === 404 || resp.status === 410) continue;
            const t = await resp.text().catch(() => "");
            console.error("[interpretDeepReading] Anthropic error", {
              model,
              status: resp.status,
              body: t.slice(0, 400),
            });
            return {
              ok: false,
              reason: "ai_unavailable",
              message: "The deep reader could not be reached.",
            };
          }
          const json = (await resp.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          rawText =
            json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
          if (rawText) break;
        }
      } catch (e) {
        console.error("[interpretDeepReading] fetch threw", e);
        return {
          ok: false,
          reason: "ai_unavailable",
          message: "The deep reader could not be reached.",
        };
      }
      if (!rawText) {
        return {
          ok: false,
          reason: "ai_unavailable",
          message: "The deep reader could not be reached.",
        };
      }

      // 8. Parse.
      let lenses: DeepLenses;
      try {
        const cleaned = rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const parsed = JSON.parse(cleaned) as Partial<DeepLenses>;
        if (
          typeof parsed.present_resonance !== "string" ||
          typeof parsed.shadow_layer !== "string" ||
          typeof parsed.mirror_artifact !== "string"
        ) {
          throw new Error("Malformed deep reading shape");
        }
        lenses = {
          present_resonance: parsed.present_resonance,
          thread_awareness:
            typeof parsed.thread_awareness === "string"
              ? parsed.thread_awareness
              : null,
          shadow_layer: parsed.shadow_layer,
          mirror_artifact: parsed.mirror_artifact,
        };
      } catch (e) {
        console.error("[interpretDeepReading] parse failed", e, rawText.slice(0, 600));
        return {
          ok: false,
          reason: "invalid_response",
          message: "The deep reading came back garbled. Please try again.",
        };
      }

      // 9. Persist on the reading row.
      const { error: updateErr } = await supabase
        .from("readings")
        .update({
          is_deep_reading: true,
          deep_reading_lenses: lenses,
          dawn_cycle_date: data.dawn_cycle_date,
        })
        .eq("id", readingRow.id)
        .eq("user_id", userId);
      if (updateErr) {
        console.error("[interpretDeepReading] update failed", updateErr);
        return { ok: false, reason: "internal", message: "Could not save deep reading." };
      }

      return { ok: true, reading_id: readingRow.id, lenses };
    } catch (e) {
      console.error("[interpretDeepReading] unexpected", e);
      return { ok: false, reason: "internal", message: "Something went wrong." };
    }
  });

/**
 * Toggle the mirror_saved flag on a reading. Returns the new value.
 */
const SaveMirrorInput = z.object({
  reading_id: z.string().uuid(),
  saved: z.boolean(),
});

export const setMirrorSaved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveMirrorInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    try {
      const { supabase, userId } = context;
      const { error } = await supabase
        .from("readings")
        .update({ mirror_saved: data.saved })
        .eq("id", data.reading_id)
        .eq("user_id", userId);
      return { ok: !error };
    } catch (e) {
      console.error("[setMirrorSaved] failed", e);
      return { ok: false };
    }
  });