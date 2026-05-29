import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Undo2, Redo2, X, MessageCircle, HelpCircle, Keyboard, ChevronDown, Camera, BellRing } from "lucide-react";
import { Hint, isHintHardDismissed } from "@/components/hints/Hint";
import { EntryModeToggle } from "@/components/tabletop/EntryModeToggle";
import { CustomCountStepper } from "@/components/tabletop/CustomCountStepper";
import { PageMenu, type PageMenuSection } from "@/components/nav/PageMenu";
import { PageMenuTrigger } from "@/components/nav/PageMenuTrigger";
import { TabletopCloseButton } from "@/components/tabletop/TabletopCloseButton";
import { useAuth } from "@/lib/auth";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { buildScatter, shuffleDeck, type ScatterCard } from "@/lib/scatter";
import { SPREAD_META, spreadUsesSlots, getSpreadCount, type SpreadMode } from "@/lib/spreads";
// EK03 — Draw-proof snapshot infrastructure (see lib/table-snapshot.ts
// and lib/use-ask-draw-proof.ts for full docs).
// EK07 — `copyBlobToClipboard` removed from this import; the inline
// `clipboard.write` in copyRef.current below is what calls the
// clipboard API now. The lib export still exists for any other
// callsite that needs an async-friendly wrapper, but Tabletop calls
// the API directly to keep Safari's user-activation token intact.
import { generateTableSnapshot } from "@/lib/table-snapshot";
// EK14 — Active-deck image resolver. Returns the URL to use for a
// given tarot card id (0..77), preferring the active custom deck and
// falling back across the seeker's other custom decks before landing
// on the built-in Rider-Waite default. This is the same resolver
// CardImage uses everywhere else in the app, so the snapshot now
// reflects exactly what the seeker sees on the live table.
//
// `useActiveDeck` returns a `loading` flag we read to gate snapshot
// generation — snapshot waits until the active deck's signed URLs
// have been fetched, otherwise the snapshot would race the deck-load
// and capture the default Rider-Waite as fallback.
import { useActiveDeck, useAnyDeckImage } from "@/lib/active-deck";
import { useAskDrawProof } from "@/lib/use-ask-draw-proof";
// EK05 — SpreadPicker was inlined for EJ72 to avoid a Lovable
// production-chunk TDZ from a module-init cycle. EK05 reinstates the
// extracted file by making SpreadPicker.tsx a strict LEAF (only
// imports from lucide/spreads/react/react-dom — never back into
// Tabletop), removing the cycle.
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { useShowLabels } from "@/lib/use-show-labels";
import { useLockOrientation } from "@/lib/use-lock-orientation";
import {
  useRegisterCloseHandler,
  useRegisterHelpHandler,
  useRegisterTabletopActive,
} from "@/lib/floating-menu-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import { CardSlot } from "./CardSlot";
import {
  TABLETOP_CONFIG,
  responsiveCardWidth,
  responsiveSlotWidth,
  pickReturnSpot,
  adaptiveMaxRotation,
  adaptiveHitInset,
  readTabletopSession,
  writeTabletopSession,
  clearTabletopSession,
  scatterPadding,
  slotRailFitsViewport,
  slotGap,
} from "./config";
import type { TabletopProps, CardState, TabletopSession, DragAction } from "./types";

// EK05 — SpreadPicker extracted to its own leaf module (see comment
// at top of SpreadPicker.tsx for cycle-avoidance rationale). Both
// Tabletop and ManualEntryBuilder import from there now.
import { SpreadPicker } from "./SpreadPicker";

export function Tabletop({
  spread,
  onExit,
  onComplete,
  customCount,
  question,
  onQuestionChange,
  onSwitchToManual,
  onCustomCountChange,
  onSpreadChange,
  onOpenQuestion,
}: TabletopProps) {
  const meta = SPREAD_META[spread];
  // 9-6-O — Custom spread overrides the meta count with the user's pick.
  const required = spread === "custom" ? Math.max(1, Math.min(10, customCount ?? 3)) : meta.count;
  const usesSlots = spreadUsesSlots(spread, required);

  // Q19 — manual entry is now hoisted to draw.tsx; Tabletop only
  // surfaces the unified EntryModeToggle and asks the parent to swap
  // surfaces. The Q5/DZ-2 "manual draw" hint is now anchored to the
  // toggle and lives at the draw-route level.
  const { user: authUser, loading: authLoading } = useAuth();
  const entryToggleRef = useRef<HTMLButtonElement | null>(null);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const [showEntryHint, setShowEntryHint] = useState(false);
  const [showCountHint, setShowCountHint] = useState(false);
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const timers: number[] = [];
    void (async () => {
      // Q20 Fix 3 — Hint B: surface toggle (always relevant on table).
      if (onSwitchToManual) {
        const dismissedB = await isHintHardDismissed("entry_mode_toggle", authUser?.id ?? null);
        if (!cancelled && !dismissedB) {
          timers.push(window.setTimeout(() => setShowEntryHint(true), 400));
        }
      }
      // Q20 Fix 3 — Hint A: count stepper (custom only).
      if (spread === "custom" && onCustomCountChange) {
        const dismissedA = await isHintHardDismissed("custom_count_stepper", authUser?.id ?? null);
        if (!cancelled && !dismissedA) {
          timers.push(window.setTimeout(() => setShowCountHint(true), 800));
        }
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [authUser, authLoading, onSwitchToManual, onCustomCountChange, spread]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Q67 — lock device orientation while the draw table is active so
  // accidental rotation doesn't scramble the scatter.
  useLockOrientation();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Q33b Fix 4 — tracks the previous measured size so the RAF loop
  // only resets initializedRef on the first valid measurement.
  const prevSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [viewportW, setViewportW] = useState<number | null>(null);
  // Viewport-coordinate origin of the scatter container. Passed to
  // CardSlot so a card returning from a slot to the table can compute
  // its absolute landing point in viewport space (slot rects are in
  // viewport coords; scatter rects are in container coords).
  const [containerOrigin, setContainerOrigin] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
  // Refs to each slot DOM element. Used to compute flight target rects in
  // viewport coordinates so a selected card can animate from its current
  // scatter position to its slot.
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Viewport-coordinate rect for each slot (id'd by slot index 0..N-1).
  // Re-measured on resize and when slot row mounts.
  const [slotRects, setSlotRects] = useState<Array<DOMRect | null>>([]);
  const { opacity: restingOpacityPct } = useRestingOpacity();
  const restingAlpha = restingOpacityPct / 100;
  const exitAlpha = Math.min(1, restingAlpha + 0.1);
  // Persisted preference for showing spread position labels under each
  // slot. Defaults to ON (annotated). Mirrored on the SpreadLayout
  // screen so the choice carries through the entire draw flow.
  const { showLabels, setShowLabels } = useShowLabels();

  // EJ65 — Left fly-out page menu state. Tabletop's config items:
  //   VIEW SWAP → Manual Entry
  //   ADD A QUESTION → opens the question composer (was a top-right
  //     icon in EJ67; moved into the fly-out in EJ68 to keep the
  //     top chrome clean)
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  // EK03 — Draw-proof snapshot state. These hooks must be declared
  // BEFORE pageMenuSections is built (which reads snapshotStatus and
  // askDrawProof). The effect that populates snapshotBlob and the
  // copySnapshotNow callback live further down where the deps
  // (initialScatter, deckMapping, size, cardW, cardH) are in scope.
  const { askDrawProof, setAskDrawProof } = useAskDrawProof();
  const [snapshotBlob, setSnapshotBlob] = useState<Blob | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<"idle" | "generating" | "ready" | "failed">("idle");
  // EK12 — Diagnostic state: when snapshot generation fails (either
  // generateTableSnapshot returns null OR throws OR the watchdog
  // trips), this holds the human-readable reason. The menu description
  // surfaces it inline so we can see WHAT failed instead of a generic
  // "Snapshot unavailable on this device" hiding the actual cause.
  const [snapshotErrorMessage, setSnapshotErrorMessage] = useState<string | null>(null);
  // EK10 — SSR-safe Web Share availability detection.
  //
  // EK09 used `useMemo` to check `navigator.share` at render time. That
  // diverged between SSR (where `navigator` is undefined → returns
  // false) and client hydration (where it's defined → returns true).
  // The mismatch caused React error #418 ("Hydration failed because
  // the server rendered HTML didn't match the client") because the
  // menu label, popup body, popup button label, and description text
  // ALL read this value. When hydration fails, React throws away the
  // whole tree and re-renders client-side from scratch, which broke
  // the snapshot effect's lifecycle — that's why EK09 still showed
  // "snapshot not ready yet" forever.
  //
  // Pattern: server and initial client render BOTH start with `false`
  // (matching, no mismatch). Then the useEffect fires after hydration
  // completes and flips the state to the real value. The subsequent
  // re-render swaps labels/copy to the Share variant. No mismatch.
  // Standard SSR-safe feature-detection pattern.
  const [webShareAvailable, setWebShareAvailable] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function"
    ) {
      setWebShareAvailable(true);
    }
  }, []);
  const [proofPopupOpen, setProofPopupOpen] = useState(false);
  const proofPopupShownRef = useRef(false);
  const [copyFeedback, setCopyFeedback] = useState<
    "copied" | "no_snapshot" | "blocked" | null
  >(null);
  // EK07 — Forward reference for the SYNCHRONOUS copy action. Was an
  // async function previously, which broke Safari's user-activation
  // requirement for `navigator.clipboard.write()` — Safari invalidates
  // the gesture at the first `await`. The new contract: this ref
  // stores a synchronous function the click handler calls directly
  // (no `await`), which fires `clipboard.write` in the same tick as
  // the click and returns a tag the caller can use to react
  // immediately. The actual implementation is assigned to
  // copyRef.current further down where snapshotBlob is in scope.
  const copyRef = useRef<(() => "no_snapshot" | "writing") | null>(null);
  // Synchronous wrapper used by callers that already have a
  // synchronous gesture-context to spend (popup [Copy] button, menu
  // "Copy table snapshot" button). Returns the underlying tag (or
  // "no_snapshot" if the ref isn't wired yet). Callers spend this
  // value to set a fast-failure toast and bail; the success path
  // resolves asynchronously via the .then() inside copyRef.
  const copySnapshotNow = useCallback(
    (): "no_snapshot" | "writing" => copyRef.current?.() ?? "no_snapshot",
    [],
  );
  const pageMenuSections: PageMenuSection[] = [];
  if (onSwitchToManual) {
    pageMenuSections.push({
      id: "view-swap",
      title: "View",
      items: [
        {
          id: "manual-entry",
          label: "Manual Entry",
          description: "Type or paste card names",
          Icon: Keyboard,
          mode: "navigate",
          onClick: () => {
            setPageMenuOpen(false);
            onSwitchToManual();
          },
        },
      ],
    });
  }
  if (onOpenQuestion) {
    pageMenuSections.push({
      id: "actions",
      title: "Actions",
      items: [
        {
          id: "add-question",
          label: question && question.trim().length > 0 ? "Edit question" : "Add a question",
          description: "Anchor this reading to a question",
          Icon: MessageCircle,
          mode: "navigate",
          onClick: () => {
            setPageMenuOpen(false);
            onOpenQuestion();
          },
        },
      ],
    });
  }

  // EK03 — Draw-proof snapshot section in the fly-out menu. Two items:
  // (1) Manual one-tap action to copy the snapshot now (always
  //     available regardless of toggle).
  // (2) Toggle controlling whether the on-load popup appears.
  // Both items use mode "navigate" with a status-bearing description so
  // the existing PageMenu UI doesn't need a new "toggle" mode to render
  // them; the description shows the current state (Asks on load /
  // Doesn't ask on load) and tapping flips it. The manual-copy item's
  // description shows whether the snapshot is ready or still preparing.
  pageMenuSections.push({
    id: "draw-proof",
    title: "Snapshot",
    items: [
      {
        id: "copy-snapshot",
        // EK09 — Label flips Share/Copy based on platform Web Share
        // availability. Both routes are wired through the same
        // copySnapshotNow() call — copyRef.current internally
        // auto-detects which API to use. The label exists just to
        // set expectations: on mobile the seeker will see the iOS/
        // Android share sheet open; on desktop the snapshot goes
        // straight to the clipboard for pasting.
        label: webShareAvailable ? "Share table snapshot" : "Copy table snapshot",
        description:
          snapshotStatus === "ready"
            ? webShareAvailable
              ? "Open the share sheet to save or send"
              : "Proof that the deck wasn't rigged"
            : snapshotStatus === "generating"
              ? "Preparing snapshot…"
              : snapshotStatus === "failed"
                ? // EK12 — Surface the captured reason inline so we
                  // can see WHAT failed instead of a generic message.
                  // Falls back to the generic copy if no message was
                  // captured (shouldn't happen but defensive).
                  snapshotErrorMessage ?? "Snapshot unavailable on this device"
                : "Snapshot will be ready in a moment",
        Icon: Camera,
        mode: "navigate",
        onClick: () => {
          // EK07 — Same synchronous pattern as the popup button.
          // copySnapshotNow() fires navigator.clipboard.write() in
          // the same tick as the click, keeping Safari's user-
          // activation token valid. Menu close happens AFTER the
          // write is initiated.
          copySnapshotNow();
          setPageMenuOpen(false);
        },
      },
      {
        id: "ask-snapshot-on-load",
        label: askDrawProof ? "Ask to copy on load: on" : "Ask to copy on load: off",
        description: askDrawProof
          ? "Tap to stop asking on new draws"
          : "Tap to ask on every new draw",
        Icon: BellRing,
        mode: "navigate",
        onClick: () => {
          setAskDrawProof(!askDrawProof);
        },
      },
    ],
  });

  // Three-level UI density for the draw screen, controlled by the eye
  // icon in the top-bar.
  //   0 → labels under slots + bottom whisper (richest)
  //   1 → labels under slots only (whisper hidden)
  //   2 → labels and whisper hidden (most minimal)
  // Persisted across sessions on `showLabels` (level 2 ↔ off) plus a
  // local `showWhisper` flag for the middle tier.
  const [showWhisper, setShowWhisper] = useState(true);
  const densityLevel: 0 | 1 | 2 = !showLabels ? 2 : !showWhisper ? 1 : 0;
  const cycleDensity = () => {
    if (densityLevel === 0) {
      setShowLabels(true);
      setShowWhisper(false);
    } else if (densityLevel === 1) {
      setShowLabels(false);
      setShowWhisper(false);
    } else {
      setShowLabels(true);
      setShowWhisper(true);
    }
  };

  // On-brand confirmation dialog state (replaces window.confirm calls).
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  // Celtic Cross help popup — always-accessible (no localStorage gate).
  // Shown only on the Celtic Cross spread; the trigger lives in the top
  // bar so the user can re-open the explainer whenever they want.
  const [celticHelpOpen, setCelticHelpOpen] = useState(false);

  // Read selected card back once on mount.
  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  // Measure container — drives scatter geometry.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerOrigin({ left: r.left, top: r.top });
      setSize((prev) => {
        if (!prev) return { w: r.width, h: r.height };
        const dw = Math.abs(r.width - prev.w);
        const dh = Math.abs(r.height - prev.h);
        // Ignore sub-5px size changes — these are usually mobile
        // viewport-bar collapses or scrollbar transitions, not real
        // resizes. Recomputing the scatter on those shifts visibly
        // reflows cards as they fly to a slot.
        if (dw < 5 && dh < 5) return prev;
        return { w: r.width, h: r.height };
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 9-6-H — when manual entry closes, the scatter container remounts.
  // Defer measurement to a requestAnimationFrame loop until the rect
  // reports non-zero dimensions; reading getBoundingClientRect() too
  // early can return { width: 0, height: 0 } and collapse all cards to
  // (0,0). Also reset the initializedRef flag so initialScatter
  // recomputes against the freshly-measured container.
  useEffect(() => {
    let cancelled = false;
    let raf: number | null = null;
    const tryMeasure = () => {
      if (cancelled) return;
      const el = containerRef.current;
      if (!el) {
        raf = requestAnimationFrame(tryMeasure);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        raf = requestAnimationFrame(tryMeasure);
        return;
      }
      setContainerOrigin({ left: r.left, top: r.top });
      setSize({ w: r.width, h: r.height });
      // Q33b Fix 4 — only rebuild the scatter on the FIRST valid
      // measurement after mount. Resetting on every successful measure
      // (including resizes) collapses cards to (0,0) when the table
      // remounts after exiting manual entry.
      if (prevSizeRef.current === null) {
        initializedRef.current = false;
      }
      prevSizeRef.current = { w: r.width, h: r.height };
    };
    raf = requestAnimationFrame(tryMeasure);
    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setViewportW(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const isMobile = viewportW === null || viewportW < TABLETOP_CONFIG.MOBILE_BREAKPOINT;
  // Q66 — desktop now uses the density-based responsiveCardWidth too,
  // so cards aren't stuck at a tiny 47px on large monitors.
  const cardW = responsiveCardWidth(size?.w ?? 0);
  const cardH = Math.round(cardW * TABLETOP_CONFIG.CARD_ASPECT_RATIO);
  // Slot rail uses its own width (smaller on mobile / for many-slot
  // spreads) so all slots fit in one row without scrolling.
  // Slot dimensions: on desktop they match the table card exactly (per
  // design: empty slots read as full-size mirrors of the cards). On mobile
  // they shrink so a 10-slot Celtic rail still fits in one row.
  const slotW = isMobile ? responsiveSlotWidth(size?.w ?? 0, required) : cardW;
  const slotH = isMobile ? Math.round(slotW * TABLETOP_CONFIG.CARD_ASPECT_RATIO) : cardH;
  // The slot rail always uses the short labels — slot tiles are tiny on
  // mobile and only ~64px wide on desktop, so the new full position names
  // ("The Present", "Hopes & Fears", …) wouldn't fit. The full names are
  // surfaced in the bottom-bar whisper (`Draw: The Present` + description)
  // so the user still sees the proper name as they draw.
  const slotLabels = meta.positionsShort ?? meta.positions ?? [];
  // Full-length position labels (e.g. "The Present") + their per-position
  // descriptions, used by the two-line whisper above the rail.
  const fullPositionLabels = meta.positions ?? [];
  const positionDescriptions = meta.positionDescriptions ?? [];
  // Always use the full ±CARD_MAX_ROTATION range so no card sits axis-aligned.
  const maxRotation = TABLETOP_CONFIG.CARD_MAX_ROTATION;

  // EA-9 — on desktop the active draw zone (position label + slot row)
  // sits at the bottom-center of the tabletop. Carve it out of the
  // scatter so cards never occlude it. Mobile keeps the full scatter.
  const exclusionZones = useMemo(() => {
    if (!size || size.w < 1024) {
      return [] as { x: number; y: number; w: number; h: number }[];
    }
    const drawZoneHeight = 220;
    const drawZoneWidth = Math.min(800, size.w * 0.8);
    return [
      {
        x: (size.w - drawZoneWidth) / 2,
        y: Math.max(0, size.h - drawZoneHeight),
        w: drawZoneWidth,
        h: drawZoneHeight,
      },
    ];
  }, [size]);

  // Detect coarse pointer once (and on media-query change) so we can scale
  // the hit area appropriately. Defaults to true on first render so SSR /
  // pre-mount touches still feel generous.
  const [isCoarsePointer, setIsCoarsePointer] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const hitInset = adaptiveHitInset(cardW, isCoarsePointer);

  // Initial scatter — only depends on session seed + geometry, NOT stirNonce,
  // so resizing or first-mount doesn't wipe the user's selections.
  const initialScatter = useMemo(() => {
    if (!size) return [] as ScatterCard[];
    // Absolutely positioned children land at the BORDER edge of the
    // (position: relative) container — `padding-top` does NOT push them
    // down. So we must explicitly reserve TOP_RESERVE here: shrink the
    // usable height and translate every card's Y by TOP_RESERVE via
    // `topOffset`. This keeps cards out from under the top bar.
    const usableH = Math.max(1, size.h - TABLETOP_CONFIG.TOP_RESERVE);
    return buildScatter({
      width: size.w,
      height: usableH,
      count: TABLETOP_CONFIG.DECK_SIZE,
      cardWidth: cardW,
      cardHeight: cardH,
      maxRotation,
      padding: TABLETOP_CONFIG.SCATTER_PADDING,
      seed,
      exclusionZones,
      // EJ75 — Target 50% visibility per card (was 0.9). The 90%
      // threshold meant the relocation pass aggressively shoved any
      // overlapping card outward to clear the bar, which on
      // desktop/tablet ended up pushing overflow into the side margins
      // (the "shape" Cori reported). At 50% cards may overlap up to
      // half each — the natural casual-table look — and the relocation
      // pass only fires when something is more than half-covered, so
      // no edge-pushing pileups.
      minVisibleRatio: 0.5,
      topOffset: TABLETOP_CONFIG.TOP_RESERVE,
    });
  }, [size, seed, cardW, cardH, maxRotation, exclusionZones]);

  // Map slot index -> tarot card id (shuffled at session start).
  const deckMapping = useMemo(() => shuffleDeck(TABLETOP_CONFIG.DECK_SIZE, seed), [seed]);

  // EK14 — Active-deck image resolver. `useAnyDeckImage` returns:
  //   - The active deck's signed URL if the card is in it.
  //   - Any other custom deck's URL the seeker owns (multi-deck fallback).
  //   - The built-in default `/cards/card-NN.jpg` for tarot ids 0-77
  //     when no custom deck has it.
  //   - null for oracle ids 1000+ (won't apply here — deck is 0-77).
  //
  // Wait for `activeDeckLoading === false` before kicking off the
  // snapshot, otherwise the resolver races against the deck-load and
  // returns built-in defaults for every card — exactly the bug Cori
  // hit on EK13 with a custom deck active.
  const resolveCardUrl = useAnyDeckImage();
  const { loading: activeDeckLoading } = useActiveDeck();

  // EK03 — Draw-proof snapshot. As soon as the initial scatter is
  // built, kick off generation of a PNG showing every card face-up at
  // its scatter position. Held in memory; the seeker can choose to
  // copy it to clipboard via the fly-out menu OR the load-time popup.
  // The cached blob proves the deck-position mapping was locked the
  // moment the table appeared — independent of when they decide to
  // verify. State hooks for this feature are declared higher up (so
  // pageMenuSections can read them); this block only wires the
  // generation effect + the actual copy logic into copyRef.

  // EK13 — Generation-started guard. Set the first time the effect
  // commits a generation attempt. Subsequent re-fires (caused by
  // viewport resizes, scatter rebuilds with same length, any other
  // dep churn) will NOT cancel the in-flight generation or start a
  // new one — they'll just be observed.
  //
  // EK12's effect had a fatal flaw: it used a local `cancelled` flag +
  // returned cleanup that flipped it and cleared the watchdog. If
  // deps changed every few seconds (likely cause: ResizeObserver or
  // viewport-related useState updates fired in a loop), each re-fire
  // ran the cleanup of the PREVIOUS run, cancelling the in-flight
  // generation, then started a NEW one with a fresh 20-second watchdog
  // budget. Status never reached "ready" OR "failed" — perpetual
  // re-mount churn at the effect level. This ref persists across
  // re-renders and prevents the IIFE from being torn down.
  const generationStartedRef = useRef(false);
  // EK13 — Counter for diagnostic surfacing. Incremented every time
  // the effect's body runs (whether or not it starts a generation).
  // Surfaced in the menu description on failure so we can see if
  // re-fires were the underlying issue.
  const effectRunCountRef = useRef(0);

  useEffect(() => {
    effectRunCountRef.current += 1;

    if (!size) return;
    if (initialScatter.length === 0) return;
    // EK14 — Wait for the active deck's image map to finish loading
    // before kicking off generation. Otherwise the resolver returns
    // /cards/card-NN.jpg defaults for every card and the snapshot
    // shows built-in Rider-Waite art when the seeker has a custom
    // deck active. This is a benign gate: once activeDeck loading
    // settles, the effect re-fires (deps don't include
    // activeDeckLoading directly, but the effect commit happens on
    // every render so the early-return is re-evaluated). The
    // generationStartedRef guard below still ensures the IIFE runs
    // at most once.
    if (activeDeckLoading) return;
    // EK13 — Hard guard: once a generation has started, never start
    // another. Replaces EK12's `snapshotStatus !== "idle"` guard,
    // which was vulnerable to the status being reset by other code
    // paths between renders.
    if (generationStartedRef.current) return;
    generationStartedRef.current = true;

    // EK14 — Resolve URLs at the moment generation kicks off. Each
    // entry is either the active-deck signed URL (or fallback) for
    // that tarot id, or null in pathological cases.
    const cardImageUrls: (string | null)[] = [];
    for (let i = 0; i < 78; i++) {
      cardImageUrls.push(resolveCardUrl(i, "display"));
    }

    setSnapshotStatus("generating");
    setSnapshotErrorMessage(null);
    const attemptNumber = effectRunCountRef.current;

    // 20-second watchdog. Independent of generateTableSnapshot's
    // internal timeouts (EK08 10s image-load + EK09 5s toBlob = 15s
    // internal worst-case). If status is STILL "generating" at 20s
    // from THIS attempt, force it to "failed" with a diagnostic that
    // includes the attempt number, so we can tell re-mount churn
    // (high number) from a true single-attempt hang (number 1).
    //
    // EK13 — NO LONGER cleared by the effect cleanup. The cleanup
    // was firing on every dep change, killing the watchdog before
    // it could trip. Now the watchdog has a guaranteed 20s budget
    // from when it was scheduled.
    window.setTimeout(() => {
      setSnapshotStatus((current) => {
        if (current === "generating") {
          setSnapshotErrorMessage(
            `Generation watchdog tripped at 20s (attempt #${attemptNumber}, total effect runs ${effectRunCountRef.current}) — internal timeouts didn't fire`,
          );
          return "failed";
        }
        return current;
      });
    }, 20000);

    (async () => {
      try {
        const blob = await generateTableSnapshot({
          scatter: initialScatter,
          deckMapping,
          containerWidth: size.w,
          containerHeight: Math.max(1, size.h - TABLETOP_CONFIG.TOP_RESERVE),
          cardWidth: cardW,
          cardHeight: cardH,
          topOffset: TABLETOP_CONFIG.TOP_RESERVE,
          // EK14 — Active-deck-resolved URLs (built above before status
          // flip). If the active deck is the built-in Rider-Waite,
          // these come back as `/cards/card-NN.jpg` per id which
          // matches the pre-EK14 default. For a custom deck, these
          // are the signed Supabase URLs the live table is already
          // displaying.
          cardImageUrls,
        });
        if (blob) {
          setSnapshotBlob(blob);
          setSnapshotStatus("ready");
          if (askDrawProof && !proofPopupShownRef.current && !ready) {
            proofPopupShownRef.current = true;
            setProofPopupOpen(true);
          }
        } else {
          setSnapshotErrorMessage(
            `generateTableSnapshot returned null (canvas/toBlob step failed) [effect runs: ${effectRunCountRef.current}]`,
          );
          setSnapshotStatus("failed");
        }
      } catch (err) {
        const message =
          err !== null && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message)
            : String(err);
        setSnapshotErrorMessage(
          `Exception during generation: ${message} [effect runs: ${effectRunCountRef.current}]`,
        );
        setSnapshotStatus("failed");
      }
    })();
    // EK13 — No cleanup. The IIFE keeps running regardless of
    // re-renders. The generationStartedRef guard prevents the body
    // from starting a second IIFE. The watchdog runs independently
    // and is no longer cleared by anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, size?.w, size?.h, initialScatter.length, activeDeckLoading]);

  // EK07 — Wire copyRef.current to the SYNCHRONOUS clipboard-write
  // implementation. The forward-ref above expects this exact shape:
  // `() => "no_snapshot" | "writing"`. Callers in the JSX (popup
  // [Copy], menu "Copy table snapshot") invoke `copyRef.current?.()`
  // (or `copySnapshotNow()`) directly in their onClick — NO `await`,
  // NO async wrapper — so Safari's user-activation token survives
  // until the `navigator.clipboard.write([...])` call below.
  //
  // The blob is passed wrapped in a `Promise.resolve()` to
  // `ClipboardItem` because Safari requires the browser itself to
  // do the awaiting, inside its own gesture-preserving context.
  // (Documented on web.dev "Unblocking clipboard access" and Apple's
  // developer forums.)
  //
  // Diagnostic toasts:
  //   - "no_snapshot": blob isn't ready (canvas/blob step failed or
  //     hasn't completed). The popup or menu was tapped before the
  //     snapshot finished generating.
  //   - "blocked":    the clipboard.write call rejected (browser
  //     blocked, permission denied, etc.). Different from
  //     "no_snapshot" so we can distinguish the two failure modes.
  //   - "copied":     write succeeded.
  copyRef.current = (): "no_snapshot" | "writing" => {
    if (!snapshotBlob) {
      setCopyFeedback("no_snapshot");
      window.setTimeout(() => setCopyFeedback(null), 2200);
      return "no_snapshot";
    }
    // EK09 — Auto-detect path: Web Share API on mobile (where it works
    // reliably), clipboard on desktop (where it works and is more
    // ergonomic than the OS share sheet).
    //
    // Why both: image-clipboard via `navigator.clipboard.write()` is
    // documented as flaky on iOS Safari even when called correctly
    // (Apple developer-forum threads, multiple Stack Overflow reports).
    // Web Share API with `files: [file]` is the canonical mobile
    // pattern — opens the native OS share sheet so the seeker can
    // save to Photos, send via Messages, mail it, etc. iOS Safari 15+
    // and Android Chrome both support it; navigator.canShare is the
    // feature-detection method per W3C and web.dev guidance.
    //
    // Detection chain:
    //   1. Build a File from the blob (Web Share wants File objects).
    //   2. If navigator.canShare({ files: [file] }) returns true, use
    //      navigator.share. Most reliable on mobile.
    //   3. Else, fall back to navigator.clipboard.write with the
    //      synchronous-gesture pattern (Safari user-activation fix
    //      from EK07).
    //   4. Else, surface "blocked" toast.
    //
    // Both paths are initiated SYNCHRONOUSLY in the same tick as the
    // user gesture (no `await` between the click and the API call),
    // so iOS Safari's user-activation token survives intact.
    const fileName = `tarot-seed-draw-${Date.now()}.png`;
    let file: File | null = null;
    try {
      file = new File([snapshotBlob], fileName, {
        type: snapshotBlob.type || "image/png",
      });
    } catch {
      file = null;
    }

    // Path 1 — Web Share API (preferred on mobile).
    if (
      file !== null &&
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      typeof navigator.share === "function" &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        // Per Apple developer-forum reports, an empty title is more
        // compatible with iOS Safari's share sheet — some target apps
        // (WhatsApp, Instagram, Facebook) drop the file when a title
        // is present and treat it as a text-only share. Empty string
        // is safer than omitting the field entirely.
        navigator.share({ files: [file], title: "" }).then(
          () => {
            setCopyFeedback("copied");
            window.setTimeout(() => setCopyFeedback(null), 2200);
          },
          (err: unknown) => {
            // AbortError = the seeker dismissed the share sheet. Not
            // a failure — silently clear.
            const isAbort =
              err !== null &&
              typeof err === "object" &&
              "name" in err &&
              (err as { name?: string }).name === "AbortError";
            if (isAbort) {
              setCopyFeedback(null);
            } else {
              setCopyFeedback("blocked");
              window.setTimeout(() => setCopyFeedback(null), 2200);
            }
          },
        );
        return "writing";
      } catch {
        // Fall through to clipboard path below if share() throws
        // synchronously (rare, but defensive).
      }
    }

    // Path 2 — Clipboard fallback (preferred on desktop).
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof window !== "undefined" &&
      typeof window.ClipboardItem !== "undefined"
    ) {
      try {
        const item = new window.ClipboardItem({
          "image/png": Promise.resolve(snapshotBlob),
        });
        navigator.clipboard.write([item]).then(
          () => {
            setCopyFeedback("copied");
            window.setTimeout(() => setCopyFeedback(null), 2200);
          },
          () => {
            setCopyFeedback("blocked");
            window.setTimeout(() => setCopyFeedback(null), 2200);
          },
        );
        return "writing";
      } catch {
        setCopyFeedback("blocked");
        window.setTimeout(() => setCopyFeedback(null), 2200);
        return "no_snapshot";
      }
    }

    // Path 3 — Neither Share nor Clipboard available.
    setCopyFeedback("blocked");
    window.setTimeout(() => setCopyFeedback(null), 2200);
    return "no_snapshot";
  };

  // Hydrate cards + undo/redo from the cross-route session store on
  // first mount. If the user navigated away from /draw and came back,
  // their entire in-flight session (scatter, picks, history) is
  // restored rather than starting over.
  const restored = readTabletopSession(spread);
  const [cards, setCards] = useState<CardState[]>(() => restored?.cards ?? []);

  // ---- Drag + undo/redo (cross-route session) ---------------------------
  const [undoStack, setUndoStack] = useState<DragAction[]>(() => restored?.undoStack ?? []);
  const [redoStack, setRedoStack] = useState<DragAction[]>(() => restored?.redoStack ?? []);
  // Highlighted slot index while a card is being dragged over the rail.
  const [dragHoverSlot, setDragHoverSlot] = useState<number | null>(null);
  // Ghost preview of where the card would land if dropped on the table
  // right now — a subtle dashed outline at the clamped, container-local
  // coordinates. Null whenever the pointer is over a slot (the slot's
  // own highlight serves as the destination preview in that case) or
  // when no drag is in flight.
  const [tableGhost, setTableGhost] = useState<{ x: number; y: number } | null>(null);

  // ---- Onboarding hint --------------------------------------------------
  // Show a small hint on the tabletop that explains the hold-to-drag
  // gesture and dropping onto slots. Persists "seen" via localStorage so
  // returning users aren't nagged. Fades out after the first successful
  // drop into a slot (or any drop, for spreads without slots).
  const HINT_STORAGE_KEY = "tarotseed:tabletop:drag-hint-seen";
  const [showDragHint, setShowDragHint] = useState(false);
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const seen = window.localStorage.getItem(HINT_STORAGE_KEY);
      if (!seen) setShowDragHint(true);
    } catch {
      // localStorage may be blocked — silently skip the hint.
    }
  }, []);
  const dismissDragHint = useCallback(() => {
    setShowDragHint(false);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  /**
   * Apply a DragAction to the cards array in the "do/redo" direction.
   * The reverse direction (undo) is computed inline in `undo()` below
   * because the inverse for `place` involves restoring the previous slot
   * occupant if any.
   */
  const applyAction = useCallback((action: DragAction) => {
    setCards((prev) => {
      if (action.kind === "move") {
        return prev.map((c) =>
          c.id === action.cardId
            ? {
                ...c,
                x: action.toX,
                y: action.toY,
                lastTableX: action.toX,
                lastTableY: action.toY,
                lastTableRotation: c.rotation,
                isDragDrop: false,
              }
            : c,
        );
      }
      if (action.kind === "place") {
        const targetOrder = action.toSlot + 1;
        const dragOrigCoords =
          action.fromSlot === null ? { x: action.fromX, y: action.fromY } : null;
        return prev.map((c) => {
          if (c.id === action.cardId) {
            return { ...c, selectionOrder: targetOrder, isDragDrop: true };
          }
          if (action.displacedCardId !== null && c.id === action.displacedCardId) {
            if (action.displacedToSlot !== null) {
              // Swap: occupant takes the dragged card's previous slot.
              return {
                ...c,
                selectionOrder: action.displacedToSlot + 1,
                isDragDrop: false,
              };
            }
            // Bumped onto the table at its own pre-drag coords.
            return {
              ...c,
              selectionOrder: null,
              x: action.displacedFromX,
              y: action.displacedFromY,
              lastTableX: action.displacedFromX,
              lastTableY: action.displacedFromY,
              lastTableRotation: c.rotation,
              isDragDrop: false,
            };
          }
          return c;
        });
        // (dragOrigCoords is only consulted by undo, kept here for clarity)
        void dragOrigCoords;
      }
      if (action.kind === "unplace") {
        return prev.map((c) =>
          c.id === action.cardId
            ? {
                ...c,
                selectionOrder: null,
                x: action.toX,
                y: action.toY,
                lastTableX: action.toX,
                lastTableY: action.toY,
                lastTableRotation: c.rotation,
                isDragDrop: false,
              }
            : c,
        );
      }
      if (action.kind === "tap-place") {
        const targetOrder = action.toSlot + 1;
        return prev.map((c) =>
          c.id === action.cardId ? { ...c, selectionOrder: targetOrder, isDragDrop: false } : c,
        );
      }
      if (action.kind === "tap-unplace") {
        return prev.map((c) =>
          c.id === action.cardId
            ? {
                ...c,
                selectionOrder: null,
                x: action.toX,
                y: action.toY,
                lastTableX: action.toX,
                lastTableY: action.toY,
                isDragDrop: false,
              }
            : c,
        );
      }
      return prev;
    });
  }, []);

  /** Undo the most recent action. */
  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const action = stack[stack.length - 1];
      setCards((prev) => {
        if (action.kind === "move") {
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  x: action.fromX,
                  y: action.fromY,
                  lastTableX: action.fromX,
                  lastTableY: action.fromY,
                  lastTableRotation: c.rotation,
                  isDragDrop: false,
                }
              : c,
          );
        }
        if (action.kind === "place") {
          const targetOrder = action.toSlot + 1;
          return prev.map((c) => {
            if (c.id === action.cardId) {
              // Send dragged card back to wherever it came from.
              if (action.fromSlot !== null) {
                return { ...c, selectionOrder: action.fromSlot + 1, isDragDrop: false };
              }
              return {
                ...c,
                selectionOrder: null,
                x: action.fromX,
                y: action.fromY,
                lastTableX: action.fromX,
                lastTableY: action.fromY,
                lastTableRotation: c.rotation,
                isDragDrop: false,
              };
            }
            if (action.displacedCardId !== null && c.id === action.displacedCardId) {
              // Displaced card returns to the slot we just vacated.
              return { ...c, selectionOrder: targetOrder, isDragDrop: false };
            }
            return c;
          });
        }
        if (action.kind === "tap-place") {
          // Undo a tap selection: clear the slot and restore table coords.
          return prev.map((c) =>
            c.id === action.cardId
              ? {
                  ...c,
                  selectionOrder: null,
                  x: action.fromX,
                  y: action.fromY,
                  lastTableX: action.fromX,
                  lastTableY: action.fromY,
                  isDragDrop: false,
                }
              : c,
          );
        }
        // unplace / tap-unplace: card returns to its slot.
        return prev.map((c) =>
          c.id === action.cardId
            ? { ...c, selectionOrder: action.fromSlot + 1, isDragDrop: false }
            : c,
        );
      });
      setRedoStack((r) => [...r, action]);
      return stack.slice(0, -1);
    });
  }, []);

  /** Redo the most recently undone action. */
  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const action = stack[stack.length - 1];
      applyAction(action);
      setUndoStack((u) => [...u, action]);
      return stack.slice(0, -1);
    });
  }, [applyAction]);

  /**
   * Resolve a viewport (clientX, clientY) to a slot index 0..required-1
   * if it falls inside a slot rect, else null. Uses the cached slotRects
   * already maintained for the flight animation system.
   */
  const slotIndexAtPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      for (let i = 0; i < slotRects.length; i++) {
        const r = slotRects[i];
        if (!r) continue;
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return i;
        }
      }
      return null;
    },
    [slotRects],
  );

  /**
   * Called by CardSlot when a drag finishes. Decides whether the drop
   * lands in a slot or on the table, mutates state, and records an
   * undoable action.
   */
  const handleDragEnd = useCallback(
    (
      cardId: number,
      clientX: number,
      clientY: number,
      tableX: number,
      tableY: number,
      fromX: number,
      fromY: number,
    ) => {
      setDragHoverSlot(null);
      setTableGhost(null);
      const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
      const isReady = selectedCount === required;
      const slotIdx = usesSlots && !isReady ? slotIndexAtPoint(clientX, clientY) : null;
      const dragged = cards.find((c) => c.id === cardId) ?? null;
      const fromSlot =
        dragged && dragged.selectionOrder !== null ? dragged.selectionOrder - 1 : null;
      if (slotIdx !== null) {
        // Dropping into a slot. Three sub-cases handled below:
        //  - same slot the card already occupies → no-op
        //  - empty target → simple place
        //  - occupied target → swap (if dragged came from a slot) or
        //    bump occupant onto the table at dragged card's coords.
        if (fromSlot === slotIdx) return; // dropped on its own slot
        const targetOrder = slotIdx + 1;
        const occupant = cards.find((c) => c.selectionOrder === targetOrder);
        const willDisplace = occupant && occupant.id !== cardId ? occupant : null;
        const action: DragAction = {
          kind: "place",
          cardId,
          toSlot: slotIdx,
          fromSlot,
          fromX,
          fromY,
          displacedCardId: willDisplace ? willDisplace.id : null,
          // Swap into vacated slot when dragged came from one; otherwise
          // bump occupant to the table at *its* current coords (which
          // are its pre-drag coords since occupant didn't move).
          displacedToSlot: willDisplace && fromSlot !== null ? fromSlot : null,
          displacedFromX: willDisplace ? willDisplace.x : 0,
          displacedFromY: willDisplace ? willDisplace.y : 0,
        };
        applyAction(action);
        setUndoStack((s) => [...s, action]);
        setRedoStack([]);
        // First successful slot drop → fade the onboarding hint.
        dismissDragHint();
        return;
      }
      // Dropping on the table.
      let action: DragAction;
      if (fromSlot !== null) {
        // Card was in a slot — this is an "unplace" that snaps it back
        // to scatter coordinates. Always recorded (even if coords match)
        // because the slot→table transition is itself a state change.
        action = {
          kind: "unplace",
          cardId,
          fromSlot,
          toX: tableX,
          toY: tableY,
        };
      } else {
        // Pure table-to-table move.
        if (tableX === fromX && tableY === fromY) return; // no-op
        action = {
          kind: "move",
          cardId,
          fromX,
          fromY,
          toX: tableX,
          toY: tableY,
        };
      }
      applyAction(action);
      setUndoStack((s) => [...s, action]);
      setRedoStack([]);
      // For spreads without slots, any successful move dismisses the hint.
      if (!usesSlots) dismissDragHint();
    },
    [applyAction, cards, required, slotIndexAtPoint, usesSlots, dismissDragHint],
  );

  /** Called continuously while dragging so we can light up a slot. */
  const handleDragMove = useCallback(
    (clientX: number, clientY: number, projectedLeft: number, projectedTop: number) => {
      const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
      const isReady = selectedCount === required;
      const overSlot = usesSlots && !isReady ? slotIndexAtPoint(clientX, clientY) : null;
      setDragHoverSlot(overSlot);
      // Compute the clamped table landing point in container coords. We
      // mirror the same clamp `finishDrag` will apply on release so the
      // ghost shows the *exact* spot where the card will snap.
      if (overSlot !== null || !containerOrigin || !size) {
        setTableGhost(null);
        return;
      }
      // Convert viewport coords to container coords. Card Y values are
      // produced by buildScatter in [TOP_RESERVE, size.h - cardH] space
      // (we apply `topOffset: TOP_RESERVE` there), so we keep
      // `targetTop` measured from the container border edge and clamp
      // its lower bound to TOP_RESERVE — the ghost lands exactly where
      // a release would snap.
      const targetLeft = projectedLeft - containerOrigin.left;
      const targetTop = projectedTop - containerOrigin.top;
      const clampedX = Math.max(
        TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(size.w - cardW - TABLETOP_CONFIG.SCATTER_PADDING, targetLeft),
      );
      const clampedY = Math.max(
        TABLETOP_CONFIG.TOP_RESERVE + TABLETOP_CONFIG.SCATTER_PADDING,
        Math.min(size.h - cardH - TABLETOP_CONFIG.SCATTER_PADDING, targetTop),
      );
      setTableGhost({ x: clampedX, y: clampedY });
    },
    [cards, required, usesSlots, slotIndexAtPoint, containerOrigin, size, cardW, cardH],
  );

  // Once cards are initialized we never wipe selections automatically.
  // Subsequent geometry changes (e.g. the bottom bar growing/shrinking
  // when the slot rail collapses on Reveal) reflow the unselected cards
  // in place but preserve every selectionOrder and revealed flag.
  // If we restored a session, treat ourselves as already initialized so
  // the next initialScatter effect doesn't wipe the restored cards.
  const initializedRef = useRef(restored !== null && restored.cards.length > 0);

  // First mount: build the initial card array from the scatter. After that,
  // geometry changes only re-place unselected cards — never reset selections.
  // CRITICAL: a previous version reset every card on any `initialScatter`
  // change, which silently wiped the user's picks the moment the bottom bar
  // resized (e.g. when the slot rail collapsed once all cards were placed).
  useEffect(() => {
    if (initialScatter.length === 0) return;
    if (!initializedRef.current) {
      setCards(
        initialScatter.map((s) => ({
          ...s,
          selectionOrder: null,
          revealed: false,
          originalX: s.x,
          originalY: s.y,
          originalRotation: s.rotation,
          originalZ: s.z,
          lastTableX: s.x,
          lastTableY: s.y,
          lastTableRotation: s.rotation,
        })),
      );
      initializedRef.current = true;
      setSlotRects(usesSlots ? Array(required).fill(null) : []);
      return;
    }
    // Subsequent geometry change — reflow unselected cards only.
    setCards((prev) => {
      if (prev.length === 0) {
        // Edge case: somehow lost the array; rebuild from scratch.
        return initialScatter.map((s) => ({
          ...s,
          selectionOrder: null,
          revealed: false,
          originalX: s.x,
          originalY: s.y,
          originalRotation: s.rotation,
          originalZ: s.z,
          lastTableX: s.x,
          lastTableY: s.y,
          lastTableRotation: s.rotation,
        }));
      }
      let cursor = 0;
      return prev.map((c) => {
        if (c.selectionOrder !== null) return c; // never disturb a pick
        // CM Group 3 — preserve unpicked cards' positions through trivial
        // resize ticks. Only re-place a card if it has been pushed
        // off-screen by the new container size; otherwise leave it
        // exactly where the user last saw it. This stops the inconsistent
        // ~half-the-cards-shift behaviour when the slot rail collapses.
        if (size) {
          const minVisibleW = cardW * 0.3;
          const minVisibleH = cardH * 0.3;
          const usableH = Math.max(1, size.h - TABLETOP_CONFIG.TOP_RESERVE);
          const offRight = c.x > size.w - minVisibleW;
          const offBottom = c.y > usableH - minVisibleH + TABLETOP_CONFIG.TOP_RESERVE;
          const offLeft = c.x < -cardW + minVisibleW;
          const offTop = c.y < TABLETOP_CONFIG.TOP_RESERVE - cardH + minVisibleH;
          const isOffScreen = offRight || offBottom || offLeft || offTop;
          if (!isOffScreen) return c;
        }
        const next = initialScatter[cursor++ % initialScatter.length];
        // Geometry has changed (resize). Refresh both the live position
        // AND the stored "home" — this card has never been placed yet, so
        // we want its return-target to match wherever the new scatter put
        // it. Cards in slots are skipped above and keep their originals.
        return {
          ...c,
          x: next.x,
          y: next.y,
          rotation: next.rotation,
          z: next.z,
          originalX: next.x,
          originalY: next.y,
          originalRotation: next.rotation,
          originalZ: next.z,
          lastTableX: next.x,
          lastTableY: next.y,
          lastTableRotation: next.rotation,
        };
      });
    });
  }, [initialScatter, usesSlots, required]);

  // Measure slot rects after layout (and on resize). Selected-card flight
  // animations read from these rects to compute their flight target.
  useEffect(() => {
    if (!usesSlots) return;
    const measure = () => {
      const next = slotRefs.current.map((el) => (el ? el.getBoundingClientRect() : null));
      setSlotRects(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [usesSlots, size, required, cards.length]);

  // Re-measure slots whenever any selection changes (slot row may grow / re-flow).
  const selectionSig = cards.map((c) => c.selectionOrder ?? "_").join(",");
  useEffect(() => {
    if (!usesSlots) return;
    // Two ticks: layout pass + paint, then read.
    const id = window.requestAnimationFrame(() => {
      const next = slotRefs.current.map((el) => (el ? el.getBoundingClientRect() : null));
      setSlotRects(next);
    });
    return () => window.cancelAnimationFrame(id);
  }, [usesSlots, selectionSig]);

  const selectedCount = cards.filter((c) => c.selectionOrder !== null).length;
  const ready = selectedCount === required;

  const toggleSelect = (id: number) => {
    let recordedAction: DragAction | null = null;
    setCards((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      // Tapping a slotted card sends it back to the table. The other slots
      // hold their cards (we never compact / shift indices). The returning
      // card lands at a fresh random position so the table reads as
      // "shuffled" rather than the card returning to its origin.
      if (target.selectionOrder !== null) {
        if (usesSlots) {
          recordedAction = {
            kind: "tap-unplace",
            cardId: id,
            fromSlot: target.selectionOrder - 1,
            toX: target.lastTableX,
            toY: target.lastTableY,
          };
          // Return the card to its LAST KNOWN table position — the
          // spot it was at when the user lifted it into the slot. If
          // the card was tap-selected (never dragged), lastTableX/Y
          // were initialised to the original scatter coords so this
          // still reads as the same scatter.
          return prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  selectionOrder: null,
                  x: c.lastTableX,
                  y: c.lastTableY,
                  rotation: c.lastTableRotation,
                  isDragDrop: false,
                }
              : c,
          );
        }
        // Single-card / yes_no: keep the original toggle behavior.
        const removedOrder = target.selectionOrder;
        return prev.map((c) => {
          if (c.id === id) return { ...c, selectionOrder: null };
          if (c.selectionOrder !== null && c.selectionOrder > removedOrder) {
            return { ...c, selectionOrder: c.selectionOrder - 1 };
          }
          return c;
        });
      }
      // Pick the lowest-numbered empty slot (1..required). When a card is
      // returned to the table from slot N, the next selection refills slot N
      // rather than appending past the last filled slot.
      const occupied = new Set(
        prev.map((c) => c.selectionOrder).filter((n): n is number => n !== null),
      );
      let nextSlot: number | null = null;
      for (let i = 1; i <= required; i++) {
        if (!occupied.has(i)) {
          nextSlot = i;
          break;
        }
      }
      if (nextSlot === null) return prev;
      if (usesSlots) {
        recordedAction = {
          kind: "tap-place",
          cardId: id,
          toSlot: nextSlot - 1,
          fromX: target.x,
          fromY: target.y,
        };
      }
      return prev.map((c) =>
        c.id === id ? { ...c, selectionOrder: nextSlot, isDragDrop: false } : c,
      );
    });
    if (recordedAction) {
      const action = recordedAction;
      setUndoStack((s) => [...s, action]);
      setRedoStack([]);
    }
  };

  // ---- Tap-only selection -------------------------------------------------
  // Per design: only a deliberate single tap selects/deselects a card. Swipes
  // (drags across cards) must never alter selection state. We implement this
  // per-card on the CardSlot button, tracking the pointer-down position and
  // ignoring the click if the pointer moved beyond a small threshold.
  const TAP_MOVE_THRESHOLD_PX = 8;

  const performExit = () => {
    clearTabletopSession(spread);
    onExit();
  };
  const handleExit = () => {
    if (selectedCount > 0) {
      setExitConfirmOpen(true);
      return;
    }
    performExit();
  };

  // The X icon on the global FloatingMenu mirrors handleExit so the
  // tabletop keeps its single-tap close affordance without owning a
  // top-bar cluster.
  useRegisterCloseHandler(handleExit);

  // Celtic Cross gets a contextual ? icon in the global FloatingMenu
  // that re-opens the position explainer. Other spreads register null.
  useRegisterHelpHandler(spread === "celtic" ? () => setCelticHelpOpen(true) : null);

  // Hide the global BottomNav (and the floating quill in /draw) while
  // the seeker is on the table choosing cards. Both reappear once the
  // table unmounts (cast / reading phases) or the route changes.
  useRegisterTabletopActive(true);

  // Mirror current cards + undo/redo stacks into the cross-route
  // session store on every change. This is what makes the session
  // survive accidental navigation away from /draw — when <Tabletop>
  // remounts, its initial state hydrates from the same snapshot.
  // Only writes once cards exist (skip the empty pre-init render).
  useEffect(() => {
    if (cards.length === 0) return;
    writeTabletopSession(spread, { cards, undoStack, redoStack });
  }, [spread, cards, undoStack, redoStack]);

  // Auto-transition: when the user fills the final slot, pause briefly
  // (the "sacred pause" — long enough to feel intentional, short enough
  // not to frustrate) then hand off to the spread layout screen with
  // cards still face-down. Picks are ordered by selectionOrder so
  // position 1 maps to spread slot 1, etc.
  useEffect(() => {
    if (!ready || required === 0) return;
    const picks = cards
      .filter((c) => c.selectionOrder !== null)
      .sort((a, b) => (a.selectionOrder ?? 0) - (b.selectionOrder ?? 0));
    const timer = window.setTimeout(() => {
      // Reading complete — the in-flight session is done. Clear the
      // snapshot so navigating back to /draw produces a fresh draw.
      clearTabletopSession(spread);
      onComplete(
        picks.map((p) => ({ id: p.id, cardIndex: deckMapping[p.id] })),
        "cast",
        { entryMode: "digital" },
      );
    }, 1500);
    return () => window.clearTimeout(timer);
    // We intentionally only re-run when readiness changes — the picks
    // array is stable once the final slot is filled (tapping a slotted
    // card to remove it would flip `ready` back to false and cancel
    // the timer via the cleanup above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, required]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex w-full flex-col overflow-hidden bg-cosmos"
      style={{
        // EJ68 — Don't cover the TopNav band. Top edge starts at the
        // CSS variable --topbar-pad (set by the root layout as
        // env(safe-area-inset-top, 0px) + TopNav height). z-30 keeps
        // the tabletop below z-bottom-nav (40) so the nav can render
        // above it without z-index gymnastics.
        top: "var(--topbar-pad)",
      }}
    >
      {/* EJ65 — Left fly-out page menu trigger + panel.
          EJ68 — Mount if ANY page-menu items exist (view-swap OR
          add-question), not just if onSwitchToManual is wired. */}
      {pageMenuSections.length > 0 && (
        <>
          <PageMenuTrigger onClick={() => setPageMenuOpen(true)} />
          <PageMenu
            open={pageMenuOpen}
            onClose={() => setPageMenuOpen(false)}
            sections={pageMenuSections}
            title="Card Draw Table"
          />
        </>
      )}
      {/* EJ68 — X close button at top-right, mirroring the PageMenu
          hamburger at top-left. Both sit on the same row as the
          TopNav band (which is rendered by TopNavGate). */}
      <TabletopCloseButton onClick={handleExit} />
      {/* EJ68 — Visible X close button moved into the TopNav row.
          The legacy fixed-position X (was top-right of the tabletop)
          is gone — its handler `handleExit` is now wired to the
          TabletopTopActions overlay rendered as a sibling of the
          TopNav band. */}
      {/* Q95 #7 — single-line question preview directly below the X button,
          right-aligned, with a right-edge fade mask. */}
      {question && question.trim().length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 40px)",
            right: "calc(env(safe-area-inset-right, 0px) + 12px)",
            zIndex: 60,
            maxWidth: 200,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textAlign: "left",
            pointerEvents: "none",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground)",
            opacity: 0.55,
            WebkitMaskImage: "linear-gradient(to right, black 70%, transparent 100%)",
            maskImage: "linear-gradient(to right, black 70%, transparent 100%)",
          }}
        >
          {question.trim()}
        </div>
      )}
      {/* EJ68 — Top action row: Undo · count stepper · Redo.
          Sits just below the TopNav band, full-width centered.
          The count stepper is now ALWAYS visible (was custom-only)
          so the seeker can confirm how many cards the spread holds.
          For fixed spreads (Past/Present/Future = 3) the chevrons
          are disabled-transparent (min=max). For custom spreads
          the seeker can change the count with min=1, max=10.
          Undo and Redo flank the stepper, dimming to 30% opacity
          when their stack is empty (the existing `disabled:opacity-30`
          behavior). */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          paddingTop: 4,
          paddingBottom: 4,
          flexShrink: 0,
          zIndex: 5,
        }}
      >
        <button
          type="button"
          onClick={undo}
          disabled={undoStack.length === 0}
          aria-label="Undo last drag"
          style={{ opacity: undoStack.length === 0 ? 0.3 : restingAlpha }}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed"
        >
          <Undo2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
        {(() => {
          // EJ68 — Count display. For custom spreads, the stepper is
          // fully interactive (min=1, max=10). For fixed spreads, we
          // clamp min===max to the spread's count so both chevrons
          // render as disabled-transparent (opacity 0.3 in the
          // component) — the count is visible but un-editable.
          const isCustom = spread === "custom" && onCustomCountChange;
          const displayCount = isCustom ? (customCount ?? required) : required;
          return (
            <CustomCountStepper
              ref={stepperRef}
              count={displayCount}
              onChange={(next) => {
                if (isCustom && onCustomCountChange) onCustomCountChange(next);
              }}
              min={isCustom ? 1 : displayCount}
              max={isCustom ? 10 : displayCount}
            />
          );
        })()}
        <button
          type="button"
          onClick={redo}
          disabled={redoStack.length === 0}
          aria-label="Redo last drag"
          style={{ opacity: redoStack.length === 0 ? 0.3 : restingAlpha }}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed"
        >
          <Redo2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      {showEntryHint && onSwitchToManual && (
        <Hint
          hintId="entry_mode_toggle"
          text={'Drew elsewhere? Tap "Type" to record cards you already drew.'}
          anchorRef={entryToggleRef}
          position="bottom"
          pointerAlign="start"
          onDismiss={() => setShowEntryHint(false)}
        />
      )}
      {showCountHint && spread === "custom" && onCustomCountChange && (
        <Hint
          hintId="custom_count_stepper"
          text="Pick how many cards. Tap the chevrons to change how many cards you draw."
          anchorRef={stepperRef}
          position="bottom"
          pointerAlign="center"
          onDismiss={() => setShowCountHint(false)}
        />
      )}

      {/* Undo / Redo moved into the upper-right cluster below so all
          tabletop chrome sits in one row at the top-right. */}

      {/* First-visit onboarding hint. Explains the hold-to-drag gesture
          and dropping onto slots. Auto-fades after the first successful
          drop (handled in handleDragEnd via dismissDragHint). */}
      {showDragHint && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
            transform: "translateX(-50%)",
            zIndex: 55,
            maxWidth: "min(92vw, 360px)",
          }}
          className="pointer-events-auto animate-fade-in"
        >
          <div className="flex items-start gap-2 rounded-2xl border border-gold/30 bg-cosmos/85 px-4 py-3 text-center shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <p className="flex-1 text-[13px] leading-snug text-foreground/85">
              <span className="text-gold">Hold</span> a card to lift it, then{" "}
              {usesSlots ? (
                <>
                  drag it onto a <span className="text-gold">slot</span> to place it.
                </>
              ) : (
                <>drag it anywhere on the table.</>
              )}
            </p>
            <button
              type="button"
              onClick={dismissDragHint}
              aria-label="Dismiss hint"
              className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/60 transition hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Per design: all chrome lives in the upper-right cluster. The
          old left-side opacity slider has been removed — opacity is
          configured in Settings → Themes. */}

      {/* EJ68 — Undo / Redo no longer rendered as a fixed-position
          cluster at top-right. They now live in the top action row
          above (flanking the count stepper) so all tabletop chrome
          sits on one consistent row below the TopNav band. */}

      {/* Tabletop scatter area */}
      <div
        ref={containerRef}
        className="tabletop-stage relative flex-1 overflow-visible select-none w-full mx-auto"
        style={{
          // Q66 — desktop scatter is constrained to 1024px centered on
          // screen so cards never spread to the edges of wide monitors.
          // The measured width drives the scatter geometry, so cards
          // stay inside the constrained box.
          maxWidth: 1024,
          // Reserve a vertical strip for the upper-right icon cluster
          // (44px tap targets) so cards never spawn or get dragged
          // behind it. The matching deduction from the usable scatter
          // height happens in `buildScatter` and the drag clamps below.
          // EK02 — Removed the duplicate `env(safe-area-inset-top)` from
          // the padding-top calc. The TopNav above already consumes the
          // safe-area inset; adding it again here pushed the scatter
          // ~44px further down on devices with a notch, leaving an
          // obvious empty band between the "3 cards" header and the
          // first scatter card on mobile.
          paddingTop: TABLETOP_CONFIG.TOP_RESERVE,
        }}
      >
        {cards.map((c, idx) => (
          <CardSlot
            key={c.id}
            card={c}
            cardW={cardW}
            cardH={cardH}
            cardBack={cardBack}
            faceIndex={deckMapping[c.id]}
            disabled={ready}
            hitInset={hitInset}
            tapMoveThresholdPx={TAP_MOVE_THRESHOLD_PX}
            onSelect={() => toggleSelect(c.id)}
            onDragEnd={handleDragEnd}
            onDragMove={handleDragMove}
            isCoarsePointer={isCoarsePointer}
            containerElRef={containerRef}
            containerRect={
              containerOrigin && size
                ? {
                    left: containerOrigin.left,
                    top: containerOrigin.top,
                    width: size.w,
                    height: size.h,
                  }
                : null
            }
            settleDelay={Math.min(idx * 4, 320)}
            slotRect={
              usesSlots && c.selectionOrder !== null
                ? (slotRects[c.selectionOrder - 1] ?? null)
                : null
            }
            flightMs={TABLETOP_CONFIG.FLIGHT_MS}
            containerOrigin={containerOrigin}
          />
        ))}
        {/* 9-6-G — tableGhost dashed outline removed. The slot rail's
            own highlight is sufficient destination feedback. */}
      </div>

      {(() => {
        // The slot rail stays mounted for the entire ceremony — even after
        // Reveal — so slotted cards keep their fixed-position anchors and
        // never fly back to the table. While the user is still mid-pick the
        // rail is fully visible; once every slot is filled it visually
        // steps aside for the "Reveal · Cast" whisper but the DOM nodes
        // remain so slot rects stay measurable.
        const slotRailMounted = usesSlots;
        const showSlotRail = slotRailMounted && !ready;
        const slotRail = slotRailMounted ? (
          <div
            className="flex flex-col items-center gap-1.5"
            // When ready, hide the rail visually but KEEP it taking layout
            // space so the "Reveal · Cast" whisper stays visually above the
            // row where slotted cards have flown to. Previously this used
            // `position: absolute` which pulled the rail out of flow and
            // made the whisper drop below the cards.
            style={
              !showSlotRail
                ? {
                    visibility: "hidden",
                    pointerEvents: "none",
                    overflow: "visible",
                    paddingTop: 4,
                  }
                : { overflow: "visible", paddingTop: 4 }
            }
            aria-hidden={!showSlotRail}
          >
            <div
              className={cn(
                "flex items-end justify-center pb-1",
                // Slot row must allow the active "breathing" beacon's
                // box-shadow to bleed past its own bounds; hidden overflow
                // would clip the gold pulse. (Was overflow-x-auto.)
                "overflow-visible",
              )}
              style={(() => {
                const fits = slotRailFitsViewport(viewportW ?? 0, required, slotW);
                // Q68 — drive the rendered gap from the same function
                // `responsiveSlotWidth` uses, instead of Tailwind
                // gap-1/gap-2 (which were 4px / 8px and didn't match the
                // 6px config gap on mobile). Without this the rail
                // overflows on 8+ slot custom spreads by ~14px.
                const gapPx = slotGap(required, isMobile);
                // Q68 — when the rail can't fit even at the 16px floor,
                // allow horizontal scroll and fade the edges so the
                // overflow reads as a rail extending beyond the viewport
                // rather than getting hard-clipped.
                if (!fits) {
                  return {
                    paddingTop: 12,
                    paddingLeft: 8,
                    paddingRight: 8,
                    gap: gapPx,
                    overflowX: "auto" as const,
                    overflowY: "visible" as const,
                    justifyContent: "flex-start" as const,
                    WebkitMaskImage:
                      "linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)",
                    maskImage:
                      "linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)",
                  };
                }
                // Q68 — overflow-x: hidden as a safety net against
                // sub-pixel rounding overrun. box-shadow (the breathing
                // beacon glow) is not clipped by overflow on the parent
                // box, so the gold pulse still renders correctly.
                return {
                  paddingTop: 12,
                  paddingLeft: 8,
                  paddingRight: 8,
                  gap: gapPx,
                  overflowX: "hidden" as const,
                  overflowY: "visible" as const,
                };
              })()}
              role="list"
              aria-label={`${meta.label} slots`}
            >
              {/* EK02 — Spread picker chevron column. Sits at the start
                  of the slot rail, vertically aligned with the LABEL row
                  (not the cards): empty spacer of slotH up top so it
                  occupies a card's worth of vertical space without
                  drawing anything, then the chevron itself in the
                  position the labels occupy. Mounted as a normal
                  listitem so the existing flex gap spacing between
                  columns matches. Hidden when ready (reveal phase) or
                  when no onSpreadChange handler is provided, mirroring
                  the previous SpreadPicker visibility gate. */}
              {onSpreadChange && !ready && (
                <div
                  role="listitem"
                  className="flex flex-col items-center gap-1 shrink-0"
                  style={{ overflow: "visible" }}
                  aria-label="Spread picker"
                >
                  <div style={{ width: slotW, height: slotH }} aria-hidden />
                  <SpreadPicker
                    current={spread}
                    hasPicks={selectedCount > 0}
                    customCount={customCount}
                    onChange={onSpreadChange}
                  />
                </div>
              )}
              {Array.from({ length: required }).map((_, i) => {
                const filled = cards.some((c) => c.selectionOrder === i + 1);
                const isNext = !filled && i === selectedCount;
                const isDragHover = dragHoverSlot === i;
                return (
                  <div
                    key={i}
                    role="listitem"
                    className="flex flex-col items-center gap-1 shrink-0"
                    style={{ overflow: "visible" }}
                  >
                    <div
                      ref={(el) => {
                        slotRefs.current[i] = el;
                      }}
                      className={cn(
                        isNext && "slot-next-frame",
                        // CL Group 2 — 'slot-filled-static' removed.
                        // Filled slots should be visually invisible
                        // behind the placed card; the gold glow used
                        // to persist per-slot.
                      )}
                      style={{
                        width: slotW,
                        height: slotH,
                        borderRadius: 10,
                        border: isDragHover
                          ? "2px solid var(--gold)"
                          : isNext
                            ? undefined
                            : filled
                              ? "none"
                              : "1px solid rgba(212,175,55,0.2)",
                        background: isDragHover
                          ? "rgba(212,175,55,0.18)"
                          : isNext
                            ? undefined
                            : filled
                              ? "transparent"
                              : "rgba(212,175,55,0.03)",
                        boxShadow: isDragHover
                          ? "0 0 18px var(--gold), 0 0 32px rgba(212,175,55,0.6)"
                          : filled
                            ? "none"
                            : undefined,
                        transition: isNext
                          ? undefined
                          : "background 200ms ease-out, border-color 200ms ease-out, box-shadow 200ms ease-out",
                      }}
                      aria-label={
                        filled
                          ? `${slotLabels[i] ?? `Slot ${i + 1}`} — filled`
                          : isNext
                            ? `${slotLabels[i] ?? `Slot ${i + 1}`} — next`
                            : `${slotLabels[i] ?? `Slot ${i + 1}`} — empty`
                      }
                    />
                    {/*
                      Slot label: ALWAYS mounted with a reserved height
                      so toggling the eyeball density doesn't reflow the
                      tabletop. Only opacity / pointer-events change.
                    */}
                    <span
                      className={cn(
                        "font-display italic",
                        isNext && showLabels && "slot-next-label",
                      )}
                      style={{
                        fontSize: "var(--text-body-lg)",
                        color: "var(--gold)",
                        opacity: showLabels ? (isNext ? undefined : restingAlpha) : 0,
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                        // Q68 — clip labels to the slot's calculated
                        // width. Without this, long labels (e.g.
                        // "Slot 8") push the flex-column item wider
                        // than slotW and overflow the rail. The slot
                        // number is always legible from the rectangle's
                        // position; the full position name is shown in
                        // the whisper above the rail.
                        maxWidth: slotW,
                        overflow: "hidden",
                        textOverflow: "clip",
                        pointerEvents: showLabels ? undefined : "none",
                        transition: "opacity 200ms ease-out",
                      }}
                      aria-hidden={!showLabels}
                    >
                      {slotLabels[i] ?? `Slot ${i + 1}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null;

        // While selection is still in progress we show a two-line whisper:
        //   line 1: "Draw: <Full Position Name>"  (e.g. "Draw: The Present")
        //   line 2: a one-sentence description of that position
        // The line 1 text breathes (existing animation); line 2 is calmer.
        // For single-card spreads we just show "Draw".
        const nextFullLabel = fullPositionLabels[selectedCount];
        const nextDescription = positionDescriptions[selectedCount];
        const drawWord = (
          <div
            aria-live="polite"
            aria-label={
              nextFullLabel
                ? `Draw ${nextFullLabel}${nextDescription ? `. ${nextDescription}` : ""}`
                : `Draw — ${required - selectedCount} more`
            }
            className="flex flex-col items-center"
            style={{
              padding: "0 10px",
              margin: "2px 0",
              gap: 1,
              maxWidth: "min(92vw, 420px)",
            }}
          >
            {/* Line 1: small italic gold "Draw:" word — only when a
                position name follows it. For single-card spreads we
                fall back to a single, larger "Draw". */}
            {usesSlots && nextFullLabel ? (
              <>
                <span
                  className="font-display italic leading-none animate-breathe-glow"
                  style={{
                    fontSize: "var(--text-heading-md)",
                    color: "var(--gold)",
                    opacity: showWhisper ? restingAlpha : 0,
                    lineHeight: 1.15,
                    letterSpacing: "0.06em",
                    textShadow: "0 0 14px rgba(212,175,55,0.55)",
                    // Q19 Fix 6 — allow long position names ("Hopes &
                    // Fears") to wrap rather than be cut off mid-word.
                    textAlign: "center",
                    maxWidth: "100%",
                    pointerEvents: "none",
                    transition: "opacity 200ms ease-out",
                  }}
                  aria-hidden={!showWhisper}
                >
                  {`Draw: ${nextFullLabel}`}
                </span>
                {nextDescription && (
                  <span
                    className="font-display italic leading-snug"
                    style={{
                      // Larger so the description reads at a glance —
                      // 16px on mobile, 18px on desktop. Closer to the
                      // slot rail (no top margin) per design.
                      fontSize: "var(--text-body)",
                      color: "color-mix(in oklab, var(--gold) 55%, transparent)",
                      opacity: showWhisper ? 1 : 0,
                      letterSpacing: "0.03em",
                      textAlign: "center",
                      maxWidth: "100%",
                      pointerEvents: "none",
                      transition: "opacity 200ms ease-out",
                      marginTop: 0,
                    }}
                    aria-hidden={!showWhisper}
                  >
                    {nextDescription}
                  </span>
                )}
              </>
            ) : (
              <span
                className="font-display italic leading-none animate-breathe-glow"
                style={{
                  fontSize: "var(--text-body-lg)",
                  color: "var(--gold)",
                  opacity: showWhisper ? restingAlpha : 0,
                  lineHeight: 1.2,
                  letterSpacing: "0.08em",
                  textShadow: "0 0 14px rgba(212,175,55,0.55)",
                  pointerEvents: "none",
                  transition: "opacity 200ms ease-out",
                }}
                aria-hidden={!showWhisper}
              >
                Draw
              </span>
            )}
          </div>
        );

        // Transition cue: a single gold dot that pulses softly during the
        // 1500ms sacred pause after the last card is selected. Communicates
        // "the reading is beginning" without words.
        const transitionCue = (
          <span
            role="status"
            aria-label="The reading is beginning"
            className="inline-block animate-breathe-glow"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--gold)",
              boxShadow: "0 0 14px rgba(212,175,55,0.85), 0 0 28px rgba(212,175,55,0.45)",
              margin: "6px 0",
            }}
          />
        );

        // While picking: show the "Draw: <Position>" whisper above the
        // slot rail (or the breathing "Draw" word for single-card spreads).
        // Once the user selects the final card the whisper goes quiet and
        // the gold dot pulses through the auto-transition pause. The
        // whisper element is always mounted so toggling the eyeball
        // (Clarity) density only changes opacity, never layout height.
        // EJ67 — drawWord suppressed entirely (set to null below) so the
        // "Draw: <position>" + description text no longer appears under
        // the scatter. The seeker asked for that text removed to give
        // the scatter more vertical breathing room. transitionCue
        // (the gold pulse dot during the ready-pause) is kept since
        // it's the only feedback that the reading is starting.
        const centerWhisper = ready ? transitionCue : null;
        const mobileSlotCounter = null;

        const controlsRow = (
          <div
            className="tabletop-bottom-bar relative flex items-end justify-center"
            style={{
              paddingBottom:
                isMobile && showSlotRail
                  ? "calc(env(safe-area-inset-bottom, 0px) + 4px)"
                  : "calc(env(safe-area-inset-bottom, 0px) + 12px)",
              paddingLeft: "calc(env(safe-area-inset-left, 0px) + 16px)",
              paddingRight: "calc(env(safe-area-inset-right, 0px) + 16px)",
              paddingTop: 4,
            }}
          >
            <div
              className="flex flex-col items-center justify-end min-w-0"
              style={{
                gap: 4,
                transform:
                  ready || !usesSlots
                    ? "translateY(-8px)"
                    : isMobile
                      ? "translateY(-4px)"
                      : "translateY(0)",
              }}
            >
              {/* Whisper ALWAYS sits above the slot rail — "Draw" while
                  picking, "Reveal · Cast" once every slot is filled. The
                  slot rail is rendered in the same wrapper across mobile
                  and desktop so its DOM nodes never unmount mid-flight,
                  keeping slotted cards anchored to their slots. */}
              {centerWhisper ?? mobileSlotCounter}
              {slotRail}
              {/* EK02 — SpreadPicker no longer mounted here. It now
                  sits inline with the slot label row inside the slot
                  rail itself (see slotRail above, leading chevron
                  column). */}
            </div>
          </div>
        );

        return controlsRow;
      })()}
      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this reading?</AlertDialogTitle>
            <AlertDialogDescription>Your selections will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performExit}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* EK03 — Draw-proof popup. Opens once on table mount when the
          ask-on-load preference is ON and the snapshot blob is ready.
          Self-contained inline panel (NOT shadcn AlertDialog) to keep
          the dialog tree shallow — past sessions had crash issues with
          AlertDialog nested inside Tabletop on certain mounts. Three
          choices: [Copy] writes to clipboard and closes; [Skip] just
          closes (popup will appear again next draw); [Don't ask again]
          flips the preference OFF permanently. */}
      {proofPopupOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="draw-proof-popup-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9990,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            style={{
              maxWidth: 360,
              width: "100%",
              background: "var(--surface-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: 12,
              padding: 18,
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.55)",
              fontFamily: "var(--font-serif)",
              color: "var(--color-foreground)",
            }}
          >
            <h2
              id="draw-proof-popup-title"
              style={{
                margin: 0,
                fontSize: "var(--text-heading-sm)",
                fontStyle: "italic",
                color: "var(--accent, var(--gold))",
              }}
            >
              Copy draw proof?
            </h2>
            <p
              style={{
                marginTop: 8,
                marginBottom: 14,
                fontSize: "var(--text-body-sm)",
                lineHeight: 1.45,
                opacity: 0.85,
              }}
            >
              A snapshot of the table is ready. {webShareAvailable
                ? "Save or send it before you pick"
                : "Copy it to your clipboard before you pick"}{" "}
              so you can verify later that the cards were always where
              they are.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  // EK07/EK09 — Synchronous call. No `async`, no `await`
                  // before this point. The click → copySnapshotNow()
                  // call chain stays inside Safari's user-activation
                  // window, and the right delivery API (Web Share OR
                  // clipboard.write, auto-detected inside copyRef.current)
                  // fires in the same tick. Popup closes AFTER the call
                  // is initiated, so the close itself doesn't consume
                  // the gesture before the API call.
                  copySnapshotNow();
                  setProofPopupOpen(false);
                }}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--accent, var(--gold))",
                  background:
                    "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                {webShareAvailable ? "Share" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setProofPopupOpen(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => {
                  setAskDrawProof(false);
                  setProofPopupOpen(false);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "var(--color-foreground)",
                  opacity: 0.55,
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Don't ask again
              </button>
            </div>
          </div>
        </div>
      )}
      {/* EK07 — Inline copy-feedback toast with three diagnostic states:
            - "copied":      success — clipboard.write resolved
            - "no_snapshot": snapshot blob not ready yet (canvas/blob step
              failed or hasn't completed). Tells the seeker to wait a
              second and try again.
            - "blocked":     clipboard.write rejected (browser blocked,
              permission denied, missing ClipboardItem support, etc.).
              Different visible message so we can tell which step is
              failing if it ever does. */}
      {copyFeedback && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
            transform: "translateX(-50%)",
            zIndex: 9991,
            padding: "10px 16px",
            background:
              copyFeedback === "copied"
                ? "color-mix(in oklab, var(--accent, var(--gold)) 18%, var(--surface-elevated))"
                : "var(--surface-elevated)",
            border: "1px solid var(--border-default)",
            borderRadius: 999,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
          }}
        >
          {copyFeedback === "copied"
            ? webShareAvailable
              ? "Snapshot shared"
              : "Snapshot copied to clipboard"
            : copyFeedback === "no_snapshot"
              ? "Snapshot not ready yet — wait a moment, then try again"
              : webShareAvailable
                ? "Share blocked — your browser refused the request"
                : "Clipboard blocked — your browser refused the request"}
        </div>
      )}
      {/* EJ47 — Inline `?` for Celtic Cross. Was previously surfaced
          only through the FloatingMenu pop-down, which has been
          removed. Now anchored to the top-right of the tabletop so
          the position-meaning explainer stays one tap away. */}
      {spread === "celtic" && (
        <button
          type="button"
          onClick={() => setCelticHelpOpen(true)}
          aria-label="What each Celtic Cross position means"
          title="What each position means"
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            right: "calc(env(safe-area-inset-right, 0px) + 12px)",
            zIndex: 50,
            width: 36,
            height: 36,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in oklab, var(--gold) 8%, transparent)",
            border: "1px solid color-mix(in oklab, var(--gold) 25%, transparent)",
            color: "var(--gold)",
            cursor: "pointer",
          }}
        >
          <HelpCircle size={18} strokeWidth={1.6} />
        </button>
      )}
      {celticHelpOpen && spread === "celtic" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Celtic Cross — what each position means"
          onClick={() => setCelticHelpOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding:
              "calc(env(safe-area-inset-top, 0px) + 24px) 16px " +
              "calc(env(safe-area-inset-bottom, 0px) + 24px) 16px",
            overflowY: "auto",
          }}
          className="animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "min(92vw, 480px)",
              width: "100%",
              maxHeight: "100%",
              overflowY: "auto",
              borderRadius: 16,
              border: "1px solid color-mix(in oklch, var(--gold) 35%, transparent)",
              background: "color-mix(in oklch, var(--background) 92%, transparent)",
              boxShadow: "0 24px 64px -12px rgba(0,0,0,0.7), 0 0 32px -8px rgba(212,175,55,0.25)",
              padding: "20px 22px",
              color: "var(--foreground)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="font-display text-lg italic"
                style={{ color: "var(--gold)", letterSpacing: "0.02em" }}
              >
                The Celtic Cross
              </h2>
              <button
                type="button"
                onClick={() => setCelticHelpOpen(false)}
                aria-label="Close help"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gold/80 transition hover:text-gold hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              >
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <p
              className="mt-1 text-xs"
              style={{
                color: "color-mix(in oklab, var(--foreground) 65%, transparent)",
              }}
            >
              Ten positions, each holding a different facet of the question.
            </p>
            <ol className="mt-4 space-y-2.5">
              {fullPositionLabels.map((label, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-[11px]"
                    style={{
                      color: "var(--gold)",
                      border: "1px solid color-mix(in oklch, var(--gold) 45%, transparent)",
                      background: "color-mix(in oklch, var(--gold) 8%, transparent)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[13px] italic" style={{ color: "var(--gold)" }}>
                      {label}
                    </p>
                    {positionDescriptions[i] && (
                      <p
                        className="text-[12px] leading-snug"
                        style={{
                          color: "color-mix(in oklab, var(--foreground) 75%, transparent)",
                        }}
                      >
                        {positionDescriptions[i]}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p
              className="mt-4 text-center text-[11px] italic"
              style={{
                color: "color-mix(in oklab, var(--foreground) 50%, transparent)",
              }}
            >
              Tap anywhere to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
