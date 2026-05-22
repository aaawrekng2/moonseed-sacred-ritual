/**
 * EJ5 — Tarot Seed constellation hover-tips toggle.
 *
 * The seeker can show/hide every hover tip on the /constellation
 * surface — legend ⓘ popovers, card popovers, badge popovers, day-cell
 * popovers, line popovers. Two persistence layers combine:
 *
 *  - `enabled` (boolean): the master switch. When false, all hover
 *    tips on the constellation are suppressed indefinitely until the
 *    seeker flips it back on.
 *  - `snoozedUntil` (timestamp ms | null): a temporary mute. When set
 *    and `Date.now() < snoozedUntil`, hover tips are suppressed even
 *    if `enabled === true`. When the snooze elapses naturally, the
 *    timestamp is cleared on next read.
 *
 * The combined "effective" state — exposed as `effectiveEnabled` —
 * resolves both layers.
 *
 * Persistence: localStorage only (per-device, no cross-device sync).
 * Key: `tarotseed:constellation-hover-tips`. JSON payload:
 *   { enabled: boolean, snoozedUntil: number | null }
 *
 * If the key is missing or malformed, the default is fully on (no
 * snooze). The hook is SSR-safe: `enabled` initial value is true and
 * `snoozedUntil` is null on the server; the real state is hydrated
 * from localStorage in `useEffect` post-mount to avoid hydration
 * mismatches.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "tarotseed:constellation-hover-tips";
const CHANGE_EVENT = "tarotseed:constellation-hover-tips:change";

type State = {
  enabled: boolean;
  snoozedUntil: number | null;
};

const DEFAULT_STATE: State = { enabled: true, snoozedUntil: null };

function readState(): State {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<State>;
    const enabled = typeof parsed.enabled === "boolean" ? parsed.enabled : true;
    const snoozedUntil =
      typeof parsed.snoozedUntil === "number" ? parsed.snoozedUntil : null;
    // Auto-clear elapsed snoozes on read so consumers don't have to.
    if (snoozedUntil !== null && Date.now() >= snoozedUntil) {
      const next: State = { enabled, snoozedUntil: null };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    }
    return { enabled, snoozedUntil };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(next: State): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // ignore quota/serialization errors
  }
}

// useSyncExternalStore wiring — server returns DEFAULT_STATE, client
// returns the live localStorage value. The snapshot is the JSON string
// to make equality cheap.
function getServerSnapshot(): string {
  return JSON.stringify(DEFAULT_STATE);
}

function getSnapshot(): string {
  return JSON.stringify(readState());
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => callback();
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export type HoverTipsState = State;

export type HoverTipsApi = {
  /** Master enabled flag — `false` means "off until enabled". */
  enabled: boolean;
  /** Active snooze deadline, or null. */
  snoozedUntil: number | null;
  /**
   * The effective state consumers should branch on. True when tips
   * should currently render.
   */
  effectiveEnabled: boolean;
  /** Set the master enabled flag directly. */
  setEnabled: (v: boolean) => void;
  /** Toggle the master enabled flag. */
  toggle: () => void;
  /** Suppress tips for the given duration in milliseconds. */
  snoozeFor: (durationMs: number) => void;
  /** Clear any active snooze (does not affect `enabled`). */
  clearSnooze: () => void;
  /**
   * Convenience: "Hide until enabled" — turns off the master flag and
   * clears any snooze.
   */
  disableUntilEnabled: () => void;
};

export function useConstellationHoverTips(): HoverTipsApi {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state: State = (() => {
    try {
      return JSON.parse(snapshot) as State;
    } catch {
      return DEFAULT_STATE;
    }
  })();

  // Tick once when a snooze elapses so consumers re-render.
  useEffect(() => {
    if (state.snoozedUntil === null) return;
    const ms = state.snoozedUntil - Date.now();
    if (ms <= 0) {
      // Already elapsed; readState() will clear it on the next call.
      writeState({ enabled: state.enabled, snoozedUntil: null });
      return;
    }
    const t = window.setTimeout(() => {
      writeState({ enabled: state.enabled, snoozedUntil: null });
    }, ms);
    return () => window.clearTimeout(t);
  }, [state.enabled, state.snoozedUntil]);

  const setEnabled = useCallback((v: boolean) => {
    const current = readState();
    writeState({ enabled: v, snoozedUntil: current.snoozedUntil });
  }, []);

  const toggle = useCallback(() => {
    const current = readState();
    writeState({ enabled: !current.enabled, snoozedUntil: current.snoozedUntil });
  }, []);

  const snoozeFor = useCallback((durationMs: number) => {
    const current = readState();
    writeState({
      enabled: current.enabled,
      snoozedUntil: Date.now() + durationMs,
    });
  }, []);

  const clearSnooze = useCallback(() => {
    const current = readState();
    writeState({ enabled: current.enabled, snoozedUntil: null });
  }, []);

  const disableUntilEnabled = useCallback(() => {
    writeState({ enabled: false, snoozedUntil: null });
  }, []);

  // EJ10 — snooze inversion fix. When `snoozedUntil` is set and we're
  // INSIDE the snooze window (Date.now() < snoozedUntil), tips must be
  // suppressed — i.e. effectiveEnabled must be FALSE. The previous
  // formula returned TRUE during the snooze, so selecting "Hide for
  // 15 minutes / 1 day / 1 week" from the gear menu silently did
  // nothing. Inverted the comparison: tips are effectively on only
  // when there is no snooze OR the snooze has already elapsed.
  const effectiveEnabled =
    state.enabled &&
    (state.snoozedUntil === null || Date.now() >= state.snoozedUntil);

  return {
    enabled: state.enabled,
    snoozedUntil: state.snoozedUntil,
    effectiveEnabled,
    setEnabled,
    toggle,
    snoozeFor,
    clearSnooze,
    disableUntilEnabled,
  };
}

/** Convenience durations used by the snooze menu. */
export const SNOOZE_DURATIONS = {
  fifteenMinutes: 15 * 60 * 1000,
  oneDay: 24 * 60 * 60 * 1000,
  oneWeek: 7 * 24 * 60 * 60 * 1000,
} as const;
