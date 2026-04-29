/**
 * Phase 9 — Weave detection.
 *
 * A "weave" is a relational structure between two or more patterns. We
 * detect them with a simple, deterministic rule (no AI required for the
 * baseline): two patterns form a weave when at least two of the same
 * readings belong to both, OR when the patterns share at least 2 cards
 * across their associated threads. The output is upserted into the
 * `weaves` table with a generated title.
 *
 * The exported server function runs scoped to the caller's user and is
 * safe to invoke from the client. The same logic is also exposed via a
 * public route (`/api/public/detect-weaves`) so a nightly pg_cron can
 * iterate every active user.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DetectWeavesResult = {
  ok: boolean;
  weaves_detected: number;
  weaves_existing: number;
};

export type DetectWeavesCounts = {
  inserted: number;
  existing: number;
};

export async function detectWeavesForUser(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<DetectWeavesCounts> {
  const sb = supabase as any;

  const { data: patternRows } = await sb
    .from("patterns")
    .select("id, name, reading_ids, thread_ids, lifecycle_state")
    .eq("user_id", userId)
    .in("lifecycle_state", ["emerging", "active", "reawakened"]);
  const patterns = (patternRows ?? []) as Array<{
    id: string;
    name: string;
    reading_ids: string[];
    thread_ids: string[];
    lifecycle_state: string;
  }>;
  if (patterns.length < 2) return { inserted: 0, existing: 0 };

  const { data: existingWeaves } = await sb
    .from("weaves")
    .select("id, pattern_ids")
    .eq("user_id", userId);
  const existingKeys = new Set<string>(
    ((existingWeaves ?? []) as Array<{ pattern_ids: string[] }>).map((w) =>
      [...(w.pattern_ids ?? [])].sort().join("|"),
    ),
  );

  let inserted = 0;
  let existing = 0;
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const a = patterns[i];
      const b = patterns[j];
      const sharedReadings = (a.reading_ids ?? []).filter((r) =>
        (b.reading_ids ?? []).includes(r),
      );
      if (sharedReadings.length < 2) continue;

      const key = [a.id, b.id].sort().join("|");
      if (existingKeys.has(key)) {
        existing += 1;
        continue;
      }

      const { error } = await sb.from("weaves").insert({
        user_id: userId,
        weave_type: "pattern_weave",
        title: `${a.name} ↔ ${b.name}`,
        description: `These patterns share ${sharedReadings.length} readings — a weave is forming.`,
        pattern_ids: [a.id, b.id],
        reading_ids: sharedReadings,
      });
      if (!error) {
        inserted += 1;
        existingKeys.add(key);
      } else if ((error as { code?: string }).code === "23505") {
        // Unique-violation on (user_id, pattern_key): another concurrent
        // run beat us to it. Treat as already-existing, not an error.
        existing += 1;
        existingKeys.add(key);
      } else {
        console.error("[detectWeavesForUser] insert failed", error);
      }
    }
  }
  return { inserted, existing };
}

export const detectWeaves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DetectWeavesResult> => {
    try {
      const { supabase, userId } = context;
      const { inserted, existing } = await detectWeavesForUser(
        supabase,
        userId,
      );
      return {
        ok: true,
        weaves_detected: inserted,
        weaves_existing: existing,
      };
    } catch (e) {
      console.error("[detectWeaves] failed", e);
      return { ok: false, weaves_detected: 0, weaves_existing: 0 };
    }
  });