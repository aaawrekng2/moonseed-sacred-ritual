/**
 * Q81 — Apply saved font pairing + text scale on every page load.
 *
 * Replaces the legacy heading_font / heading_font_size sync. Now syncs
 * font_pairing (one preset that drives both --font-display and --font-serif)
 * and text_scale (single slider that drives both --body-scale and
 * --heading-scale).
 */
import { useEffect, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  applyFontPairing,
  applyTextScale,
  readStoredPairing,
  readStoredTextScale,
  isFontPairingKey,
  clampTextScale,
  DEFAULT_FONT_PAIRING,
  TEXT_SCALE_DEFAULT,
} from "@/lib/font-pairings";

export function useThemeFontSync(): void {
  const { user, loading } = useAuth();

  useLayoutEffect(() => {
    applyFontPairing(readStoredPairing());
    applyTextScale(readStoredTextScale());
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("font_pairing, text_scale")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const fp = (data as { font_pairing?: string | null }).font_pairing;
      const ts = (data as { text_scale?: number | null }).text_scale;
      applyFontPairing(isFontPairingKey(fp) ? fp : DEFAULT_FONT_PAIRING);
      applyTextScale(typeof ts === "number" ? clampTextScale(ts) : TEXT_SCALE_DEFAULT);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
}
