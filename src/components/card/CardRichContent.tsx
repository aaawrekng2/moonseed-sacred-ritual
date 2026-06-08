/**
 * CardRichContent (EK64 · per-section toggles EK71)
 *
 * The read-only body of the draw-table constellation popover
 * (draw table → constellation → hover → click → hover), lifted verbatim so
 * other surfaces render the SAME markup — identical fonts, sizes, spacing,
 * and placement — instead of an approximation.
 *
 * This is a faithful copy of `renderCardPopoverInner`'s read-only output in
 * ConstellationPage.tsx. The manual-entry renderer is NOT touched.
 *
 * EK71 — a gear in the upper-left toggles edit mode. In edit mode an eye sits
 * in the left gutter beside each row/section; tapping it slashes the eye and
 * greys that section. Out of edit mode, hidden sections stop rendering. The
 * choice is per-seeker, persisted in localStorage under
 * `tarotseed:cardpopover:hidden`, so it applies to this popover everywhere it
 * appears (Journal, Insights → Cards, Stalkers, Overview).
 *
 * Pure presentational otherwise: all data comes in via props.
 */
import { useState, type ReactNode } from "react";
import { Eye, EyeOff, Settings } from "lucide-react";
import { TAROT_MEANINGS, type CardMeaning, type YesNo } from "@/lib/tarot-meanings";
import { getCardMeta } from "@/lib/card-astrology";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { isoDayInTz } from "@/lib/time";
import { formatDateShort, formatTimeAgo } from "@/lib/dates";
import type { CardPopoverData } from "@/lib/quicklog.functions";

const ROMAN = [
  "0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI",
  "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI",
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const HIDDEN_LS_KEY = "tarotseed:cardpopover:hidden";

function loadHiddenSections(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function CardRichContent({
  cardId,
  stats,
  rank,
  universeSize,
  count,
  firstSeenIso,
  lastSeenIso,
  resolveCardName,
  tz,
  allowReversed = true,
}: {
  cardId: number;
  stats: CardPopoverData | null;
  rank: number | null;
  universeSize: number;
  count: number;
  firstSeenIso: string | null;
  lastSeenIso: string | null;
  resolveCardName: (id: number) => string;
  tz: string;
  allowReversed?: boolean;
}) {
  const tarotMeaning = TAROT_MEANINGS[cardId];
  const isOracle = !tarotMeaning;
  const m =
    tarotMeaning ??
    ({
      name: resolveCardName(cardId),
      uprightKeywords: [],
      reversedKeywords: [],
      uprightMeaning: "",
      reversedMeaning: "",
      element: "",
      zodiac: null,
      planet: null,
      numerology: null,
      yesNo: "maybe" as YesNo,
    } as CardMeaning);
  const meta = getCardMeta(cardId);

  const isMajor = cardId >= 0 && cardId <= 21;
  const numeralOrRank = isMajor ? ROMAN[cardId] : (meta?.rankLabel ?? null);

  const subtitleParts: string[] = [];
  if (isMajor) subtitleParts.push("Major");
  else if (meta?.suit) subtitleParts.push(meta.suit);
  if (m.zodiac) subtitleParts.push(m.zodiac);
  else if (m.planet) subtitleParts.push(m.planet);
  else if (meta?.planetOrSign) subtitleParts.push(meta.planetOrSign);
  else if (meta?.element) subtitleParts.push(meta.element);
  const subtitle = subtitleParts.join(" · ");

  const pd: CardPopoverData | null = stats;
  const reversedPct = pd?.reversedPct ?? null;
  const topMoonPhase = pd?.topMoonPhase ?? null;
  const topTimeBucket = pd?.topTimeBucket ?? null;
  const topDayOfWeek = pd?.topDayOfWeek ?? null;
  const monthCounts = pd?.monthCounts ?? null;
  const longestGapDays = pd?.longestGapDays ?? null;
  const avgSpacingDays = pd?.avgSpacingDays ?? null;
  const topTag = pd?.topTag ?? null;

  const moonPhaseLabel = topMoonPhase?.phase ?? null;
  const timeBucketLabel = topTimeBucket
    ? topTimeBucket.bucket === "morning"
      ? "in the morning"
      : topTimeBucket.bucket === "afternoon"
        ? "in the afternoon"
        : topTimeBucket.bucket === "evening"
          ? "in the evening"
          : "late at night"
    : null;

  const topCompanions: Array<{ cardId: number; coCount: number }> = [];
  if (pd) {
    for (const c of pd.companionsTop3) {
      topCompanions.push({ cardId: c.cardId, coCount: c.count });
    }
  }

  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(loadHiddenSections);

  const toggleSection = (k: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        window.localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort persistence
      }
      return next;
    });
  };

  // Wraps each row/section with hide logic + the edit-mode eye in the gutter.
  const sec = (k: string, label: string, node: ReactNode, eyeTop = 1) => {
    const isHidden = hidden.has(k);
    if (!editing && isHidden) return null;
    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          opacity: editing && isHidden ? 0.4 : 1,
          transition: "opacity 140ms ease-out",
        }}
      >
        {editing && (
          <button
            type="button"
            onClick={() => toggleSection(k)}
            aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
            title={isHidden ? `Show ${label}` : `Hide ${label}`}
            style={{
              position: "absolute",
              left: -21,
              top: eyeTop,
              width: 16,
              height: 16,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--accent, var(--gold))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {node}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingLeft: 22,
        paddingTop: 2,
      }}
    >
      {/* Gear — upper-left. Toggles edit mode (eyes per section). */}
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        aria-label={editing ? "Done editing sections" : "Edit which sections show"}
        title={editing ? "Done" : "Show / hide sections"}
        style={{
          position: "absolute",
          left: 0,
          top: -2,
          width: 18,
          height: 18,
          padding: 0,
          border: editing
            ? "1px solid var(--accent, var(--gold))"
            : "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm, 6px)",
          background: editing
            ? "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)"
            : "transparent",
          cursor: "pointer",
          color: "var(--accent, var(--gold))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: editing ? 1 : 0.7,
          zIndex: 1,
        }}
      >
        <Settings size={12} />
      </button>

      {/* Header — name + roman numeral, subtitle of arcana/sign */}
      {sec(
        "header",
        "Header",
        (
          <>
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
                  fontSize: 18,
                  color: "var(--color-foreground)",
                  lineHeight: 1.15,
                }}
              >
                {m.name}
              </div>
              {numeralOrRank && (
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--accent, var(--gold))",
                    opacity: 0.85,
                    flexShrink: 0,
                  }}
                >
                  {numeralOrRank}
                </div>
              )}
            </div>
            {subtitle && (
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.7,
                  marginTop: -4,
                }}
              >
                {subtitle}
              </div>
            )}
          </>
        ),
        20,
      )}

      {/* Stat strip — rank + pull count + reversed % */}
      {sec(
        "stats",
        "Stats",
        (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: reversedPct !== null ? "1fr 1fr 1fr" : "1fr 1fr",
              gap: 6,
            }}
          >
            <div
              style={{
                background: "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)",
                borderRadius: 6,
                padding: "8px 4px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 18,
                  color: "var(--color-foreground)",
                  lineHeight: 1,
                }}
              >
                {rank ? `#${rank}` : "—"}
              </div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.7,
                  marginTop: 3,
                }}
              >
                {rank ? `Rank of ${universeSize}` : "Unranked"}
              </div>
            </div>
            <div
              style={{
                background: "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)",
                borderRadius: 6,
                padding: "8px 4px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 18,
                  color: "var(--color-foreground)",
                  lineHeight: 1,
                }}
              >
                {count}
              </div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.7,
                  marginTop: 3,
                }}
              >
                {count === 1 ? "Pull" : "Pulls"}
              </div>
            </div>
            {reversedPct !== null && (
              <div
                style={{
                  background: "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)",
                  borderRadius: 6,
                  padding: "8px 4px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: 18,
                    color: "var(--color-foreground)",
                    lineHeight: 1,
                  }}
                >
                  {`${Math.round(reversedPct * 100)}%`}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--accent, var(--gold))",
                    opacity: 0.7,
                    marginTop: 3,
                  }}
                >
                  Reversed
                </div>
              </div>
            )}
          </div>
        ),
      )}

      {/* Moon phase row */}
      {moonPhaseLabel && topMoonPhase &&
        sec(
          "moon",
          "Moon phase",
          (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--color-foreground)",
                opacity: 0.92,
              }}
            >
              <MoonPhaseIcon phase={topMoonPhase.phase} size={20} />
              <div>
                Most under{" "}
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    color: "var(--color-foreground)",
                  }}
                >
                  {moonPhaseLabel}
                </span>
              </div>
            </div>
          ),
        )}

      {/* Time-of-day row */}
      {timeBucketLabel &&
        sec(
          "time",
          "Time of day",
          (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--color-foreground)",
                opacity: 0.92,
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 22 22"
                fill="none"
                aria-hidden
                style={{ flexShrink: 0, opacity: 0.7 }}
              >
                <circle cx="11" cy="11" r="7.5" fill="none" stroke="var(--accent, var(--gold))" strokeWidth="1.2" />
                <line x1="11" y1="6.5" x2="11" y2="11" stroke="var(--accent, var(--gold))" strokeWidth="1" strokeLinecap="round" />
                <line x1="11" y1="11" x2="13.5" y2="11" stroke="var(--accent, var(--gold))" strokeWidth="0.7" strokeLinecap="round" />
              </svg>
              <div>
                Most often drawn{" "}
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    color: "var(--color-foreground)",
                  }}
                >
                  {timeBucketLabel}
                </span>
              </div>
            </div>
          ),
        )}

      {/* Day of week */}
      {topDayOfWeek &&
        sec(
          "dow",
          "Day of week",
          (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--color-foreground)",
                opacity: 0.92,
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 22 22"
                fill="none"
                aria-hidden
                style={{ flexShrink: 0, opacity: 0.75 }}
              >
                <rect x="3" y="5" width="16" height="14" rx="2" fill="none" stroke="var(--accent, var(--gold))" strokeWidth="1.2" />
                <line x1="3" y1="9" x2="19" y2="9" stroke="var(--accent, var(--gold))" strokeWidth="1" />
                <line x1="7" y1="3" x2="7" y2="7" stroke="var(--accent, var(--gold))" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="15" y1="3" x2="15" y2="7" stroke="var(--accent, var(--gold))" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="11" cy="13" r="1.5" fill="var(--accent, var(--gold))" />
              </svg>
              <div>
                Most often on{" "}
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    color: "var(--color-foreground)",
                  }}
                >
                  {topDayOfWeek.day}s
                </span>
                <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 10 }}>
                  {topDayOfWeek.count} of {topDayOfWeek.total}
                </span>
              </div>
            </div>
          ),
        )}

      {/* 12-month frequency sparkline */}
      {monthCounts && monthCounts.some((n) => n > 0) &&
        sec(
          "sparkline",
          "12-month frequency",
          (
            <div>
              {(() => {
                const now = new Date();
                const todayKey = isoDayInTz(now, tz);
                const todayParts = todayKey.split("-");
                const nowYear = Number(todayParts[0]);
                const nowMonth0 = Number(todayParts[1]) - 1;
                const monthSlots: Array<{ label: string }> = [];
                for (let back = 11; back >= 0; back--) {
                  const total = nowYear * 12 + nowMonth0 - back;
                  const y = Math.floor(total / 12);
                  const m0 = total - y * 12;
                  monthSlots.push({ label: `${MONTH_NAMES[m0]} ${y}` });
                }
                const max = Math.max(1, ...monthCounts);
                return (
                  <div
                    style={{
                      display: "flex",
                      gap: 2,
                      alignItems: "flex-end",
                      height: 30,
                      marginBottom: 2,
                    }}
                  >
                    {monthCounts.map((n, i) => {
                      const frac = n / max;
                      const heightPct = Math.max(8, frac * 100);
                      const opacity = n === 0 ? 0.18 : 0.35 + frac * 0.6;
                      const slot = monthSlots[i];
                      const pullsText = n === 1 ? "1 pull" : `${n} pulls`;
                      return (
                        <div
                          key={`spark-${i}`}
                          title={`${slot.label} · ${pullsText}`}
                          style={{
                            flex: 1,
                            height: `${heightPct}%`,
                            background: "var(--accent, var(--gold))",
                            opacity,
                            borderRadius: 1,
                            cursor: "help",
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })()}
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.6,
                }}
              >
                12-Month Frequency
              </div>
            </div>
          ),
        )}

      {/* Meanings — EK73: upright + reversed are independently toggleable. */}
      {!isOracle &&
        sec(
          "meaning_upright",
          "Upright meaning",
          (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.9,
                }}
              >
                Upright meaning
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 11.5,
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                  lineHeight: 1.35,
                }}
              >
                {m.uprightKeywords.join(", ")}.
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  lineHeight: 1.45,
                }}
              >
                {m.uprightMeaning}
              </div>
            </div>
          ),
        )}

      {!isOracle && allowReversed &&
        sec(
          "meaning_reversed",
          "Reversed meaning",
          (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.9,
                }}
              >
                Reversed meaning
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 11.5,
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                  lineHeight: 1.35,
                }}
              >
                {m.reversedKeywords.join(", ")}.
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  lineHeight: 1.45,
                }}
              >
                {m.reversedMeaning}
              </div>
            </div>
          ),
        )}

      {/* Companion chips */}
      {topCompanions.length > 0 &&
        sec(
          "companions",
          "Companions",
          (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                borderTop: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
                paddingTop: 8,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.85,
                }}
              >
                Most often appears with
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {topCompanions.map((c) => (
                  <span
                    key={c.cardId}
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: 11,
                      padding: "3px 8px",
                      background: "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                      borderRadius: 999,
                      color: "var(--color-foreground)",
                    }}
                  >
                    {resolveCardName(c.cardId)}{" "}
                    <span style={{ opacity: 0.55, fontStyle: "normal" }}>×{c.coCount}</span>
                  </span>
                ))}
              </div>
            </div>
          ),
        )}

      {/* Timeline — first/last seen + longest gap + avg spacing */}
      {(firstSeenIso || lastSeenIso || longestGapDays !== null || avgSpacingDays !== null) &&
        sec(
          "timeline",
          "Timeline",
          (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                borderTop: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
                paddingTop: 8,
                fontSize: 11,
                color: "var(--color-foreground)",
              }}
            >
              <div>
                <div style={{ opacity: 0.7, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent, var(--gold))" }}>
                  First seen
                </div>
                <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", marginTop: 2 }}>
                  {firstSeenIso ? formatDateShort(firstSeenIso) : "—"}
                </div>
              </div>
              <div>
                <div style={{ opacity: 0.7, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent, var(--gold))" }}>
                  Last seen
                </div>
                <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", marginTop: 2 }}>
                  {lastSeenIso ? formatTimeAgo(lastSeenIso) : "—"}
                </div>
              </div>
              {longestGapDays !== null && (
                <div>
                  <div style={{ opacity: 0.7, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent, var(--gold))" }}>
                    Longest gap
                  </div>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", marginTop: 2 }}>
                    {longestGapDays === 1 ? "1 day" : `${longestGapDays} days`}
                  </div>
                </div>
              )}
              {avgSpacingDays !== null && (
                <div>
                  <div style={{ opacity: 0.7, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent, var(--gold))" }}>
                    Avg spacing
                  </div>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", marginTop: 2 }}>
                    {`${avgSpacingDays} ${avgSpacingDays === 1 ? "day" : "days"}`}
                  </div>
                </div>
              )}
            </div>
          ),
        )}

      {/* Tag bias */}
      {topTag &&
        sec(
          "tag",
          "Tag bias",
          (
            <div
              style={{
                borderTop: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
                paddingTop: 8,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.85,
                  marginBottom: 4,
                }}
              >
                Most under tag
              </div>
              <div style={{ fontFamily: "var(--font-serif)", fontSize: 12, color: "var(--color-foreground)" }}>
                <span style={{ fontStyle: "italic" }}>{topTag.tag}</span>{" "}
                <span style={{ opacity: 0.55, fontSize: 10 }}>— {topTag.multiplier}× baseline</span>
              </div>
            </div>
          ),
        )}
    </div>
  );
}
