/**
 * EK41 — InsightsCardConstellation
 *
 * Embeds the constellation surface from Manual Entry into the
 * Insights → Cards detail page. Pared down per spec:
 *   - Hero is FIXED by the page (the card the seeker is viewing).
 *     The constellation cannot be swapped from inside this embed —
 *     no slot row, no manual entry building, no save-to-journal.
 *   - Just the constellation web at top + the 12-month calendar
 *     (2 rows × 6 months) below.
 *   - Teal selection ON: click any companion to toggle it into the
 *     teal set. With 2+ teal cards: teal badge + teal calendar
 *     strokes + asterism breathing (3+ teal cards co-occurred in
 *     past pulls).
 *   - Filter controls (same-pull / same-day pill, calendar visibility)
 *     live behind a left-side hamburger PageMenuTrigger that flies in.
 *   - Hero badge → readings modal scoped to all pulls containing the
 *     hero. Teal badge → readings modal scoped to the teal selection.
 *     Day-cell click → readings modal scoped to that day.
 *
 * Reuses the canonical pieces:
 *   - <ConstellationWeb> — the SVG renderer with all hover/badge
 *     logic.
 *   - <OverlapStrip layout="grid12"> — the 12-month calendar.
 *   - useEcho — asterism detection (3+ cards have appeared together).
 *   - ReadingDetailModal — opening a single reading.
 *
 * Loads data via the same server fns ConstellationPage uses:
 *   - getCardConstellation: companions + co-occurrence
 *   - getQuickLogOverlap: 12-month calendar + reading days
 */
import { useEffect, useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import { ConstellationWeb } from "@/components/constellation/ConstellationWeb";
import { OverlapStrip } from "@/components/tabletop/QuickLog";
import {
  getCardConstellation,
  getQuickLogOverlap,
  type CardConstellation,
  type QuickLogOverlap,
  type ConstellationFilterOpts,
} from "@/lib/quicklog.functions";
import { useEcho } from "@/lib/use-echo";
import { getCardName } from "@/lib/tarot";
import { useActiveDeckCardName } from "@/lib/active-deck";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { Modal } from "@/components/ui/modal";
import { formatDateLong } from "@/lib/dates";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

type Props = {
  /** The cardId of the page's focus card. Anchors the constellation. */
  heroCardId: number;
  /** Display name for the hero — already resolved by the parent route. */
  heroCardName: string;
  /** Effective IANA timezone for date bucketing on the calendar. */
  tz: string;
  /** Page-level filters (time range + tags + spreadTypes + etc.).
   *  Optional — when omitted, the constellation queries unfiltered. */
  filters?: ConstellationFilterOpts;
};

export function InsightsCardConstellation({
  heroCardId,
  heroCardName,
  tz,
  filters,
}: Props) {
  // Use the active deck's card name resolver so oracle decks (78+
  // ids) get their seeker-supplied names rather than the default
  // tarot fallback.
  const resolveCardName = useActiveDeckCardName();

  const filterPayload = filters ?? {};
  const filterKey = useMemo(() => JSON.stringify(filterPayload), [filterPayload]);

  // ── 1. Load constellation (companions + co-occurrence pairs) ────
  const [constellation, setConstellation] = useState<CardConstellation | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getCardConstellation({
      data: { heroCardId, tz, filters: filterPayload },
    })
      .then((d) => {
        if (!cancelled) setConstellation(d);
      })
      .catch(() => {
        if (!cancelled) setConstellation(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroCardId, tz, filterKey]);

  // ── 2. Load overlap (12-month calendar) ─────────────────────────
  const [overlap, setOverlap] = useState<QuickLogOverlap | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getQuickLogOverlap({
      data: { heroCardId, tz, filters: filterPayload },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroCardId, tz, filterKey]);

  // ── 3. Teal selection state ─────────────────────────────────────
  // Click any constellation card to toggle into the teal set. Hero
  // can be clicked too — it joins the set just like a companion.
  const [tealSelectedIds, setTealSelectedIds] = useState<number[]>([]);
  const toggleTeal = (cardId: number) => {
    setTealSelectedIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    );
  };

  // Reset teal selection when the hero changes — the new hero re-
  // derives the constellation and the old teal set wouldn't map
  // cleanly to it.
  useEffect(() => {
    setTealSelectedIds([]);
  }, [heroCardId]);

  // ── 4. Filter-stack controls (live in the side panel) ───────────
  const [mode, setMode] = useState<"pull" | "day">("pull");
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [calendarState, setCalendarState] = useState<"none" | "recent" | "both">(
    "both",
  );
  const cycleCalendar = () => {
    setCalendarState((s) =>
      s === "none" ? "recent" : s === "recent" ? "both" : "none",
    );
  };

  // ── 5. Asterism / Echo detection (3+ teal cards have met before) ─
  // useEcho expects a ManualPick[] shape — synthesize from the teal
  // selection for compatibility with the existing detection logic.
  const tealAsPicks: ManualPick[] = useMemo(
    () =>
      tealSelectedIds.map((cardId, i) => ({
        id: i,
        cardIndex: cardId,
        isReversed: false,
        deckId: null,
        cardName: resolveCardName(cardId) || getCardName(cardId) || "",
      })),
    [tealSelectedIds, resolveCardName],
  );
  const echo = useEcho(tealAsPicks, overlap, mode);

  // ── 6. Hero draw count for the gold badge ──────────────────────
  // Number of PULLS in the filtered universe containing the hero.
  const heroPullCount = useMemo(() => {
    if (!overlap) return 0;
    let n = 0;
    for (const readings of Object.values(overlap.readingsByDate ?? {})) {
      for (const r of readings) {
        if (r.cardIds.includes(heroCardId)) n += 1;
      }
    }
    return n;
  }, [overlap, heroCardId]);

  // ── 7. Discovery-hint candidates (teal mode 2+ cards) ──────────
  // For each constellation card NOT already in the teal set: would
  // adding it still leave at least one matching pull/day? If yes,
  // mark it a candidate so ConstellationWeb draws a teal hint line.
  const candidateIds = useMemo(() => {
    if (tealSelectedIds.length < 2 || !overlap) return [] as number[];
    const constellationCardIds = new Set<number>([
      heroCardId,
      ...(constellation?.companions?.map((c) => c.cardId) ?? []),
    ]);
    const out: number[] = [];
    for (const candidate of constellationCardIds) {
      if (tealSelectedIds.includes(candidate)) continue;
      const trial = [...tealSelectedIds, candidate];
      // Does any pull or day match all of trial?
      let matches = false;
      const entries = Object.entries(overlap.readingsByDate ?? {});
      if (mode === "pull") {
        outer: for (const [, readings] of entries) {
          for (const r of readings) {
            if (trial.every((id) => r.cardIds.includes(id))) {
              matches = true;
              break outer;
            }
          }
        }
      } else {
        outer: for (const [, readings] of entries) {
          const dayCards = new Set<number>();
          for (const r of readings) r.cardIds.forEach((id) => dayCards.add(id));
          if (trial.every((id) => dayCards.has(id))) {
            matches = true;
            break outer;
          }
        }
      }
      if (matches) out.push(candidate);
    }
    return out;
  }, [tealSelectedIds, overlap, constellation, heroCardId, mode]);

  // ── 8. Readings modal state ────────────────────────────────────
  type ModalState =
    | { kind: "none" }
    | { kind: "hero" }
    | { kind: "teal" }
    | { kind: "day"; date: string; readingIds: string[] };
  const [readingsModal, setReadingsModal] = useState<ModalState>({ kind: "none" });
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  // Aggregate the matching readings for the modal title and rows.
  const modalReadings = useMemo(() => {
    if (readingsModal.kind === "none") return [];
    if (readingsModal.kind === "hero") {
      if (!overlap) return [];
      const out: Array<{ id: string; createdAt: string; question: string | null; cardIds: number[] }> = [];
      for (const [, readings] of Object.entries(overlap.readingsByDate ?? {})) {
        for (const r of readings) {
          if (r.cardIds.includes(heroCardId)) out.push(r);
        }
      }
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return out;
    }
    if (readingsModal.kind === "teal") {
      if (!overlap || tealSelectedIds.length === 0) return [];
      const out: Array<{ id: string; createdAt: string; question: string | null; cardIds: number[] }> = [];
      if (mode === "pull") {
        for (const [, readings] of Object.entries(overlap.readingsByDate ?? {})) {
          for (const r of readings) {
            if (tealSelectedIds.every((id) => r.cardIds.includes(id))) out.push(r);
          }
        }
      } else {
        for (const [, readings] of Object.entries(overlap.readingsByDate ?? {})) {
          const dayCards = new Set<number>();
          for (const r of readings) r.cardIds.forEach((id) => dayCards.add(id));
          if (tealSelectedIds.every((id) => dayCards.has(id))) {
            // For same-day mode include every pull on that day.
            for (const r of readings) out.push(r);
          }
        }
      }
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return out;
    }
    if (readingsModal.kind === "day") {
      if (!overlap) return [];
      const dayReadings = overlap.readingsByDate?.[readingsModal.date] ?? [];
      return [...dayReadings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return [];
  }, [readingsModal, overlap, heroCardId, tealSelectedIds, mode]);

  // ── 9. Hero pick synthesis for ConstellationWeb ────────────────
  const heroPick: ManualPick = useMemo(
    () => ({
      id: 0,
      cardIndex: heroCardId,
      isReversed: false,
      deckId: null,
      cardName: heroCardName,
    }),
    [heroCardId, heroCardName],
  );

  // ── 10. Badge tooltip text (unit-aware) ────────────────────────
  const heroBadgeTooltip = `${heroPullCount} PULL${heroPullCount === 1 ? "" : "S"} · ${heroCardName}`;
  const tealBadge = useMemo(() => {
    if (tealSelectedIds.length < 2) return null;
    const firstId = tealSelectedIds[0];
    let count = 0;
    if (overlap) {
      if (mode === "pull") {
        for (const [, readings] of Object.entries(overlap.readingsByDate ?? {})) {
          for (const r of readings) {
            if (tealSelectedIds.every((id) => r.cardIds.includes(id))) count += 1;
          }
        }
      } else {
        for (const [, readings] of Object.entries(overlap.readingsByDate ?? {})) {
          const dayCards = new Set<number>();
          for (const r of readings) r.cardIds.forEach((id) => dayCards.add(id));
          if (tealSelectedIds.every((id) => dayCards.has(id))) count += 1;
        }
      }
    }
    const unit = mode === "pull" ? "PULL" : "DAY";
    const plural = count === 1 ? "" : "S";
    const names = tealSelectedIds
      .map((id) => resolveCardName(id) || getCardName(id) || `Card ${id}`)
      .join(", ");
    return {
      cardId: firstId,
      count,
      tooltip: `${count} ${unit}${plural} · ${names}`,
    };
  }, [tealSelectedIds, overlap, mode, resolveCardName]);

  // ── 11. Asterism badge hover (intensifies trace stroke) ────────
  const [asterismBadgeHovered, setAsterismBadgeHovered] = useState(false);

  return (
    <div className="relative">
      {/* Hamburger trigger — left side, opens the side panel for
          filter controls (same-pull/same-day, calendar visibility). */}
      <button
        type="button"
        aria-label="Constellation controls"
        onClick={() => setPageMenuOpen(true)}
        className="absolute top-2 left-2 z-10 inline-flex items-center justify-center rounded-md p-2 hover:bg-white/5 transition-colors"
        style={{ color: "var(--color-foreground)", opacity: 0.7 }}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Constellation web — hero centered, top 7 companions around. */}
      <div className="mx-auto" style={{ maxWidth: 540 }}>
        <ConstellationWeb
          heroPick={heroPick}
          constellation={constellation}
          onCardClick={toggleTeal}
          tealSelectedIds={tealSelectedIds}
          candidateIds={candidateIds}
          heroDrawCount={heroPullCount}
          heroBadgeTooltip={heroBadgeTooltip}
          tealBadge={tealBadge}
          onHeroBadgeClick={() => setReadingsModal({ kind: "hero" })}
          onTealBadgeClick={() => setReadingsModal({ kind: "teal" })}
          onTealBadgeHover={() => setAsterismBadgeHovered(true)}
          onTealBadgeHoverEnd={() => setAsterismBadgeHovered(false)}
        />
      </div>

      {/* 12-month calendar — 2 rows × 6 months. Gold-fill on hero
          days, teal stroke on days where all teal cards co-occurred. */}
      {calendarState !== "none" && (
        <div className="mx-auto mt-6" style={{ maxWidth: 540 }}>
          <OverlapStrip
            overlap={overlap}
            heroCardId={heroCardId}
            pullCardIds={[]}
            mode={mode}
            onModeChange={setMode}
            tealSelectedIds={tealSelectedIds}
            layout="grid12"
            showOlder={calendarState === "both"}
            onShowOlderChange={(v) => setCalendarState(v ? "both" : "recent")}
            onDayClick={(date, readingIds) =>
              setReadingsModal({ kind: "day", date, readingIds })
            }
            asterismBadgeHovered={asterismBadgeHovered}
          />
        </div>
      )}

      {/* Asterism breathing — fires when 3+ teal cards have appeared
          together in past pulls. The seeker has uncovered a real
          asterism in their history. */}
      {echo.active && (
        <div
          className="mx-auto mt-3 text-center"
          style={{
            maxWidth: 540,
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--accent)",
            animation: "tarotseed-breathe 2.8s ease-in-out infinite",
          }}
        >
          An asterism — {echo.matchCount} pull{echo.matchCount === 1 ? "" : "s"} have brought these cards together.
        </div>
      )}

      {/* Side panel — flies in from the left when the hamburger is
          tapped. Holds the same-pull/same-day pill and the calendar
          visibility cycle. Tapping outside closes it. */}
      {pageMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.35)" }}
            onClick={() => setPageMenuOpen(false)}
          />
          <div
            className="fixed top-0 left-0 bottom-0 z-50 flex flex-col"
            style={{
              width: "min(85vw, 320px)",
              background: "var(--surface-elevated)",
              borderRight: "1px solid var(--border-subtle)",
              padding: "20px 18px",
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "var(--text-heading-sm)",
                }}
              >
                Constellation
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPageMenuOpen(false)}
                className="p-1 hover:bg-white/5 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-5">
              <div>
                <div
                  className="mb-2"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "var(--text-caption)",
                    opacity: 0.7,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Match mode
                </div>
                <div className="flex gap-4">
                  {(["pull", "day"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className="bg-transparent border-none p-0"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontStyle: "italic",
                        fontSize: "var(--text-body)",
                        color: "var(--color-foreground)",
                        opacity: mode === m ? 1 : 0.55,
                        borderBottom:
                          mode === m
                            ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                            : "1px solid transparent",
                        paddingBottom: 4,
                        cursor: "pointer",
                      }}
                    >
                      Same {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div
                  className="mb-2"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "var(--text-caption)",
                    opacity: 0.7,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Calendar
                </div>
                <button
                  type="button"
                  onClick={cycleCalendar}
                  className="bg-transparent border-none p-0 text-left"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body)",
                    color: "var(--color-foreground)",
                    cursor: "pointer",
                  }}
                >
                  {calendarState === "none"
                    ? "Hidden"
                    : calendarState === "recent"
                      ? "1 row"
                      : "2 rows"}
                </button>
                <div
                  className="mt-1"
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-caption)",
                    opacity: 0.6,
                  }}
                >
                  Tap to cycle visibility.
                </div>
              </div>

              {tealSelectedIds.length > 0 && (
                <div>
                  <div
                    className="mb-2"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption)",
                      opacity: 0.7,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Teal selection ({tealSelectedIds.length})
                  </div>
                  <button
                    type="button"
                    onClick={() => setTealSelectedIds([])}
                    className="bg-transparent border-none p-0 underline italic"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: "var(--text-body-sm)",
                      color: "var(--color-foreground)",
                      opacity: 0.85,
                      cursor: "pointer",
                    }}
                  >
                    Clear selection
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Readings modal — opens on hero badge click, teal badge
          click, or day-cell click. Lists matching readings; tap one
          to open the full reading detail. */}
      {readingsModal.kind !== "none" && (
        <Modal open onClose={() => setReadingsModal({ kind: "none" })}>
          <div style={{ padding: 20, minWidth: 320, maxWidth: 520 }}>
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-md)",
                marginBottom: 4,
              }}
            >
              {readingsModal.kind === "hero" &&
                `${modalReadings.length} pull${modalReadings.length === 1 ? "" : "s"} with ${heroCardName}`}
              {readingsModal.kind === "teal" &&
                `${modalReadings.length} ${mode === "pull" ? "pull" : "day"}${modalReadings.length === 1 ? "" : "s"} with ${tealSelectedIds
                  .map((id) => resolveCardName(id) || getCardName(id) || `Card ${id}`)
                  .join(", ")}`}
              {readingsModal.kind === "day" &&
                `${modalReadings.length} reading${modalReadings.length === 1 ? "" : "s"} on this day`}
            </h3>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: 420,
                overflowY: "auto",
              }}
            >
              {modalReadings.length === 0 && (
                <p style={{ fontStyle: "italic", opacity: 0.6 }}>
                  No matching readings.
                </p>
              )}
              {modalReadings.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setOpenReadingId(r.id);
                    setReadingsModal({ kind: "none" });
                  }}
                  className="bg-transparent border-0 text-left p-3 rounded hover:bg-white/5 transition-colors"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body)",
                      color: "var(--color-foreground)",
                      marginBottom: 2,
                    }}
                  >
                    {r.question || "(no question)"}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-caption)",
                      opacity: 0.6,
                      fontFamily: "var(--font-serif)",
                    }}
                  >
                    {formatDateLong(r.createdAt)} ·{" "}
                    {r.cardIds
                      .slice(0, 3)
                      .map((id) => resolveCardName(id) || getCardName(id))
                      .filter(Boolean)
                      .join(", ")}
                    {r.cardIds.length > 3 ? `, +${r.cardIds.length - 3} more` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {openReadingId && (
        <ReadingDetailModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
    </div>
  );
}
