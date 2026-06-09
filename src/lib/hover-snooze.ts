/**
 * EK79 — shared "hide hover tips" snooze.
 *
 * One global store (localStorage) read by every CardHoverTip before it opens,
 * and written from two places that stay in sync: the bell on the card popover
 * and the "Hide hover tips" control in the FloatingMenu (hamburger). While
 * snoozed, hover popups don't open.
 */
import { useEffect, useState } from "react";

const KEY = "tarotseed:cardpopover:snoozeUntil";
const EVT = "tarotseed:hover-snooze-changed";
// Far-future epoch (max Date) = "until I turn it back on".
export const SNOOZE_INDEFINITE = 8640000000000000;

export type SnoozeChoice = number | "today" | "indefinite";

export const SNOOZE_OPTIONS: { label: string; value: SnoozeChoice }[] = [
  { label: "15 minutes", value: 15 * 60 * 1000 },
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "Rest of today", value: "today" },
  { label: "Until I turn it back on", value: "indefinite" },
];

export function getSnoozeUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = window.localStorage.getItem(KEY);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

export function isHoverSnoozed(): boolean {
  return Date.now() < getSnoozeUntil();
}

function writeUntil(until: number | null) {
  try {
    if (until == null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(until));
  } catch {
    // best-effort
  }
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    // best-effort
  }
}

/** Apply a snooze choice (timed, rest-of-today, or indefinite). */
export function applySnooze(v: SnoozeChoice) {
  if (v === "indefinite") {
    writeUntil(SNOOZE_INDEFINITE);
    return;
  }
  if (v === "today") {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    writeUntil(d.getTime());
    return;
  }
  writeUntil(Date.now() + v);
}

/** Turn hover tips back on. */
export function clearSnooze() {
  writeUntil(null);
}

/** Reactive snooze state — updates when changed from any surface, and
 *  auto-flips back on when a timed snooze expires. */
export function useHoverSnooze() {
  const [until, setUntil] = useState<number>(getSnoozeUntil());
  useEffect(() => {
    const h = () => setUntil(getSnoozeUntil());
    window.addEventListener(EVT, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(EVT, h);
      window.removeEventListener("storage", h);
    };
  }, []);
  // When a timed snooze is active, re-render the moment it lapses so any
  // on/off switch flips back on by itself.
  useEffect(() => {
    if (!until || until >= SNOOZE_INDEFINITE) return;
    const ms = until - Date.now();
    if (ms <= 0) return;
    const t = window.setTimeout(() => setUntil(getSnoozeUntil()), ms + 50);
    return () => window.clearTimeout(t);
  }, [until]);
  return { until, snoozed: Date.now() < until };
}
