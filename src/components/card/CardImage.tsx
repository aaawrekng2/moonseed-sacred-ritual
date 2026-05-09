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
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CardBack } from "@/components/cards/CardBack";
import {
  useActiveCardBackUrl,
  useActiveDeckCardAspect,
  useActiveDeckCardName,
  useActiveDeckCornerRadius,
  useActiveDeckImage,
  useDeckCardName,
  useDeckCornerRadius,
  useDeckImage,
  variantUrlFor,
  variantUrlPngFallback,
} from "@/lib/active-deck";
import type { CardBackId } from "@/lib/card-backs";

/**
 * EX-4 — Read the dev-mode flag from localStorage and subscribe to
 * the same custom event used by DevOverlay so toggling reflects
 * immediately without a page refresh.
 */
function useDevMode(): boolean {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("moonseed:dev_mode") === "true";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () =>
      window.localStorage.getItem("moonseed:dev_mode") === "true";
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOn(typeof detail === "boolean" ? detail : read());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "moonseed:dev_mode") setOn(read());
    };
    window.addEventListener("moonseed:dev-mode-changed", handler);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("moonseed:dev-mode-changed", handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return on;
}

export type CardImageSize = "hero" | "medium" | "thumbnail" | "small" | "custom";
export type CardImageVariant = "face" | "back" | "empty";

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
}

// Standard widths in px. Aspect ratio 1 / 1.75.
const SIZE_PX: Record<Exclude<CardImageSize, "custom">, number> = {
  hero: 320,
  medium: 180,
  thumbnail: 74,
  small: 40,
};

// EZ-7 — Pick the lightest variant that still meets the rendered size.
const SIZE_TO_VARIANT: Record<CardImageSize, "sm" | "md" | "full"> = {
  small: "sm",      // 40px target → 200px sm is plenty
  thumbnail: "sm",  // 74px target → sm
  medium: "md",     // 180px target → 400px md
  hero: "full",     // 320px target → original
  custom: "md",     // safe default for unknown sizes
};

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
  const customBackUrl = useActiveCardBackUrl();
  const [imageLoaded, setImageLoaded] = useState(false);
  // 26-05-08-Q2 — Fix 8: dropped the .png fallback step. Architecture
  // uploads ONLY .webp variants, so the .png attempt always 404s and
  // adds noise. Ladder is now: variant.webp → display.webp → placeholder.
  // `null` = trying the .webp variant. `"all"` = variant failed, fall
  // back to base displayUrl directly.
  const [variantFailedFor, setVariantFailedFor] = useState<
    null | "all"
  >(null);
  const devMode = useDevMode();

  // FC-1 / 9-6-V — Track BOTH face and back natural aspects so the
  // flip wrapper matches whichever side is currently showing. Without
  // this, a back image with a different aspect than the face will
  // letterbox inside the wrapper.
  // 9-6-Y — seed face aspect from the deck-image cache so the wrapper
  // renders at the correct height on FIRST PAINT.
  const cachedFaceAspect = useActiveDeckCardAspect(
    typeof cardId === "number" ? cardId : null,
  );
  const [faceAspect, setFaceAspect] = useState<number | null>(
    cachedFaceAspect,
  );
  const [backAspect, setBackAspect] = useState<number | null>(null);

  useEffect(() => {
    setFaceAspect(cachedFaceAspect);
    setBackAspect(null);
    setImageLoaded(false);
    setVariantFailedFor(null);
  }, [cardId, deckId, cachedFaceAspect]);

  // EY-1 — Saturated diagnostic colors. The card art still
  // shows through the IMG layer at 50% opacity; everything else
  // is fully opaque so layer geometry is unambiguous.
  const DEV_WRAPPER_BG = devMode ? "#00FF00" : undefined; // green
  const DEV_IMG_TINT_BG = devMode ? "rgba(255, 0, 0, 0.5)" : undefined; // red 50%
  const DEV_BACK_OUTLINE = devMode ? "3px solid #FF4F00" : undefined; // international orange
  const DEV_EMPTY_BG = devMode ? "#FFFF00" : undefined; // yellow
  const DEV_LOADING_OUTLINE = devMode ? "3px solid #FF00FF" : undefined; // magenta

  const useSpecific = deckId != null && deckId !== "";
  const deckRadius = useSpecific ? specificRadius : activeRadius;
  // 26-05-08-P — Fix 5: prefer per-deck card_name overrides for the
  // accessible label so oracle decks announce "The Awakening" instead
  // of the synthetic "Card 1005".
  const resolvedName =
    typeof cardId === "number"
      ? useSpecific
        ? specificNameResolve(cardId)
        : activeNameResolve(cardId)
      : "";

  const width = resolveWidth(size, widthPx);
  const radiusStyle: CSSProperties = {};
  void deckRadius;

  // EY-2 — No hardcoded aspect ratio. The IMG sources its own
  // natural dimensions; the wrapper hugs the IMG. This means the
  // rounded corner sits at the actual card edge, not at letterbox
  // space that resulted from forcing 1/1.75 onto images with
  // different natural proportions. minHeight reserves space before
  // IMG loads so shimmer / placeholder has a visible footprint;
  // once the IMG loads, its height auto-derives and overrides this.
  const wrapperStyle: CSSProperties = {
    width,
    minHeight: width * 1.6,
    position: "relative",
    // EZ-4 — When a drop shadow is requested we cannot clip the
    // wrapper (overflow: hidden would cut the shadow off). The IMG
    // and overlays still inherit the same border-radius, so the
    // visible card shape stays correctly rounded; the shadow now
    // renders outside that silhouette via filter: drop-shadow().
    overflow: shadow ? "visible" : "hidden",
    display: "inline-block",
    ...radiusStyle,
    // FA-3 — tighter shadow: less blur, slightly more opacity.
    // More grounded, less halo.
    ...(shadow
      ? { filter: "drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35))" }
      : null),
    // EZ-3 — Wrapper green as outline so it's visible as a ring
    // around the actual card boundary (the wrapper hugs the IMG
    // per EY-2, so a background fill would be invisible).
    ...(DEV_WRAPPER_BG
      ? { outline: `3px solid ${DEV_WRAPPER_BG}`, outlineOffset: -3 }
      : null),
    ...(style ?? {}),
  };

  // Image src — `useDeckImage(deckId)` may return null while the
  // specific deck's image map is still loading; fall back to the
  // active deck resolver only when no `deckId` was supplied.
  const baseFaceSrc =
    typeof cardId === "number"
      ? useSpecific
        ? specificResolve(cardId)
        : activeResolve(cardId)
      : null;
  // EZ-7 — Use a smaller variant when one would suffice for the
  // rendered size. If the variant URL later 404s, onError flips
  // variantFailedFor and we re-render with the original.
  const variantTier = SIZE_TO_VARIANT[size];
  const variantSrc = variantUrlFor(baseFaceSrc, variantTier);
  const faceSrc = variantFailedFor === "all" ? baseFaceSrc : variantSrc;

  const showFaceShimmer =
    variant === "face" && !loading && (faceSrc == null || !imageLoaded);

  // 26-05-08-M — Fix 5: when every variant URL has failed AND the
  // base src looks like an expired signed URL (token=…), render a
  // named placeholder instead of leaving a broken <img>. Common
  // during background processing right after import.
  const allFailed =
    variant === "face" &&
    variantFailedFor === "all" &&
    (!baseFaceSrc || baseFaceSrc.includes("token="));

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
      ? (faceAspect ?? backAspect ?? 1.6)
      : (backAspect ?? faceAspect ?? 1.6);
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
              onAspectMeasured={(a) => setBackAspect(a)}
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
          <div
            className="flip-face front"
            style={{ ...radiusStyle, overflow: "hidden" }}
          >
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
                    setFaceAspect(img.naturalHeight / img.naturalWidth);
                  }
                  setImageLoaded(true);
                }}
                onError={() => {
                  // 26-05-08-Q2 — Fix 8: variant.webp → base displayUrl.
                  if (
                    variantFailedFor !== "all" &&
                    baseFaceSrc &&
                    faceSrc !== baseFaceSrc
                  ) {
                    setVariantFailedFor("all");
                  } else {
                    setImageLoaded(true);
                  }
                }}
                style={{
                  // FC-1 — wrapper sized to match IMG's natural
                  // aspect, so 100%/100% fits with no letterbox.
                  width: "100%",
                  height: "100%",
                  display: "block",
                  opacity: imageLoaded ? 1 : 0,
                  transform: reversed ? "rotate(180deg)" : undefined,
                  transition: "opacity 300ms ease-out",
                  ...radiusStyle,
                }}
              />
            ) : null}
            {DEV_IMG_TINT_BG && imageLoaded ? (
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
            background:
              "color-mix(in oklab, var(--gold) 6%, transparent)",
            ...radiusStyle,
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
                fontSize: "var(--text-caption, 0.7rem)",
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
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              // 26-05-08-Q2 — Fix 8: variant.webp → base displayUrl.
              if (
                variantFailedFor !== "all" &&
                baseFaceSrc &&
                faceSrc !== baseFaceSrc
              ) {
                setVariantFailedFor("all");
              } else {
                setImageLoaded(true);
              }
            }}
            style={{
              // EY-2 — width matches wrapper; height auto-derives
              // from the image's natural aspect.
              width: "100%",
              height: "auto",
              display: "block",
              opacity: imageLoaded ? 1 : 0,
              transform: reversed ? "rotate(180deg)" : undefined,
              transition: "opacity 300ms ease-out",
              ...radiusStyle,
            }}
          />
          )}
          {/* EZ-3 — Dev-mode tint as sibling overlay so it's visible
              over the opaque card art (backgroundColor on an opaque
              IMG renders behind the pixels and is therefore invisible). */}
          {DEV_IMG_TINT_BG && imageLoaded ? (
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
            background:
              DEV_EMPTY_BG ?? "color-mix(in oklab, var(--gold) 6%, transparent)",
            ...radiusStyle,
          }}
        />
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={
          ariaLabel ?? (typeof cardId === "number" ? resolvedName : "Card")
        }
        className={className}
        style={{
          ...wrapperStyle,
          padding: 0,
          border: 0,
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={className}
      style={wrapperStyle}
      aria-label={ariaLabel}
    >
      {inner}
    </div>
  );
}