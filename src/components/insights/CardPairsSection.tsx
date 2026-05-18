import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCardPairs, getReadingsWithCardPair } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, SkeletonRow } from "./StalkerCardsSection";
import { EmptyNote } from "@/components/ui/empty-note";
import { ReadingRow } from "@/components/ui/reading-row";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { LoadingText } from "@/components/ui/loading-text";
import { X } from "lucide-react";

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
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null);

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

  return (
    <section className="space-y-3">
      <SectionHeader title="Card Pairs" caption="Cards that show up together more than chance." />
      {loading && <SkeletonRow />}
      {!loading && data && data.pairs.length === 0 && (
        <EmptyNote text="No recurring pairs yet. Multi-card spreads will surface patterns here." />
      )}
      {!loading && data && data.pairs.length > 0 && (
        <div>
          {data.pairs.map((p) => (
            <PairRow
              key={`${p.cardA}-${p.cardB}`}
              pair={p}
              onTap={() => setSelectedPair(p)}
            />
          ))}
        </div>
      )}
      {selectedPair && (
        <PairDetailModal
          pair={selectedPair}
          filters={filters}
          onClose={() => setSelectedPair(null)}
        />
      )}
    </section>
  );
}

function PairRow({ pair, onTap }: { pair: Pair; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="mb-2 flex w-full items-center gap-3 p-3 text-left"
      style={{ background: "var(--surface-card)", borderRadius: 14, border: "none", cursor: "pointer" }}
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
    </button>
  );
}

function PairDetailModal({
  pair,
  filters,
  onClose,
}: {
  pair: Pair;
  filters: InsightsFilters;
  onClose: () => void;
}) {
  const fetchReadings = useServerFn(getReadingsWithCardPair);
  const [readings, setReadings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetchReadings({
          data: { cardIdA: pair.cardA, cardIdB: pair.cardB, filters },
          headers,
        });
        if (!cancelled) setReadings(res.readings ?? []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pair.cardA, pair.cardB, filters, fetchReadings]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 16,
          maxWidth: 560,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 20,
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "transparent",
            border: "none",
            color: "var(--foreground)",
            opacity: 0.7,
            cursor: "pointer",
          }}
        >
          <X size={18} />
        </button>
        <div className="flex justify-center gap-3 mt-2 mb-4">
          <div style={{ maxWidth: 140, flex: 1 }}>
            <CardImage cardId={pair.cardA} variant="face" size="hero" ariaLabel={pair.cardAName} style={{ width: "100%", minHeight: 0 }} />
          </div>
          <div style={{ maxWidth: 140, flex: 1 }}>
            <CardImage cardId={pair.cardB} variant="face" size="hero" ariaLabel={pair.cardBName} style={{ width: "100%", minHeight: 0 }} />
          </div>
        </div>
        <h3
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-lg)",
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          {pair.cardAName} + {pair.cardBName}
        </h3>
        {loading ? (
          <LoadingText>Loading readings…</LoadingText>
        ) : readings.length === 0 ? (
          <EmptyNote text="No readings found for this pair in the current filter window." />
        ) : (
          <ul className="flex flex-col">
            {readings.map((r) => (
              <li key={r.id}>
                <ReadingRow
                  readingId={r.id}
                  question={r.question ?? null}
                  cardIds={r.card_ids ?? []}
                  createdAt={r.created_at}
                  spreadType={r.spread_type ?? null}
                  onOpen={setOpenReadingId}
                />
              </li>
            ))}
          </ul>
        )}
        {openReadingId && (
          <ReadingDetailModal
            readingId={openReadingId}
            onClose={() => setOpenReadingId(null)}
          />
        )}
      </div>
    </div>
  );
}