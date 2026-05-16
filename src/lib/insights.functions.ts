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
  type StalkerTwinsResult,
  type StalkerTripletsResult,
  type ReversedStalkersResult,
} from "@/lib/insights.types";
import { getCardArcana, getCardSuit, getCardName } from "@/lib/tarot";
import { getGuideById, LENSES } from "@/lib/guides";
import { z } from "zod";
import { getLunationContaining } from "@/lib/lunation";
import { getAIToneServerSide, TONE_FRAGMENTS, type AITone } from "@/lib/ai-tone";
import { getCurrentMoonPhase } from "@/lib/moon";

// ============================================================================
// Q58 — Suit Trends server function.
//
// Auto-adaptive bucket granularity:
//   range <= 31 days  → daily buckets
//   range 32-180 days → weekly buckets
//   range  > 180 days → monthly buckets
// ============================================================================

export type SuitBucket = {
  /** Sortable ISO key for the bucket start. */
  key: string;
  /** Display label for the X-axis. */
  label: string;
  major: number;
  wands: number;
  cups: number;
  swords: number;
  pentacles: number;
};

export type SuitGranularity = "daily" | "weekly" | "monthly";

/**
 * ES-4 — Older readings predate the `moon_phase` column; derive a
 * phase from `created_at` on the fly so phase rings / distributions /
 * top-phase aggregations don't appear empty for historical data.
 * Returns null only when neither value is usable.
 */
function resolveMoonPhase(
  storedPhase: string | null | undefined,
  createdAt: string | null | undefined,
): string | null {
  if (storedPhase) return storedPhase;
  if (!createdAt) return null;
  try {
    return getCurrentMoonPhase(new Date(createdAt)).phase;
  } catch {
    return null;
  }
}

const FREE_CAP_DAYS = 90;
const STALKER_THRESHOLD = 3;
const STALKER_MIN_WINDOW = 5;
// FP — thresholds for twin/triplet stalkers.
const STALKER_TWIN_THRESHOLD = 2;
const STALKER_TRIPLET_THRESHOLD = 2;

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
    case "365d":
      return 365;
    case "all":
      return null;
  }
}

/**
 * EO-1 — Apply the free-tier cap. Premium users bypass the cap entirely
 * (including "all time" → null day window).
 */
function effectiveWindow(
  range: TimeRange,
  isPremium: boolean,
): { days: number | null; capped: boolean } {
  const requested = rangeToDays(range);
  if (isPremium) {
    return { days: requested, capped: false };
  }
  if (requested === null) return { days: FREE_CAP_DAYS, capped: true };
  if (requested > FREE_CAP_DAYS) return { days: FREE_CAP_DAYS, capped: true };
  return { days: requested, capped: false };
}

/**
 * Q72 — premium tier removed. Always returns true so legacy callers
 * (and their gating branches) become pass-throughs. AI features are
 * gated by credits only; data cap is gone.
 */
async function getIsPremium(_supabase: any, _userId: string): Promise<boolean> {
  return true;
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
  question?: string | null;
};

const READING_COLUMNS =
  "id, created_at, card_ids, card_orientations, spread_type, moon_phase, guide_id, lens_id, is_deep_reading, deck_id, tags, question";

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
  if (filters.deepOnly) q = q.eq("is_deep_reading", true);
  if (filters.tagIds.length > 0) q = q.overlaps("tags", filters.tagIds);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
  if (error) throw error;
  let rows = (data ?? []) as ReadingRow[];
  if (filters.reversedOnly) {
    rows = rows.filter((r) => (r.card_orientations ?? []).some(Boolean));
  }
  if (filters.moonPhases.length > 0) {
    const allowed = new Set(filters.moonPhases);
    rows = rows.filter((r) => {
      const phase = resolveMoonPhase(r.moon_phase, r.created_at);
      return phase ? allowed.has(phase) : false;
    });
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days, capped } = effectiveWindow(data.timeRange, isPremium);
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
      // ER-6 — Reversal rate is reversed cards / total cards across
      // readings whose orientations were tracked. Readings with
      // `card_orientations === null` predate reversal tracking and
      // would otherwise inflate the denominator and depress the rate.
      const orientationsTracked = r.card_orientations !== null;
      cards.forEach((cid, idx) => {
        if (orientationsTracked) {
          totalCards += 1;
          if (orientations[idx]) reversedCards += 1;
        }
        const arcana = getCardArcana(cid);
        if (arcana === "major") majors += 1;
        else minors += 1;
        const suit = getCardSuit(cid);
        if (suit !== "Major") suitCounts[suit] += 1;
      });
      const phase0 = resolveMoonPhase(r.moon_phase, r.created_at);
      if (phase0) moonPhases[phase0] = (moonPhases[phase0] ?? 0) + 1;
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
        major: pct(majors, majors + minorTotal),
        wands: pct(suitCounts.Wands, majors + minorTotal),
        cups: pct(suitCounts.Cups, majors + minorTotal),
        swords: pct(suitCounts.Swords, majors + minorTotal),
        pentacles: pct(suitCounts.Pentacles, majors + minorTotal),
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const counts = new Array<number>(78).fill(0);
    const reversedCounts = new Array<number>(78).fill(0);
    const recent: Array<string | null> = new Array<string | null>(78).fill(null);
    let totalDraws = 0;
    for (const r of rows) {
      const ids = r.card_ids ?? [];
      const orients = r.card_orientations ?? [];
      const ts = r.created_at;
      for (let i = 0; i < ids.length; i++) {
        const cid = ids[i];
        if (cid < 0 || cid >= 78) continue;
        counts[cid] += 1;
        totalDraws += 1;
        if (orients[i]) reversedCounts[cid] += 1;
        if (!recent[cid] || ts > (recent[cid] as string)) recent[cid] = ts;
      }
    }
    return {
      cards: counts.map((count, cardId) => ({
        cardId,
        count,
        reversedCount: reversedCounts[cardId],
        lastSeen: recent[cardId],
      })),
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const totals = new Map<number, { total: number; reversed: number }>();
    let allCards = 0;
    let allReversed = 0;
    for (const r of rows) {
      const cards = r.card_ids ?? [];
      const orients = r.card_orientations ?? [];
      // ER-6 — skip readings without tracked orientations so old
      // pre-tracking readings don't depress the reversal totals.
      if (r.card_orientations === null) continue;
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const filters = InsightsFiltersSchema.parse({ ...data, cardId: undefined });
    const rows = await fetchFilteredReadings(supabase, userId, filters, days);
    const appearances: Array<{
      readingId: string;
      date: string;
      spreadType: string | null;
      isReversed: boolean;
      question: string | null;
      cardIds: number[];
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
            question: r.question ?? null,
            cardIds: cards,
          });
        }
      });
    }
    appearances.sort((a, b) => (a.date < b.date ? 1 : -1));
    // Q64 — Co-occurrence: count other cards in readings that contain this card.
    const coCounts = new Map<number, number>();
    for (const r of rows) {
      const cards = r.card_ids ?? [];
      if (!cards.includes(data.cardId)) continue;
      const seen = new Set<number>();
      for (const cid of cards) {
        if (cid === data.cardId || seen.has(cid)) continue;
        seen.add(cid);
        coCounts.set(cid, (coCounts.get(cid) ?? 0) + 1);
      }
    }
    const coOccurrences = Array.from(coCounts.entries())
      .map(([cardId, count]) => ({ cardId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    return {
      cardId: data.cardId,
      cardName: getCardName(data.cardId),
      totalCount: total,
      reversedCount: reversed,
      firstSeen: appearances.length ? appearances[appearances.length - 1].date : null,
      lastSeen: appearances.length ? appearances[0].date : null,
      appearances,
      coOccurrences,
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
    const isPremium = await getIsPremium(supabase, userId);
    const totalDays = rangeToCalendarDays(data.timeRange);
    // Fetch within free-tier cap window for queries.
    const { days: capDays, capped } = effectiveWindow(data.timeRange, isPremium);
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const phaseCounts: Record<string, number> = {};
    for (const r of rows) {
      // ES-4 — backfill from created_at when historical row has no moon_phase.
      const phase = resolveMoonPhase(r.moon_phase, r.created_at);
      if (phase) phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;
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
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
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
    const isPremium = await getIsPremium(supabase, userId);
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
/* ============================================================
 * EM — Themes tab server functions
 * ============================================================ */

/** EM-1 — Tag cloud aggregation. Reads `tags` array per row. */
export const getTagCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const counts = new Map<string, number>();
    let tagged = 0;
    for (const r of rows) {
      const tags = r.tags ?? [];
      if (tags.length > 0) tagged += 1;
      for (const t of tags) {
        if (!t) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([tagId, count]) => ({ tagId, name: tagId, count }));
    return {
      tags,
      uniqueTags: counts.size,
      totalReadings: rows.length,
      taggedReadings: tagged,
    };
  });

/** EM-2 — Guide preferences over time, bucketed by week or month. */
export const getGuidePreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const useWeekly = data.timeRange === "7d" || data.timeRange === "30d";
    function bucketKey(iso: string): string {
      const d = new Date(iso);
      if (useWeekly) {
        // ISO week start (Monday)
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() - (day - 1));
        return d.toISOString().slice(0, 10);
      }
      return iso.slice(0, 7);
    }
    const guideTotals = new Map<string, number>();
    const buckets = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const g = r.guide_id;
      if (!g) continue;
      guideTotals.set(g, (guideTotals.get(g) ?? 0) + 1);
      const k = bucketKey(r.created_at);
      const m = buckets.get(k) ?? new Map<string, number>();
      m.set(g, (m.get(g) ?? 0) + 1);
      buckets.set(k, m);
    }
    const topGuides = [...guideTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id]) => id);
    const guides = topGuides.map((id) => ({
      guideId: id,
      name: getGuideById(id)?.name ?? id,
      totalCount: guideTotals.get(id) ?? 0,
    }));
    const months = [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, m]) => {
        const counts: Record<string, number> = {};
        for (const id of topGuides) counts[id] = m.get(id) ?? 0;
        return { month, counts };
      });
    return { months, guides, bucket: (useWeekly ? "week" : "month") as "week" | "month" };
  });

/** EM-3 — Lens distribution across all (and deep) readings. */
export const getLensDistribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const counts = new Map<string, number>();
    let totalDeep = 0;
    for (const r of rows) {
      if (r.is_deep_reading) totalDeep += 1;
      if (r.lens_id) counts.set(r.lens_id, (counts.get(r.lens_id) ?? 0) + 1);
    }
    const lenses = LENSES.map((l) => ({
      lensId: l.id,
      name: l.name,
      count: counts.get(l.id) ?? 0,
    }));
    const sorted = [...lenses].sort((a, b) => b.count - a.count);
    const dominantLens = sorted[0] && sorted[0].count > 0 ? sorted[0].lensId : null;
    const allEven = lenses.every((l) => l.count === lenses[0].count);
    return {
      lenses,
      totalDeepReadings: totalDeep,
      dominantLens,
      allEven,
      hasAnyLens: lenses.some((l) => l.count > 0),
    };
  });

/* ============================================================
 * EN — Recap (lunation) server functions
 * ============================================================ */

const LunationRecapInputSchema = z.object({
  lunationStart: z.string(), // ISO datetime
});

/**
 * EN-6 — Aggregate everything needed for the Lunation Recap story.
 * Lunation queries are astronomically anchored, not time-windowed,
 * so the 90-day free-tier cap does NOT apply here.
 *
 * NOTE: reversal calc reuses card_orientations; pinned reversal-audit
 * is upstream. DO NOT adjust here.
 */
export const getLunationRecap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => LunationRecapInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const startDate = new Date(data.lunationStart);
    const containing = getLunationContaining(startDate);
    const start = containing.start;
    const end = containing.end;

    const { data: rowsRaw, error } = await supabase
      .from("readings")
      .select(READING_COLUMNS_EN)
      .eq("user_id", userId)
      .is("archived_at", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error) throw error;
    const rows = (rowsRaw ?? []) as Array<{
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
    }>;

    const cardCounts = new Map<number, number>();
    const suitCounts = { Wands: 0, Cups: 0, Swords: 0, Pentacles: 0 };
    let majors = 0;
    let minors = 0;
    let totalCards = 0;
    let reversedCards = 0;
    const moonPhases: Record<string, number> = {};
    const guideCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const pairCounts = new Map<string, number>();

    for (const r of rows) {
      const cards = r.card_ids ?? [];
      const orients = r.card_orientations ?? [];
      // ER-6 — see getInsightsOverview: skip readings without
      // tracked orientations so the lunation reversal rate isn't
      // depressed by pre-tracking history.
      const orientationsTracked = r.card_orientations !== null;
      cards.forEach((cid, idx) => {
        if (orientationsTracked) {
          totalCards += 1;
          if (orients[idx]) reversedCards += 1;
        }
        cardCounts.set(cid, (cardCounts.get(cid) ?? 0) + 1);
        const arcana = getCardArcana(cid);
        if (arcana === "major") majors += 1;
        else minors += 1;
        const suit = getCardSuit(cid);
        if (suit !== "Major") suitCounts[suit] += 1;
      });
      if (cards.length >= 2) {
        const unique = Array.from(new Set(cards));
        for (let i = 0; i < unique.length; i += 1) {
          for (let j = i + 1; j < unique.length; j += 1) {
            const a = Math.min(unique[i], unique[j]);
            const b = Math.max(unique[i], unique[j]);
            const k = `${a}:${b}`;
            pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
          }
        }
      }
      // ES-4 — backfill from created_at when historical row has no moon_phase.
      {
        const phase = resolveMoonPhase(r.moon_phase, r.created_at);
        if (phase) moonPhases[phase] = (moonPhases[phase] ?? 0) + 1;
      }
      if (r.guide_id) guideCounts[r.guide_id] = (guideCounts[r.guide_id] ?? 0) + 1;
      for (const t of r.tags ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }

    const minorTotal = suitCounts.Wands + suitCounts.Cups + suitCounts.Swords + suitCounts.Pentacles;
    const sortedCards = [...cardCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topStalker = sortedCards[0]
      ? {
          cardId: sortedCards[0][0],
          count: sortedCards[0][1],
          cardName: getCardName(sortedCards[0][0]),
        }
      : null;

    const topGuideEntry = Object.entries(guideCounts).sort((a, b) => b[1] - a[1])[0];
    const topGuide = topGuideEntry
      ? {
          guideId: topGuideEntry[0],
          name: getGuideById(topGuideEntry[0])?.name ?? topGuideEntry[0],
          count: topGuideEntry[1],
        }
      : null;

    const topMoonPhaseEntry = Object.entries(moonPhases).sort((a, b) => b[1] - a[1])[0];
    const topMoonPhase = topMoonPhaseEntry
      ? { phase: topMoonPhaseEntry[0], count: topMoonPhaseEntry[1] }
      : null;

    const topPairs = [...pairCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, count]) => {
        const [a, b] = k.split(":").map(Number);
        return {
          cardA: a,
          cardB: b,
          cardAName: getCardName(a),
          cardBName: getCardName(b),
          count,
        };
      });

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tagName, count]) => ({ tagName, count }));

    const pctOf = (part: number, total: number) =>
      total <= 0 ? 0 : Math.round((part / total) * 1000) / 10;

    return {
      lunationStart: start.toISOString(),
      lunationEnd: end.toISOString(),
      readingCount: rows.length,
      topStalker,
      suitBalance: {
        wands: pctOf(suitCounts.Wands, minorTotal),
        cups: pctOf(suitCounts.Cups, minorTotal),
        swords: pctOf(suitCounts.Swords, minorTotal),
        pentacles: pctOf(suitCounts.Pentacles, minorTotal),
      },
      topGuide,
      majorMinor: {
        major: pctOf(majors, majors + minors),
        minor: pctOf(minors, majors + minors),
      },
      reversalRate: totalCards === 0 ? 0 : reversedCards / totalCards,
      topMoonPhase,
      topPairs,
      topTags,
    };
  });

const READING_COLUMNS_EN =
  "id, created_at, card_ids, card_orientations, spread_type, moon_phase, guide_id, lens_id, is_deep_reading, deck_id, tags";

/** EN-2 — Earliest reading date for the user (used to bound lunation history). */
export const getEarliestReadingDate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { data, error } = await supabase
      .from("readings")
      .select("created_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    const first = (data ?? [])[0];
    return { earliest: first ? (first.created_at as string) : null };
  });

/* ============================================================
 * EP — Premium AI server functions
 * ============================================================ */

import { callAnthropicWithFallback, isUserPremium } from "@/lib/ai-call.server";

async function callAnthropicShort(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 200,
  userId?: string | null,
): Promise<string | null> {
  const r = await callAnthropicWithFallback({
    callType: "insights",
    userId: userId ?? null,
    isPremium: userId ? await isUserPremium(userId) : false,
    system: systemPrompt,
    user: userPrompt,
    maxTokens,
  });
  return r.ok ? r.content : null;
}

async function readCachedReflection(
  supabase: any,
  userId: string,
  cacheKey: string,
): Promise<{ reflection: string; generatedAt: string } | null> {
  const { data } = await supabase
    .from("insight_reflections")
    .select("reflection, generated_at")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  const row = data as { reflection?: string; generated_at?: string } | null;
  if (!row?.reflection) return null;
  return { reflection: row.reflection, generatedAt: row.generated_at ?? new Date().toISOString() };
}

async function writeCachedReflection(
  supabase: any,
  userId: string,
  cacheKey: string,
  reflection: string,
): Promise<void> {
  await supabase
    .from("insight_reflections")
    .upsert(
      { user_id: userId, cache_key: cacheKey, reflection, generated_at: new Date().toISOString() },
      { onConflict: "user_id,cache_key" },
    );
}

async function readCachedThemes(
  supabase: any,
  userId: string,
  cacheKey: string,
): Promise<{ themes: unknown; generatedAt: string } | null> {
  const { data } = await supabase
    .from("insight_themes")
    .select("themes, generated_at")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  const row = data as { themes?: unknown; generated_at?: string } | null;
  if (row == null || row.themes == null) return null;
  return { themes: row.themes, generatedAt: row.generated_at ?? new Date().toISOString() };
}

async function writeCachedThemes(
  supabase: any,
  userId: string,
  cacheKey: string,
  themes: unknown,
): Promise<void> {
  await supabase
    .from("insight_themes")
    .upsert(
      { user_id: userId, cache_key: cacheKey, themes, generated_at: new Date().toISOString() },
      { onConflict: "user_id,cache_key" },
    );
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/* ---------------- EP-4 — Stalker reflection ---------------- */

const StalkerReflectionInput = z.object({
  cardId: z.number().int().min(0).max(77),
  count: z.number().int(),
  latestDate: z.string(),
  sampleQuestions: z.array(z.string()).max(10).default([]),
});

function buildStalkerSystemPrompt(tone: AITone): string {
  return [
    "You are reflecting on a recurring tarot card pattern in the seeker's practice.",
    "Your job is to write ONE short reflective prompt (1-2 sentences, max 60 words)",
    "that helps the seeker notice what this recurring card might be inviting them to see.",
    "Do not predict outcomes. Do not give advice. Invite reflection.",
    TONE_FRAGMENTS[tone],
  ].join(" ");
}

function buildStalkerUserPrompt(
  cardName: string,
  data: { count: number; latestDate: string; sampleQuestions: string[] },
): string {
  const lines: string[] = [
    `${cardName} has appeared ${data.count} times in this seeker's recent readings.`,
  ];
  if (data.sampleQuestions.length > 0) {
    lines.push(
      "Sample questions when this card appeared:\n" +
        data.sampleQuestions.map((q) => `- "${q}"`).join("\n"),
    );
  }
  lines.push("Write the reflective prompt now.");
  return lines.join("\n\n");
}

export const getStalkerReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StalkerReflectionInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    if (!isPremium) return { ok: false as const, error: "premium_required" };
    const cacheKey = `stalker:${data.cardId}:${data.count}:${data.latestDate}`;
    const cached = await readCachedReflection(supabase, userId, cacheKey);
    if (cached) return { ok: true as const, reflection: cached.reflection };
    const tone = await getAIToneServerSide(supabase, userId);
    const cardName = getCardName(data.cardId);
    const systemPrompt = buildStalkerSystemPrompt(tone);
    const userPrompt = buildStalkerUserPrompt(cardName, data);
    const reflection = await callAnthropicShort(systemPrompt, userPrompt, 200, userId);
    if (!reflection) return { ok: false as const, error: "ai_unavailable" };
    await writeCachedReflection(supabase, userId, cacheKey, reflection);
    return { ok: true as const, reflection };
  });

/* ---------------- EP-6 — Question themes ---------------- */

export type QuestionTheme = {
  theme: string;
  percentage: number;
  sample_questions: string[];
};

function buildThemesSystemPrompt(tone: AITone): string {
  return [
    "You analyze a list of tarot questions a seeker has asked over time.",
    "Identify up to 5 recurring themes. Group similar questions.",
    "Output STRICT JSON only — an array like:",
    '[{"theme":"Career","percentage":28,"sample_questions":["..."]}]',
    "Percentages should sum to ~100. Each theme should include 1-3 short sample questions.",
    "Theme names should be 1-3 words, in the requested voice.",
    TONE_FRAGMENTS[tone],
  ].join(" ");
}

function parseThemesResponse(raw: string): QuestionTheme[] | null {
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end < 0) return null;
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((x) => {
        const o = x as { theme?: unknown; percentage?: unknown; sample_questions?: unknown };
        if (typeof o.theme !== "string") return null;
        const pct = typeof o.percentage === "number" ? o.percentage : Number(o.percentage);
        if (!Number.isFinite(pct)) return null;
        const samples = Array.isArray(o.sample_questions)
          ? (o.sample_questions as unknown[]).filter((q): q is string => typeof q === "string").slice(0, 3)
          : [];
        return { theme: o.theme, percentage: Math.round(pct), sample_questions: samples };
      })
      .filter((t): t is QuestionTheme => !!t)
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);
  } catch {
    return null;
  }
}

export const getQuestionThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    InsightsFiltersSchema.extend({ cacheOnly: z.boolean().optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    if (!isPremium) return { ok: false as const, error: "premium_required" };
    const cacheOnly = (data as { cacheOnly?: boolean }).cacheOnly === true;
    const { days } = effectiveWindow(data.timeRange, isPremium);

    // Pull questions from the same filtered window.
    let q = supabase
      .from("readings")
      .select("question, created_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .not("question", "is", null);
    if (days !== null) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      q = q.gte("created_at", since);
    }
    const { data: rowsRaw, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) return { ok: false as const, error: "ai_unavailable" };
    const questions = ((rowsRaw ?? []) as Array<{ question: string | null }>)
      .map((r) => (r.question ?? "").trim())
      .filter((s): s is string => s.length > 3);

    if (questions.length < 5) {
      return { ok: false as const, error: "insufficient_questions", count: questions.length };
    }

    const tone = await getAIToneServerSide(supabase, userId);
    const sortedKey = [...questions].sort().join("|");
    const cacheKey = `themes:${tone}:${hashString(sortedKey)}`;
    const cached = await readCachedThemes(supabase, userId, cacheKey);
    if (cached) {
      return {
        ok: true as const,
        themes: cached.themes as QuestionTheme[],
        generatedAt: cached.generatedAt,
      };
    }
    if (cacheOnly) return { ok: false as const, error: "no_cache" as const };

    const systemPrompt = buildThemesSystemPrompt(tone);
    const userPrompt =
      "Questions:\n" +
      questions.slice(0, 100).map((s, i) => `${i + 1}. ${s}`).join("\n") +
      "\n\nReturn the JSON array now.";
    const raw = await callAnthropicShort(systemPrompt, userPrompt, 1500, userId);
    if (!raw) return { ok: false as const, error: "ai_unavailable" };
    const themes = parseThemesResponse(raw);
    if (!themes || themes.length === 0) return { ok: false as const, error: "invalid_response" };
    await writeCachedThemes(supabase, userId, cacheKey, themes);
    return { ok: true as const, themes, generatedAt: new Date().toISOString() };
  });

/* ---------------- EP-9 — Lunation reflection ---------------- */

const LunationReflectionInput = z.object({
  lunationStart: z.string(),
  cacheOnly: z.boolean().optional(),
});

function buildLunationSystemPrompt(tone: AITone): string {
  return [
    "Write a 3-paragraph reflection on the seeker's tarot lunation as a whole.",
    "First paragraph: the dominant theme. Second: a notable shift, recurrence, or pattern.",
    "Third: an invitation forward. Each paragraph: 2-4 sentences. Total under 250 words.",
    "Separate paragraphs with a single blank line.",
    TONE_FRAGMENTS[tone],
  ].join(" ");
}

function buildLunationUserPrompt(s: {
  range: string;
  readingCount: number;
  topStalker: { cardName: string; count: number } | null;
  topGuide: string | null;
  majorMinor: { major: number; minor: number };
  reversalRate: number;
  topMoonPhase: string | null;
  topPairs: Array<{ cardAName: string; cardBName: string; count: number }>;
  topTags: Array<{ tagName: string; count: number }>;
}): string {
  const lines: string[] = [
    `Lunation range: ${s.range}`,
    `Readings drawn: ${s.readingCount}`,
  ];
  if (s.topStalker) lines.push(`Top recurring card: ${s.topStalker.cardName} (×${s.topStalker.count})`);
  if (s.topGuide) lines.push(`Top guide: ${s.topGuide}`);
  lines.push(`Major/Minor balance: ${s.majorMinor.major}% major / ${s.majorMinor.minor}% minor`);
  lines.push(`Reversal rate: ${Math.round(s.reversalRate * 100)}%`);
  if (s.topMoonPhase) lines.push(`Top moon phase: ${s.topMoonPhase}`);
  if (s.topPairs.length) {
    lines.push("Notable pairs: " + s.topPairs.slice(0, 3).map((p) => `${p.cardAName}+${p.cardBName} (×${p.count})`).join(", "));
  }
  if (s.topTags.length) {
    lines.push("Recurring tags: " + s.topTags.slice(0, 5).map((t) => `${t.tagName} (×${t.count})`).join(", "));
  }
  lines.push("Write the 3-paragraph reflection now.");
  return lines.join("\n");
}

async function computeLunationSummaryForReflection(
  supabase: any,
  userId: string,
  lunationStartIso: string,
) {
  const startDate = new Date(lunationStartIso);
  const containing = getLunationContaining(startDate);
  const start = containing.start;
  const end = containing.end;

  const { data: rowsRaw, error } = await supabase
    .from("readings")
    .select("created_at, card_ids, card_orientations, moon_phase, guide_id, tags")
    .eq("user_id", userId)
    .is("archived_at", null)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .limit(2000);
  if (error) return null;
  const rows = (rowsRaw ?? []) as Array<{
    created_at: string;
    card_ids: number[] | null;
    card_orientations: boolean[] | null;
    moon_phase: string | null;
    guide_id: string | null;
    tags: string[] | null;
  }>;
  if (rows.length === 0) return null;
  const cardCounts = new Map<number, number>();
  let majors = 0;
  let minors = 0;
  let totalCards = 0;
  let reversed = 0;
  const moonPhases: Record<string, number> = {};
  const guideCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const pairCounts = new Map<string, number>();
  for (const r of rows) {
    const cards = r.card_ids ?? [];
    const orients = r.card_orientations ?? [];
    cards.forEach((cid, idx) => {
      totalCards += 1;
      if (orients[idx]) reversed += 1;
      cardCounts.set(cid, (cardCounts.get(cid) ?? 0) + 1);
      if (getCardArcana(cid) === "major") majors += 1;
      else minors += 1;
    });
    if (cards.length >= 2) {
      const u = Array.from(new Set(cards));
      for (let i = 0; i < u.length; i += 1)
        for (let j = i + 1; j < u.length; j += 1) {
          const a = Math.min(u[i], u[j]);
          const b = Math.max(u[i], u[j]);
          pairCounts.set(`${a}:${b}`, (pairCounts.get(`${a}:${b}`) ?? 0) + 1);
        }
    }
    // ES-4 — backfill from created_at when historical row has no moon_phase.
    {
      const phase = resolveMoonPhase(r.moon_phase, r.created_at);
      if (phase) moonPhases[phase] = (moonPhases[phase] ?? 0) + 1;
    }
    if (r.guide_id) guideCounts[r.guide_id] = (guideCounts[r.guide_id] ?? 0) + 1;
    for (const t of r.tags ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  const sortedCards = [...cardCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topStalker = sortedCards[0]
    ? { cardName: getCardName(sortedCards[0][0]), count: sortedCards[0][1] }
    : null;
  const topGuideEntry = Object.entries(guideCounts).sort((a, b) => b[1] - a[1])[0];
  const topGuide = topGuideEntry ? getGuideById(topGuideEntry[0])?.name ?? topGuideEntry[0] : null;
  const topMoonEntry = Object.entries(moonPhases).sort((a, b) => b[1] - a[1])[0];
  const topMoonPhase = topMoonEntry ? topMoonEntry[0] : null;
  const topPairs = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, count]) => {
      const [a, b] = k.split(":").map(Number);
      return { cardAName: getCardName(a), cardBName: getCardName(b), count };
    });
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tagName, count]) => ({ tagName, count }));
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return {
    range: `${fmt(start)} – ${fmt(end)}`,
    readingCount: rows.length,
    topStalker,
    topGuide,
    majorMinor: {
      major: majors + minors === 0 ? 0 : Math.round((majors / (majors + minors)) * 100),
      minor: majors + minors === 0 ? 0 : Math.round((minors / (majors + minors)) * 100),
    },
    reversalRate: totalCards === 0 ? 0 : reversed / totalCards,
    topMoonPhase,
    topPairs,
    topTags,
  };
}

export const getLunationReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => LunationReflectionInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    if (!isPremium) return { ok: false as const, error: "premium_required" };
    const cacheKey = `lunation_ref:${data.lunationStart}`;
    const cached = await readCachedReflection(supabase, userId, cacheKey);
    if (cached) {
      return {
        ok: true as const,
        reflection: cached.reflection,
        generatedAt: cached.generatedAt,
      };
    }
    if (data.cacheOnly) return { ok: false as const, error: "no_cache" as const };
    const summary = await computeLunationSummaryForReflection(supabase, userId, data.lunationStart);
    if (!summary) return { ok: false as const, error: "no_data" };
    const tone = await getAIToneServerSide(supabase, userId);
    const systemPrompt = buildLunationSystemPrompt(tone);
    const userPrompt = buildLunationUserPrompt(summary);
    const raw = await callAnthropicShort(systemPrompt, userPrompt, 600, userId);
    if (!raw) return { ok: false as const, error: "ai_unavailable" };
    await writeCachedReflection(supabase, userId, cacheKey, raw);
    return { ok: true as const, reflection: raw, generatedAt: new Date().toISOString() };
  });

/* ---------------- EP-10 — Year of Lunations ---------------- */

export const getYearOfLunationsRecap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    if (!isPremium) return { ok: false as const, error: "premium_required" } as const;

    // Past 13 lunations.
    const today = new Date();
    const lunations: Array<{ start: Date; end: Date }> = [];
    let containing = getLunationContaining(today);
    lunations.push({ start: containing.start, end: containing.end });
    for (let i = 0; i < 12; i += 1) {
      const prev = getLunationContaining(new Date(containing.start.getTime() - 86400000));
      lunations.push(prev);
      containing = prev;
    }
    const earliest = lunations[lunations.length - 1].start;

    const { data: rowsRaw, error } = await supabase
      .from("readings")
      .select("created_at, card_ids, card_orientations, moon_phase, guide_id, lens_id, is_deep_reading, tags")
      .eq("user_id", userId)
      .is("archived_at", null)
      .gte("created_at", earliest.toISOString())
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) return { ok: false as const, error: "ai_unavailable" } as const;
    const rows = (rowsRaw ?? []) as Array<{
      created_at: string;
      card_ids: number[] | null;
      card_orientations: boolean[] | null;
      moon_phase: string | null;
      guide_id: string | null;
      lens_id: string | null;
      is_deep_reading: boolean | null;
      tags: string[] | null;
    }>;

    if (lunations.length < 13) {
      return { ok: false as const, error: "not_enough_lunations" } as const;
    }

    const cardCounts = new Map<number, number>();
    const suitByQuarter: Array<Record<string, number>> = [{}, {}, {}, {}];
    const moonPhases: Record<string, number> = {};
    const guideCounts: Record<string, number> = {};
    const lensCounts: Record<string, number> = {};
    const tagsByHalf: Array<Record<string, number>> = [{}, {}];
    const pairCounts = new Map<string, number>();
    const readingsPerLunation: number[] = new Array(13).fill(0);
    const dateSet = new Set<string>();

    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      // Locate the lunation index (0 = current, 12 = oldest).
      const idx = lunations.findIndex(
        (l) => t >= l.start.getTime() && t < l.end.getTime(),
      );
      if (idx < 0) continue;
      readingsPerLunation[idx] += 1;
      const quarter = Math.min(3, Math.floor(idx / 3.25));
      const halfIndex = idx < 6 ? 0 : 1;
      dateSet.add(r.created_at.slice(0, 10));
      const cards = r.card_ids ?? [];
      cards.forEach((cid) => {
        cardCounts.set(cid, (cardCounts.get(cid) ?? 0) + 1);
        const suit = getCardSuit(cid);
        if (suit !== "Major") {
          suitByQuarter[quarter][suit] = (suitByQuarter[quarter][suit] ?? 0) + 1;
        }
      });
      if (cards.length >= 2) {
        const u = Array.from(new Set(cards));
        for (let i = 0; i < u.length; i += 1)
          for (let j = i + 1; j < u.length; j += 1) {
            const a = Math.min(u[i], u[j]);
            const b = Math.max(u[i], u[j]);
            pairCounts.set(`${a}:${b}`, (pairCounts.get(`${a}:${b}`) ?? 0) + 1);
          }
      }
      // ES-4 — backfill from created_at when historical row has no moon_phase.
      {
        const phase = resolveMoonPhase(r.moon_phase, r.created_at);
        if (phase) moonPhases[phase] = (moonPhases[phase] ?? 0) + 1;
      }
      if (r.guide_id) guideCounts[r.guide_id] = (guideCounts[r.guide_id] ?? 0) + 1;
      if (r.lens_id) lensCounts[r.lens_id] = (lensCounts[r.lens_id] ?? 0) + 1;
      for (const tag of r.tags ?? []) tagsByHalf[halfIndex][tag] = (tagsByHalf[halfIndex][tag] ?? 0) + 1;
    }

    const sortedCards = [...cardCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topCard = sortedCards[0]
      ? { cardId: sortedCards[0][0], cardName: getCardName(sortedCards[0][0]), count: sortedCards[0][1] }
      : null;
    const topGuideEntry = Object.entries(guideCounts).sort((a, b) => b[1] - a[1])[0];
    const topGuide = topGuideEntry
      ? { name: getGuideById(topGuideEntry[0])?.name ?? topGuideEntry[0], count: topGuideEntry[1] }
      : null;
    const topLensEntry = Object.entries(lensCounts).sort((a, b) => b[1] - a[1])[0];
    const topLens = topLensEntry ? { name: lensLabel(topLensEntry[0]), count: topLensEntry[1] } : null;
    const topMoonEntry = Object.entries(moonPhases).sort((a, b) => b[1] - a[1])[0];
    const topMoonPhase = topMoonEntry ? topMoonEntry[0] : null;
    const topPairs = [...pairCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, count]) => {
        const [a, b] = k.split(":").map(Number);
        return { cardAName: getCardName(a), cardBName: getCardName(b), count };
      });

    // Most-evolved theme: tag with biggest absolute change between halves.
    const allTags = new Set([...Object.keys(tagsByHalf[0]), ...Object.keys(tagsByHalf[1])]);
    let evolvedTag: { tag: string; older: number; recent: number } | null = null;
    let bestDelta = 0;
    for (const tag of allTags) {
      const older = tagsByHalf[1][tag] ?? 0;
      const recent = tagsByHalf[0][tag] ?? 0;
      const delta = Math.abs(recent - older);
      if (delta > bestDelta) {
        bestDelta = delta;
        evolvedTag = { tag, older, recent };
      }
    }

    // Longest streak in window.
    const sortedDates = [...dateSet].sort();
    let longest = 0;
    let run = 0;
    let prev: number | null = null;
    for (const d of sortedDates) {
      const tms = new Date(d).getTime();
      if (prev !== null && (tms - prev) === 86400000) run += 1;
      else run = 1;
      if (run > longest) longest = run;
      prev = tms;
    }

    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return {
      ok: true as const,
      dateRange: `${fmt(earliest)} – ${fmt(today)}`,
      totalReadings: rows.length,
      readingsPerLunation: readingsPerLunation.slice().reverse(), // oldest -> newest
      topCard,
      suitByQuarter, // 4 entries, oldest -> newest order needs reversal:
      topGuide,
      topLens,
      topMoonPhase,
      topPairs,
      evolvedTag,
      longestStreak: longest,
      daysRead: dateSet.size,
    };
  });

const YearOfLunationsReflectionInput = z.object({ ack: z.literal(true).optional() });

function buildYearReflectionSystemPrompt(tone: AITone): string {
  return [
    "Write a 4-paragraph reflection on the seeker's full year of tarot practice.",
    "Paragraph 1: the dominant arc of the year. Paragraph 2: a meaningful shift across the seasons.",
    "Paragraph 3: a recurring symbol or theme that defined the year. Paragraph 4: an invitation forward.",
    "Each paragraph: 3-5 sentences. Total under 380 words. Separate paragraphs with a single blank line.",
    TONE_FRAGMENTS[tone],
  ].join(" ");
}

export const getYearOfLunationsReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => YearOfLunationsReflectionInput.parse(raw))
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    if (!isPremium) return { ok: false as const, error: "premium_required" };
    // Cache key per ISO week so the year reflection is reasonably stable.
    const today = new Date();
    const weekKey = `${today.getUTCFullYear()}-${Math.floor((today.getTime() / 86400000 + 4) / 7)}`;
    const cacheKey = `yol_ref:${weekKey}`;
    const cached = await readCachedReflection(supabase, userId, cacheKey);
    if (cached) return { ok: true as const, reflection: cached.reflection };

    // Pull a compact summary for the prompt.
    const earliest = new Date(today.getTime() - 13 * 30 * 86400000);
    const { data: rowsRaw } = await supabase
      .from("readings")
      .select("created_at, card_ids, moon_phase, guide_id, tags")
      .eq("user_id", userId)
      .is("archived_at", null)
      .gte("created_at", earliest.toISOString())
      .limit(5000);
    const rows = (rowsRaw ?? []) as Array<{
      created_at: string;
      card_ids: number[] | null;
      moon_phase: string | null;
      guide_id: string | null;
      tags: string[] | null;
    }>;
    if (rows.length === 0) return { ok: false as const, error: "no_data" };
    const cardCounts = new Map<number, number>();
    const tagCounts: Record<string, number> = {};
    const moonPhases: Record<string, number> = {};
    const guideCounts: Record<string, number> = {};
    for (const r of rows) {
      for (const c of r.card_ids ?? []) cardCounts.set(c, (cardCounts.get(c) ?? 0) + 1);
      for (const t of r.tags ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      // ES-4 — backfill from created_at when historical row has no moon_phase.
      {
        const phase = resolveMoonPhase(r.moon_phase, r.created_at);
        if (phase) moonPhases[phase] = (moonPhases[phase] ?? 0) + 1;
      }
      if (r.guide_id) guideCounts[r.guide_id] = (guideCounts[r.guide_id] ?? 0) + 1;
    }
    const top = (m: Record<string, number>, n: number) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
    const topCards = [...cardCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([cid, c]) => `${getCardName(cid)} (×${c})`);
    const tone = await getAIToneServerSide(supabase, userId);
    const userPrompt = [
      `Total readings across the year: ${rows.length}`,
      `Top recurring cards: ${topCards.join(", ")}`,
      `Top tags: ${top(tagCounts, 5).map(([t, c]) => `${t} (×${c})`).join(", ")}`,
      `Top moon phases: ${top(moonPhases, 3).map(([p, c]) => `${p} (×${c})`).join(", ")}`,
      `Top guides: ${top(guideCounts, 3).map(([g, c]) => `${getGuideById(g)?.name ?? g} (×${c})`).join(", ")}`,
      "Write the 4-paragraph reflection now.",
    ].join("\n");
    const systemPrompt = buildYearReflectionSystemPrompt(tone);
    const raw = await callAnthropicShort(systemPrompt, userPrompt, 800, userId);
    if (!raw) return { ok: false as const, error: "ai_unavailable" };
    await writeCachedReflection(supabase, userId, cacheKey, raw);
    return { ok: true as const, reflection: raw };
  });

/** Stalker card detail extended with sample question (for EP-5). */
export const getStalkerCardSampleQuestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ cardId: z.number().int().min(0).max(77) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const { data: rowsRaw, error } = await supabase
      .from("readings")
      .select("question, card_ids, created_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .gte("created_at", since)
      .not("question", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { questions: [] as string[] };
    const rows = (rowsRaw ?? []) as Array<{ question: string | null; card_ids: number[] | null }>;
    const questions: string[] = [];
    for (const r of rows) {
      if (questions.length >= 10) break;
      if (!r.question) continue;
      if ((r.card_ids ?? []).includes(data.cardId)) {
        const q = r.question.trim();
        if (q) questions.push(q);
      }
    }
    return { questions };
  });

// FP-1 — Twin stalker server function. Counts unordered card pairs that
// cooccur in the same reading (or same day if cooccurrence === 'day').
const StalkerTwinsInputSchema = InsightsFiltersSchema.extend({
  cooccurrence: z.enum(["reading", "day"]).default("reading"),
});

export const getStalkerTwins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StalkerTwinsInputSchema.parse(raw))
  .handler(async ({ data, context }): Promise<StalkerTwinsResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const { cooccurrence, ...rest } = data;
    const filters = InsightsFiltersSchema.parse(rest);
    const rows = await fetchFilteredReadings(supabase, userId, filters, days);
    if (rows.length < STALKER_MIN_WINDOW) return { twins: [] };

    type Bucket = { ids: string[]; cards: Set<number>; date: string };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      const key = cooccurrence === "day" ? r.created_at.slice(0, 10) : r.id;
      const existing = buckets.get(key) ?? { ids: [], cards: new Set<number>(), date: r.created_at };
      existing.ids.push(r.id);
      for (const cid of r.card_ids ?? []) existing.cards.add(cid);
      buckets.set(key, existing);
    }

    const pairCounts = new Map<string, {
      count: number;
      cardA: number;
      cardB: number;
      appearances: Array<{ readingId: string; date: string }>;
    }>();
    for (const bucket of buckets.values()) {
      const cards = [...bucket.cards].sort((a, b) => a - b);
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i], bv = cards[j];
          const key = `${a}-${bv}`;
          const entry = pairCounts.get(key) ?? { count: 0, cardA: a, cardB: bv, appearances: [] };
          entry.count += 1;
          entry.appearances.push({ readingId: bucket.ids[0], date: bucket.date });
          pairCounts.set(key, entry);
        }
      }
    }

    const twins = [...pairCounts.values()]
      .filter((e) => e.count >= STALKER_TWIN_THRESHOLD)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((e) => ({
        cardA: e.cardA,
        cardB: e.cardB,
        cardAName: getCardName(e.cardA),
        cardBName: getCardName(e.cardB),
        count: e.count,
        appearances: e.appearances,
      }));
    return { twins };
  });

// FP-2 — Triplet stalker. Threshold >= 2 cooccurrences.
export const getStalkerTriplets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StalkerTwinsInputSchema.parse(raw))
  .handler(async ({ data, context }): Promise<StalkerTripletsResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const { cooccurrence, ...rest } = data;
    const filters = InsightsFiltersSchema.parse(rest);
    const rows = await fetchFilteredReadings(supabase, userId, filters, days);
    if (rows.length < STALKER_MIN_WINDOW) return { triplets: [] };

    type Bucket = { ids: string[]; cards: Set<number>; date: string };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      const key = cooccurrence === "day" ? r.created_at.slice(0, 10) : r.id;
      const existing = buckets.get(key) ?? { ids: [], cards: new Set<number>(), date: r.created_at };
      existing.ids.push(r.id);
      for (const cid of r.card_ids ?? []) existing.cards.add(cid);
      buckets.set(key, existing);
    }

    const tripleCounts = new Map<string, {
      count: number;
      cards: [number, number, number];
      appearances: Array<{ readingId: string; date: string }>;
    }>();
    for (const bucket of buckets.values()) {
      const cards = [...bucket.cards].sort((a, b) => a - b);
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          for (let k = j + 1; k < cards.length; k++) {
            const a = cards[i], bv = cards[j], c = cards[k];
            const key = `${a}-${bv}-${c}`;
            const entry = tripleCounts.get(key) ?? {
              count: 0,
              cards: [a, bv, c] as [number, number, number],
              appearances: [],
            };
            entry.count += 1;
            entry.appearances.push({ readingId: bucket.ids[0], date: bucket.date });
            tripleCounts.set(key, entry);
          }
        }
      }
    }

    const triplets = [...tripleCounts.values()]
      .filter((e) => e.count >= STALKER_TRIPLET_THRESHOLD)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((e) => ({
        cardIds: e.cards,
        cardNames: e.cards.map(getCardName) as [string, string, string],
        count: e.count,
        appearances: e.appearances,
      }));
    return { triplets };
  });

// FP-3 — Reversed stalkers. Counts how often each card appeared reversed.
export const getReversedStalkers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }): Promise<ReversedStalkersResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    if (rows.length < STALKER_MIN_WINDOW) return { reversedStalkers: [] };

    const counts = new Map<number, {
      reversedCount: number;
      appearances: Array<{ readingId: string; date: string }>;
    }>();
    for (const r of rows) {
      const cards = r.card_ids ?? [];
      const orients = r.card_orientations ?? [];
      if (r.card_orientations === null) continue;
      cards.forEach((cid, idx) => {
        if (!orients[idx]) return;
        const entry = counts.get(cid) ?? { reversedCount: 0, appearances: [] };
        entry.reversedCount += 1;
        entry.appearances.push({ readingId: r.id, date: r.created_at });
        counts.set(cid, entry);
      });
    }

    const reversedStalkers = [...counts.entries()]
      .filter(([, v]) => v.reversedCount >= STALKER_THRESHOLD)
      .sort((a, b) => b[1].reversedCount - a[1].reversedCount)
      .slice(0, 10)
      .map(([cardId, v]) => ({
        cardId,
        cardName: getCardName(cardId),
        reversedCount: v.reversedCount,
        appearances: v.appearances,
      }));
    return { reversedStalkers };
  });

// FQ-3 — Fetch a set of readings by ID for the Stalker occurrence list / modal.
const ReadingsByIdsInputSchema = z.object({
  readingIds: z.array(z.string()).max(100),
});

export const getReadingsByIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReadingsByIdsInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    if (data.readingIds.length === 0) return { readings: [] as any[] };
    const { data: rows, error } = await supabase
      .from("readings")
      .select(
        "id, created_at, spread_type, card_ids, card_orientations, question, deck_id, card_deck_ids, note, is_favorite, tags, guide_id, lens_id, moon_phase, is_deep_reading, deep_reading_lenses",
      )
      .eq("user_id", userId)
      .in("id", data.readingIds)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { readings: rows ?? [] };
  });

// ===== Q52d — Numerology Patterns =====

function reduceCardToNumerology(cid: number): number | null {
  if (cid < 0 || cid >= 78) return null;
  let num: number | null = null;
  if (cid > 0 && cid <= 21) {
    num = cid;
  } else if (cid >= 22 && cid <= 77) {
    const pos = (cid - 22) % 14;
    if (pos >= 0 && pos <= 9) num = pos + 1;
  }
  if (num === null) return null;
  let v = num;
  while (v > 9 && v !== 11 && v !== 22 && v !== 33) {
    v = String(v).split("").reduce((s, c) => s + Number(c), 0);
  }
  return v;
}

/**
 * Q52d — Aggregate the numerology of every card drawn within the
 * filtered reading set. Counts digits 1-9 plus master numbers 11/22/33.
 * Courts and The Fool are excluded.
 */
export const getNumberFrequency = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);

    const counts: Record<number, number> = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0,
      11: 0, 22: 0, 33: 0,
    };
    const contribByNumber: Record<number, Record<number, number>> = {};
    for (const n of Object.keys(counts).map(Number)) {
      contribByNumber[n] = {};
    }
    let totalCards = 0;
    let excludedCards = 0;

    for (const r of rows) {
      for (const cid of r.card_ids ?? []) {
        if (cid < 0 || cid >= 78) continue;
        const v = reduceCardToNumerology(cid);
        if (v === null) {
          excludedCards += 1;
          continue;
        }
        if (counts[v] !== undefined) {
          counts[v] += 1;
          totalCards += 1;
          contribByNumber[v][cid] = (contribByNumber[v][cid] ?? 0) + 1;
        }
      }
    }

    return {
      counts,
      contribByNumber,
      totalCards,
      excludedCards,
      totalReadings: rows.length,
    };
  });

/**
 * Q52d — Find readings where 2+ cards in the same reading share a
 * numerology number. One Hit per (reading, number) bucket.
 */
export const getSynchronicities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);

    type Hit = {
      readingId: string;
      createdAt: string;
      number: number;
      cardIds: number[];
      question: string | null;
    };
    const hits: Hit[] = [];

    for (const r of rows) {
      const ids: number[] = r.card_ids ?? [];
      if (ids.length < 2) continue;
      const byNumber: Record<number, number[]> = {};
      for (const cid of ids) {
        const v = reduceCardToNumerology(cid);
        if (v === null) continue;
        byNumber[v] = byNumber[v] ?? [];
        byNumber[v].push(cid);
      }
      for (const [num, sharedCards] of Object.entries(byNumber)) {
        if (sharedCards.length >= 2) {
          hits.push({
            readingId: r.id,
            createdAt: r.created_at,
            number: Number(num),
            cardIds: sharedCards,
            question: r.question ?? null,
          });
        }
      }
    }

    hits.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    return { hits, totalReadings: rows.length };
  });

/**
 * Q52e — Stalkers grouped by numerology number. Returns, for each
 * digit 1-9 plus master numbers with count >= STALKER_BY_NUMBER_THRESHOLD,
 * the total occurrence count and the top contributing cards.
 */
export const getStalkersByNumber = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);

    const STALKER_BY_NUMBER_THRESHOLD = 3;

    const counts: Record<number, number> = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0,
      11: 0, 22: 0, 33: 0,
    };
    const contribByNumber: Record<number, Record<number, number>> = {};
    for (const n of Object.keys(counts).map(Number)) {
      contribByNumber[n] = {};
    }

    for (const r of rows) {
      for (const cid of r.card_ids ?? []) {
        const v = reduceCardToNumerology(cid);
        if (v === null) continue;
        if (counts[v] === undefined) continue;
        counts[v] += 1;
        contribByNumber[v][cid] = (contribByNumber[v][cid] ?? 0) + 1;
      }
    }

    type Stalker = {
      number: number;
      count: number;
      topCards: { cardId: number; count: number }[];
    };
    const stalkers: Stalker[] = [];
    for (const [k, v] of Object.entries(counts)) {
      if (v < STALKER_BY_NUMBER_THRESHOLD) continue;
      const num = Number(k);
      const contrib = contribByNumber[num];
      const topCards = Object.entries(contrib)
        .map(([cid, c]) => ({ cardId: Number(cid), count: c as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      stalkers.push({ number: num, count: v, topCards });
    }
    stalkers.sort((a, b) => b.count - a.count);

    return { stalkers, totalReadings: rows.length };
  });

/* ============================================================
 * Q52f — Numerology Reading (AI synthesis)
 * ============================================================ */

export const NumerologyReadingInputSchema = InsightsFiltersSchema.extend({
  cacheOnly: z.boolean().optional().default(false),
});

function computeNumerologyForReading(
  birthDate: string,
  birthName: string | null,
) {
  const reduce = (n: number, preserveMaster = true): number => {
    let v = Math.abs(n);
    while (v > 9) {
      if (preserveMaster && (v === 11 || v === 22 || v === 33)) return v;
      v = String(v).split("").reduce((s, c) => s + Number(c), 0);
    }
    return v;
  };
  const digits = birthDate.replace(/-/g, "").split("").map(Number);
  const lpSum = digits.reduce((s, d) => s + d, 0);
  const lifePath = reduce(lpSum);

  const [, monthStr, dayStr] = birthDate.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  const now = new Date();
  const yearDigits = String(now.getFullYear())
    .split("")
    .reduce((s, c) => s + Number(c), 0);
  const personalYear = reduce(month + day + yearDigits, false);

  let sum = lpSum;
  while (sum > 21) sum = String(sum).split("").reduce((s, c) => s + Number(c), 0);
  const birthCardPrimary = sum;

  let expression: number | null = null;
  let soulUrge: number | null = null;
  let personality: number | null = null;
  if (birthName && birthName.trim().length > 0) {
    const VOWELS = new Set(["A", "E", "I", "O", "U"]);
    let all = 0;
    let vSum = 0;
    let cSum = 0;
    for (const ch of birthName.toUpperCase()) {
      if (ch >= "A" && ch <= "Z") {
        const val = ((ch.charCodeAt(0) - 65) % 9) + 1;
        all += val;
        if (VOWELS.has(ch)) vSum += val;
        else cSum += val;
      }
    }
    expression = reduce(all);
    soulUrge = reduce(vSum);
    personality = reduce(cSum);
  }

  return {
    birthDate,
    birthName: birthName ?? null,
    lifePath,
    personalYear,
    birthCardPrimary,
    expression,
    soulUrge,
    personality,
  };
}

function buildNumerologyUserPrompt(
  num: ReturnType<typeof computeNumerologyForReading>,
  readings: Array<{
    id: string;
    card_ids: number[] | null;
    question?: string | null;
    created_at: string;
  }>,
): string {
  const cardCounts: Record<number, number> = {};
  for (const r of readings) {
    for (const cid of r.card_ids ?? []) {
      if (cid < 0 || cid >= 78) continue;
      let n: number | null = null;
      if (cid > 0 && cid <= 21) n = cid;
      else if (cid >= 22 && cid <= 77) {
        const pos = (cid - 22) % 14;
        if (pos >= 0 && pos <= 9) n = pos + 1;
      }
      if (n === null) continue;
      let v = n;
      while (v > 9 && v !== 11 && v !== 22 && v !== 33) {
        v = String(v).split("").reduce((s, c) => s + Number(c), 0);
      }
      cardCounts[v] = (cardCounts[v] ?? 0) + 1;
    }
  }
  const topNumbers = Object.entries(cardCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([n, c]) => `${n} (${c}×)`);

  const lines: string[] = [
    `Birth date: ${num.birthDate}`,
    `Life Path: ${num.lifePath}`,
    `Personal Year: ${num.personalYear}`,
    `Primary Birth Card index (0-21 Major Arcana): ${num.birthCardPrimary}`,
  ];
  if (num.expression !== null) lines.push(`Expression: ${num.expression}`);
  if (num.soulUrge !== null) lines.push(`Soul Urge: ${num.soulUrge}`);
  if (num.personality !== null) lines.push(`Personality: ${num.personality}`);
  if (topNumbers.length > 0) {
    lines.push(
      `Top recurring card-numerology in recent readings: ${topNumbers.join(", ")}`,
    );
  } else {
    lines.push("Recent readings: none in window.");
  }
  lines.push(`Reading count in window: ${readings.length}`);
  return lines.join("\n");
}

export const getNumerologyReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => NumerologyReadingInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("birth_date, birth_name")
      .eq("user_id", userId)
      .maybeSingle();
    const birthDate = (prefs as any)?.birth_date as string | null;
    const birthName = (prefs as any)?.birth_name as string | null;

    if (!birthDate) {
      return {
        ok: false as const,
        reason: "no_birth_date" as const,
        reading: null,
        generatedAt: null,
      };
    }

    const cacheKey = `numerology:${birthDate}:${birthName ?? ""}:${data.timeRange}`;

    if (data.cacheOnly) {
      const cached = await readCachedReflection(supabase, userId, cacheKey);
      if (cached) {
        return {
          ok: true as const,
          reading: cached.reflection,
          generatedAt: cached.generatedAt,
        };
      }
      return {
        ok: false as const,
        reason: "no_cache" as const,
        reading: null,
        generatedAt: null,
      };
    }

    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);
    const recentReadings = rows.slice(0, 25);

    const numerology = computeNumerologyForReading(birthDate, birthName);

    const systemPrompt = [
      "You are the Tarot Seed oracle, a voice that weaves numerology and tarot together.",
      "Write a personal numerology reading in flowing serif prose – evocative, brief, never bullet points.",
      'Address the seeker as "you". 250–350 words. 3–4 short paragraphs.',
      "Open with the seeker's Personal Year theme; weave in Life Path; touch their Birth Card archetype; close with the cards that have been recurring in their recent readings.",
      "Be specific to their actual numbers and recent cards. No generic horoscope filler. No advice imperatives.",
    ].join("\n");

    const userPrompt = buildNumerologyUserPrompt(numerology, recentReadings);

    const reading = await callAnthropicShort(systemPrompt, userPrompt, 800, userId);
    if (!reading) {
      return {
        ok: false as const,
        reason: "ai_failed" as const,
        reading: null,
        generatedAt: null,
      };
    }

    await writeCachedReflection(supabase, userId, cacheKey, reading);

    return {
      ok: true as const,
      reading,
      generatedAt: new Date().toISOString(),
    };
  });

// ============================================================================
// Q58 — getSuitTrends
// ============================================================================
export const getSuitTrends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InsightsFiltersSchema.parse(raw))
  .handler(async ({ data, context }): Promise<{ buckets: SuitBucket[]; granularity: SuitGranularity }> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const isPremium = await getIsPremium(supabase, userId);
    const { days } = effectiveWindow(data.timeRange, isPremium);
    const rows = await fetchFilteredReadings(supabase, userId, data, days);

    const effectiveDays = days ?? 9999;
    const granularity: SuitGranularity =
      effectiveDays <= 31 ? "daily" : effectiveDays <= 180 ? "weekly" : "monthly";

    const isoDay = (d: Date) => d.toISOString().slice(0, 10);
    const isoMonth = (d: Date) => d.toISOString().slice(0, 7);
    const isoWeek = (d: Date) => {
      const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    };

    const dayLabel = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const monthLabel = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", year: effectiveDays > 365 ? "numeric" : undefined });
    const weekLabel = (d: Date) => {
      const start = new Date(d);
      const wk = start.getDay() || 7;
      start.setDate(start.getDate() + 1 - wk);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const fmt = (x: Date) =>
        x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `${fmt(start)}–${fmt(end)}`;
    };

    const keyOf = (d: Date) =>
      granularity === "daily" ? isoDay(d) : granularity === "weekly" ? isoWeek(d) : isoMonth(d);
    const labelOf = (d: Date) =>
      granularity === "daily" ? dayLabel(d) : granularity === "weekly" ? weekLabel(d) : monthLabel(d);

    type BucketAcc = SuitBucket & { _firstDate: Date };
    const buckets: Record<string, BucketAcc> = {};

    for (const r of rows) {
      const created = new Date(r.created_at);
      const k = keyOf(created);
      if (!buckets[k]) {
        buckets[k] = {
          key: k,
          label: labelOf(created),
          major: 0,
          wands: 0,
          cups: 0,
          swords: 0,
          pentacles: 0,
          _firstDate: created,
        };
      }
      for (const cid of r.card_ids ?? []) {
        if (cid < 0 || cid >= 78) continue;
        if (cid <= 21) buckets[k].major += 1;
        else if (cid <= 35) buckets[k].wands += 1;
        else if (cid <= 49) buckets[k].cups += 1;
        else if (cid <= 63) buckets[k].swords += 1;
        else buckets[k].pentacles += 1;
      }
    }

    const result: SuitBucket[] = Object.values(buckets)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ _firstDate: _omit, ...rest }) => rest);

    return { buckets: result, granularity };
  });
