import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCardName } from "@/lib/tarot";
import { CardImage } from "@/components/card/CardImage";
import type { CardBackId } from "@/lib/card-backs";
import { useActiveDeckImage, variantUrlFor } from "@/lib/active-deck";
import { useDevFaces } from "@/components/dev/DevOverlay";
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
  // EK16 — Shared-element transition support. When true AND the card
  // has no selectionOrder (i.e. it's a scatter card, not in a slot),
  // CardSlot fades to opacity 0 over 600ms. Slotted cards retain full
  // opacity and continue to be visible — they're the cards that will
  // "travel" up to the spread positions when SpreadLayout mounts.
  castingPhase = false,
  // EK17 — Gather gesture. When non-null AND the card is unslotted,
  // CardSlot checks if its center is within 1.75 × cardH of this
  // point. If yes, the card animates toward the point with a small
  // per-card cluster offset + rotation jitter. If no (or null), the
  // card sits at its home scatter position.
  gatherCenter = null,
  // EK23 — Within-cluster drift epoch. Combined with card.id to
  // derive a fresh per-card cluster offset that changes over time,
  // so clustered cards visibly stir around each other rather than
  // sitting perfectly still.
  clusterDriftEpoch = 0,
  // EK24 — When non-null, this card is in the post-release
  // transition. Render with `left`/`top` at card.x/y (unchanged)
  // and `transform: translate3d(target.x - card.x, target.y -
  // card.y, 0)` so the visual position equals the target. CSS
  // interpolates the transform smoothly from the previous cluster
  // delta to this target delta. After the 900ms transition,
  // Tabletop commits target → card.x/y in a single render and
  // clears this prop, so the visual position stays put.
  releaseTarget = null,
  // EK27 — Play-area bounds in container-relative coords. Used to
  // clamp the in-cluster visual position so a cluster held near an
  // edge doesn't push cards outside the usable scatter rectangle.
  playBounds = null,
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
  /**
   * EK16 — Casting-handoff fade. When true AND the card is unslotted
   * (selectionOrder === null), this CardSlot fades to opacity 0 over
   * 600ms. Used by Tabletop right after the seeker fills the final
   * slot, to dissolve the table scatter while the slotted cards
   * remain visible — they then visually travel to their spread
   * positions when SpreadLayout mounts.
   */
  castingPhase?: boolean;
  /**
   * EK17 — Gather-gesture center, container-relative coords. When
   * non-null AND the card is unslotted, CardSlot computes its own
   * distance from this point. If the distance is under
   * 1.75 × cardH, the card animates toward the center with a slight
   * deterministic per-card cluster offset and rotation jitter. When
   * the prop returns to null (release) or the card leaves the radius
   * (pointer moves away), the card returns to its home scatter
   * coords. CSS transition handles the actual motion.
   */
  gatherCenter?: { x: number; y: number } | null;
  /**
   * EK23 — Drift counter that ticks every ~300ms while gather is
   * active. Combined with card.id to deterministically derive a
   * fresh per-card cluster offset on each tick, so cards inside the
   * cluster visibly drift around each other (the visual "shuffle"
   * feedback the seeker sees while holding).
   */
  clusterDriftEpoch?: number;
  /**
   * EK24 — Release-transition target. When present, the card is
   * mid-release: render with `left`/`top` at the unchanged
   * card.x/y, transform set to translate the visual to this target.
   * After the transition, Tabletop commits target → card.x/y and
   * sets this back to null.
   */
  releaseTarget?: { x: number; y: number; rotation: number } | null;
  /**
   * EK27 — Play-area bounds (minX/maxX/minY/maxY in container-
   * relative px). The in-cluster visual position is clamped to
   * this rect so the cluster, when held near an edge, doesn't push
   * cards outside the table area. When null, no clamping is
   * applied (preserves existing call sites that haven't passed
   * the prop yet).
   */
  playBounds?: { minX: number; maxX: number; minY: number; maxY: number } | null;
}) {
  const isSelected = card.selectionOrder !== null;
  // 9-6-Y — image resolver used to prefetch the -md.webp variant on tap.
  const resolveDeckImage = useActiveDeckImage();
  // EK28 — Dev "Show faces" toggle. When on, the face-down branch
  // of <CardImage> is forced to render its face instead, so the
  // seeker can visually verify which card sits at each position
  // (used to confirm the gather shuffle actually mixes the deck).
  const devFacesOn = useDevFaces();
  // When the card landed in the slot via a physical drag-drop we skip
  // the FLIP-style flight animation entirely — the user just placed it
  // there, animating it from the scatter coords (where it would re-mount
  // for one frame) creates a jarring disappear/reappear flicker.
  const skipFlight = isSelected && card.isDragDrop === true;
  const flying = isSelected && slotRect !== null && !skipFlight;
  // 9-6-V — selection glow is now expressed via filter: drop-shadow on
  // the card wrapper (see render below). The old box-shadow `glow`
  // string is no longer needed.

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
      // EK01 — getBoundingClientRect returns the ROTATED bounding box.
      // When we reuse `r.left`/`r.top` as the launch frame's fixed-position
      // coords and re-apply `transform: rotate(...)`, the card visually
      // shifts because rotation pivots around the card's center but the
      // un-rotated rect's top-left is INSIDE the bounding box, not at
      // its corner. Result: card jumps far right (and down) before the
      // flight transition starts. Fix: store an UN-rotated rect by
      // shrinking each side by the rotation slack — bbox is symmetric
      // around the un-rotated rect's center, so `slackX/Y = (bboxDim -
      // cardDim) / 2` gives the offset to add back.
      let adjusted = r;
      if (r) {
        const angle = (Math.abs(card.rotation) * Math.PI) / 180;
        const cosA = Math.abs(Math.cos(angle));
        const sinA = Math.abs(Math.sin(angle));
        const bboxW = cardW * cosA + cardH * sinA;
        const bboxH = cardW * sinA + cardH * cosA;
        const slackX = (bboxW - cardW) / 2;
        const slackY = (bboxH - cardH) / 2;
        // Reconstruct a DOMRect-like with un-rotated card dimensions
        // anchored at the un-rotated top-left, which is where the
        // un-rotated rectangle would be if the rotation were removed.
        adjusted = new DOMRect(r.left + slackX, r.top + slackY, cardW, cardH);
      }
      setLaunchRect(adjusted);
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
  // EJ70 — When a table-to-table drag ends, the card switches from the
  // `dragging` fixed-position branch back to the absolute idle branch.
  // For the frame before the parent's `move` action flushes new card.x/
  // card.y into props, the idle branch paints at the STALE coords; the
  // `card-idle-transition` class then animates left/top from the stale
  // spot to the new one — the "jump to the right, then traverse" the
  // seeker reported. Setting justDropped suppresses the idle transition
  // for that render so the card simply appears at the drop point. Cleared
  // after one rAF once the new coords have settled.
  const [justDropped, setJustDropped] = useState(false);
  const wasDraggedRef = useRef(false);
  // EK20 — `hasSettled` tracks whether this CardSlot has finished its
  // initial mount-time settle-in animation. The settle-in keyframes
  // are intended as a ONE-TIME entrance fade (opacity 0 → 1, slight
  // scale up). The old code rendered them on every idle-branch
  // re-render — when other state shifted (gather release, slot fill,
  // size threshold trip), React re-applied `animation: settle-in
  // 320ms ease-out both` and the browser restarted the animation
  // from frame 0, producing a visible screen-wide flash.
  //
  // We flip `hasSettled` to true after settleDelay + the 320ms
  // animation duration (+ 50ms buffer for safety). Once true, the
  // idle branch renders `animation: "none"` permanently — the card
  // is already at rest, no need to ever replay the entrance.
  const [hasSettled, setHasSettled] = useState(false);
  useEffect(() => {
    if (hasSettled) return;
    const t = window.setTimeout(() => {
      setHasSettled(true);
    }, settleDelay + 320 + 50);
    return () => window.clearTimeout(t);
    // Only depend on settleDelay (stable for this card's lifetime).
    // hasSettled is read-only inside the effect; once true, the
    // effect's guard short-circuits the next call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleDelay]);
  // EJ72 — Clear justDropped on the next frame once the post-drop render
  // has painted at the new card.x/card.y, so the normal idle transition
  // resumes for future layout shifts. MUST stay below the useState above
  // — in EJ70 this effect sat ~100 lines higher than the declaration,
  // which the production bundler compiled into a temporal-dead-zone
  // access ("Cannot access 'justDropped' before initialization") that
  // crashed /draw.
  useEffect(() => {
    if (!justDropped) return;
    const raf = window.requestAnimationFrame(() => {
      const raf2 = window.requestAnimationFrame(() => {
        setJustDropped(false);
        wasDraggedRef.current = false;
      });
      return () => window.cancelAnimationFrame(raf2);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [justDropped, card.x, card.y]);
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
      // DF-1 — Compute the card's logical (unrotated) screen position from
      // its container-relative coords + the live container origin. This is
      // rotation-independent: getBoundingClientRect() would return the
      // rotated bounding box, which gives wrong offset math when the
      // dragged card renders at rotate(0deg).
      //
      // EK21 — For a SLOTTED card (selectionOrder !== null, slotRect
      // present), the card is currently rendered AT slotRect via
      // position:fixed, NOT at card.x / card.y (which remain the card's
      // original scatter coords). Using the scatter coords here made
      // the pointerOffset wrong by the distance between the slot and
      // the scatter spot — visible as the card jumping by half the
      // screen height when the seeker tried to drag it back to the
      // table. Use the slot's viewport rect when slotted, the
      // container-relative scatter coords otherwise.
      const isSlottedNow = card.selectionOrder !== null && slotRect !== null;
      let logicalCardLeft: number;
      let logicalCardTop: number;
      if (isSlottedNow && slotRect) {
        logicalCardLeft = slotRect.left;
        logicalCardTop = slotRect.top;
      } else {
        const freshRectAtStart = containerElRef.current?.getBoundingClientRect();
        const cLeftAtStart = freshRectAtStart?.left ?? containerRect?.left ?? 0;
        const cTopAtStart = freshRectAtStart?.top ?? containerRect?.top ?? 0;
        logicalCardLeft = cLeftAtStart + card.x;
        logicalCardTop = cTopAtStart + card.y;
      }
      const activeClientX = s.currentClientX;
      const activeClientY = s.currentClientY;
      s.pointerOffsetX = activeClientX - logicalCardLeft;
      s.pointerOffsetY = activeClientY - logicalCardTop;
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
  }, [onDragMove, containerRect, containerElRef, card, slotRect]);

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
    // Q67 — the dragged card uses `position: fixed`, so direct DOM
    // writes here must be VIEWPORT coords (no cLeft/cTop subtraction).
    // The previous code subtracted container offsets and worked only on
    // mobile where the container starts at viewport (0,0); on centered
    // desktop the card teleported left by the centering offset on grab.
    if (el) {
      el.style.left = `${e.clientX - s.pointerOffsetX}px`;
      el.style.top = `${e.clientY - s.pointerOffsetY}px`;
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
      // EJ70 — Also suppress the left/top idle transition for the render
      // cycle right after the drop, so the card appears AT the release
      // point instead of teleporting to stale coords and animating over.
      setJustDropped(true);
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
    // 9-6-Y — prefetch the -md.webp variant for the picked card so
    // the eventual flip-table reveal feels instant.
    try {
      const url = resolveDeckImage(faceIndex);
      if (url) {
        const mdUrl = variantUrlFor(url, "md") ?? url;
        const img = new Image();
        img.src = mdUrl;
      }
    } catch {
      // best-effort prefetch only
    }
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
        flying || flightPhase === "returning" || dragging || justDropped
          ? null
          : "card-idle-transition",
        // Remove default tap highlight on iOS / Android.
        "[-webkit-tap-highlight-color:transparent] [touch-action:none]",
        // Block the system drag-ghost on WebKit + suppress text selection
        // and the focus outline that becomes a "dashed ring" artifact.
        "select-none [-webkit-user-drag:none] [user-drag:none]",
        isSelected ? "z-30" : null,
      )}
      style={(() => {
        // EK16 — Wrap the existing ternary style chain in an IIFE so we
        // can mix in a fade-out opacity at the end without duplicating
        // the opacity into every branch.
        //
        // Fade rule: when the seeker has filled the last slot
        // (`castingPhase` true) AND this card is still on the scatter
        // (no selectionOrder), drop to opacity 0 over 600ms. Slotted
        // cards keep opacity 1 — they'll travel to spread positions
        // when SpreadLayout mounts. Other branches (dragging, flying,
        // returning, etc.) shouldn't be in flight when castingPhase
        // fires (the rail is disabled at ready), so this merge is
        // safe to apply uniformly.
        const baseStyle: React.CSSProperties =
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
              // EK20 — Also skip if hasSettled is true. settle-in is a
              // one-time mount animation; replaying it on later renders
              // (slot-fly re-render, gather release, etc.) caused the
              // observed screen flashes. Once the card has finished its
              // initial settle, this branch renders `animation: "none"`
              // permanently.
              animation:
                wasDraggedRef.current || hasSettled
                  ? "none"
                  : `settle-in 320ms ease-out both`,
              animationDelay:
                wasDraggedRef.current || hasSettled
                  ? "0ms"
                  : `${settleDelay}ms`,
              // Drives the .card-hit element's inset via a CSS variable so the
              // touch target scales with the rendered card size.
              ["--card-hit-inset" as string]: `${hitInset}px`,
              ["--card-rotation" as string]: `${card.rotation}deg`,
            };
        // EK16 — Apply the casting fade. Scatter cards (no selectionOrder)
        // fade to 0; slotted cards stay at full opacity. The 600ms
        // transition is shorter than Tabletop's 1500ms handoff delay
        // so the fade completes well before SpreadLayout mounts.
        if (castingPhase && !isSelected) {
          return {
            ...baseStyle,
            opacity: 0,
            transition: baseStyle.transition
              ? `${baseStyle.transition}, opacity 600ms ease-out`
              : "opacity 600ms ease-out",
            pointerEvents: "none" as const,
          };
        }
        // EK17 — Gather override. Apply only to idle scatter cards (no
        // dragging / no flying / no selection) when gatherCenter is
        // non-null AND this card's center is within 1.75 × cardH of it.
        //
        // Cards in the radius animate to a clustered position near the
        // gather center with a small deterministic per-card offset and
        // rotation jitter. Cards outside the radius (or when
        // gatherCenter is null) sit at their home scatter coords —
        // the baseStyle's idle branch already returns those, so we
        // just exit early in that case.
        if (
          gatherCenter &&
          !isSelected &&
          !dragging &&
          !flying &&
          flightPhase !== "returning"
        ) {
          const cardCenterX = card.x + cardW / 2;
          const cardCenterY = card.y + cardH / 2;
          const dx = gatherCenter.x - cardCenterX;
          const dy = gatherCenter.y - cardCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const radius = cardH * 1.75;
          if (dist < radius) {
            // EK23 — Per-card cluster offset that DRIFTS over time.
            // The seed combines card.id with clusterDriftEpoch (a
            // counter that ticks every ~200ms while gather is active
            // in Tabletop). Each tick produces a fresh offset; CSS
            // transitions smoothly interpolate from the old offset to
            // the new one, so clustered cards visibly stir around
            // each other as the user holds.
            //
            // EK24 — Per-card PHASE OFFSET on the epoch so cards
            // don't all refresh in lockstep. `(card.id % 6)` shifts
            // each card by up to 5 ticks worth, so at any given
            // moment some cards are 0ms into their transition,
            // others are 200ms, 400ms, etc. — never all snapping
            // together. Combined with the longer 600ms transition
            // below (transition longer than tick interval), the
            // cluster looks like continuous fluid motion.
            const effectiveEpoch = clusterDriftEpoch + (card.id % 6);
            const seed = card.id * 2654435761 + effectiveEpoch * 1597463007;
            const clusterRadius = cardH * 0.6;
            const angle = ((seed * 137.508) % 360) * (Math.PI / 180);
            const radial = ((Math.abs(seed) * 31) % 100) / 100; // 0..1
            const offX = Math.cos(angle) * clusterRadius * radial;
            const offY = Math.sin(angle) * clusterRadius * radial;
            const rotJitter = ((Math.abs(seed) * 47) % 31) - 15; // -15..+15
            // EK20 — Motion is GPU-accelerated transform translate3d,
            // NOT left/top. Layout stays put.
            let targetX = gatherCenter.x - cardW / 2 + offX;
            let targetY = gatherCenter.y - cardH / 2 + offY;
            // EK27 — Clamp the in-cluster visual position so a
            // cluster held near an edge doesn't push the card
            // outside the usable scatter rectangle. Without this,
            // a card visually appears outside the play area while
            // held, then "pops in" to its placed cell on release.
            if (playBounds) {
              if (targetX < playBounds.minX) targetX = playBounds.minX;
              else if (targetX > playBounds.maxX) targetX = playBounds.maxX;
              if (targetY < playBounds.minY) targetY = playBounds.minY;
              else if (targetY > playBounds.maxY) targetY = playBounds.maxY;
            }
            const deltaX = targetX - card.x;
            const deltaY = targetY - card.y;
            return {
              left: card.x,
              top: card.y,
              width: cardW,
              height: cardH,
              transform: `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${
                card.rotation + rotJitter
              }deg)`,
              // Lift gathered cards above non-gathered so the cluster
              // reads as a single visual group on top of the rest of
              // the scatter.
              zIndex: 800 + card.z,
              // EK24 — 600ms transition. Tabletop's drift tick is
              // 200ms (EK24), so any given card has 400-600ms of
              // overlap between successive transitions — motion
              // never stops. Looks like fluid stirring, not stepped.
              transition: "transform 600ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "transform",
              ["--card-hit-inset" as string]: `${hitInset}px`,
              ["--card-rotation" as string]: `${card.rotation + rotJitter}deg`,
            };
          }
          // Card is outside radius — keep `left`/`top` at home, return
          // transform to identity (translate3d(0,0,0) + the card's
          // natural rotation). CSS transitions the transform smoothly
          // back to home. No settle-in replay because we keep
          // `animation: "none"`.
          //
          // EK23 — Longer transition (800ms) with a per-card stagger
          // (card.id-derived 0..220ms delay) so the release feels
          // organic — cards unwind in waves rather than all at once.
          // Tabletop's release watchdog (900ms after pointerup)
          // preserves this transition long enough to finish before
          // gatherCenter goes null.
          //
          // EK24 — If `releaseTarget` is set, this card is in the
          // post-release transition. Use the target as the transform
          // END-point (translate the visual to target while keeping
          // left/top pinned at card.x/y) so the card animates
          // smoothly from its current cluster position to the new
          // spot — no jump caused by left/top snapping to a new
          // value mid-transition.
          const releaseDelay = (card.id * 37) % 220; // 0..219ms
          if (releaseTarget) {
            const rdx = releaseTarget.x - card.x;
            const rdy = releaseTarget.y - card.y;
            return {
              ...baseStyle,
              left: card.x,
              top: card.y,
              transform: `translate3d(${rdx}px, ${rdy}px, 0) rotate(${releaseTarget.rotation}deg)`,
              transition: `transform 800ms cubic-bezier(0.4, 0, 0.2, 1) ${releaseDelay}ms`,
              willChange: "transform",
              animation: "none",
            };
          }
          return {
            ...baseStyle,
            left: card.x,
            top: card.y,
            // Force the same GPU-accelerated path as the inside-radius
            // branch so the OUT transition runs from the same render
            // pipeline (no jank when transitioning between the two
            // states mid-gather).
            transform: `translate3d(0, 0, 0) rotate(${card.rotation}deg)`,
            transition: `transform 800ms cubic-bezier(0.4, 0, 0.2, 1) ${releaseDelay}ms`,
            willChange: "transform",
            animation: "none",
          };
        }
        return baseStyle;
      })()}
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
          // 9-6-V — drop-shadow follows the painted alpha of the card
          // image, so the shadow / gold halo hugs the actual card
          // silhouette instead of the (potentially taller) button
          // rectangle. Eliminates the "frame around the card" artifact
          // when the card's natural aspect ≠ CARD_ASPECT_RATIO.
          filter: isSelected
            ? "var(--tabletop-card-drop-shadow) var(--card-emphasis-filter)"
            : "var(--tabletop-card-drop-shadow)",
          opacity: isSelected ? TABLETOP_CONFIG.SELECTION_GLOW_OPACITY + 0.2 : 1,
        }}
      >
        {flipping && (
          <span aria-hidden="true" className="sacred-reveal-halo" />
        )}
        {/* Flip 3D container nested inside the scale wrapper so the inline
            scale transform on the parent doesn't override the rotateY(180deg)
            applied by .flip-3d.is-flipped when the card reveals. */}
        {/* FA-4 — CardImage owns the face/back rendering and the flip
            animation. CardSlot keeps the surrounding state machines
            (drag, flight, consecration) untouched. */}
        {/* EK02 — Breathing glow only on cards PLACED IN A SLOT (selected)
            and not yet revealed. Previously every face-down card on the
            draw table had this class, which became visible accent halos
            after EK01 upgraded the keyframes from opacity-only to a real
            drop-shadow halo. Scatter face-down cards now stay quiet;
            slotted cards still pulse gently while waiting for Reveal. */}
        <div
          className={
            card.revealed
              ? "absolute inset-0"
              : isSelected
                ? "absolute inset-0 animate-breathe-glow"
                : "absolute inset-0"
          }
        >
          <CardImage
            cardId={faceIndex}
            variant="face"
            // EK28 — When the dev "Show faces" toggle is on, every
            // card renders face-up regardless of card.revealed so
            // the seeker can verify shuffle behavior visually.
            flipped={card.revealed || devFacesOn}
            cardBackId={cardBack}
            size="custom"
            widthPx={cardW}
          />
          {faceGlowing && card.revealed && (
            <span
              key={`face-glow-${faceGlowTick}`}
              aria-hidden="true"
              className="face-reveal-glow"
            />
          )}
        </div>
        {consecrating && !card.revealed && (
          <span aria-hidden="true" className="card-consecrate-shimmer" />
        )}
      </div>
    </button>
  );
}
