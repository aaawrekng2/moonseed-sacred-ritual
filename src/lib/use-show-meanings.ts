import { useEffect, useState } from "react";

/**
 * v3.57 — Persisted preference for whether each revealed card shows its
 * position name + meaning underneath the card name on the draw/flip table.
 * Defaults to OFF. Mirrors use-show-labels' module-level subscriber pattern
 * so the toggle (in the page menu) and the consumers (SpreadLayout) stay in
 * sync without a context provider.
 */
const STORAGE_KEY = "tarotseed:show-card-meanings";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<(v: boolean) => void>();
let current = readInitial();

export function useShowMeanings(): {
  showMeanings: boolean;
  setShowMeanings: (v: boolean) => void;
  toggleShowMeanings: () => void;
} {
  const [showMeanings, setLocal] = useState(current);

  useEffect(() => {
    const sub = (v: boolean) => setLocal(v);
    listeners.add(sub);
    setLocal(current);
    return () => {
      listeners.delete(sub);
    };
  }, []);

  const setShowMeanings = (v: boolean) => {
    current = v;
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
      window.dispatchEvent(
        new CustomEvent<boolean>("tarotseed:show-meanings-changed", {
          detail: v,
        }),
      );
    } catch {
      /* ignore storage errors */
    }
    listeners.forEach((l) => l(v));
  };

  return {
    showMeanings,
    setShowMeanings,
    toggleShowMeanings: () => setShowMeanings(!current),
  };
}
