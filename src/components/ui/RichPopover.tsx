/**
 * RichPopover — EH (replaces EG version).
 *
 * Portal-rendered dark popover. Two modes:
 *   1. PRIMARY: anchored near a hover/touch point. Once the cursor enters
 *      the popover, position locks so the cursor can travel to the
 *      chained-ⓘ icon without the popover chasing away.
 *   2. CHAINED: hover the ⓘ → primary fades, secondary appears in the
 *      same locked position with the legend content.
 *
 * The dismiss-timer lives in the PARENT, not here. The popover calls
 * `onCancelDismiss()` when the cursor enters it and `onScheduleDismiss()`
 * when the cursor leaves. The parent uses the same scheduler for source-
 * element mouseLeave events. That shared scheduler is what lets the
 * cursor cross the gap from source → popover without dismissing.
 *
 * Industry pattern: Apple, Notion, Linear. Replace-style chained tooltip
 * with hover-bridge dismiss forgiveness.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X as XIcon } from "lucide-react";

export type RichPopoverProps = {
  /** Whether the popover should be visible. */
  open: boolean;
  /** Source anchor coords (cursor or touched element). Used to initially
   * position the popover. */
  anchorX: number;
  anchorY: number;
  /** Called when user explicitly dismisses (Escape key). The parent's
   * own dismiss-scheduler handles mouse-leave-based dismissal. */
  onClose: () => void;
  /** Cancel a pending dismiss (cursor entered popover or stayed in
   * its hover-bridge area). */
  onCancelDismiss: () => void;
  /** Schedule a dismiss (cursor left popover). */
  onScheduleDismiss: () => void;
  /** Primary content. */
  children: React.ReactNode;
  /** Optional chained content. When provided, an ⓘ icon appears in the
   * top-right of the primary popover; hovering it swaps to the chained
   * content. */
  chainedContent?: React.ReactNode;
  /** Title for the chained content. */
  chainedTitle?: string;
  /** Max width in px. */
  maxWidth?: number;
};

export function RichPopover({
  open,
  anchorX,
  anchorY,
  onClose,
  onCancelDismiss,
  onScheduleDismiss,
  children,
  chainedContent,
  chainedTitle = "Color guide",
  maxWidth = 280,
}: RichPopoverProps) {
  // Lock position once the cursor enters the popover so the user can
  // travel to the ⓘ icon without the popover chasing them away.
  const [lockedPos, setLockedPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [showChained, setShowChained] = useState(false);

  // Reset internal state when the popover closes externally.
  useEffect(() => {
    if (!open) {
      setLockedPos(null);
      setShowChained(false);
    }
  }, [open]);

  // Escape key dismisses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Compute initial position (offset down-right from anchor; flip left
  // if it would overflow the viewport).
  const offsetX = 16;
  const offsetY = 16;
  const proposedLeft = anchorX + offsetX;
  const initialLeft =
    typeof window !== "undefined" &&
    proposedLeft + maxWidth > window.innerWidth - 8
      ? Math.max(8, anchorX - offsetX - maxWidth)
      : proposedLeft;
  const initialTop = anchorY + offsetY;

  const finalLeft = lockedPos?.x ?? initialLeft;
  const finalTop = lockedPos?.y ?? initialTop;

  return createPortal(
    <div
      role="tooltip"
      onMouseEnter={() => {
        onCancelDismiss();
        if (!lockedPos) setLockedPos({ x: finalLeft, y: finalTop });
      }}
      onMouseLeave={onScheduleDismiss}
      style={{
        position: "fixed",
        left: finalLeft,
        top: finalTop,
        zIndex: "var(--z-toast)" as unknown as number,
        // CRITICAL — pointerEvents MUST be auto so the popover receives
        // its own mouseEnter/Leave events. Without this the popover is
        // unreachable. Previous EG version had pointerEvents: 'none'
        // when there was no chainedContent, which prevented hover-
        // bridge from working entirely.
        pointerEvents: "auto",
        maxWidth,
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--surface-card)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: "var(--color-foreground)",
      }}
    >
      {showChained ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--color-foreground)",
                lineHeight: 1.2,
              }}
            >
              {chainedTitle}
            </div>
            <button
              type="button"
              aria-label="Back"
              onClick={() => setShowChained(false)}
              onMouseEnter={onCancelDismiss}
              style={{
                appearance: "none",
                background: "transparent",
                border: "none",
                color: "var(--color-foreground)",
                opacity: 0.6,
                cursor: "pointer",
                padding: 2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <XIcon size={12} />
            </button>
          </div>
          {chainedContent}
        </>
      ) : (
        <>
          {children}
          {chainedContent && (
            <button
              type="button"
              aria-label="More info"
              onMouseEnter={() => {
                onCancelDismiss();
                setShowChained(true);
              }}
              onFocus={() => setShowChained(true)}
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                appearance: "none",
                background: "transparent",
                border: "none",
                color: "var(--color-foreground)",
                opacity: 0.5,
                cursor: "pointer",
                padding: 2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "opacity 120ms",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.opacity = "0.5";
              }}
            >
              <Info size={14} />
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
