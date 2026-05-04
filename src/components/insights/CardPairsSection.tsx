import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCardPairs } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import { Lock } from "lucide-react";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, EmptyNote, SkeletonRow } from "./StalkerCardsSection";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";

type Pair = {
  cardA: number;
  cardB: number;
  cardAName: string;
  cardBName: string;
  count: number;
  totalReadings: number;
};

export function CardPairsSection({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getCardPairs);
  const [data, setData] = useState<{ pairs: Pair[]; totalMultiCardReadings: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [filters, fn]);

  // EO-2 — wire to canonical premium hook.
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);

  return (
    <section className="space-y-3">
      <SectionHeader title="Card Pairs" caption="Cards that show up together more than chance." />
      {loading && <SkeletonRow />}
      {!loading && data && data.pairs.length === 0 && (
        <EmptyNote text="No recurring pairs yet. Multi-card spreads will surface patterns here." />
      )}
      {!loading && data && data.pairs.length > 0 && (
        <div className="relative">
          <div className={isPremium ? "" : "pointer-events-none select-none"} style={{ filter: isPremium ? undefined : "blur(8px)" }}>
            {data.pairs.map((p) => (
              <PairRow key={`${p.cardA}-${p.cardB}`} pair={p} />
            ))}
          </div>
          {!isPremium && (
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("moonseed:open-premium", { detail: { feature: "Card Pairs" } }),
                )
              }
              className="absolute inset-0 flex flex-col items-center justify-center gap-2"
              style={{
                background: "color-mix(in oklch, var(--cosmos, #0a0a14) 40%, transparent)",
                borderRadius: 14,
              }}
            >
              <Lock className="h-5 w-5" style={{ color: "var(--gold)" }} />
              <span style={{ fontStyle: "italic", color: "var(--gold)" }}>
                Premium feature — Tap to unlock
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PairRow({ pair }: { pair: Pair }) {
  return (
    <div
      className="mb-2 flex items-center gap-3 p-3"
      style={{ background: "var(--surface-card)", borderRadius: 14 }}
    >
      <div className="flex gap-1">
        {/* EY-7 — unified card render. */}
        <CardImage cardId={pair.cardA} variant="face" size="custom" widthPx={38} ariaLabel={pair.cardAName} />
        <CardImage cardId={pair.cardB} variant="face" size="custom" widthPx={38} ariaLabel={pair.cardBName} />
      </div>
      <div
        style={{
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
        }}
      >
        <strong style={{ fontWeight: 500 }}>
          {pair.cardAName} + {pair.cardBName}
        </strong>{" "}
        appear together in {pair.count} of your {pair.totalReadings} multi-card readings.
      </div>
    </div>
  );
}