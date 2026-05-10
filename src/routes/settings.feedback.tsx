/**
 * Q35a — /settings/feedback
 *
 * Two stacked sections: a submission form + the public approved board.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { ChevronUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  submitFeedback,
  getFeedbackBoard,
  getMyPendingPosts,
  toggleVote,
  type FeedbackBoardItem,
} from "@/lib/feedback.functions";

export const Route = createFileRoute("/settings/feedback")({
  head: () => ({ meta: [{ title: "Feedback — Settings · Moonseed" }] }),
  component: FeedbackPage,
});

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const TITLE_MAX = 100;
const DESC_MAX = 500;

function FeedbackPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6, 32px)" }}>
      <SubmissionSection />
      <BoardSection />
    </div>
  );
}

/* ---------------- Submission ---------------- */

function SubmissionSection() {
  const [category, setCategory] = useState<"bug" | "feature">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    void (async () => {
      try {
        const headers = await authHeaders();
        const r = await getMyPendingPosts({ headers });
        setPendingCount(r.length);
      } catch (e) {
        console.error("[feedback] pending", e);
      }
    })();
  }, [submittedId]);

  const titleRem = TITLE_MAX - title.length;
  const descRem = DESC_MAX - description.length;
  const canSubmit = title.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const { id } = await submitFeedback({
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          category,
        },
        headers,
      });
      setSubmittedId(id);
    } catch (e) {
      console.error("[feedback] submit", e);
      setError("Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSubmittedId(null);
    setTitle("");
    setDescription("");
    setError(null);
  }

  const cardStyle: CSSProperties = {
    padding: "var(--space-4, 16px)",
    borderRadius: "var(--radius-md, 12px)",
    background: "var(--surface-card)",
  };

  if (submittedId) {
    return (
      <div style={cardStyle}>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            color: "var(--color-foreground)",
            opacity: 0.85,
            margin: 0,
          }}
        >
          Your feedback is resting with us. We&apos;ll review it soon.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "var(--space-3, 12px)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm, 14px)",
            color: "var(--accent, var(--gold))",
          }}
        >
          Submit another
        </button>
      </div>
    );
  }

  const placeholderTitle =
    category === "bug" ? "What’s happening?" : "What would you love?";

  return (
    <div style={cardStyle}>
      {pendingCount > 0 && (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.5,
            margin: "0 0 var(--space-3, 12px) 0",
          }}
        >
          You have {pendingCount} post{pendingCount === 1 ? "" : "s"} awaiting review.
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-4, 16px)", marginBottom: "var(--space-4, 16px)" }}>
        {(["bug", "feature"] as const).map((c) => {
          const active = c === category;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              style={{
                background: "none",
                border: "none",
                padding: "4px 0",
                cursor: "pointer",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                color: active
                  ? "var(--accent, var(--gold))"
                  : "var(--color-foreground)",
                opacity: active ? 1 : 0.5,
                borderBottom: active
                  ? "1px solid var(--accent, var(--gold))"
                  : "1px solid transparent",
              }}
            >
              {c === "bug" ? "Bug report" : "Feature request"}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
        placeholder={placeholderTitle}
        maxLength={TITLE_MAX}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--border-default, var(--border-subtle))",
          padding: "8px 0",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          color: "var(--color-foreground)",
          outline: "none",
        }}
      />
      <CharCounter remaining={titleRem} />

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
        placeholder="Any details to add? (optional)"
        rows={3}
        maxLength={DESC_MAX}
        style={{
          width: "100%",
          marginTop: "var(--space-3, 12px)",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--border-default, var(--border-subtle))",
          padding: "8px 0",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          color: "var(--color-foreground)",
          outline: "none",
          resize: "vertical",
        }}
      />
      <CharCounter remaining={descRem} />

      {error && (
        <p
          style={{
            margin: "var(--space-3, 12px) 0 0 0",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--accent, var(--gold))",
            opacity: 0.8,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ marginTop: "var(--space-4, 16px)", textAlign: "right" }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            color: "var(--accent, var(--gold))",
            opacity: submitting ? 0.4 : canSubmit ? 1 : 0.4,
          }}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function CharCounter({ remaining }: { remaining: number }) {
  const warn = remaining <= 20;
  return (
    <div
      style={{
        marginTop: 4,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-caption, 11px)",
        textAlign: "right",
        color: warn ? "var(--accent, var(--gold))" : "var(--color-foreground)",
        opacity: warn ? 0.85 : 0.4,
      }}
    >
      {remaining}
    </div>
  );
}

/* ---------------- Public board ---------------- */

function statusLabel(s: FeedbackBoardItem["status"]): string {
  switch (s) {
    case "under_review":
      return "Under review";
    case "planned":
      return "Planned";
    case "in_progress":
      return "In progress";
    case "done":
      return "Done";
  }
}

function statusColor(s: FeedbackBoardItem["status"]): string {
  const mix: Record<FeedbackBoardItem["status"], number> = {
    under_review: 35,
    planned: 55,
    in_progress: 75,
    done: 90,
  };
  return `color-mix(in oklch, var(--accent, var(--gold)) ${mix[s]}%, var(--color-foreground))`;
}

function BoardSection() {
  const [items, setItems] = useState<FeedbackBoardItem[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const headers = await authHeaders();
        const r = await getFeedbackBoard({ headers });
        setItems(r);
      } catch (e) {
        console.error("[feedback] board", e);
        setItems([]);
      }
    })();
  }, []);

  async function onVote(id: string) {
    if (!items) return;
    const optimistic = items.map((it) =>
      it.id === id
        ? {
            ...it,
            userHasVoted: !it.userHasVoted,
            voteCount: it.voteCount + (it.userHasVoted ? -1 : 1),
          }
        : it,
    );
    setItems(optimistic);
    try {
      const headers = await authHeaders();
      const r = await toggleVote({ data: { postId: id }, headers });
      setItems((prev) =>
        prev
          ? prev.map((it) =>
              it.id === id
                ? { ...it, userHasVoted: r.voted, voteCount: r.voteCount }
                : it,
            )
          : prev,
      );
    } catch (e) {
      console.error("[feedback] vote", e);
      setItems(items); // rollback
    }
  }

  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-sm)",
          color: "var(--gold)",
          margin: "0 0 var(--space-4, 16px) 0",
        }}
      >
        From the community
      </h2>
      {items === null && (
        <div
          style={{
            opacity: 0.5,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Loading…
        </div>
      )}
      {items && items.length === 0 && (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            color: "var(--color-foreground)",
            opacity: 0.5,
            fontSize: "var(--text-body)",
          }}
        >
          No feedback yet — be the first to share.
        </div>
      )}
      {items && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3, 12px)" }}>
          {items.map((it) => (
            <BoardRow key={it.id} item={it} onVote={() => onVote(it.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BoardRow({
  item,
  onVote,
}: {
  item: FeedbackBoardItem;
  onVote: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = (item.description?.length ?? 0) > 120;

  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-3, 12px)",
        padding: "var(--space-3, 12px) var(--space-4, 16px)",
        background: "var(--surface-card)",
        borderRadius: "var(--radius-md, 12px)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <CategoryBadge category={item.category} />
          <StatusBadge status={item.status} />
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            color: "var(--color-foreground)",
            lineHeight: 1.4,
          }}
        >
          {item.title}
        </div>
        {item.description && (
          <div
            style={{
              marginTop: 4,
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.7,
              lineHeight: 1.5,
              display: expanded ? "block" : "-webkit-box",
              WebkitLineClamp: expanded ? "unset" : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.description}
          </div>
        )}
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: 4,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 11px)",
              color: "var(--accent, var(--gold))",
              opacity: 0.7,
            }}
          >
            {expanded ? "show less" : "read more"}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onVote}
        style={{
          background: "none",
          border: "none",
          padding: "4px 8px",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          color: item.userHasVoted
            ? "var(--accent, var(--gold))"
            : "var(--color-foreground)",
          opacity: item.userHasVoted ? 1 : 0.55,
        }}
        aria-pressed={item.userHasVoted}
        aria-label="Upvote"
      >
        <ChevronUp size={18} strokeWidth={1.5} />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-caption, 11px)",
            marginTop: 2,
          }}
        >
          {item.voteCount}
        </span>
      </button>
    </div>
  );
}

function CategoryBadge({ category }: { category: "bug" | "feature" }) {
  const isBug = category === "bug";
  return (
    <span
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 9,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 4,
        color: isBug
          ? "color-mix(in oklch, #d97706 80%, var(--color-foreground))"
          : "var(--accent, var(--gold))",
        background: isBug
          ? "color-mix(in oklch, #d97706 18%, transparent)"
          : "color-mix(in oklch, var(--accent, var(--gold)) 18%, transparent)",
      }}
    >
      {isBug ? "BUG" : "FEATURE"}
    </span>
  );
}

function StatusBadge({ status }: { status: FeedbackBoardItem["status"] }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 9,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 4,
        color: statusColor(status),
        background: `color-mix(in oklch, ${statusColor(status)} 14%, transparent)`,
      }}
    >
      {statusLabel(status)}
    </span>
  );
}