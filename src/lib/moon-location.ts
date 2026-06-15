import { useEffect, useLayoutEffect, useState } from "react";

/**
 * EK138 — The observer location used to compute moonrise / moonset for the
 * "today" card on the moon carousel.
 *
 * Why local storage (not user_preferences): rise/set times are tied to the
 * physical place a person is right now, which is inherently per-device — the
 * same account on a phone in Seattle and a laptop in Denver should show each
 * device's own times. Storing it locally (like resting-opacity / entry-back)
 * keeps it per-device and needs no database migration. It auto-resets with
 * the rest of the `tarotseed:` keys on a master reset.
 *
 * Distinct from the BIRTH location stored in user_preferences (used for the
 * rising-sign feature) — that's where the seeker was born, not where they are.
 */

const KEY = "tarotseed:moon-location";
export const MOON_LOCATION_EVENT = "arcana:moon-location-changed";

export type MoonLocation = {
  lat: number;
  lon: number;
  /** Human label, e.g. a city name or "Current location". */
  label: string;
};

// Hydrate before first paint on the client, fall back to passive effect on
// the server — mirrors use-resting-opacity / use-theme-color-sync.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function getMoonLocation(): MoonLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lat === "number" &&
      typeof parsed.lon === "number" &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lon)
    ) {
      return {
        lat: parsed.lat,
        lon: parsed.lon,
        label:
          typeof parsed.label === "string" && parsed.label
            ? parsed.label
            : "Saved location",
      };
    }
  } catch {
    // malformed value — treat as unset
  }
  return null;
}

export function setMoonLocation(loc: MoonLocation | null): void {
  if (typeof window === "undefined") return;
  try {
    if (loc === null) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(loc));
    }
  } catch {
    // storage unavailable / quota — ignore
  }
  window.dispatchEvent(new CustomEvent(MOON_LOCATION_EVENT));
}

export function useMoonLocation(): MoonLocation | null {
  const [loc, setLoc] = useState<MoonLocation | null>(() => getMoonLocation());
  useIsoLayoutEffect(() => {
    setLoc(getMoonLocation());
    const onChange = () => setLoc(getMoonLocation());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setLoc(getMoonLocation());
    };
    window.addEventListener(MOON_LOCATION_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MOON_LOCATION_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return loc;
}
