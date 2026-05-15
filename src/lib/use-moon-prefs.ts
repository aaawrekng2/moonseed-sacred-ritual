/**
 * CV — Lightweight hook to read the two home-page-relevant moon prefs
 * (`moon_features_enabled`, `moon_show_carousel`) without dragging in
 * the full SettingsProvider (which is only mounted under /settings).
 *
 * Returns `loaded: false` until the server row has been read so callers
 * can avoid flashing moon UI before the user's true preference resolves.
 *
 * Listens for `tarotseed:moon-prefs-changed` so toggles in Settings
 * propagate live to the home page without a full refetch.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const MOON_PREFS_EVENT = "tarotseed:moon-prefs-changed";
export type CarouselSize = "small" | "medium" | "large";
export const DEFAULT_CAROUSEL_SIZE: CarouselSize = "medium";

// DU-15 — Local cache key for the carousel-visibility / size prefs so
// the home hero card can compute its size SYNCHRONOUSLY on cold boot
// without waiting for the server fetch. Without this, a mobile cold
// boot with carousel OFF still uses the DEFAULTS (carousel=true) for
// the first render's cardHeight calc, baking in a too-small height
// that the next frame can't recover from until the user toggles.
const LS_KEY = "tarotseed:moon-prefs-cache";

export type MoonPrefs = {
  moon_features_enabled: boolean;
  moon_show_carousel: boolean;
  moon_carousel_size: CarouselSize;
};

export type MoonPrefsState = MoonPrefs & { loaded: boolean };

const DEFAULTS: MoonPrefs = {
  moon_features_enabled: true,
  moon_show_carousel: true,
  moon_carousel_size: DEFAULT_CAROUSEL_SIZE,
};

function readCachedMoonPrefs(): MoonPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MoonPrefs>;
    return {
      moon_features_enabled:
        typeof parsed.moon_features_enabled === "boolean"
          ? parsed.moon_features_enabled
          : DEFAULTS.moon_features_enabled,
      moon_show_carousel:
        typeof parsed.moon_show_carousel === "boolean"
          ? parsed.moon_show_carousel
          : DEFAULTS.moon_show_carousel,
      moon_carousel_size:
        parsed.moon_carousel_size === "small" ||
        parsed.moon_carousel_size === "medium" ||
        parsed.moon_carousel_size === "large"
          ? parsed.moon_carousel_size
          : DEFAULTS.moon_carousel_size,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeCachedMoonPrefs(p: MoonPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function carouselHeightForSize(size: CarouselSize, isMobile: boolean): number {
  if (isMobile) {
    if (size === "small") return 70;
    if (size === "medium") return 100;
    return 138;
  }
  if (size === "small") return 100;
  if (size === "medium") return 140;
  return 200;
}

export function emitMoonPrefsChanged(patch: Partial<MoonPrefs>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Partial<MoonPrefs>>(MOON_PREFS_EVENT, { detail: patch }));
}

export function useMoonPrefs(): MoonPrefsState {
  const { user, loading } = useAuth();
  // DU-15 — Seed from localStorage cache so the initial render uses
  // the seeker's true carousel pref (critical for hero card sizing
  // on mobile cold boot). `loaded:true` here means "we have a usable
  // value", not "the server fetch completed".
  const [state, setState] = useState<MoonPrefsState>(() => ({
    ...readCachedMoonPrefs(),
    loaded: true,
  }));

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
        .select("moon_features_enabled, moon_show_carousel, moon_carousel_size")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as Partial<MoonPrefs>;
      const next: MoonPrefs = {
        moon_features_enabled:
          typeof row.moon_features_enabled === "boolean"
            ? row.moon_features_enabled
            : DEFAULTS.moon_features_enabled,
        moon_show_carousel:
          typeof row.moon_show_carousel === "boolean"
            ? row.moon_show_carousel
            : DEFAULTS.moon_show_carousel,
        moon_carousel_size:
          row.moon_carousel_size === "small" ||
          row.moon_carousel_size === "medium" ||
          row.moon_carousel_size === "large"
            ? row.moon_carousel_size
            : DEFAULTS.moon_carousel_size,
      };
      writeCachedMoonPrefs(next);
      setState({ ...next, loaded: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Partial<MoonPrefs>>).detail ?? {};
      setState((s) => {
        const next = { ...s, ...detail };
        const { loaded: _loaded, ...prefs } = next;
        writeCachedMoonPrefs(prefs);
        return next;
      });
    };
    window.addEventListener(MOON_PREFS_EVENT, onChange);
    return () => window.removeEventListener(MOON_PREFS_EVENT, onChange);
  }, []);

  return state;
}
