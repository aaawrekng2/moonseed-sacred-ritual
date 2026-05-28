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

/**
 * EJ70 — Explain a header tag on hover. Covers arcana type, suit,
 * element, zodiac sign, and roman numeral. Falls back to a generic
 * label when a tag isn't recognized so every tag is still hoverable.
 */
function describeTag(raw: string): string {
  const t = raw.trim().toUpperCase();
  const ELEMENTS: Record<string, string> = {
    FIRE: "Element: Fire — drive, passion, will (Wands).",
    WATER: "Element: Water — emotion, intuition, relationship (Cups).",
    AIR: "Element: Air — thought, communication, conflict (Swords).",
    EARTH: "Element: Earth — body, work, material world (Pentacles).",
  };
  const ZODIAC: Record<string, string> = {
    ARIES: "Zodiac: Aries — the card's astrological association.",
    TAURUS: "Zodiac: Taurus — the card's astrological association.",
    GEMINI: "Zodiac: Gemini — the card's astrological association.",
    CANCER: "Zodiac: Cancer — the card's astrological association.",
    LEO: "Zodiac: Leo — the card's astrological association.",
    VIRGO: "Zodiac: Virgo — the card's astrological association.",
    LIBRA: "Zodiac: Libra — the card's astrological association.",
    SCORPIO: "Zodiac: Scorpio — the card's astrological association.",
    SAGITTARIUS: "Zodiac: Sagittarius — the card's astrological association.",
    CAPRICORN: "Zodiac: Capricorn — the card's astrological association.",
    AQUARIUS: "Zodiac: Aquarius — the card's astrological association.",
    PISCES: "Zodiac: Pisces — the card's astrological association.",
  };
  const SUITS: Record<string, string> = {
    WANDS: "Suit: Wands — fire, action, creativity.",
    CUPS: "Suit: Cups — water, emotion, relationship.",
    SWORDS: "Suit: Swords — air, thought, conflict.",
    PENTACLES: "Suit: Pentacles — earth, work, material world.",
  };
  if (t === "MAJOR") return "Major Arcana — one of the 22 cards marking life's larger turning points.";
  if (t === "MINOR") return "Minor Arcana — the 56 cards covering day-to-day matters.";
  if (ELEMENTS[t]) return ELEMENTS[t];
  if (ZODIAC[t]) return ZODIAC[t];
  if (SUITS[t]) return SUITS[t];
  // Roman numeral (e.g. XV) — Major Arcana card number.
  if (/^[IVXLCDM]+$/.test(t)) return `Card number ${t} in the Major Arcana sequence.`;
  return raw;
}

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
  /**
   * EJ69 — Optional upright meaning section. When provided, rendered
   * inline between the 12-month frequency and companions. Matches the
   * constellation popover composition exactly (keywords + body in
   * italic serif). Pass null/undefined to hide.
   */
  uprightMeaning?: { keywords: string[]; body: string } | null;
  /**
   * EJ69 — Optional reversed meaning section. Same treatment as upright,
   * rendered immediately below it. Pass null/undefined to hide.
   */
  reversedMeaning?: { keywords: string[]; body: string } | null;
  /**
   * EJ69 — Optional first seen / last seen labels. When provided,
   * rendered as a two-column tile row above the longest-gap/avg-spacing
   * row. Matches the popover screenshot. Pass null/undefined to hide.
   */
  firstSeen?: string | null;
  lastSeen?: string | null;
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
  uprightMeaning,
  reversedMeaning,
  firstSeen,
  lastSeen,
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
            {/* EJ70 — Each tag is an individually-hoverable span with a
                title explaining what it means (arcana type, zodiac,
                element, roman numeral, suit). cursor:help signals the
                affordance. " · " separators sit between. */}
            {tags.map((t, i) => (
              <span key={`${t}-${i}`}>
                <span title={describeTag(t)} style={{ cursor: "help" }}>
                  {t}
                </span>
                {i < tags.length - 1 ? " · " : ""}
              </span>
            ))}
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
              // EJ70 — Per-bar hover tip: month label + draw count. The
              // array runs oldest → newest, ending on the current month,
              // so index 11 is this month and index i is (11 - i) months
              // ago. cursor:help signals the bar is hoverable.
              const monthsAgo = 11 - i;
              const d = new Date();
              d.setMonth(d.getMonth() - monthsAgo);
              const monthLabel = d.toLocaleDateString(undefined, {
                month: "short",
                year: "numeric",
              });
              const drawWord = n === 1 ? "draw" : "draws";
              return (
                <div
                  key={i}
                  title={`${monthLabel} · ${n} ${drawWord}`}
                  style={{
                    height: h,
                    background:
                      n > 0
                        ? "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)"
                        : "color-mix(in oklab, var(--color-foreground) 10%, transparent)",
                    borderRadius: 2,
                    cursor: "help",
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* EJ69 — Upright meaning section. Mirrors the constellation popover
          screenshot layout: small-caps gold label, keywords on first line,
          italic body below. Inline rendering — no "Show meaning" collapse. */}
      {uprightMeaning && (uprightMeaning.keywords.length > 0 || uprightMeaning.body) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            borderTop:
              "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
            paddingTop: 10,
          }}
        >
          <div style={sectionLabel}>Upright meaning</div>
          {uprightMeaning.keywords.length > 0 && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--color-foreground)",
                opacity: 0.95,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {uprightMeaning.keywords.join(", ")}.
            </div>
          )}
          {uprightMeaning.body && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 13,
                color: "var(--color-foreground)",
                opacity: 0.85,
                lineHeight: 1.45,
              }}
            >
              {uprightMeaning.body}
            </div>
          )}
        </div>
      )}

      {/* EJ69 — Reversed meaning section. Same treatment as upright. */}
      {reversedMeaning && (reversedMeaning.keywords.length > 0 || reversedMeaning.body) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionLabel}>Reversed meaning</div>
          {reversedMeaning.keywords.length > 0 && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--color-foreground)",
                opacity: 0.95,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {reversedMeaning.keywords.join(", ")}.
            </div>
          )}
          {reversedMeaning.body && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 13,
                color: "var(--color-foreground)",
                opacity: 0.85,
                lineHeight: 1.45,
              }}
            >
              {reversedMeaning.body}
            </div>
          )}
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

      {/* EJ69 — First seen / Last seen tiles. Matches the popover
          screenshot. Rendered above the longest-gap / avg-spacing row.
          Both required to render the row. */}
      {firstSeen && lastSeen && (
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
          <div>
            <div style={sectionLabel}>First seen</div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
              }}
            >
              {firstSeen}
            </div>
          </div>
          <div>
            <div style={sectionLabel}>Last seen</div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
              }}
            >
              {lastSeen}
            </div>
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
