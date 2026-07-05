/**
 * v2.83 — Consolidated draw-table onboarding.
 *
 * Replaces the four separate first-visit surfaces (shuffle video modal,
 * hold-to-drag hint, entry-toggle hint, custom-count hint) with ONE
 * stepped popup. Presentational only — the parent (Tabletop) builds the
 * step content and owns dismiss persistence.
 *
 * Dismiss (tiered, handled by the parent):
 *  - Anonymous  → "Remind me later" only (snoozes; re-surfaces as a
 *    gentle sign-up nudge). Finishing the steps counts as a snooze.
 *  - Logged-in  → "Don't show again" (permanent) + "Remind me later"
 *    (snooze). Finishing the steps counts as permanent.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  steps: React.ReactNode[];
  isLoggedIn: boolean;
  /** Completed all steps (tapped "Begin"). */
  onFinish: () => void;
  /** "Remind me later" / close / tap-outside. */
  onSnooze: () => void;
  /** "Don't show again" — logged-in only. */
  onDontShowAgain: () => void;
};

export function TableOnboarding({
  open,
  steps,
  isLoggedIn,
  onFinish,
  onSnooze,
  onDontShowAgain,
}: Props) {
  const [step, setStep] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;
  if (steps.length === 0) return null;

  const total = steps.length;
  const isLast = step >= total - 1;
  const next = () => {
    if (isLast) {
      onFinish();
      return;
    }
    setStep((s) => Math.min(total - 1, s + 1));
  };

  const footerBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: "4px 0",
    cursor: "pointer",
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-caption, 0.75rem)",
    color: "var(--color-foreground, var(--foreground))",
    opacity: 0.5,
  };

  const node = (
    <div
      className="modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="How the table works"
      onClick={onSnooze}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal-nested, 200)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4, 16px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "92vw",
          maxWidth: 460,
          maxHeight: "90dvh",
          overflowY: "auto",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-xl, 20px)",
          padding: "var(--space-5, 20px)",
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -8 }}>
          <button
            type="button"
            onClick={onSnooze}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: "var(--color-foreground, var(--foreground))",
              opacity: 0.6,
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div style={{ minHeight: 120 }}>{steps[step]}</div>

        <div
          style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}
          aria-hidden="true"
        >
          {steps.map((_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background:
                  i === step
                    ? "var(--accent)"
                    : "var(--color-foreground, var(--foreground))",
                opacity: i === step ? 1 : 0.25,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={next}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body, 16px)",
              color: "var(--accent)",
              padding: "4px 0",
            }}
          >
            {isLast ? "Begin →" : "Next →"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: isLoggedIn ? "space-between" : "flex-start",
            alignItems: "center",
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: 12,
          }}
        >
          {isLoggedIn && (
            <button type="button" onClick={onDontShowAgain} style={footerBtn}>
              Don't show again
            </button>
          )}
          <button type="button" onClick={onSnooze} style={footerBtn}>
            Remind me later
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
