import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
};

const Ctx = createContext<ThemeDirtyCtx | null>(null);

export function ThemeDirtyProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const markDirty = useCallback(() => setHasUnsavedChanges(true), []);
  const markClean = useCallback(() => setHasUnsavedChanges(false), []);
  const value = useMemo<ThemeDirtyCtx>(
    () => ({ hasUnsavedChanges, markDirty, markClean }),
    [hasUnsavedChanges, markDirty, markClean],
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
    };
  }
  return v;
}