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
    // Q20 Fix 2 — short vocabulary: "Type" / "Table".
    const label = goingTo === "manual" ? "Type" : "Table";
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        className="entry-mode-toggle"
        aria-label={label}
        data-no-peek=""
        style={{
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
        <Icon size={16} aria-hidden="true" style={{ pointerEvents: "none" }} />
        {label}
      </button>
    );
  },
);