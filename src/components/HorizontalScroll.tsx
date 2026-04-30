/**
 * HorizontalScroll — reusable horizontal scroll affordance (Stamp BO).
 *
 * Wraps a horizontally-scrollable row with edge gradient fades and
 * small chevron buttons that appear only when there's more content
 * in that direction. Tap a chevron to scroll by ~80% of the visible
 * width. Matches the iOS / Spotify / Material Design pattern.
 *
 * Pass `fadeColor` to match whatever background sits behind the
 * scroll (defaults to --color-background; use --surface-card when
 * the row lives inside a card).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HorizontalScrollProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** CSS color for the edge fade. Use the same color as the surface
   *  behind the row. Defaults to `var(--color-background)`. */
  fadeColor?: string;
}

export function HorizontalScroll({
  children,
  className,
  contentClassName,
  fadeColor = "var(--color-background)",
}: HorizontalScrollProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateAffordance = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    setCanScrollLeft(scrollLeft > 1);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useLayoutEffect(() => {
    updateAffordance();
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateAffordance);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateAffordance());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [updateAffordance]);

  const scrollByFrac = useCallback((frac: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: el.clientWidth * frac, behavior: "smooth" });
  }, []);

  return (
    <div className={cn("relative", className)}>
      {canScrollLeft && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 32,
              pointerEvents: "none",
              background: `linear-gradient(to right, ${fadeColor}, transparent)`,
              zIndex: 1,
            }}
          />
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scrollByFrac(-0.8)}
            style={{
              position: "absolute",
              left: 4,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 2,
              width: 24,
              height: 24,
              borderRadius: 9999,
              background: "var(--surface-card)",
              opacity: 0.85,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={16} style={{ color: "var(--color-foreground)", opacity: 0.7 }} />
          </button>
        </>
      )}
      <div
        ref={scrollRef}
        className={cn("horizontal-scroll-content flex flex-row overflow-x-auto", contentClassName)}
        style={{ scrollbarWidth: "none", scrollBehavior: "smooth" }}
      >
        {children}
      </div>
      {canScrollRight && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 32,
              pointerEvents: "none",
              background: `linear-gradient(to left, ${fadeColor}, transparent)`,
              zIndex: 1,
            }}
          />
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scrollByFrac(0.8)}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 2,
              width: 24,
              height: 24,
              borderRadius: 9999,
              background: "var(--surface-card)",
              opacity: 0.85,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <ChevronRight size={16} style={{ color: "var(--color-foreground)", opacity: 0.7 }} />
          </button>
        </>
      )}
    </div>
  );
}