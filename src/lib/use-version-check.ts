/**
 * v2.29 / v2.32 — Update check. Fetches /version.json (cache-busted, no-store)
 * and compares it to the version baked into the running bundle
 * (APP_VERSION_LETTER). A mismatch means a newer build has been deployed while
 * this client is running a stale one.
 *
 * v2.32 — checks now fire on: first load (forced), every route change, tab
 * re-focus, and a 30-minute backstop interval — throttled to at most once per
 * 60s so rapid navigation never spams the network. This catches a fresh deploy
 * within a navigation or two of it going live.
 *
 * Pairs with <UpdateBanner>, which surfaces a manual "Refresh" prompt.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { APP_VERSION_LETTER } from "@/components/dev/DevOverlay";

export type VersionCheckState = {
  /** True when the deployed version differs from the running bundle. */
  updateReady: boolean;
  /** The version reported by /version.json, or null until first read. */
  latest: string | null;
};

/** Minimum gap between non-forced checks, so navigation doesn't spam fetches. */
const THROTTLE_MS = 60 * 1000;

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
  // Re-runs the route-change effect on every navigation (pathname change).
  const location = useLocation();
  const lastCheckedRef = useRef(0);
  const mountedRef = useRef(true);

  const check = useCallback(async (force = false) => {
    if (typeof window === "undefined") return;
    // Don't nag during local dev — the bundle and version.json drift there.
    if (import.meta.env.DEV) return;
    const now = Date.now();
    if (!force && now - lastCheckedRef.current < THROTTLE_MS) return;
    lastCheckedRef.current = now;
    try {
      const res = await fetch(`/version.json?t=${now}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: unknown };
      if (!mountedRef.current) return;
      if (typeof data.version === "string" && data.version.length > 0) {
        setLatest(data.version);
      }
    } catch {
      // offline / blocked — ignore, try again on the next trigger
    }
  }, []);

  // First load (forced) + tab re-focus + a periodic backstop.
  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === "undefined") return;
    void check(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => void check(), 30 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [check]);

  // Every route change — throttled inside check().
  useEffect(() => {
    void check();
  }, [location.pathname, check]);

  const updateReady = latest != null && latest !== APP_VERSION_LETTER;
  return { updateReady, latest };
}
