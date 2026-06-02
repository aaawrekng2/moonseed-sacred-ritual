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
 *
 * EK32 — Portaled to document.body. Without the portal, the trigger
 * mounts inside Tabletop's wrapper (position: fixed, z-30). That
 * wrapper creates a stacking context, so the trigger's z-index 500
 * is local to z-30 and capped against TopNav (z-40, rendered at the
 * root layer). When TopNav expands from compact (28px) to expanded
 * (56px), its band overlapped the hamburger because the wrapper's
 * stacking context made the hamburger's 500 effectively read as
 * "above other Tabletop children but below the parent's 30." The
 * portal mounts the button directly under document.body so z-index
 * 500 is now relative to the root and beats TopNav cleanly. SSR-safe
 * via the `mounted` guard — server renders nothing, client portals
 * on first effect tick.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "lucide-react";

export function PageMenuTrigger({ onClick }: { onClick: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  const button = (
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
  return createPortal(button, document.body);
}
