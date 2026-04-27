/**
 * Phase 7 — Memory & Threads server functions.
 *
 * Two server functions, both authenticated and RLS-scoped:
 *
 *   • detectThreads — Scans the caller's recent readings for recurring
 *     symbolic themes via Claude and upserts results into
 *     `symbolic_threads`. Designed to be fired non-blocking after each
 *     reading saves; returns gracefully on every failure mode so it
 *     can never crash the reading flow.
 *
 *   • buildMemorySnapshot — Produces a curated symbolic summary of the
 *     user's practice for one of three lenses (recent_echoes /
 *     deeper_threads / full_archive). Stored in `memory_snapshots` with
 *     a 24h expiry; consumed by interpretReading on subsequent draws to
 *     give the AI a memory context (without ever passing raw reading
 *     text — only summaries — per Phase 7 privacy rule).
 *
 * The user's `memory_ai_permission` flag (on user_preferences) gates
 * snapshot generation. When false, buildMemorySnapshot is a no-op.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCardName } from "@/lib/tarot";

/* ---------- Shared model fallback chain (mirrors interpret.functions) ---------- */

const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
] as const;

async function callClaude(opts: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string | null> {
  for (const model of ANTHROPIC_MODELS) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
      if (!resp.ok) {
        if (resp.status === 404 || resp.status === 410) continue;
        const t = await resp.text().catch(() => "");
        console.error("[memory] anthropic error", { model, status: resp.status, body: t.slice(0, 300) });
        return null;
      }
      const json = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
      if (text) return text;
    } catch (e) {
      console.error("[memory] anthropic fetch threw", e);
      return null;
    }
  }
  return null;
}

/* ---------- detectThreads ---------- */

const DetectInput = z.object({
  user_id: z.string().uuid(),
});

type ThreadCandidate = {
  summary: string;
  card_ids: number[];
  tags: string[];
  reading_ids: string[];
};

const THREAD_SYSTEM_PROMPT = `You are a symbolic pattern analyst for a tarot journaling app.
Analyse the following readings and identify recurring symbolic themes —
cards that appear repeatedly, tag clusters that recur, or structural patterns
(e.g. recurring position placements).

Do not psychologically profile the user. Speak symbolically.
Respond ONLY in this exact JSON format, no markdown, no extra text:
{"threads":[{"summary":"...","card_ids":[...],"tags":[...],"reading_ids":["..."]}]}`;

export const detectThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DetectInput.parse(raw))
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; threads_detected: number }> => {
      try {
        const { supabase, userId } = context;
        // Belt-and-braces: only allow a user to scan their own practice.
        if (data.user_id !== userId) {
          return { ok: false, threads_detected: 0 };
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          console.warn("[detectThreads] ANTHROPIC_API_KEY not set — skipping");
          return { ok: false, threads_detected: 0 };
        }

        const { data: readings, error: readErr } = await supabase
          .from("readings")
          .select("id, card_ids, tags, guide_id, spread_type, created_at")
          .order("created_at", { ascending: false })
          .limit(20);

        if (readErr || !readings || readings.length < 2) {
          // Need at least two readings to detect a "recurrence".
          return { ok: true, threads_detected: 0 };
        }

        // Compact, AI-readable shape — only IDs, tags, and structure
        // (never raw interpretation text).
        const compact = readings.map((r) => ({
          id: r.id,
          cards: (r.card_ids ?? []).map((cid: number) => ({
            id: cid,
            name: getCardName(cid),
          })),
          tags: r.tags ?? [],
          spread: r.spread_type,
          guide: r.guide_id,
        }));

        const userPrompt = `Readings (most recent first):\n${JSON.stringify(compact, null, 2)}`;

        const raw = await callClaude({
          apiKey,
          system: THREAD_SYSTEM_PROMPT,
          user: userPrompt,
          maxTokens: 1500,
        });
        if (!raw) return { ok: false, threads_detected: 0 };

        // Defensive parse — strip code fences in case the model adds them.
        let parsed: { threads?: ThreadCandidate[] };
        try {
          const cleaned = raw
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
          parsed = JSON.parse(cleaned) as { threads?: ThreadCandidate[] };
        } catch (e) {
          console.warn("[detectThreads] JSON parse failed", e);
          return { ok: false, threads_detected: 0 };
        }

        const candidates = (parsed.threads ?? []).filter(
          (t) =>
            t &&
            typeof t.summary === "string" &&
            Array.isArray(t.card_ids) &&
            Array.isArray(t.reading_ids),
        );

        // Fetch existing threads to dedupe (match if 2+ card_ids overlap).
        const { data: existing } = await supabase
          .from("symbolic_threads")
          .select("id, card_ids, reading_ids, status, summary")
          .order("updated_at", { ascending: false })
          .limit(50);

        const existingArr = (existing ?? []) as Array<{
          id: string;
          card_ids: number[];
          reading_ids: string[];
          status: string;
          summary: string;
        }>;

        let inserted = 0;
        for (const cand of candidates) {
          const overlap = (a: number[], b: number[]) =>
            a.filter((x) => b.includes(x)).length;
          const match = existingArr.find(
            (e) => overlap(e.card_ids ?? [], cand.card_ids) >= 2,
          );
          if (match) {
            const mergedReadings = Array.from(
              new Set([...(match.reading_ids ?? []), ...cand.reading_ids]),
            );
            await supabase
              .from("symbolic_threads")
              .update({
                summary: cand.summary,
                tags: cand.tags ?? [],
                reading_ids: mergedReadings,
                status: match.status === "quieting" ? "reawakened" : "active",
              })
              .eq("id", match.id);
          } else {
            const { error: insErr } = await supabase
              .from("symbolic_threads")
              .insert({
                user_id: userId,
                summary: cand.summary,
                card_ids: cand.card_ids,
                tags: cand.tags ?? [],
                reading_ids: cand.reading_ids,
                status: "emerging",
              });
            if (!insErr) inserted += 1;
          }
        }

        // Mark threads as "quieting" when their newest reading is more
        // than 7 days old and they aren't represented in the candidates.
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recentReadingIds = new Set(readings.map((r) => r.id));
        for (const t of existingArr) {
          const stillActive = (t.reading_ids ?? []).some((rid) =>
            recentReadingIds.has(rid),
          );
          if (!stillActive && t.status !== "quieting" && t.status !== "retired") {
            // Find newest reading_id timestamp from the snapshot above.
            const newest = (t.reading_ids ?? [])
              .map((rid) => readings.find((r) => r.id === rid)?.created_at)
              .filter(Boolean) as string[];
            const newestMs = newest.length
              ? Math.max(...newest.map((s) => new Date(s).getTime()))
              : 0;
            if (newestMs && newestMs < sevenDaysAgo) {
              await supabase
                .from("symbolic_threads")
                .update({ status: "quieting" })
                .eq("id", t.id);
            }
          }
        }

        return { ok: true, threads_detected: inserted };
      } catch (e) {
        console.error("[detectThreads] unexpected failure", e);
        return { ok: false, threads_detected: 0 };
      }
    },
  );

/* ---------- buildMemorySnapshot ---------- */

export type SnapshotType = "recent_echoes" | "deeper_threads" | "full_archive";

const SnapshotInput = z.object({
  user_id: z.string().uuid(),
  snapshot_type: z.enum(["recent_echoes", "deeper_threads", "full_archive"]),
});

const SNAPSHOT_TOKEN_BUDGET: Record<SnapshotType, number> = {
  recent_echoes: 300,
  deeper_threads: 600,
  full_archive: 1500,
};

const SNAPSHOT_SYSTEM_PROMPT = `You write short symbolic summaries of a tarot journaler's recent practice.
You will be given a compact list of readings (cards and tags only — never raw interpretations)
and a list of currently-active symbolic threads. Produce a brief, evocative summary
(1-3 short paragraphs) of what the practice currently holds — recurring cards,
tag clusters, structural patterns. Speak symbolically, not psychologically.
Plain prose, no bullets, no markdown, no headings.`;

export const buildMemorySnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SnapshotInput.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; reason?: string }> => {
      try {
        const { supabase, userId } = context;
        if (data.user_id !== userId) return { ok: false, reason: "forbidden" };

        // Permission check.
        const { data: prefs } = await supabase
          .from("user_preferences")
          .select("memory_ai_permission")
          .eq("user_id", userId)
          .maybeSingle();
        const permitted = (prefs as { memory_ai_permission?: boolean } | null)
          ?.memory_ai_permission;
        if (permitted === false) {
          return { ok: false, reason: "permission_denied" };
        }

        // Fetch readings within the relevant window.
        const now = Date.now();
        const windowStart =
          data.snapshot_type === "recent_echoes"
            ? new Date(now - 7 * 24 * 60 * 60 * 1000)
            : data.snapshot_type === "deeper_threads"
              ? new Date(now - 30 * 24 * 60 * 60 * 1000)
              : null; // full_archive => no lower bound

        let q = supabase
          .from("readings")
          .select("id, card_ids, tags, created_at")
          .order("created_at", { ascending: false })
          .limit(data.snapshot_type === "full_archive" ? 500 : 100);
        if (windowStart) q = q.gte("created_at", windowStart.toISOString());
        const { data: readings } = await q;
        const rows = (readings ?? []) as Array<{
          id: string;
          card_ids: number[];
          tags: string[] | null;
          created_at: string;
        }>;

        // Card frequency map.
        const freq: Record<string, number> = {};
        for (const r of rows) {
          for (const cid of r.card_ids ?? []) {
            const k = String(cid);
            freq[k] = (freq[k] ?? 0) + 1;
          }
        }

        // Recent tags (deduped, capped).
        const tagSet = new Set<string>();
        for (const r of rows) for (const t of r.tags ?? []) tagSet.add(t);
        const recentTags = Array.from(tagSet).slice(0, 30);

        // Active threads (status emerging | active | reawakened).
        const { data: threadRows } = await supabase
          .from("symbolic_threads")
          .select("summary, card_ids, status")
          .in("status", ["emerging", "active", "reawakened"])
          .order("updated_at", { ascending: false })
          .limit(20);

        const threads = (threadRows ?? []) as Array<{
          summary: string;
          card_ids: number[];
          status: string;
        }>;

        // Build the prompt input. Strictly summaries — no raw text.
        const topCards = Object.entries(freq)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([cid, count]) => ({
            id: Number(cid),
            name: getCardName(Number(cid)),
            count,
          }));

        const apiKey = process.env.ANTHROPIC_API_KEY;
        let summary = "";
        if (apiKey && rows.length > 0) {
          const userPrompt = `Top recurring cards: ${JSON.stringify(topCards)}\nRecent tags: ${JSON.stringify(recentTags)}\nActive threads: ${JSON.stringify(threads.map((t) => ({ summary: t.summary, status: t.status })))}\n\nWrite a brief symbolic summary of this practice.`;
          const text = await callClaude({
            apiKey,
            system: SNAPSHOT_SYSTEM_PROMPT,
            user: userPrompt,
            maxTokens: SNAPSHOT_TOKEN_BUDGET[data.snapshot_type],
          });
          if (text) summary = text;
        }

        // Upsert snapshot.
        const { error: upErr } = await supabase
          .from("memory_snapshots")
          .upsert(
            {
              user_id: userId,
              snapshot_type: data.snapshot_type,
              generated_at: new Date().toISOString(),
              expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
              card_frequencies: freq,
              active_threads_summary: threads
                .map((t) => t.summary)
                .filter(Boolean)
                .join("\n\n") || null,
              active_patterns_summary: summary || null,
              recent_tags: recentTags,
              token_count: Math.ceil(summary.length / 4),
            },
            { onConflict: "user_id,snapshot_type" },
          );

        if (upErr) {
          console.error("[buildMemorySnapshot] upsert failed", upErr);
          return { ok: false, reason: "internal" };
        }

        return { ok: true };
      } catch (e) {
        console.error("[buildMemorySnapshot] unexpected failure", e);
        return { ok: false, reason: "internal" };
      }
    },
  );