/**
 * Q52e — Numerology Stalkers tab. Cards grouped by numerology number,
 * ranked by how often they've appeared in the filtered window.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getStalkersByNumber } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import { NUMBER_MEANINGS } from "@/lib/numerology-copy";
import { lifePath } from "@/lib/numerology";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { useElementWidth } from "@/lib/use-element-width";

type Stalker = {
  number: number;
  count: number;
  topCards: { cardId: number; count: number }[];
};

type Result = { stalkers: Stalker[]; totalReadings: number };

export function NumerologyStalkersTab({
  filters,
  birthDate,
}: {
  filters: InsightsFilters;
  birthDate?: string | null;
}) {
  const fn = useServerFn(getStalkersByNumber);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);

  const lp = birthDate ? lifePath(birthDate).digit : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = (await fn({ data: filters, headers })) as Result;
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[numerology.stalkers] fetch failed", e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, fn]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          opacity: 0.75,
          margin: 0,
        }}
      >
        The numbers that keep showing up in your readings. Each card is
        grouped by its numerology, then ranked by how often it appeared.
      </p>

      {loading && !data ? (
        <LoadingSkeleton heights={[140, 140, 140]} />
      ) : !data || data.stalkers.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.6,
            margin: 0,
          }}
        >
          No number stalkers in this window. Draw more cards or widen the
          filter.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.stalkers.map((stalker) => (
            <StalkerEntry
              key={stalker.number}
              stalker={stalker}
              isLifePath={lp === stalker.number}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StalkerEntry({
  stalker,
  isLifePath,
}: {
  stalker: Stalker;
  isLifePath: boolean;
}) {
  const meaning = NUMBER_MEANINGS[stalker.number];
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 36,
            color: "var(--gold)",
            lineHeight: 1,
            minWidth: 48,
          }}
        >
          {stalker.number}
        </span>
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body)",
              margin: 0,
            }}
          >
            {meaning?.keyword ?? `Number ${stalker.number}`}
          </p>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              opacity: 0.7,
              margin: 0,
            }}
          >
            {stalker.count}× across this window
          </p>
        </div>
      </div>
      {/* Cards row — bottom-aligned shelf. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${stalker.topCards.length}, 1fr)`,
          gap: 12,
          alignItems: "end",
          justifyItems: "center",
        }}
      >
        {stalker.topCards.map(({ cardId }) => (
          <StalkerTopCardThumb key={cardId} cardId={cardId} />
        ))}
      </div>
      {/* Labels row — same columns; names wrap freely. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${stalker.topCards.length}, 1fr)`,
          gap: 12,
          justifyItems: "center",
          alignItems: "start",
        }}
      >
        {stalker.topCards.map(({ cardId, count }) => (
          <div
            key={cardId}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                textAlign: "center",
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
        ))}
      </div>
      {isLifePath && (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            color: "var(--gold)",
            margin: 0,
            opacity: 0.85,
          }}
        >
          This is your Life Path number. The cards are mirroring your
          soul's curriculum back to you.
        </p>
      )}
    </div>
  );
}

function StalkerTopCardThumb({ cardId }: { cardId: number }) {
  const { ref: imgRef, width: imgW } = useElementWidth<HTMLDivElement>();
  return (
    <div ref={imgRef} style={{ width: "100%", maxWidth: 140 }}>
      {imgW > 0 && (
        <CardImage cardId={cardId} size="custom" widthPx={Math.round(imgW)} />
      )}
    </div>
  );
}