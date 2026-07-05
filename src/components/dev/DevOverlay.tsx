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

// v2.0 — EK letter scheme retired; the stamp now holds a semantic version
// string (renders as "v2.0" wherever the pill prepends the v).
export const APP_VERSION_LETTER = "2.90";
const DEV_MODE_KEY = "tarotseed:dev_mode";
// v2.36 — device-local "developer options" unlock so the owner can use
// the dev chip on a non-admin account. Set by the 7-tap version gesture
// at the bottom of Settings. DevChip shows when (isAdmin || dev_unlock).
const DEV_UNLOCK_KEY = "tarotseed:dev_unlock";
const DEV_UNLOCK_EVENT = "tarotseed:dev-unlock-changed";
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
// EK28 — face-flip sub-toggle. When ON, every card on the tabletop
// renders FACE-UP regardless of card.revealed, so the seeker can
// see which physical card is at each position. Used to verify the
// gather shuffle is actually mixing the deck. Default: OFF
// (face-down, normal behavior).
const DEV_FACES_KEY = "tarotseed:dev_faces";
const DEV_FACES_EVENT = "tarotseed:dev-faces-changed";

function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEV_MODE_KEY) === "true";
}

export function readDevUnlock(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEV_UNLOCK_KEY) === "true";
}

export const DEV_UNLOCK_CHANGED_EVENT = DEV_UNLOCK_EVENT;

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

// v2.36 — toggle the device-local dev unlock (and turn dev mode on/off to
// match, so the chip appears/disappears immediately). Returns the new state.
export function setDevUnlock(on: boolean): boolean {
  if (typeof window === "undefined") return false;
  if (on) window.localStorage.setItem(DEV_UNLOCK_KEY, "true");
  else window.localStorage.removeItem(DEV_UNLOCK_KEY);
  window.dispatchEvent(new CustomEvent<boolean>(DEV_UNLOCK_EVENT, { detail: on }));
  setDevMode(on);
  return on;
}

// EK126 — reactive Dev Mode reader, so the top-menu version readout can
// show/hide live as Dev Mode toggles. Mirrors useDevHideMenu.
export function useDevMode(): boolean {
  const [on, setOn] = useState<boolean>(() => readDevMode());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOn(typeof detail === "boolean" ? detail : readDevMode());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_MODE_KEY) setOn(readDevMode());
    };
    window.addEventListener(DEV_EVENT, handler);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEV_EVENT, handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return on;
}

// EK28 — face-flip sub-toggle reader. Default OFF when no key set.
export function readDevFaces(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DEV_FACES_KEY);
  if (raw === null) return false;
  return raw === "true";
}

export function setDevFaces(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEV_FACES_KEY, on ? "true" : "false");
  window.dispatchEvent(new CustomEvent<boolean>(DEV_FACES_EVENT, { detail: on }));
}

// EK28 — live-tracking React hook for the faces sub-toggle.
// CardSlot consumes this; when ON, it passes flipped={true} to
// CardImage regardless of card.revealed, so every face-down card
// reveals its identity for visual verification of shuffle behavior.
export function useDevFaces(): boolean {
  const [on, setOn] = useState<boolean>(() => readDevFaces());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOn(typeof detail === "boolean" ? detail : readDevFaces());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_FACES_KEY) setOn(readDevFaces());
    };
    window.addEventListener(DEV_FACES_EVENT, handler);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEV_FACES_EVENT, handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return on;
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
