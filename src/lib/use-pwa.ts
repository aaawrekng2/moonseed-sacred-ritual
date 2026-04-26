/**
 * Registers the Moonseed service worker and surfaces the manifest so the
 * app can be installed to the home screen. Mounted once at the root.
 * Failures (no SW support, network blocked) are non-fatal.
 */
import { useEffect } from "react";

export function usePWA() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Defer registration until after first paint so it never blocks startup.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => {
          console.warn("[Moonseed] SW registration failed:", err);
        });
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);
}