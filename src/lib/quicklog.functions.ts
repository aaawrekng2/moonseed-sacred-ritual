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
import { getCardMeta, getCardRoot, getCardRulership } from "@/lib/card-astrology";
import { getCardName } from "@/lib/tarot";

const Input = z.object({
  cardId: z.number().int().min(0).max(9999),
  tz: z.string().optional(),
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

// ─── Q112 Phase 3 — Six-month overlap strip ──────────────────────────

const OverlapInput = z.object({
  heroCardId: z.number().int().min(0).max(9999).nullable().optional(),
  tz: z.string().optional(),
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

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone.
 * Falls back to UTC if the tz string is invalid.
 */
function isoDayInTz(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${day}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function daysInMonth(year: number, month1: number): number {
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
    const tz = data.tz || "UTC";

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
  tz: z.string().optional(),
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
