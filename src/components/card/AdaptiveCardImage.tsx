import { useState, type CSSProperties } from "react";

/**
 * 9-6-T — Lean card image renderer.
 * Width is fixed by parent; height adapts to natural aspect of source.
 * Always uses object-contain so card art is NEVER cropped.
 * Empty space is transparent so parent surface shows through.
 */
export function AdaptiveCardImage({
  src,
  alt,
  className,
  style,
  onClick,
  fallbackAspect = 1.6,
  reversed = false,
  borderRadius,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  fallbackAspect?: number;
  reversed?: boolean;
  borderRadius?: string | number;
}) {
  const [aspect, setAspect] = useState<number>(fallbackAspect);
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        width: "100%",
        aspectRatio: `1 / ${aspect}`,
        overflow: "hidden",
        borderRadius,
        ...style,
      }}
    >
      {src && (
        <img
          src={src}
          alt={alt ?? ""}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setAspect(img.naturalHeight / img.naturalWidth);
            }
          }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            transform: reversed ? "rotate(180deg)" : undefined,
          }}
          draggable={false}
        />
      )}
    </div>
  );
}