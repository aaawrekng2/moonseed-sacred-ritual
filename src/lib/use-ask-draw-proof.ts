/**
 * EK03 — Persisted preference for whether the draw table asks the
 * seeker to copy a "draw proof" snapshot to the clipboard on load.
 *
 * Default ON for new seekers: the popup teaches the feature exists,
 * and the [Don't ask again] option in the popup flips it OFF
 * permanently. The fly-out menu also exposes the toggle so seekers can
 * flip it back ON whenever, plus a manual one-time "Copy snapshot
 * now" action that's available regardless of the toggle.
 *
 * Storage key follows the tarotseed:* namespace convention. Module-
 * level subscriber set keeps multiple component instances (popup +
 * menu toggle) in sync without a Context provider, matching the
 * pattern used by useShowLabels.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "tarotseed:ask-draw-proof-on-load";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true; // default ON
    return raw === "1";
  } catch {
    return true;
  }
}

const listeners = new Set<(v: boolean) => void>();
let current = readInitial();

export function useAskDrawProof(): {
  askDrawProof: boolean;
  setAskDrawProof: (v: boolean) => void;
  toggleAskDrawProof: () => void;
} {
  const [askDrawProof, setLocal] = useState(current);

  useEffect(() => {
    const sub = (v: boolean) => setLocal(v);
    listeners.add(sub);
    // Resync in case `current` changed between module init and mount
    // (e.g. another component flipped it while this one was unmounted).
    setLocal(current);
    return () => {
      listeners.delete(sub);
    };
  }, []);

  const setAskDrawProof = (v: boolean) => {
    current = v;
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore storage errors */
    }
    listeners.forEach((l) => l(v));
  };

  return {
    askDrawProof,
    setAskDrawProof,
    toggleAskDrawProof: () => setAskDrawProof(!current),
  };
}
