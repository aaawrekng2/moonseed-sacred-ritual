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
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * EK140 — Clear the local cache without writing the Signature event. Used when
 * the DB resolves with no saved entry back, so a stale local value (e.g. a
 * deck cached from before this device's account synced) can't mask the true
 * Signature default.
 */
function clearEntryBackCache(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

/**
 * EK140 — Persist the entry back to the DATABASE (user_preferences), not just
 * localStorage. localStorage alone was wiped by Clear Data / hard refresh /
 * PWA quit — every wipe dropped the seeker back to Signature, which read as
 * "my pick keeps reverting." The DB is now the source of truth; localStorage
 * is only a fast first-paint cache. Also writes the cache + fires the in-app
 * event so the splash and home update instantly without a refetch.
 *
 * Best-effort and order-independent: if the columns don't exist yet (migration
 * not applied), the upsert error is swallowed and the local write still stands.
 */
export async function persistEntryBackToDb(
  userId: string,
  value: EntryBack,
): Promise<void> {
  // Instant local update (cache + event) regardless of DB outcome.
  setEntryBack(value);
  if (!userId) return;
  try {
    await supabase.from("user_preferences").upsert(
      {
        user_id: userId,
        entry_back_id: value.id,
        entry_back_url: value.id === "signature" ? null : value.url ?? null,
        entry_back_name: value.id === "signature" ? null : value.name ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  } catch {
    /* columns missing or offline — local write already applied. */
  }
}

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
  const { user, loading } = useAuth();
  // Lazy initializer: seed from the localStorage cache so the splash/home can
  // paint instantly. The DB read below is authoritative and overrides this the
  // moment it resolves. On the server, window is undefined → Signature default.
  const [value, setValue] = useState<EntryBack>(() => getEntryBack());

  // In-session change propagation (picker taps, cross-tab storage events).
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

  // EK140 — DB is the source of truth. Once auth resolves, read the saved
  // entry back from user_preferences. A real saved value wins and refreshes
  // the cache; NO saved value (or an explicit "signature") resolves to the
  // Signature default AND clears any stale local cache, so a leftover deck
  // value can't mask the default. Anonymous seekers keep the local-only value.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setValue(getEntryBack());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("entry_back_id, entry_back_url, entry_back_name")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        const row = (data ?? {}) as {
          entry_back_id?: string | null;
          entry_back_url?: string | null;
          entry_back_name?: string | null;
        };
        if (
          typeof row.entry_back_id === "string" &&
          row.entry_back_id &&
          row.entry_back_id !== "signature"
        ) {
          const eb: EntryBack = {
            id: row.entry_back_id,
            url: row.entry_back_url ?? null,
            name: row.entry_back_name ?? undefined,
          };
          setEntryBack(eb); // refresh cache + notify
          setValue(eb);
        } else {
          clearEntryBackCache();
          setValue(SIGNATURE_ENTRY_BACK);
        }
      } catch {
        // Columns missing (pre-migration) or read failed — fall back to the
        // cached/local value rather than breaking the gateway.
        if (!cancelled) setValue(getEntryBack());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return value;
}
