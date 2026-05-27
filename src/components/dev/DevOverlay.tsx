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
 *   2) the localStorage flag `tarotseed:dev_mode` is "true".
 *
 * Toggled from the Admin panel — never tied to a specific email.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const APP_VERSION_LETTER = "EJ68";
const DEV_MODE_KEY = "tarotseed:dev_mode";
const MIST_KEY = "tarotseed:mist-level";
const OPACITY_KEY = "tarotseed:resting-opacity";
const MIST_EVENT = "tarotseed:mist-level-changed";
const OPACITY_EVENT = "arcana:resting-opacity-changed";
const DEV_EVENT = "tarotseed:dev-mode-changed";
// EJ46 — slot-colors sub-toggle. When dev mode is ON, the saturated
// debug colors in CardImage (green wrapper, red img tint, yellow
// empty, magenta loading, orange back outline) can be suppressed
// independently. Default: ON (colors visible) — matches the prior
// behavior, only the SUPPRESS path is new.
const DEV_SLOT_COLORS_KEY = "tarotseed:dev_slot_colors";
const DEV_SLOT_COLORS_EVENT = "tarotseed:dev-slot-colors-changed";
// EJ49 — hide-menu sub-toggle. When ON, the TopNav visually hides
// (display: none) but the TopNavGate spacer stays in document flow,
// so page content doesn't shift. Lets admins inspect what's behind
// the nav without re-laying out the page. Default: OFF (menu shown).
const DEV_HIDE_MENU_KEY = "tarotseed:dev_hide_menu";
const DEV_HIDE_MENU_EVENT = "tarotseed:dev-hide-menu-changed";

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

// EJ46 — slot-color sub-toggle reader. Default ON when no key set.
export function readDevSlotColors(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(DEV_SLOT_COLORS_KEY);
  // Treat missing key as ON to preserve current behavior.
  if (raw === null) return true;
  return raw === "true";
}

export function setDevSlotColors(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEV_SLOT_COLORS_KEY, on ? "true" : "false");
  window.dispatchEvent(new CustomEvent<boolean>(DEV_SLOT_COLORS_EVENT, { detail: on }));
}

// EJ46 — live-tracking React hook for the slot-colors sub-toggle.
// Mirrors the same listener pattern CardImage uses for dev mode so the
// suppression flips immediately when the user toggles it.
export function useDevSlotColors(): boolean {
  const [on, setOn] = useState<boolean>(() => readDevSlotColors());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOn(typeof detail === "boolean" ? detail : readDevSlotColors());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_SLOT_COLORS_KEY) setOn(readDevSlotColors());
    };
    window.addEventListener(DEV_SLOT_COLORS_EVENT, handler);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEV_SLOT_COLORS_EVENT, handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return on;
}

// EJ49 — hide-menu sub-toggle reader. Default OFF when no key set
// (menu is visible). Same shape as readDevSlotColors so the two
// toggles read identically.
export function readDevHideMenu(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DEV_HIDE_MENU_KEY);
  if (raw === null) return false;
  return raw === "true";
}

export function setDevHideMenu(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEV_HIDE_MENU_KEY, on ? "true" : "false");
  window.dispatchEvent(new CustomEvent<boolean>(DEV_HIDE_MENU_EVENT, { detail: on }));
}

// EJ49 — live-tracking hook for the hide-menu sub-toggle. TopNav
// consumes this; when true, TopNav renders with display: none so
// the page chrome is suppressed but the TopNavGate spacer stays in
// flow (no layout shift).
export function useDevHideMenu(): boolean {
  const [on, setOn] = useState<boolean>(() => readDevHideMenu());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOn(typeof detail === "boolean" ? detail : readDevHideMenu());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_HIDE_MENU_KEY) setOn(readDevHideMenu());
    };
    window.addEventListener(DEV_HIDE_MENU_EVENT, handler);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEV_HIDE_MENU_EVENT, handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return on;
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
  window.dispatchEvent(new CustomEvent<number>(MIST_EVENT, { detail: clamped }));
}

export function DevOverlay() {
  // EJ47 — The standalone top-left version pill has been removed. The
  // version letter and opacity readout now live in the DevChip header
  // (mounted alongside this component in __root.tsx). We keep this
  // component exported so `<DevOverlay />` in __root.tsx still
  // resolves; it just renders nothing. Its module exports
  // (setDevMode, publishMistLevel, readDevSlotColors,
  // setDevSlotColors, useDevSlotColors, APP_VERSION_LETTER) are still
  // the single source of truth — only the visible pill is gone.
  return null;
}

// EJ47 — `useDevOpacity` is exposed so DevChip can render the same
// opacity readout that used to live in the standalone pill. Lives in
// this module so the existing storage-key / event-name constants stay
// internal to one file.
export function useDevOpacity(): number {
  const [opacity, setOpacity] = useState<number>(() => readOpacity());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpacity = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      setOpacity(typeof detail === "number" ? detail : readOpacity());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === OPACITY_KEY) setOpacity(readOpacity());
    };
    window.addEventListener(OPACITY_EVENT, onOpacity);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(OPACITY_EVENT, onOpacity);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return opacity;
}
