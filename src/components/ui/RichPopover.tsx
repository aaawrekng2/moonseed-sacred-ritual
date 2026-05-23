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
  /** EJ23 — optional target bounding rectangle. When provided, the
   *  popover uses preferred-placement positioning (above the target,
   *  flipping below on viewport collision) instead of cursor-relative
   *  placement. This is the industry-standard pattern from Popper.js,
   *  Floating UI, Radix, and Reach UI: a tooltip/popover should never
   *  overlap its trigger. Tarot Seed's constellation uses this so the
   *  popover doesn't cover the card or its badges. When omitted the
   *  popover falls back to the original cursor-anchored placement.
   */
  targetRect?: DOMRect | null;
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
  /** EJ5 — optional control rendered to the left of the ⓘ icon (only
   *  shown when chainedContent is provided). Used by the constellation
   *  surface to attach a gear menu for snoozing/disabling hover tips. */
  extraTopRightControl?: React.ReactNode;
};

export function RichPopover({
  open,
  anchorX,
  anchorY,
  targetRect,
  onClose,
  onCancelDismiss,
  onScheduleDismiss,
  children,
  chainedContent,
  chainedTitle = "Color guide",
  maxWidth = 280,
  extraTopRightControl,
}: RichPopoverProps) {
  // Lock position once the cursor enters the popover so the user can
  // travel to the ⓘ icon without the popover chasing them away.
  const [lockedPos, setLockedPos] = useState<{ x: number; y: number } | null>(null);
  const [showChained, setShowChained] = useState(false);
  // EJ23 — measure rendered popover height for collision detection.
  // Using a callback ref so we can measure synchronously and decide
  // above-vs-below before the seeker sees a flicker.
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Reset internal state when the popover closes externally.
  useEffect(() => {
    if (!open) {
      setLockedPos(null);
      setShowChained(false);
      setMeasuredHeight(null);
    }
  }, [open]);

  // EI5 — when the source provides a new anchor (cursor moved to a
  // different source element, e.g. day-cell A → day-cell B), reset
  // the locked position so the popover re-anchors at the new spot.
  // Without this the popover stays glued to wherever the first cell
  // anchored it, no matter how far the cursor wanders across the
  // calendar.
  useEffect(() => {
    setLockedPos(null);
    setShowChained(false);
    // EJ23 — also clear the measured height so the new anchor
    // re-measures and re-decides above-vs-below for the new target.
    setMeasuredHeight(null);
  }, [anchorX, anchorY]);

  // Escape key dismisses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // EJ23 — measure actual rendered height once the popover renders.
  // Triggers a re-render with the precise height, which makes the
  // above-vs-below placement decision accurate. Without this we'd
  // rely on the 200px estimate forever. Re-measures when content
  // changes (chained toggle, edit mode, etc.) so the placement
  // adapts to height changes. Deps include measuredHeight so the
  // effect short-circuits once converged (prevents infinite loop).
  useEffect(() => {
    if (!open) return;
    if (!popoverRef.current) return;
    const h = popoverRef.current.getBoundingClientRect().height;
    if (h > 0 && Math.abs((measuredHeight ?? 0) - h) > 1) {
      setMeasuredHeight(h);
    }
  }, [open, measuredHeight, showChained]);

  if (!open || typeof document === "undefined") return null;

  // EJ23 — when targetRect is provided, use industry-standard
  // preferred-placement positioning instead of cursor anchoring. The
  // popover prefers to sit ABOVE the target (preferred placement)
  // with an 8px gap. If there's not enough viewport room above, it
  // flips BELOW with the same gap. Horizontal position is centered
  // on the target, clamped to the viewport so it never clips.
  //
  // This mirrors how Popper.js, Floating UI, Radix, and Reach UI
  // position floating elements: preferred placement + flip on
  // collision + viewport clamping. Tooltips/popovers should never
  // overlap their trigger.
  //
  // EJ30 — small-target exception. For tiny triggers (calendar day
  // cells, ~20px tall), targetRect-centered positioning lands the
  // popover too far from the cursor. The user can't see the popover
  // because its top edge is 100+px above the cell, and crossing the
  // gap to reach the popover bottom risks the dismiss timer firing.
  // For small targets, switch to cursor-anchored placement with
  // smart vertical flip: place below cursor when cursor is in the
  // top half of the viewport, above when in the bottom half. Always
  // within ~8–24px of cursor, always reachable.
  const PLACEMENT_GAP = 8;
  const VIEWPORT_PAD = 8;
  const SMALL_TARGET_THRESHOLD = 32; // px — anything below this is "small"
  // Estimate popover height when measured is unavailable. The slim
  // hover is typically ~80–120px, the rich popover is taller. Using
  // 200 as a conservative pre-measure default; once measured the
  // exact value drives placement re-evaluation.
  const estimatedHeight = measuredHeight ?? 200;

  let initialLeft: number;
  let initialTop: number;

  const isSmallTarget = targetRect != null && targetRect.height < SMALL_TARGET_THRESHOLD;

  if (targetRect && !isSmallTarget && typeof window !== "undefined") {
    // EJ23 preferred-placement for normal-sized targets (constellation
    // cards, chips, slot labels).
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Horizontal: center the popover on the target, clamped.
    const desiredLeft = targetRect.left + targetRect.width / 2 - maxWidth / 2;
    initialLeft = Math.max(VIEWPORT_PAD, Math.min(desiredLeft, vw - maxWidth - VIEWPORT_PAD));
    // Vertical: prefer ABOVE; flip to BELOW if no room.
    const aboveTop = targetRect.top - PLACEMENT_GAP - estimatedHeight;
    const belowTop = targetRect.bottom + PLACEMENT_GAP;
    const fitsAbove = aboveTop >= VIEWPORT_PAD;
    const fitsBelow = belowTop + estimatedHeight <= vh - VIEWPORT_PAD;
    if (fitsAbove) {
      initialTop = aboveTop;
    } else if (fitsBelow) {
      initialTop = belowTop;
    } else {
      // Neither fits cleanly; choose whichever has more room.
      const aboveRoom = targetRect.top - VIEWPORT_PAD;
      const belowRoom = vh - targetRect.bottom - VIEWPORT_PAD;
      initialTop =
        aboveRoom >= belowRoom
          ? Math.max(VIEWPORT_PAD, aboveTop)
          : Math.min(vh - estimatedHeight - VIEWPORT_PAD, belowTop);
    }
  } else if (typeof window !== "undefined") {
    // EJ30 — cursor-anchored smart-flip for small targets and the
    // legacy no-rect fallback (chips, etc.). Place the popover
    // adjacent to the cursor on the side that has the most viewport
    // room. Stays within reach so the dismiss timer doesn't fire
    // mid-travel.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Horizontal — prefer right of cursor; flip to left if clipping.
    const proposedLeft = anchorX + 8;
    if (proposedLeft + maxWidth > vw - VIEWPORT_PAD) {
      initialLeft = Math.max(VIEWPORT_PAD, anchorX - 8 - maxWidth);
    } else {
      initialLeft = proposedLeft;
    }
    // Vertical — smart flip:
    //   - cursor in top half  → place BELOW cursor with enough gap
    //     to clear a typical small target (~24px = cell height + a
    //     little air).
    //   - cursor in bottom half → place ABOVE cursor with a gap
    //     above the cursor (8px) so the popover bottom sits just
    //     above the cursor, well within reach.
    const cursorInTopHalf = anchorY < vh / 2;
    if (cursorInTopHalf) {
      const candidate = anchorY + 24;
      // Clamp so popover doesn't extend off-screen bottom.
      initialTop = Math.min(candidate, vh - estimatedHeight - VIEWPORT_PAD);
    } else {
      const candidate = anchorY - 8 - estimatedHeight;
      initialTop = Math.max(VIEWPORT_PAD, candidate);
    }
  } else {
    // SSR fallback.
    initialLeft = anchorX + 8;
    initialTop = anchorY + 8;
  }

  const finalLeft = lockedPos?.x ?? initialLeft;
  const finalTop = lockedPos?.y ?? initialTop;

  return createPortal(
    // EJ26 — hover-bridge halo dropped. The previous 20px transparent
    // pointer-events:auto wrapper was intercepting clicks on badges,
    // calendar day-cells, and other elements that overlapped its hit
    // area — since the wrapper renders in document.body's stacking
    // context at z-toast=300 and child stacking contexts (SVG <g>) can't
    // climb above 300, no z-index trick could rescue underlying buttons.
    // Industry pattern (Radix, Mantine, Floating UI, Linear, GitHub,
    // Notion): no physical hover-bridge — rely on the dismiss timer
    // (180ms grace period; bumped to 220ms here to compensate) to keep
    // the popover alive while the cursor crosses the gap from source
    // to popover. mouseEnter cancels the timer; mouseLeave re-arms it.
    // The popover wrapper IS the visible popover with no halo padding,
    // so clicks elsewhere never hit invisible popover real estate.
    <div
      ref={popoverRef}
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
        // EJ26 — whole-surface click opens the chained content (legend)
        // when chained content is provided and not already open. Saves
        // the seeker aiming at the small ⓘ icon. Consistent with Notion,
        // Linear, GitHub hover-card patterns where rich content surfaces
        // accept clicks anywhere to expand.
        cursor: chainedContent && !showChained ? "pointer" : "default",
      }}
      onClick={
        chainedContent && !showChained
          ? (e) => {
              // Don't fire if the click hit an interactive child (button
              // inside the popover). Buttons stop propagation; this
              // guard catches anything that didn't.
              const target = e.target as HTMLElement;
              if (target.closest("button, a, input, textarea, select")) return;
              setShowChained(true);
            }
          : undefined
      }
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
            <div
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              {extraTopRightControl}
              <button
                type="button"
                aria-label="More info"
                onMouseEnter={() => {
                  onCancelDismiss();
                  setShowChained(true);
                }}
                onFocus={() => setShowChained(true)}
                style={{
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
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
