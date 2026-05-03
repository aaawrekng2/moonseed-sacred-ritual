import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * EB-1 — Returns the current measured width of `ref.current` in
 * pixels. Initial value is 0 until the element mounts; updates on
 * resize via ResizeObserver. Used by card-rendering sites to feed
 * cornerRadiusStyle(percent, widthPx) for true circular corners.
 */
export function useElementWidth<T extends HTMLElement = HTMLElement>(): {
  ref: RefObject<T | null>;
  width: number;
} {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}