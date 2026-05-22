/**
 * RichPopover — EG.
 *
 * A portal-rendered dark popover with two modes:
 *   1. PRIMARY: anchored near a hover/touch point. Cursor-follow position
 *      until the cursor enters the popover, at which point position locks
 *      so the user can travel to the chained-ⓘ icon.
 *   2. CHAINED: when the seeker hovers the ⓘ icon, primary fades and a
 *      secondary popover appears in the same locked position with deeper
 *      content (e.g. a color legend).
 *
 * Convention:
 * - PC: hover triggers open. Mouse-leave the source AND the popover both
 *   dismiss (with a small forgiveness delay so users can travel to ⓘ).
 * - Tablet/touch: long-press the source triggers open. Tap outside or
 *   long-release dismisses.
 *
 * Industry pattern: Apple Calendar / Stocks, Notion @mentions, Linear
 * issue cards. Replace-style chained-tooltip — primary fades, secondary
 * appears in the same position so the cursor doesn't have to re-target.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X as XIcon } from "lucide-react";

const DISMISS_DELAY_MS = 150;

export type RichPopoverProps = {
  /** Whether the popover should be visible. */
  open: boolean;
  /** Source anchor coords (cursor or touched element). Used to initially
   * position the popover. Once the cursor enters the popover, position
   * locks. */
  anchorX: number;
  anchorY: number;
  /** Called when the popover should dismiss (mouse-leave timeout fires,
   * Escape pressed, or outside-tap on touch). */
  onClose: () => void;
  /** Primary content (the default popover body). */
  children: React.ReactNode;
  /** Optional: when present, a small ⓘ icon appears in the top-right of
   * the primary popover. Hovering the icon swaps to the chained content. */
  chainedContent?: React.ReactNode;
  /** Title for the chained content (e.g. "Color guide"). */
  chainedTitle?: string;
  /** Max width in px. Defaults to 280. */
  maxWidth?: number;
};

export function RichPopover({
  open,
  anchorX,
  anchorY,
  onClose,
  children,
  chainedContent,
  chainedTitle = "Color guide",
  maxWidth = 280,
}: RichPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Lock position once the cursor enters the popover so the user can
  // travel to the ⓘ icon without the popover chasing them away.
  const [lockedPos, setLockedPos] = useState<{ x: number; y: number } | null>(null);
  const [showChained, setShowChained] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);

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

  const clearDismiss = () => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };
  const scheduleDismiss = () => {
    clearDismiss();
    dismissTimerRef.current = window.setTimeout(() => {
      onClose();
    }, DISMISS_DELAY_MS);
  };

  return createPortal(
    <div
      ref={popoverRef}
      role="tooltip"
      onMouseEnter={() => {
        clearDismiss();
        if (!lockedPos) setLockedPos({ x: finalLeft, y: finalTop });
      }}
      onMouseLeave={scheduleDismiss}
      style={{
        position: "fixed",
        left: finalLeft,
        top: finalTop,
        zIndex: "var(--z-toast)" as unknown as number,
        // Allow pointer events so the user can hover the ⓘ icon and
        // reach the chained content. The source element's own
        // mouseLeave handler is responsible for closing when the
        // cursor leaves the entire group.
        pointerEvents: chainedContent ? "auto" : "none",
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
          {/* Chained / legend content header with a close-back arrow */}
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
              onMouseEnter={clearDismiss}
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
                clearDismiss();
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
