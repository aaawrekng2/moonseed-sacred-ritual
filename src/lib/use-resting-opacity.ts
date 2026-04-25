import { useCallback, useEffect, useState } from "react";

const EVENT = "arcana:resting-opacity-changed";
export const DEFAULT_RESTING_OPACITY = 50;
export const MIN_RESTING_OPACITY = 25;
export const MAX_RESTING_OPACITY = 100;
const STORAGE_KEY = "moonseed:resting-opacity";

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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      const initial = stored != null ? clamp(Number(stored)) : DEFAULT_RESTING_OPACITY;
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
