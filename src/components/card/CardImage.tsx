/**
 * EW-1 — Single source of truth for rendering tarot cards.
 *
 * Variants:
 * - face   : show the card art (most common)
 * - back   : show the card back design
 * - empty  : null / no card yet (renders a faint placeholder slot)
 *
 * Sizes:
 * - hero      : home gateway, draw flow (responsive width)
 * - medium    : share cards, lunation slides (~180px)
 * - thumbnail : journal list, recap stalker entries (~74px)
 * - small     : insight cards, top-stalker tiles (~40px)
 * - custom    : caller specifies widthPx (escape hatch for responsive sizes)
 *
 * Reversed: when true, the card art rotates 180°.
 * Loading:  when true, shows shimmer skeleton instead of image.
 *
 * Border: NEVER. The cards are physical scanned cards — each image
 * has its own printed frame and white scan corners that are NOT app
 * chrome. CardImage applies only the corner radius and orientation
 * transform to the IMG element.
 */
import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CardBack } from "@/components/cards/CardBack";
import {
  useActiveCardBackUrl,
  useActiveDeckCardAspect,
  useActiveDeckCardName,
  useActiveDeckCornerRadius,
  useActiveDeckImage,
  useAnyDeckCardName,
  useAnyDeckImage,
  useDeckCardName,
  useDeckCornerRadius,
  useDeckImage,
} from "@/lib/active-deck";
import { useDevSlotColors } from "@/components/dev/DevOverlay";
import type { CardBackId } from "@/lib/card-backs";

/**
 * EX-4 — Read the dev-mode flag from localStorage and subscribe to
 * the same custom event used by DevOverlay so toggling reflects
 * immediately without a page refresh.
 */
function useDevMode(): boolean {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("tarotseed:dev_mode") === "true";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => window.localStorage.getItem("tarotseed:dev_mode") === "true";
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOn(typeof detail === "boolean" ? detail : read());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "tarotseed:dev_mode") setOn(read());
    };
    window.addEventListener("tarotseed:dev-mode-changed", handler);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("tarotseed:dev-mode-changed", handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return on;
}

export type CardImageSize = "hero" | "medium" | "thumbnail" | "small" | "custom";
export type CardImageVariant = "face" | "back" | "empty";

// Q26 — CardImage state machine. Replaces fragmented booleans
// with a single state object whose transitions are explicit and
// non-conflicting. Every state change happens through the reducer.

type LoadStatus = "idle" | "loading" | "loaded" | "failed-final";

type CardImageState = {
  status: LoadStatus;
  // The src we last committed to. Used to detect actual src changes
  // (vs. cardId/deckId noise that doesn't affect the resolved URL).
  committedSrc: string | null;
  // Variant fallback — set true when variant.webp 404s and we
  // fall back to the full URL.
  variantFailed: boolean;
  // Retry counter — 0 to 2. After 2 retries we give up.
  retryCount: number;
  // Cache-buster timestamp appended to URL on retries. 0 = none.
  retryTs: number;
  // Measured aspect ratios from <img onLoad>.
  faceAspect: number | null;
  backAspect: number | null;
};

type CardImageAction =
  | { type: "SRC_CHANGED"; src: string | null }
  | { type: "LOAD_SUCCEEDED"; tier?: "sm" | "md" | "full" }
  | { type: "LOAD_FAILED"; hasBaseSrcAvailable: boolean }
  | { type: "RETRY_TICK"; ts: number }
  | { type: "SAFETY_TIMEOUT_FIRED" }
  | { type: "FACE_ASPECT_MEASURED"; aspect: number }
  | { type: "BACK_ASPECT_MEASURED"; aspect: number };

function cardImageReducer(state: CardImageState, action: CardImageAction): CardImageState {
  const log = (next: CardImageState) => {
    if (state.status !== next.status) {
      console.debug("[CardImage:reducer]", {
        action: action.type,
        prev: state.status,
        next: next.status,
        srcShort: next.committedSrc?.slice(0, 80) ?? null,
      });
    }
    return next;
  };

  switch (action.type) {
    case "SRC_CHANGED": {
      if (action.src === state.committedSrc) return state;
      return log({
        ...state,
        committedSrc: action.src,
        status: action.src ? "loading" : "idle",
        variantFailed: false,
        retryCount: 0,
        retryTs: 0,
      });
    }
    case "LOAD_SUCCEEDED":
      if (state.status === "loaded") return state;
      return log({ ...state, status: "loaded" });
    case "LOAD_FAILED": {
      // Q28 — Variant fallback is no longer needed (the resolver
      // returns a pre-signed URL for the chosen tier). Just retry
      // up to 2× via RETRY_TICK before giving up.
      void action.hasBaseSrcAvailable;
      if (state.retryCount < 2) {
        return state; // wait for RETRY_TICK
      }
      return log({ ...state, status: "failed-final" });
    }
    case "RETRY_TICK":
      return log({
        ...state,
        retryCount: state.retryCount + 1,
        retryTs: action.ts,
        status: "loading",
      });
    case "SAFETY_TIMEOUT_FIRED":
      if (state.status !== "loading") return state;
      // Q30 Fix B2 — downgrade to console.debug so it's only visible
      // when DevTools verbose level is enabled. Cards rendered fine.
      console.debug("[CardImage:safety-timeout] forcing loaded", {
        srcShort: state.committedSrc?.slice(0, 80) ?? null,
      });
      return log({ ...state, status: "loaded" });
    case "FACE_ASPECT_MEASURED":
      if (state.faceAspect === action.aspect) return state;
      return { ...state, faceAspect: action.aspect };
    case "BACK_ASPECT_MEASURED":
      if (state.backAspect === action.aspect) return state;
      return { ...state, backAspect: action.aspect };
  }
}

export interface CardImageProps {
  /** Card index 0-77. Required when variant="face". */
  cardId?: number | null;
  /** Variant: face (default), back, or empty placeholder. */
  variant?: CardImageVariant;
  /** Reversed orientation — rotates the face 180°. Ignored for back/empty. */
  reversed?: boolean;
  /** Loading skeleton — shows shimmer instead of image. */
  loading?: boolean;
  /** Card back design — only used when variant="back". */
  cardBackId?: CardBackId;
  /** Preset size or "custom". Default "thumbnail". */
  size?: CardImageSize;
  /** When size="custom", caller must provide widthPx. */
  widthPx?: number;
  /**
   * Optional deck override. When provided, resolves card art (and
   * corner radius) through this specific deck instead of the seeker's
   * currently-active deck. Used for journal/historical readings that
   * carry their own saved deck_id.
   */
  deckId?: string | null;
  /** Optional className for the outer wrapper element. */
  className?: string;
  /** Optional inline style for the outer wrapper. */
  style?: CSSProperties;
  /** Optional click handler. Wraps the component in a button if provided. */
  onClick?: () => void;
  /** ARIA label override. Defaults to the card name. */
  ariaLabel?: string;
  /**
   * EZ-4 — Render a soft drop shadow that follows the rounded
   * silhouette. Caller is responsible for ensuring parent containers
   * don't clip the shadow with their own overflow rules.
   */
  shadow?: boolean;
  /**
   * FA-4 — When set (boolean), render BOTH the face and back inside a
   * 3D-perspective wrapper using the existing `.flip-3d` / `.flip-face`
   * classes from styles.css. `flipped=false` shows the back; `flipped=true`
   * rotates 180° to reveal the face. Used by the tabletop draw flow so
   * the same component owns face/back rendering everywhere.
   */
  flipped?: boolean;
  /** Q48 Fix 5 — when true, IMG uses loading="eager" instead of "lazy". */
  eager?: boolean;
  /**
   * EJ56 — Selection / focus state. When true, CardImage renders a CSS
   * `outline` on its own wrapper, sized to the deck's corner radius
   * so the ring hugs the actual card silhouette. Because `outline`
   * traces the wrapper's border box (and the wrapper hugs the IMG
   * via `display: inline-block` + auto height), this is the simplest
   * way to make every surface that uses CardImage render a consistent
   * highlight without layout concerns in the parent.
   */
  selected?: boolean;
  /** EJ56 — Color of the selected outline. Defaults to var(--accent, var(--gold)). */
  selectedColor?: string;
  /**
   * EJ56 — Optional badge slots. Rendered as absolute children INSIDE
   * CardImage's wrapper so they anchor to the card's actual rendered
   * edges, not to whatever wrapper is above. Use any ReactNode (e.g.
   * a CardCountBadge, a delete X button, etc.). Use the `inset` props
   * to fine-tune the offset from the corresponding corner.
   */
  topLeftBadge?: import("react").ReactNode;
  topRightBadge?: import("react").ReactNode;
  bottomLeftBadge?: import("react").ReactNode;
  bottomRightBadge?: import("react").ReactNode;
  /** EJ56 — Inset (px) for the badge from its anchor corner. Default 4. */
  badgeInset?: number;
}

// Q48 Fix 5 — `eager` opts a CardImage out of native lazy loading,
// for above-the-fold images (HeroCard, selected stalker card).

// Standard widths in px. Aspect ratio 1 / 1.75.
const SIZE_PX: Record<Exclude<CardImageSize, "custom">, number> = {
  hero: 320,
  medium: 180,
  thumbnail: 74,
  small: 40,
};

// Q28 — variant tier derived inline from rendered width and passed
// straight to the resolver. No URL-mutation step.

function resolveWidth(size: CardImageSize, widthPx?: number): number {
  if (size === "custom") {
    if (typeof widthPx !== "number" || widthPx <= 0) {
      console.warn("[CardImage] size=custom requires widthPx");
      return SIZE_PX.thumbnail;
    }
    return widthPx;
  }
  return SIZE_PX[size];
}

export function CardImage({
  cardId,
  variant = "face",
  reversed = false,
  loading = false,
  cardBackId,
  size = "thumbnail",
  widthPx,
  deckId,
  className,
  style,
  onClick,
  ariaLabel,
  shadow = false,
  flipped,
  eager = false,
  // EJ56 — selection/badge props
  selected = false,
  selectedColor,
  topLeftBadge,
  topRightBadge,
  bottomLeftBadge,
  bottomRightBadge,
  badgeInset = 4,
}: CardImageProps) {
  // Resolve image source + radius from active deck OR a specific deck
  // when `deckId` is supplied. Both hooks are always called (Rules of
  // Hooks), and we pick which to use per render.
  const activeResolve = useActiveDeckImage();
  const activeRadius = useActiveDeckCornerRadius();
  const specificResolve = useDeckImage(deckId ?? null);
  const specificRadius = useDeckCornerRadius(deckId ?? null);
  const activeNameResolve = useActiveDeckCardName();
  const specificNameResolve = useDeckCardName(deckId ?? null);
  // EJ44 — multi-deck fallback resolvers. Try the active deck first,
  // then any other custom deck the user owns. Self-heals constellation
  // companions, mixed-deck history, and any context where the user's
  // active deck no longer covers a card_id they've drawn before.
  const anyResolve = useAnyDeckImage();
  const anyNameResolve = useAnyDeckCardName();
  const customBackUrl = useActiveCardBackUrl();
  const devMode = useDevMode();

  // Q29 Fix 4 — once we successfully load at a tier, lock it for the
  // lifetime of the component. Subsequent width fluctuations (from
  // layout settling, parent reflow, etc) MUST NOT retrigger src
  // changes — that's what was causing the safety-timeout flood.
  const lockedTierRef = useRef<"sm" | "md" | "full" | null>(null);

  // FC-1 / 9-6-V — Track BOTH face and back natural aspects so the
  // flip wrapper matches whichever side is currently showing. Without
  // this, a back image with a different aspect than the face will
  // letterbox inside the wrapper.
  // 9-6-Y — seed face aspect from the deck-image cache so the wrapper
  // renders at the correct height on FIRST PAINT.
  const cachedFaceAspect = useActiveDeckCardAspect(typeof cardId === "number" ? cardId : null);
  // Q26 — single source of truth for all load state.
  const [state, dispatch] = useReducer(cardImageReducer, undefined, () => ({
    status: "idle" as LoadStatus,
    committedSrc: null,
    variantFailed: false,
    retryCount: 0,
    retryTs: 0,
    faceAspect: cachedFaceAspect,
    backAspect: null,
  }));

  // EY-1 — Saturated diagnostic colors. The card art still
  // shows through the IMG layer at 50% opacity; everything else
  // is fully opaque so layer geometry is unambiguous.
  // EJ46 — slot colors are gated by a sub-toggle so dev mode can
  // stay ON for version pill / opacity readout / DevChip without
  // the saturated colors painting every card. Default ON.
  const slotColorsOn = useDevSlotColors();
  const devColorsActive = devMode && slotColorsOn;
  const DEV_WRAPPER_BG = devColorsActive ? "#00FF00" : undefined; // green
  const DEV_IMG_TINT_BG = devColorsActive ? "rgba(255, 0, 0, 0.5)" : undefined; // red 50%
  const DEV_BACK_OUTLINE = devColorsActive ? "3px solid #FF4F00" : undefined; // international orange
  const DEV_EMPTY_BG = devColorsActive ? "#FFFF00" : undefined; // yellow
  const DEV_LOADING_OUTLINE = devColorsActive ? "3px solid #FF00FF" : undefined; // magenta

  const useSpecific = deckId != null && deckId !== "";
  const deckRadius = useSpecific ? specificRadius : activeRadius;
  // 26-05-08-Q5 — Fix 1: when a specific deckId is supplied but its
  // image map hasn't loaded yet (or doesn't contain that cardId),
  // fall back to the active deck resolver. Same chain the share-card
  // render uses (`getImage(deckId) ?? getActive() ?? default`). Without
  // this, mixed-deck readings render blank for the entire window
  // between mount and `buildDeckImageMap` resolution.
  const specificName = useSpecific ? specificNameResolve(cardId ?? -1) : "";
  const activeName = activeNameResolve(cardId ?? -1);
  // EJ44 — multi-deck name fallback. activeName already routes through
  // the active deck override → canonical tarot → "Card N". When that
  // last "Card N" fallback fires for an oracle id the active deck
  // doesn't know about, try the user's other decks before giving up.
  const anyName = anyNameResolve(cardId ?? -1);
  const resolvedName =
    typeof cardId !== "number"
      ? ""
      : useSpecific && specificName && !specificName.startsWith("Card ")
        ? specificName
        : activeName && !activeName.startsWith("Card ")
          ? activeName
          : anyName;

  const width = resolveWidth(size, widthPx);
  // EJ57 — REVERTED the EJ56 wrapper-borderRadius. The EJ27 hero
  // architectural rule is explicit: the image is pre-processed at
  // deck-import time with a baked rounded alpha mask (FD/FE
  // pipeline) and its transparent corners ARE the card silhouette.
  // Adding a CSS clip via borderRadius on the wrapper layers a
  // second different rounded rectangle on top, creating visible
  // corner wedges when the two radii drift apart. EJ56 reintroduced
  // exactly that mistake. radiusStyle stays empty here — the alpha
  // mask is the only source of truth for the visible card shape.
  const radiusStyle: CSSProperties = {};
  // EJ57 — The selection ring is rendered as an absolute child
  // INSIDE the wrapper (see below), positioned at inset:-2 with
  // borderRadius computed from the deck's stored corner_radius_
  // percent. This matches the constellation hero card's EJ27
  // pattern exactly. Each CardImage internally resolves its own
  // per-deck radius (via the `deckId` prop -> useDeckCornerRadius),
  // so a slot row with cards from multiple decks gets a per-card
  // ring radius that matches each card's alpha-mask silhouette.
  const selectionRingRadius =
    Math.round(((deckRadius ?? 0) / 100) * width) + 2;
  const selectionRingColor = selectedColor ?? "var(--accent, var(--gold))";

  // EY-2 — No hardcoded aspect ratio. The IMG sources its own
  // natural dimensions; the wrapper hugs the IMG. This means the
  // rounded corner sits at the actual card edge, not at letterbox
  // space that resulted from forcing 1/1.75 onto images with
  // different natural proportions. minHeight reserves space before
  // IMG loads so shimmer / placeholder has a visible footprint;
  // once the IMG loads, its height auto-derives and overrides this.
  const wrapperStyle: CSSProperties = {
    width,
    // Q119 Fix 3 — removed `minHeight: width * 1.6`. minHeight is a CSS
    // MIN that persisted after IMG load, creating a visible bottom gap
    // on cards with natural aspect < 1.6.
    position: "relative",
    // EZ-4 — When a drop shadow is requested we cannot clip the
    // wrapper (overflow: hidden would cut the shadow off). The IMG
    // and overlays still inherit the same border-radius, so the
    // visible card shape stays correctly rounded; the shadow now
    // renders outside that silhouette via filter: drop-shadow().
    // EJ57 — overflow is always visible. Previous behavior was
    // `hidden` (unless shadow=true) to clip the IMG to the wrapper's
    // borderRadius. But EJ27 / EJ57 architecture: the IMG carries
    // its own baked rounded alpha mask, so CSS clipping isn't
    // needed AND would conflict with the alpha mask if the two
    // radii didn't match. Visible also lets the selection ring
    // (rendered as an absolute child at inset:-2) extend past
    // the wrapper bounds without being clipped.
    overflow: "visible",
    display: "inline-block",
    ...radiusStyle,
    // FA-3 — tighter shadow: less blur, slightly more opacity.
    // More grounded, less halo.
    ...(shadow ? { filter: "drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35))" } : null),
    // EZ-3 — Wrapper green as outline so it's visible as a ring
    // around the actual card boundary (the wrapper hugs the IMG
    // per EY-2, so a background fill would be invisible).
    // EJ57 — The selection ring lives as an absolute child of the
    // wrapper (see selection-ring span below), not as an outline
    // here. CSS outline doesn't reliably respect border-radius
    // anyway, which is why the EJ27 hero pattern uses an absolute
    // span instead.
    ...(DEV_WRAPPER_BG
      ? { outline: `3px solid ${DEV_WRAPPER_BG}`, outlineOffset: -3 }
      : null),
    ...(style ?? {}),
  };

  // Q29 Fix 4 — pick the natural tier from rendered width, but
  // honor the lock once an image has loaded. Default to "md" when
  // width is 0 (initial mount before measurement) so we don't
  // pick "sm" by accident and immediately switch to a different
  // signed URL once the real width arrives.
  const naturalTier: "sm" | "md" | "full" =
    width === 0 ? "md" : width <= 80 ? "sm" : width <= 200 ? "md" : "full";
  // CG — Tier lock is MONOTONIC: tracks the HIGHEST tier ever needed.
  // Width fluctuations cannot downgrade it (preventing oscillation),
  // but a genuine width increase upgrades both the rendered tier
  // AND the lock.
  const TIER_RANK = { sm: 0, md: 1, full: 2 } as const;
  const lockedRank = lockedTierRef.current ? TIER_RANK[lockedTierRef.current] : -1;
  const naturalRank = TIER_RANK[naturalTier];
  const variantTier: "sm" | "md" | "full" =
    naturalRank > lockedRank ? naturalTier : (lockedTierRef.current ?? naturalTier);
  const specificSrc =
    typeof cardId === "number" && useSpecific ? specificResolve(cardId, variantTier) : null;
  const activeSrc = typeof cardId === "number" ? activeResolve(cardId, variantTier) : null;
  // EJ44 — multi-deck fallback. If both the specific-deck resolver
  // (when supplied) and the active deck miss, try every other custom
  // deck the user owns. This is what fixes constellation companions
  // and cross-deck history images for users with multiple decks.
  // For default-deck users with no custom decks, allDeckMaps is empty
  // and this resolver behaves identically to activeResolve.
  const anySrc = typeof cardId === "number" ? anyResolve(cardId, variantTier) : null;
  const baseFaceSrc = specificSrc ?? activeSrc ?? anySrc;
  const baseChosen = baseFaceSrc;
  const faceSrc =
    baseChosen && state.retryTs > 0
      ? `${baseChosen}${baseChosen.includes("?") ? "&" : "?"}r=${state.retryTs}`
      : baseChosen;

  // Q26 Effect A — sync src changes into the reducer.
  useEffect(() => {
    dispatch({ type: "SRC_CHANGED", src: faceSrc ?? null });
  }, [faceSrc]);

  // Q26 Effect B — safety timeout. Starts whenever status enters
  // "loading"; clears on any other status. Ensures shimmer never hangs.
  useEffect(() => {
    if (state.status !== "loading") return;
    if (variant !== "face") return;
    // Q30 Fix B2 — tier-aware timeout (full variants legitimately
    // take longer to load than thumbnails).
    const safetyTimeoutMs = variantTier === "full" ? 8000 : variantTier === "md" ? 5000 : 3000;
    const t = window.setTimeout(() => {
      dispatch({ type: "SAFETY_TIMEOUT_FIRED" });
    }, safetyTimeoutMs);
    return () => window.clearTimeout(t);
  }, [state.status, variant, variantTier]);

  const showFaceShimmer =
    variant === "face" && !loading && state.status !== "loaded" && state.status !== "failed-final";

  // 26-05-08-Q8 — Fix 1: `token=` is a substring of EVERY Supabase
  // signed URL, not just expired ones. The previous heuristic stranded
  // every signed-URL card on the placeholder forever after a single
  // variant 404. Only show the named placeholder when there is
  // genuinely no source URL to attempt.
  const allFailed = variant === "face" && state.status === "failed-final";

  const handleImgError = () => {
    // Q28 — simple retry ladder, no variant-fallback branch.
    const wantsRetry = state.retryCount < 2 && !!baseFaceSrc;
    dispatch({
      type: "LOAD_FAILED",
      hasBaseSrcAvailable: !!baseFaceSrc,
    });
    if (wantsRetry) {
      const delay = state.retryCount === 0 ? 500 : 1500;
      window.setTimeout(() => {
        dispatch({ type: "RETRY_TICK", ts: Date.now() });
      }, delay);
    }
  };
  const handleImgLoad = () => {
    // CG — Monotonic lock: upgrade to higher tier on success, never downgrade.
    const currentLocked = lockedTierRef.current;
    if (currentLocked === null || TIER_RANK[variantTier] > TIER_RANK[currentLocked]) {
      lockedTierRef.current = variantTier;
    }
    dispatch({ type: "LOAD_SUCCEEDED", tier: variantTier });
  };

  // FC-1 — Flip mode: render face + back inside a 3D wrapper. The
  // standard CardImage pattern (wrapper hugs IMG via height:auto)
  // CANNOT work here because .flip-face is position:absolute/inset:0
  // — the rotation requires both faces to overlap with explicit
  // dimensions. Solution: measure the IMG's natural aspect on load
  // and size the OUTER wrapper to width × aspect, so the
  // absolutely-positioned faces fit perfectly with no letterbox.
  if (typeof flipped === "boolean" && typeof cardId === "number") {
    // 9-6-V — pick the aspect of whichever side is currently showing.
    const activeAspect = flipped
      ? (state.faceAspect ?? state.backAspect ?? 1.6)
      : (state.backAspect ?? state.faceAspect ?? 1.6);
    const wrapperHeight = Math.round(width * activeAspect);
    return (
      <div
        className={className}
        style={{
          width,
          height: wrapperHeight,
          position: "relative",
          display: "inline-block",
          ...radiusStyle,
          ...(DEV_WRAPPER_BG
            ? { outline: `3px solid ${DEV_WRAPPER_BG}`, outlineOffset: -3 }
            : null),
          ...(style ?? {}),
        }}
        onClick={onClick}
      >
        <div
          className={`absolute inset-0 flip-3d${flipped ? " is-flipped" : ""}`}
          style={{ ...radiusStyle }}
        >
          <div className="flip-face back" style={{ ...radiusStyle, overflow: "hidden" }}>
            <CardBack
              id={cardBackId}
              imageUrl={customBackUrl ?? undefined}
              width={width}
              cornerRadiusPercent={deckRadius}
              onAspectMeasured={(a) => dispatch({ type: "BACK_ASPECT_MEASURED", aspect: a })}
              className="h-full w-full"
            />
            {DEV_BACK_OUTLINE ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  outline: DEV_BACK_OUTLINE,
                  outlineOffset: -3,
                  pointerEvents: "none",
                  ...radiusStyle,
                }}
              />
            ) : null}
          </div>
          <div className="flip-face front" style={{ ...radiusStyle, overflow: "hidden" }}>
            {faceSrc ? (
              <img
                src={faceSrc}
                alt={ariaLabel ?? resolvedName}
                loading="eager"
                onLoad={(e) => {
                  // FC-1 — measure natural aspect on load so the
                  // wrapper can match the IMG's true shape.
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    dispatch({
                      type: "FACE_ASPECT_MEASURED",
                      aspect: img.naturalHeight / img.naturalWidth,
                    });
                  }
                  handleImgLoad();
                }}
                onError={handleImgError}
                style={{
                  // FC-1 — wrapper sized to match IMG's natural
                  // aspect, so 100%/100% fits with no letterbox.
                  width: "100%",
                  height: "100%",
                  display: "block",
                  opacity: state.status === "loaded" ? 1 : 0,
                  transform: reversed ? "rotate(180deg)" : undefined,
                  transition: "opacity 300ms ease-out",
                  ...radiusStyle,
                }}
              />
            ) : null}
            {DEV_IMG_TINT_BG && state.status === "loaded" ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: DEV_IMG_TINT_BG,
                  pointerEvents: "none",
                  ...radiusStyle,
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const inner: ReactNode = (
    <>
      {/* Loading shimmer overlay — covers the slot while loading or
          while the underlying image hasn't decoded yet. */}
      {loading || showFaceShimmer ? (
        <div
          aria-hidden
          className="hero-skeleton-shimmer"
          style={{
            position: "absolute",
            inset: 0,
            background: "color-mix(in oklab, var(--gold) 6%, transparent)",
            ...radiusStyle,
            overflow: "hidden",
            borderRadius: "inherit",
            ...(DEV_LOADING_OUTLINE ? { outline: DEV_LOADING_OUTLINE, outlineOffset: -2 } : null),
          }}
        />
      ) : null}

      {variant === "face" && typeof cardId === "number" && !loading && faceSrc ? (
        <>
          {allFailed ? (
            <div
              style={{
                width: "100%",
                height: "100%",
                minHeight: width * 1.6,
                background: "var(--surface-card)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-caption, 0.75rem)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color: "var(--color-foreground)",
                opacity: 0.5,
                padding: 6,
                textAlign: "center",
                ...radiusStyle,
              }}
            >
              {resolvedName}
            </div>
          ) : (
            <img
              src={faceSrc}
              alt={ariaLabel ?? resolvedName}
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "auto"}
              onLoad={handleImgLoad}
              onError={handleImgError}
              style={{
                // EY-2 — width matches wrapper; height auto-derives
                // from the image's natural aspect.
                width: "100%",
                height: "auto",
                display: "block",
                opacity: state.status === "loaded" ? 1 : 0,
                transform: reversed ? "rotate(180deg)" : undefined,
                transition: "opacity 300ms ease-out",
                ...radiusStyle,
              }}
            />
          )}
          {/* EZ-3 — Dev-mode tint as sibling overlay so it's visible
              over the opaque card art (backgroundColor on an opaque
              IMG renders behind the pixels and is therefore invisible). */}
          {DEV_IMG_TINT_BG && state.status === "loaded" ? (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: DEV_IMG_TINT_BG,
                pointerEvents: "none",
                transform: reversed ? "rotate(180deg)" : undefined,
                ...radiusStyle,
              }}
            />
          ) : null}
        </>
      ) : null}

      {variant === "back" && !loading ? (
        <>
          <CardBack
            id={cardBackId}
            imageUrl={customBackUrl ?? undefined}
            width={width}
            cornerRadiusPercent={deckRadius}
          />
          {DEV_BACK_OUTLINE ? (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                outline: DEV_BACK_OUTLINE,
                outlineOffset: -3,
                pointerEvents: "none",
                ...radiusStyle,
              }}
            />
          ) : null}
        </>
      ) : null}

      {variant === "empty" && !loading ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: DEV_EMPTY_BG ?? "color-mix(in oklab, var(--gold) 6%, transparent)",
            ...radiusStyle,
          }}
        />
      ) : null}
    </>
  );

  // EJ56 — Badge slots. Rendered as absolute children INSIDE the
  // CardImage wrapper so they anchor to the card's actual rendered
  // edges (the wrapper hugs the IMG via display:inline-block +
  // natural-aspect height). Each badge gets a wrapper span so the
  // caller's badge node is positioned without leaking style.
  const badgeNodes = (topLeftBadge || topRightBadge || bottomLeftBadge || bottomRightBadge) ? (
    <>
      {topLeftBadge ? (
        <span
          style={{
            position: "absolute",
            top: badgeInset,
            left: badgeInset,
            zIndex: 3,
          }}
        >
          {topLeftBadge}
        </span>
      ) : null}
      {topRightBadge ? (
        <span
          style={{
            position: "absolute",
            top: badgeInset,
            right: badgeInset,
            zIndex: 3,
          }}
        >
          {topRightBadge}
        </span>
      ) : null}
      {bottomLeftBadge ? (
        <span
          style={{
            position: "absolute",
            bottom: badgeInset,
            left: badgeInset,
            zIndex: 3,
          }}
        >
          {bottomLeftBadge}
        </span>
      ) : null}
      {bottomRightBadge ? (
        <span
          style={{
            position: "absolute",
            bottom: badgeInset,
            right: badgeInset,
            zIndex: 3,
          }}
        >
          {bottomRightBadge}
        </span>
      ) : null}
    </>
  ) : null;

  // EJ57 — Selection ring as an absolute child of the wrapper.
  // Matches the constellation hero card's EJ27 pattern: positioned
  // at inset:-2, borderRadius derives from the deck's stored
  // corner_radius_percent (resolved per-card by CardImage via the
  // deckId prop) so each card's ring radius matches its alpha-
  // mask silhouette. zIndex below badges (3) but above the IMG.
  // EJ61 — Replaced `box-shadow: 0 0 0 2px <color>` with
  // `background: <color>`. The hero ring in ConstellationWeb.tsx
  // EJ27 is explicit: "NO box-shadow glow (the glow was extending
  // visibly past the card's bottom and corners)." Box-shadow with
  // 2px spread adds 2 extra px OUTSIDE the span's box, on top of
  // the span's own inset:-2 offset — net ring sits 4px past the
  // wrapper instead of 2px. Background fill produces a solid
  // colored span at the correct -2 outset; the IMG covers most of
  // the span, and the visible 2px border is the span's bg showing
  // through. Matches hero pattern exactly. zIndex 0 so the IMG
  // (at z-auto in the wrapper line) renders ON TOP of the ring
  // and the ring shows only as the 2px border around the IMG.
  const selectionRing =
    selected ? (
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: -2,
          left: -2,
          right: -2,
          bottom: -2,
          borderRadius: selectionRingRadius,
          background: selectionRingColor,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
    ) : null;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? (typeof cardId === "number" ? resolvedName : "Card")}
        className={className}
        style={{
          ...wrapperStyle,
          padding: 0,
          border: 0,
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {/* EJ64 — Wrap inner in a positioned z-index:1 span so the
            IMG paints ABOVE the selection ring (z-index:0). EJ62
            relied on DOM order, but CSS stacking puts positioned
            elements with explicit z-index ABOVE non-positioned
            in-flow content regardless of DOM order — the ring at
            z-index:0 was painting on top of the IMG and hiding it.
            Matches the constellation hero pattern in
            ConstellationWeb.tsx where the image-clip span has
            position: relative; z-index: 1. */}
        {selectionRing}
        <span style={{ position: "relative", zIndex: 1, display: "block" }}>
          {inner}
        </span>
        {badgeNodes}
      </button>
    );
  }

  return (
    <div className={className} style={wrapperStyle} aria-label={ariaLabel}>
      {/* EJ64 — same ordering and z-index pattern as the button branch. */}
      {selectionRing}
      <span style={{ position: "relative", zIndex: 1, display: "block" }}>
        {inner}
      </span>
      {badgeNodes}
    </div>
  );
}
