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
import { useEffect, useMemo, useRef, useState } from "react";
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

export function QuickLog({
  question,
  onQuestionChange,
  initialPicks,
  onPicksChange,
  onSwitchToTable,
  onCancel,
  onComplete,
}: Props) {
  useRegisterCloseHandler(onCancel);
  const { activeDeck, imageMap } = useActiveDeck();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { effectiveTz } = useTimezone();
  // EJ35 — resolve oracle card names through the active deck's
  // card_name overrides so constellation / chip labels show
  // "Hurricane Lamp" instead of "Card 1000".
  const resolveCardName = useActiveDeckCardName();
  // EJ54 — Read the active deck's seeker-chosen corner radius (0–15%).
  // Used to derive the focused-ring + drag-over + breathe-glow
  // borderRadius so each highlight silhouette matches the deck's
  // baked-in rounded corners. Fallback 0 (sharp) when no override is
  // saved — matches the EJ28 fallback for default decks. The math
  // (deckRadiusPct / 100) * slotW gives the pixel radius of the
  // card's actual rounded corners; +2 (the highlight outset) keeps
  // the ring concentric with the card silhouette.
  const deckRadiusPct = useActiveDeckCornerRadius() ?? 0;

  // Seed from any cached picks; QuickLog is additive (no null gaps).
  const [picks, setPicks] = useState<ManualPick[]>(() =>
    (initialPicks ?? []).filter((p): p is ManualPick => !!p),
  );
  useEffect(() => {
    onPicksChange?.(picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks]);

  const [backdate, setBackdate] = useState<Date | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  // Q114 Phase 5 — picker sheet + drag-to-reorder/delete state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const slotRowRef = useRef<HTMLDivElement>(null);

  // Q122 Phase 9 — long-press pin for touch/pen to reveal slot controls.
  const [longPressSlotIdx, setLongPressSlotIdx] = useState<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  // Phase 14 (CZ) — explicit focused-slot index. Tap a slot to make it the
  // hero. Null means "default to most recently placed" (legacy behavior).
  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number | null>(null);
  useEffect(() => {
    if (longPressSlotIdx === null) return;
    const handleTapOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-slot-controls]")) {
        setLongPressSlotIdx(null);
      }
    };
    window.addEventListener("pointerdown", handleTapOutside);
    return () => window.removeEventListener("pointerdown", handleTapOutside);
  }, [longPressSlotIdx]);

  // Smart-input parser index: pull names from EVERY deck the seeker
  // owns + the standard 78-card Rider-Waite list. Active deck takes
  // priority on duplicate names; standard tarot is the floor.
  const [allDeckCards, setAllDeckCards] = useState<Array<{ cardId: number; name: string }>>([]);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const decks = await fetchUserDecks(user.id);
        const ordered = [...decks].sort((a, b) => {
          const ai = (a as { is_active?: boolean }).is_active ? -1 : 0;
          const bi = (b as { is_active?: boolean }).is_active ? -1 : 0;
          return ai - bi;
        });
        const acc: Array<{ cardId: number; name: string }> = [];
        for (const d of ordered) {
          try {
            const cards = await fetchDeckCards(d.id);
            for (const c of cards) {
              const nm = (c.card_name ?? "").trim();
              if (nm) acc.push({ cardId: c.card_id, name: nm });
            }
          } catch {
            /* per-deck failure is non-fatal */
          }
        }
        if (!cancelled) setAllDeckCards(acc);
      } catch {
        if (!cancelled) setAllDeckCards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const deckCards = useMemo(() => {
    const seenNames = new Set<string>();
    const out: Array<{ cardId: number; name: string }> = [];
    // 1. Active deck imageMap (already in memory).
    if (activeDeck) {
      for (const [id, name] of Object.entries(imageMap.nameByCardId ?? {})) {
        const nm = (name || "").trim();
        if (!nm) continue;
        const key = nm.toLowerCase();
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        out.push({ cardId: Number(id), name: nm });
      }
    }
    // 2. Other user-owned decks.
    for (const c of allDeckCards) {
      const key = c.name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      out.push(c);
    }
    // 3. Standard tarot floor.
    TAROT_DECK.forEach((name, idx) => {
      const key = name.toLowerCase();
      if (seenNames.has(key)) return;
      seenNames.add(key);
      out.push({ cardId: idx, name });
    });
    return out.length > 0 ? out : undefined;
  }, [activeDeck, imageMap, allDeckCards]);

  const placedIds = picks.map((p) => p.cardIndex);

  const handleCommit = (pick: SmartPick) => {
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

  // Dynamic slot sizing. The slot row lives inside the right column.
  const { ref: rowRef, width: rowWidth } = useElementWidth<HTMLDivElement>();
  const slotCount = picks.length + 1; // entered + trailing "+"
  const { slotW, slotH, gap } = useMemo(() => {
    if (rowWidth <= 0) {
      return { slotW: DEFAULT_SLOT_W, slotH: DEFAULT_SLOT_W * 1.6, gap: DEFAULT_GAP };
    }
    const defaultExtent = slotCount * DEFAULT_SLOT_W + (slotCount - 1) * DEFAULT_GAP;
    let w: number;
    let g: number;
    if (defaultExtent <= rowWidth) {
      w = DEFAULT_SLOT_W;
      g = DEFAULT_GAP;
    } else {
      w = rowWidth / (slotCount + GAP_RATIO * (slotCount - 1));
      g = w * GAP_RATIO;
    }
    return { slotW: w, slotH: w * 1.6, gap: g };
  }, [rowWidth, slotCount]);

  // Phase 14 (CZ) — hero = focused slot if any, else most recently placed.
  const heroPick =
    picks.length === 0
      ? null
      : picks[
          focusedSlotIdx !== null && focusedSlotIdx < picks.length
            ? focusedSlotIdx
            : picks.length - 1
        ];

  // ─── Q111 Phase 2 — per-card stats + companions + journal ───
  // Phase 15 Fix 1 — no client cache; always refetch when hero changes so
  // stats reflect the currently focused slot.
  const [cardStats, setCardStats] = useState<QuickLogCardStats | null>(null);
  const [selectedCompanionIdx, setSelectedCompanionIdx] = useState(0);

  useEffect(() => {
    setSelectedCompanionIdx(0);
  }, [heroPick?.cardIndex]);

  useEffect(() => {
    if (!heroPick || !user?.id) {
      setCardStats(null);
      return;
    }
    const id = heroPick.cardIndex;
    let cancelled = false;
    void getQuickLogCardStats({ data: { cardId: id, tz: effectiveTz } })
      .then((stats) => {
        if (cancelled) return;
        setCardStats(stats);
      })
      .catch((err) => {
        console.error("[QuickLog] card-stats fetch failed:", err);
        if (!cancelled) setCardStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz]);

  const descriptor = heroPick ? buildCardDescriptor(heroPick.cardIndex) : null;

  const canSubmit = picks.length >= 1;

  // ─── Q112 Phase 3 — overlap strip + practice line ───────────────────
  // Phase 15 Fix 1 — no overlap cache; always refetch on hero change.
  const [overlap, setOverlap] = useState<QuickLogOverlap | null>(null);
  const [overlapMode, setOverlapMode] = useState<"pull" | "day">("pull");
  const [practice, setPractice] = useState<QuickLogPractice | null>(null);
  const { currentStreak } = useStreak();

  useEffect(() => {
    if (!user?.id) {
      setOverlap(null);
      return;
    }
    let cancelled = false;
    void getQuickLogOverlap({
      data: { heroCardId: heroPick?.cardIndex ?? null, tz: effectiveTz },
    })
      .then((d) => {
        if (cancelled) return;
        if (!d || !Array.isArray(d.months) || d.months.length === 0) {
          console.warn("[QuickLog] overlap response malformed or empty:", d);
        }
        setOverlap(d);
      })
      .catch((err) => {
        console.error("[QuickLog] overlap fetch failed:", err);
        if (!cancelled) setOverlap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz]);

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
      .catch((err) => {
        console.error("[QuickLog] practice fetch failed:", err);
        if (!cancelled) setPractice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, effectiveTz]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const meta: { createdAt?: string; entryMode?: "manual" } = {
      entryMode: "manual",
    };
    if (backdate) meta.createdAt = backdate.toISOString();
    onComplete(picks, meta);
    setPicks([]);
    setBackdate(null);
  };

  // ─── Q113 Phase 4 — Constellation state ────────────────────────────
  const constellation = useMemo<ConstellationState>(() => {
    const pullIds = picks.map((p) => p.cardIndex);
    if (pullIds.length < 3 || !overlap) {
      return {
        active: false,
        participatingCardIds: [],
        matchingReadings: [],
        matchCount: 0,
        matchCountSixMonths: 0,
      };
    }
    const matches: ConstellationState["matchingReadings"] = [];
    const entries = Object.entries(overlap.readingsByDate ?? {});
    if (overlapMode === "pull") {
      for (const [, readings] of entries) {
        for (const reading of readings) {
          const matched = pullIds.filter((id) => reading.cardIds.includes(id));
          if (matched.length >= 3) matches.push({ ...reading, matched });
        }
      }
    } else {
      for (const [, readings] of entries) {
        if (readings.length === 0) continue;
        const dayCards = new Set<number>();
        for (const r of readings) r.cardIds.forEach((id) => dayCards.add(id));
        const matched = pullIds.filter((id) => dayCards.has(id));
        if (matched.length >= 3) {
          matches.push({ ...readings[0], matched });
        }
      }
    }
    if (matches.length === 0) {
      return {
        active: false,
        participatingCardIds: [],
        matchingReadings: [],
        matchCount: 0,
        matchCountSixMonths: 0,
      };
    }
    const all = new Set<number>();
    matches.forEach((m) => m.matched.forEach((id) => all.add(id)));
    matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // Dedupe by reading id — defensive against any duplicate push above.
    const seenIds = new Set<string>();
    const uniqMatches = matches.filter((m) => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });
    return {
      active: true,
      participatingCardIds: [...all],
      matchingReadings: uniqMatches.slice(0, 5),
      matchCount: uniqMatches.length,
      matchCountSixMonths: uniqMatches.length,
    };
  }, [picks, overlap, overlapMode]);

  const participatingSet = useMemo(
    () => new Set(constellation.participatingCardIds),
    [constellation.participatingCardIds],
  );

  return (
    <FullScreenSheet open onClose={onCancel} entry="fade" showCloseButton={false}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          maxWidth: 1280,
          marginLeft: "auto",
          marginRight: "auto",
          overflowY: "auto",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close quick log"
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 10px)",
            right: 12,
            zIndex: 10,
            padding: 8,
            color: "var(--color-foreground)",
            opacity: 0.7,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            touchAction: "manipulation",
          }}
        >
          <X size={18} strokeWidth={1.5} />
        </button>

        <div className="flex h-full w-full flex-col bg-cosmos text-foreground">
          {/* Header strip — entry-mode toggle on the left (parity with
              ManualEntryBuilder). */}
          <div
            className="relative w-full border-b border-border/40"
            style={{
              minHeight: 48,
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)",
              paddingBottom: 8,
              display: "flex",
              alignItems: "center",
              paddingLeft: 16,
            }}
          >
            {onSwitchToTable && <EntryModeToggle current="manual" onToggle={onSwitchToTable} />}
          </div>

          {/* Q113 Phase 4 — Constellation banner */}
          {constellation.active && (
            <div style={{ position: "relative", margin: "16px 24px 0" }}>
              <div
                aria-hidden
                className="tarotseed-constellation-breathe"
                style={{
                  position: "absolute",
                  top: -12,
                  left: -16,
                  right: -16,
                  bottom: -12,
                  background:
                    "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 48%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 28%, transparent) 50%, transparent 85%)",
                  pointerEvents: "none",
                  zIndex: 0,
                  borderRadius: 60,
                }}
              />
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  // Phase 16 Fix 2.1 — banner halved (102→51 / 51→25).
                  height: 51,
                  borderRadius: 25,
                  border: "1px solid var(--accent, var(--gold))",
                  background: "var(--surface-card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 16,
                    color: "var(--accent, var(--gold))",
                    fontStyle: "italic",
                    fontFamily: "var(--font-display)",
                    letterSpacing: "0.05em",
                    textAlign: "center",
                    padding: "0 12px",
                  }}
                >
                  An Echo — {constellation.participatingCardIds.length} of these cards have met
                  before
                </span>
              </div>
            </div>
          )}

          {/* Phase 16 Fix 2.2 — constellation matching-readings panel
              relocated out of CompanionsAndJournal to a full-width strip
              directly below the banner. Journal list on the right now stays
              visible regardless of constellationActive. */}
          {constellation.active && constellation.matchingReadings.length > 0 && (
            <div
              style={{ padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <p
                style={{
                  fontSize: 10,
                  letterSpacing: "0.3em",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  color: "var(--accent, var(--gold))",
                  opacity: 0.85,
                  margin: 0,
                  textTransform: "uppercase",
                }}
              >
                AN ECHO — WHEN THESE{" "}
                {(() => {
                  const n = constellation.participatingCardIds.length;
                  return n === 2
                    ? "TWO"
                    : n === 3
                      ? "THREE"
                      : n === 4
                        ? "FOUR"
                        : n === 5
                          ? "FIVE"
                          : String(n);
                })()}{" "}
                MET BEFORE
              </p>
              <p
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  color: "var(--color-foreground-muted, var(--color-foreground))",
                  margin: 0,
                  opacity: 0.8,
                }}
              >
                {constellation.participatingCardIds.map((id) => resolveCardName(id)).join(" · ")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {constellation.matchingReadings.map((r) => {
                  const thumbs = constellation.participatingCardIds.slice(0, 3);
                  const more = constellation.participatingCardIds.length - thumbs.length;
                  return (
                    <div key={r.id} style={{ position: "relative" }}>
                      <div
                        aria-hidden
                        className="tarotseed-constellation-breathe"
                        style={{
                          position: "absolute",
                          top: -12,
                          left: -16,
                          right: -16,
                          bottom: -12,
                          background:
                            "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 42%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 24%, transparent) 50%, transparent 85%)",
                          pointerEvents: "none",
                          zIndex: 0,
                          borderRadius: 14,
                        }}
                      />
                      <div
                        style={{
                          position: "relative",
                          zIndex: 1,
                          width: "100%",
                          minHeight: 60,
                          borderRadius: 6,
                          border: "1px solid var(--accent, var(--gold))",
                          background: "var(--surface-card)",
                          padding: "8px 10px",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          boxSizing: "border-box",
                        }}
                      >
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {thumbs.map((cid) => (
                            <div
                              key={cid}
                              style={{
                                width: 28,
                                height: 44,
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <CardImage variant="face" cardId={cid} size="custom" widthPx={28} />
                            </div>
                          ))}
                          {more > 0 && (
                            <span
                              style={{
                                alignSelf: "center",
                                fontSize: 10,
                                fontStyle: "italic",
                                fontFamily: "var(--font-serif)",
                                color: "var(--color-foreground-muted, var(--color-foreground))",
                                marginLeft: 4,
                              }}
                            >
                              +{more} more
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              color: "var(--color-foreground)",
                              fontStyle: "italic",
                              fontFamily: "var(--font-serif)",
                            }}
                          >
                            {format(new Date(r.createdAt), "MMM d, yyyy")}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--color-foreground-muted, var(--color-foreground))",
                              fontStyle: "italic",
                              fontFamily: "var(--font-serif)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.question?.trim() || "(no question)"}
                          </span>
                        </div>
                        <span style={{ color: "var(--accent, var(--gold))", fontSize: 11 }}>›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main two-column grid */}
          <div
            style={{
              padding: "24px 24px 16px",
              display: "grid",
              gridTemplateColumns: `${HERO_W}px 1fr`,
              gap: 25,
              alignItems: "start",
            }}
          >
            {/* Left column — hero */}
            <div
              style={{
                width: HERO_W,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ position: "relative", width: HERO_W }}>
                {constellation.active && (
                  <div
                    aria-hidden
                    className="tarotseed-constellation-breathe"
                    style={{
                      position: "absolute",
                      top: -40,
                      left: -40,
                      right: -40,
                      bottom: -40,
                      background:
                        "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 48%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 28%, transparent) 35%, transparent 75%)",
                      pointerEvents: "none",
                      zIndex: 0,
                      borderRadius: "50%",
                    }}
                  />
                )}
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    width: HERO_W,
                    boxSizing: "border-box",
                  }}
                >
                  {heroPick ? (
                    <CardImage
                      variant="face"
                      cardId={heroPick.cardIndex}
                      reversed={heroPick.isReversed}
                      deckId={heroPick.deckId ?? undefined}
                      size="custom"
                      widthPx={HERO_W}
                      eager
                    />
                  ) : (
                    <CardImage variant="back" size="custom" widthPx={HERO_W} eager />
                  )}
                </div>
              </div>
              {heroPick && descriptor && (
                <p
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-caption, 0.75rem)",
                    color: "var(--color-foreground-muted, var(--color-foreground))",
                    margin: 0,
                    opacity: 0.85,
                  }}
                >
                  {descriptor}
                </p>
              )}
            </div>

            {/* Right column — date pill + smart input, then slot row */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
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
                    placedCardIds={placedIds}
                    deckCards={deckCards}
                    maxWidth="100%"
                  />
                </div>
              </div>

              {/* Slot row + chip grid — side by side */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 20,
                  width: "100%",
                }}
              >
                <div ref={rowRef} style={{ flex: 1, minWidth: 0 }}>
                  <div
                    ref={slotRowRef}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap,
                    }}
                  >
                    {picks.map((pick, idx) => {
                      const isInConstellation =
                        constellation.active && participatingSet.has(pick.cardIndex);
                      const isDragSource = dragSourceIdx === idx;
                      const isDragOver = dragOverIdx === idx && dragSourceIdx !== idx;
                      const isFocused = focusedSlotIdx === idx;
                      return (
                        <span
                          key={pick.id}
                          className={`tarotseed-slot-wrapper ${longPressSlotIdx === idx ? "tarotseed-slot-pinned" : ""}`}
                          draggable
                          onClick={(e) => {
                            // Phase 14 (CZ) — tap-to-focus. Ignore clicks on
                            // the in-slot controls (RotateCw / X).
                            const target = e.target as HTMLElement | null;
                            if (target?.closest("[data-slot-controls]")) return;
                            setFocusedSlotIdx(idx);
                            setLongPressSlotIdx(idx);
                          }}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", String(idx));
                            e.dataTransfer.effectAllowed = "move";
                            setDragSourceIdx(idx);
                          }}
                          onDragEnd={(e) => {
                            const src = dragSourceIdx;
                            const row = slotRowRef.current;
                            if (src !== null && row) {
                              const r = row.getBoundingClientRect();
                              const inside =
                                e.clientX >= r.left &&
                                e.clientX <= r.right &&
                                e.clientY >= r.top &&
                                e.clientY <= r.bottom;
                              if (!inside) {
                                setPicks((prev) => prev.filter((_, i) => i !== src));
                                // Phase 14 (CZ) — keep focus index valid.
                                setFocusedSlotIdx((cur) => {
                                  if (cur === null) return null;
                                  if (cur === src) {
                                    return src > 0 ? src - 1 : picks.length > 1 ? 0 : null;
                                  }
                                  if (cur > src) return cur - 1;
                                  return cur;
                                });
                              }
                            }
                            setDragSourceIdx(null);
                            setDragOverIdx(null);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (dragOverIdx !== idx) setDragOverIdx(idx);
                          }}
                          onDragLeave={() => {
                            if (dragOverIdx === idx) setDragOverIdx(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const fromIdx = Number(e.dataTransfer.getData("text/plain"));
                            if (Number.isNaN(fromIdx) || fromIdx === idx) {
                              setDragOverIdx(null);
                              return;
                            }
                            setPicks((prev) => {
                              const next = [...prev];
                              const tmp = next[idx];
                              next[idx] = next[fromIdx];
                              next[fromIdx] = tmp;
                              return next;
                            });
                            // Phase 14 (CZ) — track focused card across swap.
                            setFocusedSlotIdx((cur) => {
                              if (cur === null) return null;
                              if (cur === fromIdx) return idx;
                              if (cur === idx) return fromIdx;
                              return cur;
                            });
                            setDragOverIdx(null);
                            setDragSourceIdx(null);
                          }}
                          onPointerDown={(e) => {
                            if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
                            if (longPressTimerRef.current !== null) {
                              window.clearTimeout(longPressTimerRef.current);
                            }
                            longPressTimerRef.current = window.setTimeout(() => {
                              setLongPressSlotIdx(idx);
                              longPressTimerRef.current = null;
                            }, 450);
                          }}
                          onPointerUp={() => {
                            if (longPressTimerRef.current !== null) {
                              window.clearTimeout(longPressTimerRef.current);
                              longPressTimerRef.current = null;
                            }
                          }}
                          onPointerCancel={() => {
                            if (longPressTimerRef.current !== null) {
                              window.clearTimeout(longPressTimerRef.current);
                              longPressTimerRef.current = null;
                            }
                          }}
                          onPointerLeave={() => {
                            if (longPressTimerRef.current !== null) {
                              window.clearTimeout(longPressTimerRef.current);
                              longPressTimerRef.current = null;
                            }
                          }}
                          style={{
                            // EJ58 — Stripped to bare minimum. The
                            // wrapper is just a host for event handlers
                            // and the absolute slot-controls overlay.
                            // It does NOT need to hug CardImage or apply
                            // any descender fix, because the selection
                            // ring lives INSIDE CardImage (EJ57) — the
                            // wrapper's bounds are irrelevant to the
                            // ring's position. position:relative is
                            // kept so the slot controls absolute span
                            // anchors to the wrapper. display:inline-
                            // block keeps the wrapper sized to its
                            // content (CardImage) without expanding to
                            // fill the row.
                            display: "inline-block",
                            position: "relative",
                            flexShrink: 0,
                            opacity: isDragSource ? 0.4 : 1,
                            cursor: "grab",
                          }}
                        >
                          {/* EJ58 — STRIPPED. No inner wrapper span, no
                              breathe glow, no drag-over overlay, no
                              font-size:0 / line-height:0 / vertical-
                              align:top dance. CardImage owns the
                              selection ring natively (EJ57) and is
                              already display:inline-block with the
                              correct width. The outer slot wrapper
                              just hosts event handlers + the absolute
                              slot controls. Whatever the wrapper does
                              or doesn't do can't affect the ring
                              because the ring lives INSIDE CardImage,
                              not as a child of the wrapper. If a gap
                              shows up after this, the bug is inside
                              CardImage. */}
                          <CardImage
                            variant="face"
                            cardId={pick.cardIndex}
                            reversed={pick.isReversed}
                            deckId={pick.deckId ?? undefined}
                            size="custom"
                            widthPx={slotW}
                            selected={isFocused}
                          />
                          <div
                            className="tarotseed-slot-controls"
                            data-slot-controls
                            style={{
                              position: "absolute",
                              top: 4,
                              left: 4,
                              right: 4,
                              display: "flex",
                              justifyContent: "space-between",
                              zIndex: 3,
                            }}
                          >
                            <button
                              type="button"
                              aria-label={pick.isReversed ? "Set upright" : "Reverse card"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPicks((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, isReversed: !p.isReversed } : p,
                                  ),
                                );
                              }}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 11,
                                border: "none",
                                background:
                                  "color-mix(in oklab, var(--background) 75%, transparent)",
                                backdropFilter: "blur(4px)",
                                WebkitBackdropFilter: "blur(4px)",
                                color: "var(--color-foreground)",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                              }}
                            >
                              <RotateCw size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="Remove card"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPicks((prev) => prev.filter((_, i) => i !== idx));
                                if (longPressSlotIdx === idx) setLongPressSlotIdx(null);
                                // Phase 14 (CZ) — keep focus index valid.
                                setFocusedSlotIdx((cur) => {
                                  if (cur === null) return null;
                                  if (cur === idx) {
                                    return idx > 0 ? idx - 1 : picks.length > 1 ? 0 : null;
                                  }
                                  if (cur > idx) return cur - 1;
                                  return cur;
                                });
                              }}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 11,
                                border: "none",
                                background:
                                  "color-mix(in oklab, var(--background) 75%, transparent)",
                                backdropFilter: "blur(4px)",
                                WebkitBackdropFilter: "blur(4px)",
                                color: "var(--color-foreground)",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </span>
                      );
                    })}
                    {/* Trailing dashed "+" slot */}
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      style={{
                        width: slotW,
                        height: slotW * 1.55,
                        borderRadius: 6,
                        border: "1.5px dashed color-mix(in oklab, var(--gold) 55%, transparent)",
                        background: "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--accent, var(--gold))",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      aria-label="Add card"
                    >
                      <Plus size={Math.max(14, slotW * 0.3)} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                {heroPick && <ChipGrid heroPick={heroPick} stats={cardStats} />}
              </div>

              {/* Companions + journal */}
              <CompanionsAndJournal
                heroPick={heroPick}
                stats={cardStats}
                selectedIdx={selectedCompanionIdx}
                onSelect={setSelectedCompanionIdx}
                pullCardIds={placedIds}
                constellation={constellation}
                onOpenReading={(id: string) => {
                  navigate({ to: "/journal", search: { open: id } as never });
                }}
              />
            </div>
          </div>

          {/* Q112 Phase 3 — Six-month overlap strip */}
          {/* Phase 20 Fix 12 — bottom padding extends background past cells. */}
          <div style={{ padding: "0 24px 32px", marginTop: 32 }}>
            <OverlapStrip
              overlap={overlap}
              heroCardId={heroPick?.cardIndex ?? null}
              pullCardIds={placedIds}
              mode={overlapMode}
              onModeChange={setOverlapMode}
            />
          </div>

          {/* Q112 Phase 3 — THIS PULL tiles */}
          {picks.length > 0 && (
            <div style={{ padding: "0 24px", marginTop: 24 }}>
              <SectionDivider />
              <SectionOverline label="YOUR SPREAD" />
              <ThisPullTiles picks={picks} />
            </div>
          )}

          {/* Q112 Phase 3 — pull-history pill */}
          {picks.length >= 2 && (
            <div style={{ padding: "0 24px" }}>
              <PullHistoryPill picks={picks} practice={practice} constellation={constellation} />
            </div>
          )}

          {/* Q112 Phase 3 — YOUR PRACTICE line */}
          <div style={{ padding: "0 24px", marginTop: 32 }}>
            <SectionDivider />
            <SectionOverline label="YOUR PRACTICE" />
            <PracticeLine practice={practice} currentStreak={currentStreak} />
          </div>

          {/* Bottom: question textarea + Get Reading */}
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
              onChange={(e) => onQuestionChange(e.target.value)}
              placeholder="Tap to add your question for the cards…"
              rows={1}
              style={{
                width: "100%",
                maxWidth: 640,
                minHeight: 44,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                background: "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
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
              onClick={handleSubmit}
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
                fontSize: "var(--text-body, 0.95rem)",
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.4,
                pointerEvents: canSubmit ? "auto" : "none",
                transition: "opacity 0.2s ease",
              }}
            >
              Get Reading
            </button>
          </div>
        </div>
      </div>
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
                // Phase 14 (CZ) — focus the just-added card (lands at end).
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
    </FullScreenSheet>
  );
}

// ─── Q111 Phase 2 — Chip grid ────────────────────────────────────────

type ChipProps = {
  label: string;
  value: string;
  fullWidth?: boolean;
  tooltip?: string;
  /** EH — when wired, native title="" is suppressed and the parent
   * handles the popover via these callbacks. */
  onChipHover?: (info: {
    label: string;
    tooltip: string;
    anchorX: number;
    anchorY: number;
  }) => void;
  onChipHoverEnd?: () => void;
};

function Chip({ label, value, fullWidth, tooltip, onChipHover, onChipHoverEnd }: ChipProps) {
  return (
    <div
      title={onChipHover ? undefined : tooltip}
      onMouseEnter={
        onChipHover && tooltip
          ? (e) =>
              onChipHover({
                label,
                tooltip,
                anchorX: e.clientX,
                anchorY: e.clientY,
              })
          : undefined
      }
      onMouseLeave={onChipHoverEnd}
      style={{
        width: fullWidth ? 390 : 190,
        height: 38,
        borderRadius: 6,
        border: "1px solid var(--border-subtle)",
        background:
          "color-mix(in oklab, var(--surface-elevated, var(--surface-card)) 100%, transparent)",
        padding: "6px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        boxSizing: "border-box",
        cursor: tooltip ? "help" : "default",
      }}
    >
      <span
        style={{
          fontSize: 9,
          lineHeight: 1.1,
          letterSpacing: "0.15em",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          color: "var(--accent, var(--gold))",
          opacity: 0.7,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          lineHeight: 1.2,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          color: "var(--color-foreground)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ChipGrid({
  heroPick,
  stats,
  onChipHover,
  onChipHoverEnd,
}: {
  heroPick: ManualPick;
  stats: QuickLogCardStats | null;
  /** EH — passes through to every Chip. When provided, native title=""
   * is suppressed and the parent drives a RichPopover. */
  onChipHover?: (info: {
    label: string;
    tooltip: string;
    anchorX: number;
    anchorY: number;
  }) => void;
  onChipHoverEnd?: () => void;
}) {
  // LAST SEEN
  let lastSeen = "—";
  if (stats?.lastSeenAt) {
    const d = new Date(stats.lastSeenAt);
    const daysAgo = differenceInCalendarDays(new Date(), d);
    if (stats.count <= 1) {
      lastSeen = "First time";
    } else if (daysAgo <= 30) {
      lastSeen = `${format(d, "MMM d")} · ${daysAgo}d ago`;
    } else {
      lastSeen = format(d, "MMM d, yyyy");
    }
  }

  // TIME PATTERN
  const timePattern = stats?.topDayOfWeek
    ? `${stats.topDayOfWeek.day}s · ${stats.topDayOfWeek.count} of ${stats.topDayOfWeek.total}`
    : "—";

  // FREQUENCY — Phase 15 Fix 2
  let frequency = "—";
  if (stats && stats.frequencyRank != null && stats.count > 0) {
    if (stats.frequencyRank === 1) {
      frequency = `#1 most-drawn · ${stats.count} times`;
    } else if (stats.frequencyRank <= 5) {
      frequency = `#${stats.frequencyRank} most-drawn · ${stats.count} times`;
    } else if (stats.frequencyRank <= 20) {
      frequency = `#${stats.frequencyRank} · ${stats.count} times`;
    } else {
      frequency = `Rare for you · ${stats.count} time${stats.count === 1 ? "" : "s"}`;
    }
  }

  // MOON PHASE — Phase 15 Fix 3
  let moonPhase = "—";
  if (stats && stats.count > 0) {
    const top = stats.topMoonPhase;
    if (top && top.count >= 2 && top.count / top.total >= 0.3) {
      moonPhase = `Most under ${top.phase} · ${top.count} of ${top.total}`;
    } else if (stats.lastSeenMoonPhase) {
      moonPhase = `Last under ${stats.lastSeenMoonPhase}`;
    }
  }

  // REVERSED
  let reversed = "0 of 0 reversed · —";
  if (stats && stats.count > 0) {
    const pct = Math.round((stats.reversedCount / stats.count) * 100);
    const avgPct = Math.round(stats.seekerReversedRate * 100);
    const cmp = pct < avgPct ? "below" : pct > avgPct ? "above" : "at";
    reversed = `${stats.reversedCount} of ${stats.count} reversed (${pct}%) · ${cmp} your ${avgPct}% avg`;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        flexShrink: 0,
      }}
    >
      {/* EF2 — REVERSED moved up next to TIME PATTERN per spec. Row 1
          is now LAST SEEN / TIME PATTERN / REVERSED; row 2 is
          FREQUENCY / MOON PHASE. REVERSED loses fullWidth. */}
      <div style={{ display: "flex", gap: 10 }}>
        <Chip
          label="LAST SEEN"
          value={lastSeen}
          tooltip="The most recent day this card appeared in any of your spreads. Example: 'May 16 · 3d ago' means you drew this card 3 days ago, on May 16."
          onChipHover={onChipHover}
          onChipHoverEnd={onChipHoverEnd}
        />
        <Chip
          label="TIME PATTERN"
          value={timePattern}
          tooltip="The day of the week this card has shown up most often across your history. Example: 'Sundays · 3 of 7' means 3 of the 7 times you've drawn this card were on Sundays."
          onChipHover={onChipHover}
          onChipHoverEnd={onChipHoverEnd}
        />
        <Chip
          label="REVERSED"
          value={reversed}
          tooltip="How often this card has appeared reversed for you, compared to your overall reversed-card rate. Example: '1 of 11 reversed (9%) · above your 7% avg' means this card came up reversed once out of 11 draws, slightly above your average."
          onChipHover={onChipHover}
          onChipHoverEnd={onChipHoverEnd}
        />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Chip
          label="FREQUENCY"
          value={frequency}
          tooltip="Where this card sits in your personal draw history. Example: '#3 most-drawn · 47 times' means it's your third-most-drawn card across all your spreads. 'Rare for you' means it's appeared 5 or fewer times in your full history."
          onChipHover={onChipHover}
          onChipHoverEnd={onChipHoverEnd}
        />
        <Chip
          label="MOON PHASE"
          value={moonPhase}
          tooltip="The moon phase during your draws of this card. Example: 'Most under Full Moon · 4 of 12' means 4 of the 12 times you've drawn this card, it was during a Full Moon. Otherwise shows the phase during your most recent draw."
          onChipHover={onChipHover}
          onChipHoverEnd={onChipHoverEnd}
        />
      </div>
    </div>
  );
}

// ─── Q111 Phase 2 — Companions row + journal list ─────────────────────

function CompanionsAndJournal({
  heroPick,
  stats,
  selectedIdx,
  onSelect,
  pullCardIds,
  constellation,
  onOpenReading,
}: {
  heroPick: ManualPick | null;
  stats: QuickLogCardStats | null;
  selectedIdx: number;
  onSelect: (i: number) => void;
  pullCardIds: number[];
  constellation: ConstellationState;
  onOpenReading: (id: string) => void;
}) {
  // EJ35 — resolver for oracle card_ids (>= 1000). Falls back to the
  // tarot dictionary for 0..77.
  const resolveCardName = useActiveDeckCardName();
  const companions = stats?.companions ?? [];
  const selected = companions[selectedIdx] ?? companions[0] ?? null;

  const journalRows = useMemo(() => {
    if (!stats || !selected) return [];
    return stats.journal.filter((r) => r.cardIds.includes(selected.cardId)).slice(0, 5);
  }, [stats, selected]);

  const showEmptyPlaceholder = !heroPick || companions.length === 0;

  const pullSet = useMemo(() => new Set(pullCardIds), [pullCardIds]);
  const constellationActive = constellation.active;
  // Phase 16 Fix 2.2 — participatingIds / participatingNames / wordFor were
  // only used by the constellation matching-readings panel that now lives
  // outside this component (a full-width strip below the banner).

  return (
    <div
      style={{
        marginTop: 32,
        display: "flex",
        flexDirection: "row",
        gap: 32,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "0 0 auto" }}>
        <p
          style={{
            fontSize: 10,
            letterSpacing: "0.3em",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            color: "var(--accent, var(--gold))",
            opacity: 0.75,
            marginBottom: 14,
            margin: "0 0 14px 0",
          }}
        >
          COMPANIONS — TAP TO FILTER
        </p>
        {showEmptyPlaceholder ? (
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 80, height: 80 * 1.55, opacity: 0.35 }}>
              <CardImage variant="back" size="custom" widthPx={80} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12 }}>
            {companions.map((c, idx) => {
              const isSelected = idx === selectedIdx;
              const isInPull = pullSet.has(c.cardId);
              const showGoldRing = constellationActive && isInPull;
              const heroName = heroPick ? resolveCardName(heroPick.cardIndex) : "this card";
              const companionName = resolveCardName(c.cardId);
              const tooltipText = `${heroName} and ${companionName} have appeared together in ${c.count} of your spreads (matching your filters).`;
              return (
                <button
                  key={c.cardId}
                  type="button"
                  title={tooltipText}
                  onClick={() => onSelect(idx)}
                  style={{
                    position: "relative",
                    border: "none",
                    background: "transparent",
                    cursor: "help",
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {isSelected && (
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: -6,
                        borderRadius: 10,
                        boxShadow:
                          "0 0 0 1.5px var(--accent, var(--gold)), 0 0 20px color-mix(in oklab, var(--gold) 50%, transparent)",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {showGoldRing && (
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: -3,
                        left: -3,
                        right: 0,
                        bottom: 0,
                        width: 86,
                        height: 134,
                        background:
                          "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                        borderRadius: 6,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  <div
                    style={{
                      width: 80,
                      borderRadius: 5,
                      overflow: "hidden",
                      position: "relative",
                      boxSizing: "border-box",
                    }}
                  >
                    <CardImage variant="face" cardId={c.cardId} size="custom" widthPx={80} />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      color: "var(--color-foreground)",
                      opacity: 0.85,
                    }}
                  >
                    ×{c.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Phase 16 Fix 2.2 — constellation branch removed; journal list
          (heroPick + selected pair) now always shows on the right. */}
      {heroPick && selected ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 10,
              letterSpacing: "0.3em",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              color: "var(--accent, var(--gold))",
              opacity: 0.75,
              marginBottom: 14,
              margin: "0 0 14px 0",
              textTransform: "uppercase",
            }}
          >
            {resolveCardName(heroPick.cardIndex)} + {resolveCardName(selected.cardId)}
          </p>
          {journalRows.length === 0 ? (
            <p
              style={{
                fontSize: 11,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color: "var(--color-foreground-muted, var(--color-foreground))",
                textAlign: "center",
                padding: "16px 0",
                opacity: 0.65,
                margin: 0,
              }}
            >
              No past readings with these two together.
            </p>
          ) : (
            <div>
              {journalRows.map((r) => {
                const q = (r.question ?? "").trim();
                const label = q.length > 30 ? `${q.slice(0, 30)}…` : q;
                return (
                  <div
                    key={r.id}
                    style={{
                      width: "100%",
                      height: 22,
                      borderRadius: 5,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-card)",
                      padding: "0 10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 4,
                      boxSizing: "border-box",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        color: "var(--color-foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {format(new Date(r.createdAt), "MMM d")} — {label || "(no question)"}
                    </span>
                    <span
                      style={{
                        color: "var(--accent, var(--gold))",
                        fontSize: 10,
                      }}
                    >
                      ›
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

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
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
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
                    const lines: string[] = [dateLabel];
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
                      <div
                        key={day.date}
                        // EG — drop native title="" when the parent has
                        // wired the rich-popover callbacks. Otherwise keep
                        // for legacy /draw/classic.
                        title={onDayHover ? undefined : tooltipText}
                        onMouseEnter={
                          onDayHover
                            ? (e) => {
                                // EJ28 — capture the cell's own bounding
                                // rect so the parent can place the
                                // popover with preferred-placement
                                // (above the cell) instead of cursor-
                                // anchored. Fixes calendar click bug:
                                // cursor-anchored popover at cursorY+8
                                // overlapped 20px-tall cells and
                                // intercepted clicks on the inner button.
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
                        // EG — long-press support for touch. Only the
                        // touch pointer type triggers the timer; mouse
                        // pointers already get hover via onMouseEnter.
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
                                // EJ28 — capture targetRect for touch path too.
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
                                // If the long-press fired, suppress click
                                // (parent dismisses on outside-tap).
                                // Otherwise let the click event do its
                                // normal thing.
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
                            ? { width: "100%", aspectRatio: "1 / 1" }
                            : { width: 20, height: 20 }),
                          ...(pulseHoverDays &&
                          (asterismBadgeHovered ? tealTraceHit : hoverStrokeHit)
                            ? {
                                animation:
                                  "tarotseed-day-pulse 1.4s ease-in-out infinite",
                              }
                            : null),
                        }}
                      >
                        {(() => {
                          // DZ — collect reading ids for this day. When the
                          // caller wires onDayClick AND at least one reading
                          // exists, the cell becomes a button.
                          const dayReadings = overlap?.readingsByDate?.[day.date] ?? [];
                          const dayReadingIds = dayReadings.map((r) => r.id);
                          const clickable = !!onDayClick && dayReadingIds.length > 0;
                          // EK116 — the day number no longer lives inside the
                          // base cell (which sits under the ring layer). It is
                          // rendered as a top overlay below, ABOVE the rings, so
                          // ring strokes never cross the digit.
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
                            // EK101 — day number sits in the bottom-left
                            // corner of the cell (was centered, which read
                            // as up-and-right). Small padding keeps it off
                            // the very edge.
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
                                  onDayClick(day.date, dayReadingIds);
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
                        {/* EK117 — the day number shows ONLY when the cell
                            carries a real signal: filled (hero gold or a spread
                            match) or stroked (asterism / hover trace; perfect &
                            best rings imply matchCount > 0). Pulse flashing only
                            fires on stroked days, so it's already covered. Empty
                            cells (faint base wash) stay bare. Still on its top
                            layer ABOVE the rings (EK116). */}
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
                              // EK101 — match the base cell: bottom-left.
                              alignItems: "flex-end",
                              justifyContent: "flex-start",
                              padding: "0 0 1px 2px",
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                              fontSize: 11,
                              lineHeight: 1,
                              color: textColor,
                              pointerEvents: "none",
                              zIndex: 5,
                            }}
                          >
                            {displayNumber}
                          </div>
                        )}
                        {/* EK90 — day strokes nest INWARD as inset rings: no
                            outward room, flush to the fill, no gap. Slot model:
                            present rings fill slots outermost-in by priority —
                            perfect (solid accent) > best (dashed accent) >
                            asterism (solid teal; hover preview = lighter teal).
                            Each +1px over the prior design; full opacity so they
                            read on dim days. Absent rings reserve no slot. */}
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
                          // v2.62 — hovering a constellation card no longer adds
                          // a teal ring to its drawn days (that stroke is reserved
                          // for the actual asterism/teal SELECTION). Hover still
                          // reveals the day number and keeps its gentle pulse; the
                          // day otherwise keeps exactly the markings it had.
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
                        {/* EK59 — full/new moon indicator, top-right
                            corner, non-interactive, above fills + strokes.
                            A day is never both, so two guards are fine. */}
                        {layout === "grid12" && moonDayYmds.full.has(day.date) && (
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
                            <MoonPhaseIcon phase="Full Moon" size={10} />
                          </div>
                        )}
                        {layout === "grid12" && moonDayYmds.nw.has(day.date) && (
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
  ChipGrid,
  ThisPullTiles,
  PullHistoryPill,
  PracticeLine,
  SectionOverline,
  SectionDivider,
};
export type { ConstellationState };
