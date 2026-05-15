/**
 * Q52a — /numerology page shell.
 * 6 sub-tabs; only Today is wired in Q52a.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { useScrollCollapse } from "@/lib/use-scroll-collapse";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";
import {
  DEFAULT_FILTERS,
  type InsightsFilters,
  type TimeRange,
} from "@/lib/insights.types";
import { NumerologyTodayTab } from "@/components/numerology/NumerologyTodayTab";
import { NumerologyBlueprintTab } from "@/components/numerology/NumerologyBlueprintTab";
import { NumerologyCyclesTab } from "@/components/numerology/NumerologyCyclesTab";
import { NumerologyPatternsTab } from "@/components/numerology/NumerologyPatternsTab";
import { NumerologyStalkersTab } from "@/components/numerology/NumerologyStalkersTab";
import { NumerologyReadingTab } from "@/components/numerology/NumerologyReadingTab";

export const Route = createFileRoute("/numerology")({
  head: () => ({
    meta: [
      { title: "Numerology — Moonseed" },
      {
        name: "description",
        content: "Your numbers, your cycles, your tarot — woven together.",
      },
    ],
  }),
  component: NumerologyPage,
});

type Tab = "today" | "blueprint" | "cycles" | "patterns" | "stalkers" | "reading";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "blueprint", label: "Blueprint" },
  { id: "cycles", label: "Cycles" },
  { id: "patterns", label: "Patterns" },
  { id: "stalkers", label: "Stalkers" },
  { id: "reading", label: "Reading" },
];

function NumerologyPage() {
  const { user } = useAuth();
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [birthName, setBirthName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
  const scrollRef = useRef<HTMLElement | null>(null);
  const collapseProgress = useScrollCollapse(scrollRef, 40);
  const [userTags, setUserTags] = useState<
    Array<{ id: string; name: string; usage_count: number }>
  >([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_tags")
        .select("id, name, usage_count")
        .eq("user_id", user.id)
        .order("usage_count", { ascending: false })
        .limit(50);
      if (cancelled) return;
      setUserTags(
        (data ?? []) as Array<{ id: string; name: string; usage_count: number }>,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("birth_date, birth_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as
        | { birth_date?: string | null; birth_name?: string | null }
        | null;
      setBirthDate(row?.birth_date ?? null);
      setBirthName(row?.birth_name ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return null;

  if (!birthDate) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-6, 24px)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-display, 32px)",
            margin: "0 0 var(--space-3, 12px) 0",
          }}
        >
          Numerology
        </h1>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.85,
            margin: "0 0 var(--space-5, 20px) 0",
          }}
        >
          Numerology weaves through every tarot card. Each card carries a
          number, and your birth date carries the architecture of your life.
          We bring them together here.
        </p>
        <div
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md, 10px)",
            padding: "var(--space-4, 16px)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3, 12px)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            Add your birth date to begin.
          </p>
          <Link
            to="/settings/blueprint"
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              borderRadius: "999px",
              background: "color-mix(in oklab, var(--gold) 14%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm, 13px)",
              textDecoration: "none",
            }}
          >
            Open Blueprint
          </Link>
        </div>
      </main>
    );
  }

  const showFilters =
    tab === "patterns" || tab === "stalkers" || tab === "reading";

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
    <div
      className="relative flex h-dvh flex-col"
      style={{ background: "var(--background)" }}
    >
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
            Numerology
          </h1>
        </div>
        {showFilters && (
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
                { value: "365d", label: "Last 365 days" },
                { value: "all", label: "All time" },
              ],
              onChange: (v) =>
                setFilters({ ...filters, timeRange: v as TimeRange }),
            }}
            userTags={userTags}
          />
        )}
        <HorizontalScroll
          className="py-2"
          contentClassName="items-center gap-6 px-4"
        >
          {TABS.map((t) => {
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
                    color: active
                      ? "var(--tab-active-color)"
                      : "var(--color-foreground)",
                    opacity: active
                      ? "var(--tab-active-opacity)"
                      : "var(--tab-inactive-opacity)",
                    borderBottom: active
                      ? "1px solid var(--tab-underline-color)"
                      : "1px solid transparent",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  } as CSSProperties
                }
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
          Numerology
        </h1>
        {tab === "today" && (
          <NumerologyTodayTab birthDate={birthDate} birthName={birthName} />
        )}
        {tab === "blueprint" && (
          <NumerologyBlueprintTab birthDate={birthDate} birthName={birthName} />
        )}
        {tab === "cycles" && <NumerologyCyclesTab birthDate={birthDate} />}
        {tab === "patterns" && (
          <NumerologyPatternsTab filters={filters} onFiltersChange={setFilters} />
        )}
        {tab === "stalkers" && (
          <NumerologyStalkersTab filters={filters} birthDate={birthDate} />
        )}
        {tab === "reading" && <NumerologyReadingTab filters={filters} />}
      </main>
    </div>
  );
}
