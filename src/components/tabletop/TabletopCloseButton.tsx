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
 *
 * EK32 — Bumped z-index to 500 (was 50) AND portaled to document.body.
 * Without the portal, the button mounts inside Tabletop's wrapper
 * (position: fixed, z-30), which creates a stacking context. The
 * button's z-index was local to that z-30 context, so when TopNav
 * expanded from 28px to 56px tall its band overlapped the X (TopNav
 * at z-40 beats z-30). Mirrors the PageMenuTrigger fix; same root
 * cause, same approach. SSR-safe via the `mounted` guard.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function TabletopCloseButton({ onClick }: { onClick: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  const button = (
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
        // EK32 — Bumped from 50 to 500. Matches PageMenuTrigger so the
        // two corner controls sit at the same effective layer above
        // TopNav (40) regardless of TopNav's expanded/compact state.
        zIndex: 500,
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
  return createPortal(button, document.body);
}
