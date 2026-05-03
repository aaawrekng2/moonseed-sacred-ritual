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
          .is("archived_at", null)
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
        // Track which thread row each candidate maps to (existing or newly
        // inserted) so we can drive pattern detection with stable IDs.
        const touchedThreadIds: string[] = [];
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
            const nextRecurrence = mergedReadings.length;
            const nextStatus =
              match.status === "quieting"
                ? "reawakened"
                : nextRecurrence >= 3
                  ? "active"
                  : "active";
            await supabase
              .from("symbolic_threads")
              .update({
                summary: cand.summary,
                title: cand.summary,
                tags: cand.tags ?? [],
                reading_ids: mergedReadings,
                status: nextStatus,
                recurrence_count: nextRecurrence,
                last_seen_at: new Date().toISOString(),
              })
              .eq("id", match.id);
            touchedThreadIds.push(match.id);
          } else {
            const { data: ins, error: insErr } = await supabase
              .from("symbolic_threads")
              .insert({
                user_id: userId,
                summary: cand.summary,
                title: cand.summary,
                card_ids: cand.card_ids,
                tags: cand.tags ?? [],
                reading_ids: cand.reading_ids,
                status: "emerging",
                recurrence_count: cand.reading_ids.length || 1,
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (!insErr && ins) {
              inserted += 1;
              touchedThreadIds.push(ins.id);
            }
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

        // ---- Phase 9: Pattern detection ---------------------------------
        // When 3+ threads share overlapping cards, group them under a
        // pattern (create or extend). Then transition pattern lifecycle
        // states based on activity.
        try {
          await detectAndUpdatePatterns(supabase, userId);
        } catch (e) {
          console.warn("[detectThreads] pattern detection failed", e);
        }

        return { ok: true, threads_detected: inserted };
      } catch (e) {
        console.error("[detectThreads] unexpected failure", e);
        return { ok: false, threads_detected: 0 };
      }
    },
  );

/* ---------- Pattern detection helper ---------- */

/**
 * DL-6 — Build a short, evocative 1–3 word name for a Story (pattern).
 * Combines a key word from the thread's title/summary with the
 * dominant card name (with leading "The" stripped). Falls back to the
 * card name alone, or "Recurring Symbols" when no card data exists.
 */
function buildShortName(t: {
  title?: string | null;
  summary?: string | null;
  card_ids?: number[] | null;
}): string {
  const dominantCardId = t.card_ids?.[0] ?? null;
  const cardName =
    typeof dominantCardId === "number" ? getCardName(dominantCardId) : null;
  const text = (t.title || t.summary || "").toLowerCase();
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "as", "in", "of", "to",
    "across", "multiple", "reading", "readings", "appears",
    "force", "with", "this", "that", "your", "you", "for",
    "from", "into", "over", "under", "than", "then", "them",
    "their", "there", "have", "has", "had", "been", "being",
  ]);
  const words = text
    .split(/[\s,.;:!?]+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));
  const keyWord = words[0] ?? null;
  const cardCore = cardName ? cardName.replace(/^The\s+/i, "") : null;
  if (keyWord && cardCore) {
    // DW-5 — Skip the keyword when it's already part of the card name
    // (e.g. "nine" extracted from a thread about Nine of Wands would
    // produce "Nine Nine of Wands"). Fall back to cardCore alone.
    if (cardCore.toLowerCase().includes(keyWord.toLowerCase())) {
      return cardCore.slice(0, 60);
    }
    const cap = keyWord.charAt(0).toUpperCase() + keyWord.slice(1);
    return `${cap} ${cardCore}`.slice(0, 60);
  }
  if (cardCore) return cardCore;
  return "Recurring Symbols";
}

/**
 * Group threads that share 2+ overlapping card_ids into patterns.
 * Creates an emerging pattern when 3+ threads cluster; extends an
 * existing pattern when threads already in it overlap with new ones.
 * Then runs lifecycle transitions:
 *   emerging  → active     when recurrence_count >= 3
 *   active    → quieting   when no related reading in 30 days
 *   quieting  → retired    automatically after 90 days quieting
 *   quieting  → reawakened when a previously quieting thread receives a new reading
 */
async function detectAndUpdatePatterns(
  supabase: NonNullable<unknown> & {
    from: (table: string) => any;
  },
  userId: string,
): Promise<void> {
  const sb = supabase as any;

  const { data: threadRows } = await sb
    .from("symbolic_threads")
    .select("id, card_ids, reading_ids, status, summary, title, pattern_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);

  const threads = (threadRows ?? []) as Array<{
    id: string;
    card_ids: number[];
    reading_ids: string[];
    status: string;
    summary: string;
    title: string | null;
    pattern_id: string | null;
  }>;

  if (threads.length < 3) return;

  const overlap = (a: number[], b: number[]) =>
    a.filter((x) => b.includes(x)).length;

  // Naive clustering: for each unassigned thread, find peers with 2+
  // shared cards. Threads with 3+ peers form a cluster.
  const used = new Set<string>(
    threads.filter((t) => t.pattern_id).map((t) => t.id),
  );

  const clusters: Array<{ threadIds: string[]; cardIds: number[]; title: string }> = [];

  for (const t of threads) {
    if (used.has(t.id)) continue;
    const peers = threads.filter(
      (o) =>
        o.id !== t.id &&
        !used.has(o.id) &&
        overlap(o.card_ids ?? [], t.card_ids ?? []) >= 2,
    );
    if (peers.length >= 2) {
      const cluster = [t, ...peers];
      const cardSet = new Set<number>();
      for (const c of cluster) for (const cid of c.card_ids ?? []) cardSet.add(cid);
      const seedTitle = buildShortName(t);
      clusters.push({
        threadIds: cluster.map((c) => c.id),
        cardIds: Array.from(cardSet),
        title: seedTitle,
      });
      for (const c of cluster) used.add(c.id);
    }
  }

  // Persist clusters as patterns (create new emerging patterns).
  for (const cluster of clusters) {
    // Re-check whether any thread already belongs to a pattern (race-safe).
    const { data: existingLink } = await sb
      .from("symbolic_threads")
      .select("pattern_id")
      .in("id", cluster.threadIds)
      .not("pattern_id", "is", null)
      .limit(1);
    const linked = (existingLink ?? []) as Array<{ pattern_id: string | null }>;
    let patternId: string | null = linked[0]?.pattern_id ?? null;

    // Aggregate reading_ids from threads in this cluster.
    const readingSet = new Set<string>();
    const clusterThreads = threads.filter((t) => cluster.threadIds.includes(t.id));
    for (const t of clusterThreads) for (const rid of t.reading_ids ?? []) readingSet.add(rid);
    const aggregatedReadingIds = Array.from(readingSet);

    if (!patternId) {
      const { data: pat, error: patErr } = await sb
        .from("patterns")
        .insert({
          user_id: userId,
          name: cluster.title,
          lifecycle_state: "emerging",
          thread_ids: cluster.threadIds,
          reading_ids: aggregatedReadingIds,
          is_user_named: false,
        })
        .select("id")
        .single();
      if (patErr || !pat) continue;
      patternId = pat.id;
    } else {
      // Extend the existing pattern with these threads & readings.
      const { data: existingPat } = await sb
        .from("patterns")
        .select("thread_ids, reading_ids, lifecycle_state")
        .eq("id", patternId)
        .maybeSingle();
      const ep = existingPat as
        | { thread_ids: string[]; reading_ids: string[]; lifecycle_state: string }
        | null;
      if (ep) {
        const mergedThreads = Array.from(
          new Set([...(ep.thread_ids ?? []), ...cluster.threadIds]),
        );
        const mergedReadings = Array.from(
          new Set([...(ep.reading_ids ?? []), ...aggregatedReadingIds]),
        );
        await sb
          .from("patterns")
          .update({
            thread_ids: mergedThreads,
            reading_ids: mergedReadings,
            lifecycle_state:
              ep.lifecycle_state === "quieting" ? "reawakened" : ep.lifecycle_state,
          })
          .eq("id", patternId);
      }
    }

    // Link threads back to pattern.
    if (patternId) {
      await sb
        .from("symbolic_threads")
        .update({ pattern_id: patternId })
        .in("id", cluster.threadIds)
        .is("pattern_id", null);

      // Tag the readings themselves with the active pattern_id (best
      // effort; failures are silent).
      if (aggregatedReadingIds.length > 0) {
        await sb
          .from("readings")
          .update({ pattern_id: patternId })
          .in("id", aggregatedReadingIds)
          .is("pattern_id", null);
      }
    }
  }

  // ---- Lifecycle transitions on existing patterns -----------------------
  const { data: patternRows } = await sb
    .from("patterns")
    .select("id, lifecycle_state, reading_ids, retired_at, updated_at")
    .eq("user_id", userId);
  const patterns = (patternRows ?? []) as Array<{
    id: string;
    lifecycle_state: string;
    reading_ids: string[];
    retired_at: string | null;
    updated_at: string;
  }>;

  if (patterns.length === 0) return;

  // Look up newest reading per pattern.
  const allReadingIds = Array.from(
    new Set(patterns.flatMap((p) => p.reading_ids ?? [])),
  );
  const readingDateMap = new Map<string, number>();
  if (allReadingIds.length > 0) {
    const { data: rdates } = await sb
      .from("readings")
      .select("id, created_at")
      .in("id", allReadingIds);
    for (const r of (rdates ?? []) as Array<{ id: string; created_at: string }>) {
      readingDateMap.set(r.id, new Date(r.created_at).getTime());
    }
  }

  const now = Date.now();
  const THIRTY = 30 * 24 * 60 * 60 * 1000;
  const NINETY = 90 * 24 * 60 * 60 * 1000;

  for (const p of patterns) {
    const newest = (p.reading_ids ?? [])
      .map((rid) => readingDateMap.get(rid) ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const recurrenceCount = (p.reading_ids ?? []).length;

    // emerging -> active
    if (p.lifecycle_state === "emerging" && recurrenceCount >= 3) {
      await sb.from("patterns").update({ lifecycle_state: "active" }).eq("id", p.id);
      continue;
    }
    // active -> quieting (no related reading in 30 days)
    if (
      (p.lifecycle_state === "active" || p.lifecycle_state === "reawakened") &&
      newest > 0 &&
      now - newest > THIRTY
    ) {
      await sb.from("patterns").update({ lifecycle_state: "quieting" }).eq("id", p.id);
      continue;
    }
    // quieting -> retired (after 90 days quieting)
    if (
      p.lifecycle_state === "quieting" &&
      now - new Date(p.updated_at).getTime() > NINETY
    ) {
      await sb
        .from("patterns")
        .update({
          lifecycle_state: "retired",
          retired_at: new Date().toISOString(),
        })
        .eq("id", p.id);
    }
  }
}

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
          .is("archived_at", null)
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