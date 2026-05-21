/**
 * Phase 17 — /constellation page.
 *
 * Top: 10-slot row (additive picks). Tap a filled slot to focus it as
 * the hero. Below: left column shows the constellation SVG, right
 * column shows the chip grid + matching readings panel. Full-width
 * 6-month overlap strip sits below.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
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
import { MatchingReadingsPanel } from "@/components/constellation/MatchingReadingsPanel";
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

const SLOT_W = 70;
const SLOT_H = Math.round(SLOT_W * 1.55);

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

  // DP — persist state to localStorage on every change. Restored on mount via
  // loadPersisted(). Cleared when the user submits via Get Reading.
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
    // question is declared further down; intentionally listed here so the
    // effect re-runs when it changes. ESLint can't see the forward ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, focusedSlotIdx, tealSelectedIds, backdate, overlapMode, globalFilters]);

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
  // DP — persist question to localStorage when it changes (alongside the
  // main persist effect above). Kept separate because `question` is
  // declared further down than the rest of the state, after the practice
  // fetch effect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      parsed.question = question;
      window.localStorage.setItem(LS_KEY, JSON.stringify(parsed));
    } catch {
      /* swallow */
    }
  }, [question]);
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
        padding: "12px 0 80px",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 4px",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 26,
              fontWeight: 400,
              color: "var(--color-foreground)",
            }}
          >
            Manual Entry
          </h1>
          <p
            style={{
              margin: "2px 0 0 0",
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
        <button
          type="button"
          onClick={() => navigate({ to: "/draw/classic" })}
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

      {/* Phase 19 Fix 2,3,4 / Phase 20 Fix 6 — two-column grid, no top padding */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${SVG_W}px minmax(0, 1fr)`,
          gap: 24,
          padding: "0 24px 0",
          minHeight: SVG_H,
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
          {/* Phase 20 Fix 8 — vertical scroll only; horizontal stays hidden. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              scrollbarGutter: "stable",
            }}
          >
            <MatchingReadingsPanel
              heroPick={heroPick}
              tealSelectedIds={tealSelectedIds}
              matches={constellationData?.matches ?? []}
              echoParticipatingIds={
                echo.active ? echo.participatingCardIds : null
              }
            />
          </div>
        </div>
      </div>

      {/* Phase 22 Fixes 3/4/5 — single horizontal row: slots on the left,
          [date pill + SmartCardInput] on the right. Overline removed. */}
      <div
        style={{
          padding: "8px 24px 8px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          width: "100%",
          boxSizing: "border-box",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            flexShrink: 0,
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
                    const raw =
                      e.dataTransfer.getData("application/x-tarotseed-cardid");
                    const id = raw ? Number(raw) : draggingCardId;
                    if (id !== null && Number.isFinite(id)) {
                      handleSlotDrop(idx, id);
                    } else {
                      setDraggingCardId(null);
                      setDragOverSlotIdx(null);
                    }
                  }}
                  style={{
                    width: SLOT_W,
                    height: SLOT_H,
                    borderRadius: 6,
                    border: isDropTarget
                      ? "2px solid var(--accent, var(--gold))"
                      : "1px dashed var(--border-default)",
                    background: isDropTarget
                      ? "color-mix(in oklab, var(--accent, var(--gold)) 12%, transparent)"
                      : "transparent",
                    cursor: "pointer",
                    color:
                      "var(--color-foreground-muted, var(--color-foreground))",
                    fontSize: 18,
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
            return (
              <div
                key={pick.id}
                style={{
                  position: "relative",
                  outline: isDropTarget
                    ? "2px dashed var(--accent, var(--gold))"
                    : "none",
                  outlineOffset: 4,
                  borderRadius: 8,
                  transition: "outline 120ms ease",
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
                  const raw =
                    e.dataTransfer.getData("application/x-tarotseed-cardid");
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
                      top: -10,
                      left: -10,
                      right: -10,
                      bottom: -10,
                      background:
                        "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 45%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 22%, transparent) 55%, transparent 85%)",
                      pointerEvents: "none",
                      zIndex: 0,
                      borderRadius: 14,
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setFocusedSlotIdx(idx)}
                  style={{
                    position: "relative",
                    zIndex: 1,
                    width: SLOT_W,
                    padding: 0,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 6,
                    outline: isFocused
                      ? "2px solid var(--accent, var(--gold))"
                      : "none",
                    outlineOffset: 2,
                  }}
                >
                  <CardImage
                    variant="face"
                    cardId={pick.cardIndex}
                    reversed={pick.isReversed}
                    deckId={pick.deckId ?? undefined}
                    size="custom"
                    widthPx={SLOT_W}
                  />
                </button>
                {drawCounts && drawCounts.perCard[pick.cardIndex] !== undefined && (() => {
                  const count = drawCounts.perCard[pick.cardIndex];
                  // Phase 24 — match the calendar's visual: solid backing layer
                  // so the card image doesn't show through. The gold blend uses
                  // color-mix against --surface-card, the same surface the
                  // calendar month panel uses; the badge ends up looking like
                  // a calendar day cell of the same intensity.
                  const effectiveOpacity = isFocused
                    ? 0.9
                    : badgeOpacity(count, drawCounts.globalMax);
                  const pct = Math.round(effectiveOpacity * 100);
                  // Focused slot uses --gold (matches calendar hero-day cells,
                  // bright yellow on themes that define --gold separately
                  // from --accent, like Blood Moon). Non-focused slots use
                  // --accent (matches calendar ordinary match cells).
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
                        bottom: -8,
                        right: -8,
                        zIndex: 2,
                        width: 26,
                        height: 26,
                        borderRadius: 9999,
                        background: bg,
                        border: "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: textColor,
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 12,
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
            flex: 1,
            minWidth: 280,
            display: "flex",
            alignItems: "center",
            gap: 8,
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
              style={{ zIndex: "var(--z-modal-nested)" as unknown as number }}
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

      {/* Calendar strip — Phase 20 Fix 12 bottom padding extends bg past cells. */}
      <div style={{ padding: "12px 24px 32px", flexShrink: 0 }}>
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
    </div>
  );
}
