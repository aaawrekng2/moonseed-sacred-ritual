/**
 * Q111 Phase 2 — QuickLog per-card stats server function.
 *
 * Given a (userId, cardId), aggregates the seeker's reading history
 * to power the QuickLog chip grid + companions row + journal list.
 * Standalone — does NOT touch card-evidence.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCardRoot, getCardRulership } from "@/lib/card-astrology";

const Input = z.object({
  cardId: z.number().int().min(0).max(9999),
});

export type QuickLogJournalRow = {
  id: string;
  createdAt: string;
  question: string | null;
  cardIds: number[];
};

export type QuickLogCardStats = {
  count: number;
  lastSeenAt: string | null;
  reversedCount: number;
  topDayOfWeek: { day: string; count: number; total: number } | null;
  seekerReversedRate: number; // 0..1
  seekerTopRoot: number | null;
  astrologyMatchCount: number; // total cards in history sharing rulership
  companions: Array<{ cardId: number; count: number }>;
  journal: QuickLogJournalRow[]; // all readings containing this cardId
};

type ReadingRow = {
  id: string;
  created_at: string;
  card_ids: number[] | null;
  card_orientations: boolean[] | null;
  question: string | null;
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const getQuickLogCardStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<QuickLogCardStats> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    const { cardId } = data;

    // Pull all readings for the seeker. Most users have <1k rows; for
    // larger histories the query still completes fast under RLS.
    const { data: allRaw } = await supabase
      .from("readings")
      .select("id, created_at, card_ids, card_orientations, question")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1000);
    const all = ((allRaw ?? []) as unknown as ReadingRow[]).filter(
      (r) => Array.isArray(r.card_ids),
    );

    let totalCards = 0;
    let totalReversed = 0;
    const rootCounts = new Map<number, number>();
    const heroRulership = getCardRulership(cardId);
    let astrologyMatchCount = 0;

    for (const r of all) {
      const ids = r.card_ids ?? [];
      const ors = r.card_orientations ?? [];
      totalCards += ids.length;
      for (let i = 0; i < ids.length; i++) {
        if (ors[i] === true) totalReversed++;
        const root = getCardRoot(ids[i]);
        if (root != null) rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1);
        if (
          heroRulership &&
          getCardRulership(ids[i]) === heroRulership
        ) {
          astrologyMatchCount++;
        }
      }
    }

    const matches = all.filter((r) => (r.card_ids ?? []).includes(cardId));
    const reversedCount = matches.filter((r) => {
      const idx = (r.card_ids ?? []).indexOf(cardId);
      return r.card_orientations?.[idx] === true;
    }).length;

    const dayCounts = new Map<number, number>();
    for (const r of matches) {
      const d = new Date(r.created_at).getDay();
      dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    }
    let topDayOfWeek: QuickLogCardStats["topDayOfWeek"] = null;
    if (matches.length > 0 && dayCounts.size > 0) {
      let best = -1;
      let bestN = 0;
      for (const [d, n] of dayCounts) {
        if (n > bestN) {
          best = d;
          bestN = n;
        }
      }
      if (best >= 0)
        topDayOfWeek = { day: DAYS[best], count: bestN, total: matches.length };
    }

    // Companions: count co-occurring cardIds across matches.
    const coCounts = new Map<number, number>();
    for (const r of matches) {
      for (const other of r.card_ids ?? []) {
        if (other === cardId) continue;
        coCounts.set(other, (coCounts.get(other) ?? 0) + 1);
      }
    }
    const companions = [...coCounts.entries()]
      .map(([id, n]) => ({ cardId: id, count: n }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    let seekerTopRoot: number | null = null;
    let topRootCount = 0;
    for (const [root, n] of rootCounts) {
      if (n > topRootCount) {
        topRootCount = n;
        seekerTopRoot = root;
      }
    }

    return {
      count: matches.length,
      lastSeenAt: matches[0]?.created_at ?? null,
      reversedCount,
      topDayOfWeek,
      seekerReversedRate: totalCards > 0 ? totalReversed / totalCards : 0,
      seekerTopRoot,
      astrologyMatchCount,
      companions,
      journal: matches.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        question: r.question,
        cardIds: r.card_ids ?? [],
      })),
    };
  });
