import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { getCardPairs, getReadingsWithCardPair } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import { CardHoverTip } from "@/components/card/CardRichPopover";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, SkeletonRow } from "./StalkerCardsSection";
import { EmptyNote } from "@/components/ui/empty-note";
import { ReadingRow } from "@/components/ui/reading-row";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { LoadingText } from "@/components/ui/loading-text";
import { Scaling, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";

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
  // Q99 #2 — card size slider for pairs, persisted to user_preferences.
  const { user } = useAuth();
  const [pairScale, setPairScale] = useState<number>(100);
  const [sliderOpen, setSliderOpen] = useState(false);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!sliderOpen) return;
    function onDown(e: PointerEvent) {
      if (!sliderRef.current) return;
      if (!sliderRef.current.contains(e.target as Node)) setSliderOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [sliderOpen]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("card_scale_pairs")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as { card_scale_pairs?: number };
      if (typeof row.card_scale_pairs === "number") setPairScale(row.card_scale_pairs);
      loadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !loadedRef.current) return;
    const t = setTimeout(() => {
      void updateUserPreferences(user.id, { card_scale_pairs: pairScale } as never);
    }, 500);
    return () => clearTimeout(t);
  }, [user, pairScale]);

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
      <div className="flex items-end justify-between gap-3">
        <SectionHeader title="Card Pairs" caption="Cards that show up together more than chance." />
        <button
          type="button"
          onClick={() => setSliderOpen((v) => !v)}
          aria-label="Adjust card size"
          style={{
            background: "none",
            border: "none",
            padding: 4,
            cursor: "pointer",
            color: sliderOpen ? "var(--accent, var(--gold))" : "var(--color-foreground)",
            opacity: sliderOpen ? 1 : 0.6,
            transition: "opacity 200ms ease-out",
          }}
        >
          <Scaling size={15} strokeWidth={1.5} />
        </button>
      </div>
      {sliderOpen && (
        <div
          ref={sliderRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--surface-card)",
            border: "1px solid color-mix(in oklch, var(--gold) 18%, transparent)",
            marginLeft: "auto",
            marginRight: 16,
            maxWidth: "calc(100% - 16px)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.7,
              whiteSpace: "nowrap",
            }}
          >
            Card size · {pairScale}%
          </span>
          <input
            type="range"
            min={50}
            max={250}
            step={5}
            value={pairScale}
            onChange={(e) => setPairScale(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent, var(--gold))" }}
          />
        </div>
      )}
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
              scale={pairScale}
              onTap={() => setSelectedPair(p)}
            />
          ))}
        </div>
      )}
      {selectedPair && (
        <PairDetailModal
          pair={selectedPair}
          filters={filters}
          scale={pairScale}
          onClose={() => setSelectedPair(null)}
        />
      )}
    </section>
  );
}

function PairRow({ pair, scale, onTap }: { pair: Pair; scale: number; onTap: () => void }) {
  const w = Math.round(38 * scale / 100);
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={onTap}
      className="mb-2 flex w-full items-center gap-3 p-3 text-left"
      style={{ background: "var(--surface-card)", borderRadius: 14, border: "none", cursor: "pointer" }}
    >
      <div className="flex gap-1">
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            void navigate({ to: "/insights/card/$cardId", params: { cardId: String(pair.cardA) } });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              void navigate({ to: "/insights/card/$cardId", params: { cardId: String(pair.cardA) } });
            }
          }}
          style={{ cursor: "pointer", display: "inline-block" }}
          aria-label={`View Card Trace for ${pair.cardAName}`}
        >
          <CardHoverTip cardId={pair.cardA}><CardImage cardId={pair.cardA} variant="face" size="custom" widthPx={w} ariaLabel={pair.cardAName} /></CardHoverTip>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            void navigate({ to: "/insights/card/$cardId", params: { cardId: String(pair.cardB) } });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              void navigate({ to: "/insights/card/$cardId", params: { cardId: String(pair.cardB) } });
            }
          }}
          style={{ cursor: "pointer", display: "inline-block" }}
          aria-label={`View Card Trace for ${pair.cardBName}`}
        >
          <CardHoverTip cardId={pair.cardB}><CardImage cardId={pair.cardB} variant="face" size="custom" widthPx={w} ariaLabel={pair.cardBName} /></CardHoverTip>
        </span>
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
  scale,
  onClose,
}: {
  pair: Pair;
  filters: InsightsFilters;
  scale: number;
  onClose: () => void;
}) {
  const heroW = Math.round(160 * scale / 100);
  const navigate = useNavigate();
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
          <button
            type="button"
            onClick={() => {
              onClose();
              void navigate({ to: "/insights/card/$cardId", params: { cardId: String(pair.cardA) } });
            }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            aria-label={`View Card Trace for ${pair.cardAName}`}
          >
            <CardHoverTip cardId={pair.cardA}><CardImage cardId={pair.cardA} variant="face" size="custom" widthPx={heroW} ariaLabel={pair.cardAName} /></CardHoverTip>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              void navigate({ to: "/insights/card/$cardId", params: { cardId: String(pair.cardB) } });
            }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            aria-label={`View Card Trace for ${pair.cardBName}`}
          >
            <CardImage cardId={pair.cardB} variant="face" size="custom" widthPx={heroW} ariaLabel={pair.cardBName} />
          </button>
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