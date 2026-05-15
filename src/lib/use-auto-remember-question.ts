/**
 * "Auto-remember my question" preference.
 *
 * When enabled, the home-screen question textarea automatically
 * flips its "Remember my question" toggle on as soon as the seeker
 * starts typing — so the question persists across sessions without
 * an extra tap. Stored locally (UI-only preference).
 *
 * Pattern mirrors other lightweight hooks in this folder
 * (use-show-labels, use-tap-to-peek) — a single localStorage key
 * with a tiny pub/sub so multiple components stay in sync.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "auto-remember-question";
const EVENT = "tarotseed:auto-remember-question-change";

const SCOPE_KEY = "question-remember-scope";
const SCOPE_EVENT = "tarotseed:question-remember-scope-change";

/**
 * Where a remembered question is stored.
 *  - `device`: localStorage on this browser only
 *  - `cloud`:  the user's account row (`user_preferences.remembered_question`),
 *              so it follows them across browsers / devices
 */
export type RememberScope = "device" | "cloud";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function getAutoRememberQuestion(): boolean {
  return readStored();
}

export function setAutoRememberQuestion(next: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }
}

export function useAutoRememberQuestion(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(false);

  useEffect(() => {
    setValue(readStored());
    const handler = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setValue(typeof next === "boolean" ? next : readStored());
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const update = (next: boolean) => {
    setValue(next);
    setAutoRememberQuestion(next);
  };

  return [value, update];
}

function readScope(): RememberScope {
  if (typeof window === "undefined") return "device";
  try {
    return localStorage.getItem(SCOPE_KEY) === "cloud" ? "cloud" : "device";
  } catch {
    return "device";
  }
}

export function getRememberScope(): RememberScope {
  return readScope();
}

export function setRememberScope(next: RememberScope) {
  try {
    localStorage.setItem(SCOPE_KEY, next);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCOPE_EVENT, { detail: next }));
  }
}

export function useRememberScope(): [
  RememberScope,
  (next: RememberScope) => void,
] {
  const [value, setValue] = useState<RememberScope>("device");

  useEffect(() => {
    setValue(readScope());
    const handler = (e: Event) => {
      const next = (e as CustomEvent<RememberScope>).detail;
      setValue(next === "cloud" || next === "device" ? next : readScope());
    };
    window.addEventListener(SCOPE_EVENT, handler);
    return () => window.removeEventListener(SCOPE_EVENT, handler);
  }, []);

  const update = (next: RememberScope) => {
    setValue(next);
    setRememberScope(next);
  };

  return [value, update];
}