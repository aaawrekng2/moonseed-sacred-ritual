/**
 * EJ — Insights server functions.
 *
 * Computes Overview aggregations and Stalker cards entirely server-side
 * so we never ship raw reading rows to the browser. Free-tier time
 * windows are capped to 90 days; the result carries `dataCapped` so the
 * UI can surface the upgrade nudge.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  InsightsFiltersSchema,
  type InsightsOverview,
  type StalkerCardsResult,
  type TimeRange,
} from "@/lib/insights.types";
import { getCardArcana, getCardSuit, getCardName } from "@/lib/tarot";
import { getGuideById } from "@/lib/guides";
import { z } from "zod";

const FREE_CAP_DAYS = 90;
const STALKER_THRESHOLD = 3;
const STALKER_MIN_WINDOW = 5;

const LENS_NAMES: Record<string, string> = {
  present_resonance: "Present Resonance",
  thread_awareness: "Thread Awareness",
  shadow: "Shadow",
  integration: "Integration",
};

function lensLabel(id: string): string {
  return LENS_NAMES[id] ?? id.replace(/_/g, " ");
}

function rangeToDays(range: TimeRange): number | null {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "12m":
      return 365;
    case "all":
      return null;
  }
}

/** Apply the free-tier cap. Returns the effective day window + a flag. */
function effectiveWindow(range: TimeRange): { days: number | null; capped: boolean } {
  const requested = rangeToDays(range);
  if (requested === null) return { days: FREE_CAP_DAYS, capped: true };
  if (requested > FREE_CAP_DAYS) return { days: FREE_CAP_DAYS, capped: true };
  return { days: requested, capped: false };
}

type ReadingRow = {
  id: string;
  created_at: string;
  card_ids: number[] | null;
  card_orientations: boolean[] | null;
  spread_type: string | null;
  moon_phase: string | null;
  guide_id: string | null;
  lens_id: string | null;
  is_deep_reading: boolean | null;
  deck_id: string | null;
  tags: string[] | null;
};

const READING_COLUMNS =
  "id, created_at, card_ids, card_orientations, spread_type, moon_phase, guide_id, lens_id, is_deep_reading, deck_id, tags";

async function fetchFilteredReadings(
  supabase: any,
  userId: string,
  filters: ReturnType<typeof InsightsFiltersSchema.parse>,
  days: number | null,
): Promise<ReadingRow[]> {
  let q = supabase
    .from("readings")
    .select(READING_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null);
  if (days !== null) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte("created_at", since);
  }
  if (filters.spreadTypes.length > 0) q = q.in("spread_type", filters.spreadTypes);
  if (filters.deckIds.length > 0) q = q.in("deck_id", filters.deckIds);
  if (filters.moonPhases.length > 0) q = q.in("moon_phase", filters.moonPhases);
  if (filters.deepOnly) q = q.eq("is_deep_reading", true);
  if (filters.tagIds.length > 0) q = q.overlaps("tags", filters.tagIds);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
  if (error) throw error;
  let rows = (data ?? []) as ReadingRow[];
  if (filters.reversedOnly) {
    rows = rows.filter((r) => (r.card_orientations ?? []).some(Boolean));
  }
  return rows;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10; // one decimal
}

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

export const getInsightsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }): Promise<InsightsOverview> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days, capped } = effectiveWindow(data.timeRange);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);

    const suitCounts = { Wands: 0, Cups: 0, Swords: 0, Pentacles: 0 };
    let majors = 0;
    let minors = 0;
    let totalCards = 0;
    let reversedCards = 0;
    const moonPhases: Record<string, number> = {};
    const guideCounts: Record<string, number> = {};
    const lensCounts: Record<string, number> = {};
    const dayCounts: Record<string, number> = {};
    let deepCount = 0;

    for (const r of rows) {
      const cards = r.card_ids ?? [];
      const orientations = r.card_orientations ?? [];
      cards.forEach((cid, idx) => {
        totalCards += 1;
        if (orientations[idx]) reversedCards += 1;
        const arcana = getCardArcana(cid);
        if (arcana === "major") majors += 1;
        else minors += 1;
        const suit = getCardSuit(cid);
        if (suit !== "Major") suitCounts[suit] += 1;
      });
      if (r.moon_phase) moonPhases[r.moon_phase] = (moonPhases[r.moon_phase] ?? 0) + 1;
      if (r.guide_id) guideCounts[r.guide_id] = (guideCounts[r.guide_id] ?? 0) + 1;
      if (r.lens_id) lensCounts[r.lens_id] = (lensCounts[r.lens_id] ?? 0) + 1;
      if (r.is_deep_reading) deepCount += 1;
      const day = ymd(r.created_at);
      dayCounts[day] = (dayCounts[day] ?? 0) + 1;
    }

    const minorTotal =
      suitCounts.Wands + suitCounts.Cups + suitCounts.Swords + suitCounts.Pentacles;
    const majorMinorDenom = majors + minors;

    // last 30 days bucket regardless of filter window — the rhythm card is fixed.
    const readingsByDay: Array<{ date: string; count: number }> = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      readingsByDay.push({ date: key, count: dayCounts[key] ?? 0 });
    }

    const topGuideEntry = Object.entries(guideCounts).sort((a, b) => b[1] - a[1])[0];
    const topLensEntry = Object.entries(lensCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      totalReadings: rows.length,
      suitBalance: {
        wands: pct(suitCounts.Wands, minorTotal),
        cups: pct(suitCounts.Cups, minorTotal),
        swords: pct(suitCounts.Swords, minorTotal),
        pentacles: pct(suitCounts.Pentacles, minorTotal),
      },
      majorMinor: {
        major: pct(majors, majorMinorDenom),
        minor: pct(minors, majorMinorDenom),
      },
      moonPhaseDistribution: moonPhases,
      reversalRate: totalCards === 0 ? 0 : reversedCards / totalCards,
      readingsByDay,
      topGuide: topGuideEntry
        ? {
            guideId: topGuideEntry[0],
            name: getGuideById(topGuideEntry[0])?.name ?? topGuideEntry[0],
            count: topGuideEntry[1],
          }
        : null,
      topLens: topLensEntry
        ? {
            lensId: topLensEntry[0],
            name: lensLabel(topLensEntry[0]),
            count: topLensEntry[1],
          }
        : null,
      deepReadingsCount: deepCount,
      dataCapped: capped,
    };
  });

export const getStalkerCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }): Promise<StalkerCardsResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);

    const counts = new Map<number, { count: number; appearances: Array<{ readingId: string; date: string }> }>();
    for (const r of rows) {
      for (const cid of r.card_ids ?? []) {
        const entry = counts.get(cid) ?? { count: 0, appearances: [] };
        entry.count += 1;
        entry.appearances.push({ readingId: r.id, date: r.created_at });
        counts.set(cid, entry);
      }
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
    const topCard = sorted[0]
      ? { cardId: sorted[0][0], count: sorted[0][1].count }
      : null;
    const stalkers =
      rows.length < STALKER_MIN_WINDOW
        ? []
        : sorted
            .filter(([, v]) => v.count >= STALKER_THRESHOLD)
            .slice(0, 10)
            .map(([cardId, v]) => ({
              cardId,
              cardName: getCardName(cardId),
              count: v.count,
              appearances: v.appearances,
            }));

    return { stalkerCards: stalkers, topCard, totalReadings: rows.length };
  });

/**
 * EK-2 — Frequency of every card (78 entries) within filter window.
 */
export const getCardFrequency = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const counts = new Array<number>(78).fill(0);
    let totalDraws = 0;
    for (const r of rows) {
      for (const cid of r.card_ids ?? []) {
        if (cid >= 0 && cid < 78) {
          counts[cid] += 1;
          totalDraws += 1;
        }
      }
    }
    return {
      cards: counts.map((count, cardId) => ({ cardId, count })),
      totalDraws,
      totalReadings: rows.length,
    };
  });

/**
 * EK-3 — Card pairs that co-occur in multi-card readings.
 */
export const getCardPairs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const multi = rows.filter((r) => (r.card_ids ?? []).length >= 2);
    const pairCounts = new Map<string, number>();
    const cardCounts = new Map<number, number>();
    for (const r of multi) {
      const cards = Array.from(new Set(r.card_ids ?? []));
      for (const c of cards) cardCounts.set(c, (cardCounts.get(c) ?? 0) + 1);
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const a = Math.min(cards[i], cards[j]);
          const b = Math.max(cards[i], cards[j]);
          const k = `${a}:${b}`;
          pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
        }
      }
    }
    const totalReadings = multi.length;
    const pairs = [...pairCounts.entries()]
      .map(([k, count]) => {
        const [a, b] = k.split(":").map(Number);
        return { cardA: a, cardB: b, count };
      })
      .filter((p) => {
        if (p.count < 3) return false;
        const eitherCount = Math.max(cardCounts.get(p.cardA) ?? 0, cardCounts.get(p.cardB) ?? 0);
        return eitherCount > 0 && p.count / eitherCount >= 0.1;
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((p) => ({
        ...p,
        cardAName: getCardName(p.cardA),
        cardBName: getCardName(p.cardB),
        totalReadings,
      }));
    return { pairs, totalMultiCardReadings: totalReadings };
  });

/**
 * EK-4 — Cards arriving reversed most often.
 * NOTE: Uses the same card_orientations source as getInsightsOverview.
 * Mark has flagged the overall reversal calc as low; pinned for an
 * upcoming reversal-audit prompt — DO NOT adjust here.
 */
export const getReversalPatterns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const totals = new Map<number, { total: number; reversed: number }>();
    let allCards = 0;
    let allReversed = 0;
    for (const r of rows) {
      const cards = r.card_ids ?? [];
      const orients = r.card_orientations ?? [];
      cards.forEach((cid, idx) => {
        const e = totals.get(cid) ?? { total: 0, reversed: 0 };
        e.total += 1;
        allCards += 1;
        if (orients[idx]) {
          e.reversed += 1;
          allReversed += 1;
        }
        totals.set(cid, e);
      });
    }
    const overallRate = allCards === 0 ? 0 : allReversed / allCards;
    const patterns = [...totals.entries()]
      .filter(([, v]) => v.total >= 3 && v.reversed / v.total >= 0.5)
      .sort((a, b) => b[1].reversed - a[1].reversed)
      .slice(0, 5)
      .map(([cardId, v]) => ({
        cardId,
        cardName: getCardName(cardId),
        totalCount: v.total,
        reversedCount: v.reversed,
        reversedRate: v.reversed / v.total,
      }));
    return { patterns, overallReversalRate: overallRate };
  });

/**
 * EK-5 — Detail for a single stalker card.
 */
const StalkerDetailInputSchema = InsightsFiltersSchema.extend({
  cardId: z.number().int().min(0).max(77),
});

export const getStalkerCardDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StalkerDetailInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const filters = InsightsFiltersSchema.parse({ ...data, cardId: undefined });
    const rows = await fetchFilteredReadings(supabase, userId, filters, days);
    const appearances: Array<{
      readingId: string;
      date: string;
      spreadType: string | null;
      isReversed: boolean;
    }> = [];
    let total = 0;
    let reversed = 0;
    for (const r of rows) {
      const cards = r.card_ids ?? [];
      const orients = r.card_orientations ?? [];
      cards.forEach((cid, idx) => {
        if (cid === data.cardId) {
          total += 1;
          const isRev = !!orients[idx];
          if (isRev) reversed += 1;
          appearances.push({
            readingId: r.id,
            date: r.created_at,
            spreadType: r.spread_type,
            isReversed: isRev,
          });
        }
      });
    }
    appearances.sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      cardId: data.cardId,
      cardName: getCardName(data.cardId),
      totalCount: total,
      reversedCount: reversed,
      firstSeen: appearances.length ? appearances[appearances.length - 1].date : null,
      lastSeen: appearances.length ? appearances[0].date : null,
      appearances,
    };
  });

/* ============================================================
 * EM — Calendar tab server functions
 * ============================================================ */

function rangeToCalendarDays(range: TimeRange): number {
  // For the year heatmap. <=30d shows shorter window; otherwise 365 (capped).
  if (range === "7d") return 35;
  if (range === "30d") return 35;
  return 365;
}

/** EM-1 — Daily reading counts for the heatmap. */
export const getCalendarHeatmap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const totalDays = rangeToCalendarDays(data.timeRange);
    // Fetch within free-tier cap window for queries.
    const { days: capDays, capped } = effectiveWindow(data.timeRange);
    const fetchDays = Math.min(totalDays, capDays ?? totalDays);
    const rows = await fetchFilteredReadings(supabase, userId, data, fetchDays);
    const dayMap = new Map<string, { count: number; suits: Record<string, number> }>();
    for (const r of rows) {
      const key = ymd(r.created_at);
      const entry = dayMap.get(key) ?? { count: 0, suits: {} };
      entry.count += 1;
      for (const cid of r.card_ids ?? []) {
        const s = getCardSuit(cid);
        entry.suits[s] = (entry.suits[s] ?? 0) + 1;
      }
      dayMap.set(key, entry);
    }
    const days: Array<{ date: string; count: number; dominantSuit?: string }> = [];
    let max = 0;
    for (let i = totalDays - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      const count = entry?.count ?? 0;
      if (count > max) max = count;
      let dominantSuit: string | undefined;
      if (entry) {
        const top = Object.entries(entry.suits).sort((a, b) => b[1] - a[1])[0];
        dominantSuit = top?.[0];
      }
      days.push({ date: key, count, dominantSuit });
    }
    return { days, maxCount: max, dataCapped: capped };
  });

/** EM-2 — Aggregate readings by moon phase for the calendar ring. */
export const getMoonPhaseStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const phaseCounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.moon_phase) phaseCounts[r.moon_phase] = (phaseCounts[r.moon_phase] ?? 0) + 1;
    }
    const sorted = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]);
    return {
      phaseCounts,
      totalReadings: rows.length,
      dominantPhase: sorted[0]?.[0] ?? null,
    };
  });

/** EM-3 — Hour-of-day distribution. */
const TimeOfDayInputSchema = InsightsFiltersSchema.extend({
  timeZone: z.string().default("UTC"),
});

export const getTimeOfDayPattern = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => TimeOfDayInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { days } = effectiveWindow(data.timeRange);
    const filters = InsightsFiltersSchema.parse({ ...data, timeZone: undefined });
    const rows = await fetchFilteredReadings(supabase, userId, filters, days);
    const tz = data.timeZone || "UTC";
    const hours = new Array<number>(24).fill(0);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    for (const r of rows) {
      try {
        const parts = fmt.formatToParts(new Date(r.created_at));
        const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
        const idx = h === 24 ? 0 : h;
        if (idx >= 0 && idx < 24) hours[idx] += 1;
      } catch {
        // skip
      }
    }
    let peakHour: number | null = null;
    let peakVal = 0;
    hours.forEach((c, i) => {
      if (c > peakVal) {
        peakVal = c;
        peakHour = i;
      }
    });
    const fmtH = (h: number) => {
      const ampm = h < 12 ? "am" : "pm";
      const hh = h % 12 === 0 ? 12 : h % 12;
      return `${hh}${ampm}`;
    };
    const peakLabel = peakHour === null ? "" : `${fmtH(peakHour)}–${fmtH((peakHour + 1) % 24)}`;
    return {
      hours: hours.map((count, hour) => ({ hour, count })),
      peakHour,
      peakLabel,
    };
  });

/** EM-4 — Streak history derived from distinct reading dates. */
export const getStreakHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data: rows, error } = await supabase
      .from("readings")
      .select("created_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) throw error;
    const dateSet = new Set<string>();
    for (const r of (rows ?? []) as Array<{ created_at: string }>) {
      dateSet.add(ymd(r.created_at));
    }
    const dates = [...dateSet].sort();
    const allStreaks: Array<{ startDate: string; endDate: string; length: number; isActive: boolean }> = [];
    let runStart: string | null = null;
    let runEnd: string | null = null;
    let runLen = 0;
    const oneDay = 24 * 60 * 60 * 1000;
    for (const d of dates) {
      if (runEnd === null) {
        runStart = d;
        runEnd = d;
        runLen = 1;
        continue;
      }
      const gap = (new Date(d).getTime() - new Date(runEnd).getTime()) / oneDay;
      if (gap === 1) {
        runEnd = d;
        runLen += 1;
      } else {
        allStreaks.push({ startDate: runStart!, endDate: runEnd, length: runLen, isActive: false });
        runStart = d;
        runEnd = d;
        runLen = 1;
      }
    }
    if (runEnd !== null) {
      allStreaks.push({ startDate: runStart!, endDate: runEnd, length: runLen, isActive: false });
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    const yesterdayKey = new Date(Date.now() - oneDay).toISOString().slice(0, 10);
    if (allStreaks.length > 0) {
      const last = allStreaks[allStreaks.length - 1];
      if (last.endDate === todayKey || last.endDate === yesterdayKey) {
        last.isActive = true;
      }
    }
    const multi = allStreaks.filter((s) => s.length >= 2);
    const singles = allStreaks.filter((s) => s.length === 1).length;
    multi.sort((a, b) => (a.endDate < b.endDate ? 1 : -1));
    const trimmed = multi.slice(0, 20);
    const longest = allStreaks.reduce((m, s) => Math.max(m, s.length), 0);
    const current = allStreaks.find((s) => s.isActive)?.length ?? 0;
    return {
      streaks: trimmed,
      currentStreak: current,
      longestStreak: longest,
      singleDayPulls: singles,
    };
  });