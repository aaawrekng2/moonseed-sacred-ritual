import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CardBackId } from "@/lib/card-backs";
import type { ThemeFont } from "@/lib/use-saved-themes";

/**
 * Snapshot of every theme knob the dirty system tracks. When
 * `ThemesTab` mounts (and after every save/load) we capture one of
 * these as the "baseline". The unsaved-changes prompt's "Keep
 * exploring" → discard option reverts to this baseline.
 */
export type ThemeBaseline = {
  accent: string; // accent preset value e.g. "default" / "violet-flame"
  accent_color: string | null; // custom hex override or null
  bg_left: string;
  bg_right: string;
  font: ThemeFont;
  font_size: number;
  card_back: CardBackId;
  resting_opacity: number;
  oracle_mode: boolean;
};

/**
 * Tracks whether the user has modified any theme configuration setting
 * since the last load/save. Scoped to the Themes tab — every knob in
 * `ThemesTab.tsx` calls `markDirty()` after a successful change.
 * Loading or saving a slot calls `markClean()`.
 */
type ThemeDirtyCtx = {
  hasUnsavedChanges: boolean;
  markDirty: () => void;
  markClean: () => void;
  /** Snapshot of "what was applied" the last time we marked clean. */
  baseline: ThemeBaseline | null;
  /** Replace the baseline (called on mount + after save/load). */
  setBaseline: (b: ThemeBaseline) => void;
};

const Ctx = createContext<ThemeDirtyCtx | null>(null);

export function ThemeDirtyProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const baselineRef = useRef<ThemeBaseline | null>(null);
  // Cheap re-render trigger when baseline changes — consumers usually
  // don't render baseline directly, but the dialog needs to know.
  const [, bump] = useState(0);
  const markDirty = useCallback(() => setHasUnsavedChanges(true), []);
  const markClean = useCallback(() => setHasUnsavedChanges(false), []);
  const setBaseline = useCallback((b: ThemeBaseline) => {
    baselineRef.current = b;
    bump((n) => n + 1);
  }, []);
  const value = useMemo<ThemeDirtyCtx>(
    () => ({
      hasUnsavedChanges,
      markDirty,
      markClean,
      baseline: baselineRef.current,
      setBaseline,
    }),
    [hasUnsavedChanges, markDirty, markClean, setBaseline],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Returns a no-op stub when called outside the provider so test/preview
 * harnesses don't crash; the boolean simply stays `false`.
 */
export function useThemeDirty(): ThemeDirtyCtx {
  const v = useContext(Ctx);
  if (!v) {
    return {
      hasUnsavedChanges: false,
      markDirty: () => {},
      markClean: () => {},
      baseline: null,
      setBaseline: () => {},
    };
  }
  return v;
}