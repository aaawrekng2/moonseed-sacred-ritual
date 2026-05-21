/**
 * Phase 19 — shared "An Echo" detection.
 *
 * Returns the same shape QuickLog used to compute inline. An echo
 * fires when 3+ cards in the current pull have appeared together
 * in a past reading (or on the same day, per mode).
 */
import { useMemo } from "react";
import type { QuickLogOverlap } from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

export type EchoState = {
  active: boolean;
  participatingCardIds: number[];
  matchingReadings: Array<{
    id: string;
    createdAt: string;
    question: string | null;
    cardIds: number[];
    matched: number[];
  }>;
  matchCount: number;
  matchCountSixMonths: number;
};

export function useEcho(
  picks: ManualPick[],
  overlap: QuickLogOverlap | null,
  mode: "pull" | "day",
): EchoState {
  return useMemo(() => {
    const pullIds = picks.map((p) => p.cardIndex);
    const empty: EchoState = {
      active: false,
      participatingCardIds: [],
      matchingReadings: [],
      matchCount: 0,
      matchCountSixMonths: 0,
    };
    if (pullIds.length < 3 || !overlap) return empty;
    const matches: EchoState["matchingReadings"] = [];
    const entries = Object.entries(overlap.readingsByDate ?? {});
    if (mode === "pull") {
      for (const [, readings] of entries) {
        for (const reading of readings) {
          const matched = pullIds.filter((id) => reading.cardIds.includes(id));
          if (matched.length >= 3) matches.push({ ...reading, matched });
        }
      }
    } else {
      for (const [, readings] of entries) {
        if (readings.length === 0) continue;
        const dayCards = new Set<number>();
        for (const r of readings) r.cardIds.forEach((id) => dayCards.add(id));
        const matched = pullIds.filter((id) => dayCards.has(id));
        if (matched.length >= 3) {
          matches.push({ ...readings[0], matched });
        }
      }
    }
    if (matches.length === 0) return empty;
    const all = new Set<number>();
    matches.forEach((m) => m.matched.forEach((id) => all.add(id)));
    matches.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const seenIds = new Set<string>();
    const uniq = matches.filter((m) => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });
    return {
      active: true,
      participatingCardIds: [...all],
      matchingReadings: uniq.slice(0, 5),
      matchCount: uniq.length,
      matchCountSixMonths: uniq.length,
    };
  }, [picks, overlap, mode]);
}