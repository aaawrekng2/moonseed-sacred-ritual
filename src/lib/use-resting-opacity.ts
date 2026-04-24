import { useEffect, useState, useCallback } from "react";

export const DEFAULT_RESTING_OPACITY = 50;
export const MIN_RESTING_OPACITY = 25;
export const MAX_RESTING_OPACITY = 100;

const STORAGE_KEY = "moonseed:resting-opacity";
const EVENT = "arcana:resting-opacity-changed";

export function useRestingOpacity() {
  const [opacity, setOpacityState] = useState<number>(DEFAULT_RESTING_OPACITY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : DEFAULT_RESTING_OPACITY;
    const clamped = Math.min(
      MAX_RESTING_OPACITY,
      Math.max(MIN_RESTING_OPACITY, Number.isFinite(n) ? n : DEFAULT_RESTING_OPACITY),
    );
    setOpacityState(clamped);
    setLoaded(true);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === "number") setOpacityState(detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const setOpacity = useCallback((n: number) => {
    const clamped = Math.min(MAX_RESTING_OPACITY, Math.max(MIN_RESTING_OPACITY, n));
    setOpacityState(clamped);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(clamped));
      window.dispatchEvent(new CustomEvent(EVENT, { detail: clamped }));
    }
  }, []);

  return { opacity, setOpacity, loaded };
}