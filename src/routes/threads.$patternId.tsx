import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  generatePatternInterpretation,
  type PatternInterpretation,
} from "@/lib/pattern-interpretation.functions";
import { ChevronLeft, Pencil, Archive, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { EmptyHero } from "@/components/ui/empty-hero";
import { LoadingText } from "@/components/ui/loading-text";
import { formatDateShort, formatDateLong } from "@/lib/dates";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import {
  type Pattern,
  type PatternLifecycleState,
  type Weave,
  lifecycleLabel,
  lifecycleOpacity,
  lifecycleColor,
  lifecycleEdgeColor,
  formatMonthSince,
} from "@/lib/patterns";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import { useConfirm } from "@/hooks/use-confirm";

const VIEWPORT_STORAGE_PREFIX = "weave-viewport:";

function loadViewport(patternId: string): Viewport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEWPORT_STORAGE_PREFIX + patternId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.x === "number" &&
      typeof parsed?.y === "number" &&
      typeof parsed?.zoom === "number"
    ) {
      return parsed as Viewport;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveViewport(patternId: string, vp: Viewport) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      VIEWPORT_STORAGE_PREFIX + patternId,
      JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom }),
    );
  } catch {
    // ignore
  }
}

export const Route = createFileRoute("/threads/$patternId")({
  component: PatternChamber,
  errorComponent: ({ error }) => (
    <div style={{ padding: 24, fontStyle: "italic", opacity: 0.6, textAlign: "center" }}>
      <div>Something stirred and settled.</div>
      {error?.message && (
        <div style={{ fontSize: 12, opacity: 0.4, marginTop: 8 }}>{error.message}</div>
      )}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") window.location.href = "/threads";
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
        Return to threads
      </button>
    </div>
  ),
});

function PatternChamber() {
  const { patternId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [retireStep, setRetireStep] = useState<0 | 1 | 2>(0);
  const [retireConfirmText, setRetireConfirmText] = useState("");
  const [undoRetire, setUndoRetire] = useState<{
    prevLifecycle: PatternLifecycleState;
    prevRetiredAt: string | null;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  // FU-14 — Reading detail modal state for the pattern timeline.
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);
  // 9-6-AH continuation — synthesis is fetched once by PatternSynthesis,
  // then propagated here so per-reading connectors can flow into the
  // ChamberTimeline excerpt cards.
  const [synthesis, setSynthesis] = useState<PatternInterpretation | null>(null);
  // 26-05-08-J — lift the full-row reading fetch up so EvidenceSection,
  // PatternStrengthBanner, and ChamberTimeline all share one query.
  const [chamberReadings, setChamberReadings] = useState<Array<{
    id: string;
    created_at: string;
    spread_type: string;
    card_ids: number[];
    question: string | null;
    note: string | null;
    interpretation: string | null;
  }> | null>(null);

  useEffect(() => {
    if (!pattern || pattern.reading_ids.length === 0) {
      setChamberReadings([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("readings")
        .select("id, created_at, spread_type, card_ids, question, note, interpretation")
        .in("id", pattern.reading_ids)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setChamberReadings(
        (data ?? []).map((r) => ({
          id: r.id as string,
          created_at: r.created_at as string,
          spread_type: r.spread_type as string,
          card_ids: (r.card_ids as number[]) ?? [],
          question: (r.question as string | null) ?? null,
          note: (r.note as string | null) ?? null,
          interpretation: (r.interpretation as string | null) ?? null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [pattern?.id, pattern?.reading_ids?.join(",")]);

  const noteHasUnsavedChanges = () => {
    const original = (pattern?.description ?? "").trim();
    return draftNote.trim() !== original;
  };

  const closeNoteEditor = async () => {
    if (noteHasUnsavedChanges()) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description: "Your edits to this note will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!ok) return;
    }
    setDraftNote(pattern?.description ?? "");
    setNoteOpen(false);
  };

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

  const openRetireFlow = () => {
    if (!pattern) return;
    if (pattern.lifecycle_state === "retired") return;
    setRetireConfirmText("");
    setRetireStep(1);
  };

  const cancelRetireFlow = () => {
    setRetireStep(0);
    setRetireConfirmText("");
  };

  const confirmRetirePattern = async () => {
    if (!pattern) return;
    if (pattern.lifecycle_state === "retired") return;
    const prevLifecycle = pattern.lifecycle_state;
    const prevRetiredAt = pattern.retired_at;
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
      setRetireStep(0);
      setRetireConfirmText("");
      setUndoRetire({ prevLifecycle, prevRetiredAt });
    }
  };

  const undoRetirePattern = async () => {
    if (!pattern || !undoRetire) return;
    setUndoing(true);
    const { error } = await supabase
      .from("patterns")
      .update({
        lifecycle_state: undoRetire.prevLifecycle,
        retired_at: undoRetire.prevRetiredAt,
      })
      .eq("id", pattern.id);
    setUndoing(false);
    if (!error) {
      setPattern({
        ...pattern,
        lifecycle_state: undoRetire.prevLifecycle,
        retired_at: undoRetire.prevRetiredAt,
      });
      setUndoRetire(null);
    }
  };

  if (!pattern) {
    return (
      <div style={{ padding: 24 }}>
        <LoadingText>Loading story…</LoadingText>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding:
            "calc(env(safe-area-inset-top) + var(--space-4, 16px)) var(--space-4, 16px) calc(var(--bottom-nav-height, 72px) + env(safe-area-inset-bottom, 0px) + var(--space-8, 48px))",
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
        onToggleNote={() => {
          if (noteOpen) closeNoteEditor();
          else setNoteOpen(true);
        }}
        onRetire={openRetireFlow}
        retiring={retiring}
        retired={pattern.lifecycle_state === "retired"}
        hasNote={!!(pattern.description && pattern.description.trim())}
        noteOpen={noteOpen}
      />

      {undoRetire && pattern.lifecycle_state === "retired" && (
        <div
          role="status"
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            border: "1px solid rgba(212,175,90,0.35)",
            background: "rgba(212,175,90,0.08)",
            borderRadius: 8,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
          }}
        >
          <span style={{ opacity: 0.85 }}>
            "{pattern.name}" retired.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={undoRetirePattern}
              disabled={undoing}
              style={{
                ...chamberPrimaryBtn,
                opacity: undoing ? 0.6 : 1,
              }}
            >
              {undoing ? "Restoring…" : "Undo"}
            </button>
            <button
              type="button"
              onClick={() => setUndoRetire(null)}
              style={chamberGhostBtn}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {retireStep > 0 && pattern && (
        <RetireConfirmModal
          step={retireStep as 1 | 2}
          patternName={pattern.name}
          confirmText={retireConfirmText}
          onConfirmTextChange={setRetireConfirmText}
          onAdvance={() => setRetireStep(2)}
          onConfirm={confirmRetirePattern}
          onCancel={cancelRetireFlow}
          retiring={retiring}
        />
      )}

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
              onClick={closeNoteEditor}
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

      {/* 9-6-AF — synthesis → card evidence → weaves → readings list at bottom. */}
      <PatternSynthesis
        patternId={pattern.id}
        readingCount={pattern.reading_ids.length}
        onLoaded={(data) => setSynthesis(data)}
      />

      <ChamberCardEvidence patternId={pattern.id} userId={user?.id} />

      <ChamberWeaveGraph pattern={pattern} userId={user?.id} />

      <ChamberTimeline
        readingIds={pattern.reading_ids}
        onOpenReading={setOpenReadingId}
        readingConnections={synthesis?.readingConnections ?? []}
      />

      {openReadingId && (
        <ReadingDetailModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
      </div>
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

function RetireConfirmModal({
  step,
  patternName,
  confirmText,
  onConfirmTextChange,
  onAdvance,
  onConfirm,
  onCancel,
  retiring,
}: {
  step: 1 | 2;
  patternName: string;
  confirmText: string;
  onConfirmTextChange: (s: string) => void;
  onAdvance: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  retiring: boolean;
}) {
  const matches = confirmText.trim().toLowerCase() === "retire";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="retire-modal-title"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          width: "100%",
          background: "var(--color-background, #0b0b10)",
          border: "1px solid rgba(212,175,90,0.4)",
          borderRadius: 12,
          padding: 20,
          fontFamily: "var(--font-serif)",
          color: "var(--color-foreground)",
        }}
      >
        <h2
          id="retire-modal-title"
          style={{
            margin: 0,
            fontStyle: "italic",
            fontSize: "var(--text-heading-sm, 17px)",
            color: "var(--gold)",
          }}
        >
          {step === 1 ? "Retire this pattern?" : "Are you sure?"}
        </h2>
        <p
          style={{
            marginTop: 10,
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.8,
            lineHeight: 1.6,
          }}
        >
          {step === 1 ? (
            <>
              <strong style={{ color: "var(--gold)" }}>
                "{patternName}"
              </strong>{" "}
              will quiet down and stop surfacing in active views. You can
              revisit it any time.
            </>
          ) : (
            <>
              This is your final confirmation. To retire{" "}
              <strong style={{ color: "var(--gold)" }}>
                "{patternName}"
              </strong>
              , type <strong>retire</strong> below.
            </>
          )}
        </p>

        {step === 2 && (
          <input
            autoFocus
            type="text"
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder="Type 'retire' to confirm"
            style={{
              width: "100%",
              marginTop: 12,
              background: "rgba(212,175,90,0.04)",
              border: "1px solid rgba(212,175,90,0.25)",
              borderRadius: 8,
              padding: 10,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              outline: "none",
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={retiring}
            style={chamberGhostBtn}
          >
            Cancel
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={onAdvance}
              style={chamberPrimaryBtn}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={!matches || retiring}
              style={{
                ...chamberPrimaryBtn,
                opacity: !matches || retiring ? 0.4 : 1,
                cursor: !matches || retiring ? "not-allowed" : "pointer",
              }}
            >
              {retiring ? "Retiring…" : "Retire pattern"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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

/**
 * "Card evidence" section — lists the underlying card-recurrence
 * threads (from `symbolic_threads`) whose `pattern_id` matches this
 * chamber. Threads no longer surface anywhere else in the UI; they
 * live here as quiet supporting evidence for the pattern.
 */
function ChamberCardEvidence({
  patternId,
  userId,
}: {
  patternId: string;
  userId: string | undefined;
}) {
  const [threads, setThreads] = useState<
    Array<{ id: string; summary: string }>
  >([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("symbolic_threads")
        .select("id, summary")
        .eq("user_id", userId)
        .eq("pattern_id", patternId)
        .order("detected_at", { ascending: false });
      if (cancelled) return;
      setThreads(
        (data ?? []).map((t) => ({
          id: t.id as string,
          summary: (t.summary as string) ?? "",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [patternId, userId]);

  if (threads.length === 0) return null;

  return (
    <section style={{ marginTop: "var(--space-6, 32px)" }}>
      <h3
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-sm, 17px)",
          color: "var(--color-foreground)",
          opacity: 0.7,
          margin: 0,
          marginBottom: "var(--space-3, 12px)",
        }}
      >
        Card evidence
      </h3>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "var(--space-2, 8px)",
        }}
      >
        {threads.map((t) => (
          <li
            key={t.id}
            style={{
              padding: "var(--space-3, 12px)",
              borderRadius: "var(--radius-md, 10px)",
              background: "var(--surface-card, rgba(255,255,255,0.03))",
              border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.85,
            }}
          >
            {t.summary}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChamberTimeline({
  readingIds,
  onOpenReading,
  readingConnections,
}: {
  readingIds: string[];
  onOpenReading: (readingId: string) => void;
  readingConnections?: Array<{ readingId: string; connector: string }>;
}) {
  return _ChamberTimeline({ readingIds, onOpenReading, readingConnections });
}

function PatternSynthesis({
  patternId,
  readingCount,
  onLoaded,
}: {
  patternId: string;
  readingCount: number;
  onLoaded?: (data: PatternInterpretation) => void;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; data: PatternInterpretation }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const generate = useServerFn(generatePatternInterpretation);
  useEffect(() => {
    if (readingCount === 0) return;
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const res = await generate({ data: { patternId } });
        if (cancelled) return;
        if (res.ok) {
          const data = res.interpretation;
          // 9-6-AH continuation — old-shape interpretation cached.
          // Force regeneration with the new prompt so we get the new
          // whyHeadline / whatThisIs / whatItCouldMean fields.
          const isLegacy =
            !data.whyHeadline &&
            !data.whatThisIs &&
            !data.whatItCouldMean &&
            !data.body;
          if (isLegacy) {
            const fresh = await generate({
              data: { patternId, force: true },
            });
            if (cancelled) return;
            if (fresh.ok) {
              setState({ kind: "ready", data: fresh.interpretation });
              onLoaded?.(fresh.interpretation);
            } else {
              setState({ kind: "error", message: fresh.error });
            }
            return;
          }
          setState({ kind: "ready", data });
          onLoaded?.(data);
        } else {
          setState({ kind: "error", message: res.error });
        }
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not synthesize.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patternId, readingCount, generate, onLoaded]);
  if (readingCount === 0) return null;
  // 9-6-AH continuation — bail entirely on idle (initial render before
  // useEffect kicks in) and on ready-but-empty so we never paint an
  // empty bordered box on the Stories detail page.
  if (state.kind === "idle") return null;
  const hasReadyContent =
    state.kind === "ready" &&
    (((state.data.whyHeadline ?? "").trim().length > 0) ||
      ((state.data.whatThisIs ?? "").trim().length > 0) ||
      ((state.data.whatItCouldMean ?? "").trim().length > 0) ||
      ((state.data.body ?? "").trim().length > 0));
  if (state.kind === "ready" && !hasReadyContent) return null;
  return (
    <section
      style={{
        marginTop: "var(--space-6, 32px)",
        padding: "var(--space-4, 16px)",
        borderRadius: "var(--radius-lg, 14px)",
        background: "var(--surface-card, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
      }}
    >
      {state.kind === "loading" && (
        <div style={{ marginTop: 12 }}>
          <LoadingText>Synthesizing the through-line…</LoadingText>
        </div>
      )}
      {state.kind === "error" && (
        <p style={{ marginTop: 12, opacity: 0.6, fontStyle: "italic" }}>
          {state.message}
        </p>
      )}
      {state.kind === "ready" && (
        <div style={{ marginTop: 12 }}>
          {state.data.whyHeadline && state.data.whyHeadline.trim().length > 0 && (
            <p
              style={{
                margin: "0 0 var(--space-4, 16px)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-md, 22px)",
                lineHeight: 1.35,
                color: "var(--accent, var(--gold))",
                textShadow: "0 0 18px rgba(212,175,90,0.25)",
                letterSpacing: "0.005em",
              }}
            >
              {state.data.whyHeadline}
            </p>
          )}
          {state.data.whatThisIs ? (
            <div style={{ marginBottom: 20 }}>
              <h3
                style={{
                  margin: 0,
                  marginBottom: 6,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  letterSpacing: "0.06em",
                  opacity: 0.7,
                }}
              >
                What this story is
              </h3>
              <p
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "var(--text-body)",
                  lineHeight: 1.7,
                  fontFamily: "var(--font-serif)",
                }}
              >
                {state.data.whatThisIs}
              </p>
            </div>
          ) : null}
          {state.data.whatItCouldMean ? (
            <div style={{ marginBottom: 20 }}>
              <h3
                style={{
                  margin: 0,
                  marginBottom: 6,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  letterSpacing: "0.06em",
                  opacity: 0.7,
                }}
              >
                What it could mean
              </h3>
              <p
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "var(--text-body)",
                  lineHeight: 1.7,
                  fontFamily: "var(--font-serif)",
                }}
              >
                {state.data.whatItCouldMean}
              </p>
            </div>
          ) : state.data.body ? (
            <p
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "var(--text-body)",
                lineHeight: 1.6,
                color: "var(--color-foreground)",
              }}
            >
              {state.data.body}
            </p>
          ) : null}
          {state.data.key_cards.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: "var(--text-body-sm)",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  opacity: 0.7,
                }}
              >
                Key cards
              </h3>
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {state.data.key_cards.map((kc, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{kc.card}</strong> — <span style={{ opacity: 0.85 }}>{kc.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.data.reflective_prompts.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: "var(--text-body-sm)",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  opacity: 0.7,
                }}
              >
                Reflective prompts
              </h3>
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {state.data.reflective_prompts.map((p, i) => (
                  <li key={i} style={{ marginBottom: 4, fontStyle: "italic" }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function _ChamberTimeline({
  readingIds,
  onOpenReading,
  readingConnections,
}: {
  readingIds: string[];
  onOpenReading: (readingId: string) => void;
  readingConnections?: Array<{ readingId: string; connector: string }>;
}) {
  const [rows, setRows] = useState<
    Array<{ id: string; created_at: string; spread_type: string; card_ids: number[]; question: string | null; interpretation: string | null }>
  >([]);

  useEffect(() => {
    if (readingIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("readings")
        .select("id, created_at, spread_type, card_ids, question, interpretation")
        .in("id", readingIds)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setRows(
        (data ?? []).map((r) => ({
          id: r.id as string,
          created_at: r.created_at as string,
          spread_type: r.spread_type as string,
          card_ids: (r.card_ids as number[]) ?? [],
          question: (r.question as string | null) ?? null,
          interpretation: (r.interpretation as string | null) ?? null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [readingIds]);

  if (rows.length === 0) return null;

  return (
    <section style={{ marginTop: "var(--space-8, 48px)" }}>
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          color: "var(--color-foreground)",
          opacity: 0.85,
          marginBottom: "var(--space-4, 16px)",
        }}
      >
        The readings in this story
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li
            key={r.id}
            style={{
              borderBottom: "0.5px solid var(--border-subtle)",
              padding: "var(--space-4, 16px) 0",
            }}
          >
            <ReadingExcerptCard
              reading={r}
              onOpen={onOpenReading}
              connector={
                readingConnections?.find((c) => c.readingId === r.id)?.connector
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReadingExcerptCard({
  reading,
  onOpen,
  connector,
}: {
  reading: {
    id: string;
    created_at: string;
    spread_type: string;
    card_ids: number[];
    question: string | null;
    interpretation: string | null;
  };
  onOpen: (id: string) => void;
  connector?: string;
}) {
  const keyCardId = reading.card_ids[0];
  const dateLabel = formatDateLong(reading.created_at).toUpperCase();
  const spreadLabel = reading.spread_type.replace(/_/g, " ").toUpperCase();
  const excerpt = (() => {
    if (!reading.interpretation) return null;
    let stripped = reading.interpretation
      .replace(/[*_#`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // 9-6-AH continuation — strip leading position labels
    // (Past:/Present:/Future:/etc.) so the snippet doesn't lead with
    // bleed-through from the spread structure. Loop in case multiple
    // labels stack at the start.
    const POSITION_LABEL_PREFIX =
      /^(Past|Present|Future|Significator|Crosses|Crowns|Foundation|Behind|Before|Self|House|Hopes|Outcome)\s*[:\-—]\s*/i;
    while (POSITION_LABEL_PREFIX.test(stripped)) {
      stripped = stripped.replace(POSITION_LABEL_PREFIX, "");
    }
    // 9-6-AG — pull up to 3 sentences, cap around 420 chars.
    const sentences = stripped.match(/[^.!?]+[.!?]+/g) ?? [stripped];
    const firstThree = sentences.slice(0, 3).join(" ").trim();
    if (firstThree.length <= 420) return firstThree;
    const truncated = firstThree.slice(0, 420);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > 300 ? truncated.slice(0, lastSpace) : truncated) + "…";
  })();
  return (
    <button
      type="button"
      onClick={() => onOpen(reading.id)}
      style={{
        display: "flex",
        gap: "var(--space-3, 12px)",
        width: "100%",
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {keyCardId !== undefined && (
        <div style={{ flex: "none" }}>
          <CardImage cardId={keyCardId} size="thumbnail" />
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-caption)",
            letterSpacing: "0.15em",
            color: "var(--accent, var(--gold))",
            opacity: 0.7,
          }}
        >
          {dateLabel} · {spreadLabel}
        </p>
        {reading.question && (
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body)",
              color: "var(--color-foreground)",
            }}
          >
            “{reading.question}”
          </p>
        )}
        {connector && (
          <p
            style={{
              margin: "var(--space-2, 8px) 0 0",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--accent, var(--gold))",
              opacity: 0.85,
              lineHeight: 1.5,
            }}
          >
            {connector}
          </p>
        )}
        {excerpt && (
          <p
            style={{
              margin: "6px 0 0",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.65,
              lineHeight: 1.5,
            }}
          >
            {excerpt}
          </p>
        )}
      </div>
    </button>
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
  const [tooltip, setTooltip] = useState<{
    text: string;
    sub?: string;
    x: number;
    y: number;
  } | null>(null);

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
          .is("archived_at", null)
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

  if (loading) return <WeaveGraphSkeleton />;

  // Stable order across renders so ring positions don't shuffle when the
  // siblings map is rebuilt — sort by id (immutable) instead of relying on
  // Object.values insertion order.
  const siblingList = Object.values(siblings).slice().sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  // 9-6-AH continuation — weave chamber only renders when there are
  // sibling patterns to weave with. The internal-readings-only graph
  // is empty noise; readings are listed below in ChamberTimeline.
  if (siblingList.length === 0) return null;

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
    const sState = s.lifecycle_state as Pattern["lifecycle_state"];
    const baseOp = lifecycleOpacity(sState);
    const lifeStroke = lifecycleColor(sState, 0.85);
    const lifeFill = lifecycleColor(sState, 0.1);
    nodes.push({
      id: `p:${s.id}`,
      position: { x, y },
      data: { label: s.name },
      draggable: false,
      style: {
        width: 140,
        background: isActive
          ? "rgba(212,175,90,0.22)"
          : lifeFill,
        border: isActive
          ? "1px solid rgba(212,175,90,0.95)"
          : `1px solid ${lifeStroke}`,
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
      const sibState = siblings[pid].lifecycle_state as Pattern["lifecycle_state"];
      const lifeEdge = lifecycleEdgeColor(
        pattern.lifecycle_state,
        sibState,
        0.7,
      );
      const lifeEdgeStrong = lifecycleEdgeColor(
        pattern.lifecycle_state,
        sibState,
        1,
      );
      edges.push({
        id: key,
        source: `p:${pattern.id}`,
        target: `p:${pid}`,
        animated: isActiveEdge || !hasActive,
        label: w.title,
        style: {
          stroke: isActiveEdge
            ? "rgba(212,175,90,0.95)"
            : lifeEdge,
          strokeWidth: isActiveEdge ? 2 : 1,
          opacity: dimEdge ? 0.18 : 1,
          transition: "opacity 180ms ease, stroke 180ms ease",
        },
        labelStyle: {
          fill: isActiveEdge
            ? "rgba(232,200,120,1)"
            : lifeEdgeStrong,
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
  // Sort by id so satellite positions are deterministic across renders,
  // independent of how the rows were returned by Supabase.
  const orderedReadings = readings.slice().sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  orderedReadings.forEach((r, i) => {
    const angle =
      (i / Math.max(orderedReadings.length, 1)) * Math.PI * 2;
    const x = CENTER_X + Math.cos(angle) * READING_RADIUS - 6;
    const y = CENTER_Y + Math.sin(angle) * READING_RADIUS - 6;
    const dimReading = hasActive;
    nodes.push({
      id: `r:${r.id}`,
      position: { x, y },
      data: {
        label: formatDateShort(r.created_at),
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
      {siblingList.length > 0 && (
        <p
          style={{
            margin: "0 0 var(--space-2, 8px)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground)",
            opacity: 0.5,
          }}
        >
          Tap a pattern to highlight its weaves · tap again to open its chamber
        </p>
      )}
      <div
        style={{
          height: 480,
          borderRadius: "var(--radius-lg, 14px)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          background:
            "radial-gradient(circle at 50% 50%, rgba(120,90,200,0.08), transparent 70%)",
          overflow: "hidden",
          position: "relative",
        }}
        onMouseMove={(e) => {
          if (!tooltip) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setTooltip({
            ...tooltip,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          {...(() => {
            const saved = loadViewport(pattern.id);
            return saved
              ? { defaultViewport: saved }
              : { fitView: true as const };
          })()}
          onMoveEnd={(_, vp) => saveViewport(pattern.id, vp)}
          panOnDrag
          zoomOnScroll={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.id.startsWith("p:") && node.id !== `p:${pattern.id}`) {
              const sid = node.id.slice(2);
              if (focusId === sid) {
                void navigate({
                  to: "/threads/$patternId",
                  params: { patternId: sid },
                });
              } else {
                setFocusId(sid);
              }
            } else if (node.id.startsWith("r:")) {
              const rid = node.id.slice(2);
              void navigate({
                to: "/journal",
                search: { readingId: rid } as never,
              });
            }
          }}
          onNodeDoubleClick={(_, node) => {
            if (node.id.startsWith("p:") && node.id !== `p:${pattern.id}`) {
              const sid = node.id.slice(2);
              void navigate({
                to: "/threads/$patternId",
                params: { patternId: sid },
              });
            }
          }}
          onNodeMouseEnter={(e, node) => {
            const container = (e.currentTarget as HTMLElement).closest(
              ".react-flow",
            )?.parentElement;
            const rect = container?.getBoundingClientRect();
            const x = rect ? e.clientX - rect.left : 0;
            const y = rect ? e.clientY - rect.top : 0;
            if (node.id.startsWith("p:")) {
              const sid = node.id.slice(2);
              const isCenter = sid === pattern.id;
              const sib = isCenter ? null : siblings[sid];
              const name = isCenter ? pattern.name : sib?.name;
              if (!name) return;
              const lifecycle = isCenter
                ? pattern.lifecycle_state
                : sib?.lifecycle_state;
              setTooltip({
                text: name,
                sub: isCenter
                  ? `This chamber · ${lifecycle}`
                  : `${lifecycle} · tap to highlight`,
                x,
                y,
              });
              if (!isCenter) setHoveredId(sid);
            } else if (node.id.startsWith("r:")) {
              const rid = node.id.slice(2);
              const r = readings.find((x) => x.id === rid);
              if (!r) return;
              const date = new Date(r.created_at).toLocaleDateString(
                undefined,
                { weekday: "short", month: "long", day: "numeric", year: "numeric" },
              );
              setTooltip({
                text: date,
                sub: `${r.spread_type} · open in journal`,
                x,
                y,
              });
            }
          }}
          onNodeMouseLeave={() => {
            setHoveredId(null);
            setTooltip(null);
          }}
          onPaneClick={() => {
            setFocusId(null);
            setHoveredId(null);
            setTooltip(null);
          }}
        >
          <Background color="rgba(212,175,90,0.08)" gap={32} />
        </ReactFlow>
        {tooltip && (
          <div
            role="tooltip"
            style={{
              position: "absolute",
              left: Math.min(Math.max(tooltip.x + 14, 8), 9999),
              top: Math.max(tooltip.y - 8, 8),
              transform: "translateY(-100%)",
              padding: "6px 10px",
              background: "rgba(10,8,22,0.95)",
              border: "1px solid rgba(212,175,90,0.45)",
              borderRadius: "var(--radius-sm, 8px)",
              color: "var(--color-foreground)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              boxShadow: "0 4px 18px rgba(0,0,0,0.45)",
              zIndex: 10,
            }}
          >
            <div style={{ color: "rgba(232,200,120,1)" }}>{tooltip.text}</div>
            {tooltip.sub && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 10,
                  opacity: 0.7,
                  letterSpacing: "0.04em",
                }}
              >
                {tooltip.sub}
              </div>
            )}
          </div>
        )}
        {(() => {
          const activeSibling = activeId ? siblings[activeId] ?? null : null;
          if (!activeSibling) return null;
          const titles = Array.from(
            new Set(
              weaves
                .filter((w) => (w.pattern_ids ?? []).includes(activeId!))
                .map((w) => w.title)
                .filter(Boolean),
            ),
          );
          return (
            <div
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                right: 12,
                padding: "10px 12px",
                background: "rgba(10,8,22,0.85)",
                border: "1px solid rgba(212,175,90,0.35)",
                borderRadius: "var(--radius-md, 10px)",
                backdropFilter: "blur(6px)",
                color: "var(--color-foreground)",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "rgba(232,200,120,1)",
                }}
              >
                {activeSibling.name}
              </div>
              {titles.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: "var(--text-caption)",
                    opacity: 0.75,
                    fontStyle: "italic",
                  }}
                >
                  {titles.join(" · ")}
                </div>
              )}
              <div
                style={{
                  marginTop: 6,
                  fontSize: "var(--text-caption)",
                  opacity: 0.5,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Tap again to open chamber
              </div>
            </div>
          );
        })()}
      </div>
      <WeaveGraphLegend />
    </section>
  );
}

function WeaveGraphSkeleton() {
  return (
    <section
      aria-label="Loading pattern weave graph"
      aria-busy="true"
      style={{ marginTop: "var(--space-6, 32px)" }}
    >
      <div
        style={{
          height: 14,
          width: 220,
          borderRadius: 999,
          background:
            "linear-gradient(90deg, rgba(212,175,90,0.08), rgba(212,175,90,0.22), rgba(212,175,90,0.08))",
          backgroundSize: "200% 100%",
          animation: "weave-skeleton-shimmer 1.6s ease-in-out infinite",
          margin: "0 0 var(--space-3, 12px)",
        }}
      />
      <div
        style={{
          position: "relative",
          height: 480,
          borderRadius: "var(--radius-lg, 14px)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          background:
            "radial-gradient(circle at 50% 50%, rgba(120,90,200,0.08), transparent 70%)",
          overflow: "hidden",
        }}
      >
        {/* Center pattern placeholder */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 180,
            height: 36,
            borderRadius: 999,
            background: "rgba(212,175,90,0.14)",
            border: "1px solid rgba(212,175,90,0.5)",
            animation: "weave-skeleton-pulse 1.8s ease-in-out infinite",
          }}
        />
        {/* Sibling ring placeholders */}
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const r = 180;
          const x = `calc(50% + ${Math.cos(angle) * r}px)`;
          const y = `calc(50% + ${Math.sin(angle) * r}px)`;
          return (
            <div
              key={`s-${i}`}
              style={{
                position: "absolute",
                top: y,
                left: x,
                transform: "translate(-50%, -50%)",
                width: 110,
                height: 26,
                borderRadius: 999,
                background: "rgba(212,175,90,0.06)",
                border: "1px solid rgba(212,175,90,0.25)",
                animation: `weave-skeleton-pulse 1.8s ease-in-out ${i * 120}ms infinite`,
              }}
            />
          );
        })}
        {/* Reading dot placeholders */}
        {Array.from({ length: 5 }).map((_, i) => {
          const angle = (i / 5) * Math.PI * 2;
          const r = 90;
          const x = `calc(50% + ${Math.cos(angle) * r}px)`;
          const y = `calc(50% + ${Math.sin(angle) * r}px)`;
          return (
            <div
              key={`r-${i}`}
              style={{
                position: "absolute",
                top: y,
                left: x,
                transform: "translate(-50%, -50%)",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "rgba(212,175,90,0.45)",
                boxShadow: "0 0 8px rgba(212,175,90,0.35)",
                animation: `weave-skeleton-pulse 1.8s ease-in-out ${i * 90}ms infinite`,
              }}
            />
          );
        })}
        <span className="sr-only">Loading the weave graph for this pattern…</span>
      </div>
      <style>{`
        @keyframes weave-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes weave-skeleton-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.95; }
        }
      `}</style>
    </section>
  );
}

function WeaveGraphLegend() {
  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-caption)",
    color: "var(--color-foreground)",
    opacity: 0.75,
  };
  const swatch: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 18,
    flexShrink: 0,
  };
  return (
    <dl
      aria-label="Weave graph legend"
      style={{
        marginTop: "var(--space-3, 12px)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "var(--space-2, 8px) var(--space-4, 16px)",
        padding: "var(--space-3, 12px) var(--space-4, 16px)",
        borderRadius: "var(--radius-md, 10px)",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
        background: "rgba(10,8,22,0.4)",
      }}
    >
      <div style={itemStyle}>
        <span style={swatch} aria-hidden>
          <span
            style={{
              width: 22,
              height: 14,
              borderRadius: 999,
              background: "rgba(212,175,90,0.18)",
              border: "1px solid rgba(212,175,90,0.85)",
            }}
          />
        </span>
        <dt style={{ display: "inline" }}>Pattern node</dt>
        <dd style={{ margin: 0, opacity: 0.7 }}>— brighter = more active in your readings</dd>
      </div>
      <div style={itemStyle}>
        <span style={swatch} aria-hidden>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "rgba(212,175,90,0.85)",
              boxShadow: "0 0 8px rgba(212,175,90,0.5)",
            }}
          />
        </span>
        <dt style={{ display: "inline" }}>Reading dot</dt>
        <dd style={{ margin: 0, opacity: 0.7 }}>— a single entry where this pattern surfaced</dd>
      </div>
      <div style={itemStyle}>
        <span style={swatch} aria-hidden>
          <svg width={28} height={10} viewBox="0 0 28 10">
            <line
              x1={1}
              y1={5}
              x2={27}
              y2={5}
              stroke="rgba(212,175,90,0.55)"
              strokeWidth={1}
              strokeDasharray="4 3"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="0"
                to="-14"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </line>
          </svg>
        </span>
        <dt style={{ display: "inline" }}>Gold flowing edge</dt>
        <dd style={{ margin: 0, opacity: 0.7 }}>— an active weave linking two patterns</dd>
      </div>
      <div style={itemStyle}>
        <span style={swatch} aria-hidden>
          <svg width={28} height={10} viewBox="0 0 28 10">
            <line
              x1={1}
              y1={5}
              x2={27}
              y2={5}
              stroke="rgba(232,200,120,1)"
              strokeWidth={2}
            />
          </svg>
        </span>
        <dt style={{ display: "inline" }}>Bright bold edge</dt>
        <dd style={{ margin: 0, opacity: 0.7 }}>— the weave you're hovering or focused on</dd>
      </div>
      <div
        style={{
          ...itemStyle,
          gridColumn: "1 / -1",
          flexWrap: "wrap",
          rowGap: 6,
        }}
      >
        <dt style={{ display: "inline", marginRight: 4 }}>Lifecycle hues</dt>
        {(
          [
            ["emerging", "Emerging"],
            ["active", "Active"],
            ["reawakened", "Reawakened"],
            ["quieting", "Quieting"],
            ["retired", "Retired"],
          ] as const
        ).map(([state, label]) => (
          <span
            key={state}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginRight: 12,
              opacity: 0.85,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: lifecycleColor(state, 0.18),
                border: `1px solid ${lifecycleColor(state, 0.9)}`,
              }}
            />
            {label}
          </span>
        ))}
      </div>
      <div style={itemStyle}>
        <span style={swatch} aria-hidden>
          <span
            style={{
              width: 22,
              height: 14,
              borderRadius: 999,
              background: "rgba(212,175,90,0.06)",
              border: "1px solid rgba(212,175,90,0.4)",
              opacity: 0.35,
            }}
          />
        </span>
        <dt style={{ display: "inline" }}>Dimmed node</dt>
        <dd style={{ margin: 0, opacity: 0.7 }}>— retired or unrelated to the active weave</dd>
      </div>
    </dl>
  );
}