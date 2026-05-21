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
import { getCardMeta } from "@/lib/card-astrology";
import { getCardName } from "@/lib/tarot";
import { getCurrentMoonPhase, type MoonPhaseName } from "@/lib/moon";
import { dayOfWeekInTz, isoDayInTz } from "@/lib/time";

// ─── Phase 23 — shared filter envelope ────────────────────────────────
// Optional filter set threaded into every Constellation server fn. Mirrors
// the GlobalFilters shape (tag NAMES, not ids).
const FiltersSchema = z
  .object({
    timeRange: z.string().optional(), // "7d" | "30d" | "90d" | "365d" | "all"
    tags: z.array(z.string()).optional(),
    spreadTypes: z.array(z.string()).optional(),
    moonPhases: z.array(z.string()).optional(),
    deepOnly: z.boolean().optional(),
    reversedOnly: z.boolean().optional(),
  })
  .optional();

export type ConstellationFilterOpts = z.infer<typeof FiltersSchema>;

function timeRangeStartIso(timeRange?: string): string | null {
  if (!timeRange || timeRange === "all") return null;
  const m = /^(\d+)d$/.exec(timeRange);
  if (!m) return null;
  const days = Number(m[1]);
  return new Date(Date.now() - days * 86400000).toISOString();
}

type FilterableRow = {
  spread_type?: string | null;
  tags?: string[] | null;
  moon_phase?: string | null;
  is_deep_reading?: boolean | null;
  card_orientations?: boolean[] | null;
};

function postFilterRow(r: FilterableRow, f?: ConstellationFilterOpts): boolean {
  if (!f) return true;
  if (f.spreadTypes && f.spreadTypes.length > 0) {
    if (!r.spread_type || !f.spreadTypes.includes(r.spread_type)) return false;
  }
  if (f.deepOnly && !r.is_deep_reading) return false;
  if (f.tags && f.tags.length > 0) {
    const rt = r.tags ?? [];
    if (!f.tags.some((t) => rt.includes(t))) return false;
  }
  if (f.moonPhases && f.moonPhases.length > 0) {
    if (!r.moon_phase || !f.moonPhases.includes(r.moon_phase)) return false;
  }
  if (f.reversedOnly && !(r.card_orientations ?? []).some(Boolean)) return false;
  return true;
}

const Input = z.object({
  cardId: z.number().int().min(0).max(9999),
  tz: z.string().min(1),
  filters: FiltersSchema,
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
  frequencyRank: number | null; // 1 = most-drawn card across user's history
  totalDistinctCards: number; // denominator for "rank N of M"
  topMoonPhase: { phase: MoonPhaseName; count: number; total: number } | null;
  lastSeenMoonPhase: MoonPhaseName | null;
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
    let q = supabase
      .from("readings")
      .select(
        "id, created_at, card_ids, card_orientations, question, spread_type, tags, moon_phase, is_deep_reading",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1000);
    const since = timeRangeStartIso(data.filters?.timeRange);
    if (since) q = q.gte("created_at", since);
    const { data: allRaw } = await q;
    const all = ((allRaw ?? []) as unknown as (ReadingRow & FilterableRow)[])
      .filter((r) => Array.isArray(r.card_ids))
      .filter((r) => postFilterRow(r, data.filters));

    let totalCards = 0;
    let totalReversed = 0;
    const cardCounts = new Map<number, number>();

    for (const r of all) {
      const ids = r.card_ids ?? [];
      const ors = r.card_orientations ?? [];
      totalCards += ids.length;
      for (let i = 0; i < ids.length; i++) {
        if (ors[i] === true) totalReversed++;
        cardCounts.set(ids[i], (cardCounts.get(ids[i]) ?? 0) + 1);
      }
    }

    const matches = all.filter((r) => (r.card_ids ?? []).includes(cardId));
    const reversedCount = matches.filter((r) => {
      const idx = (r.card_ids ?? []).indexOf(cardId);
      return r.card_orientations?.[idx] === true;
    }).length;

    const dayCounts = new Map<number, number>();
    for (const r of matches) {
      const d = dayOfWeekInTz(new Date(r.created_at), data.tz);
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

    // Frequency rank: where does this card sit in the user's draw history?
    const sortedCounts = [...cardCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    const rankIdx = sortedCounts.findIndex(([id]) => id === cardId);
    const frequencyRank = rankIdx >= 0 ? rankIdx + 1 : null;
    const totalDistinctCards = sortedCounts.length;

    // Moon-phase distribution across the user's draws of this card.
    const phaseCounts = new Map<MoonPhaseName, number>();
    for (const r of matches) {
      const phase = getCurrentMoonPhase(new Date(r.created_at)).phase;
      phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
    }
    let topMoonPhase: QuickLogCardStats["topMoonPhase"] = null;
    for (const [phase, count] of phaseCounts) {
      if (!topMoonPhase || count > topMoonPhase.count) {
        topMoonPhase = { phase, count, total: matches.length };
      }
    }
    const lastSeenMoonPhase: MoonPhaseName | null =
      matches.length > 0
        ? getCurrentMoonPhase(new Date(matches[0].created_at)).phase
        : null;

    return {
      count: matches.length,
      lastSeenAt: matches[0]?.created_at ?? null,
      reversedCount,
      topDayOfWeek,
      seekerReversedRate: totalCards > 0 ? totalReversed / totalCards : 0,
      frequencyRank,
      totalDistinctCards,
      topMoonPhase,
      lastSeenMoonPhase,
      companions,
      journal: matches.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        question: r.question,
        cardIds: r.card_ids ?? [],
      })),
    };
  });

// ─── Q112 Phase 3 — Six-month overlap strip ──────────────────────────

const OverlapInput = z.object({
  heroCardId: z.number().int().min(0).max(9999).nullable().optional(),
  tz: z.string().min(1),
});

export type QuickLogDayCell = {
  date: string; // yyyy-mm-dd in UTC for stability
  heroDrawn: boolean;
  sameDayCardIds: number[];
};

export type QuickLogMonthGroup = {
  year: number;
  month: number; // 1..12
  days: QuickLogDayCell[];
};

export type QuickLogOverlap = {
  months: QuickLogMonthGroup[];
  readingsByDate: Record<
    string,
    Array<{ id: string; createdAt: string; question: string | null; cardIds: number[] }>
  >;
};

function daysInMonth(year: number, month1: number): number {
  // eslint-disable-next-line no-restricted-syntax -- pure month-length arithmetic; not tz-sensitive
  return new Date(year, month1, 0).getDate();
}

export const getQuickLogOverlap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => OverlapInput.parse(data))
  .handler(async ({ data, context }): Promise<QuickLogOverlap> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    const heroCardId = data.heroCardId ?? null;
    const tz = data.tz;

    // Window: first day of (today's month - 5) through today, in user tz.
    const now = new Date();
    const nowKey = isoDayInTz(now, tz); // "YYYY-MM-DD"
    const [nowYearStr, nowMonthStr] = nowKey.split("-");
    const nowYear = Number(nowYearStr);
    const nowMonth0 = Number(nowMonthStr) - 1;
    let startYear = nowYear;
    let startMonth0 = nowMonth0 - 5;
    while (startMonth0 < 0) {
      startMonth0 += 12;
      startYear -= 1;
    }
    // Approximate UTC lower bound for the SQL filter. Subtract one day to
    // be safe against tz offsets pulling readings into the prior UTC day.
    const startIso = new Date(
      Date.UTC(startYear, startMonth0, 1, 0, 0, 0, 0) - 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: rowsRaw } = await supabase
      .from("readings")
      .select("id, created_at, card_ids, question")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .order("created_at", { ascending: false })
      .limit(2000);

    const readingsByDate: QuickLogOverlap["readingsByDate"] = {};
    const heroDays = new Set<string>();
    const sameDayCardIds: Record<string, Set<number>> = {};
    for (const row of (rowsRaw ?? []) as Array<{
      id: string;
      created_at: string;
      card_ids: number[] | null;
      question: string | null;
    }>) {
      const ids = row.card_ids ?? [];
      const key = isoDayInTz(new Date(row.created_at), tz);
      (readingsByDate[key] = readingsByDate[key] ?? []).push({
        id: row.id,
        createdAt: row.created_at,
        question: row.question,
        cardIds: ids,
      });
      const set = (sameDayCardIds[key] = sameDayCardIds[key] ?? new Set());
      for (const id of ids) set.add(id);
      if (heroCardId != null && ids.includes(heroCardId)) heroDays.add(key);
    }

    const months: QuickLogMonthGroup[] = [];
    for (let i = 0; i < 6; i++) {
      let y = startYear;
      let m0 = startMonth0 + i;
      while (m0 >= 12) {
        m0 -= 12;
        y += 1;
      }
      const month = m0 + 1;
      const count = daysInMonth(y, month);
      const days: QuickLogDayCell[] = [];
      for (let d = 1; d <= count; d++) {
        const date = `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        days.push({
          date,
          heroDrawn: heroDays.has(date),
          sameDayCardIds: [...(sameDayCardIds[date] ?? [])],
        });
      }
      months.push({ year: y, month, days });
    }

    return { months, readingsByDate };
  });

// ─── Q112 Phase 3 — Practice stats ───────────────────────────────────

export type QuickLogPractice = {
  totalReadings: number;
  currentLunationReadings: number;
  topStalker: { cardId: number; cardName: string; count: number } | null;
  reversedPct: number;
  topSuit: { suit: string; count: number } | null;
  pullHistory: Array<{ cardIdsKey: string; count: number; lastAt: string }>;
};

const PracticeInput = z.object({
  lunationStart: z.string().optional(),
  lunationEnd: z.string().optional(),
  tz: z.string().min(1),
});

function suitFor(cardId: number): string | null {
  const meta = getCardMeta(cardId);
  return meta?.suit ?? null;
}

export const getQuickLogPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PracticeInput.parse(data))
  .handler(async ({ data, context }): Promise<QuickLogPractice> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    const { data: rowsRaw } = await supabase
      .from("readings")
      .select("id, created_at, card_ids, card_orientations")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(2000);
    const rows = (rowsRaw ?? []) as Array<{
      id: string;
      created_at: string;
      card_ids: number[] | null;
      card_orientations: boolean[] | null;
    }>;

    let totalCards = 0;
    let totalReversed = 0;
    const cardCounts = new Map<number, number>();
    const suitCounts = new Map<string, number>();
    let currentLunationReadings = 0;
    const lunStart = data.lunationStart ? new Date(data.lunationStart) : null;
    const lunEnd = data.lunationEnd ? new Date(data.lunationEnd) : null;
    const pullMap = new Map<string, { count: number; lastAt: string }>();

    for (const r of rows) {
      const ids = r.card_ids ?? [];
      const ors = r.card_orientations ?? [];
      totalCards += ids.length;
      for (let i = 0; i < ids.length; i++) {
        if (ors[i]) totalReversed++;
        cardCounts.set(ids[i], (cardCounts.get(ids[i]) ?? 0) + 1);
        const s = suitFor(ids[i]);
        if (s) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
      }
      if (lunStart && lunEnd) {
        const t = new Date(r.created_at).getTime();
        if (t >= lunStart.getTime() && t <= lunEnd.getTime()) {
          currentLunationReadings++;
        }
      }
      const key = [...ids].sort((a, b) => a - b).join(",");
      if (key) {
        const prev = pullMap.get(key);
        if (!prev || new Date(r.created_at) > new Date(prev.lastAt)) {
          pullMap.set(key, {
            count: (prev?.count ?? 0) + 1,
            lastAt: r.created_at,
          });
        } else {
          pullMap.set(key, { count: prev.count + 1, lastAt: prev.lastAt });
        }
      }
    }

    let topStalker: QuickLogPractice["topStalker"] = null;
    for (const [cardId, count] of cardCounts) {
      if (!topStalker || count > topStalker.count) {
        topStalker = { cardId, cardName: getCardName(cardId), count };
      }
    }
    let topSuit: QuickLogPractice["topSuit"] = null;
    for (const [suit, count] of suitCounts) {
      if (!topSuit || count > topSuit.count) topSuit = { suit, count };
    }

    const pullHistory = [...pullMap.entries()].map(([k, v]) => ({
      cardIdsKey: k,
      count: v.count,
      lastAt: v.lastAt,
    }));

    return {
      totalReadings: rows.length,
      currentLunationReadings,
      topStalker,
      reversedPct: totalCards > 0 ? Math.round((totalReversed / totalCards) * 100) : 0,
      topSuit,
      pullHistory,
    };
  });

// ─── Phase 17 — Card constellation (web of co-occurrence) ───────────

const ConstellationInput = z.object({
  heroCardId: z.number().int().min(0).max(9999),
  tz: z.string().min(1),
});

export type CardConstellation = {
  heroCardId: number;
  companions: Array<{ cardId: number; coCount: number; lifetimeCount: number }>;
  pairCounts: Array<{ a: number; b: number; count: number }>;
  matches: Array<{
    id: string;
    createdAt: string;
    question: string | null;
    cardIds: number[];
  }>;
};

export const getCardConstellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ConstellationInput.parse(data))
  .handler(async ({ data, context }): Promise<CardConstellation> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    const { heroCardId } = data;

    // Single fetch — derive both the hero-only subset (for matches +
    // co-occurrence counts) AND pair counts across all readings from one
    // dataset. Cap at 2000 lifetime readings (flagged as v1 limitation).
    const { data: allRaw } = await supabase
      .from("readings")
      .select("id, created_at, card_ids, question")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(2000);

    const all = ((allRaw ?? []) as Array<{
      id: string;
      created_at: string;
      card_ids: number[] | null;
      question: string | null;
    }>).filter((r) => Array.isArray(r.card_ids));

    // Hero subset — readings containing the hero card.
    const heroRows = all.filter((r) => (r.card_ids ?? []).includes(heroCardId));

    // Co-occurrence counts vs hero.
    const coCounts = new Map<number, number>();
    for (const row of heroRows) {
      const seen = new Set<number>();
      for (const id of row.card_ids ?? []) {
        if (id === heroCardId) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        coCounts.set(id, (coCounts.get(id) ?? 0) + 1);
      }
    }

    const sortedCompanions = [...coCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([cardId, coCount]) => ({ cardId, coCount, lifetimeCount: 0 }));

    // Lifetime counts for each companion across all readings.
    if (sortedCompanions.length > 0) {
      const companionIds = new Set(sortedCompanions.map((c) => c.cardId));
      const lifeCounts = new Map<number, number>();
      for (const r of all) {
        const seen = new Set<number>();
        for (const id of r.card_ids ?? []) {
          if (!companionIds.has(id)) continue;
          if (seen.has(id)) continue;
          seen.add(id);
          lifeCounts.set(id, (lifeCounts.get(id) ?? 0) + 1);
        }
      }
      for (const c of sortedCompanions) {
        c.lifetimeCount = lifeCounts.get(c.cardId) ?? 0;
      }
    }

    // Pair counts among (hero + top 7 companions) — across ALL readings
    // so non-hero pairs are counted correctly.
    const nodeIds = [heroCardId, ...sortedCompanions.map((c) => c.cardId)];
    const nodeSet = new Set(nodeIds);
    const pairKey = (a: number, b: number): string =>
      a < b ? `${a}|${b}` : `${b}|${a}`;
    const pairMap = new Map<string, number>();
    for (const r of all) {
      const present: number[] = [];
      const seen = new Set<number>();
      for (const id of r.card_ids ?? []) {
        if (!nodeSet.has(id) || seen.has(id)) continue;
        seen.add(id);
        present.push(id);
      }
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const k = pairKey(present[i], present[j]);
          pairMap.set(k, (pairMap.get(k) ?? 0) + 1);
        }
      }
    }
    const pairCounts: CardConstellation["pairCounts"] = [];
    for (const [k, count] of pairMap) {
      if (count <= 0) continue;
      const [aStr, bStr] = k.split("|");
      pairCounts.push({ a: Number(aStr), b: Number(bStr), count });
    }

    // Most-recent 20 hero readings.
    const matches = heroRows.slice(0, 20).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      question: r.question,
      cardIds: r.card_ids ?? [],
    }));

    return { heroCardId, companions: sortedCompanions, pairCounts, matches };
  });
