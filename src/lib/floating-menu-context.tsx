import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Floating menu extras — small surface for screens to register
 * contextual actions (close, copy, refresh) into the global
 * floating ··· menu without re-rendering it themselves.
 *
 * The menu mounts ONCE at the root via <FloatingMenu />. Per-screen
 * actions register through this context using the convenience hooks.
 */
type FloatingMenuExtras = {
  closeHandler: (() => void) | null;
  copyText: string | null;
  showRefresh: boolean;
};

type FloatingMenuContextValue = FloatingMenuExtras & {
  setCloseHandler: (fn: (() => void) | null) => void;
  setCopyText: (text: string | null) => void;
  setShowRefresh: (v: boolean) => void;
};

const FloatingMenuContext = createContext<FloatingMenuContextValue>({
  closeHandler: null,
  copyText: null,
  showRefresh: false,
  setCloseHandler: () => {},
  setCopyText: () => {},
  setShowRefresh: () => {},
});

export function FloatingMenuProvider({ children }: { children: ReactNode }) {
  const [closeHandler, setCloseHandlerState] = useState<(() => void) | null>(
    null,
  );
  const [copyText, setCopyText] = useState<string | null>(null);
  const [showRefresh, setShowRefresh] = useState(false);

  const setCloseHandler = useCallback((fn: (() => void) | null) => {
    // Store the function reference itself, not a deferred call result —
    // useState would otherwise invoke our callback during set.
    setCloseHandlerState(() => fn);
  }, []);

  return (
    <FloatingMenuContext.Provider
      value={{
        closeHandler,
        copyText,
        showRefresh,
        setCloseHandler,
        setCopyText,
        setShowRefresh,
      }}
    >
      {children}
    </FloatingMenuContext.Provider>
  );
}

export const useFloatingMenu = () => useContext(FloatingMenuContext);

/** Register a close handler that becomes the X icon in the floating menu. */
export function useRegisterCloseHandler(fn: (() => void) | null) {
  const { setCloseHandler } = useFloatingMenu();
  useEffect(() => {
    setCloseHandler(fn);
    return () => setCloseHandler(null);
  }, [fn, setCloseHandler]);
}

/** Register copy text — when set, the Copy icon appears in the menu. */
export function useRegisterCopyText(text: string | null) {
  const { setCopyText } = useFloatingMenu();
  useEffect(() => {
    setCopyText(text);
    return () => setCopyText(null);
  }, [text, setCopyText]);
}

/** Register that this screen wants the Refresh icon (home only). */
export function useRegisterRefresh(show: boolean) {
  const { setShowRefresh } = useFloatingMenu();
  useEffect(() => {
    setShowRefresh(show);
    return () => setShowRefresh(false);
  }, [show, setShowRefresh]);
}