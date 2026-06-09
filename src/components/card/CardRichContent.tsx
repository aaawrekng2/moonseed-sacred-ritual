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
import { useState, useEffect, type ReactNode } from "react";
import { Eye, EyeOff, Settings, Pin, Info } from "lucide-react";
import { TAROT_MEANINGS, type CardMeaning, type YesNo } from "@/lib/tarot-meanings";
import { getCardMeta } from "@/lib/card-astrology";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { isoDayInTz } from "@/lib/time";
import { formatDateShort, formatTimeAgo } from "@/lib/dates";
import { ConstellationWeb } from "@/components/constellation/ConstellationWeb";
import type { CardConstellation } from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";
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
const SLIM_LS_KEY = "tarotseed:cardpopover:slim";
const STAGE_LS_KEY = "tarotseed:cardpopover:stage";

// Slim/first-hover items the seeker can toggle on the left edit pane.
type SlimId =
  | "count"
  | "last-seen"
  | "reversed"
  | "rank"
  | "moon-phase"
  | "time-of-day"
  | "day-of-week"
  | "longest-gap"
  | "avg-spacing"
  | "tag-bias";

const ALL_SLIM_IDS: SlimId[] = [
  "count",
  "last-seen",
  "reversed",
  "rank",
  "moon-phase",
  "time-of-day",
  "day-of-week",
  "longest-gap",
  "avg-spacing",
  "tag-bias",
];

const SLIM_LABELS: Record<SlimId, string> = {
  count: "Pull count",
  "last-seen": "Last seen",
  reversed: "Reversed %",
  rank: "Rank",
  "moon-phase": "Moon phase",
  "time-of-day": "Time of day",
  "day-of-week": "Day of week",
  "longest-gap": "Longest gap",
  "avg-spacing": "Avg spacing",
  "tag-bias": "Tag bias",
};

const SLIM_DEFAULT_VISIBLE: SlimId[] = ["count", "last-seen", "reversed"];

// EK82 — one-line hover hints for the rich popover's sections. Stats tiles
// (rank/pulls/reversed) carry their own per-tile hints; these cover the rest.
const SECTION_HINTS: Record<string, string> = {
  moon: "The moon phase this card most often shows up under in your readings",
  time: "The time of day you most often draw this card",
  dow: "The weekday this card lands on most often",
  sparkline: "How often this card appeared each month over the last year",
  meaning_upright: "What this card means when it appears upright",
  meaning_reversed: "What this card means when it appears reversed",
  companions: "Cards that most often show up alongside this one",
  timeline: "When you first and last drew this card, and your draw streak",
  tag: "The tag this card skews toward more than your average reading",
};

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

function loadSlimVisible(): Set<string> {
  if (typeof window === "undefined") return new Set(SLIM_DEFAULT_VISIBLE);
  try {
    const raw = window.localStorage.getItem(SLIM_LS_KEY);
    if (!raw) return new Set(SLIM_DEFAULT_VISIBLE);
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : SLIM_DEFAULT_VISIBLE);
  } catch {
    return new Set(SLIM_DEFAULT_VISIBLE);
  }
}

/** "1" = hover jumps straight to rich; "2" = hover shows slim, click → rich. */
export function loadHoverStage(): "1" | "2" {
  if (typeof window === "undefined") return "2";
  try {
    return window.localStorage.getItem(STAGE_LS_KEY) === "1" ? "1" : "2";
  } catch {
    return "2";
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
  variant = "rich",
  onEscalate,
  editing = false,
  showConstellation = false,
  constellation = null,
  heroPick = null,
  pulls,
  onNodeHover,
  onNodeClick,
  headerInfo,
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
  /** "slim" = compact first-hover peek; "rich" = full body (default). */
  variant?: "slim" | "rich";
  /** Called when the seeker clicks the slim peek to expand to rich. */
  onEscalate?: (openEdit?: boolean) => void;
  /** EK77 — edit mode is owned by the host (gear lives on the card corner). */
  editing?: boolean;
  /** EK77 — the constellation is now a section in the body. The host passes
   *  the data; whether the section exists at all is gated by showConstellation. */
  showConstellation?: boolean;
  constellation?: CardConstellation | null;
  heroPick?: ManualPick | null;
  pulls?: number;
  /** EK78 — a node in the popover's constellation was hovered / clicked, so
   *  the host can open a nested mini / big popover for that card (diving). */
  onNodeHover?: (cardId: number | null, x: number, y: number) => void;
  onNodeClick?: (cardId: number) => void;
  /** EK88 — optional ⓘ content shown next to the card name in the header. */
  headerInfo?: ReactNode;
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

  const [hidden, setHidden] = useState<Set<string>>(loadHiddenSections);
  const [slimVisible, setSlimVisible] = useState<Set<string>>(loadSlimVisible);
  const [hoverStage, setHoverStage] = useState<"1" | "2">(loadHoverStage);
  // EK86 — the lower hints eyeball was retired. Per-item hover hints inside
  // an open popover are always available; whether the popover shows on hover
  // at all is governed by the single global hover-snooze eye in the top cluster.
  const hintsOff = false;
  // EK88 — header ⓘ panel (e.g. constellation legend on manual entry).
  const [headerInfoOpen, setHeaderInfoOpen] = useState(false);
  // Hint attributes for an item — empty when hints are turned off.
  const hintAttrs = (tip: string) =>
    hintsOff ? {} : { className: "tarotseed-mini-tip", "data-tarotseed-tip": tip };

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

  const toggleSlim = (k: string) => {
    setSlimVisible((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        window.localStorage.setItem(SLIM_LS_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort persistence
      }
      return next;
    });
  };

  const setStage = (s: "1" | "2") => {
    setHoverStage(s);
    try {
      window.localStorage.setItem(STAGE_LS_KEY, s);
    } catch {
      // best-effort persistence
    }
  };

  // Value string for a slim item, or null when there's no data for it.
  const slimValue = (id: SlimId): string | null => {
    switch (id) {
      case "count":
        return `${count} ${count === 1 ? "pull" : "pulls"}`;
      case "last-seen":
        return lastSeenIso ? `Seen ${formatTimeAgo(lastSeenIso)}` : null;
      case "reversed":
        return reversedPct !== null ? `${Math.round(reversedPct * 100)}% reversed` : null;
      case "rank":
        return rank ? `Rank #${rank}` : null;
      case "moon-phase":
        return moonPhaseLabel ?? null;
      case "time-of-day":
        return timeBucketLabel ? timeBucketLabel.replace(/^in the /, "") : null;
      case "day-of-week":
        return topDayOfWeek ? `${topDayOfWeek.day}s` : null;
      case "longest-gap":
        return longestGapDays !== null ? `Gap ${longestGapDays}d` : null;
      case "avg-spacing":
        return avgSpacingDays !== null ? `~${avgSpacingDays}d apart` : null;
      case "tag-bias":
        return topTag ? topTag.tag : null;
      default:
        return null;
    }
  };

  // ── Slim / first-hover peek (EK76: cloned from the manual-entry slim) ──
  // A compact horizontal strip: name + glyph-prefixed italic mini-chips
  // separated by dots, plus an ⓘ that opens the rich body.
  const slimGlyph = (id: SlimId): ReactNode => {
    const s = { width: 10, height: 10, viewBox: "0 0 16 16" } as const;
    switch (id) {
      case "count":
        return (<svg {...s} fill="currentColor" aria-hidden><circle cx="8" cy="8" r="3.5" /></svg>);
      case "last-seen":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><circle cx="8" cy="8" r="6" /><line x1="8" y1="8" x2="8" y2="5" strokeLinecap="round" /><line x1="8" y1="8" x2="10.5" y2="8" strokeLinecap="round" /></svg>);
      case "reversed":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 6 L8 2 L12 6" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 10 L8 14 L4 10" strokeLinecap="round" strokeLinejoin="round" /></svg>);
      case "rank":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 14 L3 9 L7 9 L7 14 M7 14 L7 6 L11 6 L11 14 M11 14 L11 3 L15 3 L15 14" strokeLinecap="round" strokeLinejoin="round" /></svg>);
      case "moon-phase":
        return (<svg {...s} fill="currentColor" aria-hidden><path d="M8 1 A 7 7 0 0 1 8 15 A 4 7 0 0 0 8 1" /></svg>);
      case "time-of-day":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><circle cx="8" cy="8" r="6" /></svg>);
      case "day-of-week":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><rect x="2" y="4" width="12" height="10" rx="1" /><line x1="2" y1="7" x2="14" y2="7" /></svg>);
      case "longest-gap":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><line x1="2" y1="8" x2="14" y2="8" strokeLinecap="round" /><line x1="2" y1="5" x2="2" y2="11" strokeLinecap="round" /><line x1="14" y1="5" x2="14" y2="11" strokeLinecap="round" /></svg>);
      case "avg-spacing":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><line x1="2" y1="8" x2="14" y2="8" strokeLinecap="round" strokeDasharray="2 2" /></svg>);
      case "tag-bias":
        return (<svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 7 L7 2 L14 2 L14 9 L9 14 L2 7Z" strokeLinejoin="round" /><circle cx="11" cy="5" r="0.8" fill="currentColor" /></svg>);
      default:
        return null;
    }
  };

  // Manual-entry-style compact value for a slim chip (or null when no data).
  const slimChipValue = (id: SlimId): string | null => {
    switch (id) {
      case "count":
        return `${count}`;
      case "last-seen":
        return lastSeenIso ? formatTimeAgo(lastSeenIso) : null;
      case "reversed":
        return reversedPct !== null ? `${Math.round(reversedPct * 100)}%` : null;
      case "rank":
        return rank ? `#${rank}` : null;
      case "moon-phase":
        return moonPhaseLabel
          ? moonPhaseLabel.split(" ").map((w) => w[0]).join("")
          : null;
      case "time-of-day":
        return topTimeBucket ? topTimeBucket.bucket : null;
      case "day-of-week":
        return topDayOfWeek ? topDayOfWeek.day.slice(0, 3) : null;
      case "longest-gap":
        return longestGapDays !== null ? `${longestGapDays}d` : null;
      case "avg-spacing":
        return avgSpacingDays !== null ? `${avgSpacingDays}d` : null;
      case "tag-bias":
        return topTag ? `${topTag.tag} ${topTag.multiplier}×` : null;
      default:
        return null;
    }
  };

  const slimTitle = (id: SlimId): string => {
    switch (id) {
      case "count":
        return `${count} ${count === 1 ? "time" : "times"} this card has appeared in your readings (within current filters)`;
      case "last-seen":
        return lastSeenIso ? `Last drawn ${formatTimeAgo(lastSeenIso)}` : "Last drawn";
      case "reversed":
        return reversedPct !== null
          ? `Reversed ${Math.round(reversedPct * 100)}% of the time this card has appeared`
          : "How often this card is reversed";
      case "rank":
        return rank
          ? `Ranks #${rank}${universeSize ? ` of ${universeSize}` : ""} cards by how often you draw it`
          : "How often you draw this card vs others";
      case "moon-phase":
        return moonPhaseLabel ? `Drawn most often under the ${moonPhaseLabel}` : "Most common moon phase";
      case "time-of-day":
        return topTimeBucket ? `Most often drawn in the ${topTimeBucket.bucket}` : "Most common time of day";
      case "day-of-week":
        return topDayOfWeek
          ? `Most often on ${topDayOfWeek.day}s (${topDayOfWeek.count} of ${topDayOfWeek.total})`
          : "Most common day of the week";
      case "longest-gap":
        return longestGapDays !== null
          ? `Longest stretch without this card: ${longestGapDays} ${longestGapDays === 1 ? "day" : "days"}`
          : "Longest stretch without this card";
      case "avg-spacing":
        return avgSpacingDays !== null
          ? `Average ${avgSpacingDays} ${avgSpacingDays === 1 ? "day" : "days"} between appearances`
          : "Average spacing between appearances";
      case "tag-bias":
        return topTag
          ? `Tagged "${topTag.tag}" ${topTag.multiplier}× more often with this card than your average reading`
          : "Tag this card skews toward";
      default:
        return "";
    }
  };

  const renderSlimStrip = (onInfo?: () => void): ReactNode => {
    const chips = ALL_SLIM_IDS.map((id) => ({ id, value: slimChipValue(id) })).filter(
      (c): c is { id: SlimId; value: string } => slimVisible.has(c.id) && c.value !== null,
    );
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 12,
            color: "var(--color-foreground)",
            whiteSpace: "nowrap",
            opacity: 0.9,
          }}
        >
          {m.name}
        </div>
        {chips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {chips.map((c, i) => (
              <span key={c.id} style={{ display: "inline-flex", alignItems: "center" }}>
                {i > 0 && (
                  <span
                    aria-hidden
                    style={{ color: "var(--color-foreground)", opacity: 0.25, marginRight: 8, fontSize: 10 }}
                  >
                    ·
                  </span>
                )}
                <span
                  data-tarotseed-tip={slimTitle(c.id)}
                  className="tarotseed-mini-tip"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontFamily: "var(--font-serif)",
                    fontSize: 11,
                    color: "var(--color-foreground)",
                    cursor: "help",
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden
                    style={{ color: "var(--accent, var(--gold))", opacity: 0.7, display: "inline-flex", alignItems: "center" }}
                  >
                    {slimGlyph(c.id)}
                  </span>
                  <span style={{ fontStyle: "italic" }}>{c.value}</span>
                </span>
              </span>
            ))}
          </div>
        )}
        {onInfo && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInfo();
            }}
            aria-label="Open full card details"
            title="Open full card details"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              padding: 0,
              background: "transparent",
              border: "none",
              color: "var(--accent, var(--gold))",
              cursor: "pointer",
              opacity: 0.75,
              borderRadius: 9999,
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <circle cx="8" cy="8" r="6.5" />
              <line x1="8" y1="7" x2="8" y2="11" strokeLinecap="round" />
              <circle cx="8" cy="5" r="0.5" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  if (variant === "slim") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onEscalate?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEscalate?.();
          }
        }}
        style={{ cursor: "pointer", padding: "4px 8px" }}
      >
        {renderSlimStrip()}
      </div>
    );
  }

  // Left "first hover shows" editor pane + stage toggle (rich edit mode).
  const editLeftPane = (
    <div style={{ flex: "0 0 190px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          paddingBottom: 8,
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-foreground-muted, var(--color-foreground))",
          }}
        >
          Hover
        </span>
        {(["2", "1"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStage(s)}
            style={{
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background:
                hoverStage === s
                  ? "color-mix(in oklab, var(--accent, var(--gold)) 16%, transparent)"
                  : "transparent",
              color:
                hoverStage === s
                  ? "var(--accent, var(--gold))"
                  : "var(--color-foreground-muted, var(--color-foreground))",
              whiteSpace: "nowrap",
            }}
          >
            {s === "2" ? "Peek first" : "Show details"}
          </button>
        ))}
      </div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--accent, var(--gold))",
          opacity: 0.85,
        }}
      >
        Hover preview
      </div>
      <div
        style={{
          border: "1px dashed color-mix(in oklab, var(--accent, var(--gold)) 40%, transparent)",
          borderRadius: 6,
          background: "color-mix(in oklab, var(--accent, var(--gold)) 4%, transparent)",
          padding: "8px 10px",
        }}
      >
        {renderSlimStrip()}
      </div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--accent, var(--gold))",
          opacity: 0.85,
        }}
      >
        First hover shows
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {ALL_SLIM_IDS.map((id) => {
          const on = slimVisible.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleSlim(id)}
              aria-label={on ? `Hide ${SLIM_LABELS[id]} from first hover` : `Show ${SLIM_LABELS[id]} in first hover`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--color-foreground)",
                opacity: on ? 1 : 0.4,
                textAlign: "left",
              }}
            >
              {on ? (
                <Eye size={13} style={{ color: "var(--accent, var(--gold))", flexShrink: 0 }} />
              ) : (
                <EyeOff size={13} style={{ flexShrink: 0 }} />
              )}
              {SLIM_LABELS[id]}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Wraps each row/section with hide logic + the edit-mode eye in the gutter.
  const sec = (k: string, label: string, node: ReactNode, eyeTop = 1) => {
    const isHidden = hidden.has(k);
    if (!editing && isHidden) return null;
    const hint = hintsOff ? undefined : SECTION_HINTS[k];
    const body =
      hint && !editing ? (
        <span className="tarotseed-mini-tip" data-tarotseed-tip={hint} style={{ display: "block" }}>
          {node}
        </span>
      ) : (
        node
      );
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
        {body}
      </div>
    );
  };

  return (
    <div style={{ position: "relative", paddingTop: editing ? 24 : 2 }}>
      <div style={{ display: "flex", gap: editing ? 16 : 0, alignItems: "flex-start" }}>
        {editing && editLeftPane}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            paddingLeft: 22,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
      {/* EK77 — Constellation is now a real section (toggle + persistence
          come from the same hidden-set as every other section). */}
      {showConstellation &&
        sec(
          "constellation",
          "Constellation",
          (
            <div style={{ width: "100%", marginBottom: 8 }}>
              <ConstellationWeb
                heroPick={heroPick}
                constellation={constellation}
                onCardClick={(cid) => onNodeClick?.(cid)}
                tealSelectedIds={[]}
                heroDrawCount={pulls}
                emptyVariant="skeleton"
                onCardHover={(cid, x, y) => onNodeHover?.(cid, x, y)}
              />
            </div>
          ),
        )}
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
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
                {headerInfo && (
                  <button
                    type="button"
                    aria-label="What this view shows"
                    title="What this view shows"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHeaderInfoOpen((v) => !v);
                    }}
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: headerInfoOpen
                        ? "var(--accent, var(--gold))"
                        : "var(--color-foreground-muted, var(--color-foreground))",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: 0.85,
                    }}
                  >
                    <Info size={14} strokeWidth={1.5} />
                  </button>
                )}
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
            {headerInfo && headerInfoOpen && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md, 8px)",
                  background: "var(--surface-elevated, var(--surface-card))",
                }}
              >
                {headerInfo}
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
              {...hintAttrs(slimTitle("rank"))}
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
              {...hintAttrs(slimTitle("count"))}
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
                {...hintAttrs(slimTitle("reversed"))}
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
      </div>
    </div>
  );
}
