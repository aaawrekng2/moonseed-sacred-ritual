/**
 * Shared event bus for "the active visual theme just changed."
 *
 * Before this module existed each dispatcher fired bare `CustomEvent`s
 * (`moonseed:sanctuary-changed` + `moonseed:theme-changed`) with no
 * payload, forcing every listener (CurrentThemeBadge, useSavedThemes,
 * CommunityThemesSection) to re-fetch from Supabase / localStorage to
 * figure out what just happened.
 *
 * Now we have one event — `moonseed:active-theme-changed` — carrying a
 * structured `ActiveThemeDetail` describing the source of the change
 * (`sanctuary` / `community` / `accent` / `custom` / `cleared`) plus
 * the resolved name, accent dot, and (when applicable) the active
 * sanctuary slot or community key. Listeners apply the payload directly
 * and update instantly and consistently.
 *
 * The legacy event names are kept as aliases so any not-yet-migrated
 * callsite still triggers a refresh, but new code should only use
 * `dispatchActiveThemeChanged` / `subscribeActiveThemeChanged`.
 */

export type ActiveThemeSource =
  | "sanctuary"
  | "community"
  | "accent"
  | "custom"
  | "cleared";

export type ActiveThemeDetail = {
  /** Where the new look came from. Drives badge label resolution. */
  source: ActiveThemeSource;
  /** Human-facing name to show in the badge ("Mystic", "Sanctuary 2"…). */
  name: string;
  /** CSS color string for the accent dot in the badge. */
  accent: string;
  /** Saved-theme slot (1..5) when `source === "sanctuary"`, else null. */
  sanctuarySlot: number | null;
  /** Community palette key when `source === "community"`, else null. */
  communityKey: string | null;
};

export const ACTIVE_THEME_EVENT = "moonseed:active-theme-changed" as const;

/** Legacy event names kept for back-compat with any external listeners. */
const LEGACY_EVENTS = [
  "moonseed:theme-changed",
  "moonseed:sanctuary-changed",
] as const;

export function dispatchActiveThemeChanged(detail: ActiveThemeDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ActiveThemeDetail>(ACTIVE_THEME_EVENT, { detail }),
  );
  // Fan out to legacy event names so any older listener still refreshes.
  for (const name of LEGACY_EVENTS) {
    window.dispatchEvent(new CustomEvent(name));
  }
}

/**
 * Subscribe to active-theme changes. Returns an unsubscribe fn.
 * Listens to both the new event and legacy aliases so callers receive
 * updates from any dispatcher (with a `null` detail for legacy ones).
 */
export function subscribeActiveThemeChanged(
  handler: (detail: ActiveThemeDetail | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onModern = (e: Event) => {
    const ce = e as CustomEvent<ActiveThemeDetail>;
    handler(ce.detail ?? null);
  };
  const onLegacy = () => handler(null);
  window.addEventListener(ACTIVE_THEME_EVENT, onModern);
  for (const name of LEGACY_EVENTS) {
    window.addEventListener(name, onLegacy);
  }
  return () => {
    window.removeEventListener(ACTIVE_THEME_EVENT, onModern);
    for (const name of LEGACY_EVENTS) {
      window.removeEventListener(name, onLegacy);
    }
  };
}