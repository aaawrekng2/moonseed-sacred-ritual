/**
 * EJ60 — CardStatsPanel
 *
 * Shared presentational component that renders the "rich stats" section
 * for a single card. Identical content to the constellation hover
 * popover's stats sections (rank/pulls/reversed tiles, moon phase row,
 * time-of-day row, day-of-week row, 12-month frequency bars, companions
 * pills, timeline). Used by Card Trace (insights/card/$cardId.tsx)
 * to surface the same one-glance summary the popover shows.
 *
 * This component is presentational only. All data is computed by the
 * caller and passed in as props. No data fetching, no side effects.
 *
 * NOTE: ConstellationPage.tsx still renders this content inline inside
 * its renderCardPopoverInner function because that surface also has
 * an edit-mode (toggle individual sections off). When the popover
 * editing model is generalized into this component (next bundle),
 * both surfaces will collapse to a single source of truth.
 */
import type { CSSProperties } from "react";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { Clock, Calendar as CalendarIcon } from "lucide-react";
import type { CardPopoverData } from "@/lib/quicklog.functions";

export type CardStatsPanelProps = {
  cardName: string;
  /** Total times this card has been drawn in the filtered universe. */
  count: number;
  /** Card's rank (1 = most common) among the seeker's catalog. Optional. */
  rank?: number | null;
  /** How many cards are in the rank universe (e.g. 78 for tarot). Optional. */
  universeSize?: number | null;
  /** Roman numeral for major arcana (or empty for non-majors). */
  roman?: string | null;
  /** Card tags shown in the header — e.g. "MAJOR · CAPRICORN". */
  tags?: string[];
  /** Rich popover stats (12-month sparkline, moon/time/day, companions, timeline). */
  data: CardPopoverData | null;
  /** Resolve a cardId to its display name (for the companions pills). */
  resolveCardName: (id: number) => string;
};

const sectionLabel: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--accent, var(--gold))",
  opacity: 0.85,
};

const tileBase: CSSProperties = {
  background: "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)",
  borderRadius: 6,
  padding: "10px 6px",
  textAlign: "center",
  flex: 1,
};

const tileValue: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: 20,
  color: "var(--color-foreground)",
  lineHeight: 1,
};

const tileLabel: CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--accent, var(--gold))",
  opacity: 0.7,
  marginTop: 4,
};

const inlineEmphasis: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  color: "var(--color-foreground)",
};

function DayOrdinal({ day }: { day: string }) {
  return <span style={inlineEmphasis}>{day}s</span>;
}

export function CardStatsPanel({
  cardName,
  count,
  rank,
  universeSize,
  roman,
  tags,
  data,
  resolveCardName,
}: CardStatsPanelProps) {
  const reversedPct = data?.reversedPct ?? null;
  const topMoonPhase = data?.topMoonPhase ?? null;
  const topTimeBucket = data?.topTimeBucket ?? null;
  const topDayOfWeek = data?.topDayOfWeek ?? null;
  const monthCounts = data?.monthCounts ?? null;
  const companionsTop3 = data?.companionsTop3 ?? [];
  const longestGapDays = data?.longestGapDays ?? null;
  const avgSpacingDays = data?.avgSpacingDays ?? null;
  const moonPhaseLabel = topMoonPhase?.phase ?? null;

  // Build the 12-month sparkline as proportional bars. Tallest = 100% height,
  // others scale proportionally. Empty months render as a 4px floor so the
  // bar row still reads as a chart.
  const maxMonth = monthCounts ? Math.max(...monthCounts, 1) : 1;

  const timeOfDayLabel =
    topTimeBucket?.bucket === "morning"
      ? "in the morning"
      : topTimeBucket?.bucket === "afternoon"
        ? "in the afternoon"
        : topTimeBucket?.bucket === "evening"
          ? "in the evening"
          : topTimeBucket?.bucket === "night"
            ? "late at night"
            : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      {/* Header — card name, roman, tags */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 22,
              color: "var(--color-foreground)",
              lineHeight: 1.1,
            }}
          >
            {cardName}
          </div>
          {roman && (
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 14,
                color: "var(--accent, var(--gold))",
                opacity: 0.85,
              }}
            >
              {roman}
            </div>
          )}
        </div>
        {tags && tags.length > 0 && (
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--accent, var(--gold))",
              opacity: 0.75,
            }}
          >
            {tags.join(" · ")}
          </div>
        )}
      </div>

      {/* Rank / Pulls / Reversed tiles */}
      <div style={{ display: "flex", gap: 8 }}>
        {rank !== null && rank !== undefined && universeSize ? (
          <div style={tileBase}>
            <div style={tileValue}>#{rank}</div>
            <div style={tileLabel}>Rank of {universeSize}</div>
          </div>
        ) : null}
        <div style={tileBase}>
          <div style={tileValue}>{count}</div>
          <div style={tileLabel}>{count === 1 ? "Pull" : "Pulls"}</div>
        </div>
        {reversedPct !== null && (
          <div style={tileBase}>
            <div style={tileValue}>{`${Math.round(reversedPct * 100)}%`}</div>
            <div style={tileLabel}>Reversed</div>
          </div>
        )}
      </div>

      {/* Moon phase row */}
      {moonPhaseLabel && topMoonPhase && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
            color: "var(--color-foreground)",
            opacity: 0.92,
          }}
        >
          <MoonPhaseIcon phase={topMoonPhase.phase} size={20} />
          <div>
            Most under <span style={inlineEmphasis}>{moonPhaseLabel}</span>
          </div>
        </div>
      )}

      {/* Time of day row */}
      {topTimeBucket && timeOfDayLabel && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
            color: "var(--color-foreground)",
            opacity: 0.92,
          }}
        >
          <Clock size={16} style={{ opacity: 0.7 }} aria-hidden />
          <div>
            Most often drawn <span style={inlineEmphasis}>{timeOfDayLabel}</span>
          </div>
        </div>
      )}

      {/* Day of week row */}
      {topDayOfWeek && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
            color: "var(--color-foreground)",
            opacity: 0.92,
          }}
        >
          <CalendarIcon size={16} style={{ opacity: 0.7 }} aria-hidden />
          <div>
            Most often on <DayOrdinal day={topDayOfWeek.day} />{" "}
            <span style={{ opacity: 0.6 }}>
              {topDayOfWeek.count} of {topDayOfWeek.total}
            </span>
          </div>
        </div>
      )}

      {/* 12-month frequency bars */}
      {monthCounts && monthCounts.length === 12 && monthCounts.some((n) => n > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionLabel}>12-month frequency</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gap: 3,
              alignItems: "end",
              height: 40,
            }}
          >
            {monthCounts.map((n, i) => {
              const h = n > 0 ? Math.max(4, Math.round((n / maxMonth) * 36)) : 2;
              return (
                <div
                  key={i}
                  aria-hidden
                  style={{
                    height: h,
                    background:
                      n > 0
                        ? "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)"
                        : "color-mix(in oklab, var(--color-foreground) 10%, transparent)",
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Companions */}
      {companionsTop3.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderTop:
              "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
            paddingTop: 10,
          }}
        >
          <div style={sectionLabel}>Most often appears with</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {companionsTop3.map((c) => (
              <span
                key={c.cardId}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 12,
                  padding: "4px 10px",
                  background:
                    "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                  borderRadius: 999,
                  color: "var(--color-foreground)",
                }}
              >
                {resolveCardName(c.cardId)}{" "}
                <span style={{ opacity: 0.55, fontStyle: "normal" }}>×{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timeline — longest gap / avg spacing. First/Last seen lives in
          Card Trace's own header chrome above this panel, but we surface
          them here too for the popover-style summary. */}
      {(longestGapDays !== null || avgSpacingDays !== null) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            borderTop:
              "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
            paddingTop: 10,
            fontSize: 11,
            color: "var(--color-foreground)",
          }}
        >
          {longestGapDays !== null && (
            <div>
              <div style={sectionLabel}>Longest gap</div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                }}
              >
                {longestGapDays} {longestGapDays === 1 ? "day" : "days"}
              </div>
            </div>
          )}
          {avgSpacingDays !== null && (
            <div>
              <div style={sectionLabel}>Avg spacing</div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                }}
              >
                {avgSpacingDays.toFixed(1)} days
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
