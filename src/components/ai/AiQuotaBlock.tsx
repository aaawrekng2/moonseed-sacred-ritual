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
  isPremium,
  reason,
  onUpgrade,
}: {
  resetAt: string | null;
  isPremium: boolean;
  /** Override the body line — used when AI is admin-blocked. */
  reason?: string | null;
  onUpgrade?: () => void;
}) {
  const nav = useNavigate();
  const reset = resetAt ? formatDateLong(resetAt) : null;
  const handleUpgrade = () => {
    if (onUpgrade) onUpgrade();
    else nav({ to: "/settings/profile" }).catch(() => {});
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
          : "You have used your AI generations for this month."}
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
      {!isPremium && (
        <button
          onClick={handleUpgrade}
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
          upgrade to premium
        </button>
      )}
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