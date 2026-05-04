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
  supabase: ReturnType<typeof requireSupabaseAuth> extends never ? never : any,
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