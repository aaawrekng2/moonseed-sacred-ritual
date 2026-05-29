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
        // EK05 — Switched from `var(--z-modal-nested)` (200) to a
        // literal value to rule out CSS-var resolution quirks when the
        // value is passed through React's inline style object. 500
        // sits well above every standard page chrome layer (TopNav 40,
        // AlertDialog/Radix overlays ~50-100, modal-nested 200) but
        // cleanly BELOW the high-z dropdowns and popups I added
        // explicitly (draw-proof popup 9990, SpreadPicker dropdown
        // 9999) so those still claim attention when open. The
        // hamburger is always reachable when nothing modal is open.
        zIndex: 500,
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
