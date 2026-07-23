/**
 * useCardGauges (v3.105)
 *
 * Shared, session-cached feed of per-card gauge comparisons for the
 * constellation web. The gauge now judges off the SELECTED timeframe (passed
 * as `timeRange`), so it agrees with the "Vs chance" chip. The cache is keyed
 * by timeframe, so switching windows refetches once and everyone reuses it.
 *
 * The map only contains cards drawn MORE than chance (over-index above 1) and
 * pulled at least twice in the window; calm cards are absent, so the web draws
 * no dial on them.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCardGauges } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useTimezone } from "@/lib/use-timezone";
import type { CardComparison } from "@/lib/pattern-engine";

export type GaugeMap = Record<number, CardComparison>;

// Module-level session caches, keyed by timeframe, shared across every web.
const cache: Map<string, GaugeMap> = new Map();
const inflight: Map<string, Promise<GaugeMap>> = new Map();

export function useCardGauges(timeRange?: string): GaugeMap {
  const fn = useServerFn(getCardGauges);
  const { effectiveTz } = useTimezone();
  const key = timeRange ?? "all";
  const [gauges, setGauges] = useState<GaugeMap>(cache.get(key) ?? {});

  useEffect(() => {
    let cancelled = false;

    const cached = cache.get(key);
    if (cached) {
      setGauges(cached);
      return;
    }

    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        try {
          const headers = await getAuthHeaders();
          const res = await fn({
            data: { tz: effectiveTz, timeRange },
            headers,
          });
          const map: GaugeMap = res.status === "ok" ? res.gauges : {};
          cache.set(key, map);
          return map;
        } catch {
          const empty: GaugeMap = {};
          cache.set(key, empty);
          return empty;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
    }

    void p.then((map) => {
      if (!cancelled) setGauges(map);
    });

    return () => {
      cancelled = true;
    };
  }, [fn, effectiveTz, key, timeRange]);

  return gauges;
}
