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
import { CalendarIcon, Plus, X } from "lucide-react";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CardPicker } from "@/components/cards/CardPicker";
import { CardImage } from "@/components/card/CardImage";
import { EntryModeToggle } from "@/components/tabletop/EntryModeToggle";
import {
  SmartCardInput,
  type PasteOutcome,
  type SmartPick,
} from "@/components/tabletop/SmartCardInput";
import { useActiveDeck } from "@/lib/active-deck";
import { useElementWidth } from "@/lib/use-element-width";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { cn } from "@/lib/utils";
import type { SpreadMode } from "@/lib/spreads";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { useAuth } from "@/lib/auth";
import { fetchUserDecks, fetchDeckCards } from "@/lib/custom-decks";
import { TAROT_DECK, getCardName } from "@/lib/tarot";
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
  onComplete: (
    picks: ManualPick[],
    meta?: { createdAt?: string; entryMode?: "manual" },
  ) => void;
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

  // Smart-input parser index: pull names from EVERY deck the seeker
  // owns + the standard 78-card Rider-Waite list. Active deck takes
  // priority on duplicate names; standard tarot is the floor.
  const [allDeckCards, setAllDeckCards] = useState<
    Array<{ cardId: number; name: string }>
  >([]);
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

  const heroPick = picks.length > 0 ? picks[picks.length - 1] : null;

  // ─── Q111 Phase 2 — per-card stats + companions + journal ───
  const statsCacheRef = useRef<Map<number, QuickLogCardStats>>(new Map());
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
    const cached = statsCacheRef.current.get(id);
    if (cached) {
      setCardStats(cached);
      return;
    }
    let cancelled = false;
    void getQuickLogCardStats({ data: { cardId: id } })
      .then((stats) => {
        if (cancelled) return;
        statsCacheRef.current.set(id, stats);
        setCardStats(stats);
      })
      .catch(() => {
        if (!cancelled) setCardStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id]);

  const descriptor = heroPick ? buildCardDescriptor(heroPick.cardIndex) : null;

  const canSubmit = picks.length >= 1;

  // ─── Q112 Phase 3 — overlap strip + practice line ───────────────────
  const overlapCacheRef = useRef<Map<number, QuickLogOverlap>>(new Map());
  const [overlap, setOverlap] = useState<QuickLogOverlap | null>(null);
  const [overlapMode, setOverlapMode] = useState<"pull" | "day">("pull");
  const [practice, setPractice] = useState<QuickLogPractice | null>(null);
  const { currentStreak } = useStreak();

  useEffect(() => {
    if (!user?.id) {
      setOverlap(null);
      return;
    }
    const id = heroPick?.cardIndex ?? -1;
    const cached = overlapCacheRef.current.get(id);
    if (cached) {
      setOverlap(cached);
      return;
    }
    let cancelled = false;
    void getQuickLogOverlap({
      data: { heroCardId: heroPick?.cardIndex ?? null },
    })
      .then((d) => {
        if (cancelled) return;
        overlapCacheRef.current.set(id, d);
        setOverlap(d);
      })
      .catch(() => {
        if (!cancelled) setOverlap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const lun = getLunationContaining(new Date());
    void getQuickLogPractice({
      data: {
        lunationStart: lun.start.toISOString(),
        lunationEnd: lun.end.toISOString(),
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
  }, [user?.id]);

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
    const entries = Object.entries(overlap.readingsByDate);
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
    matches.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return {
      active: true,
      participatingCardIds: [...all],
      matchingReadings: matches.slice(0, 5),
      matchCount: matches.length,
      matchCountSixMonths: matches.length,
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
            {onSwitchToTable && (
              <EntryModeToggle current="manual" onToggle={onSwitchToTable} />
            )}
          </div>

          {/* Q113 Phase 4 — Constellation banner */}
          {constellation.active && (
            <div
              style={{
                height: 34,
                borderRadius: 17,
                border: "1px solid var(--accent, var(--gold))",
                background: "var(--surface-card)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "16px 24px 0",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "var(--accent, var(--gold))",
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  letterSpacing: "0.05em",
                }}
              >
                A CONSTELLATION FORMING — {constellation.participatingCardIds.length} of these cards have met before
              </span>
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
              <div style={{ position: "relative", width: HERO_W, height: HERO_H }}>
                {constellation.active && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: -30,
                      left: -30,
                      right: -30,
                      bottom: -30,
                      background:
                        "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 18%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent) 40%, transparent 80%)",
                      pointerEvents: "none",
                      zIndex: 0,
                    }}
                  />
                )}
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    width: HERO_W,
                    height: HERO_H,
                    border: constellation.active
                      ? "2px solid var(--accent, var(--gold))"
                      : "none",
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
                    <CardImage
                      variant="back"
                      size="custom"
                      widthPx={HERO_W}
                      eager
                    />
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
                    const isLatest = idx === picks.length - 1;
                    const isInConstellation =
                      constellation.active &&
                      participatingSet.has(pick.cardIndex);
                    const borderColor =
                      isLatest || isInConstellation
                        ? "var(--accent, var(--gold))"
                        : "var(--border-subtle)";
                    const borderWidth = isLatest ? "1.5px" : "1px";
                    const isDragSource = dragSourceIdx === idx;
                    const isDragOver =
                      dragOverIdx === idx && dragSourceIdx !== idx;
                    return (
                      <div
                        key={pick.id}
                        draggable
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
                              setPicks((prev) =>
                                prev.filter((_, i) => i !== src),
                              );
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
                          const fromIdx = Number(
                            e.dataTransfer.getData("text/plain"),
                          );
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
                          setDragOverIdx(null);
                          setDragSourceIdx(null);
                        }}
                        style={{
                          position: "relative",
                          width: slotW,
                          height: slotH,
                          flexShrink: 0,
                          opacity: isDragSource ? 0.4 : 1,
                          cursor: "grab",
                        }}
                      >
                        {isInConstellation && !isLatest && (
                          <div
                            aria-hidden
                            style={{
                              position: "absolute",
                              top: -3,
                              left: -3,
                              right: -3,
                              bottom: -3,
                              background:
                                "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                              borderRadius: 8,
                              pointerEvents: "none",
                              zIndex: 0,
                            }}
                          />
                        )}
                        {isDragOver && (
                          <div
                            aria-hidden
                            style={{
                              position: "absolute",
                              top: -3,
                              left: -3,
                              right: -3,
                              bottom: -3,
                              border:
                                "2px solid var(--accent, var(--gold))",
                              borderRadius: 8,
                              pointerEvents: "none",
                              zIndex: 2,
                            }}
                          />
                        )}
                        <div
                          style={{
                            position: "relative",
                            zIndex: 1,
                            width: slotW,
                            height: slotH,
                            borderRadius: 6,
                            overflow: "hidden",
                            border: `${borderWidth} solid ${borderColor}`,
                            boxSizing: "border-box",
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
                        </div>
                      </div>
                    );
                  })}
                  {/* Trailing dashed "+" slot */}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    style={{
                      width: slotW,
                      height: slotH,
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
                {heroPick && (
                  <ChipGrid heroPick={heroPick} stats={cardStats} />
                )}
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
          <div style={{ padding: "0 24px", marginTop: 32 }}>
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
              <SectionOverline label="THIS PULL" />
              <ThisPullTiles picks={picks} />
            </div>
          )}

          {/* Q112 Phase 3 — pull-history pill */}
          {picks.length > 0 && (
            <div style={{ padding: "0 24px" }}>
              <PullHistoryPill
                picks={picks}
                practice={practice}
                constellation={constellation}
              />
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
              deckId={activeDeck?.id ?? undefined}
              excludeCardIds={placedIds}
              showReversedToggle={true}
              title="Pick a card"
              onCancel={() => setPickerOpen(false)}
              onSelect={(cardIndex, isReversed, deckId, cardName) => {
                setPicks((prev) => [
                  ...prev,
                  {
                    id: Date.now() + prev.length,
                    cardIndex,
                    isReversed,
                    deckId: deckId ?? null,
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
};

function Chip({ label, value, fullWidth }: ChipProps) {
  return (
    <div
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
      }}
    >
      <span
        style={{
          fontSize: 9,
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
}: {
  heroPick: ManualPick;
  stats: QuickLogCardStats | null;
}) {
  const meta = getCardMeta(heroPick.cardIndex);

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

  // NUMEROLOGY
  let numerology = "—";
  if (meta?.root != null && meta.cardNumber != null) {
    numerology = `${meta.cardNumber} → ${meta.root}`;
    if (stats?.seekerTopRoot != null && stats.seekerTopRoot === meta.root) {
      numerology += " · top root";
    }
  }

  // ASTROLOGY
  let astrology = "—";
  if (meta?.planetOrSign) {
    astrology = `${meta.planetOrSign}-ruled`;
    if (stats && stats.astrologyMatchCount > 0) {
      astrology += ` · ${stats.astrologyMatchCount} cards`;
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
      <div style={{ display: "flex", gap: 10 }}>
        <Chip label="LAST SEEN" value={lastSeen} />
        <Chip label="TIME PATTERN" value={timePattern} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Chip label="NUMEROLOGY" value={numerology} />
        <Chip label="ASTROLOGY" value={astrology} />
      </div>
      <Chip label="REVERSED" value={reversed} fullWidth />
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
  const companions = stats?.companions ?? [];
  const selected = companions[selectedIdx] ?? companions[0] ?? null;

  const journalRows = useMemo(() => {
    if (!stats || !selected) return [];
    return stats.journal
      .filter((r) => r.cardIds.includes(selected.cardId))
      .slice(0, 5);
  }, [stats, selected]);

  const showEmptyPlaceholder = !heroPick || companions.length === 0;

  const pullSet = useMemo(() => new Set(pullCardIds), [pullCardIds]);
  const constellationActive = constellation.active;
  const participatingIds = constellation.participatingCardIds;
  const participatingNames = participatingIds.map((id) => getCardName(id));
  const wordFor = (n: number) =>
    n === 3 ? "THREE" : n === 4 ? "FOUR" : n === 5 ? "FIVE" : String(n);

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
            <div style={{ width: 80, height: 128, opacity: 0.35 }}>
              <CardImage variant="back" size="custom" widthPx={80} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12 }}>
            {companions.map((c, idx) => {
              const isSelected = idx === selectedIdx;
              const isInPull = pullSet.has(c.cardId);
              const showGoldRing = constellationActive && isInPull;
              return (
                <button
                  key={c.cardId}
                  type="button"
                  onClick={() => onSelect(idx)}
                  style={{
                    position: "relative",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
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
                      height: 128,
                      borderRadius: 5,
                      overflow: "hidden",
                      position: "relative",
                      border: showGoldRing
                        ? "2.5px solid var(--accent, var(--gold))"
                        : isSelected
                          ? "1.5px solid var(--accent, var(--gold))"
                          : "1px solid var(--border-subtle)",
                      boxSizing: "border-box",
                    }}
                  >
                    <CardImage
                      variant="face"
                      cardId={c.cardId}
                      size="custom"
                      widthPx={80}
                    />
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

      {constellationActive ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 10,
              letterSpacing: "0.3em",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              color: "var(--accent, var(--gold))",
              opacity: 0.85,
              margin: "0 0 6px 0",
              textTransform: "uppercase",
            }}
          >
            A CONSTELLATION — WHEN THESE {wordFor(participatingIds.length)} MET BEFORE
          </p>
          <p
            style={{
              fontSize: 11,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              color: "var(--color-foreground-muted, var(--color-foreground))",
              margin: "0 0 12px 0",
              opacity: 0.8,
            }}
          >
            {participatingNames.join(" · ")}
          </p>
          {constellation.matchingReadings.length === 0 ? (
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
              —
            </p>
          ) : (
            <div>
              {constellation.matchingReadings.map((r) => {
                const thumbs = participatingIds.slice(0, 3);
                const more = participatingIds.length - thumbs.length;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenReading(r.id)}
                    style={{
                      width: "100%",
                      height: 60,
                      borderRadius: 6,
                      border: "1px solid var(--accent, var(--gold))",
                      background: "var(--surface-card)",
                      padding: "8px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      marginBottom: 8,
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
                          <CardImage
                            variant="face"
                            cardId={cid}
                            size="custom"
                            widthPx={28}
                          />
                        </div>
                      ))}
                      {more > 0 && (
                        <span
                          style={{
                            alignSelf: "center",
                            fontSize: 10,
                            fontStyle: "italic",
                            fontFamily: "var(--font-serif)",
                            color:
                              "var(--color-foreground-muted, var(--color-foreground))",
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
                          color:
                            "var(--color-foreground-muted, var(--color-foreground))",
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
                    <span
                      style={{ color: "var(--accent, var(--gold))", fontSize: 11 }}
                    >
                      ›
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : heroPick && selected ? (
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
            {getCardName(heroPick.cardIndex)} + {getCardName(selected.cardId)}
          </p>
          {journalRows.length === 0 ? (
            <p
              style={{
                fontSize: 11,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color:
                  "var(--color-foreground-muted, var(--color-foreground))",
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
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenReading(r.id)}
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
                      cursor: "pointer",
                      marginBottom: 4,
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
                      {format(new Date(r.createdAt), "MMM d")} —{" "}
                      {label || "(no question)"}
                    </span>
                    <span
                      style={{
                        color: "var(--accent, var(--gold))",
                        fontSize: 10,
                      }}
                    >
                      ›
                    </span>
                  </button>
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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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

function bucketOpacity(matches: number): number {
  if (matches <= 0) return 0;
  if (matches === 1) return 0.25;
  if (matches === 2) return 0.5;
  if (matches === 3) return 0.75;
  return 1;
}

function OverlapStrip({
  overlap,
  heroCardId,
  pullCardIds,
  mode,
  onModeChange,
}: {
  overlap: QuickLogOverlap | null;
  heroCardId: number | null;
  pullCardIds: number[];
  mode: "pull" | "day";
  onModeChange: (m: "pull" | "day") => void;
}) {
  const months = overlap?.months ?? [];
  const pullSet = useMemo(() => new Set(pullCardIds), [pullCardIds]);
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 30,
          alignItems: "flex-start",
          position: "relative",
          overflowX: "auto",
        }}
      >
        {months.length === 0 &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ width: 160 }}>
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
                style={{
                  width: 160,
                  height: 90,
                  background: "var(--surface-card)",
                  borderRadius: 6,
                }}
              />
            </div>
          ))}
        {months.map((m) => {
          const isCurrent = `${m.year}-${m.month}` === currentMonthKey;
          const firstDow = new Date(m.year, m.month - 1, 1).getDay();
          return (
            <div key={`${m.year}-${m.month}`} style={{ width: 160, flexShrink: 0 }}>
              <p
                style={{
                  margin: "0 0 6px 0",
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
                style={{
                  width: 160,
                  height: 90,
                  background: "var(--surface-card)",
                  borderRadius: 6,
                  padding: 6,
                  boxSizing: "border-box",
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 16px)",
                  gridAutoRows: "15px",
                  gap: 6,
                  justifyContent: "center",
                  alignContent: "start",
                }}
              >
                {Array.from({ length: firstDow }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {m.days.map((day) => {
                  let bg = "var(--border-subtle)";
                  let opacity = 0.35;
                  if (day.heroDrawn && heroCardId != null) {
                    bg = "var(--gold, var(--accent))";
                    opacity = 0.9;
                  } else if (pullSet.size > 0) {
                    let matches = 0;
                    if (mode === "day") {
                      for (const id of day.sameDayCardIds)
                        if (pullSet.has(id)) matches++;
                    } else {
                      const readings = overlap?.readingsByDate?.[day.date] ?? [];
                      let best = 0;
                      for (const r of readings) {
                        let n = 0;
                        for (const id of r.cardIds) if (pullSet.has(id)) n++;
                        if (n > best) best = n;
                      }
                      matches = best;
                    }
                    const op = bucketOpacity(matches);
                    if (op > 0) {
                      bg =
                        "color-mix(in oklab, var(--accent, var(--gold)) 80%, var(--color-foreground) 20%)";
                      opacity = op;
                    }
                  }
                  return (
                    <div
                      key={day.date}
                      title={day.date}
                      style={{
                        width: 16,
                        height: 15,
                        borderRadius: 2,
                        background: bg,
                        opacity,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -110 }}>
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
                same {m}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ height: 88 }} />
    </div>
  );
}

function Tile({
  label,
  value,
  subline,
}: {
  label: string;
  value: string;
  subline: string;
}) {
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
    const names = (rootCounts.get(dominantRoot) ?? []).map((p) =>
      getCardName(p.cardIndex),
    );
    numerologySub =
      names.length > 3 ? `${names.slice(0, 3).join(", ")}…` : names.join(", ");
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
  const reversedPct =
    picks.length > 0 ? Math.round((reversedN / picks.length) * 100) : 0;
  const astrologyValue = `${dominant ?? "—"}-dom · ${reversedPct}% rev`;
  const elCounts: Record<string, number> = {
    Fire: 0, Water: 0, Air: 0, Earth: 0,
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
      <Tile
        label="ASTROLOGY · REVERSED"
        value={astrologyValue}
        subline={elParts.join(" · ")}
      />
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
    () => picks.map((p) => p.cardIndex).sort((a, b) => a - b).join(","),
    [picks],
  );
  const entry = practice?.pullHistory?.find((p) => p.cardIdsKey === key) ?? null;
  let text = "First time you've drawn this combination — never before.";
  if (entry) {
    const when = format(new Date(entry.lastAt), "MMMM d, yyyy");
    if (entry.count === 1) {
      text = `You drew this exact combination once before, on ${when}.`;
    } else if (entry.count <= 5) {
      text = `You drew this exact combination ${entry.count} times before — last on ${when}.`;
    } else {
      text = `You've drawn this exact combination ${entry.count} times — most recently ${when}.`;
    }
  }
  if (constellation.active) {
    const N = constellation.participatingCardIds.length;
    const M = constellation.matchCountSixMonths;
    if (M === 1) {
      text = `A constellation. ${N} of these cards have met before — once in the last 6 months.`;
    } else {
      text = `A constellation. ${N} of these cards have met before — ${M} times in the last 6 months.`;
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

function PracticeStat({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
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
      {label}{" "}
      <span style={{ color: "var(--accent, var(--gold))" }}>{display}</span>
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
      <PracticeStat
        label="this lunation"
        value={practice?.currentLunationReadings ?? null}
      />
      {sep}
      <PracticeStat label="total" value={practice?.totalReadings ?? null} />
      {sep}
      <PracticeStat label="top stalker" value={stalkerLabel} />
      {sep}
      <PracticeStat
        label="reversed"
        value={practice ? `${practice.reversedPct}%` : null}
      />
      {sep}
      <PracticeStat label="top suit" value={practice?.topSuit?.suit ?? null} />
    </div>
  );
}
