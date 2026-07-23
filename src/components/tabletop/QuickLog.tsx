/**
 * Q109 Phase 1 — QuickLog.
 *
 * Statistics-driven Manual Entry replacement. Phase 1 builds the
 * SKELETON only: hero card on the left, date pill + smart input on
 * the top right, a dynamically-scaling slot row beneath, and a
 * question textarea + Get Reading button at the bottom. Companions,
 * calendar overlap, pull-history, and pull-resonance arrive in
 * Phases 2-4.
 *
 * The Tabletop scatter is untouched; this only replaces the
 * `ManualEntryBuilder` surface from draw.tsx. Prop signature matches
 * the old builder so the swap is mechanical.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { CalendarIcon, Plus, RotateCw, X } from "lucide-react";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatDateLong } from "@/lib/dates";
import { CardPicker } from "@/components/cards/CardPicker";
import { CardImage } from "@/components/card/CardImage";
import { EntryModeToggle } from "@/components/tabletop/EntryModeToggle";
import {
  SmartCardInput,
  type PasteOutcome,
  type SmartPick,
} from "@/components/tabletop/SmartCardInput";
import { useActiveDeck, useActiveDeckCardName, useActiveDeckCornerRadius } from "@/lib/active-deck";
// EK59 — moon-phase indicators on the grid12 calendar.
import { getPhaseOccurrences } from "@/lib/moon";
import { personalDay } from "@/lib/numerology";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { isoDayInTz } from "@/lib/time";
import { useElementWidth } from "@/lib/use-element-width";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { cn } from "@/lib/utils";
import type { SpreadMode } from "@/lib/spreads";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { useAuth } from "@/lib/auth";
import { fetchUserDecks, fetchDeckCards } from "@/lib/custom-decks";
import { TAROT_DECK } from "@/lib/tarot";
import { buildCardDescriptor, getCardMeta } from "@/lib/card-astrology";
import {
  getQuickLogCardStats,
  getQuickLogOverlap,
  getQuickLogPractice,
  type QuickLogCardStats,
  type QuickLogOverlap,
  type QuickLogPractice,
} from "@/lib/quicklog.functions";
import { useNavigate } from "@tanstack/react-router";
import { useStreak } from "@/lib/use-streak";
import { getLunationContaining } from "@/lib/lunation";
import { useTimezone } from "@/lib/use-timezone";

const HERO_W = 225;
const HERO_H = 346;
const DEFAULT_SLOT_W = 80;
const DEFAULT_GAP = 15;
const GAP_RATIO = DEFAULT_GAP / DEFAULT_SLOT_W; // 0.1875

// Q113 Phase 4 — Constellation state shared with subcomponents.
type ConstellationState = {
  active: boolean;
  participatingCardIds: number[];
  matchingReadings: Array<{
    id: string;
    createdAt: string;
    question: string | null;
    cardIds: number[];
    matched: number[];
  }>;
  matchCount: number;
  matchCountSixMonths: number;
};

type Props = {
  spread: SpreadMode;
  customCount?: number;
  question: string;
  onQuestionChange: (q: string) => void;
  initialPicks?: (ManualPick | null)[];
  onPicksChange?: (p: (ManualPick | null)[]) => void;
  onSwitchToTable?: () => void;
  onCustomCountChange?: (n: number) => void;
  onCancel: () => void;
  onComplete: (picks: ManualPick[], meta?: { createdAt?: string; entryMode?: "manual" }) => void;
};


// ─── Q112 Phase 3 — shared building blocks ───────────────────────────

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function SectionDivider() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: "var(--border-subtle)",
        opacity: 0.5,
        marginBottom: 16,
      }}
    />
  );
}

function SectionOverline({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: 10,
        letterSpacing: "0.3em",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        color: "var(--accent, var(--gold))",
        opacity: 0.75,
        margin: "0 0 12px 0",
        textTransform: "uppercase",
      }}
    >
      {label}
    </p>
  );
}

/**
 * Phase 14 (CZ) — percentage-scaled match opacity. Represents "how much
 * of my current pull appears on this day" with a small 0.15 floor for
 * visibility on tiny matches. Replaces the bucketed version that topped
 * out at 3+ matches and conflated a 3-of-10 day with a 9-of-10 day.
 */
function matchOpacity(matches: number, pullSize: number): number {
  if (matches <= 0 || pullSize <= 0) return 0;
  const pct = matches / pullSize;
  return 0.15 + pct * 0.8;
}

// EG — visual signals computed per day cell. Used by the rich popover
// to render legend lines (gold swatch, accent-tinted swatch, ring,
// dashed ring, teal trace outline) for whichever signals are active
// on this specific cell.
export type DayCellSignals = {
  /** Hero card was drawn on this date. Cell has gold background fill. */
  heroDrawn: boolean;
  /** Hero card name (when heroDrawn). For the legend swatch's label. */
  heroName: string | null;
  /** Number of pull-cards that match this day (1..pullSize, or 0). */
  matchCount: number;
  /** Total pull size (number of slot cards filled). */
  pullSize: number;
  /** 100% match — all pull cards co-occurred on this day. Cell has
   * solid accent ring. */
  isPerfectMatch: boolean;
  /** Best partial match in the calendar but not 100%. Cell has dashed
   * accent ring. */
  isBestAvailable: boolean;
  /** All teal-selected cards co-occurred on this day. Cell has teal
   * trace outline. */
  tealTraceHit: boolean;
};

// ─── EF3 — Pills row, decoupled from OverlapStrip ───────────────────
// ConstellationPage renders this directly under the notes textarea so
// the calendar can sit flush at the top of its own container. Same
// three pills as the legacy absolute bar, same styling.
export function OverlapPills({
  mode,
  onModeChange,
  showOlder,
  onShowOlderChange,
  showOlderToggle = true,
  onSaveToJournal,
  saveStatus = "idle",
  saveError = null,
  saveDisabled = false,
  // EK112 — when the Save button is disabled for a specific reason (e.g. a
  // rank/suit group slot is present), this string shows as the hover tooltip.
  saveDisabledReason,
  saveOnly = false,
  align = "flex-end",
  // v3.50 — optional "Get AI reading" action rendered beside Save to journal.
  onGetAiReading,
  aiDisabled = false,
}: {
  mode: "pull" | "day";
  onModeChange: (m: "pull" | "day") => void;
  showOlder: boolean;
  onShowOlderChange: (next: boolean) => void;
  /** Hide the Show/Hide older toggle when the layout doesn't need it. */
  showOlderToggle?: boolean;
  onSaveToJournal?: () => void;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  saveError?: string | null;
  saveDisabled?: boolean;
  /** EK112 — hover tooltip shown when the button is disabled for a reason. */
  saveDisabledReason?: string;
  /** EK68 — render only the Save button; the mode + older controls now
   *  live in the fly-out menu. */
  saveOnly?: boolean;
  /** flex justify-content for the row. Defaults to flex-end. */
  align?: "flex-start" | "flex-end" | "center" | "space-between";
  /** v3.50 — opens the "Get AI reading" sheet. When omitted, no button. */
  onGetAiReading?: () => void;
  /** v3.50 — disables the AI-reading button (e.g. no concrete spread). */
  aiDisabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        justifyContent: align,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {!saveOnly && showOlderToggle && (
        <button
          type="button"
          onClick={() => onShowOlderChange(!showOlder)}
          style={{
            height: 22,
            padding: "0 12px",
            borderRadius: 9999,
            border: "1px solid var(--border-subtle)",
            background: showOlder
              ? "color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)"
              : "var(--surface-card)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 10,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {showOlder ? "Hide older ←" : "Show older →"}
        </button>
      )}
      {!saveOnly && (
        <div
          role="tablist"
          style={{
            display: "inline-flex",
            height: 22,
            borderRadius: 9999,
            border: "1px solid var(--border-subtle)",
            background: "var(--surface-card)",
            overflow: "hidden",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 10,
          }}
        >
          {(["pull", "day"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onModeChange(m)}
                style={{
                  padding: "0 12px",
                  height: "100%",
                  border: "none",
                  background: active
                    ? "color-mix(in oklab, var(--accent, var(--gold)) 65%, transparent)"
                    : "transparent",
                  color: active
                    ? "var(--color-foreground)"
                    : "var(--color-foreground-muted, var(--color-foreground))",
                  cursor: "pointer",
                }}
              >
                {m === "pull" ? "same spread" : "same day"}
              </button>
            );
          })}
        </div>
      )}
      {onSaveToJournal && (
        <button
          type="button"
          onClick={onSaveToJournal}
          disabled={saveStatus === "saving" || saveDisabled}
          title={
            saveDisabled && saveDisabledReason
              ? saveDisabledReason
              : saveStatus === "error" && saveError
                ? saveError
                : saveStatus === "saved"
                  ? "Saved to journal ✓"
                  : undefined
          }
          style={{
            height: 22,
            padding: "0 12px",
            borderRadius: 9999,
            border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)",
            background:
              saveStatus === "saved"
                ? "color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)"
                : "var(--surface-card)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 10,
            cursor: saveStatus === "saving" || saveDisabled ? "not-allowed" : "pointer",
            opacity: saveStatus === "saving" || saveDisabled ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved ✓"
              : "Save to journal"}
        </button>
      )}
      {onGetAiReading && (
        <button
          type="button"
          onClick={onGetAiReading}
          disabled={aiDisabled}
          title={
            aiDisabled
              ? "Lay a concrete spread to build an AI prompt"
              : "Build a prompt to read this spread in your AI"
          }
          style={{
            height: 22,
            padding: "0 12px",
            borderRadius: 9999,
            border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)",
            background: "var(--surface-card)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 10,
            cursor: aiDisabled ? "not-allowed" : "pointer",
            opacity: aiDisabled ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
        >
          Get AI reading
        </button>
      )}
    </div>
  );
}

type CalendarDayCellProps = {
  day: { date: string; heroDrawn?: boolean };
  layout: "scroll" | "grid12";
  bg: string;
  opacity: number;
  textColor: string;
  displayNumber: ReactNode;
  matchCount: number;
  isPerfectMatch: boolean;
  isBestAvailable: boolean;
  tealTraceHit: boolean;
  hoverStrokeHit: boolean;
  traceColor: string;
  heroName: string;
  effectivePullSize: number;
  tooltipText: string;
  pulseHoverDays: boolean;
  asterismBadgeHovered: boolean;
  dayReadingIds: string[];
  isFullMoon: boolean;
  isNewMoon: boolean;
  /** v3.00 — dims the full-moon disc only (default 1 = unchanged; the lunation
   *  strip passes a lower value; the calendar grid never passes it). */
  fullMoonOpacity?: number;
  /** v3.10 — when true, the cell fills its wrapper height instead of forcing a
   *  square (1:1) aspect. Default false = square (calendar surfaces unchanged);
   *  the lunation strip passes true for its half-height numerology/weekday cells. */
  fillHeight?: boolean;
  /** v3.13 — day-number font size (default 11). The lunation strip passes a
   *  smaller size for half-width split cells so two digits fit without spilling. */
  numberFontSize?: number;
  onDayClick?: (date: string, readingIds: string[]) => void;
  onDayHover?: (info: {
    date: string;
    anchorX: number;
    anchorY: number;
    targetRect: DOMRect | null;
    signals: DayCellSignals;
    tooltipText: string;
  }) => void;
  onDayHoverEnd?: (date: string) => void;
};

/**
 * v2.94 — the calendar day cell, extracted VERBATIM from OverlapStrip so the
 * lunation strip can render the EXACT same cell (gold hero fill, match tints,
 * perfect/best/asterism rings, conditional day number, moon markers, hover +
 * click/long-press). The month grid renders this too; its output is unchanged.
 * The only difference from the inline version: this owns its own long-press
 * refs (one per cell instead of one shared timer — behaviour is identical since
 * only one cell is pressed at a time), and reads moon/reading state via props.
 */
export function CalendarDayCell({
  day,
  layout,
  bg,
  opacity,
  textColor,
  displayNumber,
  matchCount,
  isPerfectMatch,
  isBestAvailable,
  tealTraceHit,
  hoverStrokeHit,
  traceColor,
  heroName,
  effectivePullSize,
  tooltipText,
  pulseHoverDays,
  asterismBadgeHovered,
  dayReadingIds,
  isFullMoon,
  isNewMoon,
  fullMoonOpacity = 1,
  fillHeight = false,
  numberFontSize = 11,
  onDayClick,
  onDayHover,
  onDayHoverEnd,
}: CalendarDayCellProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const clickable = !!onDayClick && dayReadingIds.length > 0;
  return (
    <div
      title={onDayHover ? undefined : tooltipText}
      onMouseEnter={
        onDayHover
          ? (e) => {
              const rect = (
                e.currentTarget as HTMLDivElement
              ).getBoundingClientRect();
              onDayHover({
                date: day.date,
                anchorX: e.clientX,
                anchorY: e.clientY,
                targetRect: rect,
                signals: {
                  heroDrawn: !!day.heroDrawn,
                  heroName,
                  matchCount,
                  pullSize: effectivePullSize,
                  isPerfectMatch,
                  isBestAvailable,
                  tealTraceHit,
                },
                tooltipText,
              });
            }
          : undefined
      }
      onMouseLeave={onDayHoverEnd ? () => onDayHoverEnd(day.date) : undefined}
      onPointerDown={
        onDayHover
          ? (e) => {
              if (e.pointerType !== "touch") return;
              longPressFiredRef.current = false;
              if (longPressTimerRef.current !== null) {
                window.clearTimeout(longPressTimerRef.current);
              }
              const startX = e.clientX;
              const startY = e.clientY;
              const startRect = (
                e.currentTarget as HTMLDivElement
              ).getBoundingClientRect();
              longPressTimerRef.current = window.setTimeout(() => {
                longPressFiredRef.current = true;
                onDayHover({
                  date: day.date,
                  anchorX: startX,
                  anchorY: startY,
                  targetRect: startRect,
                  signals: {
                    heroDrawn: !!day.heroDrawn,
                    heroName,
                    matchCount,
                    pullSize: effectivePullSize,
                    isPerfectMatch,
                    isBestAvailable,
                    tealTraceHit,
                  },
                  tooltipText,
                });
              }, 500);
            }
          : undefined
      }
      onPointerUp={
        onDayHover
          ? () => {
              if (longPressTimerRef.current !== null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }
          : undefined
      }
      onPointerCancel={
        onDayHover
          ? () => {
              if (longPressTimerRef.current !== null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }
          : undefined
      }
      style={{
        position: "relative",
        ...(layout === "grid12"
          ? fillHeight
            ? { width: "100%", height: "100%" }
            : { width: "100%", aspectRatio: "1 / 1" }
          : { width: 20, height: 20 }),
        ...(pulseHoverDays &&
        (asterismBadgeHovered ? tealTraceHit : hoverStrokeHit)
          ? {
              animation: "tarotseed-day-pulse 1.4s ease-in-out infinite",
            }
          : null),
      }}
    >
      {(() => {
        const inner = null;
        const shared = {
          width: "100%",
          height: "100%",
          borderRadius: 3,
          background: bg,
          opacity,
          border:
            "1px solid color-mix(in oklab, var(--color-foreground) 12%, transparent)",
          boxSizing: "border-box" as const,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-start",
          padding: "0 0 1px 2px",
          fontFamily: "var(--font-serif)",
          fontSize: 11,
          fontStyle: "italic",
          lineHeight: 1,
          color: textColor,
        };
        if (clickable) {
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDayClick?.(day.date, dayReadingIds);
              }}
              aria-label={`Show ${dayReadingIds.length} readings on ${day.date}`}
              style={{
                ...shared,
                cursor: "pointer",
              }}
            >
              {inner}
            </button>
          );
        }
        return <div style={shared}>{inner}</div>;
      })()}
      {(day.heroDrawn ||
        matchCount > 0 ||
        tealTraceHit ||
        hoverStrokeHit) && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-start",
            padding: "0 0 1px 2px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: numberFontSize,
            lineHeight: 1,
            color: textColor,
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {displayNumber}
        </div>
      )}
      {(() => {
        const rings: {
          thickness: number;
          style: string;
          color: string;
        }[] = [];
        if (isPerfectMatch) {
          rings.push({
            thickness: 3,
            style: "solid",
            color: "var(--accent, var(--gold))",
          });
        } else if (isBestAvailable) {
          rings.push({
            thickness: 2.5,
            style: "dashed",
            color: "var(--accent, var(--gold))",
          });
        }
        if (tealTraceHit) {
          rings.push({
            thickness: 3,
            style: "solid",
            color: traceColor,
          });
        }
        let off = 0;
        return rings.map((r, i) => {
          const node = (
            <div
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                inset: off,
                borderRadius: Math.max(2, 3 - off),
                border: `${r.thickness}px ${r.style} ${r.color}`,
                boxSizing: "border-box" as const,
                pointerEvents: "none",
                zIndex: 3,
              }}
            />
          );
          off += r.thickness;
          return node;
        });
      })()}
      {layout === "grid12" && isFullMoon && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            width: 10,
            height: 10,
            opacity: fullMoonOpacity,
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          <MoonPhaseIcon phase="Full Moon" size={10} />
        </div>
      )}
      {layout === "grid12" && isNewMoon && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            width: 10,
            height: 10,
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          <MoonPhaseIcon phase="New Moon" size={10} />
        </div>
      )}
    </div>
  );
}

export function OverlapStrip({
  overlap,
  heroCardId,
  pullCardIds,
  // EK112 — atlas group slots: each entry is the member-id list of a
  // rank/suit slot dropped into the slot row. A group counts as ONE slot,
  // satisfied on a day/pull if ANY member appeared. The regular page never
  // passes this, so its slot-row match is unchanged.
  pullGroups = [],
  // EK113/EK115 — atlas moon group slots: each entry is the set of marked
  // full/new moon DAY keys for that slot (the days the calendar icons mark).
  // Counts as one slot, satisfied when the day is one of those marked days.
  pullMoonGroups = [],
  mode,
  onModeChange,
  // EK133 — when false, OverlapStrip drops its internal same-spread/same-day
  // pill (the atlas surface lifts it up into the left controls column).
  showModeToggle = true,
  tealSelectedIds = [],
  // EK106 — atlas group mode supplies a precomputed set of matching day
  // keys (YYYY-MM-DD). When present it OVERRIDES the per-card tealSet
  // match below, so the stroke reflects the full group asterism (cards +
  // suit groups). The regular page never passes this, so its path is
  // untouched.
  asterismYmds,
  // EK108 — atlas chip-hover preview: extra day keys to stroke transiently
  // while a rank/suit chip is hovered. Unioned with the committed stroke.
  previewYmds,
  // EC — read from --trace-color CSS variable so per-theme overrides
  // (Cups Tide, Pentacles & Moss) flow through automatically. Default
  // to the canonical teal hex when no theme override is set.
  traceColor = "var(--trace-color, #5cead4)",
  layout = "scroll",
  onDayClick,
  // EF2 — Save-to-Journal pill, optional. When `onSaveToJournal` is
  // provided, OverlapStrip renders a third pill in its top-right bar
  // alongside Hide older + Same pull/Same day. ConstellationPage moves
  // its Save button up here so all three primary toggles sit on one
  // row above the calendar.
  onSaveToJournal,
  saveStatus,
  saveError,
  saveDisabled = false,
  // EF3 — externally-controlled showOlder. When `onShowOlderChange` is
  // provided, the parent owns the toggle state and renders its own
  // pill row (via <OverlapPills>); OverlapStrip drops the absolute
  // pill bar and reads showOlder from the prop. When neither is
  // provided, OverlapStrip falls back to internal state + renders the
  // legacy absolute pill bar (used by /draw/classic QuickLog).
  showOlder: showOlderProp,
  onShowOlderChange,
  // EG — optional rich-popover hover/long-press callbacks. When wired,
  // OverlapStrip emits per-cell hover events with the cell's date,
  // anchor coords, and computed visual signals; the parent renders the
  // popover. The legacy native title="" tooltip is suppressed when
  // these are provided.
  onDayHover,
  onDayHoverEnd,
  asterismBadgeHovered = false,
  // EK57 — Set of YYYY-MM-DD days to stroke in traceColor while a
  // constellation card is hovered (the hovered card's drawn days).
  // Additive to the teal-selection trace; defaults to none.
  hoverStrokeYmds,
  pulseHoverDays = true,
  // EK58 — grid12 month count override. When provided, the calendar
  // shows this many months (most recent first). Defaults to the legacy
  // fixed 12. Drives the responsive "months follow the time-range"
  // behavior; ≤6 collapses to a single row automatically (the grid is
  // 6 columns, so ≤6 cells = one row).
  monthsToShow: monthsToShowProp,
  // v2.27 — when true (and no card hero), fills every day that has any
  // reading so the no-hero Insights Calendar tab shows draw activity.
  markReadingDays = false,
  // v3.26 — grid12 month-column count. Default 6 (draw table + Insights
  // unchanged); /lunations passes 3 for a real 3-across month grid.
  gridCols = 6,
  // EK68 — calendar number mode + birthdate for the numerology display.
  calendarNumberMode = "dates",
  birthDate = null,
}: {
  overlap: QuickLogOverlap | null;
  heroCardId: number | null;
  pullCardIds: number[];
  /** EK112 — atlas group slots; each is the member-id list of a rank/suit
   *  slot. Counts as one slot, satisfied if any member appears. */
  pullGroups?: number[][];
  /** EK113/EK115 — atlas moon group slots; each is the set of marked
   *  full/new moon day keys. Counts as one slot, satisfied when the day is
   *  one of those marked days. */
  pullMoonGroups?: Set<string>[];
  mode: "pull" | "day";
  onModeChange: (m: "pull" | "day") => void;
  /** Phase 24 — when non-empty, mark every day where ALL teal-selected cards
   * appeared together (per the same-pull/same-day mode) with a stroke in
   * traceColor. Optional; defaults to empty (no trace overlay). */
  tealSelectedIds?: number[];
  /** EK106 — atlas group mode: precomputed matching day keys that
   *  override the per-card tealSet match. Undefined on the regular page. */
  asterismYmds?: Set<string>;
  /** EK108 — atlas chip-hover preview day keys, unioned with the stroke. */
  previewYmds?: Set<string>;
  traceColor?: string;
  /** DP — "scroll" (default) renders the legacy horizontal-scroll strip used
   * by QuickLog at /draw/classic. "grid12" renders a 12-month two-row × six-
   * column grid used by Manual Entry on /constellation. */
  layout?: "scroll" | "grid12";
  /** DZ — when provided, day cells with at least one reading become
   * clickable. Caller receives the day's YYYY-MM-DD date and the list of
   * readings on that day. */
  onDayClick?: (date: string, readingIds: string[]) => void;
  /** EF2 — optional save-to-journal pill in the top-right bar. */
  onSaveToJournal?: () => void;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  saveError?: string | null;
  saveDisabled?: boolean;
  /** EF3 — externally-controlled showOlder. */
  showOlder?: boolean;
  onShowOlderChange?: (next: boolean) => void;
  /** EG — emit a hover event for a day cell, with computed visual
   * signals so the parent can drive a rich popover. EJ28 —
   * targetRect is the cell's bounding rect, used by the parent to
   * position the popover with preferred-placement (above the cell)
   * instead of the cursor-anchored fallback. Without this, the
   * popover renders at cursorY + 8 which falls INSIDE the 20px-tall
   * day cell and intercepts clicks. */
  onDayHover?: (info: {
    date: string;
    anchorX: number;
    anchorY: number;
    targetRect: DOMRect | null;
    signals: DayCellSignals;
    tooltipText: string;
  }) => void;
  /** EG — emit when the cursor leaves the cell. */
  onDayHoverEnd?: (date: string) => void;
  /** EJ25 — when true (set by the parent on asterism badge hover),
   *  every qualifying co-occurrence day swaps its fill from the gold
   *  heatmap to solid trace color, completely overriding the heatmap
   *  so the seeker sees the asterism's days at 100% visibility. */
  asterismBadgeHovered?: boolean;
  /** EK57 — days (YYYY-MM-DD) drawn on by the currently-hovered
   *  constellation card. Stroked in traceColor, additive to the teal
   *  trace. Optional; absent = no hover stroke. */
  hoverStrokeYmds?: Set<string>;
  /** EK93 — when true (default), the hovered card/line's calendar days pulse
   *  the whole cell 20%↔100%. Toggled off from the manual-entry hamburger. */
  pulseHoverDays?: boolean;
  /** EK58 — number of (most-recent) months to show in the grid12
   *  calendar. Optional; absent = legacy fixed 12. */
  monthsToShow?: number;
  /** v2.27 — fill days that have any reading (used by the no-hero Calendar tab). */
  markReadingDays?: boolean;
  /** v3.26 — grid12 month-column count. Default 6. */
  gridCols?: number;
  calendarNumberMode?: "dates" | "numerology";
  birthDate?: string | null;
  /** EJ65 — accepted for API symmetry with <OverlapPills/>. OverlapStrip
   *  in controlled mode does not render the legacy inline Show-older pill,
   *  so this prop is currently a no-op here; kept so ConstellationPage can
   *  pass the same flag through without a type error. */
  showOlderToggle?: boolean;
  /** EK133 — hide the internal same-spread/same-day pill (atlas lifts it). */
  showModeToggle?: boolean;
}) {
  // EJ35 — resolver for oracle card_ids in day-cell tooltips that
  // surface matched-card lists.
  const resolveCardName = useActiveDeckCardName();
  const months = overlap?.months ?? [];
  const pullSet = useMemo(() => new Set(pullCardIds), [pullCardIds]);
  // EK112 — group slots as sets; one satisfied slot if any member appears.
  const pullGroupSets = useMemo(
    () => pullGroups.map((g) => new Set(g)),
    [pullGroups],
  );
  // Effective pull size = concrete cards + card groups + moon groups. Drives
  // the accent-tint denominator and the perfect/best-available rings.
  const effectivePullSize =
    pullSet.size + pullGroupSets.length + pullMoonGroups.length;
  // Count satisfied slots on a given day, per the active mode. A concrete
  // card counts when present; a card group counts when ANY member is present;
  // a moon group counts when a reading under that phase exists. In pull mode
  // we take the best single reading.
  const countDayMatches = (day: {
    date: string;
    sameDayCardIds?: number[];
  }): number => {
    if (effectivePullSize === 0) return 0;
    // EK115 — moon groups are satisfied when this calendar day is one of the
    // group's marked full/new moon days (independent of cards/readings).
    let moonHits = 0;
    for (const days of pullMoonGroups) if (days.has(day.date)) moonHits++;
    const tally = (ids: Set<number>): number => {
      let n = moonHits;
      for (const id of pullSet) if (ids.has(id)) n++;
      for (const g of pullGroupSets) {
        for (const id of g) {
          if (ids.has(id)) {
            n++;
            break;
          }
        }
      }
      return n;
    };
    const readings = overlap?.readingsByDate?.[day.date] ?? [];
    if (mode === "day") {
      return tally(new Set(day.sameDayCardIds ?? []));
    }
    // Pull-level: best single reading (its own cards) + day-level moon hits.
    let best = moonHits;
    for (const r of readings) {
      const n = tally(new Set(r.cardIds));
      if (n > best) best = n;
    }
    return best;
  };
  const tealSet = useMemo(() => new Set(tealSelectedIds), [tealSelectedIds]);
  // EG — long-press tracking for touch devices. Pointerdown starts a
  // 500ms timer; if pointerup fires before, it's a tap (let
  // onDayClick handle it). If the timer fires, it's a long press;
  // fire onDayHover with the cell's data.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const now = new Date();
  // eslint-disable-next-line no-restricted-syntax -- compared against m.year/m.month already-tz-resolved server-side; calendar-month keying
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

  // Phase 12 — iPad month gating: 6 months on desktop (≥1280px),
  // 5 months on viewports below that (iPad Air/Pro 11", smaller
  // laptops in landscape). rAF-throttled so resize doesn't thrash.
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf: number | null = null;
    const handle = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setViewportWidth(window.innerWidth);
        raf = null;
      });
    };
    window.addEventListener("resize", handle);
    window.addEventListener("orientationchange", handle);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener("resize", handle);
      window.removeEventListener("orientationchange", handle);
    };
  }, []);
  const monthsToShow =
    monthsToShowProp ?? (layout === "grid12" ? 12 : viewportWidth >= 1280 ? 6 : 5);

  // EK59 — Full-/new-moon day sets for the grid12 calendar. getPhaseOccurrences
  // searches forward, so anchor ~13 months back and span ~15 months to cover
  // the whole visible 12-month window plus edges. Keys are UTC yyyy-mm-dd to
  // match the calendar's day cells (which are stored UTC). Computed once —
  // moon phases don't change within a session.
  const moonDayYmds = useMemo(() => {
    const full = new Set<string>();
    const nw = new Set<string>();
    if (layout !== "grid12") return { full, nw };
    const DAY_MS = 86400000;
    const from = new Date(Date.now() - 13 * 30 * DAY_MS);
    for (const d of getPhaseOccurrences("Full Moon", from, 15)) full.add(isoDayInTz(d, "UTC"));
    for (const d of getPhaseOccurrences("New Moon", from, 15)) nw.add(isoDayInTz(d, "UTC"));
    return { full, nw };
  }, [layout]);

  // DU — for grid12 layout, the top row (older 6 months) can be collapsed.
  // DW — default COLLAPSED so the recent 6 months are visible above the
  // fold; tap "Show older →" to reveal the older row.
  // EF3 — if `showOlderProp` + `onShowOlderChange` are provided, the
  // parent owns this state; otherwise fall back to local state.
  const [showOlderLocal, setShowOlderLocal] = useState(false);
  const isControlled = onShowOlderChange !== undefined;
  const showOlder = isControlled ? !!showOlderProp : showOlderLocal;
  const setShowOlder = (next: boolean) => {
    if (isControlled) onShowOlderChange?.(next);
    else setShowOlderLocal(next);
  };

  // Phase 14 (CZ) — calendar-wide max match for the "best available" dashed
  // ring. Only meaningful when more than one card is pulled; with a single
  // card every match would tie at max and ring every cell.
  let maxMatchInCalendar = 0;
  if (effectivePullSize > 1) {
    for (const m of months) {
      for (const day of m.days) {
        if (day == null) continue;
        const matches = countDayMatches(day);
        if (matches > maxMatchInCalendar) maxMatchInCalendar = matches;
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* EF3 — Legacy absolute pill bar. Rendered ONLY when uncontrolled
          (no `onShowOlderChange` prop). When controlled, the parent owns
          the pills and renders them via <OverlapPills/> wherever it
          wants (e.g. under the notes textarea in ConstellationPage). */}
      {!isControlled && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 8,
            zIndex: 3,
            display: "flex",
            gap: 6,
          }}
        >
          {layout === "grid12" && (
            <button
              type="button"
              onClick={() => setShowOlder(!showOlder)}
              style={{
                height: 22,
                padding: "0 12px",
                borderRadius: 9999,
                border: "1px solid var(--border-subtle)",
                background: showOlder
                  ? "color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)"
                  : "var(--surface-card)",
                color: "var(--color-foreground)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 10,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {showOlder ? "Hide older ←" : "Show older →"}
            </button>
          )}
          {showModeToggle && (
          <div
            role="tablist"
            style={{
              display: "inline-flex",
              height: 22,
              borderRadius: 9999,
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              overflow: "hidden",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 10,
            }}
          >
            {(["pull", "day"] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onModeChange(m)}
                  style={{
                    padding: "0 12px",
                    height: "100%",
                    border: "none",
                    background: active
                      ? "color-mix(in oklab, var(--accent, var(--gold)) 65%, transparent)"
                      : "transparent",
                    color: active
                      ? "var(--color-foreground)"
                      : "var(--color-foreground-muted, var(--color-foreground))",
                    cursor: "pointer",
                  }}
                >
                  {m === "pull" ? "same spread" : "same day"}
                </button>
              );
            })}
          </div>
          )}
          {/* EF2 — Save to journal pill, optional. Same height/font-size
            as the other pills so all three look consistent in the row.
            Rendered only when onSaveToJournal is provided. */}
          {onSaveToJournal && (
            <button
              type="button"
              onClick={onSaveToJournal}
              disabled={saveStatus === "saving" || saveDisabled}
              title={
                saveStatus === "error" && saveError
                  ? saveError
                  : saveStatus === "saved"
                    ? "Saved to journal ✓"
                    : undefined
              }
              style={{
                height: 22,
                padding: "0 12px",
                borderRadius: 9999,
                border:
                  "1px solid color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)",
                background:
                  saveStatus === "saved"
                    ? "color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)"
                    : "var(--surface-card)",
                color: "var(--color-foreground)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 10,
                cursor: saveStatus === "saving" || saveDisabled ? "not-allowed" : "pointer",
                opacity: saveStatus === "saving" || saveDisabled ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                  ? "Saved ✓"
                  : "Save to journal"}
            </button>
          )}
        </div>
      )}
      <div
        style={
          layout === "grid12"
            ? {
                // EF3 — Reserve top space only when the absolute pill bar
                // is rendered (uncontrolled mode). When controlled, the
                // pills live outside this component, so the calendar
                // can sit flush at the top.
                paddingTop: isControlled ? 0 : 26,
                display: "grid",
                gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                gridAutoRows: "auto",
                gap: 8,
                alignItems: "start",
                position: "relative",
                width: "100%",
              }
            : {
                paddingTop: 16,
                display: "flex",
                flexDirection: "row",
                gap: 12,
                alignItems: "flex-start",
                position: "relative",
                overflowX: "auto",
                scrollbarGutter: "stable",
              }
        }
      >
        {months.length === 0 &&
          Array.from({
            length: layout === "grid12" && !showOlder ? Math.min(6, monthsToShow) : monthsToShow,
          }).map((_, i) => (
            <div key={i} style={layout === "grid12" ? { width: "100%" } : { width: 188 }}>
              <div
                style={{
                  height: 16,
                  width: 80,
                  background: "var(--border-subtle)",
                  opacity: 0.3,
                  marginBottom: 6,
                  borderRadius: 3,
                }}
              />
              <div
                style={
                  layout === "grid12"
                    ? {
                        width: "100%",
                        height: 132,
                        background: "var(--surface-card)",
                        borderRadius: 6,
                      }
                    : {
                        width: 188,
                        height: 192,
                        background: "var(--surface-card)",
                        borderRadius: 6,
                      }
                }
              />
            </div>
          ))}
        {months
          .slice(-(layout === "grid12" && !showOlder ? Math.min(6, monthsToShow) : monthsToShow))
          .map((m) => {
            const isCurrent = `${m.year}-${m.month}` === currentMonthKey;
            // eslint-disable-next-line no-restricted-syntax -- intrinsic Gregorian month-grid: day-of-week of the 1st of m.year/m.month
            const firstDow = new Date(m.year, m.month - 1, 1).getDay();
            return (
              <div
                key={`${m.year}-${m.month}`}
                style={
                  layout === "grid12"
                    ? { width: "100%", minWidth: 0 }
                    : { width: 188, flexShrink: 0 }
                }
              >
                <p
                  style={{
                    margin: "0 0 3px 0",
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 12,
                    textAlign: "left",
                    color: isCurrent
                      ? "var(--accent, var(--gold))"
                      : "var(--color-foreground-muted, var(--color-foreground))",
                    opacity: isCurrent ? 0.95 : 0.7,
                  }}
                >
                  {MONTH_NAMES[m.month - 1]}
                </p>
                <div
                  style={
                    layout === "grid12"
                      ? {
                          width: "100%",
                          background: "var(--surface-card)",
                          borderRadius: 6,
                          padding: 7,
                          boxSizing: "border-box",
                          display: "grid",
                          gridTemplateColumns: "repeat(7, 1fr)",
                          gap: 3,
                          justifyContent: "center",
                          alignContent: "start",
                        }
                      : {
                          width: 188,
                          minHeight: 192,
                          background: "var(--surface-card)",
                          borderRadius: 6,
                          padding: 6,
                          boxSizing: "border-box",
                          display: "grid",
                          gridTemplateColumns: "repeat(7, 20px)",
                          gridAutoRows: "20px",
                          gap: 6,
                          justifyContent: "center",
                          alignContent: "start",
                        }
                  }
                >
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {m.days.map((day) => {
                    let bg = "var(--color-foreground)";
                    let opacity = 0.18;
                    // Phase 20 Fix 9 — ALWAYS compute matchCount when there is a
                    // pull, regardless of heroDrawn. Previously a heroDrawn
                    // short-circuit left matchCount=0, suppressing the perfect-
                    // match ring even when all pulled cards were on this day.
                    let matchCount = 0;
                    if (effectivePullSize > 0) {
                      matchCount = countDayMatches(day);
                    }
                    // Apply visual on top of matchCount.
                    if (day.heroDrawn && heroCardId != null) {
                      bg = "var(--gold, var(--accent))";
                      opacity = 0.9;
                    } else if (matchCount > 0) {
                      const op = matchOpacity(matchCount, effectivePullSize);
                      if (op > 0) {
                        bg = "var(--accent, var(--gold))";
                        opacity = op;
                      }
                    } else if (markReadingDays) {
                      // v2.27 — no hero: light up any day that has a reading.
                      if ((overlap?.readingsByDate?.[day.date]?.length ?? 0) > 0) {
                        bg = "var(--accent, var(--gold))";
                        opacity = 0.4;
                      }
                    }
                    // EC — readability fix for saturated themes. Previously
                    // the text only flipped to background color when opacity
                    // crossed 0.5, but cool/cyan themes (Cups Tide) have
                    // foreground colors that blend into low-opacity accent
                    // fills. Strategy:
                    //   - Hero gold-fill day (opacity 0.9, gold bg): text
                    //     is dark (the foreground variable that gets used
                    //     for accent-on-gold contrast).
                    //   - ANY accent-tinted day (matchCount > 0): text
                    //     uses --accent-foreground, which every theme
                    //     defines as the color that legibly sits on its
                    //     own accent (theme-known contrast pair). This
                    //     fixes Cups Tide where 41% cyan-on-cyan-bg
                    //     previously hid the day number.
                    //   - Neutral day: regular foreground.
                    let textColor: string;
                    if (day.heroDrawn && heroCardId != null) {
                      textColor = "var(--background)";
                    } else if (matchCount > 0) {
                      textColor = "var(--accent-foreground, var(--background))";
                    } else if (
                      markReadingDays &&
                      (overlap?.readingsByDate?.[day.date]?.length ?? 0) > 0
                    ) {
                      textColor = "var(--accent-foreground, var(--background))";
                    } else {
                      textColor = "var(--color-foreground)";
                    }
                    // Phase 24 — teal trace: this day qualifies if ALL teal-
                    // selected cards appeared together per the current mode.
                    // EK106 — in atlas group mode the parent supplies the
                    // matching day keys directly (group-aware), overriding
                    // the per-card computation.
                    let tealTraceHit = false;
                    if (asterismYmds) {
                      tealTraceHit = asterismYmds.has(day.date);
                    } else if (tealSet.size > 0) {
                      if (mode === "day") {
                        const sameDaySet = new Set(day.sameDayCardIds);
                        let ok = true;
                        for (const id of tealSet) {
                          if (!sameDaySet.has(id)) {
                            ok = false;
                            break;
                          }
                        }
                        tealTraceHit = ok;
                      } else {
                        const readings = overlap?.readingsByDate?.[day.date] ?? [];
                        for (const r of readings) {
                          const ids = new Set(r.cardIds);
                          let ok = true;
                          for (const id of tealSet) {
                            if (!ids.has(id)) {
                              ok = false;
                              break;
                            }
                          }
                          if (ok) {
                            tealTraceHit = true;
                            break;
                          }
                        }
                      }
                    }
                    // EK108 — chip-hover preview adds its days on top of
                    // whatever's committed.
                    if (previewYmds?.has(day.date)) tealTraceHit = true;
                    // EJ25 — asterism badge hover override. When the parent
                    // signals the asterism badge is being hovered, every
                    // qualifying day-cell (tealTraceHit) swaps to solid
                    // trace color, completely overriding the gold heatmap
                    // and accent-tinted fills. This makes the asterism's
                    // qualifying days unmistakable at 100% visibility.
                    // Text color flips to background so the digit stays
                    // legible on the solid trace fill.
                    if (asterismBadgeHovered && tealTraceHit) {
                      bg = traceColor;
                      opacity = 1;
                      textColor = "var(--background)";
                    }
                    // EK57 — hover stroke: stroke this day if the
                    // currently-hovered constellation card was drawn on
                    // it. Independent of teal selection.
                    const hoverStrokeHit = hoverStrokeYmds?.has(day.date) ?? false;
                    // EK60 — require 2+ cards in the slots. With a single
                    // card every hero day trivially "perfectly matches"
                    // (matchCount 1 === pullSet.size 1), ringing every
                    // gold-badge day for no meaning. Rings need a real
                    // multi-card pull to compare against.
                    const isPerfectMatch =
                      matchCount > 0 &&
                      matchCount === effectivePullSize &&
                      effectivePullSize >= 2;
                    const isBestAvailable =
                      !isPerfectMatch &&
                      // EK58 — a stroke means "2+ of your spread cards
                      // landed here," not "least-bad day." When the best
                      // any day can do is 1 of N, no dashed rings show.
                      matchCount >= 2 &&
                      matchCount === maxMatchInCalendar &&
                      effectivePullSize > 1;
                    const dateLabel = formatDateLong(`${day.date}T00:00:00`);
                    // EK68 — numerology mode shows the seeker's personal day
                    // number on every cell; otherwise the day of the month.
                    const dpParts = day.date.split("-");
                    const displayNumber =
                      calendarNumberMode === "numerology" && birthDate
                        ? personalDay(
                            birthDate,
                            Number(dpParts[0]),
                            Number(dpParts[1]),
                            Number(dpParts[2]),
                          ).digit
                        : Number(dpParts[2]);
                    const heroName = heroCardId != null ? resolveCardName(heroCardId) : "";
                    // EJ10 — stacked tooltip lines, replacing the prior
                    // flat "X% Match · Y of N of these cards were drawn
                    // on date" sentence. Each active signal becomes its
                    // own line in the rich popover:
                    //   line 1 — date header (always)
                    //   line 2 — hero day fact (when day.heroDrawn)
                    //   line 3 — spread match fact (when matchCount > 0)
                    //   line 4 — asterism fact (when tealTraceHit)
                    // Joined with newlines; the popover renders them as
                    // separate lines via whiteSpace: pre-line. Native
                    // title="" fallback (legacy /draw/classic) renders
                    // the newlines too in modern browsers.
                    const dayDrawNames = (
                      overlap?.readingsByDate?.[day.date] ?? []
                    )
                      .map((r) => r.spreadName)
                      .filter((n): n is string => !!n && n.trim().length > 0);
                    const lines: string[] = [...dayDrawNames, dateLabel];
                    if (day.heroDrawn && heroCardId != null) {
                      lines.push(`You drew ${heroName} here.`);
                    }
                    if (matchCount > 0) {
                      if (isPerfectMatch) {
                        lines.push(
                          `Your full spread (all ${pullCardIds.length} cards) was drawn here.`,
                        );
                      } else if (isBestAvailable) {
                        lines.push(
                          `${matchCount} of ${pullCardIds.length} cards in your spread were drawn here — the best match in your calendar.`,
                        );
                      } else {
                        lines.push(
                          `${matchCount} of ${pullCardIds.length} cards in your spread were drawn here.`,
                        );
                      }
                    }
                    if (tealTraceHit && tealSet.size >= 2) {
                      const starWord = tealSet.size === 1 ? "star" : "stars";
                      lines.push(`Your asterism (${tealSet.size} ${starWord}) all met here.`);
                    }
                    const tooltipText = lines.join("\n");
                    return (
                      <CalendarDayCell
                        key={day.date}
                        day={day}
                        layout={layout}
                        bg={bg}
                        opacity={opacity}
                        textColor={textColor}
                        displayNumber={displayNumber}
                        matchCount={matchCount}
                        isPerfectMatch={isPerfectMatch}
                        isBestAvailable={isBestAvailable}
                        tealTraceHit={tealTraceHit}
                        hoverStrokeHit={hoverStrokeHit}
                        traceColor={traceColor}
                        heroName={heroName}
                        effectivePullSize={effectivePullSize}
                        tooltipText={tooltipText}
                        pulseHoverDays={pulseHoverDays}
                        asterismBadgeHovered={asterismBadgeHovered}
                        dayReadingIds={(overlap?.readingsByDate?.[day.date] ?? []).map((r) => r.id)}
                        isFullMoon={moonDayYmds.full.has(day.date)}
                        isNewMoon={moonDayYmds.nw.has(day.date)}
                        onDayClick={onDayClick}
                        onDayHover={onDayHover}
                        onDayHoverEnd={onDayHoverEnd}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
      <div style={{ height: 16 }} />
    </div>
  );
}

function Tile({ label, value, subline }: { label: string; value: string; subline: string }) {
  return (
    <div
      style={{
        flex: 1,
        height: 72,
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxSizing: "border-box",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.15em",
          color: "var(--accent, var(--gold))",
          opacity: 0.7,
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 15,
          color: "var(--color-foreground)",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--color-foreground-muted, var(--color-foreground))",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {subline}
      </span>
    </div>
  );
}

function ThisPullTiles({ picks }: { picks: ManualPick[] }) {
  // EJ35 — resolver for consistency. ThisPullTiles only ever surfaces
  // tarot card_ids today (its filtering chain excludes oracle picks
  // via getCardMeta), but routing through the resolver keeps the
  // contract identical to every other naming site.
  const resolveCardName = useActiveDeckCardName();
  const metas = picks
    .map((p) => ({ pick: p, meta: getCardMeta(p.cardIndex) }))
    .filter((x) => x.meta != null) as Array<{
    pick: ManualPick;
    meta: NonNullable<ReturnType<typeof getCardMeta>>;
  }>;

  // Tile 1 — Major / Minor
  const total = metas.length;
  const majors = metas.filter((m) => m.meta.suit === null).length;
  const cups = metas.filter((m) => m.meta.suit === "Cups").length;
  const pents = metas.filter((m) => m.meta.suit === "Pentacles").length;
  const swords = metas.filter((m) => m.meta.suit === "Swords").length;
  const wands = metas.filter((m) => m.meta.suit === "Wands").length;
  const pctMajor = total > 0 ? Math.round((majors / total) * 100) : 0;
  const suitParts: string[] = [`${majors} Majors`];
  if (cups) suitParts.push(`${cups} Cups`);
  if (pents) suitParts.push(`${pents} Pents`);
  if (swords) suitParts.push(`${swords} Swords`);
  if (wands) suitParts.push(`${wands} Wands`);

  // Tile 2 — Numerology
  const roots = metas.filter((m) => m.meta.root != null);
  const rootCounts = new Map<number, ManualPick[]>();
  for (const m of roots) {
    const r = m.meta.root as number;
    const arr = rootCounts.get(r) ?? [];
    arr.push(m.pick);
    rootCounts.set(r, arr);
  }
  let dominantRoot: number | null = null;
  let dominantN = 0;
  for (const [r, arr] of rootCounts) {
    if (
      arr.length > dominantN ||
      (arr.length === dominantN && (dominantRoot == null || r < dominantRoot))
    ) {
      dominantRoot = r;
      dominantN = arr.length;
    }
  }
  let numerologyValue = "—";
  let numerologySub = "";
  if (dominantRoot != null) {
    numerologyValue = `${dominantN} of ${roots.length} reduce to ${dominantRoot}`;
    if (dominantN === 1 && roots.length === 1) {
      numerologyValue = `1 of 1 reduces to ${dominantRoot}`;
    }
    const names = (rootCounts.get(dominantRoot) ?? []).map((p) => resolveCardName(p.cardIndex));
    numerologySub = names.length > 3 ? `${names.slice(0, 3).join(", ")}…` : names.join(", ");
  }

  // Tile 3 — Astrology · Reversed
  const rulers = metas.filter((m) => m.meta.planetOrSign != null);
  const ruleCounts = new Map<string, number>();
  for (const m of rulers) {
    const k = m.meta.planetOrSign as string;
    ruleCounts.set(k, (ruleCounts.get(k) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let dominantCount = 0;
  for (const [k, n] of ruleCounts) {
    if (n > dominantCount) {
      dominant = k;
      dominantCount = n;
    }
  }
  const reversedN = picks.filter((p) => p.isReversed).length;
  const reversedPct = picks.length > 0 ? Math.round((reversedN / picks.length) * 100) : 0;
  const astrologyValue = `${dominant ?? "—"}-dom · ${reversedPct}% rev`;
  const elCounts: Record<string, number> = {
    Fire: 0,
    Water: 0,
    Air: 0,
    Earth: 0,
  };
  for (const m of metas) elCounts[m.meta.element]++;
  const elParts: string[] = [];
  (["Fire", "Earth", "Water", "Air"] as const).forEach((el) => {
    if (elCounts[el] > 0) elParts.push(`${elCounts[el]} ${el}`);
    else if (metas.length >= 3) elParts.push(`no ${el}`);
  });

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Tile
        label="MAJOR / MINOR"
        value={total > 0 ? `${pctMajor}% Major Arcana` : "—"}
        subline={suitParts.join(" · ")}
      />
      <Tile label="NUMEROLOGY" value={numerologyValue} subline={numerologySub} />
      <Tile label="ASTROLOGY · REVERSED" value={astrologyValue} subline={elParts.join(" · ")} />
    </div>
  );
}

function PullHistoryPill({
  picks,
  practice,
  constellation,
}: {
  picks: ManualPick[];
  practice: QuickLogPractice | null;
  constellation: ConstellationState;
}) {
  const key = useMemo(
    () =>
      picks
        .map((p) => p.cardIndex)
        .sort((a, b) => a - b)
        .join(","),
    [picks],
  );
  const entry = practice?.pullHistory?.find((p) => p.cardIdsKey === key) ?? null;
  let text = "First time you've drawn this exact spread — never before.";
  if (entry) {
    const when = format(new Date(entry.lastAt), "MMMM d, yyyy");
    if (entry.count === 1) {
      text = `You drew this exact spread once before, on ${when}.`;
    } else if (entry.count <= 5) {
      text = `You drew this exact spread ${entry.count} times before — last on ${when}.`;
    } else {
      text = `You've drawn this exact spread ${entry.count} times — most recently ${when}.`;
    }
  }
  if (constellation.active) {
    const N = constellation.participatingCardIds.length;
    const M = constellation.matchCountSixMonths;
    if (M === 1) {
      text = `An Echo — ${N} of these cards have met before, once in the last 6 months.`;
    } else {
      text = `An Echo — ${N} of these cards have met before, ${M} times in the last 6 months.`;
    }
  }
  return (
    <div
      style={{
        width: "100%",
        height: 32,
        borderRadius: 16,
        border: "1px solid var(--accent, var(--gold))",
        background: "var(--surface-card)",
        opacity: 0.85,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
        marginTop: 16,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--accent, var(--gold))",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
          textAlign: "center",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function PracticeStat({ label, value }: { label: string; value: string | number | null }) {
  const display = value == null || value === "" ? "—" : value;
  return (
    <span
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: 12,
        color: "var(--color-foreground-muted, var(--color-foreground))",
      }}
    >
      {label} <span style={{ color: "var(--accent, var(--gold))" }}>{display}</span>
    </span>
  );
}

function PracticeLine({
  practice,
  currentStreak,
}: {
  practice: QuickLogPractice | null;
  currentStreak: number;
}) {
  const sep = (
    <span
      style={{
        color: "var(--color-foreground-muted, var(--color-foreground))",
        opacity: 0.5,
        fontStyle: "italic",
        fontFamily: "var(--font-serif)",
      }}
    >
      {" · "}
    </span>
  );
  const stalkerLabel = practice?.topStalker
    ? `${practice.topStalker.cardName} ×${practice.topStalker.count}`
    : null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        rowGap: 4,
        alignItems: "center",
      }}
    >
      <PracticeStat label="streak" value={`${currentStreak} days`} />
      {sep}
      <PracticeStat label="this lunation" value={practice?.currentLunationReadings ?? null} />
      {sep}
      <PracticeStat label="total" value={practice?.totalReadings ?? null} />
      {sep}
      <PracticeStat label="top stalker" value={stalkerLabel} />
      {sep}
      <PracticeStat
        label="reversed"
        value={
          practice && typeof practice.reversedPct === "number" ? `${practice.reversedPct}%` : null
        }
      />
      {sep}
      <PracticeStat label="top suit" value={practice?.topSuit?.suit ?? null} />
    </div>
  );
}

// Phase 17 — named re-exports for the standalone /constellation page.
// Phase 20 Fix 13 — also expose tiles + practice + history banners.
export {
  ThisPullTiles,
  PullHistoryPill,
  PracticeLine,
  SectionOverline,
  SectionDivider,
};
export type { ConstellationState };
