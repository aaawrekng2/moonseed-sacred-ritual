/**
 * Q64 — Card Trace.
 *
 * Single-card history page. Hero, meaning (chips + collapsible),
 * stats strip, weekly trend chart with 30/90/180/All pills,
 * co-occurrence strip, elemental/astrological metadata,
 * expandable calendar, filterable readings list, and a
 * tap-to-generate premium AI reflection (TokenNotice-gated).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  X,
  ChevronDown,
  Sparkles,
  Calendar as CalendarIcon,
  Layers,
  Eraser,
} from "lucide-react";
import { PageMenuTrigger } from "@/components/nav/PageMenuTrigger";
import { PageMenu, type PageMenuSection } from "@/components/nav/PageMenu";
import { getStalkerCardDetail, getStalkerReflection } from "@/lib/insights.functions";
import {
  getCardPopoverData,
  getCardDrawCounts,
  type CardPopoverData,
} from "@/lib/quicklog.functions";
import { CardStatsPanel } from "@/components/card/CardStatsPanel";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { DEFAULT_FILTERS, type TimeRange } from "@/lib/insights.types";
import { useInsightsFilters } from "@/lib/use-insights-filters";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  ConstellationTagsPanel,
  useTagSortPref,
  useTagScopePref,
  type ConstellationTagStat,
} from "@/components/filters/ConstellationTagsPanel";
import { getTagFilterStats } from "@/lib/insights.functions";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";
// EJ69 — Removed: useScrollCollapse, no longer needed (slim sticky header
// has no large-to-compact title collapse).
import type { MoonPhaseName } from "@/lib/moon";
import { AdaptiveCardImage } from "@/components/card/AdaptiveCardImage";
// EJ69 — Removed CardImage import (only AdaptiveCardImage is rendered).
import { TagCloud } from "@/components/card/TagCloud";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DrawCalendar } from "@/components/insights/DrawCalendar";
import { InsightsCardConstellation } from "@/components/insights/InsightsCardConstellation";
import { useTimezone } from "@/lib/use-timezone";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { ReadingRow } from "@/components/ui/reading-row";
import { EmptyNote } from "@/components/ui/empty-note";
import { getCardMeaning } from "@/lib/tarot-meanings";
import { useTokenNotice } from "@/components/ui/TokenNotice";
import { formatDateShort } from "@/lib/dates";

export const Route = createFileRoute("/insights/card/$cardId")({
  component: CardTraceRoute,
  head: ({ params }) => ({
    meta: [
      {
        title: `${getCardName(Number(params.cardId))} — Card Trace — Tarot Seed`,
      },
    ],
  }),
});

/**
 * EJ64 — Thin route wrapper. The real component is CardTraceView,
 * exported so other surfaces (like SpreadLayout's flip-table tap)
 * can render the same view as a modal overlay.
 */
function CardTraceRoute() {
  const { cardId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <CardTraceView
      cardId={Number(cardId)}
      onClose={() => navigate({ to: "/insights" })}
    />
  );
}

type Appearance = {
  readingId: string;
  date: string;
  spreadType: string | null;
  isReversed: boolean;
  question: string | null;
  cardIds: number[];
};

type Detail = {
  cardId: number;
  cardName: string;
  totalCount: number;
  reversedCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  appearances: Appearance[];
  coOccurrences: Array<{ cardId: number; count: number }>;
  tagCloud?: Array<{ tag: string; count: number }>;
  availableSpreadTypes?: string[];
  availableMoonPhases?: string[];
};

// EJ60 — Roman numerals for the major arcana (cardId 0..21). Used by
// the CardStatsPanel header. Non-majors get null and the panel
// suppresses the slot.
const ROMAN_NUMERALS = [
  "0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI",
];

// EJ60 — Build the header tag list (e.g. ["MAJOR", "CAPRICORN"]) for a
// card. Majors get arcana + zodiac. Minors get suit + element. Empty
// strings filtered out so the panel renders a clean " · "-joined list.
function buildCardTags(
  cardId: number,
  meaning: { element?: string; zodiac?: string | null; planet?: string | null } | null,
): string[] {
  if (!meaning) return [];
  const tags: string[] = [];
  if (cardId <= 21) {
    tags.push("Major");
  } else {
    // Minor arcana: cardId 22..77. Suit derived from blocks of 14.
    const suitIdx = Math.floor((cardId - 22) / 14);
    const suit = ["Wands", "Cups", "Swords", "Pentacles"][suitIdx];
    if (suit) tags.push(suit);
  }
  if (meaning.zodiac) tags.push(meaning.zodiac);
  if (meaning.element) tags.push(meaning.element);
  return tags.filter(Boolean);
}

/**
 * EJ64 — CardTraceView (exported). The main Card Trace render body.
 * Accepts cardId as a prop so the same view can be rendered:
 *   1. By the /insights/card/$cardId route (where the route wrapper
 *      provides cardId from params and onClose that navigates to
 *      /insights).
 *   2. As a portal-rendered modal on top of other surfaces (like
 *      SpreadLayout's flip-table — where onClose just dismisses the
 *      modal and the underlying flip-table state is preserved).
 *
 * Already `fixed inset-0 z-50` so it overlays whatever is beneath
 * without needing a separate wrapper.
 */
export function CardTraceView({
  cardId,
  onClose,
}: {
  cardId: number;
  onClose: () => void;
}) {
  const cid = cardId;
  const navigate = useNavigate();
  const fn = useServerFn(getStalkerCardDetail);
  const popoverFn = useServerFn(getCardPopoverData);
  const drawCountsFn = useServerFn(getCardDrawCounts);
  const [data, setData] = useState<Detail | null>(null);
  // EJ60 — Popover rich-data (12-month sparkline, moon phase, time of day,
  // day of week, companions, longest gap, avg spacing). Same shape and
  // server function used by the constellation hover popover, so the same
  // data appears in both surfaces. Rendered via <CardStatsPanel/>.
  const [popoverData, setPopoverData] = useState<CardPopoverData | null>(null);
  // EJ69 — Rank within the seeker's deck universe for the filter window.
  // Same data the constellation popover uses to render its "#N Rank of M"
  // tile. Fetched separately because the popover's drawCounts comes from
  // ConstellationPage's local state, which Card Trace standalone doesn't
  // have access to.
  const [cardRank, setCardRank] = useState<{ rank: number | null; universeSize: number }>({
    rank: null,
    universeSize: 0,
  });
  const resolveImage = useActiveDeckImage();
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  // Q75 — full GlobalFilters state (time range + drawer sections).
  const [gFilters, setGFilters] = useState<GlobalFilters>({
    ...EMPTY_GLOBAL_FILTERS,
    timeRange: "all",
  });
  // v2.7 — The ENTIRE filter set comes from the SHARED Insights source
  // (the same values the layout's pinned bar writes), so the
  // constellation, calendar, hero badge, and stats honor whatever the
  // seeker picks — tags, spread types, moon phases, depth, reversed, and
  // time — whether they touch the pinned layout bar or this page's own
  // bar. gFilters now only carries this page's local tag-panel state
  // (tagMode); the filter VALUES live in the shared store.
  const [shared, setShared] = useInsightsFilters();
  const trendWin = shared.timeRange;
  // The unified GlobalFilters view fed to the constellation and this
  // page's own filter bar: shared filter values + local tagMode.
  const effectiveFilters: GlobalFilters = {
    ...gFilters,
    timeRange: shared.timeRange,
    tags: shared.tags,
    spreadTypes: shared.spreadTypes,
    moonPhases: shared.moonPhases,
    deepOnly: shared.deepOnly,
    reversedOnly: shared.reversedOnly,
  };

  // Q75 — user tags for the filter drawer.
  const [userTags, setUserTags] = useState<
    Array<{ id: string; name: string; usage_count: number }>
  >([]);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      const { data: tags } = await supabase
        .from("user_tags")
        .select("id, name, usage_count")
        .eq("user_id", user.id)
        .order("usage_count", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setUserTags(
          (tags ?? []) as Array<{
            id: string;
            name: string;
            usage_count: number;
          }>,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  // EJ69 — Removed Q74 reversal-stat fetch. CardStatsPanel handles
  // the Reversed tile via popoverData.reversedPct directly; the same
  // pattern the constellation popover uses (no per-user gating).

  const heroRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    heroRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [cid]);

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({
          data: {
            ...DEFAULT_FILTERS,
            timeRange: trendWin,
            tagIds: shared.tags,
            spreadTypes: shared.spreadTypes,
            moonPhases: shared.moonPhases as MoonPhaseName[],
            deepOnly: shared.deepOnly,
            reversedOnly: shared.reversedOnly,
            tz: effectiveTz,
            cardId: cid,
          },
          headers,
        });
        setData(r as Detail);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] failed", e);
      }
    })();
  }, [
    user?.id,
    cid,
    fn,
    trendWin,
    shared.tags,
    shared.spreadTypes,
    shared.moonPhases,
    shared.deepOnly,
    shared.reversedOnly,
    effectiveTz,
  ]);

  // EJ60 — Fetch the rich popover-stats data for this single card.
  // Same server function the constellation popover uses; we just pass
  // a single-card list and read out the one entry. Refetches whenever
  // filters change so the panel stays in sync with the page-level
  // filter bar.
  useEffect(() => {
    if (!user?.id || !Number.isFinite(cid)) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const map = await popoverFn({
          data: {
            cardIds: [cid],
            tz: effectiveTz,
            filters: {
              timeRange: trendWin,
              tags: shared.tags,
              spreadTypes: shared.spreadTypes,
              moonPhases: shared.moonPhases as MoonPhaseName[],
              deepOnly: shared.deepOnly,
              reversedOnly: shared.reversedOnly,
            },
          },
          headers,
        });
        if (!cancelled) {
          setPopoverData(map[cid] ?? null);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] popover data fetch failed", e);
        if (!cancelled) setPopoverData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    cid,
    popoverFn,
    trendWin,
    shared.tags,
    shared.spreadTypes,
    shared.moonPhases,
    shared.deepOnly,
    shared.reversedOnly,
    effectiveTz,
  ]);

  // EJ69 — Fetch rank + rank universe size for this card. Same server
  // function the constellation page uses to compute the popover's
  // "#N Rank of M" tile. Refetches whenever filters change so rank
  // stays consistent with the filter-window stats.
  useEffect(() => {
    if (!user?.id || !Number.isFinite(cid)) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const dc = await drawCountsFn({
          data: {
            cardIds: [cid],
            filters: {
              timeRange: trendWin,
              tags: shared.tags,
              spreadTypes: shared.spreadTypes,
              moonPhases: shared.moonPhases as MoonPhaseName[],
              deepOnly: shared.deepOnly,
              reversedOnly: shared.reversedOnly,
            },
          },
          headers,
        });
        if (!cancelled) {
          setCardRank({
            rank: dc.perCardRank?.[cid] ?? null,
            universeSize: dc.rankUniverseSize ?? 0,
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] draw-counts fetch failed", e);
        if (!cancelled) setCardRank({ rank: null, universeSize: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    cid,
    drawCountsFn,
    trendWin,
    shared.tags,
    shared.spreadTypes,
    shared.moonPhases,
    shared.deepOnly,
    shared.reversedOnly,
  ]);

  // EJ64 — `close` now calls the onClose prop instead of hardcoding
  // a navigate to /insights. The route wrapper passes a navigate
  // callback; modal callers pass a dismiss callback that preserves
  // the underlying surface state (e.g. flip-table picks).
  const close = onClose;
  const url = resolveImage(cid, "display") ?? getCardImagePath(cid);
  const cardName = data?.cardName ?? getCardName(cid);
  const meaning = getCardMeaning(cid);
  const appearances = data?.appearances ?? [];
  // EJ69 — Popover-style count: derive from popoverData.monthCounts so
  // Card Trace gating matches the constellation popover surface exactly.
  // The previous `data.totalCount` gate hid the rich panel for cards with
  // sparse history; popover always renders its stat tiles (with 0s if
  // empty) so Card Trace should too.
  const countFromMonthsRich = popoverData?.monthCounts?.reduce(
    (acc, n) => acc + n,
    0,
  );
  const count =
    typeof countFromMonthsRich === "number"
      ? countFromMonthsRich
      : (data?.totalCount ?? 0);
  const totalCount = data?.totalCount ?? 0;
  // EJ69 — reversedCount removed; CardStatsPanel reads reversedPct from
  // popoverData directly.

  // EJ69 — scrollRef retained for the <main> overflow container; the
  // large-to-compact title fade was removed in EJ69 because the slim
  // sticky header always shows the name.
  const scrollRef = useRef<HTMLElement | null>(null);

  // EK44 — Track the live TopNav DOM height so the filter row +
  // constellation can sit just under it AND follow its 28 ↔ 56
  // expansion. TopNav doesn't expose its expanded state, but it does
  // animate its inner height, so a ResizeObserver on the rendered
  // <nav aria-label="Primary"> element catches every state change.
  const [topNavHeight, setTopNavHeight] = useState<number>(28);
  useEffect(() => {
    const nav = document.querySelector(
      'nav[aria-label="Primary"]',
    ) as HTMLElement | null;
    if (!nav) return;
    const update = () => setTopNavHeight(nav.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  // EK42 — Constellation state lifted to the route so the PageMenu
  // (page chrome) can include "Match mode" + "Calendar visibility"
  // + "Clear teal selection" controls.  The embed receives these as
  // controlled props.
  const [constellationMode, setConstellationMode] = useState<"pull" | "day">("pull");
  const [calendarState, setCalendarState] = useState<"none" | "recent" | "both">("both");
  const cycleCalendar = () =>
    setCalendarState((s) =>
      s === "none" ? "recent" : s === "recent" ? "both" : "none",
    );
  const cycleMode = () =>
    setConstellationMode((m) => (m === "pull" ? "day" : "pull"));
  const [tealSelectedIds, setTealSelectedIds] = useState<number[]>([]);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);

  // EK42 — Reset teal selection when the hero card changes (i.e.
  // when the seeker drags or double-clicks to swap heroes; the new
  // hero re-derives the constellation so the old set wouldn't map).
  useEffect(() => {
    setTealSelectedIds([]);
  }, [cid]);

  // EK42 — Build the PageMenu sections. Mirrors Manual Entry's
  // structure (single source of page-level configuration). The Back
  // arrow lives inside here instead of the old top header chrome.
  const pageMenuSections: PageMenuSection[] = [
    {
      id: "nav",
      title: "Navigate",
      items: [
        {
          id: "back",
          label: "Back to Insights",
          description: "Return to the previous view",
          Icon: ArrowLeft,
          mode: "navigate",
          onClick: () => {
            setPageMenuOpen(false);
            close();
          },
        },
      ],
    },
    {
      id: "constellation",
      title: "Constellation",
      items: [
        {
          id: "mode",
          label: "Match mode",
          description:
            constellationMode === "pull"
              ? "Same pull — cards drawn together"
              : "Same day — cards drawn on the same date",
          Icon: Layers,
          mode: "cycle",
          cycleLabel: constellationMode === "pull" ? "Same pull" : "Same day",
          onClick: cycleMode,
        },
        {
          id: "calendar",
          label: "Calendar",
          description: "Cycle: hidden → 1 row → 2 rows",
          Icon: CalendarIcon,
          mode: "cycle",
          cycleLabel:
            calendarState === "none"
              ? "Hidden"
              : calendarState === "recent"
                ? "1 row"
                : "2 rows",
          onClick: cycleCalendar,
        },
        ...(tealSelectedIds.length > 0
          ? [
              {
                id: "clear-teal",
                label: "Clear teal selection",
                description: `${tealSelectedIds.length} card${tealSelectedIds.length === 1 ? "" : "s"} selected`,
                Icon: Eraser,
                mode: "navigate" as const,
                onClick: () => {
                  setTealSelectedIds([]);
                  setPageMenuOpen(false);
                },
              },
            ]
          : []),
      ],
    },
  ];

  // EK44 — Scroll to top whenever the focus card changes. Without
  // this, navigating between cards via drag/double-click keeps the
  // scroll position from the previous card, which can land the
  // seeker in the middle of the page rather than at the
  // constellation.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [cid]);

  return (
    <div
      className="flex min-h-screen flex-col bg-cosmos"
      style={{
        // EK45 — Removed the `fixed inset-0` + `zIndex: var(--z-modal)`
        // wrapping. CardTrace was originally rendered as a modal-style
        // overlay so it could open over the Tabletop flip table, but
        // that put it in a stacking context above z-modal (100), and
        // every dropdown/drawer in the page (time-range, filter
        // drawer, Dropdown components) renders at lower z-indexes and
        // ended up BEHIND CardTrace. The trigger clicked, the arrow
        // flipped, but the menu was invisible underneath the overlay.
        //
        // Now CardTrace is a regular page — `min-h-screen` fills the
        // viewport, the cosmos gradient still spans edge to edge, but
        // the dropdown / drawer / modal layers (50/60/100) work as
        // they do everywhere else. The Tabletop X-button overlap that
        // motivated the original modal pattern is handled by the
        // router navigation (CardTrace replaces the Tabletop route
        // entry rather than overlaying it).
      }}
    >
      {/* EK45 — Global <TopNav /> is now visible because CardTrace
            is a normal page (TopNavGate renders it on /insights routes).
            Back/X buttons stay overlaid on its row. */}
      <button
        type="button"
        onClick={close}
        aria-label="Back to Insights"
        title="Back"
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 4px)",
          left: 8,
          zIndex: 501,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--color-foreground)",
          opacity: 0.85,
        }}
      >
        <ArrowLeft size={18} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        title="Close"
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 4px)",
          right: 8,
          zIndex: 501,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--color-foreground)",
          opacity: 0.85,
        }}
      >
        <X size={18} strokeWidth={1.7} />
      </button>
      <PageMenuTrigger onClick={() => setPageMenuOpen(true)} />
      <PageMenu
        open={pageMenuOpen}
        onClose={() => setPageMenuOpen(false)}
        sections={pageMenuSections}
        title="Card Trace"
      />

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 pb-12"
        style={{
          // EK44 — Pad the scroll container's top by the LIVE TopNav
          // height so the content starts immediately below TopNav,
          // and follows its 28 ↔ 56 expansion smoothly.
          paddingTop: topNavHeight,
        }}
      >
        {/* EK44 — Filter row + constellation share the same top
            zone. The filter is positioned in a left-aligned floated
            block; the constellation centers inside its own block at
            the same vertical position. The result: filter on the
            left edge, constellation centered in the middle of the
            available width, both starting just under TopNav.
            
            The filter row uses position: relative inside an
            absolutely-anchored container so it stays visually
            anchored to the left independent of the centered
            constellation column. */}
        <div
          className="relative mx-auto"
          style={{ width: "100%", maxWidth: 1100 }}
        >
          {/* Filter row: absolutely positioned at the TOP-LEFT of
              the column. Doesn't push the centered constellation
              down. Wraps so on small viewports it can shrink. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 5,
              maxWidth: "60%",
            }}
          >
            <GlobalFilterBar
              filters={effectiveFilters}
              onChange={(next) => {
                // v2.7 — fly-out values go to the shared store (so the
                // pinned layout bar stays in sync); tagMode stays local.
                setShared({
                  tags: next.tags,
                  spreadTypes: next.spreadTypes,
                  moonPhases: next.moonPhases,
                  deepOnly: next.deepOnly,
                  reversedOnly: next.reversedOnly,
                });
                setGFilters((prev) => ({ ...prev, tagMode: next.tagMode }));
              }}
              sections={["tags", "spreadTypes", "moonPhases", "depth", "reversed"]}
              tagsSectionOverride={
                <CardTraceTagsBridge
                  globalFilters={effectiveFilters}
                  onTagToggle={(name) =>
                    setShared({
                      tags: shared.tags.includes(name)
                        ? shared.tags.filter((t) => t !== name)
                        : [...shared.tags, name],
                    })
                  }
                  onTagModeChange={(mode) =>
                    setGFilters((prev) => ({ ...prev, tagMode: mode }))
                  }
                  cardIndices={[cid]}
                />
              }
              timeRange={{
                value: shared.timeRange,
                options: [
                  { value: "7d", label: "Last 7 days" },
                  { value: "30d", label: "Last 30 days" },
                  { value: "90d", label: "Last 90 days" },
                  { value: "180d", label: "Last 180 days" },
                  { value: "365d", label: "Last 365 days" },
                  { value: "all", label: "All time" },
                ],
                // v2.7 — Writes the shared Insights filters so this page's
                // bar and the layout's pinned bar stay in sync.
                onChange: (v) => setShared({ timeRange: v as TimeRange }),
              }}
              userTags={userTags}
              availableSpreadTypes={data?.availableSpreadTypes}
              availableMoonPhases={data?.availableMoonPhases}
            />
          </div>
          {/* Constellation embed: in normal flow, centered. The
              filter above is absolute so it doesn't push this down
              — the constellation top edge sits at the SAME y as the
              filter, just centered in the column. */}
          <div ref={heroRef} className="mx-auto" style={{ paddingTop: 48 }}>
            <InsightsCardConstellation
              heroCardId={cid}
              heroCardName={cardName}
              tz={effectiveTz}
              filters={effectiveFilters}
              mode={constellationMode}
              onModeChange={setConstellationMode}
              calendarState={calendarState}
              onCalendarStateChange={setCalendarState}
              tealSelectedIds={tealSelectedIds}
              onTealSelectedIdsChange={setTealSelectedIds}
              onSwapHero={(newHeroCardId) => {
                navigate({
                  to: "/insights/card/$cardId",
                  params: { cardId: String(newHeroCardId) },
                });
              }}
            />
          </div>
        </div>

        {/* EJ69 — Rich stats panel directly below the hero. Composition
            mirrors the constellation popover exactly: name + tags +
            tiles + moon/time/day rows + frequency bars + meaning
            (inline, no collapse) + companions + first/last seen +
            longest gap / avg spacing. Single source of truth. */}
        <div className="mx-auto mt-6 px-2" style={{ maxWidth: 480 }}>
          <CardStatsPanel
            cardName={cardName}
            count={count}
            rank={cardRank.rank}
            universeSize={cardRank.universeSize || null}
            data={popoverData}
            resolveCardName={(id) => getCardName(id)}
            roman={cid <= 21 ? ROMAN_NUMERALS[cid] : null}
            tags={buildCardTags(cid, meaning)}
            uprightMeaning={
              meaning
                ? {
                    keywords: meaning.uprightKeywords ?? [],
                    body: meaning.uprightMeaning ?? "",
                  }
                : null
            }
            reversedMeaning={
              meaning
                ? {
                    keywords: meaning.reversedKeywords ?? [],
                    body: meaning.reversedMeaning ?? "",
                  }
                : null
            }
            firstSeen={data?.firstSeen ? formatDateShort(data.firstSeen) : null}
            lastSeen={data?.lastSeen ? formatDateShort(data.lastSeen) : null}
          />
          {/* EJ70 — All-time tag word cloud, scoped to this card,
              independent of the filter bar. Sized by frequency.
              Sits below the companions section inside the same column. */}
          {data?.tagCloud && data.tagCloud.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <TagCloud entries={data.tagCloud} />
            </div>
          )}
        </div>

        {/* EK41 — ExpandableCalendar removed. The 12-month calendar
            now lives inside InsightsCardConstellation at the top of
            this page. Keeping it here would duplicate the same
            visualization on the same screen. */}
        <div className="mx-auto mt-8" style={{ maxWidth: 960 }} />

        <div className="mx-auto mt-2 flex max-w-md flex-col gap-4">
          {data && totalCount === 0 && (
            <EmptyNote text="This card hasn't appeared in your spreads yet — its trace starts here." />
          )}

          {data && count > 0 && (
            <ReadingsList appearances={appearances} onOpen={setOpenReadingId} />
          )}

          {data && (
            <PremiumDetailReflection
              cardId={cid}
              count={data.totalCount}
              latestDate={data.lastSeen ?? new Date().toISOString()}
              appearances={appearances}
            />
          )}
        </div>
      </main>

      {openReadingId && (
        <ReadingDetailModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
    </div>
  );
}

// EJ69 — Dead helpers removed: majorOrSuitLabel, MeaningSection,
// MeaningHeading, StatsStrip, CoOccurrenceStrip, MetadataRow.
// All their content is now folded into CardStatsPanel.


/* ============================================================
 * 3g — Expandable calendar
 * ============================================================ */
function ExpandableCalendar({ appearances }: { appearances: Appearance[] }) {
  const [full, setFull] = useState(false);
  const { effectiveTz } = useTimezone();
  return (
    <div>
      <DrawCalendar
        appearances={appearances}
        monthsBack={full ? 12 : 2}
        tz={effectiveTz}
      />
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--gold)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          aria-expanded={full}
        >
          {full ? "Show less" : "Show full year"}
          <ChevronDown
            size={14}
            style={{
              transform: full ? "rotate(180deg)" : "none",
              transition: "transform 200ms",
            }}
          />
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * 3h — Readings list (Q74: top filter bar is the only filter)
 * ============================================================ */
function ReadingsList({
  appearances,
  onOpen,
}: {
  appearances: Appearance[];
  onOpen: (readingId: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          margin: 0,
        }}
      >
        Your readings with this card
      </h2>
      {appearances.length === 0 ? (
        <EmptyNote text="No spreads in this time window." />
      ) : (
        <div className="flex flex-col">
          {appearances.map((a) => (
            <ReadingRow
              key={`${a.readingId}-${a.date}`}
              readingId={a.readingId}
              question={a.question ?? null}
              cardIds={a.cardIds}
              createdAt={a.date}
              spreadType={a.spreadType ?? null}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 3i — Premium AI reflection (tap to generate)
 * ============================================================ */
function PremiumDetailReflection({
  cardId,
  count,
  latestDate,
  appearances,
}: {
  cardId: number;
  count: number;
  latestDate: string;
  appearances: Appearance[];
}) {
  const fn = useServerFn(getStalkerReflection);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const { guard, notice } = useTokenNotice();

  const generate = (forceRegenerate = false) => {
    if (loading || (text && !forceRegenerate)) return;
    setLoading(true);
    setErr(false);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const payload = buildReflectionPayload(cardId, appearances);
        const r = await fn({
          data: {
            cardId,
            count,
            latestDate,
            ...payload,
            forceRegenerate,
          },
          headers,
        });
        if (r.ok) setText(r.reflection);
        else setErr(true);
      } catch {
        setErr(true);
      } finally {
        setLoading(false);
      }
    })();
  };

  if (text) {
    return (
      <div className="flex flex-col gap-2">
        <div
          className="w-full p-4"
          style={{
            background: "color-mix(in oklch, var(--gold) 10%, transparent)",
            borderRadius: 14,
            color: "var(--gold)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            lineHeight: 1.5,
            opacity: 0.95,
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </div>
        <button
          type="button"
          onClick={() => {
            setText(null);
            guard(() => generate(true));
          }}
          disabled={loading}
          className="self-end text-xs italic"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--gold)",
            opacity: loading ? 0.5 : 0.7,
            cursor: loading ? "wait" : "pointer",
            fontFamily: "var(--font-serif)",
          }}
        >
          Regenerate
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => guard(() => generate(false))}
        className="flex w-full items-center justify-center gap-2 p-4"
        style={{
          background: "color-mix(in oklch, var(--gold) 12%, transparent)",
          borderRadius: 14,
          color: "var(--gold)",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
          opacity: loading ? 0.6 : 1,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        <Sparkles className="h-4 w-4" />
        {loading
          ? "Reflection generating…"
          : err
            ? "Try again"
            : "What does this card's pattern mean for you?"}
      </button>
      {notice}
    </>
  );
}

function buildReflectionPayload(cardId: number, appearances: Appearance[]) {
  const seen = new Set<string>();
  const sampleQuestions: string[] = [];
  for (const a of appearances) {
    const q = (a.question ?? "").trim();
    if (q.length > 3 && !seen.has(q)) {
      seen.add(q);
      sampleQuestions.push(q);
    }
    if (sampleQuestions.length >= 10) break;
  }

  const coOccCounts = new Map<number, number>();
  for (const a of appearances) {
    for (const cid of a.cardIds ?? []) {
      if (cid === cardId) continue;
      coOccCounts.set(cid, (coOccCounts.get(cid) ?? 0) + 1);
    }
  }
  const coOccurringCards = [...coOccCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([cid, c]) => ({ cardName: getCardName(cid), count: c }));

  const spreadCounts = new Map<string, number>();
  for (const a of appearances) {
    const s = a.spreadType ?? "single";
    spreadCounts.set(s, (spreadCounts.get(s) ?? 0) + 1);
  }
  const spreadTypes = [...spreadCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([label, c]) => ({ label, count: c }));

  const reversedCount = appearances.filter((a) => a.isReversed).length;

  return { sampleQuestions, coOccurringCards, spreadTypes, reversedCount };
}
/* ============================================================
 * EK43 — Tags filter bridge for Card Trace.
 *
 * Identical pattern to ConstellationPage's EK36TagsBridge: wires
 * getTagFilterStats → ConstellationTagsPanel for the rich tags
 * filter UI (hover counts, font-weight gradient, recent-activity
 * dot, trend arrows). Card Trace passes the focus card's id as
 * the only cardIndex so the panel's stats are scoped to readings
 * that contain THIS card.
 * ============================================================ */
function CardTraceTagsBridge({
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

  const days = useMemo(() => {
    const raw = globalFilters.timeRange ?? "365d";
    if (raw === "all") return null;
    const m = /^(\d+)d$/.exec(raw);
    return m ? parseInt(m[1], 10) : 365;
  }, [globalFilters.timeRange]);

  const cardIndicesKey = cardIndices.join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
