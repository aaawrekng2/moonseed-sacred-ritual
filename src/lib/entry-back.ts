/**
 * EK129 — Entry & home card-back preference.
 *
 * Picks which back shows on the splash entry card AND the home gateway card:
 * the bundled "Signature" back (default) or any of the seeker's custom decks'
 * photographed backs. Chosen from Settings → My Decks.
 *
 * Stored as one JSON blob under the `tarotseed:` prefix, so the master reset
 * (Clear Local Cache / Clear Data, which wipe every `tarotseed:` key) returns
 * it to the Signature default. We store the resolved image URL alongside the
 * id so the splash/home can paint instantly without an async deck lookup; the
 * id + name drive the picker's selected state.
 */
export type EntryBack = {
  /** Deck id, or the sentinel "signature" for the bundled default. */
  id: string;
  /**
   * EK136 — Raw ORIGINAL back image URL (the uploaded file itself), or
   * null for the Signature default. Previously this stored the
   * `-full.webp` variant, which a freshly-uploaded deck has not generated
   * yet, leaving entry/home with a dead URL while the picker (reading live
   * deck data) still looked correct. Storing the original guarantees a
   * servable URL the moment a deck has a back.
   */
  url: string | null;
  /** EK136 — Thumb-size fallback URL, used by CardBack on image error. */
  thumbUrl?: string | null;
  /** Display label for the picker (e.g. deck name). */
  name?: string;
};

const KEY = "tarotseed:entry-back";
export const ENTRY_BACK_EVENT = "tarotseed:entry-back-changed";
export const SIGNATURE_ENTRY_BACK: EntryBack = { id: "signature", url: null };

export function getEntryBack(): EntryBack {
  if (typeof window === "undefined") return SIGNATURE_ENTRY_BACK;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SIGNATURE_ENTRY_BACK;
    const parsed = JSON.parse(raw) as EntryBack;
    if (parsed && typeof parsed.id === "string") {
      return {
        id: parsed.id,
        url: parsed.url ?? null,
        thumbUrl: parsed.thumbUrl ?? null,
        name: parsed.name,
      };
    }
    return SIGNATURE_ENTRY_BACK;
  } catch {
    return SIGNATURE_ENTRY_BACK;
  }
}

export function setEntryBack(value: EntryBack): void {
  if (typeof window === "undefined") return;
  try {
    if (value.id === "signature") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(value));
    window.dispatchEvent(
      new CustomEvent<EntryBack>(ENTRY_BACK_EVENT, { detail: value }),
    );
  } catch {
    /* localStorage unavailable — no-op. */
  }
}

import { useEffect, useLayoutEffect, useState } from "react";

// EK135 — apply the saved entry back BEFORE first paint, the same way the
// theme/opacity hooks do (use-resting-opacity, use-theme-color-sync). A plain
// useEffect runs AFTER paint, so the first frame always showed the Signature
// default and the splash's flip animation could freeze on that frame —
// producing the "sometimes my back, sometimes the default" flicker. The
// useLayoutEffect runs before paint; on the server it's a no-op, so fall back
// to useEffect there to avoid the SSR warning.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Reactive reader — re-renders when the entry back changes anywhere. */
export function useEntryBack(): EntryBack {
  // Lazy initializer: on the client, the very first render already reads the
  // saved value (no default-then-swap). On the server, window is undefined so
  // getEntryBack() returns the Signature default.
  const [value, setValue] = useState<EntryBack>(() => getEntryBack());
  useIsoLayoutEffect(() => {
    setValue(getEntryBack());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<EntryBack>).detail;
      setValue(detail ?? getEntryBack());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setValue(getEntryBack());
    };
    window.addEventListener(ENTRY_BACK_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ENTRY_BACK_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return value;
}
