import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUserPreferencesRow } from "@/lib/ensure-user-preferences";

/**
 * Single source of truth for the Settings page. Loads the user's
 * preferences row once on mount and exposes it (plus a setter) to all
 * tab panels. Panels mutate via {@link updateUserPreferences} and then
 * call `setPrefs(...)` to keep local state in sync.
 *
 * Moonseed is personal-only — there is no `current_mode` / `app_mode` /
 * `default_life_area` / `show_reversals` / outcome-reminders here. The
 * source bundle's dual-mode + reversal toggles were intentionally
 * removed per the port spec.
 */
export type Prefs = {
  display_name: string | null;
  birth_date: string | null;
  birth_time: string | null;
  birth_place: string | null;
  sun_sign: string | null;
  rising_sign: string | null;
  initial_intention: string | null;
  default_spread: string;
  moon_features_enabled: boolean;
  moon_show_carousel: boolean;
  moon_ai_phase: boolean;
  moon_ai_sign: boolean;
  moon_void_warning: boolean;
};

const DEFAULT_PREFS: Prefs = {
  display_name: "",
  birth_date: null,
  birth_time: null,
  birth_place: null,
  sun_sign: null,
  rising_sign: null,
  initial_intention: null,
  default_spread: "single",
  moon_features_enabled: true,
  moon_show_carousel: true,
  moon_ai_phase: false,
  moon_ai_sign: false,
  moon_void_warning: true,
};

type SettingsCtx = {
  user: { id: string; email?: string };
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  loaded: boolean;
};

const Ctx = createContext<SettingsCtx | null>(null);

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used within SettingsProvider");
  return v;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Make sure a row exists so the first read isn't an empty result that
      // forces every panel into "create new row" mode.
      await ensureUserPreferencesRow(user.id);
      const { data, error } = await supabase
        .from("user_preferences")
        .select(
          "display_name, birth_date, birth_time, birth_place, sun_sign, rising_sign, initial_intention, default_spread, moon_features_enabled, moon_show_carousel, moon_ai_phase, moon_ai_sign, moon_void_warning",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error("Couldn't load your settings.");
        return;
      }
      const d = (data ?? {}) as Record<string, unknown>;
      const b = (k: string, fallback: boolean): boolean =>
        typeof d[k] === "boolean" ? (d[k] as boolean) : fallback;
      const s = (k: string, fallback: string): string =>
        typeof d[k] === "string" ? (d[k] as string) : fallback;
      const n = (k: string): string | null =>
        typeof d[k] === "string" ? (d[k] as string) : null;
      setPrefs({
        display_name: n("display_name"),
        birth_date: n("birth_date"),
        birth_time: n("birth_time"),
        birth_place: n("birth_place"),
        sun_sign: n("sun_sign"),
        rising_sign: n("rising_sign"),
        initial_intention: n("initial_intention"),
        default_spread: s("default_spread", "single"),
        moon_features_enabled: b("moon_features_enabled", true),
        moon_show_carousel: b("moon_show_carousel", true),
        moon_ai_phase: b("moon_ai_phase", false),
        moon_ai_sign: b("moon_ai_sign", false),
        moon_void_warning: b("moon_void_warning", true),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const value: SettingsCtx = {
    user: { id: user.id, email: user.email },
    prefs: prefs ?? DEFAULT_PREFS,
    setPrefs: (p) => setPrefs(p),
    loaded: prefs !== null,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}