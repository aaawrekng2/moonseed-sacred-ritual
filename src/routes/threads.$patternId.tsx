import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Pencil, Archive, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  type Pattern,
  type Weave,
  lifecycleLabel,
  lifecycleOpacity,
  formatMonthSince,
} from "@/lib/patterns";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export const Route = createFileRoute("/threads/$patternId")({
  component: PatternChamber,
});

function PatternChamber() {
  const { patternId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [retiring, setRetiring] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("patterns")
        .select("*")
        .eq("id", patternId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setPattern(data as Pattern);
        setDraftName((data as Pattern).name);
        setDraftNote((data as Pattern).description ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, patternId]);

  const saveName = async () => {
    if (!pattern) return;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === pattern.name) {
      setEditing(false);
      return;
    }
    const { error } = await supabase
      .from("patterns")
      .update({ name: trimmed, is_user_named: true })
      .eq("id", pattern.id);
    if (!error) {
      setPattern({ ...pattern, name: trimmed, is_user_named: true });
    }
    setEditing(false);
  };

  const saveNote = async () => {
    if (!pattern) return;
    const next = draftNote.trim() ? draftNote : null;
    if ((pattern.description ?? null) === next) {
      setNoteOpen(false);
      return;
    }
    setSavingNote(true);
    const { error } = await supabase
      .from("patterns")
      .update({ description: next })
      .eq("id", pattern.id);
    setSavingNote(false);
    if (!error) {
      setPattern({ ...pattern, description: next });
      setNoteOpen(false);
    }
  };

  const retirePattern = async () => {
    if (!pattern) return;
    if (pattern.lifecycle_state === "retired") return;
    const ok = window.confirm(
      `Retire "${pattern.name}"? It will quiet down and stop surfacing in active views. You can revisit it any time.`,
    );
    if (!ok) return;
    setRetiring(true);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("patterns")
      .update({ lifecycle_state: "retired", retired_at: nowIso })
      .eq("id", pattern.id);
    setRetiring(false);
    if (!error) {
      setPattern({
        ...pattern,
        lifecycle_state: "retired",
        retired_at: nowIso,
      });
    }
  };

  if (!pattern) {
    return (
      <div style={{ padding: 24, fontStyle: "italic", opacity: 0.5 }}>
        Listening…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        maxWidth: 720,
        margin: "0 auto",
        padding: "calc(env(safe-area-inset-top) + var(--space-4, 16px)) var(--space-4, 16px) calc(env(safe-area-inset-bottom) + 80px)",
      }}
    >
      <button
        type="button"
        onClick={() => void navigate({ to: "/threads" })}
        style={{
          background: "none",
          border: "none",
          color: "var(--color-foreground)",
          opacity: 0.6,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          cursor: "pointer",
          padding: 0,
          marginBottom: "var(--space-4, 16px)",
        }}
      >
        <ChevronLeft size={16} /> Threads
      </button>

      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraftName(pattern.name);
              setEditing(false);
            }
          }}
          placeholder="What is this pattern asking of you?"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-lg)",
            color: "var(--color-foreground)",
            padding: 0,
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            textAlign: "left",
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-lg)",
            color: "var(--color-foreground)",
            opacity: pattern.is_user_named ? 1 : 0.75,
            cursor: "text",
          }}
          aria-label="Rename pattern"
        >
          {pattern.name}
        </button>
      )}

      <div
        style={{
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--accent, var(--gold))",
          opacity: lifecycleOpacity(pattern.lifecycle_state),
          marginTop: 8,
        }}
      >
        {lifecycleLabel(pattern.lifecycle_state)}
      </div>
      <div
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.6,
          marginTop: 4,
        }}
      >
        Since {formatMonthSince(pattern.created_at)} · {pattern.reading_ids.length} reading
        {pattern.reading_ids.length === 1 ? "" : "s"}
      </div>

      <PatternActions
        onRename={() => setEditing(true)}
        onToggleNote={() => setNoteOpen((v) => !v)}
        onRetire={retirePattern}
        retiring={retiring}
        retired={pattern.lifecycle_state === "retired"}
        hasNote={!!(pattern.description && pattern.description.trim())}
        noteOpen={noteOpen}
      />

      {noteOpen ? (
        <div style={{ marginTop: 12 }}>
          <textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="What does this pattern mean to you right now?"
            rows={4}
            style={{
              width: "100%",
              background: "rgba(212,175,90,0.04)",
              border: "1px solid rgba(212,175,90,0.25)",
              borderRadius: 8,
              padding: 10,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              outline: "none",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={saveNote}
              disabled={savingNote}
              style={chamberPrimaryBtn}
            >
              {savingNote ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftNote(pattern.description ?? "");
                setNoteOpen(false);
              }}
              style={chamberGhostBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        pattern.description && pattern.description.trim() && (
          <p
            style={{
              marginTop: 12,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.75,
              whiteSpace: "pre-wrap",
            }}
          >
            {pattern.description}
          </p>
        )
      )}

      <ChamberTimeline readingIds={pattern.reading_ids} />

      <ChamberWeaveGraph pattern={pattern} userId={user?.id} />
    </div>
  );
}

const chamberActionBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  border: "1px solid rgba(212,175,90,0.3)",
  color: "var(--color-foreground)",
  borderRadius: 999,
  padding: "6px 12px",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption)",
  letterSpacing: "0.06em",
  cursor: "pointer",
  opacity: 0.85,
};

const chamberPrimaryBtn: React.CSSProperties = {
  ...chamberActionBtn,
  background: "rgba(212,175,90,0.18)",
  borderColor: "rgba(212,175,90,0.6)",
  opacity: 1,
};

const chamberGhostBtn: React.CSSProperties = {
  ...chamberActionBtn,
  border: "none",
  opacity: 0.6,
};

function PatternActions({
  onRename,
  onToggleNote,
  onRetire,
  retiring,
  retired,
  hasNote,
  noteOpen,
}: {
  onRename: () => void;
  onToggleNote: () => void;
  onRetire: () => void;
  retiring: boolean;
  retired: boolean;
  hasNote: boolean;
  noteOpen: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 16,
      }}
    >
      <button type="button" onClick={onRename} style={chamberActionBtn}>
        <Pencil size={12} /> Rename
      </button>
      <button type="button" onClick={onToggleNote} style={chamberActionBtn}>
        <StickyNote size={12} />
        {noteOpen ? "Close note" : hasNote ? "Edit note" : "Add a note"}
      </button>
      <button
        type="button"
        onClick={onRetire}
        disabled={retired || retiring}
        style={{
          ...chamberActionBtn,
          opacity: retired ? 0.4 : retiring ? 0.6 : 0.85,
          cursor: retired ? "default" : "pointer",
        }}
        title={retired ? "Already retired" : "Retire this pattern"}
      >
        <Archive size={12} /> {retired ? "Retired" : retiring ? "Retiring…" : "Retire"}
      </button>
    </div>
  );
}

function ChamberTimeline({ readingIds }: { readingIds: string[] }) {
  const [rows, setRows] = useState<
    Array<{ id: string; created_at: string; spread_type: string; card_ids: number[]; interpretation: string | null }>
  >([]);

  useEffect(() => {
    if (readingIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("readings")
        .select("id, created_at, spread_type, card_ids, interpretation")
        .in("id", readingIds)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setRows(
        (data ?? []).map((r) => ({
          id: r.id as string,
          created_at: r.created_at as string,
          spread_type: r.spread_type as string,
          card_ids: (r.card_ids as number[]) ?? [],
          interpretation: (r.interpretation as string | null) ?? null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [readingIds]);

  if (rows.length === 0) {
    return (
      <p
        style={{
          marginTop: "var(--space-6, 32px)",
          fontStyle: "italic",
          opacity: 0.5,
        }}
      >
        No readings linked yet.
      </p>
    );
  }

  return (
    <ol
      style={{
        listStyle: "none",
        padding: 0,
        margin: "var(--space-6, 32px) 0 0",
        display: "grid",
        gap: "var(--space-4, 16px)",
      }}
    >
      {rows.map((r) => {
        const snippet = (r.interpretation ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .split(/(?<=\.)\s+/)
          .slice(0, 2)
          .join(" ");
        return (
          <li key={r.id}>
            <Link
              to="/journal"
              search={{ readingId: r.id } as never}
              style={{ textDecoration: "none", color: "inherit", display: "block" }}
            >
              <div
                style={{
                  fontSize: "var(--text-caption)",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  opacity: 0.55,
                }}
              >
                {new Date(r.created_at).toLocaleDateString()}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body)",
                  marginTop: 2,
                  opacity: 0.85,
                }}
              >
                {r.spread_type} · {r.card_ids.length} card{r.card_ids.length === 1 ? "" : "s"}
              </div>
              {snippet && (
                <div
                  style={{
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm)",
                    opacity: 0.65,
                    marginTop: 4,
                  }}
                >
                  {snippet}
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Chamber weave graph (Phase 9 step 7) ---------- */

/**
 * Per-pattern weave visualization.
 *
 * Center node = the current pattern.
 * Outer ring  = sibling patterns connected via any weave that includes
 *               this pattern's id.
 * Inner ring  = the readings inside this pattern (small satellite nodes,
 *               clickable through to the journal).
 *
 * Hidden entirely when there's nothing to weave (no siblings AND fewer
 * than 2 readings) — the chamber should never show an empty graph
 * placeholder.
 */
function ChamberWeaveGraph({
  pattern,
  userId,
}: {
  pattern: Pattern;
  userId: string | undefined;
}) {
  const navigate = useNavigate();
  const [weaves, setWeaves] = useState<Weave[]>([]);
  const [siblings, setSiblings] = useState<
    Record<string, { id: string; name: string; lifecycle_state: string }>
  >({});
  const [readings, setReadings] = useState<
    Array<{ id: string; created_at: string; spread_type: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      // Weaves that include this pattern.
      const { data: weaveRows } = await supabase
        .from("weaves")
        .select("*")
        .eq("user_id", userId)
        .contains("pattern_ids", [pattern.id]);
      const ws = ((weaveRows ?? []) as Weave[]).filter((w) =>
        (w.pattern_ids ?? []).includes(pattern.id),
      );

      // Sibling pattern ids = every other pattern that appears in any of
      // those weaves.
      const siblingIds = new Set<string>();
      for (const w of ws) {
        for (const pid of w.pattern_ids ?? []) {
          if (pid !== pattern.id) siblingIds.add(pid);
        }
      }

      let siblingMap: Record<string, { id: string; name: string; lifecycle_state: string }> = {};
      if (siblingIds.size > 0) {
        const { data: sibRows } = await supabase
          .from("patterns")
          .select("id, name, lifecycle_state")
          .in("id", Array.from(siblingIds));
        for (const s of (sibRows ?? []) as Array<{
          id: string;
          name: string;
          lifecycle_state: string;
        }>) {
          siblingMap[s.id] = s;
        }
      }

      // Readings inside this pattern (small satellite nodes).
      let readingRows: Array<{ id: string; created_at: string; spread_type: string }> = [];
      if (pattern.reading_ids.length > 0) {
        const { data: rRows } = await supabase
          .from("readings")
          .select("id, created_at, spread_type")
          .in("id", pattern.reading_ids)
          .order("created_at", { ascending: false });
        readingRows = ((rRows ?? []) as Array<{
          id: string;
          created_at: string;
          spread_type: string;
        }>);
      }

      if (cancelled) return;
      setWeaves(ws);
      setSiblings(siblingMap);
      setReadings(readingRows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, pattern.id, pattern.reading_ids]);

  if (loading) return null;

  const siblingList = Object.values(siblings);
  // Nothing meaningful to draw — bail.
  if (siblingList.length === 0 && readings.length < 2) return null;

  const activeId = hoveredId ?? focusId;
  const hasActive = activeId !== null;

  const CENTER_X = 260;
  const CENTER_Y = 240;
  const SIBLING_RADIUS = 180;
  const READING_RADIUS = 90;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Center pattern node.
  nodes.push({
    id: `p:${pattern.id}`,
    position: { x: CENTER_X - 90, y: CENTER_Y - 22 },
    data: { label: pattern.name },
    draggable: false,
    selectable: false,
    style: {
      width: 180,
      background: "rgba(212,175,90,0.14)",
      border: "1px solid rgba(212,175,90,0.7)",
      color: "var(--color-foreground)",
      fontFamily: "var(--font-serif)",
      fontStyle: "italic",
      fontSize: 14,
      borderRadius: 999,
      padding: "10px 14px",
      textAlign: "center",
      opacity: lifecycleOpacity(pattern.lifecycle_state),
    },
  });

  // Sibling pattern nodes around outer ring.
  siblingList.forEach((s, i) => {
    const angle = (i / Math.max(siblingList.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const x = CENTER_X + Math.cos(angle) * SIBLING_RADIUS - 70;
    const y = CENTER_Y + Math.sin(angle) * SIBLING_RADIUS - 18;
    const isActive = activeId === s.id;
    const dim = hasActive && !isActive;
    const baseOp = lifecycleOpacity(
      s.lifecycle_state as Pattern["lifecycle_state"],
    );
    nodes.push({
      id: `p:${s.id}`,
      position: { x, y },
      data: { label: s.name },
      draggable: false,
      style: {
        width: 140,
        background: isActive
          ? "rgba(212,175,90,0.22)"
          : "rgba(212,175,90,0.06)",
        border: isActive
          ? "1px solid rgba(212,175,90,0.95)"
          : "1px solid rgba(212,175,90,0.4)",
        color: "var(--color-foreground)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: 12,
        borderRadius: 999,
        padding: "8px 12px",
        textAlign: "center",
        opacity: dim ? baseOp * 0.3 : baseOp,
        cursor: "pointer",
        boxShadow: isActive ? "0 0 14px rgba(212,175,90,0.55)" : "none",
        transition:
          "opacity 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
      },
    });
  });

  // Edges from weaves (only those touching this pattern → siblings).
  const seenEdge = new Set<string>();
  for (const w of weaves) {
    for (const pid of w.pattern_ids ?? []) {
      if (pid === pattern.id) continue;
      if (!siblings[pid]) continue;
      const key = `${w.id}-${pid}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      const isActiveEdge = activeId === pid;
      const dimEdge = hasActive && !isActiveEdge;
      edges.push({
        id: key,
        source: `p:${pattern.id}`,
        target: `p:${pid}`,
        animated: isActiveEdge || !hasActive,
        label: w.title,
        style: {
          stroke: isActiveEdge
            ? "rgba(212,175,90,0.95)"
            : "rgba(212,175,90,0.55)",
          strokeWidth: isActiveEdge ? 2 : 1,
          opacity: dimEdge ? 0.18 : 1,
          transition: "opacity 180ms ease, stroke 180ms ease",
        },
        labelStyle: {
          fill: isActiveEdge
            ? "rgba(232,200,120,1)"
            : "rgba(212,175,90,0.9)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 10,
          opacity: dimEdge ? 0.25 : 1,
        },
        labelBgStyle: { fill: "rgba(10,8,22,0.85)" },
      });
    }
  }

  // Readings as small inner satellites around the center.
  readings.forEach((r, i) => {
    const angle = (i / Math.max(readings.length, 1)) * Math.PI * 2;
    const x = CENTER_X + Math.cos(angle) * READING_RADIUS - 6;
    const y = CENTER_Y + Math.sin(angle) * READING_RADIUS - 6;
    const dimReading = hasActive;
    nodes.push({
      id: `r:${r.id}`,
      position: { x, y },
      data: {
        label: new Date(r.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      },
      draggable: false,
      style: {
        width: 12,
        height: 12,
        background: "rgba(212,175,90,0.85)",
        border: "none",
        borderRadius: "50%",
        padding: 0,
        fontSize: 0, // hide label visually but keep for a11y
        color: "transparent",
        boxShadow: "0 0 8px rgba(212,175,90,0.5)",
        opacity: dimReading ? 0.25 : 1,
        cursor: "pointer",
        transition: "opacity 180ms ease",
      },
    });
    edges.push({
      id: `r-edge:${r.id}`,
      source: `p:${pattern.id}`,
      target: `r:${r.id}`,
      style: {
        stroke: "rgba(212,175,90,0.18)",
        strokeWidth: 1,
        opacity: dimReading ? 0.1 : 1,
        transition: "opacity 180ms ease",
      },
    });
  });

  return (
    <section
      aria-label="Pattern weave graph"
      style={{ marginTop: "var(--space-6, 32px)" }}
    >
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          color: "var(--color-foreground)",
          opacity: 0.7,
          margin: "0 0 var(--space-3, 12px)",
        }}
      >
        {siblingList.length > 0
          ? `Woven with ${siblingList.length} other pattern${siblingList.length === 1 ? "" : "s"}`
          : "This pattern stands alone — for now."}
      </h2>
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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.id.startsWith("p:") && node.id !== `p:${pattern.id}`) {
              const sid = node.id.slice(2);
              window.location.assign(`/threads/${sid}`);
            } else if (node.id.startsWith("r:")) {
              const rid = node.id.slice(2);
              window.location.assign(`/journal?readingId=${rid}`);
            }
          }}
        >
          <Background color="rgba(212,175,90,0.08)" gap={32} />
        </ReactFlow>
      </div>
    </section>
  );
}