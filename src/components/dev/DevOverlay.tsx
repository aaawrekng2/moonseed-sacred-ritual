/**
 * Dev overlay (vV).
 *
 * A small pill in the top-left corner that surfaces three live signals:
 *   - the current app version letter (hardcoded per build)
 *   - (Fog level removed from pill, still tracked internally)
 *   - the seeker's resting opacity (Op 25-100%)
 *
 * Visible only when:
 *   1) the signed-in user has role 'admin' or 'super_admin', AND
 *   2) the localStorage flag `moonseed:dev_mode` is "true".
 *
 * Toggled from the Admin panel — never tied to a specific email.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const APP_VERSION_LETTER = "26-05-08-P";
const DEV_MODE_KEY = "moonseed:dev_mode";
const MIST_KEY = "moonseed:mist-level";
const OPACITY_KEY = "moonseed:resting-opacity";
const MIST_EVENT = "moonseed:mist-level-changed";
const OPACITY_EVENT = "arcana:resting-opacity-changed";
const DEV_EVENT = "moonseed:dev-mode-changed";

function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEV_MODE_KEY) === "true";
}

function readMist(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(MIST_KEY);
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 0;
}

function readOpacity(): number {
  if (typeof window === "undefined") return 50;
  const raw = window.localStorage.getItem(OPACITY_KEY);
  const n = raw == null ? 50 : Number(raw);
  return Number.isFinite(n) ? Math.max(25, Math.min(100, Math.round(n))) : 50;
}

export function setDevMode(on: boolean): void {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(DEV_MODE_KEY, "true");
  else window.localStorage.removeItem(DEV_MODE_KEY);
  window.dispatchEvent(new CustomEvent<boolean>(DEV_EVENT, { detail: on }));
}

export function publishMistLevel(level: number): void {
  if (typeof window === "undefined") return;
  const clamped = Math.max(0, Math.min(4, Math.round(level)));
  window.localStorage.setItem(MIST_KEY, String(clamped));
  window.dispatchEvent(
    new CustomEvent<number>(MIST_EVENT, { detail: clamped }),
  );
}

export function DevOverlay() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mist, setMist] = useState(0);
  const [opacity, setOpacity] = useState(50);

  // Resolve role from user_preferences. Anonymous sessions resolve to
  // not-admin and the overlay never renders.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const role = (data as { role?: string } | null)?.role;
      setIsAdmin(role === "admin" || role === "super_admin");
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Seed local state from storage; subscribe to live updates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnabled(readDevMode());
    setMist(readMist());
    setOpacity(readOpacity());
    const onDev = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setEnabled(typeof detail === "boolean" ? detail : readDevMode());
    };
    const onMist = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      setMist(typeof detail === "number" ? detail : readMist());
    };
    const onOpacity = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      setOpacity(typeof detail === "number" ? detail : readOpacity());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_MODE_KEY) setEnabled(readDevMode());
      if (e.key === MIST_KEY) setMist(readMist());
      if (e.key === OPACITY_KEY) setOpacity(readOpacity());
    };
    window.addEventListener(DEV_EVENT, onDev);
    window.addEventListener(MIST_EVENT, onMist);
    window.addEventListener(OPACITY_EVENT, onOpacity);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEV_EVENT, onDev);
      window.removeEventListener(MIST_EVENT, onMist);
      window.removeEventListener(OPACITY_EVENT, onOpacity);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (!isAdmin || !enabled) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: 8,
        zIndex: 2147483647,
        pointerEvents: "none",
        fontFamily: "ui-monospace, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        color: "#ffffff",
        background: "rgba(0, 0, 0, 0.85)",
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255, 255, 255, 0.15)",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
      }}
    >
      v{APP_VERSION_LETTER} · Op {opacity}%
    </div>
  );
}