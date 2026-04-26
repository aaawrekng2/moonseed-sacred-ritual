import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The Clarity — a 3-level density preference for the interface.
 *   1 = Seen     (full labels, full chrome)
 *   2 = Glimpse  (subtle hints, partial labels)
 *   3 = Veiled   (minimal chrome, hidden labels)
 *
 * Persisted both to localStorage (for instant boot before auth resolves)
 * and to user_preferences.ui_density (for cross-device sync). Mirrors
 * the module-level subscriber pattern from useShowLabels so multiple
 * components stay in sync without a context provider.
 */
export type UIDensityLevel = 1 | 2 | 3;

const STORAGE_KEY = "moonseed:ui-density";

function readInitial(): UIDensityLevel {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? 1 : Number(raw);
    return n === 1 || n === 2 || n === 3 ? (n as UIDensityLevel) : 1;
  } catch {
    return 1;
  }
}

const listeners = new Set<(v: UIDensityLevel) => void>();
let current: UIDensityLevel = readInitial();
let hydratedFromServer = false;

function broadcast(v: UIDensityLevel) {
  current = v;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(v));
}

export function useUIDensity(): {
  level: UIDensityLevel;
  setLevel: (v: UIDensityLevel) => void;
  cycleLevel: () => void;
} {
  const [level, setLocal] = useState<UIDensityLevel>(current);

  useEffect(() => {
    const sub = (v: UIDensityLevel) => setLocal(v);
    listeners.add(sub);
    setLocal(current);

    // One-time hydration from server preferences. Wrapped in an IIFE so
    // we don't await inside useEffect's cleanup contract.
    if (!hydratedFromServer) {
      hydratedFromServer = true;
      void (async () => {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const uid = userData?.user?.id;
          if (!uid) return;
          const { data } = await supabase
            .from("user_preferences")
            .select("ui_density")
            .eq("user_id", uid)
            .maybeSingle();
          const v = (data as { ui_density?: number } | null)?.ui_density;
          if (v === 1 || v === 2 || v === 3) {
            broadcast(v as UIDensityLevel);
          }
        } catch {
          /* ignore */
        }
      })();
    }

    return () => {
      listeners.delete(sub);
    };
  }, []);

  const setLevel = (v: UIDensityLevel) => {
    broadcast(v);
    // Fire-and-forget server sync — UI doesn't wait on the network.
    void (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) return;
        await supabase
          .from("user_preferences")
          // Cast: ui_density was added in a migration after types.ts
          // was last generated, so the column is not yet in the
          // generated Database type. The column exists in the DB.
          .update({ ui_density: v } as never)
          .eq("user_id", uid);
      } catch {
        /* ignore */
      }
    })();
  };

  const cycleLevel = () => {
    const next: UIDensityLevel =
      current === 1 ? 2 : current === 2 ? 3 : 1;
    setLevel(next);
  };

  return { level, setLevel, cycleLevel };
}