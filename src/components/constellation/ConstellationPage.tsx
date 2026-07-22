/**
 * Phase 17 — /constellation page.
 *
 * Top: 10-slot row (additive picks). Tap a filled slot to focus it as
 * the hero. Below: left column shows the constellation SVG, right
 * column shows the chip grid + matching readings panel. Full-width
 * 6-month overlap strip sits below.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown, Feather, Pin, RotateCcw, RotateCw, Sparkles, TrendingUp, X, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateShort, formatTimeAgo } from "@/lib/dates";
import { useRegisterTabletopActive } from "@/lib/floating-menu-context";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CardPicker } from "@/components/cards/CardPicker";
import { CardImage } from "@/components/card/CardImage";
import { HeroPatternCluster } from "./HeroPatternCluster";
import { detectPatterns, detectAllPatterns, type PatternResult, type PatternReport } from "@/lib/pattern-detect";
import { detectPatterns as detectEnginePatterns } from "@/lib/pattern-engine";
import { SpreadStructureStrip } from "@/components/tabletop/SpreadStructureStrip";
import { analyzeSpread } from "@/lib/spread-structure";
import { SpreadCombinationsStrip } from "@/components/tabletop/SpreadCombinationsStrip";
import { AllPatternsModal } from "./AllPatternsModal";
import { AiReadingSheet } from "@/components/reading/AiReadingSheet";

/* ---------------------------------------------------------------------------
 * v3.40 — structural group-frequency patterns (suit / number / court).
 * Surfaces the already-validated pattern-engine significance test in the
 * all-patterns feed. Card-dimension results are skipped (they'd duplicate the
 * per-card stalker rows). Group rows are informational — no single hero to load.
 * ------------------------------------------------------------------------- */
function humanizeGroupLabel(dim: "suit" | "number" | "court", key: string): string {
  if (dim === "suit") return key === "majors" ? "Major Arcana" : key.charAt(0).toUpperCase() + key.slice(1);
  if (dim === "court")
    return ({ page: "Pages", knight: "Knights", queen: "Queens", king: "Kings" } as Record<string, string>)[key] ?? key;
  const NUM = ["Aces", "Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens"];
  const idx = Number(key.replace("n", "")) - 1;
  return NUM[idx] ?? key;
}

function detectGroupPatterns(readings: { ymd: string; cardIds: number[] }[], nowMs: number): PatternResult[] {
  const draws: { cardId: number; timestamp: number }[] = [];
  for (const r of readings) {
    const t = Date.parse(r.ymd + "T00:00:00");
    if (Number.isNaN(t)) continue;
    for (const c of r.cardIds) draws.push({ cardId: c, timestamp: t });
  }
  const res = detectEnginePatterns(draws, { topN: 200, now: nowMs });
  if (res.status !== "ok") return [];
  const out: PatternResult[] = [];
  for (const p of res.patterns) {
    if (p.dimension === "card") continue; // don't duplicate the per-card stalker rows
    const dim = p.dimension as "suit" | "number" | "court";
    const label = humanizeGroupLabel(dim, p.label);
    const lift = p.expected && p.expected > 0 ? p.observed / p.expected : 0;
    const patternId = `${dim}:${p.label}`;
    const windowTxt = p.window ? ` (last ${p.window}d)` : "";
    const detail =
      p.type === "streak" ? `a ${p.observed}-session streak` : `${p.observed} vs ~${(p.expected ?? 0).toFixed(0)} expected`;
    out.push({
      lens: dim,
      bucketLabel: label,
      targetKey: patternId,
      patternId,
      cardId: null,
      draws: p.observed,
      exactHits: p.observed,
      weightedScore: p.observed,
      lift,
      pValue: p.adjustedP,
      memberYmds: [],
      explanation: `${label} are running ${lift ? lift.toFixed(1) + "×" : "above"} your norm${windowTxt} — ${detail}.`,
    });
  }
  return out;
}
import { TAROT_MEANINGS, type CardMeaning, type YesNo } from "@/lib/tarot-meanings";
import { getCardMeta } from "@/lib/card-astrology";
import { resolvePromptsForFirstCard } from "@/lib/journal-prompts/resolve";
import { computeMatchSignals } from "@/lib/match-signals";
import { saveManualReading } from "@/lib/save-manual-reading.functions";
import { interpretReading } from "@/lib/interpret.functions";
import { Modal } from "@/components/ui/modal";
import { RichPopover } from "@/components/ui/RichPopover";
import {
  OverlapStrip,
  OverlapPills,
  ThisPullTiles,
  PullHistoryPill,
  PracticeLine,
  SectionOverline,
  SectionDivider,
  type ConstellationState,
  type DayCellSignals,
} from "@/components/tabletop/QuickLog";
import {
  SmartCardInput,
  type PasteOutcome,
  type SmartPick,
} from "@/components/tabletop/SmartCardInput";
import { buildSearchIndex, scanTextForCards } from "@/lib/card-search";
import { ConstellationWeb, SVG_H, SVG_W } from "@/components/constellation/ConstellationWeb";
import { LunationLensToggle } from "@/components/constellation/LunationLensToggle";
import { AtlasWeb } from "@/components/constellation/AtlasWeb";
import { EchoBanner } from "@/components/constellation/EchoBanner";
import { useEcho } from "@/lib/use-echo";
import { cn } from "@/lib/utils";
import { TAROT_DECK } from "@/lib/tarot";
import {
  decodeLunationView,
  encodeLunationView,
  type LunationView,
} from "@/lib/lunation-url";
import {
  useAnyDeckCardName,
  useActiveDeck,
  useActiveDeckCornerRadius,
} from "@/lib/active-deck";
import {
  getQuickLogCardStats,
  getQuickLogOverlap,
  getCardConstellation,
  getQuickLogPractice,
  getCardDrawCounts,
  getCardPopoverData,
  type QuickLogCardStats,
  type QuickLogOverlap,
  type CardConstellation,
  type QuickLogPractice,
  type CardDrawCounts,
  type CardPopoverData,
  type CardPopoverDataMap,
} from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { PageMenu, type PageMenuSection } from "@/components/nav/PageMenu";
import { PageMenuTrigger } from "@/components/nav/PageMenuTrigger";
import { LunationStrip } from "@/components/constellation/LunationStrip";
import { LunationBookmarks } from "@/components/constellation/LunationBookmarks";
import { Eye, EyeOff, Hash, Layers, LayoutGrid, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTimezone } from "@/lib/use-timezone";
import { useNavigate } from "@tanstack/react-router";
import { useStreak } from "@/lib/use-streak";
import { getLunationContaining } from "@/lib/lunation";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  ConstellationTagsPanel,
  useTagSortPref,
  useTagScopePref,
  type ConstellationTagStat,
} from "@/components/filters/ConstellationTagsPanel";
import { getTagFilterStats } from "@/lib/insights.functions";
import { PinnedCardModal } from "@/components/constellation/PinnedCardModal";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { isoDayInTz, calendarDaysBetween, parseIsoDay } from "@/lib/time";
import { getPhaseOccurrences } from "@/lib/moon";
import {
  detectAtlasPatterns,
  type AtlasPattern,
} from "@/lib/atlas-patterns";
import { CardRichPopoverContent } from "@/components/card/CardRichPopover";
import { useHoverSnooze, applySnooze, clearSnooze } from "@/lib/hover-snooze";
import { DEFAULT_FILTERS, type InsightsFilters } from "@/lib/insights.types";
import { SPREADS, SPREAD_STORAGE_KEY, getSpread, type SpreadKey } from "@/lib/spreads";
import { EMPTY_GLOBAL_FILTERS, countActiveFilters, type GlobalFilters } from "@/lib/filters.types";
import { useConfirm } from "@/hooks/use-confirm";

// DR — slot row sized for the right column. Width is computed responsively
// (see slotRowRef below); these are min/max safety rails. Compact layout
// since 10 slots + a date pill + paste input all share the column.
const COMPACT_SLOT_MIN_W = 36;
const COMPACT_SLOT_MAX_W = 64;
const COMPACT_SLOT_GAP = 4;
const COMPACT_SLOT_AR = 1.55; // height = width * 1.55

// Phase 23 — default to "Last 365 days" (closest match to the spec's
// "12 months" within Insights' canonical timeRange options).
const DEFAULT_TIMEFRAME = "365d";
const TIMEFRAME_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 180 days" },
  { value: "365d", label: "Last 365 days" },
  { value: "all", label: "All time" },
] as const;

/** Phase 23 — slot badge opacity, mirrors QuickLog's matchOpacity. */
function badgeOpacity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const pct = count / max;
  return 0.15 + pct * 0.8;
}

/** Convert the GlobalFilters envelope into the server-fn `filters` payload. */
function toFilterPayload(g: GlobalFilters) {
  return {
    timeRange: g.timeRange,
    tags: g.tags,
    spreadTypes: g.spreadTypes,
    moonPhases: g.moonPhases,
    deepOnly: g.deepOnly,
    reversedOnly: g.reversedOnly,
  };
}

// DP — localStorage keys for /constellation state persistence.
const LS_KEY = "tarotseed:constellation-state";
// DR — when "1", the unsaved-changes confirm modal is permanently dismissed.
const LS_SUPPRESS_LEAVE_KEY = "tarotseed:constellation-skip-leave-warn";

type PersistedState = {
  picks: ManualPick[];
  focusedSlotIdx: number | null;
  tealSelectedIds: number[];
  backdateISO: string | null;
  question: string;
  /** DY — free-form notes for the in-page journal save / AI reading. */
  note: string;
  overlapMode: "pull" | "day";
  globalFilters: GlobalFilters;
};

function loadPersisted(): Partial<PersistedState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return null;
  }
}

// EG — a single line in the chained legend popover. Mini visual swatch
// on the left, short label on the right.
function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-serif)",
        fontSize: 11.5,
        color: "var(--color-foreground)",
        lineHeight: 1.3,
      }}
    >
      <div style={{ flexShrink: 0, position: "relative" }}>{swatch}</div>
      <div style={{ flex: 1 }}>{label}</div>
    </div>
  );
}

// EJ12 — dropdown that picks a tarot spread type for the slot-row
// labels. Mirrors the canonical Dropdown pattern from
// src/components/filters/Dropdown.tsx (italic serif label + ChevronDown,
// portaled menu) but kept inline here because it's only used on this
// surface and needs to anchor below the slot row.
function SpreadDropdown({
  value,
  onChange,
}: {
  value: SpreadKey;
  onChange: (next: SpreadKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ left: r.left, top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (triggerRef.current?.contains(t)) return;
      if (t.closest?.("[data-spread-dropdown-popover]")) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Pick a spread type"
        title="Pick a spread type to label each slot"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          width: 18,
          height: 18,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--color-foreground-muted, var(--color-foreground))",
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 160ms ease",
          }}
        />
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-spread-dropdown-popover
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              minWidth: 160,
              padding: 4,
              background: "var(--surface-elevated)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
              zIndex: "var(--z-drawer)" as unknown as number,
            }}
          >
            {SPREADS.map((s) => {
              const active = s.key === value;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    onChange(s.key);
                    setOpen(false);
                  }}
                  title={s.descriptor}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "6px 10px",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    color: active ? "var(--gold, var(--accent))" : "var(--color-foreground)",
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm, 13px)",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

// EH — full color legend for the calendar surface. Always shows every
// signal; the seeker reads it once and remembers.
function ColorLegend() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              background: "var(--gold, var(--accent))",
              opacity: 0.9,
              border: "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
            }}
          />
        }
        label="Hero fill · day you drew the hero card"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              background: "var(--accent, var(--gold))",
              opacity: 0.5,
              border: "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
            }}
          />
        }
        label="Accent fill · some of your spread cards appeared here (brighter = more)"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              border: "2px solid var(--accent, var(--gold))",
            }}
          />
        }
        label="Solid ring · 100% match · all your spread cards co-occurred"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              border: "1.5px dashed var(--accent, var(--gold))",
            }}
          />
        }
        label="Dashed ring · best partial match in your calendar"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              border: "2px solid var(--trace-color, #5cead4)",
            }}
          />
        }
        label="Asterism outline · your asterism co-occurred here"
      />
    </div>
  );
}

// EH — explains the constellation web's lines and badges.
function ConstellationLegend() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <LegendRow
        swatch={
          <svg width={26} height={10}>
            <line
              x1={1}
              y1={5}
              x2={25}
              y2={5}
              stroke="var(--accent, var(--gold))"
              strokeWidth={2}
            />
          </svg>
        }
        label="Accent line · these two cards have co-occurred in past spreads (matching your filters)"
      />
      <LegendRow
        swatch={
          <svg width={26} height={10}>
            <line
              x1={1}
              y1={5}
              x2={25}
              y2={5}
              stroke="var(--trace-color, #5cead4)"
              strokeWidth={2}
            />
          </svg>
        }
        label="Discovery line · click any card to make it a star (a card bordered in this color) — 2 or more stars together form an asterism; these lines connect to other cards that also co-occur with your asterism (matching your filters)"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              background: "var(--gold, var(--accent))",
              border: "1px solid color-mix(in oklab, var(--color-foreground) 18%, transparent)",
            }}
          />
        }
        label="Hero badge · spreads (matching your filters) containing the hero card"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              background: "var(--trace-color, #5cead4)",
              border: "1px solid color-mix(in oklab, var(--color-foreground) 18%, transparent)",
            }}
          />
        }
        label="Asterism badge · a star is a card you've selected; 2 or more stars form an asterism — this counts spreads or days (matching your filters) where your asterism co-occurred"
      />
    </div>
  );
}

// EH — explains slot card badges (the circular count on each slot).
function BadgeLegend() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9999,
              background:
                "color-mix(in oklab, var(--accent, var(--gold)) 35%, var(--surface-card))",
              border: "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 10,
              color: "var(--color-foreground)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            n
          </div>
        }
        label="Number · how many of your past spreads include this card"
      />
      <LegendRow
        swatch={
          <div style={{ display: "flex", gap: 4 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 9999,
                background:
                  "color-mix(in oklab, var(--accent, var(--gold)) 18%, var(--surface-card))",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 9999,
                background:
                  "color-mix(in oklab, var(--accent, var(--gold)) 55%, var(--surface-card))",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 9999,
                background:
                  "color-mix(in oklab, var(--accent, var(--gold)) 90%, var(--surface-card))",
              }}
            />
          </div>
        }
        label="Intensity · brighter badge = drawn more times among your spread cards"
      />
      <LegendRow
        swatch={
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9999,
              background: "var(--gold, var(--accent))",
              border: "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
            }}
          />
        }
        label="Hero card badge · marks the focused card in your spread (your hero card)"
      />
    </div>
  );
}

/**
 * EJ63 — `onSwitchToTable` lets the parent /draw route inject a
 * surface-flip callback so the EntryModeToggle's "Draw" button can
 * switch the rendered surface from ConstellationPage to Tabletop
 * IN PLACE (no route change, state preserved). When undefined, the
 * Draw button falls back to navigating to /draw?entry=table — which
 * works when ConstellationPage is mounted via the standalone
 * /constellation route, since that's a different URL.
 */
type ConstellationPageProps = {
  onSwitchToTable?: () => void;
  /** EK101 — render the full 78-card clock (Atlas) in place of the
   *  hero+companions web. Everything else on the page is identical. */
  atlasMode?: boolean;
  /** v2.18 — render inside the Insights › Patterns tab. Drops the
   *  journal-entry block (question, notes, Save to Journal, backdate)
   *  and reserves the left column for the pattern chip cluster. */
  insightsMode?: boolean;
  /** v2.87 — in insightsMode, the Insights range selector's value, so the
   *  Patterns tab (calendar + data) follows the range the seeker picks
   *  instead of ConstellationPage's own hidden/persisted range. */
  insightsTimeRange?: string;
  /** v2.92 — render the /lunations page: swaps the calendar strip for the
   *  two-lens LunationStrip. The draw table + Insights never pass this. */
  lunationMode?: boolean;
};

// EK107 — atlas group helpers. An asterism is a list of OR-groups; a day
// or pull matches when EVERY group has at least one member present.
// Centralized here so the calendar stroke, badge count, candidate lines,
// and readings modal all compute the match identically.
// EK108 — suit/rank → card ids, for the bulk-select chips.
const ATLAS_SUIT_RANGES: Record<string, [number, number]> = {
  major: [0, 21],
  wands: [22, 35],
  cups: [36, 49],
  swords: [50, 63],
  pentacles: [64, 77],
};
function suitCardIds(suit: string): number[] {
  const r = ATLAS_SUIT_RANGES[suit];
  if (!r) return [];
  return Array.from({ length: r[1] - r[0] + 1 }, (_, i) => r[0] + i);
}
function rankCardIds(rank: number): number[] {
  return [22 + rank, 36 + rank, 50 + rank, 64 + rank];
}

// EK109 — labels for the left-column atlas controls.
const ATLAS_RANK_GLYPHS = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Pg", "Kn", "Qn", "Kg",
];
const ATLAS_RANK_FULL = [
  "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Page", "Knight", "Queen", "King",
];
// EK130 — plural rank names for the named-set asterism chip (clicking a
// rank/suit chip puts ONE named chip in the asterism, not card-by-card).
const ATLAS_RANK_PLURAL = [
  "Aces", "Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights",
  "Nines", "Tens", "Pages", "Knights", "Queens", "Kings",
];
const ATLAS_SUIT_LIST: Array<{ key: string; label: string }> = [
  { key: "major", label: "Majors" },
  { key: "wands", label: "Wands" },
  { key: "cups", label: "Cups" },
  { key: "swords", label: "Swords" },
  { key: "pentacles", label: "Pentacles" },
];
const ATLAS_TRACE_COLOR = "var(--trace-color, #5cead4)";

// EK131 — Asterism v2 token/section model. A SECTION is a "matches any" (OR)
// or "matches all" (AND) set of TOKENS; a token is a single card, a whole
// suit, a whole rank, or a moon phase. The asterism is every committed
// section ANDed together, PLUS the live tray (treated as one "matches all"
// section). This replaces the old loose-singles + custom-groups + global-
// moon split so anything can be combined either way.
type AtlasToken =
  | { t: "card"; cardId: number }
  | { t: "suit"; key: string }
  | { t: "rank"; r: number }
  | { t: "moon"; phase: "Full Moon" | "New Moon" };
type AtlasSection = { uid: string; mode: "any" | "all"; tokens: AtlasToken[] };

function atlasTokenCardIds(tk: AtlasToken): number[] {
  if (tk.t === "card") return [tk.cardId];
  if (tk.t === "suit") return suitCardIds(tk.key);
  if (tk.t === "rank") return rankCardIds(tk.r);
  return [];
}
function atlasTokenLabel(tk: AtlasToken): string {
  if (tk.t === "card") return TAROT_DECK[tk.cardId] ?? "Card";
  if (tk.t === "suit")
    return ATLAS_SUIT_LIST.find((s) => s.key === tk.key)?.label ?? tk.key;
  if (tk.t === "rank") return ATLAS_RANK_PLURAL[tk.r] ?? "Cards";
  return tk.phase;
}
function atlasTokenKey(tk: AtlasToken): string {
  if (tk.t === "card") return `card:${tk.cardId}`;
  if (tk.t === "suit") return `suit:${tk.key}`;
  if (tk.t === "rank") return `rank:${tk.r}`;
  return `moon:${tk.phase}`;
}
function atlasSectionCardIds(sec: { tokens: AtlasToken[] }): number[] {
  const out = new Set<number>();
  for (const tk of sec.tokens)
    for (const id of atlasTokenCardIds(tk)) out.add(id);
  return [...out];
}
// Human-readable name for a section (badge tooltip + modal title).
function atlasSectionLabel(sec: {
  mode: "any" | "all";
  tokens: AtlasToken[];
}): string {
  const names = sec.tokens.map(atlasTokenLabel);
  if (names.length <= 1) return names[0] ?? "";
  return (
    (sec.mode === "all" ? "matches all — " : "matches any — ") +
    names.join(sec.mode === "all" ? " + " : " · ")
  );
}

// EK132 — plain-language readout. Each token becomes a phrase the seeker can
// read like a sentence; suits/ranks read as "any X" to convey the OR, moons
// read as a day predicate. The readout mirrors the live asterism so the
// abstract chips make sense at a glance.
function atlasSuitSingular(key: string): string {
  if (key === "major") return "Major Arcana";
  const label = ATLAS_SUIT_LIST.find((s) => s.key === key)?.label ?? key;
  return label.replace(/s$/, "");
}
function atlasTokenPhrase(tk: AtlasToken): string {
  if (tk.t === "card") return TAROT_DECK[tk.cardId] ?? "a card";
  if (tk.t === "suit") return `any ${atlasSuitSingular(tk.key)} card`;
  if (tk.t === "rank") return `any ${ATLAS_RANK_FULL[tk.r] ?? "card"}`;
  return tk.phase === "Full Moon"
    ? "a full-moon day"
    : "a new-moon day";
}
// One section as a predicate clause, e.g. "has any Wand or The Star" or
// "was drawn on a full-moon day".
function atlasSectionPredicate(sec: {
  mode: "any" | "all";
  tokens: AtlasToken[];
}): string {
  const conn = sec.mode === "all" ? " and " : " or ";
  const cardish = sec.tokens.filter((t) => t.t !== "moon").map(atlasTokenPhrase);
  const moons = sec.tokens
    .filter((t): t is Extract<AtlasToken, { t: "moon" }> => t.t === "moon")
    .map((t) =>
      t.phase === "Full Moon"
        ? "was drawn on a full-moon day"
        : "was drawn on a new-moon day",
    );
  const parts: string[] = [];
  if (cardish.length) parts.push("has " + cardish.join(conn));
  for (const m of moons) parts.push(m);
  return parts.join(conn);
}
// "Fully blown out" clarifier for suit/rank tokens, e.g.
// "Pentacles = any one of the 14 Pentacle cards counts".
function atlasTokenClarifier(tk: AtlasToken): string | null {
  if (tk.t === "suit") {
    const n = suitCardIds(tk.key).length;
    const label = tk.key === "major" ? "Majors" : atlasSuitSingular(tk.key) + "s";
    return `${label} = any one of the ${n} ${atlasSuitSingular(tk.key)} cards counts`;
  }
  if (tk.t === "rank") {
    const n = rankCardIds(tk.r).length;
    const plural = ATLAS_RANK_PLURAL[tk.r] ?? "those";
    return `${plural} = any one of the ${n} ${ATLAS_RANK_FULL[tk.r] ?? "cards"} cards counts`;
  }
  return null;
}

// EK112 — a group slot dropped into the slot row (atlas only). Represents
// "any of" for the slot-row match. Kept PARALLEL to ManualPick so the shared
// pick type (used across ~10 files) stays untouched. EK113 — a moon variant
// joins: card groups (rank/suit) match by card membership; a moon group
// matches by the reading's recorded phase.
export type AtlasGroupSlot =
  | {
      uid: string;
      kind: "rank" | "suit";
      key: string;
      label: string;
      ids: number[];
    }
  | {
      uid: string;
      kind: "moon";
      key: string;
      label: string;
      phase: "Full Moon" | "New Moon";
    };
function buildAtlasGroupSlot(
  kind: "rank" | "suit" | "moon",
  key: string,
): AtlasGroupSlot | null {
  if (kind === "moon") {
    if (key !== "Full Moon" && key !== "New Moon") return null;
    return { uid: `moon-${key}`, kind, key, label: `under ${key}`, phase: key };
  }
  if (kind === "rank") {
    const r = Number(key);
    if (!Number.isInteger(r) || r < 0 || r > 13) return null;
    return {
      uid: `rank-${r}`,
      kind,
      key: String(r),
      label: `any ${ATLAS_RANK_FULL[r]}`,
      ids: rankCardIds(r),
    };
  }
  const ids = suitCardIds(key);
  if (ids.length === 0) return null;
  const label =
    key === "major"
      ? "any Major"
      : `any ${ATLAS_SUIT_LIST.find((s) => s.key === key)?.label ?? key}`;
  return { uid: `suit-${key}`, kind, key, label, ids };
}

export function ConstellationPage({
  onSwitchToTable,
  atlasMode = false,
  insightsMode = false,
  insightsTimeRange,
  lunationMode = false,
}: ConstellationPageProps = {}) {
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const navigate = useNavigate();
  const confirm = useConfirm();
  // EJ50 — Active deck reference, used by the journaling-prompts empty
  // state to route the seeker to that deck's edit page where they can
  // generate AI prompts. Only available for custom decks; default deck
  // users see the empty state without a CTA (default deck has built-in
  // prompts).
  // EJ51 — Pull allDecks too. The CTA needs to route to the deck that
  // OWNS the active card (pick.deckId), not the currently-active deck.
  // A seeker who drew a card from "Zombie" deck and then switched their
  // active deck to "Southern Oracle" should still see "Set up prompts
  // for Zombie →" — because the card was drawn from Zombie and its
  // prompts (or lack thereof) live in Zombie.
  const { activeDeck: activeDeckForCta, allDecks: allDecksForCta } = useActiveDeck();
  // EJ61 — Active deck corner radius (0..100 percent). Used to give the
  // slot breathe glow a deck-aware border-radius so the glow corners
  // curve with the card silhouette rather than the previous hardcoded
  // 8px which didn't match any specific deck.
  const deckRadiusPct = useActiveDeckCornerRadius() ?? 0;
  // EJ35 — resolve oracle card_ids (>= 1000) through the active deck's
  // card_name overrides. Falls back to "Card N" only when neither the
  // tarot dictionary nor the deck has a name. Used everywhere the
  // constellation surface displays a card name to the seeker — hover
  // popovers, line tooltips, asterism listings — so oracle cards stop
  // appearing as raw IDs.
  const resolveCardName = useAnyDeckCardName();

  // EK85 — hover tips on this surface now read the unified hover-snooze
  // store (System B retired). The manual-entry hover renders the master
  // CardRichPopover popover; popoverFilters feeds it an all-time window.
  const { snoozed } = useHoverSnooze();
  const hoverTipsOn = !snoozed;
  const hoverTipsEnabled = !snoozed;
  const toggleHoverTips = () => {
    if (snoozed) clearSnooze();
    else applySnooze("indefinite");
  };
  const popoverFilters: InsightsFilters = {
    ...DEFAULT_FILTERS,
    timeRange: "all",
    tz: effectiveTz,
  };

  // EK68 — calendar number mode: day-of-month ("dates", default) vs the
  // seeker's personal day number ("numerology"). Cycled from the fly-out.
  const [calendarNumberMode, setCalendarNumberMode] = useState<"dates" | "numerology">(
    "dates",
  );
  // EK93 — pulse the hovered card/line's calendar days (whole cell, 20%↔100%).
  // SSR-safe default ON; hydrated from localStorage after mount. Toggled from
  // the manual-entry hamburger (Display section).
  const [pulseHoverDays, setPulseHoverDays] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("tarotseed:calendar:pulse") === "0") {
        setPulseHoverDays(false);
      }
    } catch {
      // ignore — default ON
    }
  }, []);

  // Phase 18 Fix 6 — hide the global BottomNav on /constellation.
  useRegisterTabletopActive(true);

  // DP — restore prior session state on first mount.
  // ED — SSR-safe initialization. Previously this read localStorage
  // synchronously in useState initializers, which caused a hydration
  // mismatch (server rendered empty, client rendered with picks). The
  // mismatch triggered React error #418 and cascaded into a
  // ReferenceError on bundled ConstellationWeb props during remount.
  //
  // New strategy:
  //   1. Initialize all state with SAFE DEFAULTS that match what the
  //      server renders (empty arrays / null).
  //   2. After mount, an effect reads localStorage ONCE and hydrates
  //      the state. This runs only on the client, so no mismatch.
  const [picks, setPicks] = useState<ManualPick[]>([]);

  // v2.57 — slot-row undo/redo. History snapshots the `picks` array only
  // (adds / removes / reorders / clear / hero promotion / loading a reading /
  // the load-cards action). Filters and teal selection are NOT tracked.
  // Capped, session-only. Implemented via a single effect that records every
  // picks transition, so no individual setPicks callsite needs instrumenting.
  const HISTORY_CAP = 25;
  const undoStack = useRef<ManualPick[][]>([]);
  const redoStack = useRef<ManualPick[][]>([]);
  const prevPicksRef = useRef<ManualPick[]>([]);
  const suppressHistory = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const picksEqual = (a: ManualPick[], b: ManualPick[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].cardIndex !== b[i].cardIndex ||
        a[i].isReversed !== b[i].isReversed ||
        (a[i].deckId ?? null) !== (b[i].deckId ?? null)
      )
        return false;
    }
    return true;
  };

  useEffect(() => {
    if (suppressHistory.current) {
      suppressHistory.current = false;
      prevPicksRef.current = picks;
      return;
    }
    if (picksEqual(picks, prevPicksRef.current)) {
      prevPicksRef.current = picks;
      return;
    }
    undoStack.current.push(prevPicksRef.current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    redoStack.current = [];
    prevPicksRef.current = picks;
    setHistoryVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks]);

  const undoPicks = () => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop() as ManualPick[];
    redoStack.current.push(prevPicksRef.current);
    if (redoStack.current.length > HISTORY_CAP) redoStack.current.shift();
    suppressHistory.current = true;
    prevPicksRef.current = prev;
    setPicks(prev);
    setFocusedSlotIdx(prev.length > 0 ? 0 : null);
    setHistoryVersion((v) => v + 1);
  };

  const redoPicks = () => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop() as ManualPick[];
    undoStack.current.push(prevPicksRef.current);
    if (undoStack.current.length > HISTORY_CAP) undoStack.current.shift();
    suppressHistory.current = true;
    prevPicksRef.current = next;
    setPicks(next);
    setFocusedSlotIdx(next.length > 0 ? 0 : null);
    setHistoryVersion((v) => v + 1);
  };
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  void historyVersion; // re-render trigger for the undo/redo buttons

  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number | null>(null);
  // Phase 24 — teal multi-select trace. Empty by default. Click any card in
  // the constellation web (hero or companion) to toggle membership. Drives
  // calendar stroke + readings panel filter. Resets when hero changes.
  const [tealSelectedIds, setTealSelectedIds] = useState<number[]>([]);
  // EK120 — atlas left-column tabs. "draw" = build the spread (paste +
  // question + notes + save); "asterism" = the analysis tools (ranks,
  // suits, moon, asterism box). Only one panel shows at a time, which
  // shortens the column and lets the calendar strip below rise up.
  // Atlas-only; /constellation never reads this.
  const [atlasTab, setAtlasTab] = useState<"draw" | "asterism">("draw");
  // EK131 — Asterism v2 state. atlasTray = the live section being built
  // (treated as one "matches all" section so a single tapped card matches
  // instantly); atlasSections = committed chips, each a "matches any" (OR)
  // or "matches all" (AND) set. Replaces atlasCustomGroups + atlasMoonPhases.
  const [atlasTray, setAtlasTray] = useState<AtlasToken[]>([]);
  const [atlasSections, setAtlasSections] = useState<AtlasSection[]>([]);
  // EK108 — which rank/suit chip is being hovered, for the calendar
  // preview stroke. Holds the chip's target card ids.
  const [atlasHoverChip, setAtlasHoverChip] = useState<number[] | null>(null);
  // EK112 — group slots dropped into the slot row, and a flag that a group
  // chip is mid-drag (so empty slots can light up as drop targets even though
  // no card id is being dragged).
  const [atlasGroupSlots, setAtlasGroupSlots] = useState<AtlasGroupSlot[]>([]);
  const [draggingGroup, setDraggingGroup] = useState(false);
  // EK114 — which moon chip is hovered, for the calendar preview stroke.
  const [atlasHoverMoonPhase, setAtlasHoverMoonPhase] = useState<string | null>(
    null,
  );
  // EK114 — card ids of the hovered Asterism-panel chip, so its days breathe.
  const [atlasAsterismHoverIds, setAtlasAsterismHoverIds] = useState<
    number[] | null
  >(null);
  // EK132 — token tentatively previewed in the readout while the seeker hovers
  // a clock card or a rank/suit/moon chip. It ANDs into the tray for the
  // preview clause only; reverts on mouse-out. Never mutates the asterism.
  const [atlasPreviewToken, setAtlasPreviewToken] = useState<AtlasToken | null>(
    null,
  );
  // EK131 — tray token add/remove (de-duped by token identity).
  const addAtlasToken = (tk: AtlasToken) =>
    setAtlasTray((prev) =>
      prev.some((p) => atlasTokenKey(p) === atlasTokenKey(tk))
        ? prev
        : [...prev, tk],
    );
  const removeAtlasToken = (key: string) =>
    setAtlasTray((prev) => prev.filter((p) => atlasTokenKey(p) !== key));
  // EK131 — commit the live tray as one chip with the chosen match mode.
  const commitAtlasSection = (mode: "any" | "all") => {
    if (atlasTray.length === 0) return;
    const uid = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setAtlasSections((prev) => [...prev, { uid, mode, tokens: atlasTray }]);
    setAtlasTray([]);
  };
  const removeAtlasSection = (uid: string) =>
    setAtlasSections((prev) => prev.filter((s) => s.uid !== uid));
  // EK131 — moon chip toggles into/out of the live tray.
  const toggleAtlasMoonPhase = (phase: "Full Moon" | "New Moon") => {
    const key = `moon:${phase}`;
    if (atlasTray.some((p) => atlasTokenKey(p) === key)) removeAtlasToken(key);
    else addAtlasToken({ t: "moon", phase });
  };
  const addAtlasGroupSlot = (kind: "rank" | "suit" | "moon", key: string) => {
    const gs = buildAtlasGroupSlot(kind, key);
    if (!gs) return;
    setAtlasGroupSlots((prev) =>
      prev.some((p) => p.uid === gs.uid) ? prev : [...prev, gs],
    );
  };
  const removeAtlasGroupSlot = (uid: string) =>
    setAtlasGroupSlots((prev) => prev.filter((p) => p.uid !== uid));
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phase 19 Fix 7 — back-date pill state (parity with QuickLog).
  const [backdate, setBackdate] = useState<Date | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  // Phase 23 — page-wide filter state. Default 365d (12 months).
  const [globalFilters, setGlobalFilters] = useState<GlobalFilters>(() => ({
    ...EMPTY_GLOBAL_FILTERS,
    timeRange: DEFAULT_TIMEFRAME,
  }));

  // ED — hydrate from localStorage exactly once after mount. Runs on
  // the client only; never on the server. This intentionally bypasses
  // the existing persist-on-change effect (which only writes) because
  // we need to apply the saved state without race-conditioning with
  // user-driven updates that might fire in the same tick.
  const hydratedFromStorageRef = useRef(false);
  useEffect(() => {
    if (hydratedFromStorageRef.current) return;
    hydratedFromStorageRef.current = true;
    const persisted = loadPersisted();
    if (!persisted) return;
    if (persisted.picks?.length) {
      suppressHistory.current = true;
      setPicks(persisted.picks);
    }
    if (persisted.focusedSlotIdx !== undefined) setFocusedSlotIdx(persisted.focusedSlotIdx);
    if (persisted.tealSelectedIds?.length) setTealSelectedIds(persisted.tealSelectedIds);
    // EJ16 — backdate is NOT restored from localStorage. The picker
    // defaults to today's date on initial page load. Explicit
    // backdates set during a session persist in component state
    // until page reload; after reload, default is today again.
    // Prevents stale dates from prior sessions surfacing as the
    // current default.
    if (persisted.globalFilters) setGlobalFilters(persisted.globalFilters);
    if (persisted.overlapMode) setOverlapMode(persisted.overlapMode);
    if (persisted.question) setQuestion(persisted.question);
    if (persisted.note) setNote(persisted.note);
  }, []);
  // v2.87 — in the Insights › Patterns tab, follow the Insights range
  // selector instead of ConstellationPage's own hidden/persisted range, so
  // the calendar (and the tab's data) reflect the range the seeker actually
  // picks. Overrides the persisted hydration above when in insightsMode.
  useEffect(() => {
    if (!insightsMode || !insightsTimeRange) return;
    setGlobalFilters((prev) =>
      prev.timeRange === insightsTimeRange
        ? prev
        : { ...prev, timeRange: insightsTimeRange },
    );
  }, [insightsMode, insightsTimeRange]);
  // v3.03 — /lunations bookmarkable view. The lens (moon/day) is lifted here so
  // it can be serialized (the strip is controlled). On /lunations only, the view
  // (slot cards + order, lens, asterism, range, hero) is hydrated from the URL
  // once on mount and written back to the URL on every change via replaceState —
  // so bookmarking/copying the URL captures the current view. Every other surface
  // is untouched (lunationMode is false there).
  const [lunationLens, setLunationLens] = useState<
    "moon" | "day" | "calendar" | "numerology" | "weekday"
  >("moon");
  // v3.31 — the currently highlighted pattern (from the glyph on the hero card).
  // Null until the seeker taps the glyph; cleared whenever the hero changes.
  const [activePattern, setActivePattern] = useState<PatternResult | null>(null);
  // v3.34 — all-patterns view.
  const [allPatterns, setAllPatterns] = useState<PatternResult[]>([]);
  const [seenPatterns, setSeenPatterns] = useState<Set<string>>(new Set());
  const [patternsModalOpen, setPatternsModalOpen] = useState(false);
  const seenHydratedRef = useRef(false);
  useEffect(() => {
    if (seenHydratedRef.current || !user?.id) return;
    seenHydratedRef.current = true;
    void supabase
      .from("user_preferences")
      .select("seen_patterns")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return;
        const ids = (data as { seen_patterns?: string[] } | null)?.seen_patterns;
        if (Array.isArray(ids)) setSeenPatterns(new Set(ids));
      });
  }, [user?.id]);
  const markPatternSeen = useCallback(
    (patternId: string) => {
      setSeenPatterns((prev) => {
        if (prev.has(patternId)) return prev;
        const next = new Set(prev);
        next.add(patternId);
        if (user?.id) {
          const arr = Array.from(next);
          void supabase
            .from("user_preferences")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle()
            .then(({ data: existing }) => {
              if (existing) {
                return supabase
                  .from("user_preferences")
                  .update({ seen_patterns: arr } as never)
                  .eq("user_id", user.id);
              }
              return supabase
                .from("user_preferences")
                .insert({ user_id: user.id, seen_patterns: arr } as never);
            });
        }
        return next;
      });
    },
    [user?.id],
  );
  const [calendarRows, setCalendarRows] = useState(3); // rows of 4 months (3 = 12 months, the default; Show less drops to 2/1)
  const [lunationHydrated, setLunationHydrated] = useState(false);
  const applyLunationView = useCallback((v: Partial<LunationView>) => {
    if (v.cards && v.cards.length) {
      const now = Date.now();
      setPicks(
        v.cards.map((c, i) => ({
          id: now + i,
          cardIndex: c.cardIndex,
          isReversed: c.isReversed,
          deckId: null,
          cardName: TAROT_DECK[c.cardIndex] ?? null,
        })),
      );
      setFocusedSlotIdx(
        v.heroIdx != null && v.heroIdx < v.cards.length ? v.heroIdx : 0,
      );
    }
    if (v.stars) setTealSelectedIds(v.stars);
    if (v.range) {
      const r = v.range;
      setGlobalFilters((prev) => ({ ...prev, timeRange: r }));
    }
    if (v.lens) setLunationLens(v.lens);
  }, []);
  const getLunationViewState = useCallback(
    () =>
      encodeLunationView({
        cards: picks.map((p) => ({
          cardIndex: p.cardIndex,
          isReversed: p.isReversed,
        })),
        lens: lunationLens,
        stars: tealSelectedIds,
        range: globalFilters.timeRange ?? DEFAULT_TIMEFRAME,
        heroIdx: focusedSlotIdx,
      }),
    [
      picks,
      lunationLens,
      tealSelectedIds,
      globalFilters.timeRange,
      focusedSlotIdx,
    ],
  );
  useEffect(() => {
    if (!lunationMode || insightsMode || lunationHydrated) return;
    if (typeof window !== "undefined") {
      applyLunationView(decodeLunationView(window.location.search));
    }
    setLunationHydrated(true);
  }, [lunationMode, lunationHydrated, applyLunationView]);
  useEffect(() => {
    if (
      !lunationMode ||
      insightsMode ||
      !lunationHydrated ||
      typeof window === "undefined"
    ) {
      return;
    }
    const search = encodeLunationView({
      cards: picks.map((p) => ({
        cardIndex: p.cardIndex,
        isReversed: p.isReversed,
      })),
      lens: lunationLens,
      stars: tealSelectedIds,
      range: globalFilters.timeRange ?? DEFAULT_TIMEFRAME,
      heroIdx: focusedSlotIdx,
    });
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [
    lunationMode,
    lunationHydrated,
    picks,
    lunationLens,
    tealSelectedIds,
    globalFilters.timeRange,
    focusedSlotIdx,
  ]);
  // DX — controlled drawer-open state so the "· N FILTER(S)" link in the
  // data header can open the same fly-out that the toolbar icon drives.
  const [globalDrawerOpen, setGlobalDrawerOpen] = useState(false);

  // EF — Tags section in the filter drawer. Same fetch pattern as
  // /insights, /numerology, /journal: pull the user's top tags from
  // the user_tags table once on mount. Without this, the Tags section
  // renders but with no chips because userTags defaults to [].
  const [userTags, setUserTags] = useState<
    Array<{ id: string; name: string; usage_count: number }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser || cancelled) return;
      const { data, error } = await supabase
        .from("user_tags")
        .select("id, name, usage_count")
        .eq("user_id", authUser.id)
        .order("usage_count", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.warn("[ConstellationPage] tag fetch failed", error);
        return;
      }
      setUserTags(
        (data ?? []) as Array<{
          id: string;
          name: string;
          usage_count: number;
        }>,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filterPayload = useMemo(() => toFilterPayload(globalFilters), [globalFilters]);
  const filterKey = useMemo(() => JSON.stringify(filterPayload), [filterPayload]);

  // DR — readings modal open state.
  // EC — `modalMode` tracks WHICH dataset the modal is showing:
  //   "hero" = pulls containing the hero (gold-badge source)
  //   "teal" = pulls or days where teal selection co-occurred
  //   "slot-card" — EJ16, pulls containing a specific slot card
  //     (clicked on the rank or count box at the bottom of any
  //     slot card). cardId stored in `modalCardId`.
  // Defaults to "hero" so legacy call sites that just open the modal
  // get hero behavior.
  const [readingsModalOpen, setReadingsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"hero" | "teal" | "slot-card">("hero");
  const [modalCardId, setModalCardId] = useState<number | null>(null);

  // DR — unsaved-changes confirm. When the seeker has at least one pick
  // placed and tries to leave the page, prompt before navigating.
  // Skipped entirely when LS_SUPPRESS_LEAVE_KEY is set.
  const [unsavedConfirm, setUnsavedConfirm] = useState<{
    open: boolean;
    action: (() => void) | null;
  }>({ open: false, action: null });

  const requestNavigate = (action: () => void) => {
    let suppressed = false;
    try {
      suppressed = window.localStorage.getItem(LS_SUPPRESS_LEAVE_KEY) === "1";
    } catch {
      /* swallow */
    }
    if (suppressed || picks.length === 0) {
      action();
      return;
    }
    setUnsavedConfirm({ open: true, action });
  };

  // DZ — load a reading from the journal into the /constellation surface.
  // Guards against unsaved changes via the same requestNavigate gate so
  // the seeker can permanently dismiss the warning.
  const performLoadReading = async (readingId: string) => {
    try {
      const { data: row, error } = await supabase
        .from("readings")
        .select("id, created_at, card_ids, card_orientations, question, note")
        .eq("id", readingId)
        .maybeSingle();
      if (error || !row) {
        console.error("[ConstellationPage] load reading failed", error);
        return;
      }
      const ids = (row.card_ids ?? []) as number[];
      const ors = (row.card_orientations ?? []) as boolean[];
      const newPicks = ids.map((cardId, i) => ({
        id: Date.now() + i,
        cardIndex: cardId,
        isReversed: ors[i] ?? false,
        deckId: null,
        cardName: TAROT_DECK[cardId] ?? null,
      }));
      setPicks(newPicks);
      setFocusedSlotIdx(newPicks.length > 0 ? 0 : null);
      setTealSelectedIds([]);
      setQuestion((row.question as string | null) ?? "");
      setNote((row.note as string | null) ?? "");
      setBackdate(row.created_at ? new Date(row.created_at) : null);
      setAiStatus("idle");
      setAiInterpretation(null);
      setAiError(null);
      setSaveStatus("idle");
      setSaveError(null);
      setDayPopover({ open: false, date: null });
    } catch (e) {
      console.error("[ConstellationPage] load reading threw", e);
    }
  };

  const handleLoadReading = (readingId: string) => {
    requestNavigate(() => {
      void performLoadReading(readingId);
    });
  };

  // v2.57 — open a reading in the Journal. Reuses the existing sessionStorage
  // handoff (/journal reads "tarotseed:open-reading-id" on mount and opens it).
  const handleOpenInJournal = (readingId: string) => {
    requestNavigate(() => {
      try {
        window.sessionStorage.setItem("tarotseed:open-reading-id", readingId);
      } catch {
        /* swallow */
      }
      navigate({ to: "/journal" });
    });
  };

  // DR — slot row size computed from container width. Clamped between
  // COMPACT_SLOT_MIN_W and COMPACT_SLOT_MAX_W so layouts stay sane on both
  // 1024px and ≥1280px viewports.
  // EJ12 — slot row bumped 10 → 12 to fit the Year Ahead spread.
  const slotRowRef = useRef<HTMLDivElement | null>(null);
  const [slotW, setSlotW] = useState<number>(48);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = slotRowRef.current;
    if (!el) return;
    const compute = () => {
      const total = el.clientWidth;
      if (total <= 0) return;
      // EJ12 — 11 gaps for 12 slots (was 9 gaps for 10).
      const target = Math.floor((total - COMPACT_SLOT_GAP * 11) / 12);
      const clamped = Math.max(COMPACT_SLOT_MIN_W, Math.min(COMPACT_SLOT_MAX_W, target));
      setSlotW(clamped);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const slotH = Math.round(slotW * COMPACT_SLOT_AR);

  const heroIdx =
    picks.length === 0
      ? null
      : focusedSlotIdx !== null && focusedSlotIdx < picks.length
        ? focusedSlotIdx
        : picks.length - 1;
  const heroPick = heroIdx === null ? null : picks[heroIdx];

  // EJ9 — slot → constellation drag state.
  // `dragOverConstellationCardId` is the constellation card currently
  // under the cursor during a drag (hero or companion); drives the
  // subtle drop-target highlight in ConstellationWeb.
  // `companionOverrides` is a session-only map: companion position index
  // (0..6) → cardId. Applied client-side over the fetched constellation
  // before passing to ConstellationWeb. Wiped whenever the hero changes
  // (see effect alongside teal reset). Never persisted.
  const [dragOverConstellationCardId, setDragOverConstellationCardId] = useState<number | null>(
    null,
  );
  const [companionOverrides, setCompanionOverrides] = useState<Map<number, number>>(
    () => new Map(),
  );

  // EJ12 — selected tarot spread type (drives the labels under the slot
  // row). Default "none" = no labels. Persists per device in
  // localStorage so the seeker doesn't have to re-pick after navigation.
  // SSR-safe: server renders "none"; client hydrates from storage in an
  // effect post-mount.
  const [spreadKey, setSpreadKey] = useState<SpreadKey>("none");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SPREAD_STORAGE_KEY);
      if (!raw) return;
      const valid = SPREADS.some((s) => s.key === raw);
      if (valid) setSpreadKey(raw as SpreadKey);
    } catch {
      /* ignore */
    }
  }, []);
  const setSpreadKeyPersisted = useCallback((next: SpreadKey) => {
    setSpreadKey(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SPREAD_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);
  const spread = getSpread(spreadKey);

  // Reset teal selection whenever the hero changes — the constellation web
  // re-renders against the new hero's top companions, so prior teal cards
  // may not even be present anymore. DP — skip on initial mount so persisted
  // teal selection survives the first render's hero resolution.
  // EJ9 — also wipe companionOverrides on hero change. The override map is
  // keyed by companion position relative to a specific hero; when the hero
  // changes the positions map to different companions, so the overrides
  // wouldn't make sense to carry forward.
  const heroInitRef = useRef(true);
  // v3.37 — when an asterism row is tapped in All Patterns, its group is stashed
  // here so this hero-change effect RE-APPLIES the teal selection instead of
  // wiping it. Loading the group makes its first card the hero, which fires this
  // effect; without the stash it would clear teal a beat after the drill-down
  // set it, killing the green trace. Mirrors the activePattern-preservation
  // exception on the hero-change effect above.
  const pendingAsterismTealRef = useRef<number[] | null>(null);
  useEffect(() => {
    if (heroInitRef.current) {
      heroInitRef.current = false;
      return;
    }
    if (pendingAsterismTealRef.current) {
      setTealSelectedIds(pendingAsterismTealRef.current);
      pendingAsterismTealRef.current = null;
    } else {
      setTealSelectedIds([]);
    }
    setCompanionOverrides(new Map());
  }, [heroPick?.cardIndex]);

  // 1. Chip stats
  const [cardStats, setCardStats] = useState<QuickLogCardStats | null>(null);
  useEffect(() => {
    if (!user?.id || !heroPick) {
      setCardStats(null);
      return;
    }
    let cancelled = false;
    void getQuickLogCardStats({
      data: { cardId: heroPick.cardIndex, tz: effectiveTz, filters: filterPayload },
    })
      .then((d) => {
        if (!cancelled) setCardStats(d);
      })
      .catch(() => {
        if (!cancelled) setCardStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz, heroPick, filterKey, filterPayload]);

  // 2. Overlap (calendar strip)
  const [overlap, setOverlap] = useState<QuickLogOverlap | null>(null);
  // ED — SSR-safe default; hydrated from localStorage in the
  // hydratedFromStorageRef effect above.
  const [overlapMode, setOverlapMode] = useState<"pull" | "day">("pull");
  // EF3 — Hide/Show older calendar row state, lifted up from OverlapStrip
  // so the pill row can live under the notes area (separate from the
  // calendar container).
  // EJ25 — persists across sessions via localStorage. Pure UI state
  // (not seeker-owned data), so no Supabase round-trip needed. Each
  // seeker's preference rehydrates immediately on mount via lazy init.
  const [showOlder, setShowOlder] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("tarotseed:show-older") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("tarotseed:show-older", showOlder ? "true" : "false");
    } catch {
      // localStorage write failures (private mode, full storage) are
      // non-fatal — the toggle still works in-session.
    }
  }, [showOlder]);
  // EJ65 — Recent (newer 6 months) calendar row visibility. Defaults
  // to true (showing newer row). When false AND showOlder is also
  // false → 0 rows visible. When false AND showOlder is true → that
  // case should not occur in normal cycling (we step through none →
  // recent → both → none), but we tolerate it: if showRecent=false &&
  // showOlder=true the OverlapStrip still renders only the older row.
  // Persists across sessions.
  const [showRecent, setShowRecent] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const v = window.localStorage.getItem("tarotseed:show-recent");
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("tarotseed:show-recent", showRecent ? "true" : "false");
    } catch {
      // ignore
    }
  }, [showRecent]);
  // EJ65 — Calendar cycler. Three states: 0 rows ("none"), 1 row
  // ("recent" only), 2 rows ("both"). The PageMenu's calendar cycle
  // button advances through them: none → recent → both → none. The
  // underlying showRecent + showOlder booleans are the source of
  // truth so the OverlapStrip render logic stays consistent.
  const calendarState: "none" | "recent" | "both" = !showRecent
    ? "none"
    : showOlder
      ? "both"
      : "recent";
  const cycleCalendar = () => {
    if (calendarState === "none") {
      setShowRecent(true);
      setShowOlder(false);
    } else if (calendarState === "recent") {
      setShowRecent(true);
      setShowOlder(true);
    } else {
      // both → none
      setShowRecent(false);
      setShowOlder(false);
    }
  };

  // EJ65 — Left fly-out page menu state. ConstellationPage's config
  // items: VIEW SWAP (switch to Card Draw Table) and HIDE/SHOW
  // (calendar 0/1/2 cycler).
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const calendarCycleLabel =
    calendarState === "none" ? "Hidden" : calendarState === "recent" ? "1 row" : "2 rows";
  // EJ70 — pageMenuSections is built AFTER handleClearAll (below) so the
  // Actions → "Clear all picks" item can reference it without hitting the
  // temporal dead zone. See the const just below handleClearAll.
  // EJ25 — true while seeker hovers the asterism (teal) badge. When true,
  // every calendar day-cell that has the trace stroke (all asterism
  // cards co-occurred) swaps its fill from gold heatmap to solid trace
  // color, completely overriding the heatmap. This makes the qualifying
  // days unmistakable while the seeker scans the badge's tooltip.
  const [asterismBadgeHovered, setAsterismBadgeHovered] = useState(false);
  useEffect(() => {
    if (!user?.id) {
      setOverlap(null);
      return;
    }
    let cancelled = false;
    void getQuickLogOverlap({
      data: {
        heroCardId: heroPick?.cardIndex ?? null,
        tz: effectiveTz,
        filters: filterPayload,
      },
    })
      .then((d) => {
        if (!cancelled) setOverlap(d);
      })
      .catch(() => {
        if (!cancelled) setOverlap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz, filterKey, filterPayload]);

  // 3. Constellation data
  const [constellationData, setConstellationData] = useState<CardConstellation | null>(null);
  useEffect(() => {
    if (!user?.id || !heroPick) {
      setConstellationData(null);
      return;
    }
    let cancelled = false;
    void getCardConstellation({
      data: {
        heroCardId: heroPick.cardIndex,
        tz: effectiveTz,
        filters: filterPayload,
      },
    })
      .then((d) => {
        if (!cancelled) setConstellationData(d);
      })
      .catch(() => {
        if (!cancelled) setConstellationData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz, filterKey, filterPayload]);

  const placedIds = picks.map((p) => p.cardIndex);

  // EJ9 — apply session-only companionOverrides to the fetched
  // constellation. The override map is keyed by companion position index
  // (0..6) → cardId. For each override entry:
  //   - If the cardId is already at another companion index in the
  //     fetched constellation, swap those two entries (positions swap
  //     visually). Pair counts are keyed by cardId so they automatically
  //     follow the swap.
  //   - Otherwise replace the entry at that position with a synthetic
  //     companion: { cardId, coCount: 0, lifetimeCount: 0 }. The
  //     displaced companion drops out of the visible constellation; any
  //     lines that referenced the displaced card disappear because its
  //     cardId is no longer in any `companions` entry. The new card has
  //     no lines because pairCounts (computed server-side) doesn't
  //     include the new card in its node set.
  //
  // The fetched constellationData is never mutated — a shallow copy is
  // built each render with a new `companions` array.
  const displayedConstellation = useMemo(() => {
    if (!constellationData) return null;
    if (companionOverrides.size === 0) return constellationData;
    const next = [...constellationData.companions];
    for (const [posIdx, cardId] of companionOverrides) {
      if (posIdx < 0 || posIdx >= next.length) continue;
      const currentAtPos = next[posIdx];
      if (!currentAtPos) continue;
      if (currentAtPos.cardId === cardId) continue;
      const existingIdx = next.findIndex((c) => c.cardId === cardId);
      if (existingIdx !== -1) {
        // Swap the two entries.
        const tmp = next[posIdx];
        next[posIdx] = next[existingIdx];
        next[existingIdx] = tmp;
      } else {
        // Replace with a synthetic companion. Caller knows ×N will be
        // 0 because we don't have the dropped card's coCount data
        // client-side; the spec accepts this as the trade-off for
        // session-only override without a server round-trip.
        next[posIdx] = {
          cardId,
          coCount: 0,
          lifetimeCount: 0,
        };
      }
    }
    // EJ16 — supplemental pair counts for cards added via override.
    // When a NEW card is dropped onto a companion position, the
    // server's pairCounts has no entries for it (server only
    // returns pairs among the original top-7 + hero). Without
    // supplemental data, the new card renders as an island — no
    // lines to or from it. Here we scan the same readingsByDate
    // that powers the calendar, derive co-occurrence counts
    // between the dropped card and every other constellation node
    // (hero + other companions), and append those as pair entries.
    // The math matches the calendar: same filtered universe, same
    // co-occurrence definition (per the active pull/day mode is
    // not relevant here — pair counts are reading-level which is
    // what pairCounts always was).
    const supplementalPairs: Array<{ a: number; b: number; count: number }> = [];
    if (overlap?.readingsByDate) {
      // All constellation card IDs (hero + final companions).
      const nodeIds = new Set<number>([constellationData.heroCardId, ...next.map((c) => c.cardId)]);
      // Which override-added cards need supplemental pair data?
      // A card needs supplements if it wasn't in the original
      // server-side pairCounts at all (because pairCounts has no
      // entries mentioning it). Card IDs from the original
      // server data appear in some pair as either `a` or `b`.
      const idsInOriginalPairs = new Set<number>();
      for (const p of constellationData.pairCounts) {
        idsInOriginalPairs.add(p.a);
        idsInOriginalPairs.add(p.b);
      }
      idsInOriginalPairs.add(constellationData.heroCardId);
      const needsSupplement: number[] = [];
      for (const id of nodeIds) {
        if (!idsInOriginalPairs.has(id)) needsSupplement.push(id);
      }
      if (needsSupplement.length > 0) {
        // Build a co-occurrence count map for each (supplemental, other) pair.
        const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
        const counts = new Map<string, number>();
        const allReadings = Object.values(overlap.readingsByDate).flat();
        for (const r of allReadings) {
          const cardSet = new Set(r.cardIds);
          for (const supp of needsSupplement) {
            if (!cardSet.has(supp)) continue;
            for (const other of nodeIds) {
              if (other === supp) continue;
              if (!cardSet.has(other)) continue;
              const k = pairKey(supp, other);
              counts.set(k, (counts.get(k) ?? 0) + 1);
            }
          }
        }
        for (const [k, count] of counts) {
          const [aStr, bStr] = k.split("-");
          supplementalPairs.push({ a: Number(aStr), b: Number(bStr), count });
        }
      }
    }

    return {
      ...constellationData,
      companions: next,
      pairCounts:
        supplementalPairs.length > 0
          ? [...constellationData.pairCounts, ...supplementalPairs]
          : constellationData.pairCounts,
    };
  }, [constellationData, companionOverrides, overlap]);

  // EK101 — Atlas all-pairs co-occurrence. Only computed in atlas mode
  // (the 78-card clock). Scans the filtered universe (overlap.readingsByDate)
  // and counts, for every unordered pair of standard (0..77) cards, how
  // many readings the two share. This is the line data for the clock web.
  // The server-side pairCounts on constellationData is hero-scoped, so it
  // can't feed an all-cards view — but the calendar already loads the full
  // reading history, so we derive the pairs here without a new server call.
  const atlasPairs = useMemo(() => {
    if (!atlasMode || !overlap?.readingsByDate)
      return [] as Array<{ a: number; b: number; count: number }>;
    const counts = new Map<string, number>();
    for (const readings of Object.values(overlap.readingsByDate)) {
      for (const r of readings) {
        const ids = Array.from(
          new Set(r.cardIds.filter((id) => id >= 0 && id <= 77)),
        ).sort((a, b) => a - b);
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const k = `${ids[i]}-${ids[j]}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
      }
    }
    const out: Array<{ a: number; b: number; count: number }> = [];
    for (const [k, count] of counts) {
      const [a, b] = k.split("-").map(Number);
      out.push({ a, b, count });
    }
    return out;
  }, [atlasMode, overlap]);

  // EK104 — Atlas teal-discovery candidates. Same co-occurrence test as
  // `candidateIds` (below) but the pool is ALL 78 cards, not just the
  // hero + 7 companions — so on the full ring the teal lines can reach
  // any card that co-occurred with the whole selected set. Only runs in
  // atlas mode with 2+ cards selected.
  // EK131 — full/new moon day sets (UTC keys), same source as the calendar's
  // moon icons. Moon tokens honor these marked days (the full 24h).
  const atlasMoonDays = useMemo(() => {
    const full = new Set<string>();
    const nw = new Set<string>();
    if (!atlasMode) return { full, nw };
    const DAY_MS = 86400000;
    const from = new Date(Date.now() - 13 * 30 * DAY_MS);
    for (const d of getPhaseOccurrences("Full Moon", from, 15))
      full.add(isoDayInTz(d, "UTC"));
    for (const d of getPhaseOccurrences("New Moon", from, 15))
      nw.add(isoDayInTz(d, "UTC"));
    return { full, nw };
  }, [atlasMode]);
  const daysForMoonPhase = (phase: string): Set<string> =>
    phase === "Full Moon" ? atlasMoonDays.full : atlasMoonDays.nw;

  // EK131 — the live tray is one "matches all" section; committed sections
  // follow. The asterism matches a reading/day when EVERY section is met.
  const allAtlasSections = useMemo<AtlasSection[]>(() => {
    const out: AtlasSection[] = [];
    if (atlasTray.length > 0)
      out.push({ uid: "__tray", mode: "all", tokens: atlasTray });
    for (const s of atlasSections) out.push(s);
    return out;
  }, [atlasTray, atlasSections]);
  const hasAtlasAsterism = allAtlasSections.length > 0;

  const atlasTokenSatisfied = useCallback(
    (tk: AtlasToken, cards: Set<number>, dayDate: string): boolean => {
      if (tk.t === "moon") return daysForMoonPhase(tk.phase).has(dayDate);
      return atlasTokenCardIds(tk).some((id) => cards.has(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [atlasMoonDays],
  );
  const atlasSectionSatisfied = useCallback(
    (sec: AtlasSection, cards: Set<number>, dayDate: string): boolean => {
      if (sec.tokens.length === 0) return true;
      return sec.mode === "all"
        ? sec.tokens.every((tk) => atlasTokenSatisfied(tk, cards, dayDate))
        : sec.tokens.some((tk) => atlasTokenSatisfied(tk, cards, dayDate));
    },
    [atlasTokenSatisfied],
  );
  const atlasAsterismSatisfied = useCallback(
    (cards: Set<number>, dayDate: string): boolean =>
      allAtlasSections.every((sec) =>
        atlasSectionSatisfied(sec, cards, dayDate),
      ),
    [allAtlasSections, atlasSectionSatisfied],
  );

  // EK131 — discovery-hint candidates: cards that, if dropped into the tray,
  // the asterism still co-occurs with somewhere in the filtered universe.
  const atlasCandidateIds = useMemo<number[]>(() => {
    if (!atlasMode || !overlap || !hasAtlasAsterism) return [];
    const inUse = new Set<number>();
    for (const sec of allAtlasSections)
      for (const id of atlasSectionCardIds(sec)) inUse.add(id);
    const result: number[] = [];
    for (let cardId = 0; cardId <= 77; cardId++) {
      if (inUse.has(cardId)) continue;
      let hit = false;
      outer: for (const m of overlap.months) {
        for (const day of m.days) {
          if (day == null) continue;
          if (overlapMode === "day") {
            const sameDay = new Set(day.sameDayCardIds);
            if (
              atlasAsterismSatisfied(sameDay, day.date) &&
              sameDay.has(cardId)
            ) {
              hit = true;
              break outer;
            }
          } else {
            const readings = overlap.readingsByDate?.[day.date] ?? [];
            for (const r of readings) {
              const ids = new Set(r.cardIds);
              if (atlasAsterismSatisfied(ids, day.date) && ids.has(cardId)) {
                hit = true;
                break outer;
              }
            }
          }
        }
      }
      if (hit) result.push(cardId);
    }
    return result;
  }, [
    atlasMode,
    overlap,
    overlapMode,
    hasAtlasAsterism,
    allAtlasSections,
    atlasAsterismSatisfied,
  ]);

  // EK131 — every specific card that's part of the asterism (tray + committed
  // section tokens, cards/suits/ranks expanded). Drives the teal rings + line
  // anchors on the clock. Moon tokens are day-level, not cards, so excluded.
  const atlasSelectedCardIds = useMemo<number[]>(() => {
    if (!atlasMode) return [];
    const out = new Set<number>();
    for (const sec of allAtlasSections)
      for (const id of atlasSectionCardIds(sec)) out.add(id);
    return [...out];
  }, [atlasMode, allAtlasSections]);

  // EK131 — per-card ring color by section membership. Tray cards fall
  // through to the default teal; each committed section gets a distinct hue
  // so the clock shows the grouping at a glance.
  const atlasCardGroupColor = useMemo<Record<number, string>>(() => {
    const PALETTE = ["#5cead4", "#e0a3ff", "#ffd27d", "#86c5ff", "#ff9eb5"];
    const map: Record<number, string> = {};
    atlasSections.forEach((sec, si) => {
      const col = PALETTE[si % PALETTE.length];
      for (const id of atlasSectionCardIds(sec)) map[id] = col;
    });
    return map;
  }, [atlasSections]);

  // EK131 — section-aware match across the filtered universe. Returns the
  // set of matching day keys (for the calendar stroke) and a count (pulls
  // in same-pull mode, days in same-day mode) for the badge. Every section
  // (live tray + committed chips) must be satisfied.
  const atlasMatch = useMemo<{ ymds: Set<string>; count: number }>(() => {
    if (!atlasMode || !hasAtlasAsterism || !overlap)
      return { ymds: new Set<string>(), count: 0 };
    const ymds = new Set<string>();
    let count = 0;
    for (const m of overlap.months) {
      for (const day of m.days) {
        if (day == null) continue;
        if (overlapMode === "day") {
          const sameDay = new Set(day.sameDayCardIds);
          if (atlasAsterismSatisfied(sameDay, day.date)) {
            ymds.add(day.date);
            count++;
          }
        } else {
          const readings = overlap.readingsByDate?.[day.date] ?? [];
          let dayHit = false;
          for (const r of readings) {
            if (atlasAsterismSatisfied(new Set(r.cardIds), day.date)) {
              count++;
              dayHit = true;
            }
          }
          if (dayHit) ymds.add(day.date);
        }
      }
    }
    return { ymds, count };
  }, [atlasMode, hasAtlasAsterism, atlasAsterismSatisfied, overlap, overlapMode]);

  // EK134 — pattern detection on the matched (stroked) days. Pure + chance-
  // gated in @/lib/atlas-patterns; recomputes live as the asterism or filters
  // change. Returns [] when nothing beats chance, which hides the panel.
  const atlasPatterns = useMemo<AtlasPattern[]>(() => {
    if (!atlasMode || !hasAtlasAsterism) return [];
    const tr = globalFilters.timeRange ?? DEFAULT_TIMEFRAME;
    const m = /^(\d+)d$/.exec(tr);
    const stroked = [...atlasMatch.ymds];
    let windowDays = m ? Number(m[1]) : 365;
    if (!m && stroked.length > 0) {
      // "all time" — span from earliest matched day to today, min 365.
      const earliest = stroked.slice().sort()[0];
      const span = Math.abs(
        calendarDaysBetween(parseIsoDay(earliest, "UTC"), new Date(), "UTC"),
      );
      windowDays = Math.max(365, span);
    }
    return detectAtlasPatterns({
      strokedDays: stroked,
      windowDays,
      moonFullDays: atlasMoonDays.full,
      moonNewDays: atlasMoonDays.nw,
      todayYmd: isoDayInTz(new Date(), "UTC"),
    });
  }, [atlasMode, hasAtlasAsterism, atlasMatch.ymds, atlasMoonDays, globalFilters.timeRange]);

  const atlasMatchedReadings = useMemo(() => {
    if (!atlasMode || !hasAtlasAsterism || !overlap) return [];
    const out: Array<{
      id: string;
      createdAt: string;
      question: string | null;
      cardIds: number[];
      moonPhase: string | null;
    }> = [];
    for (const [date, readings] of Object.entries(overlap.readingsByDate)) {
      if (overlapMode === "pull") {
        for (const r of readings) {
          if (atlasAsterismSatisfied(new Set(r.cardIds), date)) out.push(r);
        }
      } else {
        const sameDayCards = new Set<number>();
        for (const r of readings) for (const id of r.cardIds) sameDayCards.add(id);
        if (atlasAsterismSatisfied(sameDayCards, date)) out.push(...readings);
      }
    }
    return out;
  }, [atlasMode, hasAtlasAsterism, atlasAsterismSatisfied, overlap, overlapMode]);

  // EK131 — human-readable description of the asterism (tray + committed
  // sections), shared by the badge tooltip and the readings-modal title.
  const atlasAsterismNames = useMemo(() => {
    return allAtlasSections
      .map((sec) => atlasSectionLabel(sec))
      .filter(Boolean)
      .join(", ");
  }, [allAtlasSections]);

  // EK108 — calendar preview stroke days for the currently-hovered rank or
  // suit chip: every day any card of that rank/suit was drawn, per pill.
  const atlasHoverYmds = useMemo<Set<string> | undefined>(() => {
    if (!atlasMode || !atlasHoverChip || !overlap) return undefined;
    const target = new Set(atlasHoverChip);
    const ymds = new Set<string>();
    for (const m of overlap.months) {
      for (const day of m.days) {
        if (day == null) continue;
        if (overlapMode === "day") {
          if (day.sameDayCardIds.some((id) => target.has(id))) ymds.add(day.date);
        } else {
          const readings = overlap.readingsByDate?.[day.date] ?? [];
          if (readings.some((r) => r.cardIds.some((id) => target.has(id))))
            ymds.add(day.date);
        }
      }
    }
    return ymds;
  }, [atlasMode, atlasHoverChip, overlap, overlapMode]);

  // EK131 — clock click in atlas mode toggles a card token in the live tray.
  const handleAtlasCardClick = (cardId: number) => {
    const key = `card:${cardId}`;
    if (atlasTray.some((p) => atlasTokenKey(p) === key)) removeAtlasToken(key);
    else addAtlasToken({ t: "card", cardId });
  };

  // EK131 — empty the whole asterism: live tray + committed sections.
  const handleAtlasClear = () => {
    setAtlasTray([]);
    setAtlasSections([]);
  };

  // EJ9 — handler invoked when a slot card is dropped onto a constellation
  // card (hero or companion). `targetCardId` identifies the constellation
  // position (cardId at that position); `droppedCardId` is the card from
  // the slot drag.
  const handleConstellationDrop = (targetCardId: number, droppedCardId: number) => {
    setDragOverConstellationCardId(null);
    if (!Number.isFinite(droppedCardId) || droppedCardId < 0) return;
    if (!displayedConstellation) return;

    // Identify drop target type by the cardId-at-position.
    const isHeroPosition = targetCardId === displayedConstellation.heroCardId;
    const droppedIsHero = droppedCardId === displayedConstellation.heroCardId;

    if (isHeroPosition) {
      // Drop on hero position == "make this card the hero." Behaves
      // identically to clicking the dropped card's slot to promote it.
      // The dropped card MUST be in picks (since the drag originated
      // from a slot). If for any reason it isn't, this is a no-op.
      const slotIdx = picks.findIndex((p) => p.cardIndex === droppedCardId);
      if (slotIdx !== -1) {
        setFocusedSlotIdx(slotIdx);
      }
      return;
    }

    if (droppedIsHero) {
      // Drop the CURRENT hero onto a companion position. Per spec: swap
      // — the target card becomes the new hero. If the target card is
      // already in picks, focus that slot. Otherwise add the target
      // card to picks (so a slot exists to focus), then focus it.
      // Wiping companionOverrides happens automatically via the
      // hero-change useEffect.
      const targetSlotIdx = picks.findIndex((p) => p.cardIndex === targetCardId);
      if (targetSlotIdx !== -1) {
        setFocusedSlotIdx(targetSlotIdx);
      } else {
        // Append target to picks, then focus the new slot.
        setPicks((prev) => {
          const next = [...prev];
          next.push({
            id: Date.now(),
            cardIndex: targetCardId,
            isReversed: false,
            deckId: null,
            cardName: TAROT_DECK[targetCardId] ?? null,
          });
          setFocusedSlotIdx(next.length - 1);
          return next;
        });
      }
      return;
    }

    // Drop on a companion position (non-hero target, non-hero dropped).
    // Locate the target's position in the displayed companions array;
    // that's the slot we're overriding.
    const targetPosIdx = displayedConstellation.companions.findIndex(
      (c) => c.cardId === targetCardId,
    );
    if (targetPosIdx === -1) return;

    // No-op if the dropped card already sits at the target position.
    if (displayedConstellation.companions[targetPosIdx]?.cardId === droppedCardId) {
      return;
    }

    setCompanionOverrides((prev) => {
      const next = new Map(prev);
      next.set(targetPosIdx, droppedCardId);
      return next;
    });
  };

  // Phase 23 Fix 5 — per-card draw counts for slot badges.
  const [drawCounts, setDrawCounts] = useState<CardDrawCounts | null>(null);
  const cardIdsKey = picks.map((p) => p.cardIndex).join(",");

  // DW — relative max ACROSS the current picks (not the seeker's global
  // max). Makes the slot badge tinting a usable relative-intensity scan
  // against the calendar — the loudest card in this pull is full, the
  // others scale relative to it. Fixes the "always full opacity" bug
  // that showed up when one card happened to be the global max.
  const picksMax = useMemo(() => {
    if (!drawCounts) return 0;
    let m = 0;
    for (const p of picks) {
      const c = drawCounts.perCard[p.cardIndex] ?? 0;
      if (c > m) m = c;
    }
    return m;
  }, [drawCounts, picks]);

  // DY — hover-card tooltip for constellation cards. Cursor coords drive
  // tooltip position (offset slightly so it doesn't sit under the cursor).
  // Mobile is skipped — hover events don't fire on touch devices.
  const [hoverCardId, setHoverCardId] = useState<number | null>(null);
  // EK91 — a connecting line (pair of cards) being hovered. While set, the
  // calendar rings the days those two cards co-occurred (per the pill),
  // taking precedence over single-card hover.
  const [hoveredPair, setHoveredPair] = useState<{ a: number; b: number } | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const handleConstellationHover = (
    cardId: number | null,
    clientX: number,
    clientY: number,
    targetRect?: DOMRect | null,
  ) => {
    // EK132 — atlas readout preview: hovering a clock card tentatively ANDs
    // it into the tray for the readout's faint preview clause only.
    if (atlasMode)
      setAtlasPreviewToken(cardId !== null ? { t: "card", cardId } : null);
    if (cardId !== null) {
      // EK57 — badge precedence. While a hero/asterism badge is hovered,
      // do NOT open the card-meaning popover, and cancel any pending
      // open timer. The badge popover (set by its own hover handler)
      // wins. Read from a ref so it's accurate within the same mousemove.
      if (badgeHoveredRef.current) {
        window.clearTimeout(slimHoverDelayRef.current);
        return;
      }
      cancelPopoverDismiss();
      // EK58 — stroke the calendar IMMEDIATELY on hover, decoupled from
      // the popover's 450ms intentional-hover delay below. The card
      // popover still waits 450ms; only the calendar stroke is instant.
      setHoverCardId(cardId);
      // EJ24 — hover delay applied at this single chokepoint so every
      // hover source (slot row, constellation hero, constellation
      // companions) gets the same 450ms intentional-hover delay. If
      // the cursor leaves before the timer fires, the timer is cleared
      // and the popover never opens — preventing accidental flashes
      // from quick cursor passes.
      //
      // If the popover is already open for THIS card, skip the delay
      // entirely (we're just refreshing the anchor on mousemove).
      const alreadyOpenForThisCard =
        activePopover?.kind === "card-meaning" && activePopover.key === String(cardId);
      const openPopover = () => {
        setActivePopover((prev) => {
          if (prev && prev.kind === "card-meaning" && prev.key === String(cardId)) {
            // EJ70 — Once the popover is open for THIS card, do NOT chase
            // the cursor. Updating anchorX/anchorY on every same-card
            // mousemove reset RichPopover's locked position (its
            // [anchorX, anchorY] effect), which flipped the popover
            // between above/below the card — the "flicker from top to
            // bottom" the seeker reported. Keeping the original anchor
            // holds the popover steady; the only thing that re-anchors it
            // now is moving to a DIFFERENT card (a new key).
            return prev;
          }
          // EJ18 — trigger the lazy popover data fetch when a
          // card-meaning popover opens for the first time per
          // filter window. ensurePopoverData() is idempotent.
          ensurePopoverData();
          // EJ22 — a new card popover opens in slim mode by default.
          // EJ23 — UNLESS we're in edit mode, in which case we stay
          // in rich mode so the seeker's edits persist as they hover
          // between cards. Edit mode is intentionally sticky.
          if (!popoverEditMode) {
            setPopoverMode("slim");
          } else {
            setPopoverMode("rich");
          }
          return {
            kind: "card-meaning",
            key: String(cardId),
            anchorX: clientX,
            anchorY: clientY,
            targetRect: targetRect ?? null,
          };
        });
      };
      window.clearTimeout(slimHoverDelayRef.current);
      if (alreadyOpenForThisCard) {
        openPopover();
      } else {
        slimHoverDelayRef.current = window.setTimeout(openPopover, 450);
      }
    } else {
      // EH — schedule, don't immediately close. Lets the cursor travel
      // to the popover and the ⓘ icon without dismissing.
      // EJ24 — also clear any pending OPEN delay so a quick mouse-pass
      // over a card doesn't trigger the popover after the cursor has
      // already left.
      window.clearTimeout(slimHoverDelayRef.current);
      // EK57 — clear the calendar hover stroke when the cursor leaves.
      setHoverCardId(null);
      schedulePopoverDismiss("card-meaning");
    }
  };

  // EG — unified popover state. Only one rich popover is visible at a
  // time. Whichever popover most recently claimed it is the one that
  // renders; the others (whose source-element hover state may also be
  // active) are suppressed until they reclaim the slot.
  //
  // Kinds:
  //   "card-meaning" — constellation card hover (TAROT_MEANINGS)
  //   "badge-hint"   — slot card badge hover ("appeared in N readings")
  //   "day-cell"     — calendar day cell hover / long-press
  type ActivePopoverKind =
    | "card-meaning"
    | "badge-hint"
    | "day-cell"
    | "chip-hint"
    | "constellation-badge"
    | "slot-label";
  // EG — payload varies by kind. badge-hint stores count + card name
  // so the popover can render without re-looking-up picks. day-cell
  // stores the date so the popover can derive its narrative + signals.
  type ActivePopoverState =
    | {
        kind: "card-meaning";
        key: string;
        anchorX: number;
        anchorY: number;
        // EJ23 — optional target bounding rectangle. When present,
        // RichPopover uses preferred-placement positioning (above
        // the card) instead of cursor-anchored placement, so the
        // popover never overlaps the card or its badges.
        targetRect?: DOMRect | null;
      }
    | {
        kind: "badge-hint";
        key: string;
        anchorX: number;
        anchorY: number;
        count: number;
        cardName: string;
      }
    | {
        kind: "day-cell";
        key: string;
        anchorX: number;
        anchorY: number;
        // EJ28 — target rect for preferred-placement positioning.
        // Without this, RichPopover falls back to cursor-anchored
        // placement which overlaps 20px day cells and intercepts clicks.
        targetRect: DOMRect | null;
        date: string;
        signals: DayCellSignals;
        tooltipText: string;
      }
    | {
        kind: "chip-hint";
        key: string;
        anchorX: number;
        anchorY: number;
        label: string;
        tooltip: string;
      }
    | {
        kind: "constellation-badge";
        key: string;
        anchorX: number;
        anchorY: number;
        // "hero" = gold hero badge; "teal" = teal selection badge
        variant: "hero" | "teal";
        count: number;
        modeOrPullsLabel: string;
        cardLabel: string;
      }
    | {
        // EJ15 — slot label hover popover. Surfaces the full slot
        // name and a paragraph-length explanation of what that slot
        // represents in the currently-selected spread.
        kind: "slot-label";
        key: string;
        anchorX: number;
        anchorY: number;
        slotName: string;
        spreadLabel: string;
        meaning: string;
      };
  // EJ28 — slot-rank-box and slot-count-box kinds removed alongside
  // the numbers row under each card slot. The row was dropped per
  // user feedback; the popover handlers are no longer reachable.
  const [activePopover, setActivePopover] = useState<ActivePopoverState | null>(null);
  // EH — shared dismiss timer for the unified popover. Used by source
  // mouseLeave handlers AND by the popover itself so the cursor can
  // travel from source → popover without dismissing. Both schedule
  // and both can cancel.
  const popoverDismissTimerRef = useRef<number | null>(null);
  const cancelPopoverDismiss = () => {
    if (popoverDismissTimerRef.current !== null) {
      window.clearTimeout(popoverDismissTimerRef.current);
      popoverDismissTimerRef.current = null;
    }
  };
  const schedulePopoverDismiss = (kind?: ActivePopoverKind, key?: string) => {
    cancelPopoverDismiss();
    popoverDismissTimerRef.current = window.setTimeout(() => {
      setActivePopover((prev) => {
        if (!prev) return prev;
        if (kind && prev.kind !== kind) return prev;
        if (key && prev.key !== key) return prev;
        return null;
      });
    }, 400); // EJ70 — 220 → 400ms. The popover dismissed before the
    // cursor could travel from the card to the popover, so the seeker
    // couldn't click it (the ⓘ icon, links). 400ms gives comfortable
    // travel time; the popover's own onMouseEnter cancels the dismiss
    // once reached. Industry hover-intent delays sit in the 300–500ms
    // band (Radix, Floating UI).
  };
  const closeActivePopover = (kind?: ActivePopoverKind, key?: string) => {
    cancelPopoverDismiss();
    setActivePopover((prev) => {
      if (!prev) return prev;
      // Only close if the caller "owns" the popover (same kind+key), or
      // if no specifier was passed (closes whatever's open).
      if (kind && prev.kind !== kind) return prev;
      if (key && prev.key !== key) return prev;
      return null;
    });
  };

  // DZ — calendar day-click popover. When a day cell is tapped, surface
  // a list of readings on that day; clicking a reading loads it into
  // /constellation (with the unsaved-changes guard if applicable).
  const [dayPopover, setDayPopover] = useState<{
    open: boolean;
    date: string | null;
  }>({ open: false, date: null });
  // v2.57 — which day-modal entry row is hovered (shows its drawn cards as a
  // floating thumbnail tip). Set on hover (desktop) / long-press (touch).
  const [entryHoverId, setEntryHoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id || picks.length === 0) {
      setDrawCounts(null);
      return;
    }
    let cancelled = false;
    void getCardDrawCounts({
      data: {
        cardIds: picks.map((p) => p.cardIndex),
        tz: effectiveTz,
        filters: filterPayload,
      },
    })
      .then((d) => {
        if (!cancelled) setDrawCounts(d);
      })
      .catch(() => {
        if (!cancelled) setDrawCounts(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, effectiveTz, cardIdsKey, filterKey]);

  // EJ18 — batched per-card popover data for the rich card-meaning
  // hover popover. Lazy-fetched: the first time a card-meaning popover
  // opens we fire ONE batch request for every cardId currently visible
  // (slot row + constellation hero + companions). Result cached by
  // filterKey + the set of requested IDs; subsequent hovers read from
  // the map with no extra network round-trip. Filter changes invalidate
  // the cache so the next hover refetches.
  const [popoverDataMap, setPopoverDataMap] = useState<CardPopoverDataMap | null>(null);
  // EJ18 — track which (filterKey + idsKey) combo the current map was
  // built for so we know when to refetch.
  const popoverDataCacheKeyRef = useRef<string | null>(null);
  // EJ18 — visible card ID set used as the batch request payload. The
  // set is regenerated whenever picks or the constellation changes.
  // We don't depend on this as a fetch trigger directly — fetching is
  // gated by hover, but this memo gives us a stable list to send.
  const visibleCardIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of picks) ids.add(p.cardIndex);
    if (displayedConstellation) {
      ids.add(displayedConstellation.heroCardId);
      for (const c of displayedConstellation.companions) ids.add(c.cardId);
    }
    return [...ids].sort((a, b) => a - b);
  }, [picks, displayedConstellation]);

  // v2.60 — per-card draw counts (within the active filtered universe) for the
  // web cards, so the plasma orbs can flow from the LESS-drawn card toward the
  // MORE-drawn card on each connection. Reuses getCardDrawCounts (no new fn).
  const [webCardCounts, setWebCardCounts] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!user?.id || visibleCardIds.length === 0) {
      setWebCardCounts({});
      return;
    }
    let cancelled = false;
    void getCardDrawCounts({
      data: { cardIds: visibleCardIds, tz: effectiveTz, filters: filterPayload },
    })
      .then((d) => {
        if (!cancelled) setWebCardCounts(d.perCard ?? {});
      })
      .catch(() => {
        if (!cancelled) setWebCardCounts({});
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, effectiveTz, filterKey, visibleCardIds.join(",")]);
  // EJ18 — invalidate cache when filters change.
  useEffect(() => {
    popoverDataCacheKeyRef.current = null;
    setPopoverDataMap(null);
  }, [filterKey]);
  // EJ18 — fetcher fired on first hover. Idempotent — if a request
  // is already in-flight for this cache key, skip.
  const popoverDataInFlightRef = useRef(false);
  const ensurePopoverData = useCallback(() => {
    if (!user?.id) return;
    if (visibleCardIds.length === 0) return;
    const idsKey = visibleCardIds.join(",");
    const cacheKey = `${filterKey}|${idsKey}`;
    if (popoverDataCacheKeyRef.current === cacheKey) return;
    if (popoverDataInFlightRef.current) return;
    popoverDataInFlightRef.current = true;
    void getCardPopoverData({
      data: {
        cardIds: visibleCardIds,
        tz: effectiveTz,
        filters: filterPayload,
      },
    })
      .then((d) => {
        popoverDataCacheKeyRef.current = cacheKey;
        setPopoverDataMap(d);
      })
      .catch(() => {
        // Silent failure — popover sections gracefully degrade to
        // dashed values when popoverDataMap is null.
        setPopoverDataMap(null);
      })
      .finally(() => {
        popoverDataInFlightRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, visibleCardIds, effectiveTz, filterKey]);

  // EJ19 — per-seeker visibility prefs for the card popover sections.
  // Stored in user_preferences.card_popover_sections as a flat
  // Record<sectionId, boolean>. Missing keys default to true (visible).
  // localStorage mirrors the DB so anonymous seekers and pre-hydration
  // renders get a sensible value without flicker.
  //
  // Section IDs (NOT toggleable: header is always shown):
  //   stat-strip · moon-phase · time-of-day · meanings · sparkline
  //   companions · timeline · tag-bias
  type CardPopoverSectionId =
    | "stat-strip"
    | "moon-phase"
    | "time-of-day"
    | "day-of-week"
    | "meanings"
    | "sparkline"
    | "companions"
    | "timeline"
    | "tag-bias";
  const ALL_SECTION_IDS: CardPopoverSectionId[] = [
    "stat-strip",
    "moon-phase",
    "time-of-day",
    "day-of-week",
    "meanings",
    "sparkline",
    "companions",
    "timeline",
    "tag-bias",
  ];
  const SECTION_LABELS: Record<CardPopoverSectionId, string> = {
    "stat-strip": "Stats",
    "moon-phase": "Moon phase",
    "time-of-day": "Time of day",
    "day-of-week": "Day of week",
    meanings: "Meanings",
    sparkline: "12-month frequency",
    companions: "Companions",
    timeline: "Timeline",
    "tag-bias": "Tag bias",
  };
  const CARD_POPOVER_SECTIONS_LS_KEY = "tarotseed:card-popover-sections";
  const [sectionPrefs, setSectionPrefs] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(CARD_POPOVER_SECTIONS_LS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  // EJ19 — hydrate sectionPrefs from Supabase on mount. Falls back
  // silently to the localStorage value already in state.
  const sectionPrefsHydratedRef = useRef(false);
  useEffect(() => {
    if (sectionPrefsHydratedRef.current) return;
    if (!user?.id) return;
    sectionPrefsHydratedRef.current = true;
    void supabase
      .from("user_preferences")
      .select("card_popover_sections")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return;
        const dbPrefs =
          (data as { card_popover_sections?: Record<string, boolean> } | null)
            ?.card_popover_sections ?? null;
        if (dbPrefs && typeof dbPrefs === "object") {
          setSectionPrefs(dbPrefs);
          try {
            window.localStorage.setItem(CARD_POPOVER_SECTIONS_LS_KEY, JSON.stringify(dbPrefs));
          } catch {
            /* ignore */
          }
        }
      });
  }, [user?.id]);
  // EJ19 — persist sectionPrefs. Writes localStorage immediately and
  // Supabase in the background. Called on Save button click + on
  // click-outside while edit mode is active.
  const savePopoverSectionPrefs = useCallback(
    (next: Record<string, boolean>) => {
      try {
        window.localStorage.setItem(CARD_POPOVER_SECTIONS_LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      if (!user?.id) return;
      // Upsert pattern mirrored from Hint.tsx — select, then update or
      // insert. Silent on errors so the seeker isn't bothered by
      // background sync hiccups; localStorage is the source of truth
      // in-session.
      void supabase
        .from("user_preferences")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data: existing }) => {
          if (existing) {
            return supabase
              .from("user_preferences")
              .update({ card_popover_sections: next } as never)
              .eq("user_id", user.id);
          }
          return supabase
            .from("user_preferences")
            .insert({ user_id: user.id, card_popover_sections: next } as never);
        });
    },
    [user?.id],
  );
  // EJ19 — edit mode flag. When true, the popover renders inline
  // section toggles (Stripe-style "—" buttons) and a Save button.
  // Save commits sectionPrefs via savePopoverSectionPrefs and exits
  // edit mode. Click-outside also commits and exits.
  const [popoverEditMode, setPopoverEditMode] = useState(false);
  // Section visibility helper: hidden when explicitly false in prefs.
  // Missing key = visible by default.
  const isSectionVisible = useCallback(
    (id: CardPopoverSectionId) => sectionPrefs[id] !== false,
    [sectionPrefs],
  );
  const toggleSection = useCallback((id: CardPopoverSectionId) => {
    setSectionPrefs((prev) => {
      const currentlyVisible = prev[id] !== false;
      return { ...prev, [id]: !currentlyVisible };
    });
  }, []);
  const commitPopoverEditMode = useCallback(() => {
    setPopoverEditMode(false);
    // Use the latest state via the functional setter pattern.
    setSectionPrefs((current) => {
      savePopoverSectionPrefs(current);
      return current;
    });
    setSlimItemPrefs((current) => {
      saveSlimItemPrefs(current);
      return current;
    });
  }, [savePopoverSectionPrefs]);

  // EJ22 — slim hover prefs. The slim hover card is the small chip
  // that appears when the seeker HOVERS a card (vs. clicking, which
  // opens the rich popover). It defaults to a curated set of small
  // stats: pull count, last seen, reversed %. Tracked independently
  // from sectionPrefs — an item can be visible in the rich popover
  // and hidden from the slim, or vice versa.
  //
  // Slim item IDs intentionally match section IDs for items the
  // seeker may want on either surface. Two additional pseudo-items
  // (count + last-seen + reversed) are tracked as discrete chips
  // even though they're all part of stat-strip in the rich popover:
  // on the slim they show as separate small chips.
  type SlimItemId =
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
  const ALL_SLIM_ITEM_IDS: SlimItemId[] = [
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
  const SLIM_ITEM_LABELS: Record<SlimItemId, string> = {
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
  // Defaults — pull count, last seen, reversed % per the research-
  // backed top 3 small data points for a card identity at a glance.
  const SLIM_DEFAULT_VISIBLE: Record<SlimItemId, boolean> = {
    count: true,
    "last-seen": true,
    reversed: true,
    rank: false,
    "moon-phase": false,
    "time-of-day": false,
    "day-of-week": false,
    "longest-gap": false,
    "avg-spacing": false,
    "tag-bias": false,
  };
  const CARD_POPOVER_SLIM_LS_KEY = "tarotseed:card-popover-slim";
  const [slimItemPrefs, setSlimItemPrefs] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return SLIM_DEFAULT_VISIBLE;
    try {
      const raw = window.localStorage.getItem(CARD_POPOVER_SLIM_LS_KEY);
      if (!raw) return SLIM_DEFAULT_VISIBLE;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? { ...SLIM_DEFAULT_VISIBLE, ...parsed }
        : SLIM_DEFAULT_VISIBLE;
    } catch {
      return SLIM_DEFAULT_VISIBLE;
    }
  });
  const slimItemPrefsHydratedRef = useRef(false);
  useEffect(() => {
    if (slimItemPrefsHydratedRef.current) return;
    if (!user?.id) return;
    slimItemPrefsHydratedRef.current = true;
    void supabase
      .from("user_preferences")
      .select("card_popover_slim")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return;
        const dbPrefs =
          (data as { card_popover_slim?: Record<string, boolean> } | null)?.card_popover_slim ??
          null;
        if (dbPrefs && typeof dbPrefs === "object" && Object.keys(dbPrefs).length > 0) {
          const merged = { ...SLIM_DEFAULT_VISIBLE, ...dbPrefs };
          setSlimItemPrefs(merged);
          try {
            window.localStorage.setItem(CARD_POPOVER_SLIM_LS_KEY, JSON.stringify(merged));
          } catch {
            /* ignore */
          }
        }
      });
  }, [user?.id]);
  const saveSlimItemPrefs = useCallback(
    (next: Record<string, boolean>) => {
      try {
        window.localStorage.setItem(CARD_POPOVER_SLIM_LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      if (!user?.id) return;
      void supabase
        .from("user_preferences")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data: existing }) => {
          if (existing) {
            return supabase
              .from("user_preferences")
              .update({ card_popover_slim: next } as never)
              .eq("user_id", user.id);
          }
          return supabase
            .from("user_preferences")
            .insert({ user_id: user.id, card_popover_slim: next } as never);
        });
    },
    [user?.id],
  );
  const isSlimItemVisible = useCallback(
    (id: SlimItemId) => slimItemPrefs[id] !== false,
    [slimItemPrefs],
  );
  const toggleSlimItem = useCallback((id: SlimItemId) => {
    setSlimItemPrefs((prev) => {
      const currentlyVisible = prev[id] !== false;
      return { ...prev, [id]: !currentlyVisible };
    });
  }, []);
  // Reset to defaults — clears all customization, both popover and
  // slim. Used by the Reset button in edit mode.
  const resetPopoverPrefs = useCallback(() => {
    setSectionPrefs({});
    setSlimItemPrefs(SLIM_DEFAULT_VISIBLE);
  }, []);

  // EJ22 — clicked vs hovered. Hovering a card opens the SLIM popover;
  // clicking the slim (or the card directly) opens the RICH popover.
  // The activePopover state already carries the anchor; we just need
  // a second flag to switch between slim and rich rendering.
  const [popoverMode, setPopoverMode] = useState<"slim" | "rich">("slim");
  const [popoverEditStart, setPopoverEditStart] = useState(false);
  // EK97 — live edit state of the open card popover, reported by
  // CardRichPopoverContent. Drives the popover's maxWidth so the frame doubles
  // to fit the edit column while editing and snaps back when done.
  const [popoverEditingLive, setPopoverEditingLive] = useState(false);
  const escalateToRich = useCallback((openEdit?: boolean) => {
    setPopoverEditStart(Boolean(openEdit));
    setPopoverMode("rich");
  }, []);
  // EJ23 — delay timer for opening the slim hover. 450ms matches
  // GitHub/Linear hover-card delay — long enough that an accidental
  // cursor pass-over doesn't fire, short enough that intentional
  // hovers feel responsive.
  const slimHoverDelayRef = useRef<number>(0);
  // EK57 — Synchronous flag (a ref, not state, so it's true the instant
  // the cursor enters a badge — before React commits the state update
  // that the same mousemove would otherwise race). Set true while the
  // hero OR asterism badge is hovered; read by handleConstellationHover
  // to suppress the card-meaning popover so the badge popover wins. The
  // earlier asterismBadgeHovered STATE flag existed but was never read
  // in the popover-open path, which is why the card data kept winning.
  const badgeHoveredRef = useRef(false);

  // EJ20 — pinned card modals. Each entry is a cardId the seeker has
  // pinned via the pushpin button on the card popover. Pinned cards
  // appear as floating draggable modals docked at the bottom of the
  // viewport, side-by-side, so the seeker can compare multiple cards
  // without holding the hover state.
  const [pinnedCards, setPinnedCards] = useState<number[]>([]);
  const pinCard = useCallback((cardId: number) => {
    setPinnedCards((prev) => (prev.includes(cardId) ? prev : [...prev, cardId]));
  }, []);
  const unpinCard = useCallback((cardId: number) => {
    setPinnedCards((prev) => prev.filter((id) => id !== cardId));
  }, []);
  const isPinned = useCallback((cardId: number) => pinnedCards.includes(cardId), [pinnedCards]);

  // Phase 19 Fix 10 — port the Echo detection to /constellation.
  const echo = useEcho(picks, overlap, overlapMode);
  const participatingSet = useMemo(
    () => new Set(echo.participatingCardIds),
    [echo.participatingCardIds],
  );

  // DR — matched readings against the current teal selection. Empty teal =
  // show all matches (just hero). Mirrors the filter logic that used to
  // live inside MatchingReadingsPanel.
  // EC — Hero-anchored matched readings. Always = readings containing
  // the hero card from constellationData.matches. NEVER filtered by
  // teal. Powers the gold hero badge count and the gold-badge readings
  // modal. (Previously this was filtered by teal which conflated the
  // two distinct datasets; see constellation logic doc §9.1.)
  const heroMatchedReadings = useMemo(() => {
    return constellationData?.matches ?? [];
  }, [constellationData?.matches]);

  // EK57 — Authoritative per-card count within the active filtered
  // universe (overlap = the same time-range + chip filters the gold
  // badge and calendar represent). Counts each reading once per card it
  // contains. Used by the slim/rich card chip instead of the 12-bucket
  // monthCounts sum, which silently dropped readings landing in the
  // 13th edge calendar month of the 365-day window — the source of the
  // chip (21) vs gold badge (25) mismatch.
  const filteredCountByCard = useMemo(() => {
    const m = new Map<number, number>();
    if (!overlap?.readingsByDate) return m;
    for (const readings of Object.values(overlap.readingsByDate)) {
      for (const r of readings) {
        const seen = new Set<number>();
        for (const id of r.cardIds) {
          if (seen.has(id)) continue;
          seen.add(id);
          m.set(id, (m.get(id) ?? 0) + 1);
        }
      }
    }
    return m;
  }, [overlap]);

  // EK57 — Days (YYYY-MM-DD) the currently-hovered constellation card
  // was drawn on, within the filtered universe. Passed to the calendar
  // so those days get a trace-color stroke while the card is hovered.
  // EK89 — asterism ring hover-preview on the calendar.
  //  • Nothing selected → hovering a card rings every day that card appears.
  //  • One+ cards already selected → hovering an UNSELECTED card previews the
  //    set (selection ∪ hovered): only days where ALL of them co-occur ring,
  //    per the same-pull / same-day pill — i.e. what clicking it would commit.
  //  • Hovering an already-selected card leaves the committed rings untouched
  //    (no preview), since there's nothing to add. (EK89 decision b.)
  const hoverStrokeYmds = useMemo(() => {
    const s = new Set<string>();
    if (!overlap?.readingsByDate) return s;
    // EK91 — a hovered connecting line takes precedence: ring the days where
    // its two cards co-occurred, per the same-spread / same-day pill.
    if (hoveredPair) {
      const pairSet = new Set<number>([hoveredPair.a, hoveredPair.b]);
      for (const [date, readings] of Object.entries(overlap.readingsByDate)) {
        if (overlapMode === "pull") {
          const hit = readings.some((r) => {
            const cardSet = new Set(r.cardIds);
            for (const id of pairSet) if (!cardSet.has(id)) return false;
            return true;
          });
          if (hit) s.add(date);
        } else {
          const sameDayCards = new Set<number>();
          for (const r of readings) for (const id of r.cardIds) sameDayCards.add(id);
          let ok = true;
          for (const id of pairSet) {
            if (!sameDayCards.has(id)) {
              ok = false;
              break;
            }
          }
          if (ok) s.add(date);
        }
      }
      return s;
    }
    // EK115 — a hovered moon chip breathes that phase's marked full/new moon
    // days (the same days the calendar icons mark), readings or not.
    if (atlasHoverMoonPhase) {
      const days = daysForMoonPhase(atlasHoverMoonPhase);
      for (const d of days) s.add(d);
      return s;
    }
    // EK114 — a hovered Asterism-panel chip (loose single or OR-group) rings
    // the days any of its cards were drawn, per pill, so those days breathe.
    if (atlasAsterismHoverIds && atlasAsterismHoverIds.length > 0) {
      const target = new Set(atlasAsterismHoverIds);
      for (const [date, readings] of Object.entries(overlap.readingsByDate)) {
        if (overlapMode === "pull") {
          if (readings.some((r) => r.cardIds.some((id) => target.has(id))))
            s.add(date);
        } else {
          const sameDayCards = new Set<number>();
          for (const r of readings)
            for (const id of r.cardIds) sameDayCards.add(id);
          for (const id of target)
            if (sameDayCards.has(id)) {
              s.add(date);
              break;
            }
        }
      }
      return s;
    }
    if (hoverCardId === null) return s;
    // EK95 — asterism-independent hover: always ring the hovered card's OWN
    // days, regardless of any asterism in progress. Previously the card branch
    // previewed (selection ∪ card) and a card already in the asterism breathed
    // nothing, so hover behavior changed once an asterism started. The link
    // branch above is already asterism-independent; this matches it.
    for (const [date, readings] of Object.entries(overlap.readingsByDate)) {
      if (readings.some((r) => r.cardIds.includes(hoverCardId))) s.add(date);
    }
    return s;
  }, [
    overlap,
    hoverCardId,
    overlapMode,
    hoveredPair,
    atlasAsterismHoverIds,
    atlasHoverMoonPhase,
    atlasMoonDays,
  ]);

  // EK58 — how many (most-recent) calendar months the grid12 strip
  // should show, driven by the active time range. Fixed windows show
  // the calendar months the window spans (current month back to the
  // window's start month). "All time" shows the seeker's actual data
  // span (earliest reading's month → now). Capped at 12, floored at 1.
  // ≤6 collapses to a single row (the grid is 6 columns wide).
  const calendarMonthsToShow = useMemo(() => {
    const tr = globalFilters.timeRange ?? DEFAULT_TIMEFRAME;
    const monthIdxOf = (ymd: string) => {
      const [y, m] = ymd.split("-").map(Number);
      return y * 12 + (m - 1);
    };
    const nowIdx = monthIdxOf(isoDayInTz(new Date(), effectiveTz));
    const spanFrom = (startYmd: string) =>
      Math.min(12, Math.max(1, nowIdx - monthIdxOf(startYmd) + 1));
    const m = /^(\d+)d$/.exec(tr);
    if (m) {
      const days = Number(m[1]);
      const startYmd = isoDayInTz(new Date(Date.now() - days * 86400000), effectiveTz);
      return spanFrom(startYmd);
    }
    // "all" → data-driven span from the earliest reading.
    const keys = overlap?.readingsByDate ? Object.keys(overlap.readingsByDate) : [];
    if (keys.length === 0) return 1;
    let earliest = keys[0];
    for (const k of keys) if (k < earliest) earliest = k;
    return spanFrom(earliest);
  }, [globalFilters.timeRange, effectiveTz, overlap]);

  // v2.88 — reverted the v2.85 range-driven row override. Insights → Patterns
  // now follows the same showOlder cycler as the draw table, toggled by the
  // new eyeball on the calendar (previously Patterns had no visible control).
  // The v2.87 range sync stays, so the range selector still sets how many
  // months the eyeball can reveal (365d → up to 12).

  // EK62 — full/new moon day sets (UTC keys), used to add a moon header to
  // the day-readings modal. Same source as the EK59 calendar icons.
  const moonDayYmds = useMemo(() => {
    const full = new Set<string>();
    const nw = new Set<string>();
    const DAY_MS = 86400000;
    const from = new Date(Date.now() - 13 * 30 * DAY_MS);
    for (const d of getPhaseOccurrences("Full Moon", from, 15)) full.add(isoDayInTz(d, "UTC"));
    for (const d of getPhaseOccurrences("New Moon", from, 15)) nw.add(isoDayInTz(d, "UTC"));
    return { full, nw };
  }, []);

  // EJ16 — slot-card matched readings. When the seeker clicks a
  // rank or count box at the bottom of any slot card, the modal
  // opens scoped to readings containing that specific cardId.
  // Source: overlap.readingsByDate (the filtered universe) so the
  // count matches what the bottom-of-card right box displays.
  // Sorted newest-first.
  const slotCardMatchedReadings = useMemo(() => {
    if (modalCardId === null) return [];
    if (!overlap) return [];
    const all = Object.values(overlap.readingsByDate).flat();
    return all
      .filter((r) => r.cardIds.includes(modalCardId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [overlap, modalCardId]);

  // EC — Teal-anchored matched readings. Sourced from overlap (the full
  // filtered universe), NOT from hero matches. A reading qualifies in
  // same-pull mode if all teal cards appear in its cardIds. In same-day
  // mode the natural unit is days (see tealMatchedDayCount below) but
  // we still expose the underlying reading list flattened from all
  // qualifying days for modal display.
  const tealMatchedReadings = useMemo(() => {
    if (tealSelectedIds.length < 2) return [];
    if (!overlap) return [];
    const tealSet = new Set(tealSelectedIds);
    const all = Object.values(overlap.readingsByDate).flat();
    if (overlapMode === "pull") {
      return all.filter((r) => {
        const cardSet = new Set(r.cardIds);
        for (const id of tealSet) if (!cardSet.has(id)) return false;
        return true;
      });
    }
    // Same-day mode: collect every reading on every qualifying day.
    const out: typeof all = [];
    for (const [date, readings] of Object.entries(overlap.readingsByDate)) {
      const sameDayCards = new Set<number>();
      for (const r of readings) for (const id of r.cardIds) sameDayCards.add(id);
      let ok = true;
      for (const id of tealSet) {
        if (!sameDayCards.has(id)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(...readings);
      void date;
    }
    return out;
  }, [overlap, tealSelectedIds, overlapMode]);

  // EC — Day count for same-day mode. Number of distinct dates where
  // ALL teal cards co-occurred on the day (across any number of pulls).
  // Same-pull mode reports readings count, not days, so this is only
  // surfaced when overlapMode === "day".
  const tealMatchedDayCount = useMemo(() => {
    if (tealSelectedIds.length < 2) return 0;
    if (!overlap) return 0;
    const tealSet = new Set(tealSelectedIds);
    let count = 0;
    for (const readings of Object.values(overlap.readingsByDate)) {
      const sameDayCards = new Set<number>();
      for (const r of readings) for (const id of r.cardIds) sameDayCards.add(id);
      let ok = true;
      for (const id of tealSet) {
        if (!sameDayCards.has(id)) {
          ok = false;
          break;
        }
      }
      if (ok) count += 1;
    }
    return count;
  }, [overlap, tealSelectedIds]);

  // EC — Unit-aware teal count. Same-pull mode → readings count.
  // Same-day mode → distinct-day count. Surfaced on the teal badge
  // and in the teal modal title with the matching unit label
  // (PULLS or DAYS, all caps).
  const tealCount = useMemo(() => {
    if (tealSelectedIds.length < 2) return 0;
    return overlapMode === "pull" ? tealMatchedReadings.length : tealMatchedDayCount;
  }, [tealSelectedIds.length, overlapMode, tealMatchedReadings.length, tealMatchedDayCount]);

  // EC — Backwards-compat alias. Some existing call sites reference
  // matchedReadings; they now resolve to the hero-anchored list since
  // the teal logic has been split off cleanly.
  const matchedReadings = heroMatchedReadings;

  // Phase 24 — candidate-extension cards. When 2+ teal cards are selected,
  // walk visible months and find every other card in the constellation
  // (hero + companions) where adding it to the teal set would still match
  // at least one day. Those cards get a teal connecting line in the
  // constellation web as a "click me, my trace has data" hint.
  const candidateIds = useMemo<number[]>(() => {
    if (tealSelectedIds.length < 2) return [];
    if (!overlap || !constellationData) return [];
    const tealSet = new Set(tealSelectedIds);
    const pool: number[] = [constellationData.heroCardId];
    for (const c of constellationData.companions) pool.push(c.cardId);
    const result: number[] = [];
    for (const cardId of pool) {
      if (tealSet.has(cardId)) continue;
      let hit = false;
      outer: for (const m of overlap.months) {
        for (const day of m.days) {
          if (day == null) continue;
          if (overlapMode === "day") {
            const sameDay = new Set(day.sameDayCardIds);
            let ok = true;
            for (const id of tealSet) {
              if (!sameDay.has(id)) {
                ok = false;
                break;
              }
            }
            if (ok && sameDay.has(cardId)) {
              hit = true;
              break outer;
            }
          } else {
            const readings = overlap.readingsByDate?.[day.date] ?? [];
            for (const r of readings) {
              const ids = new Set(r.cardIds);
              let ok = true;
              for (const id of tealSet) {
                if (!ids.has(id)) {
                  ok = false;
                  break;
                }
              }
              if (ok && ids.has(cardId)) {
                hit = true;
                break outer;
              }
            }
          }
        }
      }
      if (hit) result.push(cardId);
    }
    return result;
  }, [tealSelectedIds, overlap, constellationData, overlapMode]);

  // Phase 20 Fix 13 — practice line + question + Get Reading wiring.
  const [practice, setPractice] = useState<QuickLogPractice | null>(null);
  const { currentStreak } = useStreak();
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const lun = getLunationContaining(new Date());
    void getQuickLogPractice({
      data: {
        lunationStart: lun.start.toISOString(),
        lunationEnd: lun.end.toISOString(),
        tz: effectiveTz,
      },
    })
      .then((d) => {
        if (!cancelled) setPractice(d);
      })
      .catch(() => {
        if (!cancelled) setPractice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, effectiveTz]);
  // ED — SSR-safe defaults; hydrated from localStorage in the
  // hydratedFromStorageRef effect above.
  const [question, setQuestion] = useState<string>("");
  // DY — free-form notes textarea for "Save to Journal" + AI reading.
  const [note, setNote] = useState<string>("");
  // v3.50 — "Get AI reading" sheet (clipboard prompt builder).
  const [aiSheetOpen, setAiSheetOpen] = useState<boolean>(false);
  // DY — journaling-prompts modal trigger.
  const [promptsModalOpen, setPromptsModalOpen] = useState(false);
  // EJ30 — which slot card's prompts are currently displayed in the
  // prompts modal. null = default to hero. The dropdown surface lets
  // the seeker switch between any pick in the current slot row.
  const [promptsModalCardId, setPromptsModalCardId] = useState<number | null>(null);
  // EJ30 — which deck the manual-entry CardPicker is currently
  // displaying. null = active deck (default). Each pick records the
  // deck it came from so a single spread can mix cards across decks.
  const [pickerDeckId, setPickerDeckId] = useState<string | null>(null);
  // DY — Save to Journal lifecycle.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // DY — inline AI reading lifecycle.
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [aiInterpretation, setAiInterpretation] = useState<{
    overview: string;
    positions: { position: string; card: string; interpretation: string }[];
    closing: string;
  } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // DR — persist all /constellation state to localStorage on any change.
  // Placed here (after every relevant useState has been declared) to avoid
  // a temporal-dead-zone error: an earlier placement closed over `question`
  // and `overlapMode` before their `useState` calls had run.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: PersistedState = {
        picks,
        focusedSlotIdx,
        tealSelectedIds,
        backdateISO: backdate ? backdate.toISOString() : null,
        question,
        note,
        overlapMode,
        globalFilters,
      };
      window.localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      /* quota or disabled — silently ignore */
    }
  }, [
    picks,
    focusedSlotIdx,
    tealSelectedIds,
    backdate,
    question,
    note,
    overlapMode,
    globalFilters,
  ]);
  const canSubmit = picks.length >= 1;

  // The PullHistoryPill expects ConstellationState; the Echo hook returns
  // an identical shape with one extra prop (matchCount). Adapt explicitly.
  const constellationState: ConstellationState = useMemo(
    () => ({
      active: echo.active,
      participatingCardIds: echo.participatingCardIds,
      matchingReadings: echo.matchingReadings,
      matchCount: echo.matchCount,
      matchCountSixMonths: echo.matchCountSixMonths,
    }),
    [echo],
  );

  // DY — derive the spread mode from the pick count. Matches /draw's
  // manual-entry mapping: 1 = single, 3 = three, 10 = celtic, else custom.
  const derivedSpreadMode = useMemo<"single" | "three" | "celtic" | "custom">(() => {
    if (picks.length === 1) return "single";
    if (picks.length === 3) return "three";
    if (picks.length === 10) return "celtic";
    return "custom";
  }, [picks.length]);

  // DY — inline AI reading. Stays on this page; renders interpretation
  // below the duplicate card display.
  const handleGetAIReading = async () => {
    if (!canSubmit || aiStatus === "loading") return;
    setAiStatus("loading");
    setAiError(null);
    setAiInterpretation(null);
    try {
      const result = await interpretReading({
        data: {
          spread: derivedSpreadMode,
          picks: picks.map((p) => ({
            id: p.id,
            cardIndex: p.cardIndex,
            isReversed: p.isReversed,
          })),
          question: question.trim() || undefined,
          createdAt: backdate ? backdate.toISOString() : undefined,
        },
      });
      if (!result.ok) {
        setAiStatus("error");
        setAiError(result.message);
        return;
      }
      setAiInterpretation(result.interpretation);
      setAiStatus("ready");
    } catch (e) {
      console.error("[ConstellationPage] interpretReading threw", e);
      setAiStatus("error");
      setAiError("Something went wrong. Please try again.");
    }
  };

  // DY — Save to Journal (no AI). Writes a readings row with picks,
  // question, note, and optional backdate. Stays on the page. After a
  // successful save we surface a "Saved" pulse and clear the slate so
  // the seeker can start a new pull.
  const handleSaveToJournal = async () => {
    if (!canSubmit || saveStatus === "saving") return;
    // EK112 — a group slot ("any of") isn't a concrete spread; never save it.
    if (atlasMode && atlasGroupSlots.length > 0) return;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const result = await saveManualReading({
        data: {
          spread: derivedSpreadMode,
          picks: picks.map((p) => ({
            id: p.id,
            cardIndex: p.cardIndex,
            isReversed: p.isReversed,
            // EK31 — Forward the per-pick deck attribution so oracle
            // cards (cardIndex >= 78) save successfully and the row
            // gets `card_deck_ids` + `deck_id` populated for Insights
            // filtering. null = "drawn from the active deck"; the
            // server resolves nulls against `activeDeckId` below.
            deckId: p.deckId,
          })),
          question: question.trim() || undefined,
          note: note.trim() || undefined,
          createdAt: backdate ? backdate.toISOString() : undefined,
          // EK31 — Active deck at save time, used by the server to
          // resolve any per-pick deckId that came through as null
          // ("active deck" sentinel).
          activeDeckId: activeDeckForCta?.id ?? null,
        },
      });
      if (!result.ok) {
        setSaveStatus("error");
        setSaveError(result.message);
        return;
      }
      setSaveStatus("saved");
      // Surface the "Saved" affordance briefly, then reset to idle so the
      // button is usable again. Page state itself stays — the seeker may
      // still want to fire AI on the same pull, or save another pass.
      window.setTimeout(() => setSaveStatus("idle"), 2400);
    } catch (e) {
      console.error("[ConstellationPage] saveManualReading threw", e);
      setSaveStatus("error");
      setSaveError("Something went wrong. Please try again.");
    }
  };

  // DY — legacy navigate-to-/draw flow. Retained as a non-rendered helper
  // so anything still referencing it stays compilable; the button has
  // been replaced by handleGetAIReading above.
  const handleGetReading = () => {
    if (!canSubmit) return;
    try {
      const payload = {
        picks: picks.map((p) => ({
          id: p.id,
          cardIndex: p.cardIndex,
          isReversed: p.isReversed,
          deckId: p.deckId ?? null,
          cardName: p.cardName ?? null,
        })),
        question,
        backdateISO: backdate ? backdate.toISOString() : null,
      };
      window.sessionStorage.setItem("tarotseed:constellation-handoff", JSON.stringify(payload));
      window.localStorage.removeItem(LS_KEY);
    } catch {
      /* sessionStorage may be unavailable; swallow */
    }
    navigate({ to: "/draw" });
  };

  // Phase 19 Fix 7 — SmartCardInput commit handlers.
  const handleCommit = (pick: SmartPick) => {
    setFocusedSlotIdx(picks.length);
    setPicks((prev) => [
      ...prev,
      {
        id: Date.now() + prev.length,
        cardIndex: pick.cardIndex,
        isReversed: pick.isReversed,
        deckId: null,
        cardName: pick.cardName,
      },
    ]);
  };
  const handleBulk = (outcome: PasteOutcome) => {
    setPicks((prev) => {
      const next = [...prev];
      outcome.picks.forEach((item, i) => {
        next.push({
          id: Date.now() + prev.length + i,
          cardIndex: item.pick.cardIndex,
          isReversed: item.pick.isReversed,
          deckId: null,
          cardName: item.pick.cardName,
        });
      });
      return next;
    });
  };
  const deckCards = useMemo(() => TAROT_DECK.map((name, idx) => ({ cardId: idx, name })), []);

  // DP — drag-and-drop state. `draggingCardId` is set when a constellation
  // card starts being dragged. `dragOverSlotIdx` is the slot currently
  // hovered as a drop target (drives the visual highlight). The drop
  // handler decides whether to fill (empty slot) or prompt-replace
  // (occupied slot).
  const [draggingCardId, setDraggingCardId] = useState<number | null>(null);
  const [dragOverSlotIdx, setDragOverSlotIdx] = useState<number | null>(null);

  // DV — hover state for slot controls (X remove + reverse toggle).
  // Falls back to the focused slot on touch / non-hover devices so the
  // seeker can still flip / remove without a hover target.
  const [hoveredSlotIdx, setHoveredSlotIdx] = useState<number | null>(null);

  // DV — direct supabase read of allow_reversed_cards. Mirrors the
  // use-track-reversals pattern; ConstellationPage lives outside the
  // SettingsProvider tree, so useSettings() would throw.
  const [allowReversed, setAllowReversed] = useState<boolean>(false);
  useEffect(() => {
    if (!user?.id) {
      setAllowReversed(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("allow_reversed_cards")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { allow_reversed_cards?: boolean | null } | null;
      setAllowReversed(Boolean(row?.allow_reversed_cards));
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // EK68 — direct supabase read of birth_date for the numerology calendar
  // mode (same pattern as allow_reversed_cards above; the page is outside
  // the SettingsProvider). Null when unset — the calendar then shows no
  // number in numerology mode.
  const [birthDate, setBirthDate] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) {
      setBirthDate(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("birth_date")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { birth_date?: string | null } | null;
      setBirthDate(row?.birth_date ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // v3.31 — Pattern detection over the filtered universe. Runs whenever the
  // hero, filtered readings, tz, or birth date change. New moons are derived
  // the same way LunationStrip derives them so cell strokes line up exactly.
  const [patternReport, setPatternReport] = useState<PatternReport | null>(null);
  // v3.33 — detection is DEFERRED and isolated: never runs mid-drag, debounced
  // 500ms after the pull settles, wrapped so it can never surface an error.
  useEffect(() => {
    if (heroPick?.cardIndex == null || !overlap?.readingsByDate) {
      setPatternReport(null);
      return;
    }
    if (draggingCardId !== null || draggingGroup) return;
    const handle = setTimeout(() => {
      try {
        const readings: { ymd: string; cardIds: number[] }[] = [];
        for (const [ymd, list] of Object.entries(overlap.readingsByDate)) {
          for (const r of list) readings.push({ ymd, cardIds: r.cardIds ?? [] });
        }
        if (readings.length === 0) {
          setPatternReport(null);
          setAllPatterns([]);
          return;
        }
        const now = new Date();
        const rangeM = /^(\d+)d$/.exec(globalFilters.timeRange ?? DEFAULT_TIMEFRAME);
        const spanDays = rangeM ? Number(rangeM[1]) : 365;
        const from = new Date(now.getTime() - (spanDays + 45) * 86400000);
        const monthsAhead = Math.ceil((spanDays + 60) / 30);
        const newMoonYmds = getPhaseOccurrences("New Moon", from, monthsAhead)
          .map((d) => isoDayInTz(d, effectiveTz))
          .sort();
        const constellationIds = displayedConstellation
          ? [
              displayedConstellation.heroCardId,
              ...displayedConstellation.companions.map((c) => c.cardId),
            ]
          : [heroPick.cardIndex];
        setPatternReport(
          detectPatterns({
            heroCardId: heroPick.cardIndex,
            readings,
            newMoons: newMoonYmds,
            birthDate,
            constellationCardIds: constellationIds,
          }),
        );
        {
          // v3.40 — merge the structural group-frequency rows (suit / number /
          // court) in with the lens / asterism / stalker rows, strongest-first.
          const merged = [
            ...detectAllPatterns({ readings, newMoons: newMoonYmds, birthDate }),
            ...detectGroupPatterns(readings, now.getTime()),
          ];
          merged.sort((a, b) => a.pValue - b.pValue);
          setAllPatterns(merged);
        }
      } catch {
        setPatternReport(null);
        setAllPatterns([]);
      }
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    heroPick?.cardIndex,
    overlap?.readingsByDate,
    effectiveTz,
    birthDate,
    globalFilters.timeRange,
    displayedConstellation,
    draggingCardId,
    draggingGroup,
  ]);

  // Reset the active pattern when the hero changes — UNLESS the new hero is the
  // very card that pattern belongs to (the all-patterns drill-down loads a card
  // as hero and wants its pattern to stay isolated instead of being cleared).
  useEffect(() => {
    setActivePattern((cur) =>
      cur && cur.cardId === heroPick?.cardIndex ? cur : null,
    );
  }, [heroPick?.cardIndex]);

  // DV — clear all picks (header button). No confirm — the localStorage
  // state still persists across navigation, this just resets the current
  // /constellation surface.
  const handleClearAll = () => {
    setPicks([]);
    setFocusedSlotIdx(null);
    setTealSelectedIds([]);
    setQuestion("");
    setNote("");
    setBackdate(null);
    setAiStatus("idle");
    setAiInterpretation(null);
    setAiError(null);
    setSaveStatus("idle");
    setSaveError(null);
  };

  // EJ70 — Built here (after handleClearAll) so the Actions section can
  // reference it. View swap + calendar cycler as before; "Clear all
  // picks" appears only when picks are placed.
  const pageMenuSections: PageMenuSection[] = [
    // EK89 — Clear at the very top of the menu; empties the slots and the
    // teal asterism picks (via handleClearAll). Shown only when slots hold cards.
    ...(picks.length > 0
      ? [
          {
            id: "clear",
            title: "Clear",
            items: [
              {
                id: "clear-all",
                label: "Clear slots",
                description: "Empty the slots and reset this reading",
                Icon: Trash2,
                mode: "navigate" as const,
                onClick: () => {
                  setPageMenuOpen(false);
                  handleClearAll();
                },
              },
            ],
          },
        ]
      : []),
    {
      id: "view-swap",
      title: "View",
      items: [
        {
          id: "draw-table",
          label: "Card Draw Table",
          description: "Pick from all 78 cards",
          Icon: LayoutGrid,
          mode: "navigate",
          onClick: () => {
            setPageMenuOpen(false);
            if (onSwitchToTable) {
              requestNavigate(onSwitchToTable);
            } else {
              requestNavigate(() =>
                navigate({ to: "/draw", search: { entry: "table" } }),
              );
            }
          },
        },
        // EK101 — link to the full 78-card Atlas. Hidden when we ARE the
        // atlas page so it never links to itself.
        ...(!atlasMode
          ? [
              {
                id: "atlas",
                label: "Full Constellation",
                description: "See all 78 cards in one clock",
                Icon: Sparkles,
                mode: "navigate" as const,
                onClick: () => {
                  setPageMenuOpen(false);
                  requestNavigate(() => navigate({ to: "/atlas" }));
                },
              },
            ]
          : []),
      ],
    },
    {
      id: "display",
      title: "Display",
      items: [
        {
          id: "calendars",
          label: "Calendars",
          description: "Cycle through hidden, 1 row, 2 rows",
          Icon: CalendarIcon,
          mode: "cycle",
          cycleLabel: calendarCycleLabel,
          onClick: () => {
            cycleCalendar();
            // Keep the menu open so the seeker can keep cycling.
          },
        },
        {
          id: "calendar-numbers",
          label: "Calendar numbers",
          description: "Day of month, or your personal day number",
          Icon: Hash,
          mode: "cycle",
          cycleLabel: calendarNumberMode === "dates" ? "Dates" : "Numerology",
          onClick: () => {
            setCalendarNumberMode((m) => (m === "dates" ? "numerology" : "dates"));
          },
        },
        {
          id: "hover-tips",
          label: "Hover tips",
          description: "Rich popovers when you hover a card",
          Icon: Eye,
          mode: "cycle",
          cycleLabel: hoverTipsEnabled ? "On" : "Off",
          onClick: () => {
            toggleHoverTips();
          },
        },
        {
          id: "pulse-days",
          label: "Pulse hovered days",
          description: "Pulse a card's calendar days when you hover it",
          Icon: Sparkles,
          mode: "toggle" as const,
          on: pulseHoverDays,
          hoverPreviewUrl:
            "https://www.tella.tv/video/vid_cmr88c3i0000909hxdwtif5y4/embed?autoPlay=true&loop=1&title=0&b=0&a=0&t=0&muted=1&wt=0&o=0",
          onClick: () => {
            setPulseHoverDays((v) => {
              const next = !v;
              try {
                window.localStorage.setItem("tarotseed:calendar:pulse", next ? "1" : "0");
              } catch {
                // best-effort persistence
              }
              return next;
            });
          },
        },
      ],
    },
    {
      id: "reading",
      title: "Reading",
      items: [
        {
          id: "cooccurrence",
          label: "Co-occurrence",
          description: "Match by same spread or same day",
          Icon: Layers,
          mode: "cycle",
          cycleLabel: overlapMode === "pull" ? "Same spread" : "Same day",
          onClick: () => {
            setOverlapMode((m) => (m === "pull" ? "day" : "pull"));
          },
        },
      ],
    },
  ];

  const handleRemoveSlot = (slotIdx: number) => {
    setPicks((prev) => prev.filter((_, i) => i !== slotIdx));
    setFocusedSlotIdx((cur) =>
      cur === null ? null : cur === slotIdx ? null : cur > slotIdx ? cur - 1 : cur,
    );
  };

  const handleToggleReverse = (slotIdx: number) => {
    setPicks((prev) =>
      prev.map((p, i) => (i === slotIdx ? { ...p, isReversed: !p.isReversed } : p)),
    );
  };

  const handleSlotDrop = async (slotIdx: number, cardId: number) => {
    setDraggingCardId(null);
    setDragOverSlotIdx(null);
    if (!Number.isFinite(cardId) || cardId < 0) return;

    // Snapshot-decide which path to take BEFORE any async / state work.
    // Each path applies its own setPicks(updater) once the decision is
    // resolved. The updater re-checks state for race safety.
    const snapshot = picks;
    const existingIdx = snapshot.findIndex((p) => p.cardIndex === cardId);
    if (existingIdx !== -1) {
      // v3.49 — the dragged card is already on the spread, so this is a
      // REORDER, not an add. Dropped on its own slot → no-op (just focus).
      // Dropped on another OCCUPIED slot → swap the two positions. Dropped on
      // an empty (trailing) slot → move the card to the end. Slot 0 is the
      // hero, so reordering into slot 0 re-picks the hero and re-derives the
      // constellation.
      if (slotIdx === existingIdx) {
        setFocusedSlotIdx(existingIdx);
        return;
      }
      setPicks((prev) => {
        const from = prev.findIndex((p) => p.cardIndex === cardId);
        if (from === -1) return prev;
        const next = [...prev];
        if (slotIdx < next.length) {
          const tmp = next[from];
          next[from] = next[slotIdx];
          next[slotIdx] = tmp;
        } else {
          const [moved] = next.splice(from, 1);
          next.push(moved);
        }
        return next;
      });
      setFocusedSlotIdx(slotIdx < snapshot.length ? slotIdx : snapshot.length - 1);
      return;
    }
    const occupant = snapshot[slotIdx];
    if (occupant) {
      // DX — branded confirm replacing the native window.confirm. The
      // useConfirm hook is provided by ConfirmProvider at the app root.
      const ok = await confirm({
        title: "Replace this card?",
        description: `Swap out ${occupant.cardName ?? `card ${occupant.cardIndex}`}?`,
        confirmLabel: "Replace",
        cancelLabel: "Keep",
        destructive: true,
      });
      if (!ok) return;
      setPicks((prev) => {
        // Race guard: if the slot has changed since we asked, bail.
        const cur = prev[slotIdx];
        if (!cur || cur.id !== occupant.id) return prev;
        // Also guard against the dropped card landing in another slot
        // between confirm and apply.
        if (prev.some((p) => p.cardIndex === cardId)) return prev;
        const next = [...prev];
        next[slotIdx] = {
          id: Date.now(),
          cardIndex: cardId,
          isReversed: false,
          deckId: null,
          cardName: TAROT_DECK[cardId] ?? null,
        };
        return next;
      });
      setFocusedSlotIdx(slotIdx);
      return;
    }
    // Empty slot: append. (Slots fill left-to-right; mid-row gaps
    // shouldn't exist in normal use, but if `slotIdx` is past length we
    // still just append to the next available position.)
    setPicks((prev) => {
      if (prev.some((p) => p.cardIndex === cardId)) return prev;
      const next = [...prev];
      next.push({
        id: Date.now(),
        cardIndex: cardId,
        isReversed: false,
        deckId: null,
        cardName: TAROT_DECK[cardId] ?? null,
      });
      setFocusedSlotIdx(next.length - 1);
      return next;
    });
  };

  // EJ22 — slim hover renderer. Returns the small chip-strip content
  // that appears when the seeker HOVERS a card (vs. clicks). Reads
  // the same data as the rich popover (popoverDataMap, drawCounts,
  // overlap) but renders only the items the seeker has flagged
  // visible on the slim. Clicking the slim escalates to the rich
  // popover at the same anchor.
  const renderSlimHoverInner = (cardId: number): React.ReactNode => (
    <CardRichPopoverContent
      cardId={cardId}
      filters={popoverFilters}
      variant="slim"
      showConstellation={false}
      onEscalate={escalateToRich}
    />
  );

  const renderCardPopoverInner = (
    cardId: number,
    opts: { editable: boolean; onEditingChange?: (editing: boolean) => void },
  ): React.ReactNode => (
    <CardRichPopoverContent
      cardId={cardId}
      filters={popoverFilters}
      variant="rich"
      showConstellation={true}
      initialEditing={popoverEditStart}
      pinnable={opts.editable}
      onEditingChange={opts.onEditingChange}
      onPin={
        opts.editable
          ? () => {
              pinCard(cardId);
              closeActivePopover("card-meaning");
            }
          : undefined
      }
    />
  );

  return (
    <div
      className="bg-cosmos text-foreground"
      style={{
        // Phase 22 Fix 1 — page owns its own scroll container; html/body/#root
        // are globally locked, so we must anchor to the viewport here.
        width: "100%",
        height: insightsMode ? "auto" : "100dvh",
        overflowY: insightsMode ? "visible" : "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        // DU — reduced top padding so Manual Entry header sits closer to top.
        // v2.21 — insightsMode (Patterns tab) drops the 2px so the surface
        // sits flush under the tab strip.
        padding: insightsMode ? "0 0 80px" : "2px 0 80px",
      }}
    >
      {/* EJ65 — Left fly-out page menu trigger + panel. Holds the
          VIEW SWAP (→ Card Draw Table) and HIDE/SHOW (calendars
          cycler) config for this page. */}
      <PageMenuTrigger onClick={() => setPageMenuOpen(true)} />
      <PageMenu
        open={pageMenuOpen}
        onClose={() => setPageMenuOpen(false)}
        sections={pageMenuSections}
        title="Manual Entry"
      />
      {/* Header row — DU: subtitle inline with H1 on the same row.
          EJ11 — H1 reduced 26 → 18 and row vertical padding tightened
          to close the gap above the constellation.
          EJ65 — EntryModeToggle (Draw button) removed from inline
          header; view swap lives in the PageMenu fly-out instead.
          The Classic Manual Entry link is gone with /draw/classic. */}
      <div
        style={{
          position: "relative",
          display: insightsMode ? "none" : "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 0",
          gap: 12,
        }}
      >
        {/* EK73 — explicit swap link, centered on the header row between the
            fly-out trigger and the back X. Absolutely positioned so it adds
            zero flow height; nothing on the page moves. Routes through the
            same unsaved-changes guard the fly-out uses. */}
        {onSwitchToTable && (
          <button
            type="button"
            onClick={() => requestNavigate(onSwitchToTable)}
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              margin: "0 auto",
              transform: "translateY(-50%)",
              width: "fit-content",
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color: "var(--accent, var(--gold))",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              whiteSpace: "nowrap",
              zIndex: 1,
            }}
          >
            Switch to Draw Table
          </button>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          {/* EJ70 — "Manual Entry" h1 + "pick up to 10 cards…" subtitle
              removed. The page name now lives at the top of the left
              fly-out (PageMenu) instead of taking header space. */}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* EJ70 — "Clear all" picks button moved into the PageMenu
              left fly-out (Actions → Clear all picks). Only the
              back-to-home button remains in the header. */}
          <button
            type="button"
            onClick={() => requestNavigate(() => navigate({ to: "/" }))}
            aria-label="Back to home"
            title="Back to home"
            style={{
              width: 28,
              height: 28,
              borderRadius: 9999,
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-foreground)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Phase 19 Fix 10 — Echo banner above the entry row */}
      <EchoBanner echo={echo} />

      {/* EJ25 — two-column grid. Constellation moved to RIGHT column.
          Slot row + chips + question + notes + save sit in LEFT column
          for more natural reading flow. Filter icon and time range
          selector above stay where they are.
          EJ66 — Filter bar moved INTO the left column (was above the
          grid). With filter bar above-the-grid, the right-column
          constellation web sat below it, pushing the hero card down
          ~50px from the Manual Entry header line. Now that the
          filter bar is a row inside the left column, the right
          column's hero card top sits just below the header line as
          intended. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(0, 1fr) ${SVG_W}px`,
          gap: lunationMode ? 8 : 24,
          padding: lunationMode ? "0 0 0 8px" : "0 24px 0",
        }}
      >
        {/* EJ25 — LEFT column (was RIGHT pre-EJ25): slot row + chips +
            question + notes + save. Filter icon + time range selector
            above stay in their original page-top position.
            EJ66 — Filter bar now lives at the TOP of this column
            (moved out of the above-the-grid slot). */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            height: insightsMode ? "auto" : "100%",
          }}
        >
          {/* EJ66 — Filter bar lives at the top of the LEFT column
              (moved from above-the-grid). Keeps the right-column
              constellation aligned with the top of the grid, just
              below the Manual Entry header line, while still
              surfacing filter controls in the main reading-flow
              column. */}
          {/* EK36 — Per-tag stats for the constellation-page tag panel.
              Computed server-side from the current date range, the
              cards in the seeker's slot row, and the scope mode (any /
              all). Results power the ConstellationTagsPanel's
              hover-only counts, font-weight gradient, recent-activity
              dot, and trend arrows. */}
          {(() => null)()}
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            {(insightsMode || lunationMode) && allPatterns.length > 0 && (() => {
              const anyUnseen = allPatterns.some((p) => !seenPatterns.has(p.patternId));
              return (
                <button
                  type="button"
                  aria-label="All patterns"
                  title="All patterns"
                  onClick={() => setPatternsModalOpen(true)}
                  className={anyUnseen ? "tarotseed-pattern-glyph" : undefined}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 6,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--pattern-highlight)",
                    opacity: anyUnseen ? 1 : 0.3,
                    cursor: "pointer",
                    flexShrink: 0,
                    borderRadius: "50%",
                  }}
                >
                  <Sparkles size={16} strokeWidth={2} />
                </button>
              );
            })()}
            <div style={{ display: insightsMode || lunationMode || atlasMode ? "flex" : "none", alignItems: "center", gap: 2, flexShrink: 0 }}>
              <button
                type="button"
                aria-label="Undo"
                title="Undo"
                disabled={!canUndo}
                onClick={undoPicks}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-foreground)",
                  opacity: canUndo ? 0.85 : 0.28,
                  cursor: canUndo ? "pointer" : "default",
                }}
              >
                <RotateCcw size={16} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo"
                disabled={!canRedo}
                onClick={redoPicks}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-foreground)",
                  opacity: canRedo ? 0.85 : 0.28,
                  cursor: canRedo ? "pointer" : "default",
                }}
              >
                <RotateCw size={16} strokeWidth={2} />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
          <GlobalFilterBar
            filters={globalFilters}
            onChange={setGlobalFilters}
            sections={["tags", "spreadTypes", "depth", "reversed"]}
            tagsSectionOverride={
              <EK36TagsBridge
                globalFilters={globalFilters}
                onTagToggle={(name) =>
                  setGlobalFilters((prev) => ({
                    ...prev,
                    tags: prev.tags.includes(name)
                      ? prev.tags.filter((t) => t !== name)
                      : [...prev.tags, name],
                  }))
                }
                onTagModeChange={(mode) =>
                  setGlobalFilters((prev) => ({ ...prev, tagMode: mode }))
                }
                cardIndices={picks.map((p) => p.cardIndex)}
              />
            }
            userTags={userTags}
            drawerOpen={globalDrawerOpen}
            onDrawerOpenChange={setGlobalDrawerOpen}
            timeRange={{
              value: globalFilters.timeRange ?? DEFAULT_TIMEFRAME,
              options: TIMEFRAME_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              })),
              onChange: (v) => setGlobalFilters((prev) => ({ ...prev, timeRange: v })),
            }}
          />
            </div>
            {lunationMode && (
              <LunationBookmarks
                userId={user?.id ?? null}
                getViewState={getLunationViewState}
                onApply={(vs) => applyLunationView(decodeLunationView(vs))}
              />
            )}
          </div>
          {/* EJ21 — right-side data card removed entirely. The "1
              Year of Data on..." header and the ChipGrid below it
              (LAST SEEN, TIME PATTERN, FREQUENCY, MOON PHASE,
              REVERSED) all moved into the card hover popover
              instead. Frequency dropped (unreliable data). */}

          {/* EK133 — days-selection pill, lifted out of the calendar to the
              top of the controls column (atlas only; the calendar drops its
              internal copy via showModeToggle={false}). Drives the same
              overlapMode state. */}
          {atlasMode && (
            <div style={{ order: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--color-foreground-muted)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Match by
              </span>
              <div
                role="tablist"
                aria-label="Match by spread or day"
                style={{
                  display: "inline-flex",
                  height: 24,
                  borderRadius: 9999,
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-card)",
                  overflow: "hidden",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                }}
              >
                {(["pull", "day"] as const).map((m) => {
                  const active = overlapMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setOverlapMode(m)}
                      style={{
                        padding: "0 14px",
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
            </div>
          )}

          {/* DV — slot row + date + paste flow naturally below chips.
              EK133 — order 3 in the left column; on the atlas Asterism tab the
              whole block hides (the EK131 box is the input there). */}
          <div
            style={{
              order: 3,
              display:
                atlasMode && atlasTab === "asterism" ? "none" : undefined,
            }}
          >
            <div
              ref={slotRowRef}
              style={{
                display: "flex",
                gap: COMPACT_SLOT_GAP,
                flexWrap: "nowrap",
                width: "100%",
                // EJ12 — tightened from 12 → 2 to make room for the
                // new labels row below. Combined paddingBottom + the
                // labels row's marginBottom = original 12 of breathing
                // room above the date row.
                paddingBottom: 2,
                justifyContent: "flex-start",
              }}
            >
              {Array.from({ length: 12 }).map((_, idx) => {
                const pick = picks[idx];
                // EK112 — group slots occupy the positions right after the
                // concrete picks; empties follow them.
                const groupIdx = idx - picks.length;
                const groupSlot =
                  !pick &&
                  atlasMode &&
                  groupIdx >= 0 &&
                  groupIdx < atlasGroupSlots.length
                    ? atlasGroupSlots[groupIdx]
                    : null;
                const isDropTarget = dragOverSlotIdx === idx;
                if (groupSlot) {
                  return (
                    <div
                      key={`group-${groupSlot.uid}`}
                      title={
                        groupSlot.kind === "moon"
                          ? `${groupSlot.label} — matches readings drawn under this moon phase`
                          : `${groupSlot.label} — matches any card of this ${groupSlot.kind}`
                      }
                      style={{
                        position: "relative",
                        width: slotW,
                        height: slotH,
                        flexShrink: 0,
                        borderRadius: 6,
                        border: `1.5px solid ${ATLAS_TRACE_COLOR}`,
                        background: `color-mix(in oklab, ${ATLAS_TRACE_COLOR} 16%, transparent)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 4,
                        textAlign: "center",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 3,
                          fontFamily: "var(--font-display)",
                          fontStyle: "italic",
                          fontSize: "var(--text-body-sm)",
                          lineHeight: 1.15,
                          color: "var(--color-foreground)",
                        }}
                      >
                        {groupSlot.kind === "moon" && (
                          <MoonPhaseIcon phase={groupSlot.phase} size={16} />
                        )}
                        {groupSlot.label}
                      </span>
                      <button
                        type="button"
                        aria-label={`remove ${groupSlot.label}`}
                        onClick={() => removeAtlasGroupSlot(groupSlot.uid)}
                        style={{
                          position: "absolute",
                          top: -7,
                          right: -7,
                          width: 18,
                          height: 18,
                          borderRadius: 9999,
                          border: "1px solid var(--border-subtle)",
                          background: "var(--surface-elevated, var(--surface-card))",
                          color: "var(--color-foreground)",
                          fontSize: 11,
                          lineHeight: 1,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                }
                if (!pick) {
                  return (
                    <button
                      key={`empty-${idx}`}
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      aria-label="add a card"
                      onDragOver={(e) => {
                        if (draggingCardId === null && !draggingGroup) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        if (dragOverSlotIdx !== idx) setDragOverSlotIdx(idx);
                      }}
                      onDragLeave={() => {
                        if (dragOverSlotIdx === idx) setDragOverSlotIdx(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        // EK112 — a rank/suit group chip dropped here becomes a
                        // group slot ("any of"). Card drops keep their path.
                        const grp = atlasMode
                          ? e.dataTransfer.getData("application/x-tarotseed-group")
                          : "";
                        if (grp) {
                          try {
                            const o = JSON.parse(grp) as {
                              kind: "rank" | "suit" | "moon";
                              key: string;
                            };
                            addAtlasGroupSlot(o.kind, o.key);
                          } catch {
                            /* ignore malformed payload */
                          }
                          setDraggingGroup(false);
                          setDragOverSlotIdx(null);
                          return;
                        }
                        const raw = e.dataTransfer.getData("application/x-tarotseed-cardid");
                        const id = raw ? Number(raw) : draggingCardId;
                        if (id !== null && Number.isFinite(id)) {
                          handleSlotDrop(idx, id);
                        } else {
                          setDraggingCardId(null);
                          setDragOverSlotIdx(null);
                        }
                      }}
                      style={{
                        width: slotW,
                        height: slotH,
                        flexShrink: 0,
                        borderRadius: 5,
                        border: isDropTarget
                          ? "2px solid var(--accent, var(--gold))"
                          : "1px dashed var(--border-default)",
                        background: isDropTarget
                          ? "color-mix(in oklab, var(--accent, var(--gold)) 12%, transparent)"
                          : "transparent",
                        cursor: "pointer",
                        color: "var(--color-foreground-muted, var(--color-foreground))",
                        fontSize: 14,
                        transition: "background 120ms ease",
                      }}
                    >
                      +
                    </button>
                  );
                }
                const isFocused = idx === heroIdx;
                const inEcho = echo.active && participatingSet.has(pick.cardIndex);
                const showControls = hoveredSlotIdx === idx || focusedSlotIdx === idx;
                return (
                  <div
                    key={pick.id}
                    draggable
                    onDragStart={(e) => {
                      // EJ9 — drag a slot card so it can be dropped on a
                      // constellation card. Same payload format used by
                      // the existing constellation→slot drag, so the
                      // ConstellationWeb drop handlers (which read
                      // application/x-tarotseed-cardid) can also accept
                      // these drags. effectAllowed=copy matches the
                      // semantics locked in EJ9 spec — drag from slot
                      // does NOT remove the card from the slot.
                      e.dataTransfer.effectAllowed = "copy";
                      e.dataTransfer.setData(
                        "application/x-tarotseed-cardid",
                        String(pick.cardIndex),
                      );
                      setDraggingCardId(pick.cardIndex);
                    }}
                    onDragEnd={() => {
                      // Always clear drag state on end (drop OR cancel).
                      setDraggingCardId(null);
                      setDragOverSlotIdx(null);
                      setDragOverConstellationCardId(null);
                    }}
                    style={{
                      position: "relative",
                      width: slotW,
                      flexShrink: 0,
                      outline: isDropTarget ? "2px dashed var(--accent, var(--gold))" : "none",
                      outlineOffset: 3,
                      borderRadius: 6,
                      transition: "outline 120ms ease",
                      cursor: "grab",
                    }}
                    onMouseEnter={(e) => {
                      setHoveredSlotIdx(idx);
                      // EJ24 — the 450ms hover delay now lives inside
                      // handleConstellationHover, so every callsite
                      // (slot row, constellation hero, companions)
                      // gets the same intentional-hover gating.
                      const rect = e.currentTarget.getBoundingClientRect();
                      handleConstellationHover(pick.cardIndex, e.clientX, e.clientY, rect);
                    }}
                    onMouseMove={(e) => {
                      // EJ23 — if the popover is already open for this
                      // card, refresh the rect (covers minor card
                      // reflows). Otherwise no-op — the delayed open
                      // is in flight.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const popoverOpen =
                        activePopover?.kind === "card-meaning" &&
                        activePopover.key === String(pick.cardIndex);
                      if (popoverOpen) {
                        handleConstellationHover(pick.cardIndex, e.clientX, e.clientY, rect);
                      }
                    }}
                    onMouseLeave={(e) => {
                      setHoveredSlotIdx((cur) => (cur === idx ? null : cur));
                      handleConstellationHover(null, e.clientX, e.clientY);
                    }}
                    onDragOver={(e) => {
                      if (draggingCardId === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      if (dragOverSlotIdx !== idx) setDragOverSlotIdx(idx);
                    }}
                    onDragLeave={() => {
                      if (dragOverSlotIdx === idx) setDragOverSlotIdx(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const raw = e.dataTransfer.getData("application/x-tarotseed-cardid");
                      const id = raw ? Number(raw) : draggingCardId;
                      if (id !== null && Number.isFinite(id)) {
                        handleSlotDrop(idx, id);
                      } else {
                        setDraggingCardId(null);
                        setDragOverSlotIdx(null);
                      }
                    }}
                  >
                    {inEcho && (
                      <div
                        aria-hidden
                        className="tarotseed-constellation-breathe"
                        style={{
                          position: "absolute",
                          // EI2 — tighter outset so the glow hugs the card.
                          // -8 was too far and the top edge clipped against
                          // the chip-grid row above. -3 keeps the glow flush
                          // with the card edges and stays within the slot's
                          // visual envelope.
                          top: -3,
                          left: -3,
                          right: -3,
                          bottom: -3,
                          // EI2 — brighter at the inner band so the glow
                          // reads as "hugging" the card rather than a far
                          // halo. Strong at 0–35%, fades by 70%.
                          background:
                            "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 60%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 35%, transparent) 50%, transparent 78%)",
                          pointerEvents: "none",
                          zIndex: 0,
                          // EJ61 — Deck-derived corner radius. Was hardcoded
                          // 8px which didn't match the card silhouette for
                          // any specific deck. The glow lives at inset:-3 so
                          // the radius adds 3px on top of the deck radius
                          // to keep the outer curve concentric with the
                          // card's printed (alpha-masked) corners.
                          borderRadius: Math.round((deckRadiusPct / 100) * slotW) + 3,
                        }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setFocusedSlotIdx(idx)}
                      // EK94 — hovering a slot card pulses its calendar days,
                      // same path as constellation-card hover (hoverCardId only
                      // feeds the calendar's hoverStrokeYmds; no other effect).
                      onMouseEnter={() => setHoverCardId(pick.cardIndex)}
                      onMouseLeave={() => setHoverCardId(null)}
                      style={{
                        // EJ59 — Dropped the `outline: 2px solid accent;
                        // outline-offset: 2px; border-radius: 5` ring.
                        // CSS outline does NOT curve to border-radius
                        // reliably AND borderRadius: 5 was hardcoded
                        // instead of deck-derived. Both reasons the
                        // ring corners didn't hug the card silhouette.
                        // The hug now comes from CardImage's internal
                        // selection ring (EJ57): an absolute span at
                        // inset:-2 with borderRadius derived per-card
                        // from the deck's stored corner_radius_percent,
                        // matching the constellation hero pattern.
                        // EJ60 — font-size:0, line-height:0, vertical-
                        // align:top to kill the inline-block descender
                        // strut. CardImage's wrapper is display:inline-
                        // block. Without these on the parent, the
                        // parent's line-height inflates the inline-
                        // block's effective vertical space and the
                        // wrapper renders measurably taller than the
                        // IMG inside it. Result: the selection ring
                        // (at inset:-2 of the wrapper) extended past
                        // the visible card. Matches the hero pattern
                        // in ConstellationWeb.tsx (EJ29 fix that
                        // earned "FINALLY!!").
                        position: "relative",
                        zIndex: 1,
                        width: slotW,
                        padding: 0,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "block",
                        fontSize: 0,
                        lineHeight: 0,
                        verticalAlign: "top",
                      }}
                    >
                      <CardImage
                        variant="face"
                        cardId={pick.cardIndex}
                        reversed={pick.isReversed}
                        deckId={pick.deckId ?? undefined}
                        size="custom"
                        widthPx={slotW}
                        selected={isFocused}
                      />
                    </button>
                    {/* DV — hover/focus X remove control, top-right of slot. */}
                    {showControls && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSlot(idx);
                        }}
                        onMouseEnter={(e) => {
                          // EJ24 — dismiss the card-meaning popover the
                          // moment the cursor enters this control so the
                          // popover's hover-bridge can't block the click.
                          // Mirrors the hero/teal badge pattern.
                          e.stopPropagation();
                          handleConstellationHover(null, e.clientX, e.clientY);
                        }}
                        aria-label="Remove card from slot"
                        title="Remove card"
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          // EJ24 — z-index 1000 beats popover (--z-toast).
                          zIndex: 1000,
                          width: 20,
                          height: 20,
                          borderRadius: 9999,
                          background: "var(--surface-card)",
                          border: "1px solid var(--border-default)",
                          color: "var(--color-foreground)",
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
                        }}
                      >
                        <X size={11} strokeWidth={2} />
                      </button>
                    )}
                    {/* DV — hover/focus reverse toggle, top-left of slot.
                        Only shown when allow_reversed_cards preference is on. */}
                    {showControls && allowReversed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleReverse(idx);
                        }}
                        onMouseEnter={(e) => {
                          // EJ24 — dismiss popover on enter.
                          e.stopPropagation();
                          handleConstellationHover(null, e.clientX, e.clientY);
                        }}
                        aria-label={pick.isReversed ? "Flip upright" : "Flip reversed"}
                        title={pick.isReversed ? "Flip upright" : "Flip reversed"}
                        style={{
                          position: "absolute",
                          top: -6,
                          left: -6,
                          // EJ24 — z-index 1000 beats popover.
                          zIndex: 1000,
                          width: 20,
                          height: 20,
                          borderRadius: 9999,
                          background: pick.isReversed
                            ? "color-mix(in oklab, var(--accent, var(--gold)) 45%, var(--surface-card) 55%)"
                            : "var(--surface-card)",
                          border: "1px solid var(--border-default)",
                          color: "var(--color-foreground)",
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
                          transform: pick.isReversed ? "rotate(180deg)" : "none",
                          transition: "transform 160ms ease",
                        }}
                      >
                        <RotateCw size={11} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* EJ15 — spread-type dropdown + slot labels row.
                Labels row is now a PURE MIRROR of the slot row above
                (same flex layout, same gap, same widths). The chevron
                no longer sits inside the labels flex — it's absolutely
                positioned in the gutter just to the LEFT of the labels
                row, taking ZERO horizontal space within the row. This
                guarantees each label is centered under its
                corresponding card. The wrapper is position:relative
                so the chevron's absolute coords anchor here. The
                meaning of each slot in the current spread is surfaced
                via a richly-formatted hover popover (kind:
                "slot-label") rather than a native browser tooltip. */}
            <div
              style={{
                position: "relative",
                width: "100%",
                display: insightsMode ? "none" : undefined,
                // EJ16 — marginBottom removed per user spec; the slot
                // row's paddingBottom (2) is the only gap between the
                // slot row and the labels row. Below the labels row,
                // the date / picker row sits flush with no extra
                // spacing.
              }}
            >
              {/* Chevron, anchored in the gutter to the left of the
                  labels row. Negative-left pulls it OUT of the row's
                  width entirely. Right-edge of the chevron sits at
                  the left edge of the labels row. */}
              <div
                style={{
                  position: "absolute",
                  left: -22,
                  top: 0,
                  height: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}
              >
                {!lunationMode && (
                  <SpreadDropdown value={spreadKey} onChange={setSpreadKeyPersisted} />
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: COMPACT_SLOT_GAP,
                  flexWrap: "nowrap",
                  width: "100%",
                }}
              >
                {Array.from({ length: 12 }).map((_, idx) => {
                  // EJ14 — long name shown when it fits (≤6 chars
                  // including spaces); otherwise the short form.
                  // Both source from the spread definition; the long
                  // name is always used in the hover popover so the
                  // seeker can decode the abbreviation.
                  const longName = spread.slotNames[idx];
                  const shortName = spread.slotNamesShort[idx];
                  const meaning = spread.slotMeanings[idx];
                  const display = longName
                    ? longName.length <= 6
                      ? longName
                      : (shortName ?? longName)
                    : undefined;
                  return (
                    <div
                      key={`slot-label-${idx}`}
                      onMouseEnter={(e) => {
                        if (!longName || !meaning) return;
                        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        cancelPopoverDismiss();
                        setActivePopover({
                          kind: "slot-label",
                          key: `${spread.key}-${idx}`,
                          anchorX: r.left + r.width / 2,
                          anchorY: r.bottom + 4,
                          slotName: longName,
                          spreadLabel: spread.label,
                          meaning,
                        });
                      }}
                      onMouseLeave={() => {
                        if (!longName) return;
                        schedulePopoverDismiss("slot-label");
                      }}
                      style={{
                        width: slotW,
                        flexShrink: 0,
                        minHeight: 14,
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 12,
                        textAlign: "center",
                        color: "var(--color-foreground-muted, var(--color-foreground))",
                        opacity: display ? 0.7 : 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        cursor: display ? "help" : "default",
                      }}
                    >
                      {display ?? "\u00a0"}
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
              }}
            >
              {!insightsMode && !lunationMode && (
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full px-3 transition hover:bg-foreground/[0.04]"
                    style={{
                      height: 30,
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption, 0.75rem)",
                      color: "var(--color-foreground)",
                      opacity: backdate ? 0.9 : 0.7,
                      border: "1px solid var(--border-subtle)",
                      background: "transparent",
                      cursor: "pointer",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <CalendarIcon size={13} strokeWidth={1.5} />
                    {format(backdate ?? new Date(), "MMM d")}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0"
                  align="start"
                  style={{
                    zIndex: "var(--z-modal-nested)" as unknown as number,
                  }}
                >
                  <Calendar
                    mode="single"
                    selected={backdate ?? undefined}
                    onSelect={(d) => {
                      if (d) setBackdate(d);
                      setDateOpen(false);
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              )}
              {lunationMode && (
                <LunationLensToggle lens={lunationLens} onLensChange={setLunationLens} />
              )}
              {/* v3.70 — the single-line "type or paste card names" field is
                  removed; the larger Notes box below is now the one place to
                  enter or paste a reading, and it fills the slots on paste. */}
            </div>
          </div>
          {/* EK120 — atlas left-column tab strip: Draw | Asterism. Sits
              directly under the slot row + paste. Switching collapses the
              column so the calendar strip below rises. Atlas-only;
              /constellation renders neither the strip nor the gating. */}
          {atlasMode && (
            <div
              role="tablist"
              aria-label="Atlas tools"
              style={{
                order: 2,
                display: "flex",
                gap: 24,
                borderBottom: "1px solid var(--border-subtle)",
                marginTop: 4,
              }}
            >
              {(
                [
                  ["draw", "Draw"],
                  ["asterism", "Asterism"],
                ] as const
              ).map(([key, label]) => {
                const active = atlasTab === key;
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setAtlasTab(key)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "0 0 8px",
                      cursor: "pointer",
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: "var(--tab-font-size, 13px)",
                      letterSpacing: "0.01em",
                      color: active
                        ? "var(--accent)"
                        : "var(--color-foreground)",
                      opacity: active ? 1 : "var(--ro-plus-10, 0.55)",
                      borderBottom: active
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                      marginBottom: -1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {/* EK109 — atlas asterism controls: rank line, suit line, and
              group builder. Live in the LEFT column, directly under the
              card-name input; atlas mode only.
              EK120 — gated to the Asterism tab. */}
          {atlasMode && atlasTab === "asterism" && (
            <div style={{ order: 3, display: "flex", flexDirection: "column", gap: 14 }}>
              {(() => {
                const selSet = new Set(atlasSelectedCardIds);
                const moonSet = new Set<string>(
                  allAtlasSections.flatMap((s) =>
                    s.tokens
                      .filter((t) => t.t === "moon")
                      .map((t) => (t.t === "moon" ? t.phase : "")),
                  ),
                );
                const rankActive = (r: number) =>
                  rankCardIds(r).every((id) => selSet.has(id));
                const suitActive = (key: string) =>
                  suitCardIds(key).every((id) => selSet.has(id));
                const moonActive = (phase: string) => moonSet.has(phase);
                const empty =
                  atlasTray.length + atlasSections.length === 0;
                const PALETTE = [
                  "#5cead4",
                  "#e0a3ff",
                  "#ffd27d",
                  "#86c5ff",
                  "#ff9eb5",
                ];
                // EK131 — small removable token pill (used in the tray).
                const tokenPill = (tk: AtlasToken) => {
                  const ids = atlasTokenCardIds(tk);
                  return (
                    <span
                      key={atlasTokenKey(tk)}
                      onMouseEnter={() => {
                        if (tk.t === "moon") setAtlasHoverMoonPhase(tk.phase);
                        else if (ids.length) setAtlasAsterismHoverIds(ids);
                      }}
                      onMouseLeave={() => {
                        setAtlasHoverMoonPhase(null);
                        setAtlasAsterismHoverIds(null);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 8px",
                        borderRadius: "var(--radius-md, 7px)",
                        border: `1px solid ${ATLAS_TRACE_COLOR}`,
                        background: "var(--surface-card)",
                        color: "var(--color-foreground)",
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: "var(--text-body-sm)",
                        cursor: "default",
                      }}
                    >
                      {tk.t === "moon" && (
                        <MoonPhaseIcon phase={tk.phase} size={13} />
                      )}
                      {atlasTokenLabel(tk)}
                      <button
                        type="button"
                        aria-label={`Remove ${atlasTokenLabel(tk)}`}
                        onClick={() => removeAtlasToken(atlasTokenKey(tk))}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--color-foreground-muted)",
                          fontSize: 13,
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  );
                };
                // EK131 — committed section chip (below the tray): a mode
                // badge + member names + one × that removes the whole section.
                const sectionChip = (sec: AtlasSection, color: string) => (
                  <span
                    key={sec.uid}
                    onMouseEnter={() =>
                      setAtlasAsterismHoverIds(atlasSectionCardIds(sec))
                    }
                    onMouseLeave={() => setAtlasAsterismHoverIds(null)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "4px 9px",
                      borderRadius: "var(--radius-md, 8px)",
                      border: `1px solid ${color}`,
                      background: "var(--surface-card)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--font-serif)",
                      fontSize: "var(--text-body-sm)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "var(--text-caption)",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color,
                      }}
                    >
                      {sec.mode === "all" ? "matches all" : "matches any"}
                    </span>
                    <span style={{ fontStyle: "italic" }}>
                      {sec.tokens
                        .map(atlasTokenLabel)
                        .join(sec.mode === "all" ? " + " : " · ")}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove section"
                      onClick={() => removeAtlasSection(sec.uid)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--color-foreground-muted)",
                        fontSize: 13,
                        lineHeight: 1,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
                // EK131 — the tray accepts dropped clock cards and dragged
                // rank/suit/moon chips.
                const onTrayDragOver = (e: React.DragEvent) => {
                  const t = e.dataTransfer.types;
                  if (
                    t.includes("application/x-tarotseed-cardid") ||
                    t.includes("application/x-tarotseed-group")
                  ) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                };
                const onTrayDrop = (e: React.DragEvent) => {
                  e.preventDefault();
                  setDraggingGroup(false);
                  const cardRaw = e.dataTransfer.getData(
                    "application/x-tarotseed-cardid",
                  );
                  if (cardRaw !== "") {
                    const cid = Number(cardRaw);
                    if (Number.isFinite(cid) && cid >= 0)
                      addAtlasToken({ t: "card", cardId: cid });
                    return;
                  }
                  const groupRaw = e.dataTransfer.getData(
                    "application/x-tarotseed-group",
                  );
                  if (groupRaw !== "") {
                    try {
                      const g = JSON.parse(groupRaw) as {
                        kind: string;
                        key: string;
                      };
                      if (g.kind === "rank")
                        addAtlasToken({ t: "rank", r: Number(g.key) });
                      else if (g.kind === "suit")
                        addAtlasToken({ t: "suit", key: g.key });
                      else if (g.kind === "moon")
                        addAtlasToken({
                          t: "moon",
                          phase: g.key as "Full Moon" | "New Moon",
                        });
                    } catch {
                      /* ignore malformed payloads */
                    }
                  }
                };
                // EK132 — live plain-language readout of the asterism, plus a
                // faint preview clause when a card/chip is hovered.
                const previewActive: AtlasToken | null = (() => {
                  if (!atlasPreviewToken) return null;
                  const k = atlasTokenKey(atlasPreviewToken);
                  if (
                    allAtlasSections.some((s) =>
                      s.tokens.some((t) => atlasTokenKey(t) === k),
                    )
                  )
                    return null;
                  if (
                    atlasPreviewToken.t === "card" &&
                    selSet.has(atlasPreviewToken.cardId)
                  )
                    return null;
                  return atlasPreviewToken;
                })();
                const readoutPreds = allAtlasSections
                  .map(atlasSectionPredicate)
                  .filter(Boolean);
                const readoutBase =
                  readoutPreds.length === 0
                    ? ""
                    : readoutPreds.length === 1
                      ? `Matches a spread that ${readoutPreds[0]}`
                      : readoutPreds.length === 2
                        ? `Matches a spread when both hold: it ${readoutPreds[0]}, and it ${readoutPreds[1]}`
                        : `Matches a spread when all of these hold: ${readoutPreds
                            .map((p) => "it " + p)
                            .join("; ")}`;
                const previewPred = previewActive
                  ? atlasSectionPredicate({
                      mode: "all",
                      tokens: [previewActive],
                    })
                  : "";
                const clarifiers = Array.from(
                  new Set(
                    [
                      ...allAtlasSections.flatMap((s) => s.tokens),
                      ...(previewActive ? [previewActive] : []),
                    ]
                      .map(atlasTokenClarifier)
                      .filter((c): c is string => Boolean(c)),
                  ),
                );
                return (
                  <>
                    {/* EK121 — Ranks + Suits + Moon flow on ONE wrapping

                        line; the three section labels are dropped to
                        recoup vertical space in the Asterism tab. */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 5,
                        alignItems: "center",
                      }}
                    >
                        {ATLAS_RANK_GLYPHS.map((label, r) => {
                          const on = rankActive(r);
                          return (
                            <button
                              key={r}
                              type="button"
                              title={`Select all four ${ATLAS_RANK_FULL[r]}s`}
                              onClick={() => addAtlasToken({ t: "rank", r })}
                              draggable
                              onDragStart={(e) => {
                                // EK112 — drag this rank into a slot to make a
                                // group slot ("any Six"). Click still bulk-
                                // selects. Distinct payload from card drags.
                                e.dataTransfer.effectAllowed = "copy";
                                e.dataTransfer.setData(
                                  "application/x-tarotseed-group",
                                  JSON.stringify({ kind: "rank", key: String(r) }),
                                );
                                setDraggingGroup(true);
                              }}
                              onDragEnd={() => setDraggingGroup(false)}
                              onMouseEnter={() => {
                                setAtlasHoverChip(rankCardIds(r));
                                setAtlasPreviewToken({ t: "rank", r });
                              }}
                              onMouseLeave={() => {
                                setAtlasHoverChip(null);
                                setAtlasPreviewToken(null);
                              }}
                              style={{
                                textAlign: "center",
                                padding: "4px 9px",
                                borderRadius: "var(--radius-md, 6px)",
                                border: on
                                  ? `1px solid ${ATLAS_TRACE_COLOR}`
                                  : "0.5px solid var(--border-default)",
                                background: on
                                  ? ATLAS_TRACE_COLOR
                                  : "var(--surface-card)",
                                color: on
                                  ? "var(--background)"
                                  : "var(--color-foreground)",
                                fontFamily: "var(--font-display)",
                                fontStyle: "italic",
                                fontSize: "var(--text-body-sm)",
                                fontWeight: on ? 600 : 400,
                                cursor: "pointer",
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                        {ATLAS_SUIT_LIST.map((s) => {
                          const on = suitActive(s.key);
                          return (
                            <button
                              key={s.key}
                              type="button"
                              title={`Select all ${s.label}`}
                              onClick={() => addAtlasToken({ t: "suit", key: s.key })}
                              draggable
                              onDragStart={(e) => {
                                // EK112 — drag this suit into a slot to make a
                                // group slot ("any Cups"). Click still bulk-
                                // selects.
                                e.dataTransfer.effectAllowed = "copy";
                                e.dataTransfer.setData(
                                  "application/x-tarotseed-group",
                                  JSON.stringify({ kind: "suit", key: s.key }),
                                );
                                setDraggingGroup(true);
                              }}
                              onDragEnd={() => setDraggingGroup(false)}
                              onMouseEnter={() => {
                                setAtlasHoverChip(suitCardIds(s.key));
                                setAtlasPreviewToken({ t: "suit", key: s.key });
                              }}
                              onMouseLeave={() => {
                                setAtlasHoverChip(null);
                                setAtlasPreviewToken(null);
                              }}
                              style={{
                                padding: "4px 9px",
                                borderRadius: "var(--radius-md, 6px)",
                                border: on
                                  ? `1px solid ${ATLAS_TRACE_COLOR}`
                                  : "0.5px solid var(--border-default)",
                                background: on
                                  ? ATLAS_TRACE_COLOR
                                  : "var(--surface-card)",
                                color: on
                                  ? "var(--background)"
                                  : "var(--color-foreground)",
                                fontFamily: "var(--font-display)",
                                fontStyle: "italic",
                                fontSize: "var(--text-body-sm)",
                                fontWeight: on ? 600 : 400,
                                cursor: "pointer",
                              }}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                        {(["Full Moon", "New Moon"] as const).map((phase) => {
                          const on = moonActive(phase);
                          return (
                            <button
                              key={phase}
                              type="button"
                              title={`Add a ${phase} to the asterism (drag into a slot to match it as a group)`}
                              onClick={() => toggleAtlasMoonPhase(phase)}
                              onMouseEnter={() => {
                                setAtlasHoverMoonPhase(phase);
                                setAtlasPreviewToken({ t: "moon", phase });
                              }}
                              onMouseLeave={() => {
                                setAtlasHoverMoonPhase(null);
                                setAtlasPreviewToken(null);
                              }}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "copy";
                                e.dataTransfer.setData(
                                  "application/x-tarotseed-group",
                                  JSON.stringify({ kind: "moon", key: phase }),
                                );
                                setDraggingGroup(true);
                              }}
                              onDragEnd={() => setDraggingGroup(false)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "4px 9px",
                                borderRadius: "var(--radius-md, 6px)",
                                border: on
                                  ? `1px solid ${ATLAS_TRACE_COLOR}`
                                  : "0.5px solid var(--border-default)",
                                background: on
                                  ? ATLAS_TRACE_COLOR
                                  : "var(--surface-card)",
                                color: on
                                  ? "var(--background)"
                                  : "var(--color-foreground)",
                                fontFamily: "var(--font-display)",
                                fontStyle: "italic",
                                fontSize: "var(--text-body-sm)",
                                cursor: "pointer",
                              }}
                            >
                              <MoonPhaseIcon phase={phase} size={14} />
                              {phase}
                            </button>
                          );
                        })}
                    </div>

                    {/* EK131 — Asterism builder: a live drop-target tray that
                        accepts clock cards and rank/suit/moon chips, two
                        commit buttons (matches any / matches all), and the
                        committed section chips below. */}
                    <div
                      onDragOver={onTrayDragOver}
                      onDrop={onTrayDrop}
                      style={{
                        border: "0.5px solid var(--border-subtle)",
                        borderRadius: "var(--radius-md, 8px)",
                        background: "var(--surface-card)",
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "var(--text-caption)",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--color-foreground-muted)",
                            fontFamily: "var(--font-sans)",
                          }}
                        >
                          Asterism
                        </span>
                        {!empty && (
                          <button
                            type="button"
                            onClick={handleAtlasClear}
                            style={{
                              padding: "3px 10px",
                              borderRadius: "var(--radius-md, 7px)",
                              border: "0.5px solid var(--border-default)",
                              background: "transparent",
                              color: "var(--color-foreground-muted)",
                              fontFamily: "var(--font-sans)",
                              fontSize: "var(--text-body-sm)",
                              cursor: "pointer",
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {/* Live tray (drop zone). */}
                      <div
                        style={{
                          minHeight: 40,
                          border: `1px dashed ${
                            atlasTray.length
                              ? ATLAS_TRACE_COLOR
                              : "var(--border-default)"
                          }`,
                          borderRadius: "var(--radius-md, 7px)",
                          padding: "8px 9px",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        {atlasTray.length === 0 ? (
                          <span
                            style={{
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                              fontSize: "var(--text-body-sm)",
                              color: "var(--color-foreground-muted)",
                            }}
                          >
                            Drag a card here, or tap a card on the clock or a
                            chip above — cards, suits, ranks, and moons all
                            welcome.
                          </span>
                        ) : (
                          atlasTray.map((tk) => tokenPill(tk))
                        )}
                      </div>

                      {/* Commit buttons. */}
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          justifyContent: "flex-end",
                        }}
                      >
                        {(["any", "all"] as const).map((mode) => {
                          const enabled = atlasTray.length > 0;
                          return (
                            <button
                              key={mode}
                              type="button"
                              disabled={!enabled}
                              onClick={() => commitAtlasSection(mode)}
                              title={
                                mode === "any"
                                  ? "Match a spread that has ANY of these"
                                  : "Match a spread that has ALL of these"
                              }
                              style={{
                                padding: "3px 10px",
                                borderRadius: "var(--radius-md, 7px)",
                                border: "0.5px solid var(--border-default)",
                                background: "transparent",
                                color: enabled
                                  ? "var(--color-foreground)"
                                  : "var(--color-foreground-muted)",
                                fontFamily: "var(--font-sans)",
                                fontSize: "var(--text-body-sm)",
                                cursor: enabled ? "pointer" : "default",
                                opacity: enabled ? 1 : 0.5,
                              }}
                            >
                              {mode === "any" ? "Matches any" : "Matches all"}
                            </button>
                          );
                        })}
                      </div>

                      {/* Committed section chips. */}
                      {atlasSections.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            alignItems: "center",
                            paddingTop: 2,
                          }}
                        >
                          {atlasSections.map((sec, si) =>
                            sectionChip(sec, PALETTE[si % PALETTE.length]),
                          )}
                        </div>
                      )}

                      {/* EK132 — always-visible plain-language readout. */}
                      <div
                        style={{
                          borderTop: "0.5px solid var(--border-subtle)",
                          paddingTop: 10,
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <Sparkles
                          size={14}
                          aria-hidden
                          style={{
                            color: ATLAS_TRACE_COLOR,
                            flexShrink: 0,
                            marginTop: 3,
                          }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {readoutBase === "" && !previewActive ? (
                            <span
                              style={{
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                                fontSize: "var(--text-body-sm)",
                                color: "var(--color-foreground-muted)",
                              }}
                            >
                              Tap a card on the clock or a chip above to begin
                              shaping the asterism — the meaning shows here as
                              you build.
                            </span>
                          ) : (
                            <p
                              style={{
                                margin: 0,
                                fontFamily: "var(--font-serif)",
                                fontSize: "var(--text-body-sm)",
                                lineHeight: 1.55,
                                color: "var(--color-foreground)",
                              }}
                            >
                              {readoutBase}
                              {previewActive &&
                                (readoutBase === "" ? (
                                  <span
                                    style={{
                                      fontStyle: "italic",
                                      color: "var(--color-foreground-muted)",
                                    }}
                                  >
                                    If you add it: a spread that {previewPred}
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontStyle: "italic",
                                      color: "var(--color-foreground-muted)",
                                    }}
                                  >
                                    {" "}
                                    — and it {previewPred} (hovering)
                                  </span>
                                ))}
                              .
                            </p>
                          )}
                          {clarifiers.length > 0 && (
                            <p
                              style={{
                                margin: 0,
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                                fontSize: "var(--text-caption)",
                                lineHeight: 1.5,
                                color: "var(--color-foreground-muted)",
                              }}
                            >
                              {clarifiers.join("; ")}.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          {/* DY — bottom of right column: question + prompts trigger,
              notes textarea, Save to Journal button. Hides entirely
              when no picks.
              EK120 — on atlas, lives in the Draw tab. /constellation
              (non-atlas) shows it unconditionally as before. */}
          {lunationMode && (
            <div style={{ order: 4, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
{lunationLens === "calendar" ? (
        <div>
          <OverlapStrip
            overlap={overlap}
            heroCardId={heroPick?.cardIndex ?? null}
            pullCardIds={picks.map((p) => p.cardIndex)}
            pullGroups={
              atlasMode
                ? atlasGroupSlots.flatMap((g) =>
                    g.kind === "moon" ? [] : [g.ids],
                  )
                : undefined
            }
            pullMoonGroups={
              atlasMode
                ? atlasGroupSlots.flatMap((g) =>
                    g.kind === "moon" ? [daysForMoonPhase(g.phase)] : [],
                  )
                : undefined
            }
            mode={overlapMode}
            onModeChange={setOverlapMode}
            showModeToggle={false}
            tealSelectedIds={tealSelectedIds}
            asterismYmds={atlasMode ? atlasMatch.ymds : undefined}
            previewYmds={atlasMode ? atlasHoverYmds : undefined}
            layout="grid12"
            onDayClick={(date) => setDayPopover({ open: true, date })}
            showOlder
            onShowOlderChange={setShowOlder}
            // EJ65 — Hide the inline "Show older" pill since the
            // calendar visibility is now driven by the PageMenu
            // cycler in the left fly-out.
            showOlderToggle={false}
            onDayHover={(info) => {
              cancelPopoverDismiss();
              setActivePopover({
                kind: "day-cell",
                key: info.date,
                anchorX: info.anchorX,
                anchorY: info.anchorY,
                targetRect: info.targetRect,
                date: info.date,
                signals: info.signals,
                tooltipText: info.tooltipText,
              });
            }}
            onDayHoverEnd={(date) => schedulePopoverDismiss("day-cell", date)}
            asterismBadgeHovered={asterismBadgeHovered}
            hoverStrokeYmds={hoverStrokeYmds}
            pulseHoverDays={pulseHoverDays}
            monthsToShow={calendarRows * 4}
            gridCols={4}
            calendarNumberMode={calendarNumberMode}
            birthDate={birthDate}
          />
          <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8 }}>
            {calendarRows > 1 && (
              <button
                type="button"
                onClick={() => setCalendarRows((r) => Math.max(1, r - 1))}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "4px" }}
              >
                Show less
              </button>
            )}
            {calendarRows < 3 && (
              <button
                type="button"
                onClick={() => setCalendarRows((r) => Math.min(3, r + 1))}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "4px" }}
              >
                Show more
              </button>
            )}
          </div>
        </div>
        ) : (
        <LunationStrip
          months={overlap?.months ?? []}
          readingsByDate={overlap?.readingsByDate ?? {}}
          heroCardId={heroPick?.cardIndex ?? null}
          pullCardIds={picks.map((p) => p.cardIndex)}
          tealSelectedIds={tealSelectedIds}
          mode={overlapMode}
          calendarNumberMode={calendarNumberMode}
          birthDate={birthDate}
          timeRange={globalFilters.timeRange ?? DEFAULT_TIMEFRAME}
          effectiveTz={effectiveTz}
          lens={lunationLens}
          onLensChange={setLunationLens}
          showToggle={false}
          heroName={
            heroPick?.cardIndex != null
              ? resolveCardName(heroPick.cardIndex)
              : ""
          }
          hoverStrokeYmds={hoverStrokeYmds}
          pulseHoverDays={pulseHoverDays}
          onDayClick={(date) => setDayPopover({ open: true, date })}
          onDayHover={(info) => {
            cancelPopoverDismiss();
            setActivePopover({
              kind: "day-cell",
              key: info.date,
              anchorX: info.anchorX,
              anchorY: info.anchorY,
              targetRect: info.targetRect,
              date: info.date,
              signals: info.signals,
              tooltipText: info.tooltipText,
            });
          }}
          onDayHoverEnd={(date) => schedulePopoverDismiss("day-cell", date)}
          patternLens={
            activePattern &&
            (activePattern.lens === "moon" ||
              activePattern.lens === "day" ||
              activePattern.lens === "numerology" ||
              activePattern.lens === "weekday")
              ? activePattern.lens
              : null
          }
          patternYmds={activePattern ? new Set(activePattern.memberYmds) : null}
        />
        )}
            </div>
          )}
          {insightsMode && !lunationMode && picks.length > 0 && heroPick && (
            <div
              style={{
                order: 4,
                marginTop: 12,
              }}
            >
              {cardStats ? (
                <HeroPatternCluster
                  heroCardId={heroPick.cardIndex}
                  heroDeckId={heroPick.deckId ?? undefined}
                  stats={cardStats}
                  drawCounts={drawCounts}
                  tz={effectiveTz}
                  trackReversals={allowReversed}
                />
              ) : (
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm, 0.85rem)",
                    color: "var(--color-foreground)",
                    opacity: 0.55,
                    textAlign: "center",
                    padding: "8px 0",
                  }}
                >
                  Gathering this card's patterns…
                </div>
              )}
            </div>
          )}
          {/* v3.71 — no longer gated on picks so the Notes box (the paste
              target) is available on an empty manual entry to fill the slots. */}
          {(!atlasMode || atlasTab === "draw") && !insightsMode && !lunationMode && (
            <div
              style={{
                order: 4,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 12,
              }}
            >
              {/* Row: question input + prompts trigger button.
                  v3.72 — moved BELOW the Notes box via order. */}
              <div
                style={{
                  order: 2,
                  display: "flex",
                  gap: 6,
                  alignItems: "stretch",
                  width: "100%",
                }}
              >
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Tap to add your question for the cards…"
                  rows={1}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 36,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle)",
                    background: "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm, 0.85rem)",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    // EJ30 — open prompts modal scoped to the current
                    // hero. Reset the per-modal selection so the next
                    // open starts on the hero again.
                    setPromptsModalCardId(null);
                    setPromptsModalOpen(true);
                  }}
                  disabled={!heroPick}
                  aria-label="Browse journaling prompts"
                  title={heroPick ? "Browse journaling prompts" : "Focus a card to see its prompts"}
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle)",
                    background: "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)",
                    color: "var(--accent, var(--gold))",
                    cursor: heroPick ? "pointer" : "not-allowed",
                    opacity: heroPick ? 1 : 0.4,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                >
                  <Feather className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {/* Notes textarea — EF2: shortened to 2 rows per spec.
                  Save action moved up into the OverlapStrip pill row. */}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData?.getData("text") ?? "";
                  if (!text.trim()) return;
                  // v3.70 — scan the pasted reading for the cards named in it
                  // and drop them into the slots (reversed detected). We do
                  // NOT preventDefault, so the text still lands in the note.
                  const outcome = scanTextForCards(
                    buildSearchIndex(deckCards),
                    text,
                    78,
                  );
                  if (outcome.picks.length > 0) handleBulk(outcome);
                }}
                placeholder="Write or paste your reading here — your question(s) and the cards you pulled (add 'reversed' for any that were). Any cards you name get placed in the slots for you."
                rows={6}
                style={{
                  order: 1,
                  width: "100%",
                  minHeight: 140,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  background: "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm, 0.85rem)",
                  resize: "vertical",
                  outline: "none",
                }}
              />
              {/* EF3 — Pill row: Hide older / Same pull-day / Save to
                  journal. Sits directly under the notes textarea now,
                  decoupled from the calendar so the calendar can move
                  up to the top of its container. */}
              <div style={{ marginTop: 6, order: 3 }}>
                <OverlapPills
                  mode={overlapMode}
                  onModeChange={setOverlapMode}
                  showOlder={showOlder}
                  onShowOlderChange={setShowOlder}
                  onSaveToJournal={() => void handleSaveToJournal()}
                  saveStatus={saveStatus}
                  saveError={saveError}
                  saveDisabled={
                    !canSubmit ||
                    (atlasMode && atlasGroupSlots.length > 0)
                  }
                  saveDisabledReason={
                    atlasMode && atlasGroupSlots.length > 0
                      ? "A rank or suit slot matches any card, so there's no single spread to save. Swap it for a specific card to save this reading."
                      : undefined
                  }
                  align="flex-start"
                  // EK68 — same-spread/day and Hide-older moved into the
                  // fly-out menu; this row now shows only Save to journal.
                  saveOnly
                  // v3.50 — "Get AI reading" sits beside Save to journal.
                  onGetAiReading={() => setAiSheetOpen(true)}
                  aiDisabled={
                    !canSubmit ||
                    (atlasMode && atlasGroupSlots.length > 0)
                  }
                />
              </div>
              <AiReadingSheet
                open={aiSheetOpen}
                onClose={() => setAiSheetOpen(false)}
                userId={user?.id ?? null}
                spreadLabel={spread.label}
                positionLabels={spread.slotNames}
                picks={picks.map((p) => ({
                  cardId: p.cardIndex,
                  reversed: !!p.isReversed,
                }))}
                resolveCardName={resolveCardName}
                question={question}
                note={note}
                patterns={allPatterns}
              />
            </div>
          )}
          {/* EK134 — patterns panel (order 5, bottom of both atlas tabs).
              Renders ONLY when at least one detector beats chance. */}
          {atlasMode && atlasPatterns.length > 0 && (
            <div
              style={{
                order: 5,
                marginTop: 6,
                border: "0.5px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 8px)",
                background: "var(--surface-card)",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  borderBottom: "0.5px solid var(--border-subtle)",
                  paddingBottom: 10,
                }}
              >
                <Sparkles size={14} aria-hidden style={{ color: ATLAS_TRACE_COLOR }} />
                <span
                  style={{
                    fontSize: "var(--text-caption)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-foreground-muted)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  Patterns in these days
                </span>
              </div>
              {atlasPatterns.map((pat, i) => (
                <div
                  key={`${pat.kind}-${i}`}
                  style={{ display: "flex", gap: 11, alignItems: "flex-start" }}
                >
                  <span
                    aria-hidden
                    style={{
                      color: ATLAS_TRACE_COLOR,
                      flexShrink: 0,
                      marginTop: 1,
                      display: "inline-flex",
                    }}
                  >
                    {pat.kind === "weekday" ? (
                      <CalendarIcon size={16} />
                    ) : pat.kind === "cadence" ? (
                      <RotateCw size={16} />
                    ) : pat.kind === "trend" ? (
                      <TrendingUp size={16} />
                    ) : pat.kind === "moon" ? (
                      <MoonPhaseIcon
                        phase={pat.moonPhase ?? "Full Moon"}
                        size={16}
                      />
                    ) : (
                      <Sparkles size={16} />
                    )}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <p
                      style={{
                        margin: 0,
                        fontFamily: "var(--font-serif)",
                        fontSize: "var(--text-body-sm)",
                        lineHeight: 1.5,
                        color: "var(--color-foreground)",
                      }}
                    >
                      {pat.title}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "var(--text-caption)",
                        lineHeight: 1.5,
                        color: "var(--color-foreground-muted)",
                      }}
                    >
                      {pat.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* EJ25 — RIGHT column (was LEFT pre-EJ25): constellation web. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            position: "relative",
          }}
        >
          {/* EK68 — the hover-tips toggle moved into the fly-out menu
              (Display → Hover tips), freeing this space over the web. */}
          {/* EK101 — atlas mode swaps the hero+companions web for the
              78-card clock (all cards, Fool at 12 o'clock, clockwise).
              Everything else on the page is unchanged. */}
          {atlasMode ? (
            <AtlasWeb
              pairs={atlasPairs}
              tealSelectedIds={atlasSelectedCardIds}
              cardGroupColor={atlasCardGroupColor}
              onCardClick={handleAtlasCardClick}
              onCardHover={handleConstellationHover}
              onCardDragStart={(cardId) => setDraggingCardId(cardId)}
              onCardDragEnd={() => setDraggingCardId(null)}
              candidateIds={atlasCandidateIds}
              heroCardId={heroPick ? heroPick.cardIndex : null}
              heroDrawCount={
                heroPick && drawCounts
                  ? (drawCounts.perCard[heroPick.cardIndex] ?? null)
                  : null
              }
              heroBadgeTooltip={(() => {
                if (!heroPick) return undefined;
                const heroName =
                  heroPick.cardName ?? TAROT_DECK[heroPick.cardIndex] ?? "this card";
                const count = drawCounts?.perCard[heroPick.cardIndex] ?? 0;
                const unit = count === 1 ? "SPREAD" : "SPREADS";
                return `${count} ${unit} · ${heroName}`;
              })()}
              onHeroBadgeClick={() => {
                setModalMode("hero");
                setReadingsModalOpen(true);
              }}
              tealBadge={
                hasAtlasAsterism && atlasSelectedCardIds.length >= 1
                  ? {
                      cardId: atlasSelectedCardIds[0],
                      count: atlasMatch.count,
                      tooltip: (() => {
                        const unit =
                          overlapMode === "pull"
                            ? atlasMatch.count === 1
                              ? "SPREAD"
                              : "SPREADS"
                            : atlasMatch.count === 1
                              ? "DAY"
                              : "DAYS";
                        return `${atlasMatch.count} ${unit} · ${atlasAsterismNames}`;
                      })(),
                    }
                  : null
              }
              onTealBadgeClick={() => {
                setModalMode("teal");
                setReadingsModalOpen(true);
              }}
            />
          ) : (
          <ConstellationWeb
            heroPick={heroPick}
            constellation={displayedConstellation}
            patternGlyph={
              (insightsMode || lunationMode) && patternReport?.primary
                ? {
                    title: patternReport.primary.explanation,
                    seen: seenPatterns.has(patternReport.primary.patternId),
                  }
                : null
            }
            onPatternClick={() => {
              const p = patternReport?.primary;
              if (!p) return;
              setActivePattern(p);
              markPatternSeen(p.patternId);
              if (p.lens === "moon" || p.lens === "day" || p.lens === "numerology" || p.lens === "weekday") setLunationLens(p.lens);
            }}
            showPlasma
            cardDrawCounts={webCardCounts}
            onCardClick={(cardId) =>
              setTealSelectedIds((prev) =>
                prev.includes(cardId) ? prev.filter((x) => x !== cardId) : [...prev, cardId],
              )
            }
            tealSelectedIds={tealSelectedIds}
            candidateIds={candidateIds}
            heroDrawCount={
              heroPick && drawCounts ? (drawCounts.perCard[heroPick.cardIndex] ?? null) : null
            }
            onCardDragStart={(cardId) => setDraggingCardId(cardId)}
            onCardHover={handleConstellationHover}
            onLineHover={(a, b) =>
              setHoveredPair(a !== null && b !== undefined ? { a, b } : null)
            }
            onConstellationDrop={handleConstellationDrop}
            dragOverTargetId={dragOverConstellationCardId}
            onConstellationDragOver={setDragOverConstellationCardId}
            onHeroBadgeClick={() => {
              // EC — gold hero badge opens the readings modal scoped to
              // ALL pulls containing the hero. Teal selection is NOT
              // cleared and NOT applied — modal data is hero-anchored.
              setModalMode("hero");
              setReadingsModalOpen(true);
            }}
            heroBadgeTooltip={(() => {
              // EC — gold badge tooltip: "N PULLS · [Hero Card Name]".
              // Always PULLS regardless of the same-pull/same-day pill
              // (gold badge is hero-anchored and pull-anchored).
              if (!heroPick) return undefined;
              const heroName = heroPick.cardName ?? TAROT_DECK[heroPick.cardIndex] ?? "this card";
              const count = drawCounts?.perCard[heroPick.cardIndex] ?? 0;
              const unit = count === 1 ? "SPREAD" : "SPREADS";
              return `${count} ${unit} · ${heroName}`;
            })()}
            tealBadge={
              tealSelectedIds.length >= 2
                ? {
                    cardId: tealSelectedIds[0],
                    // EC — unit-aware count: readings in same-pull mode,
                    // days in same-day mode. The unit label is rendered
                    // in the tooltip + modal title (PULLS or DAYS).
                    count: tealCount,
                    tooltip: (() => {
                      const unit =
                        overlapMode === "pull"
                          ? tealCount === 1
                            ? "SPREAD"
                            : "SPREADS"
                          : tealCount === 1
                            ? "DAY"
                            : "DAYS";
                      const names = tealSelectedIds
                        .map((id) => TAROT_DECK[id] ?? "Card")
                        .join(", ");
                      return `${tealCount} ${unit} · ${names}`;
                    })(),
                  }
                : null
            }
            onTealBadgeClick={() => {
              setModalMode("teal");
              setReadingsModalOpen(true);
            }}
            onHeroBadgeHover={(clientX, clientY) => {
              if (!heroPick) return;
              // EK57 — badge precedence: flag badge hover and kill any
              // pending card-popover open timer so card data can't
              // clobber the badge popover.
              badgeHoveredRef.current = true;
              window.clearTimeout(slimHoverDelayRef.current);
              const heroName = heroPick.cardName ?? TAROT_DECK[heroPick.cardIndex] ?? "this card";
              const count = drawCounts?.perCard[heroPick.cardIndex] ?? 0;
              cancelPopoverDismiss();
              setActivePopover({
                kind: "constellation-badge",
                key: `hero-${heroPick.cardIndex}`,
                anchorX: clientX,
                anchorY: clientY,
                variant: "hero",
                count,
                modeOrPullsLabel: count === 1 ? "1 SPREAD" : `${count} SPREADS`,
                cardLabel: heroName,
              });
            }}
            onHeroBadgeHoverEnd={() => {
              badgeHoveredRef.current = false;
              schedulePopoverDismiss("constellation-badge");
            }}
            onTealBadgeHover={(clientX, clientY) => {
              // EK57 — badge precedence (see hero badge above).
              badgeHoveredRef.current = true;
              window.clearTimeout(slimHoverDelayRef.current);
              const names = tealSelectedIds.map((id) => TAROT_DECK[id] ?? "Card").join(", ");
              const unit =
                overlapMode === "pull"
                  ? tealCount === 1
                    ? "1 SPREAD"
                    : `${tealCount} SPREADS`
                  : tealCount === 1
                    ? "1 DAY"
                    : `${tealCount} DAYS`;
              cancelPopoverDismiss();
              setActivePopover({
                kind: "constellation-badge",
                key: `teal-${tealSelectedIds.join(",")}`,
                anchorX: clientX,
                anchorY: clientY,
                variant: "teal",
                count: tealCount,
                modeOrPullsLabel: unit,
                cardLabel: names,
              });
              // EK100 — badge takes hover priority over the card it sits on:
              // clear the card hover so the calendar breathes only the
              // asterism's co-occurrence days, not all of this card's days.
              setHoverCardId(null);
              // EJ25 — signal the calendar to swap qualifying-day fills
              // from gold heatmap to solid trace color.
              setAsterismBadgeHovered(true);
            }}
            onTealBadgeHoverEnd={() => {
              badgeHoveredRef.current = false;
              schedulePopoverDismiss("constellation-badge");
              // EJ25 — revert calendar fills on leave.
              setAsterismBadgeHovered(false);
              // EK100 — also clear the card hover so the breathing stops on
              // leave instead of persisting until something else is hovered.
              setHoverCardId(null);
            }}
            onPopoverDismissImmediate={() => closeActivePopover("card-meaning")}
          />
          )}
          {lunationMode && picks.length > 0 && heroPick && (
            <div
              style={{
                marginTop: 12,
                marginLeft: 30,
                width: SVG_W - 60,
                maxWidth: "100%",
              }}
            >
              {cardStats ? (
                <HeroPatternCluster
                  heroCardId={heroPick.cardIndex}
                  heroDeckId={heroPick.deckId ?? undefined}
                  stats={cardStats}
                  drawCounts={drawCounts}
                  tz={effectiveTz}
                  trackReversals={allowReversed}
                />
              ) : (
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm, 0.85rem)",
                    color: "var(--color-foreground)",
                    opacity: 0.55,
                    textAlign: "center",
                    padding: "8px 0",
                  }}
                >
                  Gathering this card's patterns…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Calendar strip — DY: snug to constellation (was 10px gap).
          DZ — day cells are clickable; tapping a day with readings opens
          the day-readings popover for that date.
          EJ65 — Hidden entirely when calendarState === "none" (0 rows
          showing). The PageMenu's calendar cycle button advances
          through none → recent → both → none. */}
      {!lunationMode && (
        <>
      {/* v2.89 — always-visible eyeball cycler above the calendar. Tap cycles
          12 → 6 → hidden → 12 (both → recent → none), mirroring the PageMenu
          "Calendars" item. Stays put even when hidden so the calendar can
          always be brought back — the only visible control on Insights →
          Patterns. */}
      <div style={{ position: "relative", height: 22, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
            if (calendarState === "both") {
              setShowOlder(false);
            } else if (calendarState === "recent") {
              setShowRecent(false);
              setShowOlder(false);
            } else {
              setShowRecent(true);
              setShowOlder(true);
            }
          }}
          aria-label="Cycle calendar view: 12 months, 6 months, hidden"
          title={
            calendarState === "both"
              ? "12 months — tap for 6"
              : calendarState === "recent"
                ? "6 months — tap to hide"
                : "Calendar hidden — tap to show"
          }
          style={{
            position: "absolute",
            top: 0,
            left: 24,
            zIndex: 4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 22,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            color:
              calendarState === "none"
                ? "var(--color-foreground)"
                : "var(--accent, var(--gold))",
            opacity:
              calendarState === "both"
                ? 1
                : calendarState === "recent"
                  ? 0.5
                  : 0.45,
          }}
        >
          {calendarState === "none" ? (
            <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
      </div>
      {!lunationMode && calendarState !== "none" && (
        <div style={{ padding: "0 24px 24px", flexShrink: 0 }}>
          <OverlapStrip
            overlap={overlap}
            heroCardId={heroPick?.cardIndex ?? null}
            pullCardIds={picks.map((p) => p.cardIndex)}
            pullGroups={
              atlasMode
                ? atlasGroupSlots.flatMap((g) =>
                    g.kind === "moon" ? [] : [g.ids],
                  )
                : undefined
            }
            pullMoonGroups={
              atlasMode
                ? atlasGroupSlots.flatMap((g) =>
                    g.kind === "moon" ? [daysForMoonPhase(g.phase)] : [],
                  )
                : undefined
            }
            mode={overlapMode}
            onModeChange={setOverlapMode}
            showModeToggle={!atlasMode}
            tealSelectedIds={tealSelectedIds}
            asterismYmds={atlasMode ? atlasMatch.ymds : undefined}
            previewYmds={atlasMode ? atlasHoverYmds : undefined}
            layout="grid12"
            onDayClick={(date) => setDayPopover({ open: true, date })}
            showOlder={showOlder}
            onShowOlderChange={setShowOlder}
            // EJ65 — Hide the inline "Show older" pill since the
            // calendar visibility is now driven by the PageMenu
            // cycler in the left fly-out.
            showOlderToggle={false}
            onDayHover={(info) => {
              cancelPopoverDismiss();
              setActivePopover({
                kind: "day-cell",
                key: info.date,
                anchorX: info.anchorX,
                anchorY: info.anchorY,
                targetRect: info.targetRect,
                date: info.date,
                signals: info.signals,
                tooltipText: info.tooltipText,
              });
            }}
            onDayHoverEnd={(date) => schedulePopoverDismiss("day-cell", date)}
            asterismBadgeHovered={asterismBadgeHovered}
            hoverStrokeYmds={hoverStrokeYmds}
            pulseHoverDays={pulseHoverDays}
            monthsToShow={calendarMonthsToShow}
            calendarNumberMode={calendarNumberMode}
            birthDate={birthDate}
          />
        </div>
      )}
        </>
      )}

      {/* Phase 20 Fix 13 — THIS PULL → YOUR PRACTICE → question → Get Reading */}
      {picks.length > 0 && (
        <div style={{ padding: "0 24px", marginTop: 8 }}>
          <SectionDivider />
          <SectionOverline label="YOUR SPREAD" />
          <ThisPullTiles picks={picks} />
        </div>
      )}
      {/* v3.43 — live structural read-out of the current cast, on the manual-
          entry / exploration view only (not the Insights analytics or atlas). */}
      {picks.length >= 2 && !insightsMode && !atlasMode && (
        <div style={{ padding: "0 24px", marginTop: 16 }}>
          <SpreadStructureStrip signals={analyzeSpread(picks).signals} />
          <SpreadCombinationsStrip cardIds={picks.map((p) => p.cardIndex)} />
        </div>
      )}
      {picks.length >= 2 && (
        <div style={{ padding: "0 24px" }}>
          <PullHistoryPill picks={picks} practice={practice} constellation={constellationState} />
        </div>
      )}
      <div style={{ padding: "0 24px", marginTop: 32 }}>
        <SectionDivider />
        <SectionOverline label="YOUR PRACTICE" />
        <PracticeLine practice={practice} currentStreak={currentStreak} />
      </div>
      {/* DY — bottom AI surface. Replaces the old "question textarea + Get
          Reading → /draw" navigation block. Shows a larger duplicate of
          the current picks, fires interpretReading inline, and renders
          the resulting interpretation on this same page. */}
      {picks.length > 0 && (
        <div
          style={{
            marginTop: 24,
            padding: "0 24px 32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          {/* Duplicate larger card display */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 12,
              maxWidth: 960,
            }}
          >
            {picks.map((p) => (
              <div key={`bigpull-${p.id}`} style={{ width: 96, flexShrink: 0 }}>
                <CardImage
                  variant="face"
                  cardId={p.cardIndex}
                  reversed={p.isReversed}
                  deckId={p.deckId ?? undefined}
                  size="custom"
                  widthPx={96}
                />
              </div>
            ))}
          </div>
          {/* Get AI Reading button — hidden on insights Patterns (v2.27) */}
          {!insightsMode && !lunationMode && (
          <button
            type="button"
            onClick={() => void handleGetAIReading()}
            disabled={!canSubmit || aiStatus === "loading"}
            style={{
              minWidth: 200,
              height: 44,
              padding: "0 18px",
              borderRadius: 9999,
              background: "var(--accent, var(--gold))",
              color: "var(--cosmos, #0a0a14)",
              border: "none",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 14,
              cursor: !canSubmit || aiStatus === "loading" ? "not-allowed" : "pointer",
              opacity: !canSubmit || aiStatus === "loading" ? 0.55 : 1,
            }}
          >
            {aiStatus === "loading"
              ? "Listening to the cards…"
              : aiStatus === "ready"
                ? "Re-read the cards"
                : "Get AI reading"}
          </button>
          )}
          {aiStatus === "error" && aiError && (
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--color-foreground)",
                opacity: 0.8,
              }}
            >
              {aiError}
            </p>
          )}
          {/* Inline interpretation */}
          {aiStatus === "ready" && aiInterpretation && (
            <article
              style={{
                width: "100%",
                maxWidth: 720,
                marginTop: 4,
                padding: "20px 22px",
                borderRadius: 12,
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {aiInterpretation.overview && (
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-body, 0.95rem)",
                    lineHeight: 1.55,
                    color: "var(--color-foreground)",
                  }}
                >
                  {aiInterpretation.overview}
                </p>
              )}
              {aiInterpretation.positions.map((pos, idx) => (
                <div
                  key={`${pos.position}-${idx}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: 12,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "var(--accent, var(--gold))",
                      opacity: 0.9,
                    }}
                  >
                    {pos.position} · {pos.card}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-serif)",
                      fontSize: "var(--text-body-sm, 0.9rem)",
                      lineHeight: 1.55,
                      color: "var(--color-foreground)",
                    }}
                  >
                    {pos.interpretation}
                  </p>
                </div>
              ))}
              {aiInterpretation.closing && (
                <p
                  style={{
                    margin: 0,
                    paddingTop: 6,
                    borderTop: "1px solid var(--border-subtle)",
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm, 0.9rem)",
                    lineHeight: 1.55,
                    color: "var(--color-foreground)",
                    opacity: 0.9,
                  }}
                >
                  {aiInterpretation.closing}
                </p>
              )}
            </article>
          )}
        </div>
      )}

      {/* Picker sheet */}
      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent
          side="bottom"
          className="h-[75vh] rounded-t-2xl p-0"
          style={{ zIndex: "var(--z-modal-nested)" as unknown as number }}
        >
          {pickerOpen && (
            <CardPicker
              mode="manual-entry"
              embedded
              deckId={pickerDeckId}
              onDeckChange={setPickerDeckId}
              excludeCardIds={placedIds}
              title="Pick a card"
              drawCountTimeRange={globalFilters.timeRange ?? DEFAULT_TIMEFRAME}
              onCancel={() => {
                // EJ30 — reset deck selection when picker closes so
                // the next open defaults to active deck again.
                setPickerDeckId(null);
                setPickerOpen(false);
              }}
              onSelect={(cardIndex, isReversed, deckId, cardName) => {
                setFocusedSlotIdx(picks.length);
                setPicks((prev) => [
                  ...prev,
                  {
                    id: Date.now() + prev.length,
                    cardIndex,
                    isReversed,
                    // EJ30 — store the source deck on the pick. null
                    // means active deck. Each slot can independently
                    // reference any of the seeker's decks.
                    deckId: deckId ?? null,
                    cardName,
                  },
                ]);
                // Keep deck selection so seeker can pick multiple
                // cards from the same alt deck without re-selecting
                // each time. Reset only on close (above).
                setPickerOpen(false);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* DR — readings modal. Replaces the inline MatchingReadingsPanel.
          Each row is clickable: opens the reading in /journal via a
          sessionStorage handoff key.
          EC — `modalMode` determines whether the modal shows hero-
          anchored data or teal-anchored data. Hero mode lists every
          pull containing the hero; teal mode lists pulls/days where
          the teal selection co-occurred per the same-pull/same-day
          pill. */}
      {patternsModalOpen && (
        <AllPatternsModal
          patterns={allPatterns}
          seenIds={seenPatterns}
          cardName={(id) => resolveCardName(id)}
          onSelect={(p) => {
            markPatternSeen(p.patternId);
            setPatternsModalOpen(false);
            // "stalker" is a valid pattern lens but NOT a lunation lens — only
            // the four ordinal lenses drive the strip toggle.
            const realLens: "moon" | "day" | "numerology" | "weekday" | null =
              p.lens === "moon" || p.lens === "day" || p.lens === "numerology" || p.lens === "weekday"
                ? p.lens
                : null;
            // Asterism has no single hero — load the whole co-occurring group
            // into the slot row and teal-trace it so its shared days stroke.
            if (p.lens === "asterism" && p.groupCardIds && p.groupCardIds.length) {
              const group = p.groupCardIds;
              requestNavigate(() => {
                // Stash the group so the hero-change effect re-applies the teal
                // selection instead of wiping it when the first card becomes hero.
                pendingAsterismTealRef.current = group;
                setPicks(
                  group.map((cid, i) => ({
                    id: Date.now() + i,
                    cardIndex: cid,
                    isReversed: false,
                    deckId: null,
                    cardName: TAROT_DECK[cid] ?? null,
                  })),
                );
                setFocusedSlotIdx(0);
                setTealSelectedIds(group);
                setActivePattern(p);
              });
              return;
            }
            if (p.cardId == null) {
              if (realLens) setLunationLens(realLens);
              return;
            }
            const heroCardId = p.cardId;
            requestNavigate(() => {
              setPicks([
                {
                  id: Date.now(),
                  cardIndex: heroCardId,
                  isReversed: false,
                  deckId: null,
                  cardName: TAROT_DECK[heroCardId] ?? null,
                },
              ]);
              setFocusedSlotIdx(0);
              setTealSelectedIds([]);
              if (realLens) setLunationLens(realLens);
              setActivePattern(p);
            });
          }}
          onClose={() => setPatternsModalOpen(false)}
        />
      )}
      <ReadingsModal
        open={readingsModalOpen}
        onClose={() => setReadingsModalOpen(false)}
        title={(() => {
          // EC — title format depends on modal mode + active pill.
          // Hero mode:      "N PULLS with [Hero]"
          // Teal mode:      "N PULLS with [Card], [Card], ..." or
          //                 "N DAYS with [Card], [Card], ..."
          // Slot-card mode: "N PULLS with [Card]" — EJ16
          // Hero name is NEVER in the teal-mode title (even when the
          // hero is itself teal-selected — it's just one of the cards).
          // Card-name list wraps; no truncation, no "+ N more".
          if (modalMode === "teal") {
            const n = atlasMode ? atlasMatch.count : tealCount;
            const unit =
              overlapMode === "pull" ? (n === 1 ? "SPREAD" : "SPREADS") : n === 1 ? "DAY" : "DAYS";
            const tealNames = atlasMode
              ? atlasAsterismNames
              : tealSelectedIds.map((id) => TAROT_DECK[id] ?? "Card").join(", ");
            return `${n} ${unit} with ${tealNames}`;
          }
          if (modalMode === "slot-card") {
            const cardName =
              modalCardId !== null ? (TAROT_DECK[modalCardId] ?? "this card") : "this card";
            const n = slotCardMatchedReadings.length;
            const unit = n === 1 ? "SPREAD" : "SPREADS";
            return `${n} ${unit} with ${cardName}`;
          }
          // Hero mode (default).
          const heroName = heroPick
            ? (heroPick.cardName ?? TAROT_DECK[heroPick.cardIndex] ?? "this card")
            : null;
          const n = heroMatchedReadings.length;
          const unit = n === 1 ? "SPREAD" : "SPREADS";
          if (!heroName) return "Recent Spreads";
          return `${n} ${unit} with ${heroName}`;
        })()}
        matches={
          modalMode === "teal"
            ? atlasMode
              ? atlasMatchedReadings
              : tealMatchedReadings
            : modalMode === "slot-card"
              ? slotCardMatchedReadings
              : heroMatchedReadings
        }
        signalContext={{
          heroId: heroPick?.cardIndex ?? null,
          pullCardIds: picks.map((p) => p.cardIndex),
          tealSelectedIds,
        }}
        filtersActive={countActiveFilters(globalFilters) > 0}
        onClearFilters={() => {
          setGlobalFilters((prev) => ({
            ...prev,
            tags: [],
            spreadTypes: [],
            moonPhases: [],
            deepOnly: false,
            reversedOnly: false,
            bookmarked: false,
            storyIds: [],
            tagMode: "any",
          }));
        }}
        onRowClick={(readingId) => {
          try {
            window.sessionStorage.setItem("tarotseed:open-reading-id", readingId);
          } catch {
            /* swallow */
          }
          setReadingsModalOpen(false);
          requestNavigate(() => navigate({ to: "/journal" }));
        }}
      />

      {/* DR — unsaved-changes confirm modal. Triggered when the seeker
          tries to leave the page (via the Classic Manual Entry link)
          while picks are placed. Permanently dismissable via a
          checkbox; preference stored in localStorage. */}
      <UnsavedChangesModal
        open={unsavedConfirm.open}
        onCancel={() => setUnsavedConfirm({ open: false, action: null })}
        onConfirm={(suppressFuture) => {
          if (suppressFuture) {
            try {
              window.localStorage.setItem(LS_SUPPRESS_LEAVE_KEY, "1");
            } catch {
              /* swallow */
            }
          }
          const action = unsavedConfirm.action;
          setUnsavedConfirm({ open: false, action: null });
          if (action) action();
        }}
      />
      {/* EJ17 — Rich card popover. Replaces the simpler card-meaning
          popover with a multi-section layout that surfaces stats,
          meanings, companions, and timeline data in one view. This
          is phase 1: only sections using already-available client-side
          data render. EJ18 adds server data for the remaining
          sections (reversed %, moon phase, time-of-day, sparkline,
          longest gap, avg spacing, tag bias). EJ19 adds edit mode
          + Supabase prefs for per-section visibility. */}
      {(() => {
        if (activePopover?.kind !== "card-meaning") return null;
        if (!hoverTipsOn) return null;
        const cardId = Number(activePopover.key);
        if (!Number.isFinite(cardId)) return null;
        // EJ22 — slim path: small chip popover, no top-right controls,
        // click escalates to rich. The slim has no edit affordances —
        // editing happens inside the rich popover's edit mode where
        // the slim preview lives as a left pane.
        if (popoverMode === "slim") {
          return (
            <RichPopover
              open
              anchorX={activePopover.anchorX}
              anchorY={activePopover.anchorY}
              targetRect={activePopover.targetRect}
              onClose={() => closeActivePopover("card-meaning")}
              onCancelDismiss={cancelPopoverDismiss}
              onScheduleDismiss={() => schedulePopoverDismiss("card-meaning")}
              bare
              maxWidth={300}
            >
              {/* Click anywhere on the slim body to escalate. The
                  RichPopover itself blocks tap-outside dismiss while
                  the cursor is inside, so this click handler just
                  needs to flip the mode. */}
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  escalateToRich();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    escalateToRich();
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                {renderSlimHoverInner(cardId)}
              </div>
            </RichPopover>
          );
        }
        return (
          <RichPopover
            open
            anchorX={activePopover.anchorX}
            anchorY={activePopover.anchorY}
            targetRect={activePopover.targetRect}
            onClose={() => {
              if (popoverEditMode) {
                commitPopoverEditMode();
              }
              setPopoverEditingLive(false);
              closeActivePopover("card-meaning");
            }}
            onCancelDismiss={cancelPopoverDismiss}
            onScheduleDismiss={() => schedulePopoverDismiss("card-meaning")}
            bare
            maxWidth={popoverEditingLive ? 680 : 340}
            dockTopCss="calc(env(safe-area-inset-top, 0px) + var(--topbar-height))"
          >
            {/* EJ22 — split view in edit mode. Left = slim preview,
                right = full popover body with section toggles. The
                slim preview shows what the seeker's hover card will
                look like with current prefs. */}
            {popoverEditMode ? (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {/* Left: slim preview + reset button. */}
                <div
                  style={{
                    flex: "0 0 220px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    position: "sticky",
                    top: 0,
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
                    Hover preview
                  </div>
                  <div
                    style={{
                      border:
                        "1px dashed color-mix(in oklab, var(--accent, var(--gold)) 40%, transparent)",
                      borderRadius: 6,
                      background: "color-mix(in oklab, var(--accent, var(--gold)) 4%, transparent)",
                    }}
                  >
                    {renderSlimHoverInner(cardId)}
                  </div>
                  {/* Slim item toggles — each visible item gets a
                      one-click "− from slim" button; each hidden
                      item appears below with "+ to slim". */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      marginTop: 4,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 9,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--accent, var(--gold))",
                        opacity: 0.6,
                      }}
                    >
                      On the hover
                    </div>
                    {ALL_SLIM_ITEM_IDS.filter((id) => isSlimItemVisible(id)).map((id) => (
                      <button
                        key={`on-${id}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSlimItem(id);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "3px 6px",
                          background: "transparent",
                          border: "none",
                          color: "var(--color-foreground)",
                          cursor: "pointer",
                          fontSize: 10.5,
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          textAlign: "left",
                        }}
                      >
                        <span>{SLIM_ITEM_LABELS[id]}</span>
                        <span style={{ color: "var(--accent, var(--gold))", opacity: 0.7 }}>−</span>
                      </button>
                    ))}
                    {ALL_SLIM_ITEM_IDS.some((id) => !isSlimItemVisible(id)) && (
                      <div
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 9,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--accent, var(--gold))",
                          opacity: 0.6,
                          marginTop: 6,
                        }}
                      >
                        Available
                      </div>
                    )}
                    {ALL_SLIM_ITEM_IDS.filter((id) => !isSlimItemVisible(id)).map((id) => (
                      <button
                        key={`off-${id}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSlimItem(id);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "3px 6px",
                          background: "transparent",
                          border: "none",
                          color: "var(--color-foreground)",
                          cursor: "pointer",
                          fontSize: 10.5,
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          textAlign: "left",
                          opacity: 0.6,
                        }}
                      >
                        <span>{SLIM_ITEM_LABELS[id]}</span>
                        <span style={{ color: "var(--accent, var(--gold))", opacity: 0.7 }}>+</span>
                      </button>
                    ))}
                  </div>
                  {/* Reset button — top of left pane. Restores
                      defaults for both the rich popover sections
                      AND the slim items. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetPopoverPrefs();
                    }}
                    style={{
                      marginTop: 8,
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: 11,
                      color: "var(--color-foreground)",
                      background: "transparent",
                      border:
                        "1px solid color-mix(in oklab, var(--color-foreground) 20%, transparent)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    Reset to defaults
                  </button>
                </div>
                {/* Right: full popover body. */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renderCardPopoverInner(cardId, { editable: true, onEditingChange: setPopoverEditingLive })}
                </div>
              </div>
            ) : (
              renderCardPopoverInner(cardId, { editable: true, onEditingChange: setPopoverEditingLive })
            )}
          </RichPopover>
        );
      })()}
      {/* EJ20 — pinned card modals. One floating draggable modal
          per cardId in pinnedCards. The seeker can drag any one
          freely; default position auto-docks to the bottom of
          the viewport, side-by-side in pin order. */}
      {pinnedCards.map((pinnedCardId, idx) => (
        <PinnedCardModal
          key={`pinned-${pinnedCardId}`}
          cardId={pinnedCardId}
          index={idx}
          onClose={() => unpinCard(pinnedCardId)}
        >
          {renderCardPopoverInner(pinnedCardId, { editable: false })}
        </PinnedCardModal>
      ))}
      {/* EG — slot card badge hint popover ("This card has appeared in N
          of your past readings."). Same RichPopover style as the card
          meaning popover, replacing the prior native title="" tooltip. */}
      {activePopover?.kind === "badge-hint" && (
        <RichPopover
          open
          anchorX={activePopover.anchorX}
          anchorY={activePopover.anchorY}
          onClose={() => closeActivePopover("badge-hint")}
          onCancelDismiss={cancelPopoverDismiss}
          onScheduleDismiss={() => schedulePopoverDismiss("badge-hint")}
          chainedContent={<BadgeLegend />}
          chainedTitle="About badges"
          maxWidth={240}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--color-foreground)",
              lineHeight: 1.2,
            }}
          >
            {activePopover.cardName}
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 12,
              color: "var(--color-foreground)",
              opacity: 0.85,
              lineHeight: 1.4,
            }}
          >
            This card has appeared in{" "}
            <span
              style={{
                fontStyle: "italic",
                color: "var(--accent, var(--gold))",
              }}
            >
              {activePopover.count}
            </span>{" "}
            of your past readings.
          </div>
        </RichPopover>
      )}
      {/* EG — calendar day cell popover. Hover (PC) or long-press
          (tablet) on a day cell shows the day's narrative; if the cell
          has any visual signals active (gold hero fill, ring, dashed,
          teal trace), an ⓘ icon appears in the corner and chains to a
          color legend explaining each signal active on THIS cell. */}
      {activePopover?.kind === "day-cell" &&
        (() => {
          return (
            <RichPopover
              open
              anchorX={activePopover.anchorX}
              anchorY={activePopover.anchorY}
              targetRect={activePopover.targetRect}
              onClose={() => closeActivePopover("day-cell")}
              onCancelDismiss={cancelPopoverDismiss}
              onScheduleDismiss={() => schedulePopoverDismiss("day-cell")}
              chainedContent={<ColorLegend />}
              chainedTitle="What the colors mean"
              maxWidth={300}
            >
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  lineHeight: 1.4,
                  // EJ10 — render newlines in the multi-line stacked
                  // tooltip text (built in OverlapStrip day-cell logic)
                  // as actual line breaks. No layout shift on
                  // single-line tooltips (date-only); just enables
                  // multi-line where the source string contains \n.
                  whiteSpace: "pre-line",
                }}
              >
                {activePopover.tooltipText}
              </div>
            </RichPopover>
          );
        })()}
      {/* EH — Chip hint popover. Replaces native title="" on the
          right-column chips (LAST SEEN / TIME PATTERN / FREQUENCY /
          MOON PHASE / REVERSED). Same dark style as the other rich
          popovers. No ⓘ — the tooltip IS the explanation. */}
      {activePopover?.kind === "chip-hint" && (
        <RichPopover
          open
          anchorX={activePopover.anchorX}
          anchorY={activePopover.anchorY}
          onClose={() => closeActivePopover("chip-hint")}
          onCancelDismiss={cancelPopoverDismiss}
          onScheduleDismiss={() => schedulePopoverDismiss("chip-hint")}
          maxWidth={260}
        >
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
            {activePopover.label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 12,
              color: "var(--color-foreground)",
              lineHeight: 1.4,
            }}
          >
            {activePopover.tooltip}
          </div>
        </RichPopover>
      )}
      {/* EJ15 — slot label hover popover. Header is the slot's full
          long name plus the spread it belongs to; body is the
          paragraph-length meaning of this slot in this specific
          spread. Same RichPopover styling as chip-hint. */}
      {activePopover?.kind === "slot-label" && (
        <RichPopover
          open
          anchorX={activePopover.anchorX}
          anchorY={activePopover.anchorY}
          onClose={() => closeActivePopover("slot-label")}
          onCancelDismiss={cancelPopoverDismiss}
          onScheduleDismiss={() => schedulePopoverDismiss("slot-label")}
          maxWidth={340}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 16,
              color: "var(--color-foreground)",
              lineHeight: 1.2,
            }}
          >
            {activePopover.slotName}
          </div>
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
            {activePopover.spreadLabel}
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 12.5,
              color: "var(--color-foreground)",
              lineHeight: 1.55,
              opacity: 0.92,
            }}
          >
            {activePopover.meaning}
          </div>
        </RichPopover>
      )}
      {/* EH — Constellation badge popovers (gold hero badge + teal
          selection badge in the SVG web). Each shows a count + brief
          description, and chains to the constellation legend. */}
      {activePopover?.kind === "constellation-badge" && (
        <RichPopover
          open
          anchorX={activePopover.anchorX}
          anchorY={activePopover.anchorY}
          onClose={() => closeActivePopover("constellation-badge")}
          onCancelDismiss={cancelPopoverDismiss}
          onScheduleDismiss={() => schedulePopoverDismiss("constellation-badge")}
          chainedContent={<ConstellationLegend />}
          chainedTitle="How the constellation works"
          maxWidth={280}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--color-foreground)",
              lineHeight: 1.2,
            }}
          >
            {activePopover.variant === "hero" ? `Gold hero badge` : `Teal asterism badge`}
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 12,
              color: "var(--color-foreground)",
              opacity: 0.85,
              lineHeight: 1.4,
            }}
          >
            {activePopover.variant === "hero" ? (
              <>
                {activePopover.count} spreads matching your filters contain{" "}
                <span
                  style={{
                    fontStyle: "italic",
                    color: "var(--accent, var(--gold))",
                  }}
                >
                  {activePopover.cardLabel}
                </span>
                .
              </>
            ) : (
              <>
                {activePopover.modeOrPullsLabel} matching your filters where your asterism
                co-occurred:{" "}
                <span
                  style={{
                    fontStyle: "italic",
                    color: "var(--accent, var(--gold))",
                  }}
                >
                  {activePopover.cardLabel}
                </span>
                .
              </>
            )}
          </div>
        </RichPopover>
      )}
      {/* DY — journaling-prompts modal. EJ30: the subtitle "For [card]"
          becomes a dropdown listing every slot pick; switching the
          dropdown swaps the displayed prompts. Inserted prompts get
          a "— Card Name —" header line so notes stay anchored even
          when prompts come from multiple cards. */}
      <Modal
        open={promptsModalOpen}
        onClose={() => setPromptsModalOpen(false)}
        title="Journaling prompts"
        size="sm"
      >
        {(() => {
          // EJ30 — resolve which card's prompts to show. Defaults to
          // hero on first open; user can switch via the dropdown.
          const activeCardId = promptsModalCardId ?? heroPick?.cardIndex ?? null;
          const activePick =
            activeCardId != null ? (picks.find((p) => p.cardIndex === activeCardId) ?? null) : null;
          const activeName =
            activePick?.cardName ??
            (activeCardId != null ? TAROT_MEANINGS[activeCardId]?.name : null) ??
            (activeCardId != null ? TAROT_DECK[activeCardId] : null) ??
            "this card";
          const prompts = activeCardId != null ? resolvePromptsForFirstCard(activeCardId) : null;
          // Build dropdown options from the current slot row.
          const options = picks.map((p) => ({
            id: p.cardIndex,
            name:
              p.cardName ??
              TAROT_MEANINGS[p.cardIndex]?.name ??
              TAROT_DECK[p.cardIndex] ??
              `Card ${p.cardIndex}`,
          }));
          return (
            <div
              style={{
                padding: "8px 22px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Dropdown subtitle — only render when there are
                  picks in the slot row to choose from. */}
              {options.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm, 0.85rem)",
                    color: "var(--color-foreground)",
                  }}
                >
                  <span style={{ opacity: 0.7 }}>For</span>
                  <select
                    value={activeCardId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPromptsModalCardId(v === "" ? null : Number(v));
                    }}
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body-sm, 0.85rem)",
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-card)",
                      color: "var(--color-foreground)",
                      cursor: "pointer",
                    }}
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* Prompts list, or empty message. */}
              {!prompts || prompts.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: 13,
                      color: "var(--color-foreground)",
                      opacity: 0.8,
                    }}
                  >
                    No prompts available for this card.
                  </div>
                  {/* EJ50 — CTA to deck edit page. Only shown for custom
                      decks (the default deck's prompts ship built-in).
                      EJ51 — Routes to the deck that OWNS the active
                      card (activePick.deckId), NOT the currently-
                      active deck. The seeker may have drawn this card
                      from a deck other than the one they're using
                      now; the prompts (or lack thereof) live in the
                      original deck and the CTA should take them
                      there. Falls back to the active deck if the
                      pick has no deckId (a default-deck tarot card)
                      since default-deck cards have built-in prompts
                      and shouldn't usually hit this empty state. */}
                  {(() => {
                    const ownerDeckId = activePick?.deckId ?? activeDeckForCta?.id ?? null;
                    if (!ownerDeckId) return null;
                    const ownerDeck = allDecksForCta[ownerDeckId] ?? null;
                    const ownerName =
                      ownerDeck?.name ??
                      (ownerDeckId === activeDeckForCta?.id
                        ? (activeDeckForCta?.name ?? "this deck")
                        : "this deck");
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setPromptsModalOpen(false);
                          void navigate({
                            to: "/settings/decks/$deckId/edit",
                            params: { deckId: ownerDeckId },
                            hash: "ai-prompts",
                          });
                        }}
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: 13,
                          color: "var(--accent, var(--gold))",
                          background:
                            "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                          border:
                            "1px solid color-mix(in oklab, var(--accent, var(--gold)) 35%, transparent)",
                          borderRadius: 6,
                          padding: "10px 14px",
                          cursor: "pointer",
                          textAlign: "left",
                          lineHeight: 1.4,
                        }}
                      >
                        Set up prompts for {ownerName} →
                      </button>
                    );
                  })()}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {prompts.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        // EJ30 — insert with a "— Card Name —" header
                        // line above the prompt so notes stay
                        // anchored to which card each prompt came
                        // from (per Cori's option C).
                        const header = `— ${activeName} —`;
                        const block = `${header}\n${p}`;
                        setNote((prev) =>
                          prev.trim() === ""
                            ? `${block}\n\n`
                            : `${prev.replace(/\s+$/, "")}\n\n${block}\n\n`,
                        );
                        setPromptsModalOpen(false);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 8,
                        background:
                          "color-mix(in oklab, var(--accent, var(--gold)) 6%, transparent)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--color-foreground)",
                        cursor: "pointer",
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 13,
                        lineHeight: 1.4,
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
      {/* DZ — calendar day-click popover. Lists every reading on the
          tapped day; click a reading to load it into /constellation
          (unsaved-changes warning fires via requestNavigate). */}
      <Modal
        open={dayPopover.open}
        onClose={() => setDayPopover({ open: false, date: null })}
        title={dayPopover.date ? formatDateShort(`${dayPopover.date}T00:00:00`) : "Spreads"}
        subtitle={(() => {
          if (!dayPopover.date) return undefined;
          const list = overlap?.readingsByDate?.[dayPopover.date] ?? [];
          return `${list.length} ${list.length === 1 ? "spread" : "spreads"}`;
        })()}
        size="sm"
      >
        {(() => {
          // EK62 — moon header: if the clicked day is a full or new moon,
          // show the moon icon + label at the very top of the modal.
          const date = dayPopover.date;
          if (!date) return null;
          const isFull = moonDayYmds.full.has(date);
          const isNew = moonDayYmds.nw.has(date);
          if (!isFull && !isNew) return null;
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px 0",
              }}
            >
              <div style={{ width: 20, height: 20, flexShrink: 0 }}>
                <MoonPhaseIcon phase={isFull ? "Full Moon" : "New Moon"} size={20} />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body)",
                  color: "var(--color-foreground)",
                }}
              >
                {isFull ? "Full Moon" : "New Moon"}
              </span>
            </div>
          );
        })()}
        {(() => {
          if (!dayPopover.date) return null;
          const list = overlap?.readingsByDate?.[dayPopover.date] ?? [];
          if (list.length === 0) {
            return (
              <div
                style={{
                  padding: "8px 22px 22px",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                  color: "var(--color-foreground)",
                  opacity: 0.8,
                }}
              >
                No readings on this day.
              </div>
            );
          }
          return (
            <div
              style={{
                padding: "8px 22px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {(() => {
                // EJ30 — pre-compute per-row signals once using the
                // shared helper. maxMatchCount is needed for the
                // dashed "best available" ring.
                const pullCardIds = picks.map((p) => p.cardIndex);
                const heroId = heroPick?.cardIndex ?? null;
                const rowMatchCounts: number[] = list.map((r) => {
                  const set = new Set(r.cardIds);
                  let count = 0;
                  for (const id of pullCardIds) {
                    if (set.has(id)) count++;
                  }
                  return count;
                });
                const maxMatchCount = rowMatchCounts.reduce((m, n) => (n > m ? n : m), 0);
                return list.map((r, i) => {
                  const cardsLabel = r.cardIds
                    .slice(0, 5)
                    .map((id) => resolveCardName(id))
                    .join(" · ");
                  const extra = r.cardIds.length > 5 ? ` · +${r.cardIds.length - 5}` : "";
                  const readingCardSet = new Set(r.cardIds);
                  const heroDrawn = heroId != null && readingCardSet.has(heroId);
                  const matchCount = rowMatchCounts[i];
                  const asterismHit =
                    tealSelectedIds.length >= 2 &&
                    tealSelectedIds.every((id) => readingCardSet.has(id));
                  const sig = computeMatchSignals({
                    heroDrawn,
                    matchCount,
                    pullSize: pullCardIds.length,
                    maxMatchCount,
                    asterismHit,
                    asterismSize: tealSelectedIds.length,
                  });
                  // Compose final background combining bg + opacity
                  // via color-mix so the row sits on the surface
                  // beneath it (modal body), not on a raw color.
                  const opPct = Math.round(sig.opacity * 100);
                  const composedBg = `color-mix(in oklab, ${sig.bg} ${opPct}%, var(--surface-card) ${100 - opPct}%)`;
                  const isHoverRow = entryHoverId === r.id;
                  return (
                    <div
                      key={r.id}
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: composedBg,
                        border: sig.border,
                        outline: sig.outline,
                        outlineOffset: sig.outlineOffset,
                        color: sig.textColor,
                        width: "100%",
                      }}
                      onMouseEnter={() => setEntryHoverId(r.id)}
                      onMouseLeave={() => setEntryHoverId((cur) => (cur === r.id ? null : cur))}
                    >
                      <div style={{ display: "flex", alignItems: "stretch", gap: 10, width: "100%" }}>
                      {/* v2.57 — left icon column: open in journal / load these
                          cards into the slot row (full replace) */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <button
                          type="button"
                          aria-label="Open journal entry"
                          title="Open journal entry"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInJournal(r.id);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 2,
                            display: "inline-flex",
                            color: sig.textColor,
                            cursor: "pointer",
                            opacity: 0.85,
                          }}
                        >
                          <BookOpen size={15} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          aria-label="Load these cards into the slots"
                          title="Load these cards into the slots"
                          onClick={(e) => {
                            e.stopPropagation();
                            // v2.58 — load into the CURRENT page's slots, no
                            // navigation / unsaved-changes prompt. Records undo.
                            void performLoadReading(r.id);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 2,
                            display: "inline-flex",
                            color: sig.textColor,
                            cursor: "pointer",
                            opacity: 0.85,
                          }}
                        >
                          <LayoutGrid size={15} strokeWidth={2} />
                        </button>
                      </div>

                      {/* text — clicking loads the reading (existing behavior) */}
                      <button
                        type="button"
                        onClick={() => handleLoadReading(r.id)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: sig.textColor,
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        {r.question ? (
                          <span
                            style={{
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                              fontSize: 13,
                              color: sig.textColor,
                              lineHeight: 1.35,
                            }}
                          >
                            {r.question}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                              fontSize: 12,
                              color: sig.textColor,
                              opacity: 0.7,
                              lineHeight: 1.35,
                            }}
                          >
                            (no question)
                          </span>
                        )}
                        <span
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: 11,
                            color: sig.textColor,
                            opacity: 0.85,
                            lineHeight: 1.35,
                          }}
                        >
                          {cardsLabel}
                          {extra}
                        </span>
                      </button>
                      </div>
                      {/* v2.58 — drawn cards shown IN-FLOW below the entry on
                          hover (row grows), so they're never clipped by the
                          modal edge like the old floating tip was. */}
                      {isHoverRow && r.cardIds.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 5,
                            paddingTop: 2,
                            justifyContent: "flex-start",
                          }}
                        >
                          {r.cardIds.slice(0, 10).map((id, ci) => (
                            <span
                              key={`${r.id}-thumb-${ci}`}
                              style={{ width: 40, display: "inline-block", flexShrink: 0 }}
                            >
                              <CardImage variant="face" cardId={id} size="custom" widthPx={40} />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   DR — modals
   ──────────────────────────────────────────────────────────────────── */

type ModalMatch = {
  id: string;
  createdAt: string;
  question: string | null;
  cardIds: number[];
};

function ReadingsModal({
  open,
  onClose,
  title,
  matches,
  onRowClick,
  filtersActive = false,
  onClearFilters,
  signalContext,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  matches: ModalMatch[];
  onRowClick: (readingId: string) => void;
  /** DX — when true and matches is empty, surface the "filters may be
   *  hiding results" failsafe with a Clear filters link inline. */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** EJ30 — per-row visual signal context. When present, each row
   *  receives the calendar-parity coding (hero gold, accent match,
   *  perfect-match solid ring, best-available dashed ring, asterism
   *  teal outline, theme-aware text color). When omitted, rows render
   *  neutral. */
  signalContext?: {
    heroId: number | null;
    pullCardIds: number[];
    tealSelectedIds: number[];
  };
}) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const resolveCardName = useAnyDeckCardName();
  if (!open) return null;
  const node = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      className="modal-scrim"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "80vh",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 18,
              color: "var(--color-foreground)",
              // EC — title wraps to multiple lines when long. No
              // truncation, no "+ N more" — the seeker sees every
              // teal card name explicitly.
              whiteSpace: "normal",
              wordBreak: "break-word",
              lineHeight: 1.35,
              flex: 1,
              minWidth: 0,
            }}
          >
            {title}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-foreground-muted, var(--color-foreground))",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {matches.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "24px 12px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                  color: "var(--color-foreground-muted, var(--color-foreground))",
                  opacity: 0.85,
                }}
              >
                {filtersActive ? "No spreads match these filters." : "No matching spreads."}
              </p>
              {filtersActive && onClearFilters && (
                <button
                  type="button"
                  onClick={() => {
                    onClearFilters();
                  }}
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 12,
                    color: "var(--accent, var(--gold))",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 4,
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            (() => {
              // EJ30 — pre-compute per-row match counts so the
              // "best available" dashed ring can be applied to rows
              // tied for the highest match count below the perfect-
              // match threshold. matchCounts mirrors `matches` 1:1.
              const ctx = signalContext;
              const pullCardIds = ctx?.pullCardIds ?? [];
              const heroId = ctx?.heroId ?? null;
              const tealSelected = ctx?.tealSelectedIds ?? [];
              const matchCounts: number[] = matches.map((r) => {
                if (pullCardIds.length === 0) return 0;
                const set = new Set(r.cardIds);
                let count = 0;
                for (const id of pullCardIds) {
                  if (set.has(id)) count++;
                }
                return count;
              });
              const maxMatchCount = matchCounts.reduce((m, n) => (n > m ? n : m), 0);
              return matches.map((r, i) => {
                const date = formatDateShort(r.createdAt);
                const cardsLabel = r.cardIds.map((id) => resolveCardName(id)).join(" · ");
                const hasQuestion = !!(r.question && r.question.trim());
                // Compute signals — uses neutral defaults when no
                // context (modal opened without signal context).
                const readingCardSet = new Set(r.cardIds);
                const heroDrawn = heroId != null && readingCardSet.has(heroId);
                const matchCount = matchCounts[i];
                const asterismHit =
                  tealSelected.length >= 2 && tealSelected.every((id) => readingCardSet.has(id));
                const sig = ctx
                  ? computeMatchSignals({
                      heroDrawn,
                      matchCount,
                      pullSize: pullCardIds.length,
                      maxMatchCount,
                      asterismHit,
                      asterismSize: tealSelected.length,
                    })
                  : null;
                const composedBg = sig
                  ? (() => {
                      const opPct = Math.round(sig.opacity * 100);
                      return `color-mix(in oklab, ${sig.bg} ${opPct}%, var(--surface-card) ${100 - opPct}%)`;
                    })()
                  : "var(--surface-elevated, var(--surface-card))";
                const dateColor = sig
                  ? sig.textColor
                  : "var(--color-foreground-muted, var(--color-foreground))";
                const cardsColor = sig ? sig.textColor : "var(--color-foreground)";
                const questionColor = sig
                  ? sig.textColor
                  : "var(--color-foreground-muted, var(--color-foreground))";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRowClick(r.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: sig ? sig.border : "1px solid var(--border-subtle)",
                      outline: sig ? sig.outline : "none",
                      outlineOffset: sig ? sig.outlineOffset : 0,
                      background: composedBg,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      alignItems: "stretch",
                      width: "100%",
                      // EC — let rows grow vertically to fit 1 or 2 lines
                      // of content. Previously this clipped the question
                      // line on the readings modal (cells were too short
                      // to hold both the cards summary and the question).
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: 10,
                        alignItems: "flex-start",
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.2em",
                          textTransform: "uppercase",
                          fontFamily: "var(--font-serif)",
                          color: dateColor,
                          opacity: 0.75,
                          flexShrink: 0,
                          lineHeight: 1.3,
                          // Hold date on one line; cards summary wraps.
                          whiteSpace: "nowrap",
                          marginTop: 1,
                        }}
                      >
                        {date}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: "var(--font-serif)",
                          color: cardsColor,
                          minWidth: 0,
                          flex: 1,
                          lineHeight: 1.35,
                          // EC — wrap rather than clip with ellipsis. The
                          // row's vertical height grows to fit.
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                        title={cardsLabel}
                      >
                        {cardsLabel}
                      </span>
                    </div>
                    {hasQuestion && (
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          color: questionColor,
                          opacity: 0.85,
                          width: "100%",
                          lineHeight: 1.4,
                          // EC — wrap rather than truncate.
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                        title={r.question ?? ""}
                      >
                        “{(r.question ?? "").trim()}”
                      </span>
                    )}
                  </button>
                );
              });
            })()
          )}
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

function UnsavedChangesModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (suppressFuture: boolean) => void;
}) {
  const [suppress, setSuppress] = useState(false);
  useEffect(() => {
    if (!open) setSuppress(false);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;
  const node = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal-nested)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      className="modal-scrim"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--color-foreground)",
          }}
        >
          Leave Manual Entry?
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 13,
            color: "var(--color-foreground-muted, var(--color-foreground))",
            lineHeight: 1.5,
          }}
        >
          You have cards placed here. Your selection is saved on this device and will be here when
          you return.
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 12,
            color: "var(--color-foreground-muted, var(--color-foreground))",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={suppress}
            onChange={(e) => setSuppress(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Don't ask again
        </label>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              color: "var(--color-foreground)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Stay
          </button>
          <button
            type="button"
            onClick={() => onConfirm(suppress)}
            style={{
              padding: "8px 16px",
              background: "color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 60%, transparent)",
              borderRadius: 6,
              color: "var(--color-foreground)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

/**
 * EK36 — Bridge between GlobalFilterBar's tagsSectionOverride slot and
 * the new ConstellationTagsPanel.
 *
 * Fetches per-tag stats from getTagFilterStats whenever the relevant
 * inputs change (date range, cards in slots, scope mode, other active
 * filters that affect the underlying reading set). Owns the sort/scope
 * preference state via the localStorage-backed hooks. Renders the
 * panel with the freshly-fetched stats; while a fetch is in flight,
 * keeps the previous results visible so the panel doesn't flash empty.
 */
function EK36TagsBridge({
  globalFilters,
  onTagToggle,
  onTagModeChange,
  cardIndices,
}: {
  globalFilters: GlobalFilters;
  onTagToggle: (name: string) => void;
  onTagModeChange: (mode: "any" | "all") => void;
  cardIndices: number[];
}) {
  const [sortMode, setSortMode] = useTagSortPref();
  const [scopeMode, setScopeMode] = useTagScopePref();
  const [tagStats, setTagStats] = useState<ConstellationTagStat[]>([]);
  const [readingsInScope, setReadingsInScope] = useState<number>(0);

  // Map "365d" → 365, "30d" → 30, "all" → null
  const days = useMemo(() => {
    const raw = globalFilters.timeRange ?? "365d";
    if (raw === "all") return null;
    const m = /^(\d+)d$/.exec(raw);
    return m ? parseInt(m[1], 10) : 365;
  }, [globalFilters.timeRange]);

  // Stable key for cardIndices so the effect doesn't refetch on every
  // render due to a new array identity.
  const cardIndicesKey = cardIndices.join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getTagFilterStats({
          data: {
            days,
            cardIndices,
            scope: scopeMode,
            spreadTypes: globalFilters.spreadTypes ?? [],
            deckIds: [],
            deepOnly: globalFilters.deepOnly ?? false,
          },
        });
        if (cancelled) return;
        setTagStats(result.tags);
        setReadingsInScope(result.readingsInScope);
      } catch {
        // Quiet failure — keep previous results visible.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    days,
    cardIndicesKey,
    scopeMode,
    globalFilters.spreadTypes,
    globalFilters.deepOnly,
  ]);

  return (
    <ConstellationTagsPanel
      tagStats={tagStats}
      selectedTagNames={globalFilters.tags ?? []}
      tagMode={globalFilters.tagMode ?? "any"}
      onToggleTag={onTagToggle}
      onTagModeChange={onTagModeChange}
      scopeMode={scopeMode}
      onScopeModeChange={setScopeMode}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
      readingsInScope={readingsInScope}
      hasSlotCards={cardIndices.length > 0}
    />
  );
}
