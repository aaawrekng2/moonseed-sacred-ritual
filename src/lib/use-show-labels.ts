import { useEffect, useState } from "react";

/**
 * Persisted preference for whether spread position labels (Past/Present/
 * Future, Celtic Cross positions, etc.) are shown across the draw flow.
 * Defaults to ON — annotated view is the friendlier first impression.
 */
const STORAGE_KEY = "moonseed:show-spread-labels";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

// Module-level subscribers so multiple components stay in sync without a
// context provider (the toggle and consumers may live in different trees).
const listeners = new Set<(v: boolean) => void>();
let current = readInitial();

export function useShowLabels(): {
  showLabels: boolean;
  setShowLabels: (v: boolean) => void;
  toggleShowLabels: () => void;
} {
  const [showLabels, setLocal] = useState(current);

  useEffect(() => {
    const sub = (v: boolean) => setLocal(v);
    listeners.add(sub);
    // Resync in case current changed before mount.
    setLocal(current);
    return () => {
      listeners.delete(sub);
    };
  }, []);

  const setShowLabels = (v: boolean) => {
    current = v;
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore storage errors */
    }
    listeners.forEach((l) => l(v));
  };

  return {
    showLabels,
    setShowLabels,
    toggleShowLabels: () => setShowLabels(!current),
  };
}