import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getReversalPatterns } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, SkeletonRow } from "./StalkerCardsSection";
import { EmptyNote } from "@/components/ui/empty-note";
import { useTrackReversals } from "@/lib/use-track-reversals";

type Pattern = {
  cardId: number;
  cardName: string;
  totalCount: number;
  reversedCount: number;
  reversedRate: number;
};

export function ReversalPatternsSection({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getReversalPatterns);
  const navigate = useNavigate();
  const [data, setData] = useState<{ patterns: Pattern[]; overallReversalRate: number } | null>(null);
  const [loading, setLoading] = useState(true);
  // ER-8 — hide section entirely when reversal tracking is off.
  const { trackReversals, loaded: prefLoaded } = useTrackReversals();

  useEffect(() => {
    if (prefLoaded && !trackReversals) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: filters, headers });
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, fn, prefLoaded, trackReversals]);

  if (prefLoaded && !trackReversals) return null;

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Reversal Patterns"
        caption="Cards that arrive reversed most often — your shadow stalkers."
      />
      {loading && <SkeletonRow />}
      {!loading && data && data.overallReversalRate < 0.05 && data.patterns.length === 0 && (
        <EmptyNote text="You don't appear to read reversals. Toggle reversal tracking in Settings to hide this section." />
      )}
      {!loading && data && data.overallReversalRate >= 0.05 && data.patterns.length === 0 && (
        <EmptyNote text="No reversal patterns surface yet. Cards need to appear several times before a pattern emerges." />
      )}
      {!loading &&
        data?.patterns.map((p) => (
          <ReversalRow key={p.cardId} pattern={p} onTap={() =>
            navigate({ to: "/insights/card/$cardId", params: { cardId: String(p.cardId) } })
          } />
        ))}
    </section>
  );
}

function ReversalRow({ pattern, onTap }: { pattern: Pattern; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-3 p-3 text-left"
      style={{ background: "var(--surface-card)", borderRadius: 14 }}
    >
      {/* EY-7 — unified card render with reversed orientation. */}
      <CardImage
        cardId={pattern.cardId}
        variant="face"
        reversed
        size="custom"
        widthPx={44}
        ariaLabel={pattern.cardName}
      />
      <div className="flex-1">
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "var(--text-body)" }}>
          {pattern.cardName}
        </div>
        <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", opacity: 0.7 }}>
          {pattern.reversedCount} reversed of {pattern.totalCount} total appearances —{" "}
          {Math.round(pattern.reversedRate * 100)}%
        </div>
      </div>
    </button>
  );
}