import { useCallback, useEffect, useLayoutEffect, useState } from "react";

const EVENT = "arcana:resting-opacity-changed";
export const DEFAULT_RESTING_OPACITY = 100;
export const MIN_RESTING_OPACITY = 25;
export const MAX_RESTING_OPACITY = 100;
const STORAGE_KEY = "tarotseed:resting-opacity";

function clamp(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_RESTING_OPACITY;
  return Math.max(MIN_RESTING_OPACITY, Math.min(MAX_RESTING_OPACITY, Math.round(n)));
}

function emit(value: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: value }));
}

/**
 * Write the current resting opacity value to the global CSS variable
 * so every component that consumes `var(--ro-plus-N)` updates instantly
 * without having to subscribe to the React hook.
 */
function writeCssVar(percentage: number) {
  if (typeof document === "undefined") return;
  const fraction = Math.max(0, Math.min(1, percentage / 100));
  document.documentElement.style.setProperty(
    "--resting-opacity",
    String(fraction),
  );
}

export function useRestingOpacity() {
  // IMPORTANT: do NOT read localStorage during initial state — that runs only
  // on the client and produces a different value than the server-rendered
  // HTML, causing a hydration mismatch. Instead, start from the default
  // (matching the server) and sync from localStorage in an effect.
  const [value, setValue] = useState<number>(DEFAULT_RESTING_OPACITY);
  const [loaded, setLoaded] = useState(false);

  // Single source of truth: read localStorage and write the CSS variable
  // BEFORE first paint via useLayoutEffect. This guarantees every consumer
  // (TopRightControls icons, settings sliders, the readout) agrees on the
  // same value on the first render after hydration — no fade-in flicker
  // when navigating between routes.
  useLayoutEffect(() => {
    if (typeof window !== "undefined") {
      const initial = DEFAULT_RESTING_OPACITY;
      setValue(initial);
      writeCssVar(initial);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === "number") {
        const next = clamp(detail);
        setValue(next);
        writeCssVar(next);
      }
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const setOpacity = useCallback((next: number) => {
    const clamped = clamp(next);
    setValue(clamped);
    emit(clamped);
    writeCssVar(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }, []);

  return { opacity: value, loaded, setOpacity };
}

/**
 * Briefly override the resting opacity value without persisting it. Used by
 * the global "tap-to-peek" behavior so the user can momentarily see hidden
 * UI without flipping their saved preference. Returns a restore function
 * that resets the value to whatever is in localStorage.
 */
export function peekRestingOpacity(targetPct: number) {
  if (typeof window === "undefined") return () => {};
  const restore = DEFAULT_RESTING_OPACITY;
  emit(clamp(targetPct));
  return (transitionMs = 0) => {
    if (transitionMs > 0 && typeof document !== "undefined") {
      // Best-effort smooth fade: animate the React-state-driven values via a
      // short rAF loop. CSS-var consumers will re-flow each tick.
      const startTs = performance.now();
      const startVal = clamp(targetPct);
      const endVal = restore;
      const tick = (now: number) => {
        const t = Math.min(1, (now - startTs) / transitionMs);
        const v = startVal + (endVal - startVal) * t;
        emit(clamp(v));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      emit(restore);
    }
  };
}
