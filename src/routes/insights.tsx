import { createFileRoute, useNavigate, Outlet } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { useScrollCollapse } from "@/lib/use-scroll-collapse";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import { EMPTY_GLOBAL_FILTERS, hasAnyActive, type GlobalFilters } from "@/lib/filters.types";
import { MajorMinorChart } from "@/components/insights/MajorMinorChart";
import { MoonPhaseRing } from "@/components/insights/MoonPhaseRing";
import { ReversalStat } from "@/components/insights/ReversalStat";
import { RhythmHeatmap } from "@/components/insights/RhythmHeatmap";
import { HeroCard } from "@/components/insights/HeroCard";
import { DrawCalendar } from "@/components/insights/DrawCalendar";
import { getInsightsOverview, getStalkerCards } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  DEFAULT_FILTERS,
  type InsightsFilters,
  type InsightsOverview,
  type StalkerCardsResult,
  type TimeRange,
  CARD_GROUP_BY,
  CARD_GROUP_BY_LABEL,
  CARD_SORT_BY,
  CARD_SORT_BY_LABEL,
  type CardGroupBy,
  type CardSortBy,
} from "@/lib/insights.types";
import { Dropdown } from "@/components/filters/Dropdown";
import { CardFrequencySection } from "@/components/insights/CardFrequencySection";
import { CardPairsSection } from "@/components/insights/CardPairsSection";
import { ReversalPatternsSection } from "@/components/insights/ReversalPatternsSection";
import { YearHeatmap } from "@/components/insights/YearHeatmap";
import { MoonPhaseInsightRing } from "@/components/insights/MoonPhaseInsightRing";
import { TimeOfDayRadial } from "@/components/insights/TimeOfDayRadial";
import { StreakHistory } from "@/components/insights/StreakHistory";
import { TagCloud } from "@/components/insights/TagCloud";
import { QuestionThemesLocked } from "@/components/insights/QuestionThemesLocked";
import { RecapTab } from "@/components/insights/RecapTab";
import { LunationBanner } from "@/components/insights/LunationBanner";
import { LunationHint } from "@/components/insights/LunationHint";
import { useMoonPrefs } from "@/lib/use-moon-prefs";
import { SuitTrendsChart } from "@/components/insights/SuitTrendsChart";
import { StalkersTab } from "@/components/insights/StalkersTab";
import { StoriesTab } from "@/components/insights/StoriesTab";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyHero } from "@/components/ui/empty-hero";
import type { MoonPhaseName } from "@/lib/moon";
import { useReadingStats } from "@/lib/use-reading-stats";
import { formatMonthYear } from "@/lib/dates";
import { useTimezone } from "@/lib/use-timezone";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Tarot Seed" },
      {
        name: "description",
        content: "Patterns, rhythms, and stalker cards across your readings.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? (search.tab as string) : undefined,
  }),
  component: InsightsRoute,
});

// Q52a — Numerology promoted to /numerology; Stories absorbed as a sub-tab.
type Tab = "overview" | "cards" | "calendar" | "stalkers" | "stories" | "recap";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "cards", label: "Cards" },
  { id: "calendar", label: "Calendar" },
  { id: "stalkers", label: "Stalkers" },
  { id: "stories", label: "Stories" },
  { id: "recap", label: "Recap" },
];

// EJ49 — Subtitle wording table. Maps `TimeRange` codes to the
// human-readable suffix used in "in the last X days". Centralized
// here so any future range additions only touch one spot.
const TIME_RANGE_SUFFIX: Record<string, string> = {
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  "180d": "in the last 180 days",
  "365d": "in the last 365 days",
  all: "", // "all" routes to the all-time wording, not a suffix
};

// EJ49 — Build the subtitle string for the Insights page header.
// Rules:
//   • If overview is still loading or zero results: return null and
//     the page hides the line.
//   • timeRange == "all" AND no other filters → "N readings since {Month Year}"
//     (matches the legacy formatReadingStatsLine behavior).
//   • timeRange != "all" AND no other filters → "N readings in the last X days"
//   • Any non-time filter active (with any timeRange):
//       - timeRange != "all" → "N readings in the last X days matching filters"
//       - timeRange == "all" → "N readings matching filters"
function computeStatsLine(args: {
  overview: InsightsOverview | null;
  timeRange: string;
  hasFiltersBeyondTime: boolean;
  allTimeStats: { count: number; firstAt: string | null };
}): string | null {
  const { overview, timeRange, hasFiltersBeyondTime, allTimeStats } = args;
  // Overview-driven path (filtered count). When overview hasn't
  // arrived yet, we don't show a stale all-time count — the line is
  // suppressed until the server returns the filtered total.
  if (!overview) return null;
  const n = overview.totalReadings;
  if (n === 0) return null;
  const noun = n === 1 ? "reading" : "readings";

  const timeSuffix = TIME_RANGE_SUFFIX[timeRange] ?? "";
  if (timeRange === "all" && !hasFiltersBeyondTime) {
    // Match the legacy wording: "N readings since {Month Year}".
    const firstAt = allTimeStats.firstAt;
    if (!firstAt) return `${n} ${noun}`;
    return `${n} ${noun} since ${formatMonthYear(firstAt)}`;
  }
  if (timeRange === "all" && hasFiltersBeyondTime) {
    return `${n} ${noun} matching filters`;
  }
  // timeRange != "all"
  if (hasFiltersBeyondTime) {
    return `${n} ${noun} ${timeSuffix} matching filters`;
  }
  return `${n} ${noun} ${timeSuffix}`;
}

function InsightsRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const moonPrefs = useMoonPrefs();
  const moonEnabled = moonPrefs.moon_features_enabled;
  const initialTab: Tab = (
    ["overview", "cards", "calendar", "stalkers", "stories", "recap"] as Tab[]
  ).includes(search.tab as Tab)
    ? (search.tab as Tab)
    : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  // Q99 #5 — hide Recap when moon disabled, and hide Stories when no patterns.
  const [patternCount, setPatternCount] = useState<number>(0);
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "recap" && !moonEnabled) return false;
    if (t.id === "stories" && patternCount === 0) return false;
    return true;
  });
  useEffect(() => {
    if (!moonEnabled && tab === "recap") setTab("overview");
    if (tab === "stories" && patternCount === 0) setTab("overview");
  }, [moonEnabled, tab, patternCount]);
  const activeTabLabel = visibleTabs.find((t) => t.id === tab)?.label ?? "";
  const pageTitle = activeTabLabel ? `Insights: ${activeTabLabel}` : "Insights";
  // EJ43 — was a one-shot supabase.auth.getUser() that captured null
  // forever if it ran before the anonymous session existed. Now
  // subscribes via useAuth so userId updates the moment auth resolves.
  const { user: authedUser } = useAuth();
  const userId = authedUser?.id ?? null;
  const readingStats = useReadingStats(userId);
  // EJ49 — statsLine moved below `overview` + `globalFilters` so it
  // can reflect the active filter stack. Old call was:
  //   const statsLine = formatReadingStatsLine(readingStats);
  // which always showed total-since-first-reading. New behavior:
  //   • timeRange == "all" AND no other filters → "N readings since {Month Year}"
  //   • timeRange != "all" AND no other filters → "N readings in the last X days"
  //   • any non-time filter active → "N readings in the last X days matching filters"
  //   • all + non-time filter → "N readings matching filters"
  // See computeStatsLine() below.
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
  // Phase 10 — keep filters.tz synced with the user's effective timezone so
  // every server fn that spreads filters aggregates on local calendar days.
  const { effectiveTz } = useTimezone();
  useEffect(() => {
    if (!effectiveTz || filters.tz === effectiveTz) return;
    setFilters((prev) => ({ ...prev, tz: effectiveTz }));
  }, [effectiveTz, filters.tz]);
  const scrollRef = useRef<HTMLElement | null>(null);
  const collapseProgress = useScrollCollapse(scrollRef, 40);
  const [userTags, setUserTags] = useState<
    Array<{ id: string; name: string; usage_count: number }>
  >([]);
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [stalkers, setStalkers] = useState<StalkerCardsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);
  const overviewFn = useServerFn(getInsightsOverview);
  const stalkerFn = useServerFn(getStalkerCards);

  // FU — Lift userTags fetch up so GlobalFilterBar can render Tags section.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data, error } = await supabase
        .from("user_tags")
        .select("id, name, usage_count")
        .eq("user_id", user.id)
        .order("usage_count", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.warn("[insights] tag fetch failed", error);
        return;
      }
      setUserTags((data ?? []) as Array<{ id: string; name: string; usage_count: number }>);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      console.log("[insights] waiting for userId");
      return;
    }
    console.log("[insights] fetching with userId:", userId, "filters:", filters);
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        console.log("[insights] auth headers:", Object.keys(headers));
        const [ov, st] = await Promise.all([
          overviewFn({ data: filters, headers }),
          stalkerFn({ data: filters, headers }),
        ]);
        console.log("[insights] overview result:", ov?.totalReadings, "readings");
        if (cancelled) return;
        // Q90 #8 — distinguish "fetch succeeded but returned zero" from
        // "fetch failed silently". A zero result for an authenticated
        // user with known readings on other devices is the signal we
        // want to surface during the persistent-blank investigation.
        if (ov && ov.totalReadings === 0) {
          console.warn(
            "[insights] overview returned 0 readings for userId:",
            userId,
            "filters:",
            filters,
          );
        }
        setOverview(ov);
        setStalkers(st);
        setLoading(false);
        // Q99 #5 — count patterns to decide Stories tab visibility.
        const { count } = await supabase
          .from("patterns")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        if (!cancelled) setPatternCount(count ?? 0);
      } catch (e) {
        if (cancelled) return;
        console.error("[insights] fetch FAILED:", e);
        setFetchError(true);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, filters, overviewFn, stalkerFn, fetchNonce]);

  // FU — adapt InsightsFilters ↔ GlobalFilters for the shared bar.
  const globalFilters: GlobalFilters = {
    ...EMPTY_GLOBAL_FILTERS,
    timeRange: filters.timeRange,
    tags: filters.tagIds,
    spreadTypes: filters.spreadTypes,
    moonPhases: filters.moonPhases,
    deepOnly: filters.deepOnly,
    reversedOnly: filters.reversedOnly,
  };
  const handleGlobalChange = (next: GlobalFilters) => {
    setFilters({
      ...filters,
      tagIds: next.tags,
      spreadTypes: next.spreadTypes,
      moonPhases: next.moonPhases as InsightsFilters["moonPhases"],
      deepOnly: next.deepOnly,
      reversedOnly: next.reversedOnly,
    });
  };

  // EJ49 — filter-aware subtitle. Reflects the count of readings
  // matching the active filter stack, and the wording reflects which
  // dimension is constraining the data.
  const statsLine = computeStatsLine({
    overview,
    timeRange: filters.timeRange,
    hasFiltersBeyondTime: hasAnyActive(globalFilters),
    allTimeStats: readingStats,
  });

  return (
    <div
      className="relative flex flex-col bg-cosmos"
      style={{
        // EJ47 — viewport minus TopNav band (see journal.tsx).
        height: "calc(100dvh - var(--topbar-pad))",
      }}
    >
      {/* EK-0 — h-dvh + flex-col so the inner <main> can own the scroll. */}
      {/* FU-7 — Unified sticky header: title row + filter bar + tab strip. */}
      <div
        className="page-header-glass sticky"
        style={{
          // EJ47 — docks below TopNav (var(--topbar-pad)) instead of
          // viewport top so it stays out from behind the fixed nav.
          top: "var(--topbar-pad)",
          zIndex: "var(--z-sticky-header)",
        }}
      >
        <div
          className="px-4 overflow-hidden flex items-center"
          style={{
            // EJ47 — safe-area-inset-top removed: TopNav spacer reserves it.
            paddingTop: `${collapseProgress * 6}px`,
            paddingBottom: `${collapseProgress * 6}px`,
            maxHeight: `${collapseProgress * 32}px`,
            transition: "max-height 150ms ease-out, padding 150ms ease-out",
          }}
        >
          <h1
            className="font-serif italic"
            style={{
              fontSize: "var(--text-heading-sm)",
              color: "var(--color-foreground)",
              opacity: 0.9 * collapseProgress,
              transition: "opacity 150ms ease-out",
              margin: 0,
              lineHeight: 1,
            }}
          >
            {pageTitle}
          </h1>
        </div>
        {/* Tab strip */}
        <HorizontalScroll className="py-2" contentClassName="items-center gap-6 px-4">
          {visibleTabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="whitespace-nowrap pb-1"
                style={
                  {
                    fontFamily: "var(--tab-font-family)",
                    fontStyle: "var(--tab-font-style)",
                    fontSize: "var(--tab-font-size)",
                    letterSpacing: "var(--tab-letter-spacing)",
                    textTransform: "var(--tab-text-transform)",
                    color: active ? "var(--tab-active-color)" : "var(--color-foreground)",
                    opacity: active ? "var(--tab-active-opacity)" : "var(--tab-inactive-opacity)",
                    borderBottom: active
                      ? "1px solid var(--tab-underline-color)"
                      : "1px solid transparent",
                  } as CSSProperties
                }
              >
                {t.label}
              </button>
            );
          })}
        </HorizontalScroll>
        {/* Q77 — filter bar moved below the tab strip so tabs are the
            primary nav and filters read as contextual controls. */}
        {tab !== "recap" && (
          <GlobalFilterBar
            filters={globalFilters}
            onChange={handleGlobalChange}
            sections={["tags", "spreadTypes", "moonPhases", "depth", "reversed"]}
            timeRange={{
              value: filters.timeRange,
              options: [
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "90d", label: "Last 90 days" },
                { value: "180d", label: "Last 180 days" },
                { value: "365d", label: "Last 365 days" },
                { value: "all", label: "All time" },
              ],
              onChange: (v) => setFilters({ ...filters, timeRange: v as TimeRange }),
            }}
            userTags={userTags}
            availableTags={overview?.availableTags}
            availableSpreadTypes={overview?.availableSpreadTypes}
            availableMoonPhases={overview?.availableMoonPhases}
            trailingDropdowns={
              tab === "cards" ? (
                <>
                  <Dropdown
                    prefix="Group"
                    value={filters.cardGroupBy ?? "none"}
                    options={CARD_GROUP_BY.map((v) => ({
                      value: v,
                      label: CARD_GROUP_BY_LABEL[v],
                    }))}
                    onChange={(v) => setFilters({ ...filters, cardGroupBy: v as CardGroupBy })}
                  />
                  <Dropdown
                    prefix="Sort"
                    value={filters.cardSortBy ?? "frequency"}
                    options={CARD_SORT_BY.map((v) => ({
                      value: v,
                      label: CARD_SORT_BY_LABEL[v],
                    }))}
                    onChange={(v) => setFilters({ ...filters, cardSortBy: v as CardSortBy })}
                  />
                </>
              ) : undefined
            }
          />
        )}
      </div>

      <main ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <h1
          className="font-serif italic mb-4"
          style={{
            fontSize: "var(--text-display, 32px)",
            color: "var(--color-foreground)",
            opacity: 0.9,
            lineHeight: 1.25,
          }}
        >
          {pageTitle}
        </h1>
        {statsLine ? (
          <p
            className="font-serif italic mb-4"
            style={{
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.7,
              margin: "-8px 0 16px 0",
            }}
          >
            {statsLine}
          </p>
        ) : null}
        <div className="mx-auto">
          {tab === "overview" && (
            <>
              <OverviewTab
                loading={loading}
                overview={overview}
                stalkers={stalkers}
                filtersActive={hasAnyActive(globalFilters)}
                onClearFilters={() => setFilters(DEFAULT_FILTERS)}
                onEmptyCta={() => navigate({ to: "/" })}
                onTapHero={() => setTab("stalkers")}
                onTapCalendar={() => setTab("calendar")}
                moonEnabled={moonEnabled}
                userId={userId}
                fetchError={fetchError}
                onRetry={() => setFetchNonce((n) => n + 1)}
              />
              <div className="flex flex-col gap-12 pt-8 pb-12">
                <SuitTrendsChart filters={filters} />
                <TagCloud
                  filters={filters}
                  onTagSelect={(tagId) => {
                    setFilters((f) => ({ ...f, tagIds: [tagId] }));
                    setTab("cards");
                  }}
                />
                <QuestionThemesLocked filters={filters} />
              </div>
            </>
          )}
          {tab === "cards" && (
            <div className="flex flex-col gap-8 pb-12">
              <CardFrequencySection filters={filters} />
              <CardPairsSection filters={filters} />
              <ReversalPatternsSection filters={filters} />
            </div>
          )}
          {tab === "calendar" && (
            <div className="flex flex-col gap-12 pb-12">
              <MoonPhaseInsightRing
                filters={filters}
                onPhaseToggle={(phase: MoonPhaseName) =>
                  setFilters((f) => ({
                    ...f,
                    moonPhases: f.moonPhases[0] === phase ? [] : [phase],
                  }))
                }
              />
              <YearHeatmap filters={filters} />
              <TimeOfDayRadial filters={filters} />
              <StreakHistory />
            </div>
          )}
          {tab === "stalkers" && <StalkersTab filters={filters} />}
          {tab === "stories" && <StoriesTab />}
          {tab === "recap" && moonEnabled && <RecapTab />}
        </div>
      </main>
      {/* Q60 Fix 3 — child routes (/insights/card/$cardId,
          /insights/recap/$lunationStart, /insights/year-of-lunations)
          mount here. They use position: fixed for full-screen takeover. */}
      <Outlet />
    </div>
  );
}

function OverviewTab({
  loading,
  overview,
  stalkers,
  filtersActive,
  onClearFilters,
  onEmptyCta,
  onTapHero,
  onTapCalendar,
  moonEnabled,
  userId,
  fetchError,
  onRetry,
}: {
  loading: boolean;
  overview: InsightsOverview | null;
  stalkers: StalkerCardsResult | null;
  filtersActive: boolean;
  onClearFilters: () => void;
  onEmptyCta: () => void;
  onTapHero: () => void;
  onTapCalendar: () => void;
  moonEnabled: boolean;
  userId: string | null;
  fetchError: boolean;
  onRetry: () => void;
}) {
  const { effectiveTz } = useTimezone();
  if (loading && !overview) {
    return <LoadingSkeleton heights={[220, 160, 160, 160]} />;
  }

  if (!overview || overview.totalReadings === 0) {
    // FU-16 — Hybrid empty: filtered-to-zero vs no-data-ever.
    if (filtersActive) {
      return (
        <EmptyHero
          title="Nothing matches these filters."
          subtitle="Try a different selection or clear filters to see all readings."
          cta={{
            label: "CLEAR FILTERS",
            onClick: onClearFilters,
            variant: "text",
          }}
        />
      );
    }
    // Q77 — if the seeker is authenticated and the fetch failed, show
    // a Retry rather than implying they have no readings.
    if (userId && (fetchError || !overview)) {
      return (
        <EmptyHero
          title="Couldn't load your insights."
          subtitle="A network hiccup may have interrupted the fetch."
          cta={{
            label: "RETRY",
            onClick: onRetry,
            variant: "text",
          }}
        />
      );
    }
    return (
      <EmptyHero
        title="Your insights will bloom here once you've logged a few readings."
        cta={
          userId
            ? {
                // Q89-6 — authenticated user with zero readings: most likely
                // a stale fetch; offer a Refresh recovery path instead of
                // implying they have no readings.
                label: "REFRESH",
                onClick: onRetry,
                variant: "text",
              }
            : {
                label: "Draw your first card",
                onClick: onEmptyCta,
              }
        }
      />
    );
  }

  const lowData = overview.totalReadings < 5;

  return (
    <div className="space-y-10 md:space-y-4">
      {moonEnabled && (
        <>
          <LunationHint />
          <LunationBanner />
        </>
      )}
      {lowData && (
        <div
          className="rounded-lg p-3 text-center"
          style={{
            background: "color-mix(in oklch, var(--gold) 12%, transparent)",
            color: "var(--color-foreground)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.9,
          }}
        >
          Insights become richer as you read more. Currently showing data from{" "}
          {overview.totalReadings} spread{overview.totalReadings === 1 ? "" : "s"}.
        </div>
      )}

      {stalkers && (stalkers.topCard || (stalkers.stalkerCards ?? []).length > 0) && (
        <HeroCard result={stalkers} onTap={onTapHero} />
      )}

      {/* Q101 #6 — Horizontal 3-month calendar of stalker appearances, desktop only.
          EJ41 — defensive: every level of the access path can be undefined on
          partial mobile payloads. */}
      {stalkers &&
        stalkers.stalkerCards?.[0]?.appearances &&
        stalkers.stalkerCards[0].appearances.length > 0 && (
          <div className="hidden md:block">
            <DrawCalendar
              appearances={stalkers.stalkerCards[0].appearances}
              tz={effectiveTz}
              monthsBack={Math.min(
                3,
                new Set(stalkers.stalkerCards[0].appearances.map((a) => a.date.slice(0, 7))).size,
              )}
            />
          </div>
        )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <MajorMinorChart data={overview.majorMinor} onTap={() => log("major-minor")} />
        {Object.keys(overview.moonPhaseDistribution ?? {}).length > 0 && (
          <MoonPhaseRing
            distribution={overview.moonPhaseDistribution ?? {}}
            onTap={onTapCalendar}
          />
        )}
        <ReversalStat rate={overview.reversalRate} onTap={() => log("reversal")} />
        <RhythmHeatmap days={overview.readingsByDay ?? []} onTap={() => log("rhythm")} />
      </div>

      <div className="pt-2 text-center">
        <a
          href="/journal"
          className="text-sm italic"
          style={{ color: "var(--gold)", opacity: 0.8 }}
        >
          See in journal →
        </a>
      </div>
    </div>
  );
}

function log(cardType: string) {
  console.log("insights.overview.tapped", { cardType });
}
