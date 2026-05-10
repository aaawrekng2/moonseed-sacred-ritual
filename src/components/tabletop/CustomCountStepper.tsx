/**
 * 26-05-08-Q18 — Custom-spread card-count stepper.
 *
 * Centered chevron stepper: ‹  N cards  ›. Only rendered for the
 * "custom" spread; non-custom spreads have a fixed count.
 */
import { forwardRef } from "react";
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
  const isMobile =
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 640px)").matches
      : false;
  const dec = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(Math.max(min, count - 1));
  };
  const inc = (e: React.MouseEvent) => {
    e.stopPropagation();
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
        gap: isMobile ? 8 : 16,
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
        onClick={dec}
        disabled={count <= min}
        aria-label="Fewer cards"
        data-no-peek=""
        style={{
          background: "none",
          border: "none",
          padding: isMobile ? 4 : 6,
          color: "inherit",
          opacity: count <= min ? 0.3 : 1,
          cursor: count <= min ? "not-allowed" : "pointer",
          display: "inline-flex",
        }}
      >
        <ChevronLeft size={18} aria-hidden="true" style={{ pointerEvents: "none" }} />
      </button>
      <span style={{ minWidth: 80, textAlign: "center" }}>
        {count} card{count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={count >= max}
        aria-label="More cards"
        data-no-peek=""
        style={{
          background: "none",
          border: "none",
          padding: isMobile ? 4 : 6,
          color: "inherit",
          opacity: count >= max ? 0.3 : 1,
          cursor: count >= max ? "not-allowed" : "pointer",
          display: "inline-flex",
        }}
      >
        <ChevronRight size={18} aria-hidden="true" style={{ pointerEvents: "none" }} />
      </button>
    </div>
  );
},
);