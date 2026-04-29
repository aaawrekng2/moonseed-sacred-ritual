/**
 * Hook for the user's persistent default share color.
 *
 * Mirrors the pattern used by useActiveGuide / use-resting-opacity:
 *  - localStorage is the source of truth for instant render.
 *  - On mount (and when auth resolves) we hydrate from
 *    `user_preferences.default_share_color` if a row exists.
 *  - Writes are mirrored back fire-and-forget via updateUserPreferences.
 *
 * Same-tab updates are broadcast through a custom event so multiple
 * ColorChipSelector instances stay in lockstep without prop drilling.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import {
  DEFAULT_SHARE_COLOR,
  SHARE_COLORS,
  type ShareColorId,
} from "./share-types";

const LS_KEY = "moonseed:default-share-color";
const EVENT_NAME = "moonseed:default-share-color-changed";

function isShareColorId(v: unknown): v is ShareColorId {
  return typeof v === "string" && SHARE_COLORS.some((c) => c.id === v);
}

function readLocal(): ShareColorId {
  if (typeof window === "undefined") return DEFAULT_SHARE_COLOR;
  const v = window.localStorage.getItem(LS_KEY);
  return isShareColorId(v) ? v : DEFAULT_SHARE_COLOR;
}

function writeLocal(v: ShareColorId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, v);
    window.dispatchEvent(new CustomEvent<ShareColorId>(EVENT_NAME, { detail: v }));
  } catch {
    /* storage blocked — non-fatal */
  }
}

export function useShareColor() {
  const { user } = useAuth();
  const [color, setColor] = useState<ShareColorId>(() => readLocal());

  // Hydrate from server when auth resolves.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("default_share_color")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const v = (data as { default_share_color?: string | null }).default_share_color;
      if (isShareColorId(v) && v !== color) {
        setColor(v);
        writeLocal(v);
      }
    })();
    return () => {
      cancelled = true;
    };
    // color intentionally omitted — we only want the initial sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Cross-component sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ShareColorId>).detail;
      if (isShareColorId(detail)) setColor(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const setAndPersist = useCallback(
    (next: ShareColorId) => {
      setColor(next);
      writeLocal(next);
      if (user) {
        void updateUserPreferences(user.id, { default_share_color: next });
      }
    },
    [user],
  );

  return { color, setColor: setAndPersist };
}
