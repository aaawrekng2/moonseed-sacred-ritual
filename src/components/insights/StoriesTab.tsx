/**
 * Q52a — Stories sub-tab inside Insights.
 * Inlined from the former /stories page (sans page chrome).
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { type Pattern, formatMonthSince } from "@/lib/patterns";
import { LoadingText } from "@/components/ui/loading-text";
import { EmptyHero } from "@/components/ui/empty-hero";

type View = "active" | "archive";

type PatternReading = {
  id: string;
  pattern_id: string | null;
  card_ids: number[];
  question: string | null;
  created_at: string;
};

export function StoriesTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("active");
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [readings, setReadings] = useState<PatternReading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const [{ data: patternRows }, { data: readingRows }] = await Promise.all([
        supabase
          .from("patterns")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("readings")
          .select("id,pattern_id,card_ids,question,created_at")
          .eq("user_id", user.id)
          .not("pattern_id", "is", null)
          .is("archived_at", null)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setPatterns((patternRows ?? []) as Pattern[]);
      setReadings((readingRows ?? []) as PatternReading[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const active = patterns.filter((p) =>
    ["emerging", "active", "reawakened"].includes(p.lifecycle_state),
  );
  const archived = patterns.filter((p) =>
    ["quieting", "retired"].includes(p.lifecycle_state),
  );

  const readingCountByPattern = new Map<string, number>();
  for (const r of readings) {
    if (!r.pattern_id) continue;
    readingCountByPattern.set(
      r.pattern_id,
      (readingCountByPattern.get(r.pattern_id) ?? 0) + 1,
    );
  }

  // Auto-redirect when there's exactly one active story.
  useEffect(() => {
    if (loading) return;
    if (view !== "active") return;
    if (active.length === 1) {
      void navigate({
        to: "/stories/$patternId",
        params: { patternId: active[0].id },
      });
    }
  }, [loading, active, view, navigate]);

  return (
    <div className="flex flex-col gap-4 pb-12">
      <nav
        aria-label="Stories views"
        style={{
          display: "flex",
          gap: "var(--space-5, 20px)",
          marginBottom: "var(--space-2, 8px)",
        }}
      >
        {(["active", "archive"] as View[]).map((v) => {
          const isActive = v === view;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={
                {
                  fontFamily: "var(--tab-font-family)",
                  fontStyle: "var(--tab-font-style)",
                  fontSize: "var(--tab-font-size)",
                  letterSpacing: "var(--tab-letter-spacing)",
                  textTransform: "var(--tab-text-transform)",
                  background: "none",
                  border: "none",
                  padding: "4px 0",
                  color: isActive
                    ? "var(--tab-active-color)"
                    : "var(--color-foreground)",
                  opacity: isActive
                    ? "var(--tab-active-opacity)"
                    : "var(--tab-inactive-opacity)",
                  borderBottom: isActive
                    ? "1px solid var(--tab-underline-color)"
                    : "1px solid transparent",
                  cursor: "pointer",
                } as CSSProperties
              }
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          );
        })}
      </nav>
      {loading ? (
        <LoadingText>Listening for stories…</LoadingText>
      ) : view === "active" ? (
        <PatternList
          patterns={active}
          readingCountByPattern={readingCountByPattern}
          emptyTitle="No stories yet."
          emptySubtitle={
            <>
              <p style={{ margin: 0 }}>
                Stories emerge when the same cards return across multiple
                readings.
              </p>
              <p style={{ marginTop: 8, opacity: 0.8 }}>
                Keep drawing — patterns reveal themselves over time.
              </p>
            </>
          }
        />
      ) : (
        <PatternList
          patterns={archived}
          readingCountByPattern={readingCountByPattern}
          emptyTitle="Nothing has quieted yet."
          dim
        />
      )}
    </div>
  );
}

function PatternList({
  patterns,
  readingCountByPattern,
  emptyTitle,
  emptySubtitle,
  dim,
}: {
  patterns: Pattern[];
  readingCountByPattern: Map<string, number>;
  emptyTitle: string;
  emptySubtitle?: React.ReactNode;
  dim?: boolean;
}) {
  if (patterns.length === 0) {
    return <EmptyHero title={emptyTitle} subtitle={emptySubtitle} />;
  }
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        opacity: dim ? 0.85 : 1,
      }}
    >
      {patterns.map((p) => (
        <li key={p.id}>
          <PatternRow
            pattern={p}
            readingCount={readingCountByPattern.get(p.id) ?? 0}
          />
        </li>
      ))}
    </ul>
  );
}

function PatternRow({
  pattern,
  readingCount,
}: {
  pattern: Pattern;
  readingCount: number;
}) {
  const count = readingCount || pattern.reading_ids.length;
  return (
    <Link
      to="/stories/$patternId"
      params={{ patternId: pattern.id }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-3, 12px)",
        padding: "var(--space-4, 16px) 0",
        borderBottom:
          "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-sm, 17px)",
            color: "var(--color-foreground)",
            margin: 0,
            opacity: pattern.is_user_named ? 1 : 0.9,
          }}
        >
          {pattern.name}
        </p>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground)",
            opacity: 0.6,
          }}
        >
          {count} {count === 1 ? "reading" : "readings"} · since{" "}
          {formatMonthSince(pattern.created_at)}
        </p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground" />
    </Link>
  );
}