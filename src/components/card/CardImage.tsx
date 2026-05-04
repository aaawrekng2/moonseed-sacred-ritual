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
  cornerRadiusStyle,
  useActiveCardBackUrl,
  useActiveDeckCornerRadius,
  useActiveDeckImage,
  useDeckCornerRadius,
  useDeckImage,
} from "@/lib/active-deck";
import type { CardBackId } from "@/lib/card-backs";
import { getCardName } from "@/lib/tarot";

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
}

// Standard widths in px. Aspect ratio 1 / 1.75.
const SIZE_PX: Record<Exclude<CardImageSize, "custom">, number> = {
  hero: 320,
  medium: 180,
  thumbnail: 74,
  small: 40,
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
}: CardImageProps) {
  // Resolve image source + radius from active deck OR a specific deck
  // when `deckId` is supplied. Both hooks are always called (Rules of
  // Hooks), and we pick which to use per render.
  const activeResolve = useActiveDeckImage();
  const activeRadius = useActiveDeckCornerRadius();
  const specificResolve = useDeckImage(deckId ?? null);
  const specificRadius = useDeckCornerRadius(deckId ?? null);
  const customBackUrl = useActiveCardBackUrl();
  const [imageLoaded, setImageLoaded] = useState(false);
  const devMode = useDevMode();

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

  const width = resolveWidth(size, widthPx);
  const radiusStyle = cornerRadiusStyle(deckRadius, width);

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
    overflow: "hidden",
    display: "inline-block",
    ...radiusStyle,
    ...(DEV_WRAPPER_BG ? { background: DEV_WRAPPER_BG } : null),
    ...(style ?? {}),
  };

  // Image src — `useDeckImage(deckId)` may return null while the
  // specific deck's image map is still loading; fall back to the
  // active deck resolver only when no `deckId` was supplied.
  const faceSrc =
    typeof cardId === "number"
      ? useSpecific
        ? specificResolve(cardId)
        : activeResolve(cardId)
      : null;

  const showFaceShimmer =
    variant === "face" && !loading && (faceSrc == null || !imageLoaded);

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
        <img
          src={faceSrc}
          alt={ariaLabel ?? getCardName(cardId)}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          style={{
            // EY-2 — width matches wrapper; height auto-derives
            // from the image's natural aspect. No objectFit
            // letterboxing — the IMG IS the box.
            width: "100%",
            height: "auto",
            display: "block",
            opacity: imageLoaded ? 1 : 0,
            transform: reversed ? "rotate(180deg)" : undefined,
            transition: "opacity 300ms ease-out",
            ...radiusStyle,
            ...(DEV_IMG_TINT_BG ? { backgroundColor: DEV_IMG_TINT_BG } : null),
          }}
        />
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
          ariaLabel ?? (typeof cardId === "number" ? getCardName(cardId) : "Card")
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