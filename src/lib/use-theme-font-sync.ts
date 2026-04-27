/**
 * Apply the seeker's saved theme font + size globally on every page load.
 *
 * The Themes tab persists `heading_font` and `heading_font_size` to
 * `user_preferences` and writes the corresponding CSS vars
 * (`--font-serif`, `--heading-scale`) on the live <html> element. But
 * those writes only happen while the user is interacting with the
 * Themes tab. On a fresh page load anywhere else in the app, the
 * defaults from styles.css render and the seeker's chosen font is
 * effectively ignored until they re-open Themes.
 *
 * This hook:
 *  1. Synchronously rehydrates the cached font + size from localStorage
 *     before the first paint of any RootComponent render.
 *  2. Once auth resolves, fetches the server values and re-applies them
 *     so a seeker on a new device sees their saved font as soon as the
 *     row is read.
 *
 * The matching pre-paint <script> in __root.tsx writes the cached vars
 * even earlier — this hook keeps the runtime values in sync after the
 * server reply arrives.
 */
import { useEffect, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  applyHeadingFont,
  applyHeadingFontSize,
  isThemeFont,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  type ThemeFont,
} from "@/lib/use-saved-themes";

const FONT_KEY = "moonseed:heading-font";
const SIZE_KEY = "moonseed:heading-font-size";

function readLocalFont(): ThemeFont | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(FONT_KEY);
  return isThemeFont(raw) ? raw : null;
}

function readLocalSize(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SIZE_KEY);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
}

export function useThemeFontSync(): void {
  const { user, loading } = useAuth();

  // Apply cached values pre-paint on every mount. The boot <script> in
  // __root.tsx already sets --font-serif before first paint, but this
  // also primes --heading-scale and re-runs ensureFontLoaded so the
  // Google Fonts link is injected.
  useLayoutEffect(() => {
    const font = readLocalFont();
    const size = readLocalSize();
    if (font) applyHeadingFont(font);
    if (size != null) applyHeadingFontSize(size);
  }, []);

  // Once auth resolves, hydrate from the server row.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("heading_font, heading_font_size")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const f = (data as { heading_font?: string | null }).heading_font;
      const s = (data as { heading_font_size?: number | null })
        .heading_font_size;
      if (f && isThemeFont(f)) applyHeadingFont(f);
      if (typeof s === "number") applyHeadingFontSize(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
}