/**
 * Per-user reading interpretation font size (12-20px).
 *
 * Long-pressing the interpretation surfaces a transient slider that
 * adjusts this value live. The new size is mirrored to localStorage
 * for instant rehydration and fire-and-forget to
 * `user_preferences.reading_font_size`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";

const LS_KEY = "moonseed:reading-font-size";
export const READING_FONT_DEFAULT = 15;
export const READING_FONT_MIN = 12;
export const READING_FONT_MAX = 20;

function clamp(n: number) {
  if (Number.isNaN(n)) return READING_FONT_DEFAULT;
  return Math.max(READING_FONT_MIN, Math.min(READING_FONT_MAX, Math.round(n)));
}

function readLocal(): number {
  if (typeof window === "undefined") return READING_FONT_DEFAULT;
  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return READING_FONT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n) : READING_FONT_DEFAULT;
}

// Debounce window for the server write while the user drags the slider.
// Local state and localStorage update synchronously; the network call
// coalesces so we don't fire one update per slider tick.
const PERSIST_DEBOUNCE_MS = 250;

export function useReadingFontSize() {
  const { user } = useAuth();
  // Hydration-safe but flicker-free: SSR/first paint use the default,
  // and we swap in the localStorage value before the browser paints
  // (useState lazy initializer runs synchronously on the client mount).
  const [size, setSize] = useState<number>(() =>
    typeof window === "undefined" ? READING_FONT_DEFAULT : readLocal(),
  );

  // Debounced persist — keeps slider drags from spamming the network.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    [],
  );

  // Hydrate from server once auth is known.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("reading_font_size")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const v = (data as { reading_font_size?: number | null }).reading_font_size;
      if (typeof v === "number") {
        const next = clamp(v);
        setSize(next);
        try {
          window.localStorage.setItem(LS_KEY, String(next));
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setSizeAndPersist = useCallback(
    (n: number) => {
      const next = clamp(n);
      setSize(next);
      try {
        window.localStorage.setItem(LS_KEY, String(next));
      } catch {
        /* ignore */
      }
      if (user) {
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
          // Cast: reading_font_size column was added in a later migration
          // and may not be in the regenerated types yet.
          void updateUserPreferences(user.id, {
            reading_font_size: next,
          } as never);
        }, PERSIST_DEBOUNCE_MS);
      }
    },
    [user],
  );

  return { size, setSize: setSizeAndPersist };
}