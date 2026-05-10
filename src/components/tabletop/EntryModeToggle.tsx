/**
 * 26-05-08-Q18 — Unified upper-left entry-mode toggle.
 *
 * Sits at the top-left of both the draw table and manual entry. Plain
 * italic gold text + lucide icon, no pill. Tapping flips the surface
 * (table ↔ manual). Persistence to user_preferences happens at the
 * draw-route level via useSpreadEntryModes.
 */
import { forwardRef } from "react";
import { Keyboard, LayoutGrid } from "lucide-react";
import type { EntryMode } from "@/lib/use-spread-entry-modes";

type Props = {
  current: EntryMode;
  onToggle: () => void;
};

export const EntryModeToggle = forwardRef<HTMLButtonElement, Props>(
  function EntryModeToggle({ current, onToggle }, ref) {
    const goingTo: EntryMode = current === "table" ? "manual" : "table";
    const Icon = goingTo === "manual" ? Keyboard : LayoutGrid;
    const label =
      goingTo === "manual" ? "Enter cards manually" : "Draw from the table";
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        className="entry-mode-toggle"
        aria-label={label}
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: 16,
          zIndex: 50,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: 0,
          background: "none",
          border: "none",
          fontFamily: "var(--font-display, var(--font-serif))",
          fontStyle: "italic",
          fontSize: "var(--text-body, 0.95rem)",
          color: "var(--accent, var(--gold))",
          opacity: 0.7,
          cursor: "pointer",
          transition: "opacity 200ms ease-out",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
        onFocus={(e) => (e.currentTarget.style.opacity = "1")}
        onBlur={(e) => (e.currentTarget.style.opacity = "0.7")}
      >
        <Icon size={16} aria-hidden="true" />
        {label}
      </button>
    );
  },
);