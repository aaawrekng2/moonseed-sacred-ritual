/**
 * EK41 / EK42 — InsightsCardConstellation
 *
 * Embeds the constellation surface from Manual Entry into the
 * Insights → Cards detail page. Pared down per spec — no slot row,
 * no question/notes, no save-to-journal, no right-side data card.
 *
 * EK42 changes:
 *   - All page-level state (mode, calendar visibility, teal
 *     selection) is now CONTROLLED via props. The route owns it so
 *     the page-level PageMenu can drive these controls (mirroring
 *     Manual Entry's structure where controls live in the chrome,
 *     not inside the embed).
 *   - Removed the embed-local hamburger button + side panel. The
 *     PageMenuTrigger in the route handles this now.
 *   - Drag-to-hero: drag any companion onto the hero spot and the
 *     parent navigates to that card's detail page via onSwapHero.
 *   - Double-click-to-hero: double-clicking any companion also
 *     invokes onSwapHero.
 *   - Wider container: the embed inside fills its parent (the route
 *     widens to 1100px); the constellation SVG itself stays 540
 *     centered with breathing room; the calendar fills the wider
 *     container so day cells render larger.
 *   - Calendar hover rich popover: hovering any cell with at least
 *     one pull shows a positioned panel listing each pull on that
 *     day with question + cards + tags. Closes on cursor leave.
 *
 * Reuses canonical:
 *   - <ConstellationWeb> — SVG renderer with hover/badge/drag.
 *   - <OverlapStrip layout="grid12"> — 12-month calendar.
 *   - useEcho — asterism detection (3+ cards have appeared together).
 *   - ReadingDetailModal — opening a single reading.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
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
import { TAROT_DECK } from "@/lib/tarot";
import { useAnyDeckCardName } from "@/lib/active-deck";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { Modal } from "@/components/ui/modal";
import { formatDateLong } from "@/lib/dates";
import { parseIsoDay } from "@/lib/time";
import { useCardViewMode } from "@/lib/use-card-view-mode";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

/**
 * EK43 — Safe card-name resolver. NEVER returns the literal "Card N"
 * string (that fallback is banned from user-facing UI per the styling
 * doc). Resolution chain:
 *   1. Active deck name override (handles oracle/custom decks with
 *      seeker-supplied names for ids 78+).
 *   2. Any other custom deck the user owns.
 *   3. Canonical tarot 0..77 name.
 *   4. Empty string — caller decides whether to display or skip.
 */
function safeCardNameWith(resolver: (id: number) => string) {
  return (cardId: number): string => {
    const resolved = resolver(cardId);
    if (resolved && !/^Card\s+\d+$/.test(resolved)) return resolved;
    if (cardId >= 0 && cardId <= 77) {
      const name = TAROT_DECK[cardId];
      if (name && !/^Card\s+\d+$/.test(name)) return name;
    }
    return "";
  };
}

type Props = {
  /** The cardId of the page's focus card. Anchors the constellation. */
  heroCardId: number;
  /** Display name for the hero — already resolved by the parent route. */
  heroCardName: string;
  /** Effective IANA timezone for date bucketing on the calendar. */
  tz: string;
  /** Page-level filters (time range + tags + spreadTypes + etc.). */
  filters?: ConstellationFilterOpts;
  /** Same-pull vs same-day match mode (controlled by parent). */
  mode: "pull" | "day";
  onModeChange: (m: "pull" | "day") => void;
  /** Calendar visibility cycle (controlled by parent). */
  calendarState: "none" | "recent" | "both";
  onCalendarStateChange: (s: "none" | "recent" | "both") => void;
  /** Teal selection set (controlled by parent). */
  tealSelectedIds: number[];
  onTealSelectedIdsChange: (ids: number[]) => void;
  /** EK42 — Drag a companion to the hero spot OR double-click it
   *  to navigate to that card's detail page. Parent handles the
   *  actual route change. */
  onSwapHero: (newHeroCardId: number) => void;
};

export function InsightsCardConstellation({
  heroCardId,
  heroCardName,
  tz,
  filters,
  mode,
  onModeChange,
  calendarState,
  onCalendarStateChange,
  tealSelectedIds,
  onTealSelectedIdsChange,
  onSwapHero,
}: Props) {
  const rawResolveCardName = useAnyDeckCardName();
  const resolveCardName = useMemo(
    () => safeCardNameWith(rawResolveCardName),
    [rawResolveCardName],
  );
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

  // ── 3. Teal selection toggling ──────────────────────────────────
  // Single-click toggles. Double-click navigates (handled below via
  // a tracked-last-click timer). Drag-to-hero handled by the SVG
  // drag handlers.
  const lastClickRef = useRef<{ cardId: number; ts: number } | null>(null);
  const handleCardClick = (cardId: number) => {
    // EK42 — Double-click detection: if the same card was clicked
    // within 300ms, treat the second click as a navigate intent.
    // Otherwise it's a regular teal toggle.
    const now = Date.now();
    const prev = lastClickRef.current;
    if (prev && prev.cardId === cardId && now - prev.ts < 300) {
      lastClickRef.current = null;
      if (cardId !== heroCardId) {
        onSwapHero(cardId);
      }
      return;
    }
    lastClickRef.current = { cardId, ts: now };
    // Single-click toggle (delayed slightly via the click tracker;
    // the toggle fires immediately, the navigate only fires if a
    // second click follows within 300ms).
    const next = tealSelectedIds.includes(cardId)
      ? tealSelectedIds.filter((id) => id !== cardId)
      : [...tealSelectedIds, cardId];
    onTealSelectedIdsChange(next);
  };

  // ── 4. Drag-to-hero ─────────────────────────────────────────────
  // ConstellationWeb fires onCardDragStart with the dragged card's
  // id. We track which card is currently being dragged. When the
  // hero spot is the drop target (= heroCardId), we treat the drop
  // as a hero-swap navigation.
  const [draggedCardId, setDraggedCardId] = useState<number | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<number | null>(null);
  const handleCardDragStart = (cardId: number) => {
    setDraggedCardId(cardId);
  };
  const handleConstellationDragOver = (targetCardId: number | null) => {
    setDragOverTargetId(targetCardId);
  };
  const handleConstellationDrop = (targetCardId: number, droppedCardId: number) => {
    setDraggedCardId(null);
    setDragOverTargetId(null);
    // Only the hero spot accepts hero-swap drops. Drops on other
    // companions are no-ops here (no swap-companions semantics on
    // the read-only Insights surface).
    if (targetCardId === heroCardId && droppedCardId !== heroCardId) {
      onSwapHero(droppedCardId);
    }
  };

  // Reset drag state on hero change too, for safety.
  useEffect(() => {
    setDraggedCardId(null);
    setDragOverTargetId(null);
  }, [heroCardId]);

  // ── 5. Asterism / Echo detection (3+ teal cards have met before) ─
  const tealAsPicks: ManualPick[] = useMemo(
    () =>
      tealSelectedIds.map((cardId, i) => ({
        id: i,
        cardIndex: cardId,
        isReversed: false,
        deckId: null,
        cardName: resolveCardName(cardId),
      })),
    [tealSelectedIds, resolveCardName],
  );
  const echo = useEcho(tealAsPicks, overlap, mode);

  // ── 6. Hero draw count for the gold badge ──────────────────────
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

  // ── 6b. EK47 — Hero longest-streak (for the badge in Streak mode)
  //
  // Mirrors the server-side `getCardFrequency` computation but runs
  // client-side on the already-loaded overlap.readingsByDate. For
  // every YYYY-MM-DD where the hero card appears, count the longest
  // run of consecutive 1-day-apart dates. Empty set → 0.
  const [viewMode] = useCardViewMode();
  const heroStreak = useMemo(() => {
    if (!overlap) return 0;
    const days: string[] = [];
    for (const [date, readings] of Object.entries(
      overlap.readingsByDate ?? {},
    )) {
      if (readings.some((r) => r.cardIds.includes(heroCardId))) {
        days.push(date);
      }
    }
    if (days.length === 0) return 0;
    days.sort();
    let cur = 1;
    let best = 1;
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1]}T00:00:00Z`);
      const next = new Date(`${days[i]}T00:00:00Z`);
      const diff = Math.round(
        (next.getTime() - prev.getTime()) / 86_400_000,
      );
      if (diff === 1) {
        cur += 1;
        if (cur > best) best = cur;
      } else {
        cur = 1;
      }
    }
    return best;
  }, [overlap, heroCardId]);

  // ── 7. Discovery-hint candidates (teal mode 2+ cards) ──────────
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
  // EK47 — In Streak mode, the hero badge displays the longest
  // consecutive-day streak instead of total pulls. Badge is hidden
  // entirely when the streak is below 3 (passing null to
  // ConstellationWeb's `heroDrawCount` skips the badge render).
  // Count mode is unchanged.
  const heroBadgeValue: number | null =
    viewMode === "streak"
      ? heroStreak >= 3
        ? heroStreak
        : null
      : heroPullCount;
  const heroBadgeTooltip =
    viewMode === "streak"
      ? `${heroStreak}-DAY STREAK · ${heroCardName}`
      : `${heroPullCount} PULL${heroPullCount === 1 ? "" : "S"} · ${heroCardName}`;
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
      .map((id) => resolveCardName(id))
      .filter(Boolean)
      .join(", ");
    return {
      cardId: firstId,
      count,
      tooltip: `${count} ${unit}${plural} · ${names}`,
    };
  }, [tealSelectedIds, overlap, mode, resolveCardName]);

  // ── 11. Asterism badge hover (intensifies trace stroke) ────────
  const [asterismBadgeHovered, setAsterismBadgeHovered] = useState(false);

  // ── 11b. EK44 — Hovered constellation card (drives calendar
  //   preview of "what if this card joined the asterism").
  //   When a card is hovered, augment the teal set with it so
  //   OverlapStrip's existing teal-stroke logic previews the days
  //   where the would-be asterism co-occurred. With 0 teal +
  //   hover = 1 effective card = no stroke (below 2+ threshold).
  //   With 1+ teal + hover = 2+ effective = preview stroke. The
  //   hero's own gold-fill remains untouched.
  const [hoverCardId, setHoverCardId] = useState<number | null>(null);
  const effectiveTealIds = useMemo(() => {
    if (hoverCardId == null) return tealSelectedIds;
    if (tealSelectedIds.includes(hoverCardId)) return tealSelectedIds;
    return [...tealSelectedIds, hoverCardId];
  }, [hoverCardId, tealSelectedIds]);

  // ── 12. Calendar hover rich popover ────────────────────────────
  // EK42 — When the cursor enters a calendar cell with at least one
  // reading, OverlapStrip fires onDayHover with the cell's date,
  // anchor coords, target rect, and a basic tooltipText. We render a
  // richer panel listing every pull on that day with question +
  // cards + tags. Positioned above the cell when there's room,
  // below it otherwise.
  type DayHoverState = {
    date: string;
    anchorX: number;
    anchorY: number;
    targetRect: DOMRect | null;
  };
  const [dayHover, setDayHover] = useState<DayHoverState | null>(null);

  // ── 13. Day-hover popover render ──────────────────────────────
  const dayPopover = (() => {
    if (!dayHover || !overlap) return null;
    const readings = overlap.readingsByDate?.[dayHover.date] ?? [];
    if (readings.length === 0) return null;

    // Position the popover above the cell with an 8px gap when
    // possible; flip below if there isn't room above.
    const rect = dayHover.targetRect;
    const POPOVER_WIDTH = 360;
    const POPOVER_GAP = 8;
    let top = dayHover.anchorY - 8;
    let left = dayHover.anchorX;
    let placement: "above" | "below" = "above";
    if (rect) {
      const aboveSpace = rect.top;
      const belowSpace = window.innerHeight - rect.bottom;
      placement = aboveSpace >= 240 || aboveSpace >= belowSpace ? "above" : "below";
      left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));
      top = placement === "above" ? rect.top - POPOVER_GAP : rect.bottom + POPOVER_GAP;
    }

    // Gather all tags across the day's readings, deduped.
    type ReadingFull = {
      id: string;
      createdAt: string;
      question: string | null;
      cardIds: number[];
      tags?: string[];
    };
    // EK43/EK44 — Filter the day's pulls based on which signal
    // the hover is responding to:
    //   - If this day has a teal stroke (2+ teal selected AND
    //     all teal cards co-occur here), show the pulls that
    //     contain all the teal cards (the asterism's pulls).
    //   - Otherwise, show the pulls that contain the hero card
    //     (the hero-day pulls).
    // Unrelated readings on the same date are excluded either way.
    const allReadings = readings as ReadingFull[];
    const isTealDay =
      tealSelectedIds.length >= 2 &&
      allReadings.some((r) =>
        tealSelectedIds.every((id) => r.cardIds.includes(id)),
      );
    const dayReadings = isTealDay
      ? allReadings.filter((r) =>
          tealSelectedIds.every((id) => r.cardIds.includes(id)),
        )
      : allReadings.filter((r) => r.cardIds.includes(heroCardId));
    if (dayReadings.length === 0) return null;
    const allTags = Array.from(
      new Set(dayReadings.flatMap((r) => r.tags ?? [])),
    );

    const popover = (
      <div
        style={{
          position: "fixed",
          top,
          left,
          width: POPOVER_WIDTH,
          maxHeight: 360,
          overflowY: "auto",
          zIndex: 300,
          background: "var(--surface-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 10,
          padding: "12px 14px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          transform:
            placement === "above" ? "translateY(-100%)" : "translateY(0%)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            marginBottom: 6,
            opacity: 0.85,
          }}
        >
          {/* EK44 — parseIsoDay(tz) parses the YYYY-MM-DD string
              as midnight in the seeker's timezone. Without this,
              formatDateLong interprets the string as UTC midnight,
              which on negative-offset zones (e.g. America/Los_Angeles)
              renders the previous calendar day. */}
          {formatDateLong(parseIsoDay(dayHover.date, tz).toISOString())}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {dayReadings.slice(0, 5).map((r) => (
            <div
              key={r.id}
              style={{
                borderTop: "1px solid var(--border-subtle)",
                paddingTop: 6,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "var(--color-foreground)",
                  marginBottom: 4,
                  opacity: 0.95,
                }}
              >
                {r.question || "(no question)"}
              </div>
              <div
                style={{
                  fontSize: "var(--text-caption)",
                  opacity: 0.7,
                  fontFamily: "var(--font-serif)",
                  marginBottom: 3,
                }}
              >
                {r.cardIds
                  .map((id) => resolveCardName(id))
                  .filter(Boolean)
                  .join(", ")}
              </div>
              {r.tags && r.tags.length > 0 && (
                <div
                  style={{
                    fontSize: "var(--text-caption)",
                    opacity: 0.6,
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                  }}
                >
                  Tags: {r.tags.join(", ")}
                </div>
              )}
            </div>
          ))}
          {dayReadings.length > 5 && (
            <div
              style={{
                fontSize: "var(--text-caption)",
                opacity: 0.55,
                fontStyle: "italic",
                fontFamily: "var(--font-serif)",
                paddingTop: 4,
              }}
            >
              +{dayReadings.length - 5} more pull
              {dayReadings.length - 5 === 1 ? "" : "s"} on this day
            </div>
          )}
        </div>
        {allTags.length > 0 && dayReadings.length > 1 && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: "1px solid var(--border-subtle)",
              fontSize: "var(--text-caption)",
              opacity: 0.65,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          >
            All tags this day: {allTags.join(", ")}
          </div>
        )}
      </div>
    );
    return createPortal(popover, document.body);
  })();

  return (
    <div className="relative">
      {/* Constellation web — hero centered, top 7 companions around.
          EK42 — wired drag handlers so any card can be dragged onto
          the hero spot to swap (parent navigates).
          EK44 — onCardHover wired so the calendar can preview what
          asterism days would look like if the hovered card were
          added to the teal set. */}
      <div className="mx-auto" style={{ maxWidth: 540 }}>
        <ConstellationWeb
          heroPick={heroPick}
          constellation={constellation}
          onCardClick={handleCardClick}
          tealSelectedIds={tealSelectedIds}
          candidateIds={candidateIds}
          heroDrawCount={heroBadgeValue}
          heroBadgeTooltip={heroBadgeTooltip}
          tealBadge={tealBadge}
          onHeroBadgeClick={() => setReadingsModal({ kind: "hero" })}
          onTealBadgeClick={() => setReadingsModal({ kind: "teal" })}
          onTealBadgeHover={() => setAsterismBadgeHovered(true)}
          onTealBadgeHoverEnd={() => setAsterismBadgeHovered(false)}
          onCardDragStart={handleCardDragStart}
          onConstellationDragOver={handleConstellationDragOver}
          onConstellationDrop={handleConstellationDrop}
          dragOverTargetId={dragOverTargetId}
          onCardHover={(cardId) => setHoverCardId(cardId)}
        />
      </div>

      {/* 12-month calendar — 2 rows × 6 months. Gold-fill on hero
          days, teal stroke on days where all teal cards co-occurred.
          EK42 — onDayHover wired for the rich popover.
          EK44 — effectiveTealIds augments the teal set with the
          hover card (if any). When the seeker hovers a card not
          yet in the teal set, the calendar previews the asterism
          stroke as if it were added. With 0 teal selected, hovering
          1 card → 1 in the effective set → no stroke (OverlapStrip
          requires 2+). With 1+ teal selected, hovering another card
          → 2+ in the effective set → preview stroke fires. */}
      {calendarState !== "none" && (
        <div className="mx-auto mt-6" style={{ width: "100%" }}>
          <OverlapStrip
            overlap={overlap}
            heroCardId={heroCardId}
            pullCardIds={[]}
            mode={mode}
            onModeChange={onModeChange}
            tealSelectedIds={effectiveTealIds}
            layout="grid12"
            showOlder={calendarState === "both"}
            onShowOlderChange={(v) =>
              onCalendarStateChange(v ? "both" : "recent")
            }
            onDayClick={(date, readingIds) =>
              setReadingsModal({ kind: "day", date, readingIds })
            }
            onDayHover={(info) => {
              const dayReadings =
                overlap?.readingsByDate?.[info.date] ?? [];
              if (dayReadings.length === 0) return;
              // EK44 — Fire popover for any day with a hero pull OR
              // (when teal is active) a teal co-occurrence pull.
              // Days with neither don't surface the popover.
              const heroHere = dayReadings.some((r) =>
                r.cardIds.includes(heroCardId),
              );
              const tealHere =
                tealSelectedIds.length >= 2 &&
                dayReadings.some((r) =>
                  tealSelectedIds.every((id) => r.cardIds.includes(id)),
                );
              if (!heroHere && !tealHere) return;
              setDayHover({
                date: info.date,
                anchorX: info.anchorX,
                anchorY: info.anchorY,
                targetRect: info.targetRect,
              });
            }}
            onDayHoverEnd={() => setDayHover(null)}
            asterismBadgeHovered={asterismBadgeHovered}
          />
        </div>
      )}

      {/* Asterism breathing — fires when 3+ teal cards have appeared
          together in past pulls. */}
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

      {/* Hint at drag/double-click behavior when companions are
          present and no teal selection yet. Calm, low-key. */}
      {!echo.active &&
        tealSelectedIds.length === 0 &&
        constellation &&
        constellation.companions.length > 0 && (
          <div
            className="mx-auto mt-3 text-center"
            style={{
              maxWidth: 540,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.55,
            }}
          >
            Tap a companion to add it to your selection. Drag or
            double-tap to make it the hero.
          </div>
        )}

      {/* Day-cell rich hover popover — pulls + cards + tags */}
      {dayPopover}

      {/* Readings modal — opens on hero badge click, teal badge
          click, or day-cell click. */}
      {readingsModal.kind !== "none" && (
        <Modal onClose={() => setReadingsModal({ kind: "none" })}>
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
                  .map((id) => resolveCardName(id))
                  .filter(Boolean)
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
                      .map((id) => resolveCardName(id))
                      .filter(Boolean)
                      .join(", ")}
                    {r.cardIds.length > 3
                      ? `, +${r.cardIds.length - 3} more`
                      : ""}
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
