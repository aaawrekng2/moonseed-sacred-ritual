/**
 * Registers the Tarot Seed service worker and surfaces the manifest so the
 * app can be installed to the home screen. Mounted once at the root.
 * Failures (no SW support, network blocked) are non-fatal.
 */
import { useEffect } from "react";

export function usePWA() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (import.meta.env.DEV) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => registration.unregister());
        })
        .catch(() => undefined);
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) => {
            keys
              .filter((key) => key.startsWith("tarotseed-shell-"))
              .forEach((key) => caches.delete(key));
          })
          .catch(() => undefined);
      }
      return;
    }
    // Defer registration until after first paint so it never blocks startup.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => {
          console.warn("[Tarot Seed] SW registration failed:", err);
        });
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);
}