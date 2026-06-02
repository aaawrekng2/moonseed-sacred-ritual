/**
 * EK33 — SlotLabel.
 *
 * Shared component that renders a spread position label as a tappable
 * underlined affordance. On tap, opens a small popover anchored to the
 * label containing the position's full name + one-sentence description.
 * Re-tapping the label closes the popover; tapping outside also closes.
 *
 * When `name` is falsy (e.g., custom spreads with no `positions` data),
 * the component renders nothing — the styling doc explicitly bans the
 * generic "Slot N" / "Card N" fallback. Naming a slot is only valid when
 * a real position name exists.
 *
 * Two variants:
 * - `short` — the rail labels (small, tightly-packed; full name surfaces
 *   in the popover so the rail stays clean).
 * - `full` — the spread layout labels (above/below each card on
 *   /draw post-pick).
 *
 * Used by:
 * - Tabletop.tsx (the draw-table rail under each slot)
 * - SpreadLayout.tsx (PositionLabel above each card in the spread)
 * - ConstellationPage / ManualEntryBuilder via the same shared API
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SlotLabelProps {
  /**
   * Short label rendered as the visible underlined text. For the rail this
   * is the `positionsShort` value (e.g. "Pres"); for the spread layout
   * this is typically the full `positions` value (e.g. "The Present"). When
   * undefined/null the component renders nothing.
   */
  shortName: string | null | undefined;
  /**
   * Full position name shown as the popover header. Falls back to
   * `shortName` if not provided. When both are absent, the popover renders
   * with just the description (or nothing if that's also absent).
   */
  fullName?: string | null;
  /** One-sentence explanation of what this slot represents. */
  description?: string | null;
  /** Optional className passed through to the visible underlined text. */
  className?: string;
  /** Optional inline styles for the visible underlined text. */
  style?: React.CSSProperties;
  /**
   * Override for the popover container element style. Useful if the
   * caller needs to constrain width within a tight rail context.
   */
  popoverStyle?: React.CSSProperties;
}

export function SlotLabel({
  shortName,
  fullName,
  description,
  className,
  style,
  popoverStyle,
}: SlotLabelProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Tap-outside dismissal. Attached only while the popover is open so
  // there's no idle listener cost. The trigger button is excluded from
  // "outside" via the ref check below — otherwise the trigger's own
  // toggle and the outside-click handler would both fire on a tap and
  // the popover would immediately re-close.
  useEffect(() => {
    if (!open) return;
    const handle = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      // The popover itself is portaled to body, so a check against the
      // trigger's ancestors won't help. We use the data-attribute lookup
      // below to find the popover panel and skip dismissal when the
      // pointer down lands inside it (so users can copy text from the
      // description, etc.).
      const popoverPanel = document.querySelector('[data-slot-label-popover="1"]');
      if (popoverPanel && popoverPanel.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handle, true);
    return () => document.removeEventListener("pointerdown", handle, true);
  }, [open]);
  // Re-measure the trigger when the popover opens so its rect drives the
  // popover's anchor coords. Doing it on toggle rather than on every
  // render means layout shifts elsewhere on the page don't reposition the
  // popover mid-open — that would feel unstable.
  const handleToggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };
  // EK33 — When shortName is falsy, render NOTHING. The styling doc
  // bans the "Slot N" / "Card N" fallback; the new contract is that a
  // slot only labels itself when a real position name exists. Custom
  // spreads have no `positions` array, so they fall through to this
  // null return and their slots simply don't get a label.
  if (!shortName) return null;
  // Construct the popover panel. Anchored ABOVE the trigger so it
  // doesn't get clipped by the rail's bottom edge (the rail sits near
  // the bottom of the viewport). Caller can override via popoverStyle if
  // a specific placement is needed elsewhere.
  let panel: React.ReactNode = null;
  if (open && anchorRect) {
    // Estimate popover dimensions for placement. We use a fixed max-width
    // so positioning is deterministic even before measurement; the
    // browser handles the actual sizing.
    const PANEL_MAX_W = 240;
    const GAP = 8;
    // Center the panel above the trigger. If clipping at the viewport
    // edge would occur, clamp into view with an 8px margin.
    const centerX = anchorRect.left + anchorRect.width / 2;
    let left = centerX - PANEL_MAX_W / 2;
    if (left < 8) left = 8;
    if (left + PANEL_MAX_W > window.innerWidth - 8)
      left = window.innerWidth - 8 - PANEL_MAX_W;
    // Default placement = above the trigger. If there's not enough room
    // above, flip below.
    const above = anchorRect.top > 140; // enough space for ~6-line panel
    const top = above
      ? anchorRect.top - GAP
      : anchorRect.bottom + GAP;
    panel = createPortal(
      <div
        data-slot-label-popover="1"
        role="dialog"
        aria-label={fullName ?? shortName ?? "Position information"}
        style={{
          position: "fixed",
          top,
          left,
          maxWidth: PANEL_MAX_W,
          // Above the TopNav (40), modal scrims (50), but below
          // intentionally high-z dropdowns. Sits at z-popover ladder.
          zIndex: "var(--z-popover, 50)" as unknown as number,
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 10,
          padding: "10px 12px",
          fontFamily: "var(--font-serif)",
          color: "var(--color-foreground)",
          boxShadow:
            "0 8px 24px color-mix(in oklch, var(--color-foreground) 14%, transparent)",
          // Translate Y so the popover sits just above (or below) the
          // trigger rather than overlapping its top edge.
          transform: above ? "translateY(-100%)" : undefined,
          ...popoverStyle,
        }}
      >
        {fullName ? (
          <div
            style={{
              fontSize: "var(--text-body, 0.95rem)",
              fontStyle: "italic",
              marginBottom: description ? 4 : 0,
              color: "var(--color-foreground)",
            }}
          >
            {fullName}
          </div>
        ) : null}
        {description ? (
          <div
            style={{
              fontSize: "var(--text-body-sm, 0.85rem)",
              opacity: 0.85,
              lineHeight: 1.4,
            }}
          >
            {description}
          </div>
        ) : null}
      </div>,
      document.body,
    );
  }
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={className}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          // Underlined affordance — per styling doc, underlines signal
          // interactivity. No background, no border, no pill.
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "inherit",
          textDecoration: "underline",
          textUnderlineOffset: 3,
          textDecorationThickness: "1px",
          textDecorationColor:
            "color-mix(in oklch, var(--color-foreground) 40%, transparent)",
          cursor: "pointer",
          ...style,
        }}
      >
        {shortName}
      </button>
      {panel}
    </>
  );
}
