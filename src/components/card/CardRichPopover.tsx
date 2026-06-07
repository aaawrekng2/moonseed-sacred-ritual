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

  return (
    <div
      style={{
        width: 320,
        maxHeight: "78vh",
        overflowY: "auto",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: 14,
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
      }}
    >
      {/* Constellation on top (static — hero + companions + lines).
          EK63 — hidden where the host page already shows a constellation. */}
      {showConstellation && (
        <div style={{ height: 200, marginBottom: 8, position: "relative" }}>
          <ConstellationWeb
            heroPick={heroPick}
            constellation={constellation}
            onCardClick={() => {}}
            tealSelectedIds={[]}
            heroDrawCount={pulls}
          />
        </div>
      )}

      {/* Name + arcana */}
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          color: "var(--color-foreground)",
        }}
      >
        {name}
      </div>
      {subhead && (
        <div
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginTop: 2,
          }}
        >
          {subhead}
        </div>
      )}

      {/* EK61 — one-line filter indicator. Packs as much as fits in
          priority order, never wraps, and fades to transparent at the
          right edge (mask) so it "trails off" instead of hard-clipping. */}
      <div
        title={filterSummary(filters)}
        style={{
          marginTop: 6,
          fontSize: "var(--text-caption)",
          fontStyle: "italic",
          color: "var(--color-foreground-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          WebkitMaskImage: "linear-gradient(to right, #000 80%, transparent 100%)",
          maskImage: "linear-gradient(to right, #000 80%, transparent 100%)",
        }}
      >
        {filterSummary(filters)}
      </div>

      {/* Tiles: rank (filter-aware) + pulls + reversed */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {rank && <Tile value={`#${rank.rank}`} label={`Rank of ${rank.universe}`} />}
        <Tile value={pulls != null ? String(pulls) : "—"} label="Pulls" />
        <Tile value={reversedPct} label="Reversed" />
      </div>

      {/* Most-often lines */}
      {stats?.topMoonPhase && (
        <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", marginTop: 10 }}>
          Most under <em>{stats.topMoonPhase.phase}</em>
        </div>
      )}
      {stats?.topTimeBucket && (
        <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", marginTop: 2 }}>
          Most often drawn <em>in the {stats.topTimeBucket.bucket}</em>
        </div>
      )}
      {stats?.topDayOfWeek && (
        <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", marginTop: 2 }}>
          Most often on <em>{stats.topDayOfWeek.day}s</em>{" "}
          <span style={{ color: "var(--color-foreground-muted)" }}>
            {stats.topDayOfWeek.count} of {stats.topDayOfWeek.total}
          </span>
        </div>
      )}

      {/* 12-month frequency mini-bars */}
      {stats && (
        <>
          <SectionLabel>12-month frequency</SectionLabel>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34 }}>
            {stats.monthCounts.map((n, i) => (
              <div
                key={i}
                title={`${n}`}
                style={{
                  flex: 1,
                  height: `${Math.max(3, Math.round((n / maxMonth) * 34))}px`,
                  background: n > 0 ? "var(--accent)" : "var(--border-subtle)",
                  borderRadius: 2,
                  opacity: n > 0 ? 0.85 : 0.4,
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Meanings */}
      {meaning && (
        <>
          <SectionLabel>Upright meaning</SectionLabel>
          <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground-muted)" }}>
            {meaning.uprightKeywords.join(", ")}.
          </div>
          <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", marginTop: 4 }}>
            {meaning.uprightMeaning}
          </div>
          <SectionLabel>Reversed meaning</SectionLabel>
          <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground-muted)" }}>
            {meaning.reversedKeywords.join(", ")}.
          </div>
          <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", marginTop: 4 }}>
            {meaning.reversedMeaning}
          </div>
        </>
      )}

      {/* Appears with */}
      {stats && stats.companionsTop3.length > 0 && (
        <>
          <SectionLabel>Most often appears with</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {stats.companionsTop3.map((c) => (
              <span
                key={c.cardId}
                style={{
                  fontSize: "var(--text-body-sm)",
                  fontStyle: "italic",
                  color: "var(--color-foreground)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "3px 8px",
                }}
              >
                {getCardName(c.cardId)}{" "}
                <span style={{ color: "var(--color-foreground-muted)" }}>×{c.count}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {/* First/last seen + gap/spacing */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        {firstSeen && (
          <div>
            <SectionLabel>First seen</SectionLabel>
            <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground)" }}>
              {formatDateLong(firstSeen)}
            </div>
          </div>
        )}
        {lastSeen && (
          <div>
            <SectionLabel>Last seen</SectionLabel>
            <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground)" }}>
              {formatTimeAgo(lastSeen)}
            </div>
          </div>
        )}
        {stats?.longestGapDays != null && (
          <div>
            <SectionLabel>Longest gap</SectionLabel>
            <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground)" }}>
              {stats.longestGapDays} days
            </div>
          </div>
        )}
        {stats?.avgSpacingDays != null && (
          <div>
            <SectionLabel>Avg spacing</SectionLabel>
            <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground)" }}>
              {stats.avgSpacingDays} days
            </div>
          </div>
        )}
      </div>

      {/* Top tag */}
      {stats?.topTag && (
        <>
          <SectionLabel>Most under tag</SectionLabel>
          <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)", color: "var(--color-foreground)" }}>
            {stats.topTag.tag}{" "}
            <span style={{ color: "var(--color-foreground-muted)" }}>
              {stats.topTag.multiplier}× baseline
            </span>
          </div>
        </>
      )}
    </div>
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
      const top = Math.max(8, Math.min(r.top, window.innerHeight - 40));
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
