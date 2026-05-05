import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/nav/BottomNav";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";
import { HeroCard } from "@/components/insights/HeroCard";
import { SuitBalanceChart } from "@/components/insights/SuitBalanceChart";
import { MajorMinorChart } from "@/components/insights/MajorMinorChart";
import { MoonPhaseRing } from "@/components/insights/MoonPhaseRing";
import { ReversalStat } from "@/components/insights/ReversalStat";
import { RhythmHeatmap } from "@/components/insights/RhythmHeatmap";
import { TopGuideStat } from "@/components/insights/TopGuideStat";
import { TopLensStat } from "@/components/insights/TopLensStat";
import { getInsightsOverview, getStalkerCards } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  DEFAULT_FILTERS,
  type InsightsFilters,
  type InsightsOverview,
  type StalkerCardsResult,
  type TimeRange,
} from "@/lib/insights.types";
import { StalkerCardsSection } from "@/components/insights/StalkerCardsSection";
import { CardFrequencySection } from "@/components/insights/CardFrequencySection";
import { CardPairsSection } from "@/components/insights/CardPairsSection";
import { ReversalPatternsSection } from "@/components/insights/ReversalPatternsSection";
import { YearHeatmap } from "@/components/insights/YearHeatmap";
import { MoonPhaseInsightRing } from "@/components/insights/MoonPhaseInsightRing";
import { TimeOfDayRadial } from "@/components/insights/TimeOfDayRadial";
import { StreakHistory } from "@/components/insights/StreakHistory";
import { TagCloud } from "@/components/insights/TagCloud";
import { GuidePreferences } from "@/components/insights/GuidePreferences";
import { LensDistribution } from "@/components/insights/LensDistribution";
import { QuestionThemesLocked } from "@/components/insights/QuestionThemesLocked";
import { RecapTab } from "@/components/insights/RecapTab";
import { LunationBanner } from "@/components/insights/LunationBanner";
import { PremiumBadge } from "@/components/insights/PremiumBadge";
import { StalkersTab } from "@/components/insights/StalkersTab";
import type { MoonPhaseName } from "@/lib/moon";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Moonseed" },
      { name: "description", content: "Patterns, rhythms, and stalker cards across your readings." },
    ],
  }),
  component: InsightsRoute,
});

// FL-1 — new Stalkers tab between Themes and Recap.
type Tab = "overview" | "cards" | "calendar" | "themes" | "stalkers" | "recap";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "cards", label: "Cards" },
  { id: "calendar", label: "Calendar" },
  { id: "themes", label: "Themes" },
  { id: "stalkers", label: "Stalkers" },
  { id: "recap", label: "Recap" },
];

function InsightsRoute() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
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
      {/* EO-11 — premium badge above the filter bar. */}
      <div className="flex justify-end px-4 pt-2">
        <PremiumBadge />
      </div>
      {tab !== "recap" && (
        <div
          className="backdrop-blur-md"
          style={{
            background:
              "color-mix(in oklch, var(--surface-elevated) 88%, transparent)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
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
          />
        </div>
      )}

      {/* Tab strip */}
      <div
        className="backdrop-blur-md"
        style={{
          background: "color-mix(in oklch, var(--surface-elevated) 85%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-6 overflow-x-auto px-4 py-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="whitespace-nowrap pb-1"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-caption, 0.75rem)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: active ? "var(--gold)" : "var(--color-foreground)",
                  opacity: active ? 1 : 0.55,
                  borderBottom: active ? "1px solid var(--gold)" : "1px solid transparent",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="mx-auto max-w-2xl">
          {tab === "overview" && (
            <OverviewTab
              loading={loading}
              overview={overview}
              stalkers={stalkers}
              onTapHero={() => setTab("cards")}
              onEmptyCta={() => navigate({ to: "/" })}
            />
          )}
          {tab === "cards" && (
            <div className="flex flex-col gap-8 pb-12">
              <StalkerCardsSection filters={filters} />
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
          {tab === "themes" && (
            <div className="flex flex-col gap-12 pb-12">
              <TagCloud
                filters={filters}
                onTagSelect={(tagId) => {
                  setFilters((f) => ({ ...f, tagIds: [tagId] }));
                  setTab("cards");
                }}
              />
              <GuidePreferences filters={filters} />
              <LensDistribution filters={filters} />
              <QuestionThemesLocked filters={filters} />
            </div>
          )}
          {tab === "stalkers" && <StalkersTab filters={filters} />}
          {tab === "recap" && <RecapTab />}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

function OverviewTab({
  loading,
  overview,
  stalkers,
  onTapHero,
  onEmptyCta,
}: {
  loading: boolean;
  overview: InsightsOverview | null;
  stalkers: StalkerCardsResult | null;
  onTapHero: () => void;
  onEmptyCta: () => void;
}) {
  if (loading && !overview) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              height: i === 0 ? 220 : 160,
              background: "var(--surface-card)",
              borderRadius: 18,
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    );
  }

  if (!overview || overview.totalReadings === 0) {
    return (
      <div className="py-16 text-center">
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-sm)",
            opacity: 0.85,
            lineHeight: 1.5,
          }}
        >
          Your insights will bloom here once you've logged a few readings.
        </div>
        <button
          type="button"
          onClick={onEmptyCta}
          className="mt-6 inline-flex items-center rounded-full px-4 py-2 text-sm"
          style={{
            background: "color-mix(in oklch, var(--gold) 24%, transparent)",
            color: "var(--gold)",
            fontStyle: "italic",
          }}
        >
          Draw your first card
        </button>
      </div>
    );
  }

  const lowData = overview.totalReadings < 5;

  return (
    <div className="space-y-4">
      <LunationBanner />
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <SuitBalanceChart data={overview.suitBalance} onTap={() => log("suit")} />
        <MajorMinorChart data={overview.majorMinor} onTap={() => log("major-minor")} />
        <MoonPhaseRing distribution={overview.moonPhaseDistribution} onTap={() => log("moon")} />
        <ReversalStat rate={overview.reversalRate} onTap={() => log("reversal")} />
        <RhythmHeatmap days={overview.readingsByDay} onTap={() => log("rhythm")} />
        <TopGuideStat
          data={overview.topGuide}
          onlyOne={overview.topGuide ? overview.topGuide.count === overview.totalReadings : false}
          onTap={() => log("guide")}
        />
        <TopLensStat
          data={overview.topLens}
          totalDeep={overview.deepReadingsCount}
          onTap={() => log("lens")}
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