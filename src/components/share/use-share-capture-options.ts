/**
 * Persist per-level capture options for the ShareBuilder so that
 *   1. Closing and reopening the dialog (or reloading the app) keeps
 *      the seeker's last toggle / position choices intact.
 *   2. A Retry resumes against the exact same ritual card settings
 *      that produced the failure.
 *
 * Storage shape (localStorage, single JSON blob):
 *   {
 *     pull:     { includeQuestion?: boolean }
 *     reading:  { includeQuestion?: boolean, includeInterpretation?: boolean }
 *     position: { positionIndex?: number }
 *   }
 * Lens / artifact have no persisted options today; they're driven
 * entirely by `extras` from the host screen.
 *
 * Smart defaults still apply on first use (no stored value for that
 * level yet) — the builder is responsible for seeding them.
 */
import { useCallback, useEffect, useState } from "react";
import type { ShareLevel } from "./share-types";

const LS_KEY = "tarotseed:share-capture-options";
const EVENT_NAME = "tarotseed:share-capture-options-changed";

export type CaptureOptionsByLevel = Partial<{
  pull: { includeQuestion?: boolean };
  reading: { includeQuestion?: boolean; includeInterpretation?: boolean };
  position: { positionIndex?: number };
}>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readLocal(): CaptureOptionsByLevel {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? (parsed as CaptureOptionsByLevel) : {};
  } catch {
    return {};
  }
}

function writeLocal(v: CaptureOptionsByLevel) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(v));
    window.dispatchEvent(
      new CustomEvent<CaptureOptionsByLevel>(EVENT_NAME, { detail: v }),
    );
  } catch {
    /* storage blocked — non-fatal */
  }
}

export function useShareCaptureOptions() {
  const [options, setOptions] = useState<CaptureOptionsByLevel>(() =>
    readLocal(),
  );

  // Sync across tabs / multiple builder instances.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CaptureOptionsByLevel>).detail;
      if (isPlainObject(detail)) setOptions(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const remember = useCallback(
    <L extends keyof CaptureOptionsByLevel>(
      level: L,
      patch: NonNullable<CaptureOptionsByLevel[L]>,
    ) => {
      setOptions((prev) => {
        const next: CaptureOptionsByLevel = {
          ...prev,
          [level]: { ...(prev[level] ?? {}), ...patch },
        };
        writeLocal(next);
        return next;
      });
    },
    [],
  );

  const get = useCallback(
    <L extends keyof CaptureOptionsByLevel>(
      level: L,
    ): CaptureOptionsByLevel[L] => options[level],
    [options],
  );

  return { options, get, remember };
}

/**
 * Helper for the builder: pick the persisted value for a level/key,
 * falling back to a smart default. Keeps call sites concise.
 */
export function pickStoredOrDefault<T>(
  stored: T | undefined,
  fallback: T,
): T {
  return stored === undefined ? fallback : stored;
}

// Suppress unused export lint if the level type isn't directly needed
// at call sites (kept for future use).
export type { ShareLevel };