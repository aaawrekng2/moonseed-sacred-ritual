/**
 * v2.29 — Update check. Fetches /version.json (cache-busted, no-store) on load,
 * on tab re-focus, and every 30 minutes, and compares it to the version baked
 * into the running bundle (APP_VERSION_LETTER). A mismatch means a newer build
 * has been deployed while this client is running a stale one.
 *
 * Pairs with <UpdateBanner>, which surfaces a manual "Refresh" prompt.
 */
import { useEffect, useState } from "react";
import { APP_VERSION_LETTER } from "@/components/dev/DevOverlay";

export type VersionCheckState = {
  /** True when the deployed version differs from the running bundle. */
  updateReady: boolean;
  /** The version reported by /version.json, or null until first read. */
  latest: string | null;
};

/**
 * Hard refresh: unregister the service worker, drop every cache, then reload
 * with a cache-busting param so the browser pulls the fresh bundle. Best-effort
 * — reloads even if the SW / cache teardown fails.
 */
export async function hardRefresh(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof window !== "undefined" && "caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // best-effort; fall through to the reload regardless
  }
  const u = new URL(window.location.href);
  u.searchParams.set("__v", Date.now().toString());
  window.location.replace(u.href);
}

export function useVersionCheck(): VersionCheckState {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Don't nag during local dev — the bundle and version.json drift there.
    if (import.meta.env.DEV) return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: unknown };
        if (cancelled) return;
        if (typeof data.version === "string" && data.version.length > 0) {
          setLatest(data.version);
        }
      } catch {
        // offline / blocked — ignore, try again on next trigger
      }
    };

    void check();

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(check, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, []);

  const updateReady = latest != null && latest !== APP_VERSION_LETTER;
  return { updateReady, latest };
}
