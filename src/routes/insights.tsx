import { createFileRoute, useNavigate, Outlet } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { useScrollCollapse } from "@/lib/use-scroll-collapse";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  EMPTY_GLOBAL_FILTERS,
  hasAnyActive,
  type GlobalFilters,
} from "@/lib/filters.types";
import { HeroCard } from "@/components/insights/HeroCard";
import { SuitBalanceChart } from "@/components/insights/SuitBalanceChart";
import { MajorMinorChart } from "@/components/insights/MajorMinorChart";
import { MoonPhaseRing } from "@/components/insights/MoonPhaseRing";
import { ReversalStat } from "@/components/insights/ReversalStat";
import { RhythmHeatmap } from "@/components/insights/RhythmHeatmap";
import { TopGuideStat } from "@/components/insights/TopGuideStat";
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
import { useReadingStats, formatReadingStatsLine } from "@/lib/use-reading-stats";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Moonseed" },
      { name: "description", content: "Patterns, rhythms, and stalker cards across your readings." },
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
  // Q60 Fix 9 — Hide Recap tab entirely when moon features disabled.
  const visibleTabs = moonEnabled ? TABS : TABS.filter((t) => t.id !== "recap");
  // If user landed on /insights?tab=recap with moon features off, fall back.
  useEffect(() => {
    if (!moonEnabled && tab === "recap") setTab("overview");
  }, [moonEnabled, tab]);
  const activeTabLabel = visibleTabs.find((t) => t.id === tab)?.label ?? "";
  const pageTitle = activeTabLabel ? `Insights: ${activeTabLabel}` : "Insights";
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);
  const readingStats = useReadingStats(userId);
  const statsLine = formatReadingStatsLine(readingStats);
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
  const scrollRef = useRef<HTMLElement | null>(null);
  const collapseProgress = useScrollCollapse(scrollRef, 40);
  const [userTags, setUserTags] = useState<
    Array<{ id: string; name: string; usage_count: number }>
  >([]);
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [stalkers, setStalkers] = useState<StalkerCardsResult | null>(null);
  const [loading, setLoading] = useState(true);
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
        // eslint-disable-next-line no-console
        console.warn("[insights] tag fetch failed", error);
        return;
      }
      setUserTags(
        (data ?? []) as Array<{ id: string; name: string; usage_count: number }>,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const [ov, st] = await Promise.all([
          overviewFn({ data: filters, headers }),
          stalkerFn({ data: filters, headers }),
        ]);
        if (!cancelled) {
          setOverview(ov);
          setStalkers(st);
          setLoading(false);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[insights] fetch failed", e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, overviewFn, stalkerFn]);

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

  return (
    <div className="relative flex h-dvh flex-col" style={{ background: "var(--background)" }}>
      {/* EK-0 — h-dvh + flex-col so the inner <main> can own the scroll. */}
      {/* FU-7 — Unified sticky header: title row + filter bar + tab strip. */}
      <div
        className="page-header-glass sticky top-0"
        style={{ zIndex: "var(--z-sticky-header)" }}
      >
        <div
          className="px-4 overflow-hidden flex items-center"
          style={{
            paddingTop: `calc(env(safe-area-inset-top,0px) + ${collapseProgress * 6}px)`,
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
        {tab !== "recap" && (
          <GlobalFilterBar
            filters={globalFilters}
            onChange={handleGlobalChange}
            sections={[
              "tags",
              "spreadTypes",
              "moonPhases",
              "depth",
              "reversed",
            ]}
            timeRange={{
              value: filters.timeRange,
              options: [
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "90d", label: "Last 90 days" },
                { value: "365d", label: "Last 365 days" },
                { value: "all", label: "All time" },
              ],
              onChange: (v) =>
                setFilters({ ...filters, timeRange: v as TimeRange }),
            }}
            userTags={userTags}
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
                    onChange={(v) =>
                      setFilters({ ...filters, cardGroupBy: v as CardGroupBy })
                    }
                  />
                  <Dropdown
                    prefix="Sort"
                    value={filters.cardSortBy ?? "frequency"}
                    options={CARD_SORT_BY.map((v) => ({
                      value: v,
                      label: CARD_SORT_BY_LABEL[v],
                    }))}
                    onChange={(v) =>
                      setFilters({ ...filters, cardSortBy: v as CardSortBy })
                    }
                  />
                </>
              ) : undefined
            }
          />
        )}
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
                style={{
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
                } as CSSProperties}
              >
                {t.label}
              </button>
            );
          })}
        </HorizontalScroll>
      </div>

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pb-28 pt-4"
      >
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
              fontSize: "var(--text-caption, 0.72rem)",
              color: "var(--color-foreground)",
              opacity: 0.55,
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
                onTapHero={() => setTab("cards")}
                onEmptyCta={() => navigate({ to: "/" })}
                moonEnabled={moonEnabled}
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
  onTapHero,
  onEmptyCta,
  moonEnabled,
}: {
  loading: boolean;
  overview: InsightsOverview | null;
  stalkers: StalkerCardsResult | null;
  filtersActive: boolean;
  onClearFilters: () => void;
  onTapHero: () => void;
  onEmptyCta: () => void;
  moonEnabled: boolean;
}) {
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
    return (
      <EmptyHero
        title="Your insights will bloom here once you've logged a few readings."
        cta={{
          label: "Draw your first card",
          onClick: onEmptyCta,
        }}
      />
    );
  }

  const lowData = overview.totalReadings < 5;

  return (
    <div className="space-y-4">
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
          Insights become richer as you read more. Currently showing data from {overview.totalReadings} reading{overview.totalReadings === 1 ? "" : "s"}.
        </div>
      )}

      {stalkers && (stalkers.topCard || stalkers.stalkerCards.length > 0) && (
        <HeroCard result={stalkers} onTap={onTapHero} />
      )}

      {overview.dataCapped && (
        <div
          className="rounded-lg p-2 text-center"
          style={{
            background: "var(--surface-card)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            opacity: 0.75,
          }}
        >
          Showing the last 90 days. Upgrade for all-time data.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <SuitBalanceChart data={overview.suitBalance} onTap={() => log("suit")} />
        <MajorMinorChart data={overview.majorMinor} onTap={() => log("major-minor")} />
        {Object.keys(overview.moonPhaseDistribution).length > 0 && (
          <MoonPhaseRing distribution={overview.moonPhaseDistribution} onTap={() => log("moon")} />
        )}
        <ReversalStat rate={overview.reversalRate} onTap={() => log("reversal")} />
        <RhythmHeatmap days={overview.readingsByDay} onTap={() => log("rhythm")} />
        <TopGuideStat
          data={overview.topGuide}
          onlyOne={overview.topGuide ? overview.topGuide.count === overview.totalReadings : false}
          onTap={() => log("guide")}
        />
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
  // eslint-disable-next-line no-console
  console.log("insights.overview.tapped", { cardType });
}
