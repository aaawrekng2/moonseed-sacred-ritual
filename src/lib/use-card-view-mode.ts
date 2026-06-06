/**
 * EK47 — Shared "card view mode" preference.
 *
 * The Count/Streak selector lives on the Insights → Cards tab
 * filter row, but the same mode needs to affect the Card Trace
 * detail page (which is a sibling route). React state inside
 * Insights.tsx doesn't reach child routes without a context, and
 * the child route lives in a fresh state tree.
 *
 * Persisting the mode to localStorage gives both surfaces a
 * shared source of truth without context-plumbing through the
 * router. The mode is read on mount and re-read whenever
 * `useCardViewMode` is invoked, so the next render after a
 * change sees the updated value.
 */
import { useEffect, useState } from "react";

const KEY = "tarotseed:cardViewMode";
export type CardViewMode = "count" | "streak";

function read(): CardViewMode {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "streak" ? "streak" : "count";
  } catch {
    return "count";
  }
}

export function useCardViewMode(): [CardViewMode, (next: CardViewMode) => void] {
  const [mode, setMode] = useState<CardViewMode>(read);

  // Listen for changes from OTHER tabs / surfaces so the badge
  // updates without a full reload. localStorage's `storage` event
  // covers cross-tab updates. For same-tab updates from a sibling
  // hook caller, we dispatch a custom event below.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setMode(read());
    };
    const onLocal = () => setMode(read());
    window.addEventListener("storage", onStorage);
    window.addEventListener("tarotseed:cardViewMode-change", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("tarotseed:cardViewMode-change", onLocal);
    };
  }, []);

  const save = (next: CardViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* quota / private mode — silently keep state in memory */
    }
    try {
      window.dispatchEvent(new Event("tarotseed:cardViewMode-change"));
    } catch {
      /* no-op */
    }
  };

  return [mode, save];
}
