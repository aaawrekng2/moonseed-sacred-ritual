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
import { CalendarIcon, ChevronDown, Pencil, Pin, RotateCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateShort, formatTimeAgo } from "@/lib/dates";
import { useRegisterTabletopActive } from "@/lib/floating-menu-context";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CardPicker } from "@/components/cards/CardPicker";
import { CardImage } from "@/components/card/CardImage";
import { TAROT_MEANINGS } from "@/lib/tarot-meanings";
import { getCardMeta } from "@/lib/card-astrology";
import { resolvePromptsForFirstCard } from "@/lib/journal-prompts/resolve";
import { saveManualReading } from "@/lib/save-manual-reading.functions";
import { interpretReading } from "@/lib/interpret.functions";
import { Modal } from "@/components/ui/modal";
import { RichPopover } from "@/components/ui/RichPopover";
import {
  ChipGrid,
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
import { ConstellationWeb, SVG_H, SVG_W } from "@/components/constellation/ConstellationWeb";
import { EchoBanner } from "@/components/constellation/EchoBanner";
import { useEcho } from "@/lib/use-echo";
import { cn } from "@/lib/utils";
import { TAROT_DECK } from "@/lib/tarot";
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
import { useAuth } from "@/lib/auth";
import { useTimezone } from "@/lib/use-timezone";
import { useNavigate } from "@tanstack/react-router";
import { useStreak } from "@/lib/use-streak";
import { getLunationContaining } from "@/lib/lunation";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import { HoverTipsToggle } from "@/components/constellation/HoverTipsToggle";
import { HoverTipsGear } from "@/components/constellation/HoverTipsGear";
import { PinnedCardModal } from "@/components/constellation/PinnedCardModal";
import { useConstellationHoverTips } from "@/lib/use-constellation-hover-tips";
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

export function ConstellationPage() {
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const navigate = useNavigate();
  const confirm = useConfirm();

  // EJ5 — master switch for hover tips on this surface. When
  // effectiveEnabled is false, all popovers (legend ⓘ, card, badge,
  // day-cell, line) are suppressed without removing their triggers.
  const { effectiveEnabled: hoverTipsOn } = useConstellationHoverTips();

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
  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number | null>(null);
  // Phase 24 — teal multi-select trace. Empty by default. Click any card in
  // the constellation web (hero or companion) to toggle membership. Drives
  // calendar stroke + readings panel filter. Resets when hero changes.
  const [tealSelectedIds, setTealSelectedIds] = useState<number[]>([]);
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
    if (persisted.picks?.length) setPicks(persisted.picks);
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
  useEffect(() => {
    if (heroInitRef.current) {
      heroInitRef.current = false;
      return;
    }
    setTealSelectedIds([]);
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
  const [showOlder, setShowOlder] = useState(false);
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
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const handleConstellationHover = (cardId: number | null, clientX: number, clientY: number) => {
    if (cardId !== null) {
      cancelPopoverDismiss();
      // EI5 — single source of truth: activePopover. We no longer write
      // to hoverCardId or hoverCoords on every mousemove — that caused
      // a re-render per pixel and made the popover stutter. The popover
      // reads cardId from activePopover.key and coords from
      // activePopover.anchorX/Y. State setter bails out when the same
      // card claims the popover at any new coords (idempotent on
      // cardId), so cursor movement within a single card is a no-op.
      setActivePopover((prev) => {
        if (prev && prev.kind === "card-meaning" && prev.key === String(cardId)) {
          return prev;
        }
        // EJ18 — trigger the lazy popover data fetch when a
        // card-meaning popover opens for the first time per
        // filter window. ensurePopoverData() is idempotent.
        ensurePopoverData();
        return {
          kind: "card-meaning",
          key: String(cardId),
          anchorX: clientX,
          anchorY: clientY,
        };
      });
    } else {
      // EH — schedule, don't immediately close. Lets the cursor travel
      // to the popover and the ⓘ icon without dismissing.
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
    | "slot-label"
    | "slot-rank-box"
    | "slot-count-box";
  // EG — payload varies by kind. badge-hint stores count + card name
  // so the popover can render without re-looking-up picks. day-cell
  // stores the date so the popover can derive its narrative + signals.
  type ActivePopoverState =
    | {
        kind: "card-meaning";
        key: string;
        anchorX: number;
        anchorY: number;
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
      }
    | {
        // EJ16 — slot card RANK box hover popover (left box flush at
        // the bottom of each slot card). Explains the rank number's
        // meaning. Click on the box opens the readings modal.
        kind: "slot-rank-box";
        key: string;
        anchorX: number;
        anchorY: number;
        cardName: string;
        rank: number | null;
        universeSize: number;
        count: number;
      }
    | {
        // EJ16 — slot card COUNT box hover popover (right box flush
        // at the bottom of each slot card). Explains the count
        // number's meaning. Click on the box opens the readings
        // modal.
        kind: "slot-count-box";
        key: string;
        anchorX: number;
        anchorY: number;
        cardName: string;
        count: number;
      };
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
    }, 180);
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
    | "meanings"
    | "sparkline"
    | "companions"
    | "timeline"
    | "tag-bias";
  const ALL_SECTION_IDS: CardPopoverSectionId[] = [
    "stat-strip",
    "moon-phase",
    "time-of-day",
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
  }, [savePopoverSectionPrefs]);

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
  // DY — journaling-prompts modal trigger.
  const [promptsModalOpen, setPromptsModalOpen] = useState(false);
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
          })),
          question: question.trim() || undefined,
          note: note.trim() || undefined,
          createdAt: backdate ? backdate.toISOString() : undefined,
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
      // Already on the spread — focus it, no duplicate.
      setFocusedSlotIdx(existingIdx);
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

  // EJ20 — renderCardPopoverInner extracts the IIFE body so both
  // the hover popover and the pinned modal can render the same
  // content tree for a given cardId. Hover passes editable: true;
  // pinned modals pass editable: false so edit-mode toggles are
  // disabled (sections still respect the seeker's saved prefs).
  const renderCardPopoverInner = (cardId: number, opts: { editable: boolean }): React.ReactNode => {
    const m = TAROT_MEANINGS[cardId];
    if (!m) return null;
    const effectiveEditable = opts.editable && popoverEditMode;
    // EI5 — drive popover purely from activePopover state. cardId
    // is derived from activePopover.key (which is stable while
    // cursor stays on the same card). Removing the hoverCardId
    // gating means the popover survives source mouseLeave; the
    // shared dismiss timer + hover-bridge are what close it.
    // EJ17 — derived popover data, all from existing state.
    const meta = getCardMeta(cardId);
    const rank = drawCounts?.perCardRank?.[cardId];
    const universeSize = drawCounts?.rankUniverseSize ?? 0;
    const count = drawCounts?.perCard?.[cardId] ?? 0;
    // Roman numeral for majors (cardId 0..21). Pips and courts get
    // their rank label from card-astrology.
    const ROMAN = [
      "0",
      "I",
      "II",
      "III",
      "IV",
      "V",
      "VI",
      "VII",
      "VIII",
      "IX",
      "X",
      "XI",
      "XII",
      "XIII",
      "XIV",
      "XV",
      "XVI",
      "XVII",
      "XVIII",
      "XIX",
      "XX",
      "XXI",
    ];
    const isMajor = cardId >= 0 && cardId <= 21;
    const numeralOrRank = isMajor ? ROMAN[cardId] : (meta?.rankLabel ?? null);
    // Subtitle: "Major · Pisces" for majors, "Cups · Water" for pips.
    const subtitleParts: string[] = [];
    if (isMajor) {
      subtitleParts.push("Major");
    } else if (meta?.suit) {
      subtitleParts.push(meta.suit);
    }
    if (m.zodiac) subtitleParts.push(m.zodiac);
    else if (m.planet) subtitleParts.push(m.planet);
    else if (meta?.planetOrSign) subtitleParts.push(meta.planetOrSign);
    else if (meta?.element) subtitleParts.push(meta.element);
    const subtitle = subtitleParts.join(" · ");
    // First / last seen in the filtered universe. Derived from
    // overlap.readingsByDate. If overlap isn't loaded yet, both
    // are null and the timeline row hides.
    let firstSeenIso: string | null = null;
    let lastSeenIso: string | null = null;
    if (overlap?.readingsByDate) {
      const all = Object.values(overlap.readingsByDate).flat();
      const matching = all.filter((r) => r.cardIds.includes(cardId));
      if (matching.length > 0) {
        const sorted = [...matching].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        firstSeenIso = sorted[0].createdAt;
        lastSeenIso = sorted[sorted.length - 1].createdAt;
      }
    }
    // Companion chips: for the hero card we have direct top-7 data
    // from the server in constellationData. For other cards, EJ18
    // sources companions from the batched popoverDataMap. When map
    // hasn't loaded yet, no companion section renders for non-hero
    // cards (graceful degradation).
    const isHeroCard = displayedConstellation && cardId === displayedConstellation.heroCardId;
    const topCompanions: Array<{ cardId: number; coCount: number }> = [];
    if (isHeroCard && displayedConstellation) {
      for (const c of displayedConstellation.companions.slice(0, 3)) {
        if (c.coCount > 0) {
          topCompanions.push({ cardId: c.cardId, coCount: c.coCount });
        }
      }
    } else if (popoverDataMap?.[cardId]) {
      for (const c of popoverDataMap[cardId].companionsTop3) {
        topCompanions.push({ cardId: c.cardId, coCount: c.count });
      }
    }
    // EJ18 — derived from the batched popover data fetch. All
    // sections gracefully degrade when popoverDataMap is null
    // (loading) or the cardId isn't in the map (not requested).
    const pd: CardPopoverData | undefined = popoverDataMap?.[cardId];
    const reversedPct = pd?.reversedPct ?? null;
    const topMoonPhase = pd?.topMoonPhase ?? null;
    const topTimeBucket = pd?.topTimeBucket ?? null;
    const monthCounts = pd?.monthCounts ?? null;
    const longestGapDays = pd?.longestGapDays ?? null;
    const avgSpacingDays = pd?.avgSpacingDays ?? null;
    const topTag = pd?.topTag ?? null;
    // Moon phase glyph helper. The 4 buckets we surface map to:
    //   waxing crescent, first quarter, waxing gibbous → "waxing"
    //   full moon → "full"
    //   waning gibbous, last quarter, waning crescent → "waning"
    //   new moon → "new"
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
    // EJ19 — section wrapper. In default mode: section renders
    // only when visible (hidden by user pref returns null). In
    // edit mode: section ALWAYS renders, dimmed to 35% if hidden,
    // with a small "—" / "+" toggle button overlaid in the
    // top-right corner. Click toggle to flip visibility (live;
    // commit happens on Save / click-outside).
    const popoverSection = (
      id: CardPopoverSectionId,
      content: React.ReactNode,
    ): React.ReactNode => {
      const visible = isSectionVisible(id);
      if (!effectiveEditable && !visible) return null;
      if (!effectiveEditable) return content;
      return (
        <div
          key={`section-${id}`}
          style={{
            position: "relative",
            opacity: visible ? 1 : 0.35,
            transition: "opacity 160ms ease",
            border: visible
              ? "1px dashed transparent"
              : "1px dashed color-mix(in oklab, var(--color-foreground) 18%, transparent)",
            borderRadius: 6,
            padding: visible ? 0 : 6,
            margin: visible ? 0 : -6,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleSection(id);
            }}
            aria-label={visible ? `Hide ${SECTION_LABELS[id]}` : `Show ${SECTION_LABELS[id]}`}
            title={visible ? `Hide ${SECTION_LABELS[id]}` : `Show ${SECTION_LABELS[id]}`}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              zIndex: 2,
              width: 16,
              height: 16,
              borderRadius: 9999,
              background: "var(--surface-elevated, var(--surface-card))",
              border: "1px solid color-mix(in oklab, var(--color-foreground) 20%, transparent)",
              color: "var(--color-foreground)",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              lineHeight: 1,
              fontFamily: "var(--font-display)",
              fontWeight: 300,
            }}
          >
            {visible ? "−" : "+"}
          </button>
          {content}
        </div>
      );
    };
    return (
      <>
        {/* Header — name + roman numeral, subtitle of arcana/sign */}
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

        {/* Stat strip — rank + pull count + reversed %. Reversed
            % only shows when EJ18 popoverDataMap is loaded for
            this card; otherwise the grid drops to 2 columns. */}
        {popoverSection(
          "stat-strip",
          drawCounts && (
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

        {/* EJ18 — Moon phase row. Shows the moon phase under which
            this card most often appears in the filtered universe. */}
        {popoverSection(
          "moon-phase",
          moonPhaseLabel && topMoonPhase && (
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
              {/* EJ20 — phase-specific moon glyph. Earlier the
                  same waxing-gibbous-ish shape rendered regardless
                  of phase. Now each of the 8 phase names maps to
                  its own SVG composition. Convention: lit side on
                  the RIGHT for waxing, LEFT for waning, full lit
                  for Full Moon, fully dark outline for New Moon. */}
              {(() => {
                const accent = "var(--accent, var(--gold))";
                const darkFill = "var(--background, #0b0a14)";
                const phase = topMoonPhase.phase;
                return (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 22 22"
                    fill="none"
                    aria-hidden
                    style={{ flexShrink: 0 }}
                  >
                    <circle
                      cx="11"
                      cy="11"
                      r="9"
                      fill={phase === "New Moon" ? "none" : accent}
                      stroke={accent}
                      strokeWidth="0.8"
                      opacity={phase === "New Moon" ? 0.5 : 1}
                    />
                    {phase === "Waxing Crescent" && (
                      <ellipse cx="9" cy="11" rx="7.5" ry="9" fill={darkFill} />
                    )}
                    {phase === "First Quarter" && (
                      <rect x="2" y="2" width="9" height="18" fill={darkFill} />
                    )}
                    {phase === "Waxing Gibbous" && (
                      <ellipse cx="6.5" cy="11" rx="3.5" ry="9" fill={darkFill} />
                    )}
                    {phase === "Waning Gibbous" && (
                      <ellipse cx="15.5" cy="11" rx="3.5" ry="9" fill={darkFill} />
                    )}
                    {phase === "Last Quarter" && (
                      <rect x="11" y="2" width="9" height="18" fill={darkFill} />
                    )}
                    {phase === "Waning Crescent" && (
                      <ellipse cx="13" cy="11" rx="7.5" ry="9" fill={darkFill} />
                    )}
                  </svg>
                );
              })()}
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

        {/* EJ18 — Time-of-day row. Bucketed: morning / afternoon /
            evening / night, based on the seeker's tz. */}
        {popoverSection(
          "time-of-day",
          timeBucketLabel && (
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
                <circle
                  cx="11"
                  cy="11"
                  r="7.5"
                  fill="none"
                  stroke="var(--accent, var(--gold))"
                  strokeWidth="1.2"
                />
                <line
                  x1="11"
                  y1="6.5"
                  x2="11"
                  y2="11"
                  stroke="var(--accent, var(--gold))"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
                <line
                  x1="11"
                  y1="11"
                  x2="13.5"
                  y2="11"
                  stroke="var(--accent, var(--gold))"
                  strokeWidth="0.7"
                  strokeLinecap="round"
                />
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

        {/* EJ18 — 12-month frequency sparkline. Each bar = one
            month, oldest left, current right. Opacity scales
            with count relative to the max month. Empty months
            render as a low-opacity sliver to preserve the
            rhythm of the chart. */}
        {popoverSection(
          "sparkline",
          monthCounts && monthCounts.some((n) => n > 0) && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  alignItems: "flex-end",
                  height: 30,
                  marginBottom: 4,
                }}
              >
                {(() => {
                  const max = Math.max(1, ...monthCounts);
                  return monthCounts.map((n, i) => {
                    const frac = n / max;
                    const heightPct = Math.max(8, frac * 100);
                    const opacity = n === 0 ? 0.18 : 0.35 + frac * 0.6;
                    return (
                      <div
                        key={`spark-${i}`}
                        style={{
                          flex: 1,
                          height: `${heightPct}%`,
                          background: "var(--accent, var(--gold))",
                          opacity,
                          borderRadius: 1,
                        }}
                      />
                    );
                  });
                })()}
              </div>
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

        {/* Upright meaning */}
        {popoverSection(
          "meanings",
          <>
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
                Upright
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

            {/* Reversed meaning */}
            {allowReversed && (
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
                  Reversed
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
            )}
          </>,
        )}

        {/* Companion chips. Only shown when the hovered card is
            the hero (we have its top-7 from server data). For
            non-hero cards, EJ18 adds per-card companion data. */}
        {popoverSection(
          "companions",
          topCompanions.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                borderTop:
                  "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
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
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {topCompanions.map((c) => (
                  <span
                    key={c.cardId}
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: 11,
                      padding: "3px 8px",
                      background:
                        "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                      borderRadius: 999,
                      color: "var(--color-foreground)",
                    }}
                  >
                    {TAROT_DECK[c.cardId] ?? `Card ${c.cardId}`}{" "}
                    <span style={{ opacity: 0.55, fontStyle: "normal" }}>×{c.coCount}</span>
                  </span>
                ))}
              </div>
            </div>
          ),
        )}

        {/* Timeline — first/last seen. Hidden when overlap hasn't
            loaded yet or the card has never been drawn in the
            filtered universe. EJ18 will add longest-gap and
            avg-spacing using new server data. */}
        {popoverSection(
          "timeline",
          (firstSeenIso || lastSeenIso || longestGapDays !== null || avgSpacingDays !== null) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                borderTop:
                  "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
                paddingTop: 8,
                fontSize: 11,
                color: "var(--color-foreground)",
              }}
            >
              <div>
                <div
                  style={{
                    opacity: 0.7,
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--accent, var(--gold))",
                  }}
                >
                  First seen
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    marginTop: 2,
                  }}
                >
                  {firstSeenIso ? formatDateShort(firstSeenIso) : "—"}
                </div>
              </div>
              <div>
                <div
                  style={{
                    opacity: 0.7,
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--accent, var(--gold))",
                  }}
                >
                  Last seen
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    marginTop: 2,
                  }}
                >
                  {lastSeenIso ? formatTimeAgo(lastSeenIso) : "—"}
                </div>
              </div>
              {longestGapDays !== null && (
                <div>
                  <div
                    style={{
                      opacity: 0.7,
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--accent, var(--gold))",
                    }}
                  >
                    Longest gap
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      marginTop: 2,
                    }}
                  >
                    {longestGapDays === 1 ? "1 day" : `${longestGapDays} days`}
                  </div>
                </div>
              )}
              {avgSpacingDays !== null && (
                <div>
                  <div
                    style={{
                      opacity: 0.7,
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--accent, var(--gold))",
                    }}
                  >
                    Avg spacing
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      marginTop: 2,
                    }}
                  >
                    {`${avgSpacingDays} ${avgSpacingDays === 1 ? "day" : "days"}`}
                  </div>
                </div>
              )}
            </div>
          ),
        )}

        {/* EJ18 — Tag bias. Shows the tag the seeker has used most
            often with this card relative to their baseline usage of
            that tag. Multiplier indicates the over-index strength. */}
        {popoverSection(
          "tag-bias",
          topTag && (
            <div
              style={{
                borderTop:
                  "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
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
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                }}
              >
                <span style={{ fontStyle: "italic" }}>{topTag.tag}</span>{" "}
                <span style={{ opacity: 0.55, fontSize: 10 }}>— {topTag.multiplier}× baseline</span>
              </div>
            </div>
          ),
        )}

        {/* EJ19 — edit mode footer. Visible only while in edit
            mode. The Save button commits sectionPrefs and exits
            edit mode. Click-outside the popover also commits
            (handled by the popover's onClose). The footer also
            surfaces hint text so seekers know how to undo. */}
        {effectiveEditable && (
          <div
            style={{
              borderTop:
                "1px solid color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)",
              paddingTop: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 6,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 10.5,
                color: "var(--color-foreground)",
                opacity: 0.7,
                textAlign: "center",
              }}
            >
              Tap the dot on a section to hide it. Click Save when done.
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                commitPopoverEditMode();
              }}
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--gold, var(--accent))",
                background: "color-mix(in oklab, var(--gold, var(--accent)) 14%, transparent)",
                border:
                  "1px solid color-mix(in oklab, var(--gold, var(--accent)) 40%, transparent)",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className="bg-cosmos text-foreground"
      style={{
        // Phase 22 Fix 1 — page owns its own scroll container; html/body/#root
        // are globally locked, so we must anchor to the viewport here.
        width: "100%",
        height: "100dvh",
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        // DU — reduced top padding so Manual Entry header sits closer to top.
        padding: "2px 0 80px",
      }}
    >
      {/* Header row — DU: subtitle inline with H1 on the same row.
          EJ11 — H1 reduced 26 → 18 and row vertical padding tightened
          to close the gap above the constellation. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 18,
              fontWeight: 400,
              color: "var(--color-foreground)",
              lineHeight: 1.1,
            }}
          >
            Manual Entry
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              letterSpacing: "0.3em",
              fontFamily: "var(--font-serif)",
              color: "var(--color-foreground-muted, var(--color-foreground))",
              textTransform: "uppercase",
              opacity: 0.75,
            }}
          >
            pick up to 10 cards — the focused card becomes hero
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={() => requestNavigate(() => navigate({ to: "/draw/classic" }))}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 11,
              color: "var(--accent, var(--gold))",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 4,
            }}
          >
            Classic Manual Entry →
          </button>
          {picks.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              title="Clear all picks"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 11,
                color: "var(--color-foreground-muted, var(--color-foreground))",
                background: "transparent",
                border: "1px solid var(--border-subtle)",
                borderRadius: 9999,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              Clear all
            </button>
          )}
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

      {/* Phase 23 Fix 3 — filter row below H1.
          EJ11 — top padding removed (4px → 0) to close gap between
          H1 header and constellation. */}
      <div style={{ padding: "0 24px 0" }}>
        <GlobalFilterBar
          filters={globalFilters}
          onChange={setGlobalFilters}
          sections={["tags", "spreadTypes", "depth", "reversed"]}
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

      {/* Phase 19 Fix 10 — Echo banner above the entry row */}
      <EchoBanner echo={echo} />

      {/* Phase 22 Fixes 3/4/5 / DV — two-column grid. Right column flows
          naturally; no forced minHeight so the slot row + paste sit just
          below the chips, leaving breathing room above the calendar. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${SVG_W}px minmax(0, 1fr)`,
          gap: 24,
          padding: "0 24px 0",
        }}
      >
        {/* DX — left column: constellation + compact "View N readings ›"
            link absolutely positioned in the empty space right of the
            hero card (DY). The link hides at 0 matches. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            position: "relative",
          }}
        >
          {/* EJ7 — HoverTipsToggle positioned in the empty space
              between the hero card and the upper-right companion.
              Right edge aligns with the upper-right companion's left
              edge (companion x=385 of SVG_W=540, so right offset =
              (1 - 385/540) × 100% ≈ 28.7%). Absolute-positioned
              within the relative column so it floats over the empty
              space without displacing layout.
              EJ11 — top % updated for the new SVG geometry. HERO_Y=0
              in a viewBox that now runs from y=-12 to y=484, so the
              hero card top sits at 12/496 ≈ 2.4% from the top of the
              SVG/column. */}
          <div
            style={{
              position: "absolute",
              top: "2.4%",
              right: "28.7%",
              zIndex: 2,
            }}
          >
            <HoverTipsToggle />
          </div>
          <ConstellationWeb
            heroPick={heroPick}
            constellation={displayedConstellation}
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
            onHeroBadgeHoverEnd={() => schedulePopoverDismiss("constellation-badge")}
            onTealBadgeHover={(clientX, clientY) => {
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
            }}
            onTealBadgeHoverEnd={() => schedulePopoverDismiss("constellation-badge")}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            height: "100%",
          }}
        >
          {/* DX — data header replaces the old "X readings with this card"
              pill. Reflects the active timeRange + hero card name.
              Appends "· N FILTER(S)" as a clickable link when any
              fly-out filters are active; clicking opens the existing
              filter drawer. Hidden entirely when no hero card. */}
          {heroPick &&
            (() => {
              const heroName = heroPick.cardName ?? TAROT_DECK[heroPick.cardIndex] ?? "this card";
              const tr = globalFilters.timeRange ?? DEFAULT_TIMEFRAME;
              // Natural-language time range copy.
              const trText = (() => {
                if (tr === "all") return "All Data";
                if (tr === "365d") return "1 Year of Data";
                if (tr === "180d") return "6 Months of Data";
                if (tr === "90d") return "3 Months of Data";
                if (tr === "30d") return "1 Month of Data";
                if (tr === "7d") return "Last 7 Days of Data";
                const m = /^(\d+)d$/.exec(tr);
                return m ? `Last ${m[1]} Days of Data` : "Data";
              })();
              const filterN = countActiveFilters(globalFilters);
              return (
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: 15,
                    lineHeight: 1.2,
                    color: "var(--color-foreground)",
                    opacity: 0.92,
                  }}
                >
                  {trText} on {heroName}
                  {filterN > 0 && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => setGlobalDrawerOpen(true)}
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 12,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          color: "var(--accent, var(--gold))",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.filter = "brightness(1.25)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.filter = "";
                        }}
                      >
                        {filterN} {filterN === 1 ? "Filter" : "Filters"}
                      </button>
                    </>
                  )}
                </h2>
              );
            })()}
          {heroPick ? (
            <ChipGrid
              heroPick={heroPick}
              stats={cardStats}
              onChipHover={(info) => {
                cancelPopoverDismiss();
                setActivePopover({
                  kind: "chip-hint",
                  key: info.label,
                  anchorX: info.anchorX,
                  anchorY: info.anchorY,
                  label: info.label,
                  tooltip: info.tooltip,
                });
              }}
              onChipHoverEnd={() => schedulePopoverDismiss("chip-hint")}
            />
          ) : (
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--color-foreground-muted, var(--color-foreground))",
                margin: 0,
                opacity: 0.7,
              }}
            >
              add a card to see its patterns.
            </p>
          )}

          {/* DV — slot row + date + paste flow naturally below chips. No
              longer pinned to bottom; the right column's natural height is
              short and leaves consistent breathing room above the calendar. */}
          <div>
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
                const isDropTarget = dragOverSlotIdx === idx;
                if (!pick) {
                  return (
                    <button
                      key={`empty-${idx}`}
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      aria-label="add a card"
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
                      handleConstellationHover(pick.cardIndex, e.clientX, e.clientY);
                    }}
                    onMouseMove={(e) =>
                      handleConstellationHover(pick.cardIndex, e.clientX, e.clientY)
                    }
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
                          borderRadius: 8,
                        }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setFocusedSlotIdx(idx)}
                      style={{
                        position: "relative",
                        zIndex: 1,
                        width: slotW,
                        padding: 0,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        borderRadius: 5,
                        outline: isFocused ? "2px solid var(--accent, var(--gold))" : "none",
                        outlineOffset: 2,
                        display: "block",
                      }}
                    >
                      <CardImage
                        variant="face"
                        cardId={pick.cardIndex}
                        reversed={pick.isReversed}
                        deckId={pick.deckId ?? undefined}
                        size="custom"
                        widthPx={slotW}
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
                        aria-label="Remove card from slot"
                        title="Remove card"
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          zIndex: 3,
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
                        aria-label={pick.isReversed ? "Flip upright" : "Flip reversed"}
                        title={pick.isReversed ? "Flip upright" : "Flip reversed"}
                        style={{
                          position: "absolute",
                          top: -6,
                          left: -6,
                          zIndex: 3,
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
                    {/* EJ16 — Two boxes flush against the bottom edge
                        of the card. Left box = the card's rank in the
                        seeker's filtered pull frequency (1 = most
                        drawn). Right box = total pull count in the
                        same filtered universe. Each box is half the
                        card's actual width. Hover on either opens a
                        popover explaining what the number means.
                        Click on either opens the readings modal
                        scoped to this specific card. Replaces the
                        old floating circular badge. */}
                    {drawCounts &&
                      drawCounts.perCard[pick.cardIndex] !== undefined &&
                      (() => {
                        const count = drawCounts.perCard[pick.cardIndex];
                        const rank = drawCounts.perCardRank?.[pick.cardIndex];
                        const universeSize = drawCounts.rankUniverseSize ?? 0;
                        const effectiveOpacity = isFocused ? 0.9 : badgeOpacity(count, picksMax);
                        const pct = Math.round(effectiveOpacity * 100);
                        const baseColor = isFocused
                          ? "var(--gold, var(--accent))"
                          : "var(--accent, var(--gold))";
                        const bg = `color-mix(in oklab, ${baseColor} ${pct}%, var(--surface-card) ${100 - pct}%)`;
                        const textColor =
                          effectiveOpacity > 0.5 ? "var(--background)" : "var(--color-foreground)";
                        const cardName = pick.cardName ?? TAROT_DECK[pick.cardIndex] ?? "this card";
                        const halfW = Math.floor(slotW / 2);
                        const boxStyle = {
                          flex: 1,
                          minWidth: 0,
                          height: 18, // ~12px font + 3px top + 3px bottom
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: bg,
                          color: textColor,
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: 11,
                          lineHeight: 1,
                          cursor: count > 0 ? "pointer" : "default",
                          userSelect: "none" as const,
                        };
                        const openModal = () => {
                          if (count <= 0) return;
                          setModalCardId(pick.cardIndex);
                          setModalMode("slot-card");
                          setReadingsModalOpen(true);
                        };
                        return (
                          <div
                            style={{
                              display: "flex",
                              width: slotW,
                              gap: 0,
                              marginTop: 0,
                              borderTop:
                                "1px solid color-mix(in oklab, var(--color-foreground) 10%, transparent)",
                            }}
                          >
                            <div
                              role="button"
                              tabIndex={count > 0 ? 0 : -1}
                              aria-label={
                                rank
                                  ? `Rank ${rank} of ${universeSize} most-drawn cards. Click to view readings.`
                                  : `Unranked; never drawn in the current filter window.`
                              }
                              onClick={openModal}
                              onMouseEnter={(e) => {
                                cancelPopoverDismiss();
                                const r = (
                                  e.currentTarget as HTMLDivElement
                                ).getBoundingClientRect();
                                setActivePopover({
                                  kind: "slot-rank-box",
                                  key: `rank-${pick.id}`,
                                  anchorX: r.left + r.width / 2,
                                  anchorY: r.bottom + 4,
                                  cardName,
                                  rank: rank ?? null,
                                  universeSize,
                                  count,
                                });
                              }}
                              onMouseLeave={() => schedulePopoverDismiss("slot-rank-box")}
                              style={{
                                ...boxStyle,
                                width: halfW,
                                borderRight:
                                  "1px solid color-mix(in oklab, var(--color-foreground) 10%, transparent)",
                              }}
                            >
                              {rank ? `#${rank}` : "—"}
                            </div>
                            <div
                              role="button"
                              tabIndex={count > 0 ? 0 : -1}
                              aria-label={`Drawn ${count} times. Click to view readings.`}
                              onClick={openModal}
                              onMouseEnter={(e) => {
                                cancelPopoverDismiss();
                                const r = (
                                  e.currentTarget as HTMLDivElement
                                ).getBoundingClientRect();
                                setActivePopover({
                                  kind: "slot-count-box",
                                  key: `count-${pick.id}`,
                                  anchorX: r.left + r.width / 2,
                                  anchorY: r.bottom + 4,
                                  cardName,
                                  count,
                                });
                              }}
                              onMouseLeave={() => schedulePopoverDismiss("slot-count-box")}
                              style={{
                                ...boxStyle,
                                width: slotW - halfW,
                              }}
                            >
                              {count}
                            </div>
                          </div>
                        );
                      })()}
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
                <SpreadDropdown value={spreadKey} onChange={setSpreadKeyPersisted} />
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <SmartCardInput
                  positionLabels={[]}
                  emptySlotCount={78}
                  onCommit={handleCommit}
                  onBulkCommit={handleBulk}
                  placedCardIds={picks.map((p) => p.cardIndex)}
                  deckCards={deckCards}
                  maxWidth="100%"
                />
              </div>
            </div>
          </div>
          {/* DY — bottom of right column: question + prompts trigger,
              notes textarea, Save to Journal button. Hides entirely
              when no picks. */}
          {picks.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 12,
              }}
            >
              {/* Row: question input + prompts trigger button */}
              <div
                style={{
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
                  onClick={() => setPromptsModalOpen(true)}
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
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 13,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ✶
                </button>
              </div>
              {/* Notes textarea — EF2: shortened to 2 rows per spec.
                  Save action moved up into the OverlapStrip pill row. */}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Notes — your reflections, observations, anything that helps you remember this spread."
                rows={2}
                style={{
                  width: "100%",
                  minHeight: 44,
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
              <div style={{ marginTop: 6 }}>
                <OverlapPills
                  mode={overlapMode}
                  onModeChange={setOverlapMode}
                  showOlder={showOlder}
                  onShowOlderChange={setShowOlder}
                  onSaveToJournal={() => void handleSaveToJournal()}
                  saveStatus={saveStatus}
                  saveError={saveError}
                  saveDisabled={!canSubmit}
                  align="flex-start"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Calendar strip — DY: snug to constellation (was 10px gap).
          DZ — day cells are clickable; tapping a day with readings opens
          the day-readings popover for that date. */}
      <div style={{ padding: "0 24px 24px", flexShrink: 0 }}>
        <OverlapStrip
          overlap={overlap}
          heroCardId={heroPick?.cardIndex ?? null}
          pullCardIds={picks.map((p) => p.cardIndex)}
          mode={overlapMode}
          onModeChange={setOverlapMode}
          tealSelectedIds={tealSelectedIds}
          layout="grid12"
          onDayClick={(date) => setDayPopover({ open: true, date })}
          showOlder={showOlder}
          onShowOlderChange={setShowOlder}
          onDayHover={(info) => {
            cancelPopoverDismiss();
            setActivePopover({
              kind: "day-cell",
              key: info.date,
              anchorX: info.anchorX,
              anchorY: info.anchorY,
              date: info.date,
              signals: info.signals,
              tooltipText: info.tooltipText,
            });
          }}
          onDayHoverEnd={(date) => schedulePopoverDismiss("day-cell", date)}
        />
      </div>

      {/* Phase 20 Fix 13 — THIS PULL → YOUR PRACTICE → question → Get Reading */}
      {picks.length > 0 && (
        <div style={{ padding: "0 24px", marginTop: 8 }}>
          <SectionDivider />
          <SectionOverline label="YOUR SPREAD" />
          <ThisPullTiles picks={picks} />
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
          {/* Get AI Reading button */}
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
              deckId={undefined}
              excludeCardIds={placedIds}
              title="Pick a card"
              drawCountTimeRange={globalFilters.timeRange ?? DEFAULT_TIMEFRAME}
              onCancel={() => setPickerOpen(false)}
              onSelect={(cardIndex, isReversed, _deckId, cardName) => {
                setFocusedSlotIdx(picks.length);
                setPicks((prev) => [
                  ...prev,
                  {
                    id: Date.now() + prev.length,
                    cardIndex,
                    isReversed,
                    deckId: null,
                    cardName,
                  },
                ]);
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
            const n = tealCount;
            const unit =
              overlapMode === "pull" ? (n === 1 ? "SPREAD" : "SPREADS") : n === 1 ? "DAY" : "DAYS";
            const tealNames = tealSelectedIds.map((id) => TAROT_DECK[id] ?? "Card").join(", ");
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
            ? tealMatchedReadings
            : modalMode === "slot-card"
              ? slotCardMatchedReadings
              : heroMatchedReadings
        }
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
        return (
          <RichPopover
            open
            anchorX={activePopover.anchorX}
            anchorY={activePopover.anchorY}
            onClose={() => {
              if (popoverEditMode) {
                commitPopoverEditMode();
              }
              closeActivePopover("card-meaning");
            }}
            onCancelDismiss={cancelPopoverDismiss}
            onScheduleDismiss={() => schedulePopoverDismiss("card-meaning")}
            chainedContent={<ConstellationLegend />}
            chainedTitle="How the constellation works"
            extraTopRightControl={
              <>
                {/* EJ20 — pin to screen as a draggable modal */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    pinCard(cardId);
                    closeActivePopover("card-meaning");
                  }}
                  aria-label="Pin to screen"
                  title={
                    isPinned(cardId) ? "Already pinned" : "Pin to screen — compare side-by-side"
                  }
                  disabled={isPinned(cardId)}
                  style={{
                    padding: 2,
                    border: "none",
                    background: "transparent",
                    cursor: isPinned(cardId) ? "default" : "pointer",
                    color: isPinned(cardId)
                      ? "var(--accent, var(--gold))"
                      : "var(--color-foreground-muted, var(--color-foreground))",
                    display: "inline-flex",
                    alignItems: "center",
                    opacity: isPinned(cardId) ? 0.85 : 0.7,
                  }}
                >
                  <Pin size={13} strokeWidth={1.5} />
                </button>
                {/* EJ19 — edit-mode gear */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (popoverEditMode) {
                      commitPopoverEditMode();
                    } else {
                      setPopoverEditMode(true);
                    }
                  }}
                  aria-label={
                    popoverEditMode ? "Save section preferences" : "Edit visible sections"
                  }
                  title={popoverEditMode ? "Save and exit edit mode" : "Edit which sections show"}
                  style={{
                    padding: 2,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: popoverEditMode
                      ? "var(--gold, var(--accent))"
                      : "var(--color-foreground-muted, var(--color-foreground))",
                    display: "inline-flex",
                    alignItems: "center",
                    opacity: 0.85,
                  }}
                >
                  <Pencil size={13} strokeWidth={1.5} />
                </button>
                <HoverTipsGear />
              </>
            }
            maxWidth={320}
          >
            {renderCardPopoverInner(cardId, { editable: true })}
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
      {/* EJ16 — slot card RANK box hover popover. Surfaces the
          card's rank within the seeker's filtered pull frequency
          (1 = most drawn). Reuses the chip-hint visual treatment
          with a slightly larger maxWidth to fit the explanation. */}
      {activePopover?.kind === "slot-rank-box" && (
        <RichPopover
          open
          anchorX={activePopover.anchorX}
          anchorY={activePopover.anchorY}
          onClose={() => closeActivePopover("slot-rank-box")}
          onCancelDismiss={cancelPopoverDismiss}
          onScheduleDismiss={() => schedulePopoverDismiss("slot-rank-box")}
          maxWidth={300}
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
            {activePopover.cardName}
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
            Frequency Rank
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 12.5,
              color: "var(--color-foreground)",
              lineHeight: 1.5,
              opacity: 0.92,
            }}
          >
            {activePopover.rank
              ? `Ranked #${activePopover.rank} of ${activePopover.universeSize} cards you've drawn in the current filter window. Drawn ${activePopover.count} ${activePopover.count === 1 ? "time" : "times"}. Click to view those readings.`
              : `You haven't drawn this card in the current filter window. Try widening the time range or clearing chips to see if it appears further back.`}
          </div>
        </RichPopover>
      )}
      {/* EJ16 — slot card COUNT box hover popover. Surfaces the
          total pull count and offers a click-to-view-readings
          affordance. */}
      {activePopover?.kind === "slot-count-box" && (
        <RichPopover
          open
          anchorX={activePopover.anchorX}
          anchorY={activePopover.anchorY}
          onClose={() => closeActivePopover("slot-count-box")}
          onCancelDismiss={cancelPopoverDismiss}
          onScheduleDismiss={() => schedulePopoverDismiss("slot-count-box")}
          maxWidth={300}
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
            {activePopover.cardName}
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
            Pull Count
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 12.5,
              color: "var(--color-foreground)",
              lineHeight: 1.5,
              opacity: 0.92,
            }}
          >
            {activePopover.count > 0
              ? `Drawn ${activePopover.count} ${activePopover.count === 1 ? "time" : "times"} in the current filter window. Click to view those readings.`
              : `You haven't drawn this card in the current filter window. Try widening the time range to see if it appears further back.`}
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
      {/* DY — journaling-prompts modal. Lists the curated 3-5 prompts
          for the hero card; click a prompt to insert it into the notes
          textarea + close. Uses the canonical branded Modal. */}
      <Modal
        open={promptsModalOpen}
        onClose={() => setPromptsModalOpen(false)}
        title="Journaling prompts"
        subtitle={
          heroPick
            ? `For ${heroPick.cardName ?? TAROT_MEANINGS[heroPick.cardIndex]?.name ?? "this card"}`
            : undefined
        }
        size="sm"
      >
        {(() => {
          const prompts = heroPick ? resolvePromptsForFirstCard(heroPick.cardIndex) : null;
          if (!prompts || prompts.length === 0) {
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
                No prompts available for this card.
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
              {prompts.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setNote((prev) =>
                      prev.trim() === "" ? `${p}\n\n` : `${prev.replace(/\s+$/, "")}\n\n${p}\n\n`,
                    );
                    setPromptsModalOpen(false);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "color-mix(in oklab, var(--accent, var(--gold)) 6%, transparent)",
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
              {list.map((r) => {
                const cardsLabel = r.cardIds
                  .slice(0, 5)
                  .map((id) => TAROT_DECK[id] ?? `Card ${id}`)
                  .join(" · ");
                const extra = r.cardIds.length > 5 ? ` · +${r.cardIds.length - 5}` : "";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleLoadReading(r.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "color-mix(in oklab, var(--accent, var(--gold)) 6%, transparent)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--color-foreground)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      width: "100%",
                    }}
                  >
                    {r.question ? (
                      <span
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: 13,
                          color: "var(--color-foreground)",
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
                          color: "var(--color-foreground)",
                          opacity: 0.6,
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
                        color: "var(--color-foreground-muted, var(--color-foreground))",
                        opacity: 0.85,
                        lineHeight: 1.35,
                      }}
                    >
                      {cardsLabel}
                      {extra}
                    </span>
                  </button>
                );
              })}
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
            matches.map((r) => {
              const date = formatDateShort(r.createdAt);
              const cardsLabel = r.cardIds.map((id) => TAROT_DECK[id] ?? `Card ${id}`).join(" · ");
              const hasQuestion = !!(r.question && r.question.trim());
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onRowClick(r.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface-elevated, var(--surface-card))",
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
                        color: "var(--color-foreground-muted, var(--color-foreground))",
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
                        color: "var(--color-foreground)",
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
                        color: "var(--color-foreground-muted, var(--color-foreground))",
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
            })
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
