import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  type Pattern,
  type Weave,
  lifecycleLabel,
  lifecycleOpacity,
  formatMonthSince,
  formatDateSpan,
} from "@/lib/patterns";
import { firstCardName, formatRelativeTime } from "@/lib/utils";
import { BottomNav } from "@/components/nav/BottomNav";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
} from "@xyflow/react";

export const Route = createFileRoute("/threads")({
  head: () => ({
    meta: [
      { title: "Threads — Moonseed" },
      { name: "description", content: "Symbolic patterns weaving across your readings." },
    ],
  }),
  component: ThreadsPage,
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
      className="min-h-[100dvh] w-full"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)" }}
    >
      <header
        className="sticky top-0 z-20 backdrop-blur-md"
        style={{
          background: "linear-gradient(to bottom, rgba(10,8,22,0.92), rgba(10,8,22,0.7))",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--space-4, 16px))",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "0 var(--space-4, 16px) var(--space-3, 12px)",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-heading-lg)",
              color: "var(--color-foreground)",
              margin: 0,
              letterSpacing: "0.02em",
            }}
          >
            Threads
          </h1>
          <nav
            aria-label="Threads views"
            style={{
              display: "flex",
              gap: "var(--space-5, 20px)",
              marginTop: "var(--space-3, 12px)",
            }}
          >
            {(["active", "weaves", "archive"] as View[]).map((v) => {
              const isActive = v === view;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  style={{
                    fontFamily: "var(--font-display, inherit)",
                    fontSize: "var(--text-caption)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    background: "none",
                    border: "none",
                    padding: "4px 0",
                    color: isActive ? "var(--accent, var(--gold))" : "var(--color-foreground)",
                    opacity: isActive ? 1 : 0.55,
                    borderBottom: isActive
                      ? "1px solid var(--accent, var(--gold))"
                      : "1px solid transparent",
                    cursor: "pointer",
                  }}
                  aria-current={isActive ? "page" : undefined}
                >
                  {v}
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
        {loading ? (
          <p style={{ opacity: 0.5, fontStyle: "italic" }}>Listening for threads…</p>
        ) : view === "active" ? (
          <ActiveView patterns={active} readingsByPattern={readingsByPattern} />
        ) : view === "weaves" ? (
          <WeavesView patterns={active} userId={user?.id} />
        ) : (
          <ArchiveView patterns={archived} readingsByPattern={readingsByPattern} />
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function PatternCard({
  pattern,
  readings,
}: {
  pattern: Pattern;
  readings: PatternReading[];
}) {
  const count = readings.length || pattern.reading_ids.length;
  return (
    <Link
      to="/threads/$patternId"
      params={{ patternId: pattern.id }}
      style={{
        display: "block",
        padding: "var(--space-4, 16px)",
        borderRadius: "var(--radius-lg, 14px)",
        background: "var(--surface-card, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
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
        {readings.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1, 6px)",
            }}
          >
            {readings.slice(0, 6).map((r) => {
              const hasQuestion = !!r.question?.trim();
              const label = hasQuestion
                ? `"${r.question!.trim()}"`
                : firstCardName(r.card_ids);
              return (
                <li key={r.id}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "var(--space-3, 12px)",
                      width: "100%",
                      padding: "var(--space-2, 8px) var(--space-3, 12px)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: hasQuestion ? "italic" : "normal",
                        fontSize: "var(--text-body-sm)",
                        color: "var(--color-foreground)",
                        opacity: 0.85,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-caption)",
                        textTransform: "uppercase",
                        letterSpacing: "0.15em",
                        color: "var(--color-foreground)",
                        opacity: 0.5,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatRelativeTime(r.created_at)}
                    </span>
                  </div>
                </li>
              );
            })}
            {readings.length > 6 && (
              <li
                style={{
                  padding: "0 var(--space-3, 12px)",
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
      </section>
    </Link>
  );
}

function ActiveView({
  patterns,
  readingsByPattern,
}: {
  patterns: Pattern[];
  readingsByPattern: Map<string, PatternReading[]>;
}) {
  if (patterns.length === 0) {
    return (
      <p
        style={{
          fontStyle: "italic",
          color: "var(--color-foreground)",
          opacity: 0.5,
          textAlign: "center",
          padding: "var(--space-6, 32px) 0",
        }}
      >
        No active patterns yet. Keep drawing — they emerge in their own time.
      </p>
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
          <PatternCard pattern={p} readings={readingsByPattern.get(p.id) ?? []} />
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
    return <p style={{ opacity: 0.4, fontStyle: "italic" }}>Listening for weaves…</p>;
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
          ? "Patterns gathering — no weaves yet."
          : `${weaves.length} weave${weaves.length === 1 ? "" : "s"} between your patterns.`}
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
}: {
  patterns: Pattern[];
  readingsByPattern: Map<string, PatternReading[]>;
}) {
  if (patterns.length === 0) {
    return (
      <p
        style={{
          fontStyle: "italic",
          color: "var(--color-foreground)",
          opacity: 0.4,
          textAlign: "center",
          padding: "var(--space-6, 32px) 0",
        }}
      >
        Nothing has quieted yet.
      </p>
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
        opacity: 0.85,
      }}
    >
      {patterns.map((p) => (
        <li key={p.id}>
          <PatternCard pattern={p} readings={readingsByPattern.get(p.id) ?? []} />
        </li>
      ))}
    </ul>
  );
}