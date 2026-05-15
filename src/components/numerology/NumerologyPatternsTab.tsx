/**
 * Q52d — Numerology Patterns tab. Reading-data driven; reuses the
 * Insights filter bar (GlobalFilterBar) and the InsightsFilters shape.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  getNumberFrequency,
  getSynchronicities,
} from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import { formatTimeAgo } from "@/lib/dates";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { useElementWidth } from "@/lib/use-element-width";

type FreqData = {
  counts: Record<number, number>;
  contribByNumber: Record<number, Record<number, number>>;
  totalCards: number;
  excludedCards: number;
  totalReadings: number;
};

type SyncHit = {
  readingId: string;
  createdAt: string;
  number: number;
  cardIds: number[];
  question: string | null;
};

type SyncData = { hits: SyncHit[]; totalReadings: number };

const sectionHeaderStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: "var(--text-heading-md)",
  margin: 0,
};

const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  opacity: 0.7,
  margin: 0,
};

export function NumerologyPatternsTab({
  filters,
}: {
  filters: InsightsFilters;
  onFiltersChange?: (f: InsightsFilters) => void;
}) {
  const freqFn = useServerFn(getNumberFrequency);
  const syncFn = useServerFn(getSynchronicities);
  const [freqData, setFreqData] = useState<FreqData | null>(null);
  const [syncData, setSyncData] = useState<SyncData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);
  const contribRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selectedNumber !== null) {
      requestAnimationFrame(() => {
        contribRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [selectedNumber]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const [f, s] = await Promise.all([
          freqFn({ data: filters, headers }),
          syncFn({ data: filters, headers }),
        ]);
        if (!cancelled) {
          setFreqData(f as FreqData);
          setSyncData(s as SyncData);
          setLoading(false);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[numerology.patterns] fetch failed", e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, freqFn, syncFn]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {loading && !freqData ? (
        <LoadingSkeleton heights={[260, 200]} />
      ) : !freqData || freqData.totalCards === 0 ? (
        <EmptyHero />
      ) : (
        <>
          <NumberFrequencySection
            data={freqData}
            selectedNumber={selectedNumber}
            onSelect={(n) =>
              setSelectedNumber(selectedNumber === n ? null : n)
            }
          />

          {selectedNumber !== null && (
            <CardsBehindSection
              sectionRef={contribRef}
              number={selectedNumber}
              contributions={freqData.contribByNumber[selectedNumber] ?? {}}
            />
          )}
        </>
      )}

      <SynchronicitiesSection
        data={syncData}
        loading={loading}
        onOpenReading={(id) => setOpenReadingId(id)}
      />

      {openReadingId && (
        <ReadingDetailModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
    </div>
  );
}

function EmptyHero() {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignItems: "center",
        textAlign: "center",
        padding: "32px 16px",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          opacity: 0.85,
          margin: 0,
          maxWidth: 360,
        }}
      >
        Begin drawing to see your numerology weave through the cards.
      </p>
      <Link
        to="/"
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          background: "color-mix(in oklab, var(--gold) 14%, transparent)",
          border:
            "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
          color: "var(--gold)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm, 13px)",
          textDecoration: "none",
        }}
      >
        Begin a reading
      </Link>
    </section>
  );
}

function NumberFrequencySection({
  data,
  selectedNumber,
  onSelect,
}: {
  data: FreqData;
  selectedNumber: number | null;
  onSelect: (n: number) => void;
}) {
  const allEntries = Object.entries(data.counts).map(([k, v]) => ({
    num: Number(k),
    count: v,
  }));
  const single = allEntries
    .filter((e) => e.num <= 9)
    .sort((a, b) => a.num - b.num);
  const masters = allEntries.filter((e) => e.num > 9 && e.count > 0);
  const max = Math.max(1, ...single.map((e) => e.count));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={sectionHeaderStyle}>Number Frequency</h3>
      <p style={subtitleStyle}>
        How often each number has appeared in your readings. Courts and The
        Fool are excluded.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {single.map((e) => {
          const active = selectedNumber === e.num;
          const widthPct = (e.count / max) * 100;
          return (
            <button
              key={e.num}
              type="button"
              onClick={() => onSelect(e.num)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                background: active
                  ? "color-mix(in oklab, var(--gold) 12%, transparent)"
                  : "var(--surface-card)",
                border: active
                  ? "1px solid color-mix(in oklab, var(--gold) 40%, transparent)"
                  : "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 10px)",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 24,
                  color: "var(--gold)",
                  minWidth: 32,
                }}
              >
                {e.num}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background:
                    "color-mix(in oklab, var(--color-foreground) 8%, transparent)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: "100%",
                    background:
                      "color-mix(in oklab, var(--gold) 70%, transparent)",
                    borderRadius: 999,
                    transition: "width 220ms ease-out",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  minWidth: 32,
                  textAlign: "right",
                  opacity: 0.85,
                }}
              >
                {e.count}
              </span>
            </button>
          );
        })}
      </div>

      {masters.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            paddingTop: 4,
          }}
        >
          {masters.map((e) => {
            const active = selectedNumber === e.num;
            return (
              <button
                key={e.num}
                type="button"
                onClick={() => onSelect(e.num)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: active
                    ? "color-mix(in oklab, var(--gold) 18%, transparent)"
                    : "color-mix(in oklab, var(--gold) 6%, transparent)",
                  border:
                    "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
                  cursor: "pointer",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-caption)",
                  color: "var(--gold)",
                }}
              >
                <span style={{ fontWeight: 600 }}>{e.num}</span>
                <span style={{ opacity: 0.8 }}>· {e.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CardsBehindSection({
  sectionRef,
  number,
  contributions,
}: {
  sectionRef?: React.Ref<HTMLElement>;
  number: number;
  contributions: Record<number, number>;
}) {
  const entries = Object.entries(contributions)
    .map(([cidStr, count]) => ({ cid: Number(cidStr), count: Number(count) }))
    .sort((a, b) => b.count - a.count);

  return (
    <section
      ref={sectionRef}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <h3 style={sectionHeaderStyle}>Cards Behind the {number}</h3>
      {entries.length === 0 ? (
        <p style={subtitleStyle}>No cards yet for this number.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
            gap: 12,
          }}
        >
          {entries.map(({ cid, count }) => (
            <ContributionCardCell key={cid} cardId={cid} count={count} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContributionCardCell({ cardId, count }: { cardId: number; count: number }) {
  const { ref: imgRef, width: imgW } = useElementWidth<HTMLDivElement>();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
    >
      <div ref={imgRef} style={{ width: "100%" }}>
        {imgW > 0 && (
          <CardImage cardId={cardId} size="custom" widthPx={Math.round(imgW)} />
        )}
      </div>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          textAlign: "center",
          opacity: 0.85,
        }}
      >
        {getCardName(cardId)}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          color: "var(--gold)",
        }}
      >
        {count}×
      </span>
    </div>
  );
}

function SynchronicitiesSection({
  data,
  loading,
  onOpenReading,
}: {
  data: SyncData | null;
  loading: boolean;
  onOpenReading: (id: string) => void;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={sectionHeaderStyle}>Synchronicities</h3>
      <p style={subtitleStyle}>
        Readings where two or more cards shared a numerology number.
      </p>

      {loading && !data ? (
        <LoadingSkeleton heights={[80, 80]} />
      ) : !data || data.hits.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.6,
            margin: 0,
          }}
        >
          No synchronicities in this window.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.hits.slice(0, 50).map((hit, i) => (
            <button
              key={`${hit.readingId}-${hit.number}-${i}`}
              type="button"
              onClick={() => onOpenReading(hit.readingId)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px",
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 10px)",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 28,
                  color: "var(--gold)",
                  minWidth: 40,
                  lineHeight: 1,
                }}
              >
                {hit.number}
              </span>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body)",
                  }}
                >
                  {hit.cardIds.map((cid) => getCardName(cid)).join(" + ")}
                </span>
                {hit.question && (
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption)",
                      opacity: 0.6,
                    }}
                  >
                    {hit.question}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-caption)",
                    opacity: 0.5,
                  }}
                >
                  {formatTimeAgo(hit.createdAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}