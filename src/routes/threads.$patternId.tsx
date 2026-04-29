import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  type Pattern,
  lifecycleLabel,
  lifecycleOpacity,
  formatMonthSince,
} from "@/lib/patterns";

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

      <ChamberTimeline readingIds={pattern.reading_ids} />
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