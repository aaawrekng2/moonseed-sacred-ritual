import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardBack } from "@/components/cards/CardBack";
import { useActiveCardBackUrl, useActiveDeckImage } from "@/lib/active-deck";
import { getCardName } from "@/lib/tarot";
import type { CardBackId } from "@/lib/card-backs";
import { cn } from "@/lib/utils";
import { TABLETOP_CONFIG } from "./config";
import type { CardState } from "./types";

export function CardSlot({
  card,
  cardW,
  cardH,
  cardBack,
  faceIndex,
  disabled,
  hitInset,
  onSelect,
  settleDelay,
  tapMoveThresholdPx,
  slotRect,
  flightMs,
  containerOrigin,
  onDragEnd,
  onDragMove,
  isCoarsePointer,
  containerRect,
  containerElRef,
}: {
  card: CardState;
  cardW: number;
  cardH: number;
  cardBack: CardBackId;
  faceIndex: number;
  disabled: boolean;
  hitInset: number;
  onSelect: () => void;
  settleDelay: number;
  tapMoveThresholdPx: number;
  /**
   * Viewport-coordinate rect of this card's slot when it has been
   * selected as part of a multi-card spread. When non-null the card
   * positions itself with `position: fixed` and animates to the slot.
   * Null for unselected cards or single-card spreads (in-place glow).
   */
  slotRect: DOMRect | null;
  flightMs: number;
  /**
   * Viewport offset of the scatter container — needed to convert a
   * card's container-relative scatter coords (card.x / card.y) into
   * viewport coords for the return-flight animation.
   */
  containerOrigin: { left: number; top: number } | null;
  /**
   * Drag pipeline. Pointer is held for ≥150ms (touch) or moved past
   * the tap threshold (mouse) → CardSlot enters drag mode, follows the
   * pointer, and on release calls `onDragEnd` so the parent can decide
   * slot-drop vs. table-move. `containerRect` and `containerOrigin` let
   * us convert between viewport and container coordinates.
   */
  onDragEnd: (
    cardId: number,
    clientX: number,
    clientY: number,
    tableX: number,
    tableY: number,
    fromX: number,
    fromY: number,
  ) => void;
  onDragMove: (
    clientX: number,
    clientY: number,
    /** Card's projected top-left in viewport coords if dropped now. */
    projectedLeft: number,
    projectedTop: number,
  ) => void;
  isCoarsePointer: boolean;
  containerRect:
    | { left: number; top: number; width: number; height: number }
    | null;
  /**
   * Live ref to the scatter container element. We always re-measure
   * with `getBoundingClientRect()` at drag start and during
   * `handlePointerMove` because the cached `containerRect` prop can
   * be stale on mobile (e.g. after browser chrome show/hide, address
   * bar collapse, or virtual keyboard) — the root cause of the
   * "card flies to upper-left" bug.
   */
  containerElRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isSelected = card.selectionOrder !== null;
  const cardImg = useActiveDeckImage();
  // BX — render custom deck back when an active deck has one.
  const customBackUrl = useActiveCardBackUrl();
  // When the card landed in the slot via a physical drag-drop we skip
  // the FLIP-style flight animation entirely — the user just placed it
  // there, animating it from the scatter coords (where it would re-mount
  // for one frame) creates a jarring disappear/reappear flicker.
  const skipFlight = isSelected && card.isDragDrop === true;
  const flying = isSelected && slotRect !== null && !skipFlight;
  const glow = `0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD}px var(--gold)`;

  // Ref to the root button so we can measure its viewport rect before the
  // flight begins (FLIP-style: capture First, set Last, animate transform).
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Flight state machine. 'idle' = scattered/in-place. 'launching' = card
  // freshly promoted to fixed positioning at its captured viewport rect (no
  // visual jump yet). 'arrived' = card has been told to move to the slot
  // rect; CSS transition carries it there. 'returning' = card is flying
  // *back* from its last slot rect to a fresh scatter spot on the table.
  type FlightPhase = "idle" | "launching" | "arrived" | "returning";
  const [flightPhase, setFlightPhase] = useState<FlightPhase>("idle");
  // Captured viewport rect at the moment the card was selected.
  const [launchRect, setLaunchRect] = useState<DOMRect | null>(null);
  // The slot rect the card was occupying right before being released back
  // to the table. Used as the starting position of the return flight.
  const [returnFromRect, setReturnFromRect] = useState<DOMRect | null>(null);
  // Captured rotation at launch — we ease this back to 0 during flight.
  const launchRotationRef = useRef(0);
  // Most recent slotRect we saw while flying. Tracked separately so that
  // when the parent clears slotRect (card released) we still know where
  // the card visually was a frame ago.
  const lastSlotRectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    if (slotRect) lastSlotRectRef.current = slotRect;
  }, [slotRect]);

  // Detect the moment the card becomes flying-eligible. Capture its current
  // bbox synchronously so the upcoming switch from absolute(scatter) →
  // fixed(viewport) does not produce a one-frame jump.
  useLayoutEffect(() => {
    if (!flying) {
      // Was on a flight (arrived/launching) and lost the slotRect → start
      // a return flight from the last known slot position. If we don't
      // have a slotRect cached we still need to leave the flight cleanly
      // — fall back to idle without a fly so the card doesn't blink.
      if (
        (flightPhase === "arrived" || flightPhase === "launching") &&
        lastSlotRectRef.current
      ) {
        setReturnFromRect(lastSlotRectRef.current);
        setFlightPhase("returning");
      } else if (flightPhase !== "idle" && flightPhase !== "returning") {
        setFlightPhase("idle");
      }
      return;
    }
    if (flightPhase === "idle") {
      const r = btnRef.current?.getBoundingClientRect() ?? null;
      setLaunchRect(r);
      // Capture the card's actual current visual rotation so the launch
      // frame paints at the same orientation, preventing a visible jump.
      launchRotationRef.current = card.rotation;
      setFlightPhase("launching");
    }
  }, [flying, flightPhase, card.rotation]);

  // After one paint at the launch rect, transition to the slot rect.
  useEffect(() => {
    if (flightPhase !== "launching") return;
    const id = window.requestAnimationFrame(() => {
      // Second rAF guarantees the browser has painted the launch frame
      // before applying the destination styles, so the transition fires.
      window.requestAnimationFrame(() => setFlightPhase("arrived"));
    });
    return () => window.cancelAnimationFrame(id);
  }, [flightPhase]);

  // Returning: paint one frame at the last slot rect, then transition to
  // the fresh scatter target. After flightMs settle back into 'idle' so
  // the card returns to absolute positioning inside the scatter.
  const [returnAnimating, setReturnAnimating] = useState(false);
  useEffect(() => {
    if (flightPhase !== "returning") return;
    setReturnAnimating(false);
    const raf1 = window.requestAnimationFrame(() => {
      const raf2 = window.requestAnimationFrame(() => setReturnAnimating(true));
      return () => window.cancelAnimationFrame(raf2);
    });
    const settle = window.setTimeout(() => {
      setFlightPhase("idle");
      setReturnFromRect(null);
      lastSlotRectRef.current = null;
      setReturnAnimating(false);
    }, flightMs + 40);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(settle);
    };
  }, [flightPhase, flightMs]);

  // Re-trigger the tap micro-animation on every click by toggling a key.
  const [tapTick, setTapTick] = useState(0);
  // Sacred consecration: play a slow ceremonial animation once each time a
  // card transitions from unselected → selected. Tracked via a tick that
  // re-keys the animation wrapper so React replays it cleanly. Cleared
  // after the animation duration so the static selected glow takes over.
  const [consecrateTick, setConsecrateTick] = useState(0);
  const [consecrating, setConsecrating] = useState(false);
  const prevSelectedRef = useRef(isSelected);
  useEffect(() => {
    if (isSelected && !prevSelectedRef.current) {
      setConsecrateTick((t) => t + 1);
      setConsecrating(true);
      const id = window.setTimeout(() => setConsecrating(false), 1400);
      prevSelectedRef.current = isSelected;
      return () => window.clearTimeout(id);
    }
    prevSelectedRef.current = isSelected;
  }, [isSelected]);

  // Sacred flip: when this card transitions face-down → face-up, play the
  // lift + halo animation alongside the rotateY flip. Tracked separately
  // from `revealed` so the halo cleanly unmounts after the animation.
  const [revealTick, setRevealTick] = useState(0);
  const [flipping, setFlipping] = useState(false);
  // Brief gold breath on the face once the flip is essentially done.
  // Triggered shortly before the rotateY transition fully settles so the
  // glow appears to "ignite" the freshly revealed face.
  const [faceGlowing, setFaceGlowing] = useState(false);
  const [faceGlowTick, setFaceGlowTick] = useState(0);
  const prevRevealedRef = useRef(card.revealed);
  useEffect(() => {
    if (card.revealed && !prevRevealedRef.current) {
      setRevealTick((t) => t + 1);
      setFlipping(true);
      const flipDone = window.setTimeout(
        () => setFlipping(false),
        TABLETOP_CONFIG.REVEAL_ANIMATION_MS + 60,
      );
      // Ignite the face glow at ~75% through the flip so it crests just
      // as the front face becomes fully visible, then fades over ~1.4s.
      const glowStart = window.setTimeout(() => {
        setFaceGlowTick((t) => t + 1);
        setFaceGlowing(true);
      }, Math.round(TABLETOP_CONFIG.REVEAL_ANIMATION_MS * 0.75));
      const glowEnd = window.setTimeout(
        () => setFaceGlowing(false),
        Math.round(TABLETOP_CONFIG.REVEAL_ANIMATION_MS * 0.75) + 1400 + 60,
      );
      prevRevealedRef.current = card.revealed;
      return () => {
        window.clearTimeout(flipDone);
        window.clearTimeout(glowStart);
        window.clearTimeout(glowEnd);
      };
    }
    prevRevealedRef.current = card.revealed;
  }, [card.revealed]);

  // Track pointer-down position so we can distinguish a deliberate tap from
  // a swipe / drag. Any movement past `tapMoveThresholdPx` cancels the tap
  // and the click handler bails out — selection only changes on real taps.
  const downPosRef = useRef<{ x: number; y: number; cancelled: boolean } | null>(
    null,
  );

  // ---- Drag state machine -----------------------------------------------
  // `dragging` flips true once the pointer has been held for 150ms (the
  // hold-to-drag threshold from the spec) — at which point the card lifts,
  // follows the pointer with `position: fixed`, and the eventual click
  // handler is suppressed so selection state is preserved.
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // After a drag completes, the card re-renders into the absolute "idle"
  // style branch which carries `animation: settle-in 320ms` — that
  // animation starts at `opacity: 0` and is the source of the visible
  // disappear/reappear flicker on release. We track the most recent drag
  // so we can suppress `settle-in` for one render cycle after dropping.
  const wasDraggedRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    currentClientX: number;
    currentClientY: number;
    pointerOffsetX: number; // pointer offset inside the card on grab
    pointerOffsetY: number;
    fromX: number; // card's pre-drag table coords
    fromY: number;
    holdTimer: number | null;
    didDrag: boolean;
  } | null>(null);

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
    setDragging(true);
    if (dragStateRef.current) {
      // Fire one immediate move so the card jumps to the pointer location
      // (it was sitting at its scatter slot during the hold).
      const s = dragStateRef.current;
      // Re-measure the card NOW (not at pointerdown) so the pointer offset
      // matches the card's actual on-screen position at the moment drag
      // begins. This is important on mobile where the card may have shifted
      // between pointerdown and the hold-timer firing (layout shifts,
      // toolbar collapse, settle-in animation completing). Computing the
      // offset against a stale rect produced the "card jumps on grab" bug.
      const cardRect = btnRef.current?.getBoundingClientRect();
      const activeClientX = s.currentClientX;
      const activeClientY = s.currentClientY;
      if (cardRect) {
        s.pointerOffsetX = activeClientX - cardRect.left;
        s.pointerOffsetY = activeClientY - cardRect.top;
      }
      // Convert pointer position to container coords. ALWAYS re-measure
      // the container at drag start — the cached `containerRect` prop
      // can be stale on mobile (browser chrome show/hide, address-bar
      // collapse, layout shifts) which manifested as the "card flies
      // to upper-left" bug. Falling back to the prop, then 0, only as
      // a last resort.
      const freshRect = containerElRef.current?.getBoundingClientRect();
      const cLeft = freshRect?.left ?? containerRect?.left ?? 0;
      // Cards are absolutely positioned, so their `top` coords are
      // relative to the container's BORDER edge (padding does not
      // offset absolutely positioned children). Use the border-edge
      // top directly — TOP_RESERVE is baked into card Y values via
      // buildScatter's `topOffset`, so no per-frame adjustment here.
      const cTop = freshRect?.top ?? containerRect?.top ?? 0;
      setDragPos({
        x: activeClientX - s.pointerOffsetX - cLeft,
        y: activeClientY - s.pointerOffsetY - cTop,
      });
      onDragMove(
        activeClientX,
        activeClientY,
        activeClientX - s.pointerOffsetX,
        activeClientY - s.pointerOffsetY,
      );
    }
  }, [onDragMove, containerRect, containerElRef]);

  // Touch / coarse pointer activates drag faster (80ms) so a quick
  // press-and-move doesn't get treated as a tap. Mouse keeps 150ms.
  const HOLD_MS = isCoarsePointer ? 80 : 150;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (card.revealed) return; // never drag a face-up card
    // Suppress the browser's native drag image / focus outline that would
    // otherwise leave a "ghost" of the card at its original position once
    // the user lifts their finger. Pointer events handle everything.
    e.preventDefault();
    downPosRef.current = { x: e.clientX, y: e.clientY, cancelled: false };
    // Capture the pointer so we keep receiving move/up events even if the
    // pointer leaves the button bounds during the drag.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw in rare edge cases — safe to ignore */
    }
    dragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      currentClientX: e.clientX,
      currentClientY: e.clientY,
      // Pointer offset inside the card is computed in `beginDrag` against
      // a fresh card rect, not here — the card may move between pointerdown
      // and the hold timer firing. Initialised to 0 as a safe default.
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      fromX: card.x,
      fromY: card.y,
      holdTimer: window.setTimeout(beginDrag, HOLD_MS),
      didDrag: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = downPosRef.current;
    if (d && !d.cancelled) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (dx * dx + dy * dy > tapMoveThresholdPx * tapMoveThresholdPx) {
        d.cancelled = true;
        // On coarse pointers (touch/mobile), activate drag immediately on
        // movement past the threshold rather than waiting for the hold
        // timer. This matches the standard Android drag pattern where a
        // finger that's moving is clearly trying to drag, not tap.
        // Fine pointers (mouse) keep the hold-timer behaviour so a quick
        // mouse drag still feels intentional.
        const s = dragStateRef.current;
        if (isCoarsePointer && s && !draggingRef.current) {
          if (s.holdTimer != null) {
            window.clearTimeout(s.holdTimer);
            s.holdTimer = null;
          }
          beginDrag();
        }
      }
    }
    const s = dragStateRef.current;
    if (!s) return;
    s.currentClientX = e.clientX;
    s.currentClientY = e.clientY;
    if (!draggingRef.current) return;
    s.didDrag = true;
    // Move the card via direct DOM mutation rather than React state so
    // every pointermove doesn't trigger a render. The `dragging` style
    // branch is already active (set once in beginDrag) and uses
    // `position: absolute` with `left`/`top`, so writing those properties
    // here is enough — and crucially avoids any React reconciliation
    // that could momentarily detach the inline styles.
    const el = btnRef.current;
    // Convert viewport coords → container coords using a FRESH measurement.
    // The cached prop can be stale on mobile during a drag (toolbar
    // collapse mid-gesture) so we re-measure every move.
    const freshRect = containerElRef.current?.getBoundingClientRect();
    const cLeft = freshRect?.left ?? containerRect?.left ?? 0;
    // Border edge — absolute children are NOT offset by padding-top.
    const cTop = freshRect?.top ?? containerRect?.top ?? 0;
    if (el) {
      el.style.left = `${e.clientX - s.pointerOffsetX - cLeft}px`;
      el.style.top = `${e.clientY - s.pointerOffsetY - cTop}px`;
    }
    onDragMove(
      e.clientX,
      e.clientY,
      e.clientX - s.pointerOffsetX,
      e.clientY - s.pointerOffsetY,
    );
  };

  const finishDrag = (clientX: number, clientY: number) => {
    const s = dragStateRef.current;
    if (!s) return false;
    if (s.holdTimer != null) {
      window.clearTimeout(s.holdTimer);
      s.holdTimer = null;
    }
    const wasDragging = dragging && s.didDrag;
    const freshRect = containerElRef.current?.getBoundingClientRect();
    const liveRect = freshRect ?? containerRect;
    if (wasDragging && liveRect) {
      // Convert the drop point back into container coordinates (border
      // edge — absolute children ignore padding-top) and clamp inside
      // the visible scatter zone. The lower Y bound is TOP_RESERVE so a
      // card cannot be released under the top bar.
      const targetLeft = clientX - s.pointerOffsetX - liveRect.left;
      const targetTop = clientY - s.pointerOffsetY - liveRect.top;
      const clampedX = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          liveRect.width - cardW - TABLETOP_CONFIG.SCATTER_PADDING,
          targetLeft,
        ),
      );
      const clampedY = Math.max(
        TABLETOP_CONFIG.TOP_RESERVE + TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(
          liveRect.height - cardH - TABLETOP_CONFIG.SCATTER_PADDING,
          targetTop,
        ),
      );
      onDragEnd(card.id, clientX, clientY, clampedX, clampedY, s.fromX, s.fromY);
    }
    if (wasDragging) {
      // Suppress the `settle-in` fade/scale animation on the next render
      // — the card is already on screen at the drop position, animating
      // it back in from opacity:0 reads as a flicker.
      wasDraggedRef.current = true;
    }
    dragStateRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    setDragPos(null);
    return wasDragging;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    finishDrag(e.clientX, e.clientY);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (downPosRef.current) downPosRef.current.cancelled = true;
    finishDrag(e.clientX, e.clientY);
  };

  const handleClick = () => {
    const d = downPosRef.current;
    downPosRef.current = null;
    if (d?.cancelled) return; // swipe — never selects
    // Suppress the click that fires after a drag release — selection
    // state must be preserved across drags per spec.
    if (dragStateRef.current?.didDrag || dragging) return;
    setTapTick((t) => t + 1);
    onSelect();
  };

  return (
    <button
      type="button"
      ref={btnRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onMouseDown={(e) => e.preventDefault()}
      onFocus={(e) => e.currentTarget.blur()}
      // Disable native HTML5 drag — we handle drag with pointer events.
      // `draggable={false}` blocks the browser from initialising a drag
      // image (which is the source of the dashed-outline ghost left
      // behind on release).
      draggable={false}
      disabled={disabled && !card.revealed}
      data-card-id={card.id}
      aria-label={
        card.revealed
          ? `Revealed: ${getCardName(faceIndex)}`
          : isSelected
            ? `Selected position ${card.selectionOrder}`
            : "Face-down card"
      }
      className={cn(
        (flying && launchRect && slotRect) ||
        (flightPhase === "returning" && returnFromRect && containerOrigin) ||
        (skipFlight && slotRect) ||
        (dragging && dragPos)
          ? "fixed outline-none focus:outline-none focus-visible:outline-none"
          : "absolute outline-none focus:outline-none focus-visible:outline-none",
        flying || flightPhase === "returning" || dragging
          ? null
          : "card-idle-transition",
        // Remove default tap highlight on iOS / Android.
        "[-webkit-tap-highlight-color:transparent] [touch-action:none]",
        // Block the system drag-ghost on WebKit + suppress text selection
        // and the focus outline that becomes a "dashed ring" artifact.
        "select-none [-webkit-user-drag:none] [user-drag:none]",
        isSelected ? "z-30" : null,
      )}
      style={
        dragging && dragPos
          ? {
              // Card is being dragged — follow the pointer with a slight
              // lift (scale 1.05) and a subtle shadow. Selection state is
              // preserved via the existing render path; only positioning
              // is overridden here. We render with `position: fixed` and
              // viewport coords so the lifted card escapes the
              // tabletop-stage `overflow:hidden` clip and floats above the
              // bottom whisper / slot rail at zIndex 9999.
              left: (containerOrigin?.left ?? 0) + dragPos.x,
              top: (containerOrigin?.top ?? 0) + dragPos.y,
              width: cardW,
              height: cardH,
              transform: "rotate(0deg) scale(1.05)",
              transition: "none",
              zIndex: 9999,
              willChange: "left, top, transform",
              filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.55))",
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : skipFlight && slotRect
          ? {
              // Drag-drop placement: the card lives at its slot rect
              // immediately, with no FLIP transition. The user already
              // released over the slot — we don't want it to fly back
              // out and in again.
              left: slotRect.left,
              top: slotRect.top,
              width: slotRect.width,
              height: slotRect.height,
              transform: "rotate(0deg)",
              transition: "none",
              zIndex: 1500 + (card.selectionOrder ?? 0),
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : flightPhase === "returning" && returnFromRect && containerOrigin
          ? {
              // Fixed positioning during return flight. Start at the last
              // slot rect; on the next frame transition to the new scatter
              // viewport coords. After the transition completes the
              // settle effect drops the card back to absolute (idle).
              left: returnAnimating
                ? containerOrigin.left + card.x
                : returnFromRect.left,
              top: returnAnimating
                ? containerOrigin.top + card.y
                : returnFromRect.top,
              width: returnAnimating ? cardW : returnFromRect.width,
              height: returnAnimating ? cardH : returnFromRect.height,
              transform: returnAnimating
                ? `rotate(${card.rotation}deg)`
                : `rotate(0deg)`,
              transition: returnAnimating
                ? `left ${flightMs}ms cubic-bezier(0.22,1,0.36,1), top ${flightMs}ms cubic-bezier(0.22,1,0.36,1), width ${flightMs}ms cubic-bezier(0.22,1,0.36,1), height ${flightMs}ms cubic-bezier(0.22,1,0.36,1), transform ${flightMs}ms cubic-bezier(0.22,1,0.36,1)`
                : "none",
              zIndex: 1400,
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : flying && launchRect && slotRect
          ? {
              // Fixed (viewport) positioning during flight. Phase 'launching'
              // sits at the captured rect; phase 'arrived' is the slot rect.
              // The CSS transition between the two creates the flight.
              left:
                flightPhase === "launching" ? launchRect.left : slotRect.left,
              top:
                flightPhase === "launching" ? launchRect.top : slotRect.top,
              width:
                flightPhase === "launching" ? launchRect.width : slotRect.width,
              height:
                flightPhase === "launching"
                  ? launchRect.height
                  : slotRect.height,
              transform:
                flightPhase === "launching"
                  ? `rotate(${launchRotationRef.current}deg)`
                  : `rotate(0deg)`,
              transition:
                flightPhase === "launching"
                  ? "none"
                  : `left ${flightMs}ms cubic-bezier(0.22,1,0.36,1), top ${flightMs}ms cubic-bezier(0.22,1,0.36,1), width ${flightMs}ms cubic-bezier(0.22,1,0.36,1), height ${flightMs}ms cubic-bezier(0.22,1,0.36,1), transform ${flightMs}ms cubic-bezier(0.22,1,0.36,1)`,
              zIndex: 1500 + (card.selectionOrder ?? 0),
              ["--card-hit-inset" as string]: `${hitInset}px`,
            }
          : {
              left: card.x,
              top: card.y,
              width: cardW,
              height: cardH,
              // No translateY lift here: the "-4px" used to fire BEFORE
              // getBoundingClientRect() captured the launch position,
              // causing a one-frame teleport at flight start. The selected
              // glow + halo is enough to communicate selection.
              transform: `rotate(${card.rotation}deg)`,
              // Selected cards (and their numbered badges) must always sit above
              // every unselected card. Use a large constant well above any
              // possible scatter z value.
              zIndex: isSelected ? 1000 + (card.selectionOrder ?? 0) : card.z + 1,
              // Skip the settle-in entrance animation if the card was just
              // dragged — it's already at the drop position and replaying
              // the opacity:0 → 1 fade looks like a disappear/reappear.
              animation: wasDraggedRef.current
                ? "none"
                : `settle-in 320ms ease-out both`,
              animationDelay: wasDraggedRef.current ? "0ms" : `${settleDelay}ms`,
              // Drives the .card-hit element's inset via a CSS variable so the
              // touch target scales with the rendered card size.
              ["--card-hit-inset" as string]: `${hitInset}px`,
              ["--card-rotation" as string]: `${card.rotation}deg`,
            }
      }
    >
      {/* Invisible expanded hit area for easier tapping on mobile. */}
      <span aria-hidden="true" className="card-hit" />
      <div
        key={`${tapTick}-${consecrateTick}-${revealTick}`}
        className={cn(
          "relative rounded-[10px]",
          tapTick > 0 && !card.revealed && "animate-card-tap",
          consecrating && !card.revealed && "animate-card-consecrate animate-card-consecrate-halo",
          flipping && "animate-sacred-reveal",
        )}
        style={{
          // @ts-expect-error custom prop
          "--flip-ms": `${TABLETOP_CONFIG.REVEAL_ANIMATION_MS}ms`,
          // Inner content is always rendered at the table card dimensions
          // for crisp ornament scaling. While flying to a smaller slot we
          // apply a CSS scale transform so the visible content shrinks
          // smoothly to slot size, in lock-step with the button width
          // animating from cardW → slotRect.width.
          width: cardW,
          height: cardH,
          transform:
            flightPhase === "launching"
              ? "scale(1)"
              : flightPhase === "arrived" && slotRect
                ? `scale(${slotRect.width / cardW})`
                : flightPhase === "returning"
                  ? returnAnimating
                    ? "scale(1)"
                    : returnFromRect && cardW > 0
                      ? `scale(${returnFromRect.width / cardW})`
                      : "scale(1)"
                  : skipFlight && slotRect && cardW > 0
                    ? `scale(${slotRect.width / cardW})`
                    : undefined,
          transformOrigin: "top left",
          transition:
            flightPhase === "arrived" || flightPhase === "returning"
              ? `transform ${flightMs}ms cubic-bezier(0.22,1,0.36,1)`
              : undefined,
          boxShadow: isSelected
            ? `var(--tabletop-card-shadow), ${glow}, 0 0 ${TABLETOP_CONFIG.SELECTION_GLOW_SPREAD * 2}px var(--gold)`
            : "var(--tabletop-card-shadow)",
          opacity: isSelected ? TABLETOP_CONFIG.SELECTION_GLOW_OPACITY + 0.2 : 1,
        }}
      >
        {flipping && (
          <span aria-hidden="true" className="sacred-reveal-halo" />
        )}
        {/* Flip 3D container nested inside the scale wrapper so the inline
            scale transform on the parent doesn't override the rotateY(180deg)
            applied by .flip-3d.is-flipped when the card reveals. */}
        <div
          className={cn(
            "absolute inset-0 rounded-[10px] flip-3d",
            card.revealed && "is-flipped",
          )}
        >
          <div className="flip-face back">
            <CardBack id={cardBack} imageUrl={customBackUrl} width={cardW} className="h-full w-full" />
          </div>
          <div className="flip-face front overflow-hidden rounded-[10px] border border-gold/40 bg-card">
            {/* Always render the face image so it's loaded and decoded before
                the flip animation reaches the apex — gating on `card.revealed`
                left the front blank for the first reveal. The back covers it
                until the rotation completes (backface-visibility: hidden). */}
            <img
              src={cardImg(faceIndex)}
              alt={getCardName(faceIndex)}
              className="h-full w-full object-cover"
              loading="eager"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            {faceGlowing && (
              <span
                key={`face-glow-${faceGlowTick}`}
                aria-hidden="true"
                className="face-reveal-glow"
              />
            )}
          </div>
        </div>
        {consecrating && !card.revealed && (
          <span aria-hidden="true" className="card-consecrate-shimmer" />
        )}
      </div>
    </button>
  );
}