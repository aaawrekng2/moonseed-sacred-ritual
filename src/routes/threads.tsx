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

function ThreadsPage() {
  const { user } = useAuth();
  const [view, setView] = useState<View>("active");
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("patterns")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      setPatterns((data ?? []) as Pattern[]);
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
          <ActiveView patterns={active} />
        ) : view === "weaves" ? (
          <WeavesView patterns={active} userId={user?.id} />
        ) : (
          <ArchiveView patterns={archived} />
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function ActiveView({ patterns }: { patterns: Pattern[] }) {
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
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-3, 12px)" }}>
      {patterns.map((p) => (
        <li key={p.id}>
          <Link
            to="/threads/$patternId"
            params={{ patternId: p.id }}
            style={{
              display: "block",
              padding: "var(--space-4, 16px)",
              borderRadius: "var(--radius-lg, 14px)",
              background: "var(--surface-card, rgba(255,255,255,0.03))",
              border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-heading-md)",
                color: "var(--color-foreground)",
                opacity: p.is_user_named ? 1 : 0.75,
              }}
            >
              {p.name}
            </div>
            <div
              style={{
                fontSize: "var(--text-caption)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--accent, var(--gold))",
                opacity: lifecycleOpacity(p.lifecycle_state),
                marginTop: 4,
              }}
            >
              {lifecycleLabel(p.lifecycle_state)}
            </div>
            <div
              style={{
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground)",
                opacity: 0.6,
                marginTop: 6,
              }}
            >
              {p.lifecycle_state === "emerging"
                ? `Emerged ${formatMonthSince(p.created_at)}`
                : `Active since ${formatMonthSince(p.created_at)}`}{" "}
              · {p.reading_ids.length} reading{p.reading_ids.length === 1 ? "" : "s"}
            </div>
          </Link>
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

function ArchiveView({ patterns }: { patterns: Pattern[] }) {
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
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-3, 12px)" }}>
      {patterns.map((p) => (
        <li
          key={p.id}
          style={{
            padding: "var(--space-3, 12px) var(--space-4, 16px)",
            borderRadius: "var(--radius-md, 10px)",
            border: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
            opacity: 0.7,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-lg)",
              color: "var(--color-foreground)",
            }}
          >
            {p.name}
          </div>
          <div
            style={{
              fontSize: "var(--text-caption)",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--color-foreground)",
              opacity: 0.5,
              marginTop: 2,
            }}
          >
            {p.lifecycle_state === "retired" ? "Retired" : "Quieting"} ·{" "}
            {formatDateSpan(p.created_at, p.retired_at)}
          </div>
        </li>
      ))}
    </ul>
  );
}