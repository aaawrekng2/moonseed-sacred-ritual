/**
 * Lightweight, dependency-free analytics.
 *
 * Goals:
 *  - Zero network coupling: events are appended to an in-memory ring
 *    buffer and mirrored to localStorage so they survive reloads.
 *  - Pluggable: each call also dispatches a `CustomEvent` named
 *    "tarotseed:analytics" on `window`. A future PostHog/Plausible/etc
 *    integration can subscribe without touching call sites.
 *  - Safe to call from any environment (SSR, tests). All browser APIs
 *    are guarded.
 *
 * Currently consumed by the Share flow (see `share-events.ts`) to
 * measure which rituals seekers actually pick.
 */

const STORAGE_KEY = "tarotseed.analytics.events";
const MAX_EVENTS = 500;

export type AnalyticsEvent = {
  name: string;
  ts: number;
  props?: Record<string, unknown>;
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readBuffer(): AnalyticsEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

function writeBuffer(events: AnalyticsEvent[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Quota or privacy mode — silently drop persistence; in-memory
    // dispatch still works for any live listener.
  }
}

/**
 * Record an event. Always non-throwing.
 */
export function track(name: string, props?: Record<string, unknown>): void {
  const evt: AnalyticsEvent = { name, ts: Date.now(), props };

  if (isBrowser()) {
    const buf = readBuffer();
    buf.push(evt);
    // Keep the buffer bounded so localStorage never grows unbounded.
    while (buf.length > MAX_EVENTS) buf.shift();
    writeBuffer(buf);

    try {
      window.dispatchEvent(
        new CustomEvent("tarotseed:analytics", { detail: evt }),
      );
    } catch {
      // No-op.
    }
  }

  if (import.meta.env?.DEV) {
    // Helpful while iterating; stays out of production noise.
    // eslint-disable-next-line no-console
    console.debug("[analytics]", name, props ?? {});
  }
}

/** Read all buffered events (useful for debugging / dev overlay). */
export function getEvents(): AnalyticsEvent[] {
  return readBuffer();
}

/** Clear the buffered events. */
export function clearEvents(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op.
  }
}