/**
 * CV — Lightweight hook to read the two home-page-relevant moon prefs
 * (`moon_features_enabled`, `moon_show_carousel`) without dragging in
 * the full SettingsProvider (which is only mounted under /settings).
 *
 * Returns `loaded: false` until the server row has been read so callers
 * can avoid flashing moon UI before the user's true preference resolves.
 *
 * Listens for `moonseed:moon-prefs-changed` so toggles in Settings
 * propagate live to the home page without a full refetch.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const MOON_PREFS_EVENT = "moonseed:moon-prefs-changed";

export type MoonPrefs = {
  moon_features_enabled: boolean;
  moon_show_carousel: boolean;
};

export type MoonPrefsState = MoonPrefs & { loaded: boolean };

const DEFAULTS: MoonPrefs = {
  moon_features_enabled: true,
  moon_show_carousel: true,
};

export function emitMoonPrefsChanged(patch: Partial<MoonPrefs>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Partial<MoonPrefs>>(MOON_PREFS_EVENT, { detail: patch }));
}

export function useMoonPrefs(): MoonPrefsState {
  const { user, loading } = useAuth();
  const [state, setState] = useState<MoonPrefsState>({ ...DEFAULTS, loaded: false });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setState({ ...DEFAULTS, loaded: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("moon_features_enabled, moon_show_carousel")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as Partial<MoonPrefs>;
      setState({
        moon_features_enabled:
          typeof row.moon_features_enabled === "boolean"
            ? row.moon_features_enabled
            : DEFAULTS.moon_features_enabled,
        moon_show_carousel:
          typeof row.moon_show_carousel === "boolean"
            ? row.moon_show_carousel
            : DEFAULTS.moon_show_carousel,
        loaded: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Partial<MoonPrefs>>).detail ?? {};
      setState((s) => ({ ...s, ...detail }));
    };
    window.addEventListener(MOON_PREFS_EVENT, onChange);
    return () => window.removeEventListener(MOON_PREFS_EVENT, onChange);
  }, []);

  return state;
}
