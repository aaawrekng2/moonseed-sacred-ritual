/**
 * Q32 — Inline soft block shown in place of an AI trigger when the
 * seeker's quota is exhausted (or AI is admin-blocked for them).
 * NEVER use as a popup or toast — render inline where the button
 * would have been.
 */
import { formatDateLong } from "@/lib/dates";
import { useNavigate } from "@tanstack/react-router";

export function AiQuotaBlock({
  resetAt,
  reason,
}: {
  resetAt: string | null;
  /** Override the body line — used when AI is admin-blocked. */
  reason?: string | null;
}) {
  const nav = useNavigate();
  const reset = resetAt ? formatDateLong(resetAt) : null;
  const handleGetMore = () => {
    nav({ to: "/settings/usage" }).catch(() => {});
  };
  return (
    <div
      style={{
        padding: "var(--space-4, 16px)",
        borderRadius: "var(--radius-md, 10px)",
        border: "0.5px solid var(--border-subtle, rgba(255,255,255,0.12))",
        background: "var(--surface-card, rgba(255,255,255,0.03))",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body, 16px)",
          color: "var(--color-foreground, var(--foreground))",
          opacity: 0.85,
          margin: 0,
        }}
      >
        {reason
          ? reason
          : "You've used all your credits for this month."}
      </p>
      {reset && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-caption, 11px)",
            letterSpacing: "0.12em",
            color: "var(--color-foreground, var(--foreground))",
            opacity: 0.5,
            margin: "8px 0 0 0",
            textTransform: "uppercase",
          }}
        >
          resets {reset.toUpperCase()}
        </p>
      )}
      <button
        onClick={handleGetMore}
        style={{
          marginTop: "var(--space-3, 12px)",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm, 14px)",
          color: "var(--accent, var(--gold, #d4af37))",
        }}
      >
        Get more credits
      </button>
      <div style={{ marginTop: "var(--space-2, 8px)" }}>
        <a
          href="/settings/usage"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm, 14px)",
            color: "var(--color-foreground, var(--foreground))",
            opacity: 0.7,
            textDecoration: "underline",
          }}
        >
          View my usage
        </a>
      </div>
    </div>
  );
}