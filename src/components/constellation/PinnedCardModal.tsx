/**
 * EJ20 — Pinned card modal.
 *
 * The seeker can pin a hover-popover into a persistent floating modal
 * so they can compare cards side-by-side without holding the hover
 * state. Multiple pinned modals dock at the bottom of the viewport in
 * a row (left-to-right by pin order) and each is independently
 * draggable. Closing one with the X removes it from the pin list.
 *
 * The modal renders WHATEVER content the parent provides via children.
 * The /constellation page passes the same JSX the hover popover would
 * have shown for that cardId, so visually the pinned modal is a
 * frozen copy of the hover popover.
 *
 * Position is initialised based on the modal's index in the pin row
 * (auto-stacked side-by-side at the bottom). Once the seeker drags
 * a modal, its position becomes locked to wherever they put it.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type PinnedCardModalProps = {
  cardId: number;
  // Position index in the pinned row, 0-based. Used to compute the
  // initial bottom-docked x position.
  index: number;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
};

const DEFAULT_WIDTH = 340;
const BOTTOM_DOCK_PAD = 16;
const HORIZONTAL_GAP = 12;

export function PinnedCardModal({
  cardId: _cardId,
  index,
  onClose,
  children,
  width = DEFAULT_WIDTH,
}: PinnedCardModalProps) {
  // Track whether the seeker has dragged this modal manually. Once
  // dragged, we stop auto-arranging it; otherwise it follows the
  // bottom-dock formula keyed to its `index`.
  const [hasBeenDragged, setHasBeenDragged] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const isDraggingRef = useRef(false);

  // Compute the auto-docked position when not yet dragged. Re-runs on
  // window resize and index changes so modals re-arrange neatly.
  useEffect(() => {
    if (hasBeenDragged) return;
    const compute = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      // Modal height is content-driven; estimate 480 for the row
      // bottom anchor. Real top is set so the BOTTOM of the modal
      // sits 16px above the viewport bottom regardless of content.
      // We position absolute, so use a top offset that puts the
      // modal's top near the viewport's lower section.
      const estimatedHeight = 480;
      const top = Math.max(40, viewportHeight - estimatedHeight - BOTTOM_DOCK_PAD);
      // Row starts at center of viewport horizontally if total width
      // fits, else from the left with HORIZONTAL_GAP from screen
      // edge.
      const left = BOTTOM_DOCK_PAD + index * (width + HORIZONTAL_GAP);
      // Clamp to viewport so far-right modals don't disappear.
      const maxLeft = Math.max(0, viewportWidth - width - BOTTOM_DOCK_PAD);
      setPos({ left: Math.min(left, maxLeft), top });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [index, width, hasBeenDragged]);

  // Drag handlers — pointer events for cross-platform consistency.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pos) return;
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      dx: e.clientX - pos.left,
      dy: e.clientY - pos.top,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !dragOffsetRef.current) return;
    const next = {
      left: e.clientX - dragOffsetRef.current.dx,
      top: e.clientY - dragOffsetRef.current.dy,
    };
    // Clamp inside viewport so a modal can't be lost off-screen.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    next.left = Math.max(0, Math.min(next.left, vw - width));
    next.top = Math.max(0, Math.min(next.top, vh - 60));
    setPos(next);
    setHasBeenDragged(true);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    dragOffsetRef.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  if (!pos) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        boxShadow: "0 10px 32px rgba(0,0,0,0.45)",
        zIndex: "var(--z-modal-nested, 200)" as unknown as number,
        display: "flex",
        flexDirection: "column",
        maxHeight: "85vh",
        overflow: "hidden",
      }}
    >
      {/* Drag handle bar — 20px tall thin strip at the top with X on
          the right. Pointer events captured here move the whole
          modal. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
          padding: "4px 6px",
          background: "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)",
          borderBottom: "1px solid var(--border-subtle)",
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            flex: 1,
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--accent, var(--gold))",
            opacity: 0.65,
            paddingLeft: 6,
          }}
        >
          pinned · drag to move
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close pinned card"
          title="Close"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            padding: 0,
            background: "transparent",
            border: "none",
            color: "var(--color-foreground)",
            cursor: "pointer",
            borderRadius: 4,
          }}
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      </div>
      {/* Body — scrollable when content overflows the viewport
          allowance. */}
      <div
        style={{
          padding: "10px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
