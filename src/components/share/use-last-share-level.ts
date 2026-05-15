/**
 * Hook for the user's persistent last-used share level.
 *
 * Mirrors `use-share-color`:
 *   - localStorage = source of truth for instant render.
 *   - Hydrates from `user_preferences.last_share_level` on auth resolve.
 *   - Writes upsert back fire-and-forget via updateUserPreferences.
 *
 * The persisted value is only honored by the ShareBuilder when the
 * level is actually `enabled` for the current screen (auto-prune wins).
 * That's why this hook only stores/returns the bare id — the builder
 * decides whether to use it.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import type { ShareLevel } from "./share-types";

const LS_KEY = "tarotseed:last-share-level";
const EVENT_NAME = "tarotseed:last-share-level-changed";
const VALID: ShareLevel[] = ["pull", "reading", "position", "lens", "artifact"];

function isShareLevel(v: unknown): v is ShareLevel {
  return typeof v === "string" && (VALID as string[]).includes(v);
}

function readLocal(): ShareLevel | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(LS_KEY);
  return isShareLevel(v) ? v : null;
}

function writeLocal(v: ShareLevel) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, v);
    window.dispatchEvent(new CustomEvent<ShareLevel>(EVENT_NAME, { detail: v }));
  } catch {
    /* storage blocked — non-fatal */
  }
}

export function useLastShareLevel() {
  const { user } = useAuth();
  const [level, setLevel] = useState<ShareLevel | null>(() => readLocal());

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("last_share_level")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const v = (data as { last_share_level?: string | null }).last_share_level;
      if (isShareLevel(v) && v !== level) {
        setLevel(v);
        writeLocal(v);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ShareLevel>).detail;
      if (isShareLevel(detail)) setLevel(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const remember = useCallback(
    (next: ShareLevel) => {
      setLevel(next);
      writeLocal(next);
      if (user) {
        void updateUserPreferences(user.id, { last_share_level: next });
      }
    },
    [user],
  );

  return { lastLevel: level, remember };
}