/**
 * EJ65 — PageMenuTrigger.
 *
 * The button that opens the left-side PageMenu. Lives in the upper-
 * left of the viewport, BELOW the compact TopNav (so it doesn't
 * interfere with the nav row). Only renders on pages that mount a
 * PageMenu — pages without page-level configuration never show this
 * button.
 *
 * Position: fixed at top:var(--topbar-height)+8, left:8. z-index
 * just below the panel's drawer level so the panel can slide over it.
 */
import { Menu } from "lucide-react";

export function PageMenuTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open page menu"
      title="Page menu"
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + var(--topbar-height) + 8px)",
        left: 8,
        // EK04 — Bumped from --z-popover (50) to --z-modal-nested (200)
        // so the hamburger sits above the TopNav (z-bottom-nav, 40) and
        // any TopNav expansion / sticky-header overlays. Per Cori: the
        // trigger should always be visible above the top menu when it
        // expands. Stays below custom-high z layers (SpreadPicker
        // dropdown at 9999, draw-proof popup at 9990) so those still
        // visually claim attention when open — but above all normal
        // page chrome.
        zIndex: "var(--z-modal-nested)" as unknown as number,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 999,
        background:
          "color-mix(in oklch, var(--surface-elevated) 80%, transparent)",
        border: "1px solid var(--border-subtle)",
        cursor: "pointer",
        color: "var(--color-foreground)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        transition: "background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          "color-mix(in oklab, var(--accent, var(--gold)) 15%, var(--surface-elevated))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background =
          "color-mix(in oklch, var(--surface-elevated) 80%, transparent)";
      }}
    >
      <Menu size={18} strokeWidth={1.6} aria-hidden />
    </button>
  );
}
