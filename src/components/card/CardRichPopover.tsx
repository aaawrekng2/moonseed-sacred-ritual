/**
 * EK60/EK61 — CardRichPopover + CardHoverTip
 *
 * A reusable hover tip that reproduces the manual-entry constellation
 * card popover: a static mini-constellation on top (hovered card as hero,
 * no teal/badges/calendar interaction) and the rich card stats below.
 *
 * EK61 — filter-aware. Receives the active InsightsFilters, threads tz +
 * the filter envelope into every fetch, includes the global rank tile
 * (#N of M, from getCardDrawCounts), and shows a one-line filter indicator
 * that fades out at the right edge so the seeker can see how the numbers
 * are filtered.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  getCardConstellation,
  getCardPopoverData,
  getCardDrawCounts,
  type CardConstellation,
  type CardPopoverData,
} from "@/lib/quicklog.functions";
import type { InsightsFilters } from "@/lib/insights.types";
import { getCardName, cardType } from "@/lib/tarot";
import { getCardMeaning } from "@/lib/tarot-meanings";
import { formatDateLong, formatTimeAgo } from "@/lib/dates";
import { ConstellationWeb } from "@/components/constellation/ConstellationWeb";
import { CardRichContent } from "@/components/card/CardRichContent";
import { useAnyDeckCardName } from "@/lib/active-deck";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// EK61 — map the Insights filter shape onto the endpoints' envelope.
const TIME_RANGE_LABEL: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  "365d": "Last 365 days",
  all: "All time",
};

function toEnvelope(f: InsightsFilters) {
  return {
    timeRange: f.timeRange,
    tags: f.tagIds,
    spreadTypes: f.spreadTypes,
    moonPhases: f.moonPhases,
    reversedOnly: f.reversedOnly,
    deepOnly: f.deepOnly,
  };
}

// One-line, priority-ordered summary of the active filters.
function filterSummary(f: InsightsFilters): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts: string[] = [TIME_RANGE_LABEL[f.timeRange] ?? String(f.timeRange)];
  if (f.tagIds.length) parts.push(plural(f.tagIds.length, "tag"));
  if (f.spreadTypes.length) parts.push(plural(f.spreadTypes.length, "spread"));
  if (f.moonPhases.length) parts.push(plural(f.moonPhases.length, "moon phase"));
  if (f.reversedOnly) parts.push("reversed only");
  if (f.deepOnly) parts.push("deep only");
  return parts.join("  ·  ");
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--surface-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "8px 6px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "var(--text-heading-sm)", color: "var(--color-foreground)" }}>
        {value}
      </div>
      <div
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--text-caption)",
        color: "var(--accent)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

export type CardRichPreload = {
  constellation?: CardConstellation | null;
  stats?: CardPopoverData | null;
  rank?: { rank: number; universe: number } | null;
};

export function CardRichPopoverContent({
  cardId,
  filters,
  showConstellation = true,
  preload,
}: {
  cardId: number;
  filters: InsightsFilters;
  /** EK63 — whether to render the mini-constellation on top. Set per
   *  surface in code: ON for Insights → Cards; OFF where the host page
   *  already shows a constellation (e.g. manual entry). */
  showConstellation?: boolean;
  /** EK63 — preloaded data. When provided, the component uses it instead of
   *  fetching, so callers that already hold this in memory (manual entry)
   *  don't trigger a redundant round-trip. Omit it to let the component
   *  fetch for itself (Insights, and future surfaces). */
  preload?: CardRichPreload;
}) {
  const constFn = useServerFn(getCardConstellation);
  const dataFn = useServerFn(getCardPopoverData);
  const rankFn = useServerFn(getCardDrawCounts);
  const resolveCardName = useAnyDeckCardName();
  // EK65 — name of the constellation card currently hovered inside this
  // popup, shown as a small label near the cursor.
  const [webHover, setWebHover] = useState<{ name: string; x: number; y: number } | null>(null);
  // When preloaded, skip the fetch entirely and never re-run it.
  const hasPreload = preload !== undefined;
  const [constellation, setConstellation] = useState<CardConstellation | null>(
    preload?.constellation ?? null,
  );
  const [stats, setStats] = useState<CardPopoverData | null>(preload?.stats ?? null);
  const [rank, setRank] = useState<{ rank: number; universe: number } | null>(
    preload?.rank ?? null,
  );

  const tz = filters.tz;
  // Re-run when the filter window changes (the envelope is the part the
  // endpoints actually filter on).
  const envKey = JSON.stringify(toEnvelope(filters));

  useEffect(() => {
    if (hasPreload) return; // caller supplied data — don't fetch
    let alive = true;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const envelope = toEnvelope(filters);
        const [c, d, dc] = await Promise.all([
          constFn({ data: { heroCardId: cardId, tz, filters: envelope }, headers }),
          dataFn({ data: { cardIds: [cardId], tz, filters: envelope }, headers }),
          rankFn({ data: { cardIds: [cardId], tz, filters: envelope }, headers }),
        ]);
        if (!alive) return;
        setConstellation(c);
        setStats((d as Record<number, CardPopoverData>)[cardId] ?? null);
        const r = dc as { perCardRank: Record<number, number>; rankUniverseSize: number };
        const rk = r.perCardRank?.[cardId];
        setRank(typeof rk === "number" ? { rank: rk, universe: r.rankUniverseSize } : null);
      } catch {
        /* leave nulls — render what we can */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, tz, envKey, hasPreload, constFn, dataFn, rankFn]);

  const name = getCardName(cardId);
  const meaning = getCardMeaning(cardId);
  const arcana = cardType(cardId) === "Major" ? "Major" : cardType(cardId);
  const subhead = [arcana, meaning?.zodiac ?? meaning?.element].filter(Boolean).join(" · ");

  const pulls = constellation ? constellation.matches.length : null;
  const dates = (constellation?.matches ?? [])
    .map((m) => m.createdAt)
    .sort();
  const firstSeen = dates.length ? dates[0] : null;
  const lastSeen = dates.length ? dates[dates.length - 1] : null;

  const heroPick: ManualPick = {
    id: cardId,
    cardIndex: cardId,
    isReversed: false,
    deckId: null,
    cardName: name,
  };

  const reversedPct =
    stats?.reversedPct != null ? `${Math.round(stats.reversedPct * 100)}%` : "—";
  const maxMonth = stats ? Math.max(1, ...stats.monthCounts) : 1;

  const count =
    stats?.monthCounts?.reduce((a, n) => a + n, 0) ??
    (constellation ? constellation.matches.length : 0);

  return (
    <>
    <div
      style={{
        width: 320,
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Constellation on top — hidden where the host page already shows one. */}
      {showConstellation && (
        <div style={{ height: 200, marginBottom: 24, position: "relative" }}>
          <ConstellationWeb
            heroPick={heroPick}
            constellation={constellation}
            onCardClick={() => {}}
            tealSelectedIds={[]}
            heroDrawCount={pulls}
            onCardHover={(cid, x, y) =>
              setWebHover(cid != null ? { name: resolveCardName(cid), x, y } : null)
            }
          />
        </div>
      )}
      {/* EK64 — the real draw-table popover body, from the shared
          CardRichContent so fonts/sizes/placement match exactly. */}
      <CardRichContent
        cardId={cardId}
        stats={stats}
        rank={rank?.rank ?? null}
        universeSize={rank?.universe ?? 0}
        count={count}
        firstSeenIso={firstSeen}
        lastSeenIso={lastSeen}
        resolveCardName={resolveCardName}
        tz={tz}
      />
    </div>
      {webHover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: webHover.x + 12,
              top: webHover.y + 12,
              zIndex: 210,
              pointerEvents: "none",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--color-foreground)",
              background: "var(--surface-elevated, var(--surface-card))",
              border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
              borderRadius: 6,
              padding: "3px 8px",
              whiteSpace: "nowrap",
              boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
            }}
          >
            {webHover.name}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Wrap any element to show the CardRichPopover on hover. Portals the
 * popover to <body> and positions it next to the trigger, flipping to the
 * left if it would overflow the right edge.
 */
export function CardHoverTip({
  cardId,
  filters,
  children,
  className,
  showConstellation = true,
  preload,
}: {
  cardId: number;
  filters: InsightsFilters;
  children: React.ReactNode;
  className?: string;
  showConstellation?: boolean;
  preload?: CardRichPreload;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const openTimer = useRef<number>(0);
  const closeTimer = useRef<number>(0);

  const POP_W = 320;

  const show = () => {
    window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const wantLeft = r.right + 10;
      const left =
        wantLeft + POP_W > window.innerWidth ? Math.max(8, r.left - POP_W - 10) : wantLeft;
      // EK65 — pin the top near the top of the screen so the popup can show
      // as much of itself as possible (it grows up to full window height).
      const top = 8;
      setPos({ left, top });
      setOpen(true);
    }, 220);
  };
  const hide = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ display: "block" }}
    >
      {children}
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              zIndex: 200,
            }}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={hide}
          >
            <CardRichPopoverContent
              cardId={cardId}
              filters={filters}
              showConstellation={showConstellation}
              preload={preload}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
