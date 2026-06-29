/**
 * v2.26 — Stalkers calendar renders the SAME manual-entry table the Overview
 * tab uses: the grid12 OverlapStrip, fed each selected stalker's overlap via
 * getQuickLogOverlap. Replaces the old shrunk day-picker.
 *
 * Singles / Reversed pass one card (gold-fill marks that card's draw days).
 * Twins / Triplets pass the group via pullCardIds; the hero (first card)
 * drives the gold fill.
 *
 * v2.27 — heroCardId may be null. With no hero + markReadingDays, the table
 * lights up every day that has any reading (used by the Insights Calendar tab).
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { OverlapStrip } from "@/components/tabletop/QuickLog";
import {
  getQuickLogOverlap,
  type QuickLogOverlap,
} from "@/lib/quicklog.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { EMPTY_GLOBAL_FILTERS } from "@/lib/filters.types";
import { useTimezone } from "@/lib/use-timezone";
import { LoadingText } from "@/components/ui/loading-text";

export function StalkerCalendar({
  heroCardId,
  pullCardIds,
  markReadingDays = false,
}: {
  heroCardId: number | null;
  pullCardIds?: number[];
  markReadingDays?: boolean;
}) {
  const { effectiveTz } = useTimezone();
  const fetchOverlap = useServerFn(getQuickLogOverlap);
  const [overlap, setOverlap] = useState<QuickLogOverlap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const ov = (await fetchOverlap({
          data: {
            heroCardId,
            tz: effectiveTz,
            filters: EMPTY_GLOBAL_FILTERS,
          },
          headers,
        })) as QuickLogOverlap;
        if (!cancelled) {
          setOverlap(ov);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setOverlap(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [heroCardId, effectiveTz, fetchOverlap]);

  if (loading && !overlap) {
    return <LoadingText>Loading calendar…</LoadingText>;
  }

  return (
    <OverlapStrip
      overlap={overlap}
      heroCardId={heroCardId}
      pullCardIds={pullCardIds ?? (heroCardId != null ? [heroCardId] : [])}
      markReadingDays={markReadingDays}
      mode="day"
      onModeChange={() => {}}
      layout="grid12"
      monthsToShow={12}
      showModeToggle={false}
      showOlder
      onShowOlderChange={() => {}}
      onDayClick={() => {}}
    />
  );
}
