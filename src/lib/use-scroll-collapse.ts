import { useEffect, useState } from "react";

/**
 * FU-8 — iOS large-to-compact title collapse driver.
 *
 * Watches a scroll container and returns a progress value 0–1 representing
 * how far through the collapse the user has scrolled. 0 = at rest (large
 * title visible). 1 = fully scrolled (compact title fully visible).
 *
 * Pass null/undefined ref to use window scroll instead.
 */
export function useScrollCollapse(
  scrollRef?: React.RefObject<HTMLElement | null>,
  threshold = 40,
): number {
  const [progress, setProgress] = useState(0);
  // Q60 Fix 8 — track scrollRef.current changes so the effect re-binds
  // when the target element mounts after an early-return branch
  // (e.g. Numerology's birthDate empty-state). Without this, the
  // effect would bind to window scroll on first render and never
  // rebind to the real <main> once it mounts.
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const next = scrollRef?.current ?? null;
    setEl((prev) => (prev === next ? prev : next));
  });

  useEffect(() => {
    const target = el;
    const getScrollTop = () =>
      target
        ? target.scrollTop
        : (window.scrollY ?? document.documentElement.scrollTop ?? 0);

    const handler = () => {
      const sy = getScrollTop();
      setProgress(Math.max(0, Math.min(1, sy / threshold)));
    };

    handler();

    if (target) {
      target.addEventListener("scroll", handler, { passive: true });
      return () => target.removeEventListener("scroll", handler);
    }
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [el, threshold]);

  return progress;
}