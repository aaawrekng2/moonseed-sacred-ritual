/**
 * EJ5 — Small unlabeled toggle that controls hover tips on the
 * /constellation surface. The toggle itself has a hover tip (always
 * enabled, regardless of the master flag this very toggle controls)
 * so the seeker can discover what it does.
 *
 * Placement: rendered next to the filter row at the top of the
 * constellation page (right of the "All time" filter pill).
 */
import { useState } from "react";
import {
  useConstellationHoverTips,
} from "@/lib/use-constellation-hover-tips";

const TOGGLE_HOVER_TIP =
  "Hover tips · toggle on to see explanations when you hover over constellation elements";

export function HoverTipsToggle() {
  const { effectiveEnabled, toggle } = useConstellationHoverTips();
  const [hovered, setHovered] = useState(false);

  const trackWidth = 28;
  const trackHeight = 16;
  const knobSize = 12;
  const offset = (trackHeight - knobSize) / 2;
  const knobX = effectiveEnabled ? trackWidth - knobSize - offset : offset;

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={TOGGLE_HOVER_TIP}
        aria-pressed={effectiveEnabled}
        style={{
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          width: trackWidth,
          height: trackHeight,
        }}
      >
        <span
          style={{
            position: "relative",
            width: trackWidth,
            height: trackHeight,
            borderRadius: trackHeight / 2,
            background: effectiveEnabled
              ? "var(--accent, var(--gold))"
              : "color-mix(in oklab, var(--color-foreground) 22%, transparent)",
            transition: "background 180ms ease",
            display: "inline-block",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: offset,
              left: knobX,
              width: knobSize,
              height: knobSize,
              borderRadius: "50%",
              background: "var(--background, #0b0a14)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
              transition: "left 180ms ease",
            }}
          />
        </span>
      </button>
      {hovered && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: "var(--z-popover, 50)" as unknown as number,
            maxWidth: 280,
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            lineHeight: 1.45,
            pointerEvents: "none",
          }}
        >
          {TOGGLE_HOVER_TIP}
        </div>
      )}
    </div>
  );
}
