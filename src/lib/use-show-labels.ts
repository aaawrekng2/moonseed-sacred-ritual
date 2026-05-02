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
  // DK-3 — Mobile never shows position labels regardless of stored
  // preference. The bottom-bar whisper still names the focused position
  // so seekers retain the info without label clutter under cards.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" && window.innerWidth < 768,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

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
      window.dispatchEvent(
        new CustomEvent<boolean>("moonseed:show-labels-changed", { detail: v }),
      );
    } catch {
      /* ignore storage errors */
    }
    listeners.forEach((l) => l(v));
  };

  // DL-2 — Position labels are hidden on every device. The bottom-bar
  // whisper still names the focused position so seekers don't lose the
  // context. The setter and toggle remain so settings UI continues to
  // function without runtime errors, but the returned `showLabels` is
  // always false.
  void showLabels;
  void isMobile;
  return {
    showLabels: false,
    setShowLabels,
    toggleShowLabels: () => setShowLabels(!current),
  };
}

/**
 * Briefly force labels ON without writing to localStorage. Used by the
 * global tap-to-peek behavior so a tap on empty space momentarily reveals
 * spread labels regardless of the saved preference. Returns a restore
 * function that re-broadcasts the persisted value to all subscribers.
 */
export function peekShowLabels(): () => void {
  if (typeof window === "undefined") return () => {};
  // Push true to all subscribers without touching `current` so the
  // saved preference is untouched.
  listeners.forEach((l) => l(true));
  try {
    window.dispatchEvent(
      new CustomEvent<boolean>("moonseed:show-labels-changed", { detail: true }),
    );
  } catch {
    /* ignore */
  }
  return () => {
    listeners.forEach((l) => l(current));
    try {
      window.dispatchEvent(
        new CustomEvent<boolean>("moonseed:show-labels-changed", {
          detail: current,
        }),
      );
    } catch {
      /* ignore */
    }
  };
}