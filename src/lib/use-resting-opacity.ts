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

export function useRestingOpacity() {
  const [value, setValue] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_RESTING_OPACITY;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? clamp(Number(stored)) : DEFAULT_RESTING_OPACITY;
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === "number") setValue(clamp(detail));
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const setOpacity = useCallback((next: number) => {
    const clamped = clamp(next);
    setValue(clamped);
    emit(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }, []);

  return { opacity: value, loaded, setOpacity };
}
