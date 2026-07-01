/**
 * useCardGauges (v2.51)
 *
 * Shared, session-cached feed of per-card gauge comparisons for the
 * constellation web. Every ConstellationWeb instance on the page reads from
 * ONE getCardGauges call — the first mount fetches, everyone else reuses the
 * cached map. The map only contains cards drawn MORE than chance (over-index
 * above 1); calm cards are absent, so the web draws no dial on them.
 *
 * The gauge reflects the seeker's WHOLE history (like the Overview meters),
 * not the constellation's filtered universe — so the ember always means the
 * same thing wherever the web appears.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCardGauges } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useTimezone } from "@/lib/use-timezone";
import type { CardComparison } from "@/lib/pattern-engine";

export type GaugeMap = Record<number, CardComparison>;

// Module-level session cache shared across every web instance.
let cache: GaugeMap | null = null;
let inflight: Promise<GaugeMap> | null = null;

export function useCardGauges(): GaugeMap {
  const fn = useServerFn(getCardGauges);
  const { effectiveTz } = useTimezone();
  const [gauges, setGauges] = useState<GaugeMap>(cache ?? {});

  useEffect(() => {
    let cancelled = false;

    if (cache) {
      setGauges(cache);
      return;
    }

    if (!inflight) {
      inflight = (async () => {
        try {
          const headers = await getAuthHeaders();
          const res = await fn({ data: { tz: effectiveTz }, headers });
          const map: GaugeMap = res.status === "ok" ? res.gauges : {};
          cache = map;
          return map;
        } catch {
          const empty: GaugeMap = {};
          cache = empty;
          return empty;
        }
      })();
    }

    void inflight.then((map) => {
      if (!cancelled) setGauges(map);
    });

    return () => {
      cancelled = true;
    };
  }, [fn, effectiveTz]);

  return gauges;
}
