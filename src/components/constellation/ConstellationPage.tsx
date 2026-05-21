/**
 * Phase 17 — /constellation page.
 *
 * Top: 10-slot row (additive picks). Tap a filled slot to focus it as
 * the hero. Below: left column shows the constellation SVG, right
 * column shows the chip grid + matching readings panel. Full-width
 * 6-month overlap strip sits below.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { CalendarIcon, RotateCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateShort } from "@/lib/dates";
import { useRegisterTabletopActive } from "@/lib/floating-menu-context";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CardPicker } from "@/components/cards/CardPicker";
import { CardImage } from "@/components/card/CardImage";
import {
  ChipGrid,
  OverlapStrip,
  ThisPullTiles,
  PullHistoryPill,
  PracticeLine,
  SectionOverline,
  SectionDivider,
  type ConstellationState,
} from "@/components/tabletop/QuickLog";
import {
  SmartCardInput,
  type PasteOutcome,
  type SmartPick,
} from "@/components/tabletop/SmartCardInput";
import {
  ConstellationWeb,
  SVG_H,
  SVG_W,
} from "@/components/constellation/ConstellationWeb";
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
  type QuickLogCardStats,
  type QuickLogOverlap,
  type CardConstellation,
  type QuickLogPractice,
  type CardDrawCounts,
} from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { useAuth } from "@/lib/auth";
import { useTimezone } from "@/lib/use-timezone";
import { useNavigate } from "@tanstack/react-router";
import { useStreak } from "@/lib/use-streak";
import { getLunationContaining } from "@/lib/lunation";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";

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

export function ConstellationPage() {
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const navigate = useNavigate();

  // Phase 18 Fix 6 — hide the global BottomNav on /constellation.
  useRegisterTabletopActive(true);

  // DP — restore prior session state on first mount.
  const persisted = useMemo(() => loadPersisted(), []);

  const [picks, setPicks] = useState<ManualPick[]>(
    () => persisted?.picks ?? [],
  );
  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number | null>(
    () => persisted?.focusedSlotIdx ?? null,
  );
  // Phase 24 — teal multi-select trace. Empty by default. Click any card in
  // the constellation web (hero or companion) to toggle membership. Drives
  // calendar stroke + readings panel filter. Resets when hero changes.
  const [tealSelectedIds, setTealSelectedIds] = useState<number[]>(
    () => persisted?.tealSelectedIds ?? [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phase 19 Fix 7 — back-date pill state (parity with QuickLog).
  const [backdate, setBackdate] = useState<Date | null>(
    () =>
      persisted?.backdateISO ? new Date(persisted.backdateISO) : null,
  );
  const [dateOpen, setDateOpen] = useState(false);
  // Phase 23 — page-wide filter state. Default 365d (12 months).
  const [globalFilters, setGlobalFilters] = useState<GlobalFilters>(() =>
    persisted?.globalFilters ?? {
      ...EMPTY_GLOBAL_FILTERS,
      timeRange: DEFAULT_TIMEFRAME,
    },
  );
  const filterPayload = useMemo(
    () => toFilterPayload(globalFilters),
    [globalFilters],
  );
  const filterKey = useMemo(() => JSON.stringify(filterPayload), [filterPayload]);

  // DR — readings modal open state.
  const [readingsModalOpen, setReadingsModalOpen] = useState(false);

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

  // DR — slot row size computed from container width. Clamped between
  // COMPACT_SLOT_MIN_W and COMPACT_SLOT_MAX_W so layouts stay sane on both
  // 1024px and ≥1280px viewports.
  const slotRowRef = useRef<HTMLDivElement | null>(null);
  const [slotW, setSlotW] = useState<number>(48);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = slotRowRef.current;
    if (!el) return;
    const compute = () => {
      const total = el.clientWidth;
      if (total <= 0) return;
      const target = Math.floor((total - COMPACT_SLOT_GAP * 9) / 10);
      const clamped = Math.max(
        COMPACT_SLOT_MIN_W,
        Math.min(COMPACT_SLOT_MAX_W, target),
      );
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

  // Reset teal selection whenever the hero changes — the constellation web
  // re-renders against the new hero's top companions, so prior teal cards
  // may not even be present anymore. DP — skip on initial mount so persisted
  // teal selection survives the first render's hero resolution.
  const heroInitRef = useRef(true);
  useEffect(() => {
    if (heroInitRef.current) {
      heroInitRef.current = false;
      return;
    }
    setTealSelectedIds([]);
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
  const [overlapMode, setOverlapMode] = useState<"pull" | "day">(
    () => persisted?.overlapMode ?? "pull",
  );
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
  const [constellationData, setConstellationData] =
    useState<CardConstellation | null>(null);
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

  // Phase 23 Fix 5 — per-card draw counts for slot badges.
  const [drawCounts, setDrawCounts] = useState<CardDrawCounts | null>(null);
  const cardIdsKey = picks.map((p) => p.cardIndex).join(",");
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

  // Phase 19 Fix 10 — port the Echo detection to /constellation.
  const echo = useEcho(picks, overlap, overlapMode);
  const participatingSet = useMemo(
    () => new Set(echo.participatingCardIds),
    [echo.participatingCardIds],
  );

  // DR — matched readings against the current teal selection. Empty teal =
  // show all matches (just hero). Mirrors the filter logic that used to
  // live inside MatchingReadingsPanel.
  const matchedReadings = useMemo(() => {
    const matches = constellationData?.matches ?? [];
    if (tealSelectedIds.length === 0) return matches;
    const tealSet = new Set(tealSelectedIds);
    return matches.filter((r) => {
      const cardSet = new Set(r.cardIds);
      for (const id of tealSet) {
        if (!cardSet.has(id)) return false;
      }
      return true;
    });
  }, [constellationData?.matches, tealSelectedIds]);

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
              if (!sameDay.has(id)) { ok = false; break; }
            }
            if (ok && sameDay.has(cardId)) { hit = true; break outer; }
          } else {
            const readings = overlap.readingsByDate?.[day.date] ?? [];
            for (const r of readings) {
              const ids = new Set(r.cardIds);
              let ok = true;
              for (const id of tealSet) {
                if (!ids.has(id)) { ok = false; break; }
              }
              if (ok && ids.has(cardId)) { hit = true; break outer; }
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
  const [question, setQuestion] = useState<string>(
    () => persisted?.question ?? "",
  );
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

  const handleGetReading = () => {
    if (!canSubmit) return;
    // Seed /draw's manual entry surface with these picks via sessionStorage.
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
      window.sessionStorage.setItem(
        "tarotseed:constellation-handoff",
        JSON.stringify(payload),
      );
      // DP — clear persisted /constellation state on submit; the seeker is
      // moving on, the next visit should start fresh.
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
  const deckCards = useMemo(
    () => TAROT_DECK.map((name, idx) => ({ cardId: idx, name })),
    [],
  );

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
    setBackdate(null);
  };

  const handleRemoveSlot = (slotIdx: number) => {
    setPicks((prev) => prev.filter((_, i) => i !== slotIdx));
    setFocusedSlotIdx((cur) =>
      cur === null ? null : cur === slotIdx ? null : cur > slotIdx ? cur - 1 : cur,
    );
  };

  const handleToggleReverse = (slotIdx: number) => {
    setPicks((prev) =>
      prev.map((p, i) =>
        i === slotIdx ? { ...p, isReversed: !p.isReversed } : p,
      ),
    );
  };


  const handleSlotDrop = (slotIdx: number, cardId: number) => {
    setDraggingCardId(null);
    setDragOverSlotIdx(null);
    if (!Number.isFinite(cardId) || cardId < 0) return;
    setPicks((prev) => {
      // If the card is already in another slot, do nothing (avoid duplicates).
      const existingIdx = prev.findIndex((p) => p.cardIndex === cardId);
      if (existingIdx !== -1) {
        setFocusedSlotIdx(existingIdx);
        return prev;
      }
      const occupant = prev[slotIdx];
      if (occupant) {
        const replace = window.confirm(
          `Replace ${occupant.cardName ?? `card ${occupant.cardIndex}`} in this slot?`,
        );
        if (!replace) return prev;
        const next = [...prev];
        next[slotIdx] = {
          id: Date.now(),
          cardIndex: cardId,
          isReversed: false,
          deckId: null,
          cardName: TAROT_DECK[cardId] ?? null,
        };
        setFocusedSlotIdx(slotIdx);
        return next;
      }
      // Empty slot: append. (Slots fill left-to-right; mid-row gaps
      // shouldn't exist in normal use, but if `slotIdx` is past length we
      // still just append to the next available position.)
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
      {/* Header row — DU: subtitle inline with H1 on the same row. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 2px",
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
              fontSize: 26,
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
            onClick={() =>
              requestNavigate(() => navigate({ to: "/draw/classic" }))
            }
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

      {/* Phase 23 Fix 3 — filter row below H1. */}
      <div style={{ padding: "4px 24px 0" }}>
        <GlobalFilterBar
          filters={globalFilters}
          onChange={setGlobalFilters}
          sections={["tags", "spreadTypes", "depth", "reversed"]}
          timeRange={{
            value: globalFilters.timeRange ?? DEFAULT_TIMEFRAME,
            options: TIMEFRAME_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            })),
            onChange: (v) =>
              setGlobalFilters((prev) => ({ ...prev, timeRange: v })),
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
        <ConstellationWeb
          heroPick={heroPick}
          constellation={constellationData}
          onCardClick={(cardId) =>
            setTealSelectedIds((prev) =>
              prev.includes(cardId)
                ? prev.filter((x) => x !== cardId)
                : [...prev, cardId],
            )
          }
          tealSelectedIds={tealSelectedIds}
          candidateIds={candidateIds}
          heroDrawCount={
            heroPick && drawCounts
              ? (drawCounts.perCard[heroPick.cardIndex] ?? null)
              : null
          }
          onCardDragStart={(cardId) => setDraggingCardId(cardId)}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            height: "100%",
          }}
        >
          {/* DU — readings button now at TOP of right column, above ChipGrid.
              Counts matches against the current teal selection (or all hero
              matches when teal is empty). Tap opens the modal. */}
          {heroPick && matchedReadings.length > 0 && (
            <button
              type="button"
              onClick={() => setReadingsModalOpen(true)}
              style={{
                alignSelf: "flex-start",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--color-foreground)",
                background:
                  "color-mix(in oklab, var(--accent, var(--gold)) 18%, transparent)",
                border:
                  "1px solid color-mix(in oklab, var(--accent, var(--gold)) 50%, transparent)",
                borderRadius: 9999,
                padding: "6px 14px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {matchedReadings.length}{" "}
              {matchedReadings.length === 1 ? "reading" : "readings"} with{" "}
              {tealSelectedIds.length === 0
                ? "this card"
                : tealSelectedIds.length === 1
                  ? "selected card"
                  : `${tealSelectedIds.length} selected cards`}
            </button>
          )}
          {heroPick ? (
            <ChipGrid heroPick={heroPick} stats={cardStats} />
          ) : (
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color:
                  "var(--color-foreground-muted, var(--color-foreground))",
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
                paddingBottom: 20,
                justifyContent: "flex-start",
              }}
            >
              {Array.from({ length: 10 }).map((_, idx) => {
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
                        const raw = e.dataTransfer.getData(
                          "application/x-tarotseed-cardid",
                        );
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
                        color:
                          "var(--color-foreground-muted, var(--color-foreground))",
                        fontSize: 14,
                        transition: "background 120ms ease",
                      }}
                    >
                      +
                    </button>
                  );
                }
                const isFocused = idx === heroIdx;
                const inEcho =
                  echo.active && participatingSet.has(pick.cardIndex);
                const showControls =
                  hoveredSlotIdx === idx || focusedSlotIdx === idx;
                return (
                  <div
                    key={pick.id}
                    style={{
                      position: "relative",
                      width: slotW,
                      flexShrink: 0,
                      outline: isDropTarget
                        ? "2px dashed var(--accent, var(--gold))"
                        : "none",
                      outlineOffset: 3,
                      borderRadius: 6,
                      transition: "outline 120ms ease",
                    }}
                    onMouseEnter={() => setHoveredSlotIdx(idx)}
                    onMouseLeave={() =>
                      setHoveredSlotIdx((cur) => (cur === idx ? null : cur))
                    }
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
                      const raw = e.dataTransfer.getData(
                        "application/x-tarotseed-cardid",
                      );
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
                          top: -8,
                          left: -8,
                          right: -8,
                          bottom: -8,
                          background:
                            "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 45%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 22%, transparent) 55%, transparent 85%)",
                          pointerEvents: "none",
                          zIndex: 0,
                          borderRadius: 12,
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
                        outline: isFocused
                          ? "2px solid var(--accent, var(--gold))"
                          : "none",
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
                        aria-label={
                          pick.isReversed
                            ? "Flip upright"
                            : "Flip reversed"
                        }
                        title={
                          pick.isReversed ? "Flip upright" : "Flip reversed"
                        }
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
                          transform: pick.isReversed
                            ? "rotate(180deg)"
                            : "none",
                          transition: "transform 160ms ease",
                        }}
                      >
                        <RotateCw size={11} strokeWidth={2} />
                      </button>
                    )}
                    {drawCounts &&
                      drawCounts.perCard[pick.cardIndex] !== undefined &&
                      (() => {
                        const count = drawCounts.perCard[pick.cardIndex];
                        const effectiveOpacity = isFocused
                          ? 0.9
                          : badgeOpacity(count, drawCounts.globalMax);
                        const pct = Math.round(effectiveOpacity * 100);
                        const baseColor = isFocused
                          ? "var(--gold, var(--accent))"
                          : "var(--accent, var(--gold))";
                        const bg = `color-mix(in oklab, ${baseColor} ${pct}%, var(--surface-card) ${100 - pct}%)`;
                        const textColor =
                          effectiveOpacity > 0.5
                            ? "var(--background)"
                            : "var(--color-foreground)";
                        return (
                          <div
                            role="img"
                            aria-label={`Appeared in ${count} past readings`}
                            title={`This card has appeared in ${count} of your past readings.`}
                            style={{
                              position: "absolute",
                              bottom: -6,
                              right: -6,
                              zIndex: 2,
                              width: 22,
                              height: 22,
                              borderRadius: 9999,
                              background: bg,
                              border:
                                "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: textColor,
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                              fontSize: 11,
                              lineHeight: 1,
                              cursor: "help",
                            }}
                          >
                            {count}
                          </div>
                        );
                      })()}
                  </div>
                );
              })}
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
        </div>
      </div>

      {/* Calendar strip — DV: 16px top breathing room between paste box
          (above) and the pills + month names (below). */}
      <div style={{ padding: "16px 24px 24px", flexShrink: 0 }}>
        <OverlapStrip
          overlap={overlap}
          heroCardId={heroPick?.cardIndex ?? null}
          pullCardIds={picks.map((p) => p.cardIndex)}
          mode={overlapMode}
          onModeChange={setOverlapMode}
          tealSelectedIds={tealSelectedIds}
          layout="grid12"
        />
      </div>

      {/* Phase 20 Fix 13 — THIS PULL → YOUR PRACTICE → question → Get Reading */}
      {picks.length > 0 && (
        <div style={{ padding: "0 24px", marginTop: 8 }}>
          <SectionDivider />
          <SectionOverline label="THIS PULL" />
          <ThisPullTiles picks={picks} />
        </div>
      )}
      {picks.length >= 2 && (
        <div style={{ padding: "0 24px" }}>
          <PullHistoryPill
            picks={picks}
            practice={practice}
            constellation={constellationState}
          />
        </div>
      )}
      <div style={{ padding: "0 24px", marginTop: 32 }}>
        <SectionDivider />
        <SectionOverline label="YOUR PRACTICE" />
        <PracticeLine practice={practice} currentStreak={currentStreak} />
      </div>
      <div
        style={{
          marginTop: 30,
          padding: "0 24px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Tap to add your question for the cards…"
          rows={1}
          style={{
            width: "100%",
            maxWidth: 640,
            minHeight: 44,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--border-subtle)",
            background:
              "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body, 0.95rem)",
            resize: "vertical",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={handleGetReading}
          disabled={!canSubmit}
          style={{
            width: 180,
            height: 44,
            borderRadius: 9999,
            background: "var(--accent, var(--gold))",
            color: "var(--cosmos, #0a0a14)",
            border: "none",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 14,
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.4,
            pointerEvents: canSubmit ? "auto" : "none",
          }}
        >
          Get Reading
        </button>
      </div>

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
          sessionStorage handoff key. */}
      <ReadingsModal
        open={readingsModalOpen}
        onClose={() => setReadingsModalOpen(false)}
        title={
          tealSelectedIds.length === 0
            ? "Recent Readings"
            : tealSelectedIds.length === 1
              ? `Readings with ${TAROT_DECK[tealSelectedIds[0]] ?? "this card"}`
              : `Readings with ${tealSelectedIds.length} selected cards`
        }
        matches={matchedReadings}
        onRowClick={(readingId) => {
          try {
            window.sessionStorage.setItem(
              "tarotseed:open-reading-id",
              readingId,
            );
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  matches: ModalMatch[];
  onRowClick: (readingId: string) => void;
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
            alignItems: "center",
            justifyContent: "space-between",
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
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color:
                  "var(--color-foreground-muted, var(--color-foreground))",
                opacity: 0.7,
              }}
            >
              No matching readings.
            </p>
          ) : (
            matches.map((r) => {
              const date = formatDateShort(r.createdAt);
              const cardsLabel = r.cardIds
                .map((id) => TAROT_DECK[id] ?? `Card ${id}`)
                .join(" · ");
              const hasQuestion = !!(r.question && r.question.trim());
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onRowClick(r.id)}
                  style={{
                    textAlign: "left",
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface-elevated, var(--surface-card))",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    alignItems: "stretch",
                    width: "100%",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      gap: 10,
                      alignItems: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        fontFamily: "var(--font-serif)",
                        color:
                          "var(--color-foreground-muted, var(--color-foreground))",
                        opacity: 0.75,
                        flexShrink: 0,
                        lineHeight: 1.1,
                      }}
                    >
                      {date}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontFamily: "var(--font-serif)",
                        color: "var(--color-foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                        flex: 1,
                        lineHeight: 1.1,
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
                        color:
                          "var(--color-foreground-muted, var(--color-foreground))",
                        opacity: 0.85,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        width: "100%",
                        lineHeight: 1.2,
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
  return typeof document === "undefined"
    ? null
    : createPortal(node, document.body);
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
          You have cards placed here. Your selection is saved on this device
          and will be here when you return.
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
              background:
                "color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--accent, var(--gold)) 60%, transparent)",
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
  return typeof document === "undefined"
    ? null
    : createPortal(node, document.body);
}
