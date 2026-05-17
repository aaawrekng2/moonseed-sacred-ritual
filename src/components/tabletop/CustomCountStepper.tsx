/**
 * 26-05-08-Q18 — Custom-spread card-count stepper.
 *
 * Centered chevron stepper: ‹  N cards  ›. Only rendered for the
 * "custom" spread; non-custom spreads have a fixed count.
 */
import { forwardRef, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  count: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
};

export const CustomCountStepper = forwardRef<HTMLDivElement, Props>(
  function CustomCountStepper({ count, onChange, min = 1, max = 10 }, ref) {
  // Q20 Fix 5 — tighter chevron spacing on mobile.
  // Q33b Fix 1 — reactive isMobile to avoid SSR mismatch + stale resize values.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const dec = (_e: React.MouseEvent) => {
    if (count <= min) return;
    onChange(Math.max(min, count - 1));
  };
  const inc = (_e: React.MouseEvent) => {
    if (count >= max) return;
    onChange(Math.min(max, count + 1));
  };
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Card count"
      data-no-peek=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? 0 : 2,
        fontFamily: "var(--font-display, var(--font-serif))",
        fontStyle: "italic",
        fontSize: "var(--text-body-lg, 1.05rem)",
        color: "var(--accent, var(--gold))",
        opacity: 0.85,
        padding: "8px 0",
      }}
    >
      <button
        type="button"
        onPointerUp={(e) => {
          e.preventDefault();
          dec(e as unknown as React.MouseEvent);
        }}
        disabled={count <= min}
        aria-label="Fewer cards"
        data-no-peek=""
        style={{
          background: "none",
          border: "none",
          padding: isMobile ? 12 : 6,
          minWidth: isMobile ? 44 : undefined,
          minHeight: isMobile ? 44 : undefined,
          color: "inherit",
          opacity: count <= min ? 0.3 : 1,
          cursor: count <= min ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "manipulation",
        }}
      >
        <ChevronLeft size={18} aria-hidden="true" style={{ pointerEvents: "none" }} />
      </button>
      <span style={{ minWidth: 56, textAlign: "center", paddingInline: 4 }}>
        {count} card{count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onPointerUp={(e) => {
          e.preventDefault();
          inc(e as unknown as React.MouseEvent);
        }}
        disabled={count >= max}
        aria-label="More cards"
        data-no-peek=""
        style={{
          background: "none",
          border: "none",
          padding: isMobile ? 12 : 6,
          minWidth: isMobile ? 44 : undefined,
          minHeight: isMobile ? 44 : undefined,
          color: "inherit",
          opacity: count >= max ? 0.3 : 1,
          cursor: count >= max ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "manipulation",
        }}
      >
        <ChevronRight size={18} aria-hidden="true" style={{ pointerEvents: "none" }} />
      </button>
    </div>
  );
},
);