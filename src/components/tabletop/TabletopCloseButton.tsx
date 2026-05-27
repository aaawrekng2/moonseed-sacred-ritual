/**
 * EJ68 — TabletopCloseButton.
 *
 * The X close button that exits the draw flow. Lives at the top-
 * right of the viewport, mirroring the PageMenuTrigger hamburger
 * at top-left. Both sit on the same vertical row as the TopNav
 * band, so the page reads:
 *
 *   [☰ hamburger]   [TopNav 5 icons]   [X close]
 *
 * The button is rendered separately from TopNav itself because
 * TopNav is used on five other routes (Home, Journal, Numerology,
 * Insights, Settings) that don't have an X close. Pages that need
 * an exit affordance mount this component conditionally.
 */
import { X } from "lucide-react";

export function TabletopCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close draw table"
      title="Close"
      data-no-peek=""
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 4px)",
        right: "calc(env(safe-area-inset-right, 0px) + 8px)",
        // z-index above the TopNav band (40) so the X sits visually
        // on the same row but tappable.
        zIndex: 50,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 999,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--color-foreground)",
        opacity: 0.75,
        transition: "opacity 120ms ease-out, background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "0.75";
      }}
    >
      <X size={18} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
