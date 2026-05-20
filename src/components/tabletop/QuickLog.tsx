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
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap,
                    }}
                  >
                  {picks.map((pick, idx) => {
                    const isLatest = idx === picks.length - 1;
                    return (
                      <div
                        key={pick.id}
                        style={{
                          width: slotW,
                          height: slotH,
                          borderRadius: 6,
                          overflow: "hidden",
                          border: isLatest
                            ? "1.5px solid var(--accent, var(--gold))"
                            : "1px solid var(--border-subtle)",
                          boxSizing: "border-box",
                          flexShrink: 0,
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
                    );
                  })}
                  {/* Trailing dashed "+" slot */}
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.querySelector<HTMLInputElement>(
                        'input[placeholder^="Type or paste"]',
                      );
                      el?.focus();
                    }}
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
              <PullHistoryPill picks={picks} practice={practice} />
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
  onOpenReading,
}: {
  heroPick: ManualPick | null;
  stats: QuickLogCardStats | null;
  selectedIdx: number;
  onSelect: (i: number) => void;
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
                  <div
                    style={{
                      width: 80,
                      height: 128,
                      borderRadius: 5,
                      overflow: "hidden",
                      position: "relative",
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

      {heroPick && selected && (
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
      )}
    </div>
  );
}
