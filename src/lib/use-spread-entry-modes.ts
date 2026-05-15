/**
 * 26-05-08-Q18 — Per-spread entry-mode memory.
 *
 * Stores in `user_preferences.spread_entry_modes` (jsonb) the last
 * surface ("table" | "manual") the seeker used for each spread, plus
 * the last custom card count. Anonymous seekers get the same
 * persistence via localStorage so the memory carries pre-signup.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SpreadMode } from "@/lib/spreads";

export type EntryMode = "table" | "manual";

export type SpreadEntryModes = {
  single?: EntryMode;
  three?: EntryMode;
  celtic?: EntryMode;
  yes_no?: EntryMode;
  daily?: EntryMode;
  custom?: { mode: EntryMode; count: number };
  // Catch-all for forward compat
  [key: string]: EntryMode | { mode: EntryMode; count: number } | undefined;
};

const LS_KEY = "tarotseed.spread_entry_modes";

function readLocal(): SpreadEntryModes {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(v: SpreadEntryModes) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function defaultModeFor(spread: SpreadMode): EntryMode {
  return "table";
}

export function defaultCustomCount(): number {
  return 3;
}

/** Read the last-used mode for a given spread, with sensible defaults. */
export function resolveModeFromMap(
  modes: SpreadEntryModes,
  spread: SpreadMode,
): EntryMode {
  if (spread === "custom") {
    const v = modes.custom;
    if (v && typeof v === "object" && "mode" in v) return v.mode;
    return defaultModeFor(spread);
  }
  const v = modes[spread];
  if (typeof v === "string") return v;
  return defaultModeFor(spread);
}

export function resolveCountFromMap(modes: SpreadEntryModes): number {
  const v = modes.custom;
  if (v && typeof v === "object" && "count" in v && typeof v.count === "number") {
    return Math.max(1, Math.min(10, v.count));
  }
  return defaultCustomCount();
}

export function useSpreadEntryModes(userId: string | null) {
  const [modes, setModes] = useState<SpreadEntryModes>(() => readLocal());
  const [loaded, setLoaded] = useState(false);

  // Hydrate from server (signed-in only) and migrate localStorage on
  // first authenticated read.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!userId) {
        setModes(readLocal());
        setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from("user_preferences")
        .select("spread_entry_modes")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const server =
        ((data as { spread_entry_modes?: SpreadEntryModes } | null)
          ?.spread_entry_modes) ?? {};
      const local = readLocal();
      // Migrate: anything in local but not server gets pushed to server.
      const merged: SpreadEntryModes = { ...local, ...server };
      const needsMigrate =
        Object.keys(local).length > 0 &&
        JSON.stringify(merged) !== JSON.stringify(server);
      setModes(merged);
      setLoaded(true);
      if (needsMigrate) {
        await supabase
          .from("user_preferences")
          .upsert(
            { user_id: userId, spread_entry_modes: merged } as never,
            { onConflict: "user_id" },
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = useCallback(
    async (next: SpreadEntryModes) => {
      writeLocal(next);
      if (!userId) return;
      await supabase
        .from("user_preferences")
        .upsert(
          { user_id: userId, spread_entry_modes: next } as never,
          { onConflict: "user_id" },
        );
    },
    [userId],
  );

  const setMode = useCallback(
    (spread: SpreadMode, mode: EntryMode) => {
      setModes((prev) => {
        const next: SpreadEntryModes = { ...prev };
        if (spread === "custom") {
          const cur = (prev.custom && typeof prev.custom === "object")
            ? prev.custom
            : { mode, count: defaultCustomCount() };
          next.custom = { ...cur, mode };
        } else {
          next[spread] = mode;
        }
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const setCustomCount = useCallback(
    (count: number) => {
      const c = Math.max(1, Math.min(10, Math.round(count)));
      setModes((prev) => {
        const cur = (prev.custom && typeof prev.custom === "object")
          ? prev.custom
          : { mode: defaultModeFor("custom"), count: c };
        const next: SpreadEntryModes = { ...prev, custom: { ...cur, count: c } };
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  return { modes, loaded, setMode, setCustomCount };
}