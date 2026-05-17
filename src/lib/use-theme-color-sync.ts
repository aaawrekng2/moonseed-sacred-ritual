/**
 * Q83 — Apply saved community color theme + custom accent on every
 * page load, mirroring useThemeFontSync.
 *
 * Pre-paint: read localStorage (community theme key + accent hex) in a
 *   useLayoutEffect and apply via applyCommunityTheme/applyCustomAccent.
 * Post-auth: read user_preferences.community_theme and accent_color,
 *   reconcile with localStorage, apply if the server value differs.
 */
import { useEffect, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  getStoredCommunityTheme,
  setStoredCommunityTheme,
  resolveCommunityTheme,
  COMMUNITY_THEMES,
} from "@/lib/community-themes";
import { applyCommunityTheme } from "@/lib/theme-apply";

const ACCENT_STORAGE_KEY = "tarotseed:accent-color";
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function applyCustomAccent(hex: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent-color", hex);
  root.style.setProperty("--primary", hex);
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--ring", `${hex}99`);
}

function getStoredAccentColor(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCENT_STORAGE_KEY);
}

function setStoredAccentColor(hex: string | null) {
  if (typeof window === "undefined") return;
  if (hex == null) window.localStorage.removeItem(ACCENT_STORAGE_KEY);
  else window.localStorage.setItem(ACCENT_STORAGE_KEY, hex);
}

export function useThemeColorSync(): void {
  const { user, loading } = useAuth();

  useLayoutEffect(() => {
    const theme = resolveCommunityTheme(getStoredCommunityTheme());
    if (theme) applyCommunityTheme(theme);
    const accent = getStoredAccentColor();
    if (accent && HEX_RE.test(accent)) applyCustomAccent(accent);
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("community_theme, accent_color")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as {
        community_theme?: string | null;
        accent_color?: string | null;
      };
      const localKey = getStoredCommunityTheme();
      if (row.community_theme && row.community_theme !== localKey) {
        const t = COMMUNITY_THEMES.find((x) => x.key === row.community_theme);
        if (t) {
          applyCommunityTheme(t);
          setStoredCommunityTheme(t.key);
        }
      }
      const localAccent = getStoredAccentColor();
      if (
        row.accent_color &&
        HEX_RE.test(row.accent_color) &&
        row.accent_color !== localAccent
      ) {
        applyCustomAccent(row.accent_color);
        setStoredAccentColor(row.accent_color);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
}

export { setStoredAccentColor, getStoredAccentColor };
