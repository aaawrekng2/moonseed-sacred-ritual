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
import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import {
  cardComparison,
  drawsFromReadings,
  type CardComparison,
} from "@/lib/pattern-engine";

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
  spread_name?: string | null;
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
  tags: string[];
  isDeepReading: boolean;
  moonPhase: string | null;
};

export type QuickLogCardStats = {
  count: number;
  lastSeenAt: string | null;
  reversedCount: number;
  topDayOfWeek: { day: string; count: number; total: number } | null;
  seekerReversedRate: number; // 0..1
  frequencyRank: number | null; // 1 = most-drawn card across user's history
  totalDistinctCards: number; // denominator for "rank N of M"
  // v2.64 — total draw slots across ALL cards in the filtered window. Used to
  // compute the card's over-index vs pure chance: expected = this / 78.
  windowTotalSlots: number;
  topMoonPhase: { phase: MoonPhaseName; count: number; total: number } | null;
  lastSeenMoonPhase: MoonPhaseName | null;
  companions: Array<{ cardId: number; count: number }>;
  journal: QuickLogJournalRow[]; // all readings containing this cardId
  // v3.109 — trend + sparkline bucketed across the SELECTED window.
  trend: "climbing" | "cooling" | "steady" | null;
  sparkPoints: number[];
  // v3.109 — most over-chance recent run in the last 30 days (or null).
  recentRun: { count: number; days: number; pct: number } | null;
};

type ReadingRow = {
  id: string;
  created_at: string;
  card_ids: number[] | null;
  card_orientations: boolean[] | null;
  question: string | null;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// v3.111 — Poisson upper-tail P(X >= k | lambda). Lower = more surprising;
// used to rank recent-run windows by statistical surprise so volume over a
// longer span beats a spiky short window.
function poissonUpperTail(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda); // i = 0
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

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
        "id, created_at, card_ids, card_orientations, question, spread_type, spread_name, tags, moon_phase, is_deep_reading",
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
      if (best >= 0) topDayOfWeek = { day: DAYS[best], count: bestN, total: matches.length };
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
    const sortedCounts = [...cardCounts.entries()].sort((a, b) => b[1] - a[1]);
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
      matches.length > 0 ? getCurrentMoonPhase(new Date(matches[0].created_at)).phase : null;

    // v3.109 — trend + sparkline bucketed across the SELECTED window, so it
    // reflects the last-N-days filter (not just the card's first->last span).
    const nowMs = Date.now();
    const matchTimes = matches
      .map((r) => new Date(r.created_at).getTime())
      .sort((a, b) => a - b);
    let trend: QuickLogCardStats["trend"] = null;
    let sparkPoints: number[] = [];
    if (matchTimes.length >= 2) {
      const startMs = since ? new Date(since).getTime() : matchTimes[0];
      const span = Math.max(1, nowMs - startMs);
      const buckets = Math.min(12, Math.max(4, matchTimes.length));
      const counts = new Array(buckets).fill(0);
      for (const t of matchTimes) {
        let b = Math.floor(((t - startMs) / span) * buckets);
        if (b < 0) b = 0;
        if (b >= buckets) b = buckets - 1;
        counts[b]++;
      }
      sparkPoints = counts;
      const half = Math.floor(buckets / 2);
      const older = counts.slice(0, half).reduce((a, b) => a + b, 0);
      const newer = counts.slice(half).reduce((a, b) => a + b, 0);
      if (newer > older * 1.1) trend = "climbing";
      else if (newer < older * 0.9) trend = "cooling";
      else trend = "steady";
    }

    // v3.109 — most over-chance recent run in the last 30 days.
    let recentRun: QuickLogCardStats["recentRun"] = null;
    {
      const RUN_DAYS = 30;
      const runSince = new Date(nowMs - RUN_DAYS * 86400000).toISOString();
      const { data: runRaw } = await supabase
        .from("readings")
        .select("created_at, card_ids")
        .eq("user_id", userId)
        .gte("created_at", runSince)
        .order("created_at", { ascending: true });
      const runEntries = (
        (runRaw ?? []) as Array<{ created_at: string; card_ids: number[] | null }>
      )
        .filter((r) => Array.isArray(r.card_ids))
        .map((r) => ({
          t: new Date(r.created_at).getTime(),
          slots: (r.card_ids ?? []).length,
          hero: (r.card_ids ?? []).includes(cardId),
        }));
      const anchors = runEntries.filter((e) => e.hero).map((e) => e.t);
      if (anchors.length >= 2) {
        let best:
          | { count: number; days: number; overIndex: number; p: number }
          | null = null;
        for (const anchor of anchors) {
          const days = Math.round((nowMs - anchor) / 86400000);
          if (days < 3 || days > RUN_DAYS) continue;
          let count = 0;
          let slots = 0;
          for (const e of runEntries) {
            if (e.t >= anchor) {
              slots += e.slots;
              if (e.hero) count++;
            }
          }
          if (count < 2) continue;
          const expected = slots / 78;
          const overIndex = expected > 0 ? count / expected : 0;
          const p = poissonUpperTail(count, expected);
          // Lowest p-value wins (most surprising); ties keep the earliest
          // anchor already stored -> the fuller run with the most pulls.
          if (!best || p < best.p) {
            best = { count, days, overIndex, p };
          }
        }
        if (best) {
          recentRun = {
            count: best.count,
            days: best.days,
            pct: Math.round((best.overIndex - 1) * 100),
          };
        }
      }
    }

    return {
      count: matches.length,
      lastSeenAt: matches[0]?.created_at ?? null,
      reversedCount,
      topDayOfWeek,
      seekerReversedRate: totalCards > 0 ? totalReversed / totalCards : 0,
      frequencyRank,
      totalDistinctCards,
      windowTotalSlots: totalCards,
      topMoonPhase,
      lastSeenMoonPhase,
      companions,
      journal: matches.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        question: r.question,
        cardIds: r.card_ids ?? [],
        tags: r.tags ?? [],
        isDeepReading: r.is_deep_reading ?? false,
        moonPhase: r.moon_phase ?? null,
      })),
      trend,
      sparkPoints,
      recentRun,
    };
  });

// ─── Q112 Phase 3 — Six-month overlap strip ──────────────────────────

const OverlapInput = z.object({
  heroCardId: z.number().int().min(0).max(9999).nullable().optional(),
  tz: z.string().min(1),
  filters: FiltersSchema,
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
    Array<{
      id: string;
      createdAt: string;
      question: string | null;
      cardIds: number[];
      spreadName: string | null;
      drawLabel: string;
      // EK113 — recorded moon phase ("Full Moon" / "New Moon" / …), so the
      // atlas can match moon group slots. Null for readings without one.
      moonPhase: string | null;
    }>
  >;
  /**
   * Most-recent ISO timestamp this seeker drew each card, within the
   * 12-month window queried above. Used by the slim hover card on
   * Constellation to show "last seen N days ago".
   */
  cardLastDrawnAt: Record<number, string>;
};

function daysInMonth(year: number, month1: number): number {
  // eslint-disable-next-line no-restricted-syntax -- pure month-length arithmetic; not tz-sensitive
  return new Date(year, month1, 0).getDate();
}

// v3.110 — best label for a pull: its saved name, else the spread-type label,
// else "Untitled draw". Lets unnamed pulls still show in strips/tips.
function drawLabelFor(
  spreadName: string | null,
  spreadType: string | null,
): string {
  const n = spreadName?.trim();
  if (n) return n;
  if (spreadType && isValidSpreadMode(spreadType)) {
    return SPREAD_META[spreadType as SpreadMode].label;
  }
  if (spreadType && spreadType.trim()) return spreadType.trim();
  return "Untitled draw";
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

    // Window: first day of (today's month - 11) through today, in user tz.
    // DT — bumped 6 → 12 months to feed the new 12-month grid on Manual Entry.
    const now = new Date();
    const nowKey = isoDayInTz(now, tz); // "YYYY-MM-DD"
    const [nowYearStr, nowMonthStr] = nowKey.split("-");
    const nowYear = Number(nowYearStr);
    const nowMonth0 = Number(nowMonthStr) - 1;
    let startYear = nowYear;
    let startMonth0 = nowMonth0 - 11;
    while (startMonth0 < 0) {
      startMonth0 += 12;
      startYear -= 1;
    }
    // Approximate UTC lower bound for the SQL filter. Subtract one day to
    // be safe against tz offsets pulling readings into the prior UTC day.
    const startIso = new Date(
      Date.UTC(startYear, startMonth0, 1, 0, 0, 0, 0) - 24 * 60 * 60 * 1000,
    ).toISOString();

    const sinceTimeframe = timeRangeStartIso(data.filters?.timeRange);
    const lowerBound = sinceTimeframe && sinceTimeframe > startIso ? sinceTimeframe : startIso;
    const { data: rowsRaw } = await supabase
      .from("readings")
      .select(
        "id, created_at, card_ids, card_orientations, question, spread_type, spread_name, tags, moon_phase, is_deep_reading",
      )
      .eq("user_id", userId)
      .gte("created_at", lowerBound)
      .order("created_at", { ascending: false })
      .limit(2000);

    const readingsByDate: QuickLogOverlap["readingsByDate"] = {};
    const heroDays = new Set<string>();
    const sameDayCardIds: Record<string, Set<number>> = {};
    const cardLastDrawnAt: Record<number, string> = {};
    const filteredRows = (
      (rowsRaw ?? []) as Array<
        {
          id: string;
          created_at: string;
          card_ids: number[] | null;
          question: string | null;
        } & FilterableRow
      >
    ).filter((r) => postFilterRow(r, data.filters));
    for (const row of filteredRows) {
      const ids = row.card_ids ?? [];
      const key = isoDayInTz(new Date(row.created_at), tz);
      (readingsByDate[key] = readingsByDate[key] ?? []).push({
        id: row.id,
        createdAt: row.created_at,
        question: row.question,
        cardIds: ids,
        spreadName: row.spread_name ?? null,
        drawLabel: drawLabelFor(row.spread_name ?? null, row.spread_type ?? null),
        moonPhase: row.moon_phase ?? null,
      });
      const set = (sameDayCardIds[key] = sameDayCardIds[key] ?? new Set());
      for (const id of ids) set.add(id);
      for (const id of ids) {
        const prev = cardLastDrawnAt[id];
        if (!prev || row.created_at > prev) cardLastDrawnAt[id] = row.created_at;
      }
      if (heroCardId != null && ids.includes(heroCardId)) heroDays.add(key);
    }

    const months: QuickLogMonthGroup[] = [];
    for (let i = 0; i < 12; i++) {
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

    return { months, readingsByDate, cardLastDrawnAt };
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
  filters: FiltersSchema,
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
    // dataset. Cap at 10000 lifetime readings (raised from 2000 in DP).
    let cq = supabase
      .from("readings")
      .select(
        "id, created_at, card_ids, card_orientations, question, spread_type, spread_name, tags, moon_phase, is_deep_reading",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10000);
    const sinceC = timeRangeStartIso(data.filters?.timeRange);
    if (sinceC) cq = cq.gte("created_at", sinceC);
    const { data: allRaw } = await cq;

    const all = (
      (allRaw ?? []) as Array<
        {
          id: string;
          created_at: string;
          card_ids: number[] | null;
          question: string | null;
        } & FilterableRow
      >
    )
      .filter((r) => Array.isArray(r.card_ids))
      .filter((r) => postFilterRow(r, data.filters));

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
    const pairKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
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

    // EJ16 — bumped cap 20 → 200 so the hero badge readings modal
    // shows every reading containing the hero (up to 200) rather
    // than only the most recent 20. The previous cap silently
    // hid readings from the seeker; the modal already scrolls so
    // 200 rows is comfortable. 200 also matches the cap used in
    // DrawCountsInput below for consistency.
    const matches = heroRows.slice(0, 200).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      question: r.question,
      cardIds: r.card_ids ?? [],
    }));

    return { heroCardId, companions: sortedCompanions, pairCounts, matches };
  });

// ─── Phase 23 — per-card draw counts for slot badges ─────────────────

const DrawCountsInput = z.object({
  // DU — bumped cap from 10 → 200 so CardPicker can request counts for the
  // full 78-card tarot deck (plus oracle cards) in a single call.
  cardIds: z.array(z.number().int().min(0).max(9999)).max(200),
  tz: z.string().min(1),
  filters: FiltersSchema,
});

export type CardDrawCounts = {
  /** cardId -> times drawn within the filter window */
  perCard: Record<number, number>;
  /**
   * EJ16 — cardId -> rank within the filter window. Rank 1 = most
   * drawn. Cards with the same count get the same rank (dense
   * ranking). Cards with zero draws are unranked (undefined).
   * Computed across the seeker's entire deck universe in the
   * filter window, not just the requested cardIds.
   */
  perCardRank: Record<number, number>;
  /**
   * EJ16 — total number of distinct cards drawn within the filter
   * window. Used as the denominator for "rank N of M" displays.
   */
  rankUniverseSize: number;
  /** max count across all standard (78) cards in the filter window */
  globalMax: number;
};

export const getCardDrawCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DrawCountsInput.parse(data))
  .handler(async ({ data, context }): Promise<CardDrawCounts> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    if (data.cardIds.length === 0)
      return { perCard: {}, perCardRank: {}, rankUniverseSize: 0, globalMax: 0 };

    let q = supabase
      .from("readings")
      .select(
        "id, created_at, card_ids, card_orientations, spread_type, tags, moon_phase, is_deep_reading",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10000);
    const since = timeRangeStartIso(data.filters?.timeRange);
    if (since) q = q.gte("created_at", since);
    const { data: rowsRaw } = await q;

    const rows = ((rowsRaw ?? []) as Array<{ card_ids: number[] | null } & FilterableRow>)
      .filter((r) => Array.isArray(r.card_ids))
      .filter((r) => postFilterRow(r, data.filters));

    const counts = new Map<number, number>();
    for (const r of rows) {
      for (const id of r.card_ids ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    let globalMax = 0;
    for (const n of counts.values()) if (n > globalMax) globalMax = n;
    const perCard: Record<number, number> = {};
    for (const id of data.cardIds) perCard[id] = counts.get(id) ?? 0;
    // EJ16 — dense rank by count, descending. Cards sharing a count
    // share a rank; the next distinct count gets rank N+1 (not
    // skipping). Cards with zero draws are unranked (omitted).
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const perCardRank: Record<number, number> = {};
    let lastCount = -1;
    let currentRank = 0;
    for (const [cardId, count] of ranked) {
      if (count <= 0) continue;
      if (count !== lastCount) {
        currentRank += 1;
        lastCount = count;
      }
      perCardRank[cardId] = currentRank;
    }
    const rankUniverseSize = Object.keys(perCardRank).length;
    return { perCard, perCardRank, rankUniverseSize, globalMax };
  });

// ─── EJ18 — batched per-card popover data ─────────────────────────────
//
// One call returns rich popover data for every requested cardId in the
// seeker's filtered universe. Designed for the rich card hover popover
// on /constellation which needs per-card stats but doesn't want to
// fan out one server call per hover. The client batches all visible
// card IDs (slot row + constellation companions + hero) into a single
// request, caches the result per filterKey, and looks up the relevant
// entry by cardId when hovering.
//
// Returned data per card:
//   reversedPct: 0..1 fraction reversed across draws of this card
//   topMoonPhase: most common moon phase + count
//   topTimeBucket: time-of-day bucket (morning/afternoon/evening/night)
//   monthCounts: 12-element array, draws per month for the last 12
//     months, oldest first. Powers the sparkline.
//   companionsTop3: top 3 cards co-occurring with this one
//   longestGapDays: largest gap between consecutive draws, in days
//   avgSpacingDays: average days between draws across the history
//   topTag: tag with the largest over-index ratio vs baseline
//
// The function reuses the existing filter envelope and tz semantics.
const CardPopoverDataInput = z.object({
  cardIds: z.array(z.number().int().min(0).max(9999)).max(40),
  tz: z.string().min(1),
  filters: FiltersSchema,
});

export type CardPopoverData = {
  reversedPct: number | null;
  topMoonPhase: { phase: MoonPhaseName; count: number; total: number } | null;
  topTimeBucket: {
    bucket: "morning" | "afternoon" | "evening" | "night";
    count: number;
    total: number;
  } | null;
  // EJ21 — moved from the right-side data card into the hover popover.
  // Most-common day of the week the card appears on, with count out of
  // total draws of this card in the filtered universe.
  topDayOfWeek: { day: string; count: number; total: number } | null;
  monthCounts: number[]; // length 12
  companionsTop3: Array<{ cardId: number; count: number }>;
  longestGapDays: number | null;
  avgSpacingDays: number | null;
  topTag: { tag: string; multiplier: number } | null;
  // v2.40 — pattern-engine per-card comparison (observed vs expected,
  // over-index, rank/percentile, rarity, acute/chronic). null when the card
  // has never been drawn in the current filter universe.
  comparison: CardComparison | null;
};

export type CardPopoverDataMap = Record<number, CardPopoverData>;

export const getCardPopoverData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CardPopoverDataInput.parse(data))
  .handler(async ({ data, context }): Promise<CardPopoverDataMap> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    if (data.cardIds.length === 0) return {};

    // Fetch readings once; loop over them per cardId. The query mirrors
    // getQuickLogCardStats and applies the same filter envelope.
    let q = supabase
      .from("readings")
      .select(
        "id, created_at, card_ids, card_orientations, question, spread_type, spread_name, tags, moon_phase, is_deep_reading",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(10000);
    const since = timeRangeStartIso(data.filters?.timeRange);
    if (since) q = q.gte("created_at", since);
    const { data: rowsRaw } = await q;

    const rows = (
      (rowsRaw ?? []) as Array<
        {
          id: string;
          created_at: string;
          card_ids: number[] | null;
          card_orientations: boolean[] | null;
          question: string | null;
        } & FilterableRow
      >
    )
      .filter((r) => Array.isArray(r.card_ids))
      .filter((r) => postFilterRow(r, data.filters));

    // v2.40 — slot-level draw log for the pattern engine, built once and
    // reused for every requested card's observed-vs-expected comparison.
    const engineDraws = drawsFromReadings(rows);
    const engineNow = Date.now();

    // Baseline tag frequencies — what fraction of ALL readings carry
    // each tag. Used as the denominator for the per-card tag bias.
    const baselineTagCounts = new Map<string, number>();
    const baselineTotal = rows.length;
    for (const r of rows) {
      const tags = r.tags ?? [];
      const seen = new Set<string>();
      for (const t of tags) {
        if (!t || seen.has(t)) continue;
        seen.add(t);
        baselineTagCounts.set(t, (baselineTagCounts.get(t) ?? 0) + 1);
      }
    }

    // 12-month window for the sparkline. Compute month keys in the
    // seeker's tz so the bucket boundaries match what they see on
    // the calendar. nowKey is yyyy-mm-dd in tz; we work backward 11
    // months. Earliest = monthIdx 0, current = monthIdx 11.
    const now = new Date();
    const nowKey = isoDayInTz(now, data.tz);
    const [nowYearStr, nowMonthStr] = nowKey.split("-");
    const nowYear = Number(nowYearStr);
    const nowMonth0 = Number(nowMonthStr) - 1;
    // Build [{ y, m0 }] from oldest (11 months ago) to current.
    const monthSlots: Array<{ y: number; m0: number }> = [];
    for (let back = 11; back >= 0; back--) {
      const total = nowYear * 12 + nowMonth0 - back;
      const y = Math.floor(total / 12);
      const m0 = total - y * 12;
      monthSlots.push({ y, m0 });
    }

    const out: CardPopoverDataMap = {};
    for (const cardId of data.cardIds) {
      // Skip duplicates in the request — only compute once.
      if (out[cardId] !== undefined) continue;

      const matches = rows.filter((r) => (r.card_ids ?? []).includes(cardId));
      if (matches.length === 0) {
        out[cardId] = {
          reversedPct: null,
          topMoonPhase: null,
          topTimeBucket: null,
          topDayOfWeek: null,
          monthCounts: new Array(12).fill(0),
          companionsTop3: [],
          longestGapDays: null,
          avgSpacingDays: null,
          topTag: null,
          comparison: null,
        };
        continue;
      }

      // Reversed %.
      let reversed = 0;
      for (const r of matches) {
        const idx = (r.card_ids ?? []).indexOf(cardId);
        if (r.card_orientations?.[idx] === true) reversed++;
      }
      const reversedPct = matches.length > 0 ? reversed / matches.length : null;

      // Moon phase distribution.
      const phaseCounts = new Map<MoonPhaseName, number>();
      for (const r of matches) {
        const phase = getCurrentMoonPhase(new Date(r.created_at)).phase;
        phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
      }
      let topMoonPhase: CardPopoverData["topMoonPhase"] = null;
      for (const [phase, count] of phaseCounts) {
        if (!topMoonPhase || count > topMoonPhase.count) {
          topMoonPhase = { phase, count, total: matches.length };
        }
      }

      // Time-of-day bucket in the seeker's tz. Morning = 5am-11:59,
      // afternoon = 12-16:59, evening = 17-21:59, night = 22-4:59.
      const bucketCounts = new Map<"morning" | "afternoon" | "evening" | "night", number>();
      for (const r of matches) {
        const dt = new Date(r.created_at);
        // Hour in tz — using toLocaleString since we don't have a
        // dedicated hourInTz helper. eslint-disable matches the rule
        // used elsewhere for tz-locale arithmetic.

        const hourStr = dt.toLocaleString("en-US", {
          hour: "numeric",
          hour12: false,
          timeZone: data.tz,
        });
        const hour = Number(hourStr.match(/\d+/)?.[0] ?? "0");
        let bucket: "morning" | "afternoon" | "evening" | "night";
        if (hour >= 5 && hour < 12) bucket = "morning";
        else if (hour >= 12 && hour < 17) bucket = "afternoon";
        else if (hour >= 17 && hour < 22) bucket = "evening";
        else bucket = "night";
        bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
      }
      let topTimeBucket: CardPopoverData["topTimeBucket"] = null;
      for (const [bucket, count] of bucketCounts) {
        if (!topTimeBucket || count > topTimeBucket.count) {
          topTimeBucket = { bucket, count, total: matches.length };
        }
      }

      // EJ21 — day-of-week distribution (moved from the right-side
      // data card into the hover popover). Uses dayOfWeekInTz so the
      // buckets respect the seeker's timezone.
      const DAY_NAMES = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dowCounts = new Map<number, number>();
      for (const r of matches) {
        const d = dayOfWeekInTz(new Date(r.created_at), data.tz);
        dowCounts.set(d, (dowCounts.get(d) ?? 0) + 1);
      }
      let topDayOfWeek: CardPopoverData["topDayOfWeek"] = null;
      if (dowCounts.size > 0) {
        let bestDay = -1;
        let bestN = 0;
        for (const [d, n] of dowCounts) {
          if (n > bestN) {
            bestDay = d;
            bestN = n;
          }
        }
        if (bestDay >= 0) {
          topDayOfWeek = {
            day: DAY_NAMES[bestDay],
            count: bestN,
            total: matches.length,
          };
        }
      }

      // Month counts (12-month sparkline).
      const monthCounts = new Array(12).fill(0);
      for (const r of matches) {
        const key = isoDayInTz(new Date(r.created_at), data.tz);
        const [yStr, mStr] = key.split("-");
        const y = Number(yStr);
        const m0 = Number(mStr) - 1;
        const idx = monthSlots.findIndex((s) => s.y === y && s.m0 === m0);
        if (idx >= 0) monthCounts[idx]++;
      }

      // Companions top 3.
      const coCounts = new Map<number, number>();
      for (const r of matches) {
        for (const other of r.card_ids ?? []) {
          if (other === cardId) continue;
          coCounts.set(other, (coCounts.get(other) ?? 0) + 1);
        }
      }
      const companionsTop3 = [...coCounts.entries()]
        .map(([id, n]) => ({ cardId: id, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Longest gap & avg spacing. Matches are sorted ascending by
      // query order. Convert to dates and walk diffs.
      let longestGapDays: number | null = null;
      let avgSpacingDays: number | null = null;
      if (matches.length >= 2) {
        const sortedTimes = matches.map((r) => new Date(r.created_at).getTime());
        let totalSpacing = 0;
        let maxSpacing = 0;
        for (let i = 1; i < sortedTimes.length; i++) {
          const diff = sortedTimes[i] - sortedTimes[i - 1];
          totalSpacing += diff;
          if (diff > maxSpacing) maxSpacing = diff;
        }
        const dayMs = 86400000;
        longestGapDays = Math.round(maxSpacing / dayMs);
        avgSpacingDays = Math.round((totalSpacing / (sortedTimes.length - 1) / dayMs) * 10) / 10;
      }

      // Tag bias — find the tag that over-indexes most for this card.
      // For each tag in this card's matches, compute:
      //   cardTagFrac = (matches with this tag) / matches.length
      //   baselineTagFrac = baselineTagCounts[tag] / baselineTotal
      //   multiplier = cardTagFrac / baselineTagFrac
      // Require minimum sample size (>= 3 occurrences of tag with card)
      // to avoid noise.
      const cardTagCounts = new Map<string, number>();
      for (const r of matches) {
        const tags = r.tags ?? [];
        const seen = new Set<string>();
        for (const t of tags) {
          if (!t || seen.has(t)) continue;
          seen.add(t);
          cardTagCounts.set(t, (cardTagCounts.get(t) ?? 0) + 1);
        }
      }
      let topTag: CardPopoverData["topTag"] = null;
      if (baselineTotal > 0 && matches.length > 0) {
        for (const [tag, n] of cardTagCounts) {
          if (n < 3) continue;
          const cardFrac = n / matches.length;
          const baselineN = baselineTagCounts.get(tag) ?? 0;
          if (baselineN === 0) continue;
          const baselineFrac = baselineN / baselineTotal;
          if (baselineFrac === 0) continue;
          const multiplier = cardFrac / baselineFrac;
          if (multiplier <= 1.0) continue; // only over-indexing counts
          if (!topTag || multiplier > topTag.multiplier) {
            topTag = { tag, multiplier: Math.round(multiplier * 10) / 10 };
          }
        }
      }

      out[cardId] = {
        reversedPct,
        topMoonPhase,
        topTimeBucket,
        topDayOfWeek,
        monthCounts,
        companionsTop3,
        longestGapDays,
        avgSpacingDays,
        topTag,
        comparison: cardComparison(cardId, engineDraws, { now: engineNow }),
      };
    }
    return out;
  });
