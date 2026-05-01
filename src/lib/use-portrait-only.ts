/**
 * BX — Marks the body with `data-portrait-only="true"` while a screen
 * is mounted. Combined with the @media (orientation: landscape) rule
 * in styles.css, this surfaces the "Please rotate your device" overlay
 * for screens that don't make sense in landscape (Tabletop, Home,
 * Settings, Journal). Default app behaviour is rotation-friendly.
 */
import { useEffect } from "react";

export function usePortraitOnly() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-portrait-only", "true");
    return () => {
      document.body.removeAttribute("data-portrait-only");
    };
  }, []);
}