import {
  createFileRoute,
  Link,
  Outlet,
  useMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  type Pattern,
  type Weave,
  lifecycleOpacity,
  formatMonthSince,
} from "@/lib/patterns";
import { HelpIcon } from "@/components/help/HelpIcon";
import { useScrollCollapse } from "@/lib/use-scroll-collapse";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { LoadingText } from "@/components/ui/loading-text";
import { EmptyHero } from "@/components/ui/empty-hero";
import { ChevronRight } from "lucide-react";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
} from "@xyflow/react";

export const Route = createFileRoute("/threads")({
  head: () => ({
    meta: [
      { title: "Stories — Moonseed" },
      { name: "description", content: "Symbolic Stories weaving across your readings." },
    ],
  }),
  component: ThreadsLayout,
  errorComponent: ({ error }) => (
    <div style={{ padding: 24, fontStyle: "italic", opacity: 0.6, textAlign: "center" }}>
      <div>Something stirred and settled.</div>
      {error?.message && (
        <div style={{ fontSize: 12, opacity: 0.4, marginTop: 8 }}>{error.message}</div>
      )}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") window.location.href = "/";
        }}
        style={{
          marginTop: 16,
          background: "none",
          border: "none",
          color: "var(--accent, var(--gold))",
          cursor: "pointer",
          fontStyle: "italic",
        }}
      >
        Return home
      </button>
    </div>
  ),
});

type View = "active" | "weaves" | "archive";

function ThreadsLayout() {
  const matches = useMatches();
  const hasChildRoute = matches.some(
    (m) => m.routeId !== "/threads" && m.routeId.startsWith("/threads"),
  );
  if (hasChildRoute) return <Outlet />;
  return <ThreadsPage />;
}

type PatternReading = {
  id: string;
  pattern_id: string | null;
  card_ids: number[];
  question: string | null;
  created_at: string;
};

function ThreadsPage() {
  const { user } = useAuth();
  const [view, setView] = useState<View>("active");
  // FU-8 — iOS large-to-compact title collapse (window scroll).
  const collapseProgress = useScrollCollapse(undefined, 40);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [readings, setReadings] = useState<PatternReading[]>([]);
  const [loading, setLoading] = useState(true);
  // FU-14 — Reading detail modal state shared across active/archive views.
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

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

  const readingsByPattern = new Map<string, PatternReading[]>();
  for (const r of readings) {
    if (!r.pattern_id) continue;
    const arr = readingsByPattern.get(r.pattern_id) ?? [];
    arr.push(r);
    readingsByPattern.set(r.pattern_id, arr);
  }

  return (
    <div
      className="w-full"
      style={{
        height: "100dvh",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)",
        // DO-4 — lock to viewport width so long Story names or wide
        // children never let the page swipe sideways on mobile.
        overflowX: "hidden",
        maxWidth: "100vw",
      }}
    >
      <header
        className="page-header-glass sticky top-0"
        style={{
          zIndex: "var(--z-sticky-header)",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "0 var(--space-4, 16px)",
          }}
        >
          <div
            className="overflow-hidden flex items-center"
            style={{
              paddingTop: `${collapseProgress * 6}px`,
              paddingBottom: `${collapseProgress * 6}px`,
              maxHeight: `${collapseProgress * 32}px`,
              transition: "max-height 150ms ease-out, padding 150ms ease-out",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-sm)",
                color: "var(--color-foreground)",
                opacity: 0.9 * collapseProgress,
                margin: 0,
                lineHeight: 1,
                transition: "opacity 150ms ease-out",
              }}
            >
              Stories
              <HelpIcon articleId="stories" size={16} />
            </h1>
          </div>
          <nav
            aria-label="Stories views"
            style={{
              display: "flex",
              gap: "var(--space-5, 20px)",
              marginTop: "var(--space-3, 12px)",
            }}
          >
            {/* DL-9 — Weaves sub-view hidden from user-facing UI. The
                WeavesView component and weaves table remain so detection
                still runs in the background and can be re-surfaced
                without rebuilding. */}
            {(["active", "archive"] as View[]).map((v) => {
              const isActive = v === view;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  style={{
                    fontFamily: "var(--tab-font-family)",
                    fontStyle: "var(--tab-font-style)",
                    fontSize: "var(--tab-font-size)",
                    letterSpacing: "var(--tab-letter-spacing)",
                    textTransform: "var(--tab-text-transform)",
                    background: "none",
                    border: "none",
                    padding: "4px 0",
                    color: isActive ? "var(--tab-active-color)" : "var(--color-foreground)",
                    opacity: isActive ? "var(--tab-active-opacity)" : "var(--tab-inactive-opacity)",
                    borderBottom: isActive
                      ? "1px solid var(--tab-underline-color)"
                      : "1px solid transparent",
                    cursor: "pointer",
                  } as CSSProperties}
                  aria-current={isActive ? "page" : undefined}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-4, 16px)",
        }}
      >
        {/* FU-8 — Large title at top of content (iOS large-to-compact pattern) */}
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-display, 32px)",
            color: "var(--color-foreground)",
            opacity: 0.9,
            lineHeight: 1.25,
            margin: "0 0 var(--space-4, 16px) 0",
          }}
        >
          Stories
        </h1>
        {loading ? (
          <LoadingText>Listening for stories…</LoadingText>
        ) : view === "active" ? (
          <ActiveView
            patterns={active}
            readingsByPattern={readingsByPattern}
            onOpenReading={setOpenReadingId}
          />
        ) : (
          <ArchiveView
            patterns={archived}
            readingsByPattern={readingsByPattern}
            onOpenReading={setOpenReadingId}
          />
        )}
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

function PatternCard({
  pattern,
  readings,
  onOpenReading,
}: {
  pattern: Pattern;
  readings: PatternReading[];
  onOpenReading: (readingId: string) => void;
}) {
  const count = readings.length || pattern.reading_ids.length;
  return (
    <div
      style={{
        padding: "var(--space-4, 16px)",
        borderRadius: "var(--radius-lg, 14px)",
        background: "var(--surface-card, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
      }}
    >
      <Link
        to="/threads/$patternId"
        params={{ patternId: pattern.id }}
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
          cursor: "pointer",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          userSelect: "none",
        }}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3, 12px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--space-3, 12px)",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-sm, 17px)",
                color: "var(--color-foreground)",
                margin: 0,
                opacity: pattern.is_user_named ? 1 : 0.85,
              }}
            >
              {pattern.name}
            </h3>
            <span
              style={{
                fontSize: "var(--text-caption)",
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "var(--accent, var(--gold))",
                opacity: 0.6,
                whiteSpace: "nowrap",
              }}
            >
              {pattern.lifecycle_state} · {count} {count === 1 ? "reading" : "readings"}
            </span>
          </div>
          {pattern.description && pattern.description.trim() && (
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                lineHeight: 1.6,
                color: "var(--color-foreground)",
                opacity: 0.8,
                margin: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {pattern.description}
            </p>
          )}
        </section>
      </Link>
      {readings.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "var(--space-3, 12px) 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {readings.slice(0, 6).map((r) => (
            <li key={r.id}>
              <ReadingRow
                readingId={r.id}
                question={r.question}
                cardIds={r.card_ids}
                createdAt={r.created_at}
                onOpen={onOpenReading}
              />
            </li>
          ))}
          {readings.length > 6 && (
            <li
              style={{
                padding: "var(--space-2, 8px) var(--space-3, 12px)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                color: "var(--color-foreground)",
                opacity: 0.5,
              }}
            >
              + {readings.length - 6} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ActiveView({
  patterns,
  readingsByPattern,
  onOpenReading,
}: {
  patterns: Pattern[];
  readingsByPattern: Map<string, PatternReading[]>;
  onOpenReading: (readingId: string) => void;
}) {
  if (patterns.length === 0) {
    return (
      <EmptyHero
        title="No stories yet."
        subtitle={
          <>
            <p style={{ margin: 0 }}>
              Stories emerge when the same cards return across multiple readings.
            </p>
            <p style={{ marginTop: 8, opacity: 0.8 }}>
              Keep drawing — patterns reveal themselves over time.
            </p>
          </>
        }
      />
    );
  }
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: "var(--space-3, 12px)",
      }}
    >
      {patterns.map((p) => (
        <li key={p.id}>
          <PatternCard
            pattern={p}
            readings={readingsByPattern.get(p.id) ?? []}
            onOpenReading={onOpenReading}
          />
        </li>
      ))}
    </ul>
  );
}

function WeavesTeaser() {
  return (
    <div style={{ display: "grid", gap: "var(--space-4, 16px)" }}>
      <div
        style={{
          padding: "var(--space-4, 16px)",
          borderRadius: "var(--radius-lg, 14px)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          background: "var(--surface-card, rgba(255,255,255,0.03))",
          fontStyle: "italic",
          color: "var(--color-foreground)",
        }}
      >
        A weave is forming between your patterns…
      </div>
      <div
        aria-hidden="true"
        style={{
          height: 240,
          borderRadius: "var(--radius-lg, 14px)",
          background:
            "radial-gradient(circle at 30% 40%, rgba(212,175,90,0.25), transparent 60%), radial-gradient(circle at 70% 60%, rgba(120,90,200,0.2), transparent 55%)",
          filter: "blur(8px)",
        }}
      />
      <Link
        to="/settings/moon"
        style={{
          textAlign: "center",
          fontStyle: "italic",
          color: "var(--accent, var(--gold))",
          textDecoration: "none",
        }}
      >
        Your patterns are weaving. See the full tapestry.
      </Link>
    </div>
  );
}

function WeavesView({
  patterns,
  userId,
}: {
  patterns: Pattern[];
  userId: string | undefined;
}) {
  const [weaves, setWeaves] = useState<Weave[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("weaves")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setWeaves((data ?? []) as Weave[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Need at least 2 patterns to weave anything visible.
  if (loading) {
    return <LoadingText>Listening for weaves…</LoadingText>;
  }
  if (patterns.length < 2) {
    return (
      <div style={{ display: "grid", gap: "var(--space-4, 16px)" }}>
        <div
          style={{
            padding: "var(--space-4, 16px)",
            borderRadius: "var(--radius-lg, 14px)",
            border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
            background: "var(--surface-card, rgba(255,255,255,0.03))",
            fontStyle: "italic",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          A weave forms when two or more patterns begin to speak to each other.
          Yours are still gathering.
        </div>
        <div
          aria-hidden="true"
          style={{
            height: 240,
            borderRadius: "var(--radius-lg, 14px)",
            background:
              "radial-gradient(circle at 30% 40%, rgba(212,175,90,0.25), transparent 60%), radial-gradient(circle at 70% 60%, rgba(120,90,200,0.2), transparent 55%)",
            filter: "blur(8px)",
          }}
        />
      </div>
    );
  }

  // Layout patterns in a circle.
  const nodes: Node[] = patterns.map((p, i) => {
    const angle = (i / patterns.length) * Math.PI * 2;
    const radius = 180;
    return {
      id: p.id,
      position: { x: 240 + Math.cos(angle) * radius, y: 220 + Math.sin(angle) * radius },
      data: { label: p.name },
      style: {
        background: "rgba(212,175,90,0.08)",
        border: "1px solid rgba(212,175,90,0.45)",
        color: "var(--color-foreground)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: 13,
        borderRadius: 999,
        padding: "10px 16px",
        opacity: lifecycleOpacity(p.lifecycle_state),
      },
    };
  });

  // Edges from weaves: connect every pair of pattern_ids in each weave.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const w of weaves) {
    const ids = w.pattern_ids ?? [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("-");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          id: `${w.id}-${key}`,
          source: ids[i],
          target: ids[j],
          animated: true,
          style: {
            stroke: "rgba(212,175,90,0.5)",
            strokeWidth: 1,
          },
          label: w.title,
          labelStyle: {
            fill: "rgba(212,175,90,0.9)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 11,
          },
          labelBgStyle: { fill: "rgba(10,8,22,0.85)" },
        });
      }
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4, 16px)" }}>
      <p
        style={{
          fontStyle: "italic",
          color: "var(--color-foreground)",
          opacity: 0.7,
          margin: 0,
        }}
      >
        {weaves.length === 0
          ? "Stories gathering — no weaves yet."
          : `${weaves.length} weave${weaves.length === 1 ? "" : "s"} between your stories.`}
      </p>
      <div
        style={{
          height: 480,
          borderRadius: "var(--radius-lg, 14px)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          background:
            "radial-gradient(circle at 50% 50%, rgba(120,90,200,0.08), transparent 70%)",
          overflow: "hidden",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          panOnDrag
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background color="rgba(212,175,90,0.08)" gap={32} />
        </ReactFlow>
      </div>
    </div>
  );
}

function ArchiveView({
  patterns,
  readingsByPattern,
  onOpenReading,
}: {
  patterns: Pattern[];
  readingsByPattern: Map<string, PatternReading[]>;
  onOpenReading: (readingId: string) => void;
}) {
  if (patterns.length === 0) {
    return <EmptyHero title="Nothing has quieted yet." />;
  }
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: "var(--space-3, 12px)",
        opacity: 0.85,
      }}
    >
      {patterns.map((p) => (
        <li key={p.id}>
          <PatternCard
            pattern={p}
            readings={readingsByPattern.get(p.id) ?? []}
            onOpenReading={onOpenReading}
          />
        </li>
      ))}
    </ul>
  );
}