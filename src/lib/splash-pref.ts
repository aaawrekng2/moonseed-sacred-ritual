/**
 * EK125 — Splash entry preference.
 *
 * The home splash (the Signature card, back-lit + breathing) shows on every
 * fresh load unless the seeker has turned it off via the "Don't show again"
 * line on the splash itself or the toggle in Settings → Card Back.
 *
 * Stored as a single localStorage flag under the `tarotseed:` prefix, so the
 * master reset (Settings → Clear Local Cache / Clear Data, both of which wipe
 * every `tarotseed:` key) clears it automatically and the splash returns.
 */
const KEY = "tarotseed:splash-disabled";
export const SPLASH_PREF_EVENT = "tarotseed:splash-pref-changed";

export function isSplashDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSplashDisabled(disabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (disabled) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
    window.dispatchEvent(
      new CustomEvent<boolean>(SPLASH_PREF_EVENT, { detail: disabled }),
    );
  } catch {
    /* localStorage unavailable — no-op. */
  }
}
