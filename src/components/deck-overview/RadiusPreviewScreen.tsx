/**
 * 9-6-AH continuation — Radius preview screen.
 *
 * Rendered after the zip has been extracted and matched, but BEFORE the
 * save loop runs. The user swipes through up to 5 real matched cards
 * and adjusts the corner radius live (CSS-only). On commit we save with
 * the chosen radius. On skip we save with the deck's existing default.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type RadiusPreviewItem = {
  /** Inline thumbnail (data URL) extracted from the asset. */
  thumbnailDataUrl: string;
  /** 26-05-08-K — full-resolution data URL for sharp preview. */
  fullDataUrl?: string;
  /** Friendly card label, e.g. "The Fool" or filename. */
  cardName: string;
};

export function RadiusPreviewScreen({
  items,
  initialRadius,
  shape,
  onCommit,
  onSkip,
  onCancel,
}: {
  items: RadiusPreviewItem[];
  initialRadius: number;
  shape: "rectangle" | "round";
  onCommit: (radius: number) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [radius, setRadius] = useState(initialRadius);
  const [index, setIndex] = useState(0);
  const current = items[index];
  // 26-05-08-K — prefer the sharp full-res data URL when available.
  const previewSrc = current?.fullDataUrl || current?.thumbnailDataUrl || "";
  // 26-05-08-J — Fix 1: percent border-radius produces ELLIPTICAL
  // corners on a non-square element. Measure the rendered image's
  // smaller dimension and convert to a pixel radius so the preview
  // matches the CIRCULAR corner the edge function bakes in.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = imgRef.current ?? placeholderRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setMeasured({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, current?.thumbnailDataUrl, shape]);

  const radiusStyle = useMemo<React.CSSProperties>(() => {
    if (shape === "round") return { borderRadius: "50%" };
    if (!measured) return { borderRadius: `${radius}px` };
    const px = Math.round((Math.min(measured.w, measured.h) * radius) / 100);
    return { borderRadius: `${px}px` };
  }, [radius, shape, measured]);

  return (
    <div
      role="dialog"
      aria-label="Set card corner radius"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-5, 20px)",
        overflowY: "auto",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-4, 16px)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md, 22px)",
          }}
        >
          Set your card corner radius
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel import"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-foreground)",
            opacity: 0.6,
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={20} />
        </button>
      </header>

      <p
        style={{
          margin: "0 0 var(--space-5, 20px)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.65,
        }}
      >
        Swipe through your cards to see how the radius looks on each.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-3, 12px)",
          marginBottom: "var(--space-3, 12px)",
        }}
      >
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous card"
          style={navBtnStyle(index === 0)}
        >
          <ChevronLeft size={20} />
        </button>

        {previewSrc ? (
          <img
            ref={imgRef}
            src={previewSrc}
            alt={current.cardName}
            style={{
              width: "min(60vw, 240px)",
              height: "auto",
              objectFit: "contain",
              boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
              ...radiusStyle,
            }}
            onLoad={(e) => {
              const img = e.currentTarget;
              setMeasured({ w: img.clientWidth, h: img.clientHeight });
            }}
          />
        ) : (
          <div
            ref={placeholderRef}
            style={{
              width: "min(60vw, 240px)",
              aspectRatio: shape === "round" ? "1 / 1" : "5 / 8",
              background: "var(--surface-card, rgba(255,255,255,0.05))",
              ...radiusStyle,
            }}
          />
        )}

        <button
          type="button"
          onClick={() =>
            setIndex((i) => Math.min(items.length - 1, i + 1))
          }
          disabled={index >= items.length - 1}
          aria-label="Next card"
          style={navBtnStyle(index >= items.length - 1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <p
        style={{
          margin: "0 0 var(--space-4, 16px)",
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground)",
          opacity: 0.65,
        }}
      >
        {current?.cardName} · {items.length === 0 ? 0 : index + 1} of{" "}
        {items.length}
      </p>

      {shape === "rectangle" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3, 12px)",
            marginBottom: "var(--space-5, 20px)",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.6,
            }}
          >
            0%
          </span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label="Corner radius percent"
          />
          <span
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: 500,
              minWidth: 36,
              textAlign: "right",
            }}
          >
            {radius}%
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3, 12px)",
          marginTop: "auto",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={textBtnStyle}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSkip}
          style={textBtnStyle}
        >
          Skip — use default
        </button>
        <button
          type="button"
          onClick={() => onCommit(radius)}
          style={{
            padding: "var(--space-2, 8px) var(--space-5, 20px)",
            borderRadius: "var(--radius-md, 10px)",
            border: "1px solid var(--accent, var(--gold))",
            background: "rgba(212,175,90,0.12)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            cursor: "pointer",
          }}
        >
          Looks good, import
        </button>
      </div>
    </div>
  );
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid var(--border-subtle, rgba(255,255,255,0.12))",
    color: "var(--color-foreground)",
    borderRadius: "50%",
    width: 36,
    height: 36,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.3 : 0.85,
  };
}

const textBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-foreground)",
  opacity: 0.7,
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  textDecoration: "underline",
  cursor: "pointer",
  padding: 4,
};