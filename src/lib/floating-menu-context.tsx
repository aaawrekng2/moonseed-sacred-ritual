import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  helpHandler: (() => void) | null;
  copyText: string | null;
  showRefresh: boolean;
  /** True while the seeker is on the draw-table card selection view. */
  tabletopActive: boolean;
};

type FloatingMenuContextValue = FloatingMenuExtras & {
  setCloseHandler: (fn: (() => void) | null) => void;
  setHelpHandler: (fn: (() => void) | null) => void;
  setCopyText: (text: string | null) => void;
  setShowRefresh: (v: boolean) => void;
  setTabletopActive: (v: boolean) => void;
};

const FloatingMenuContext = createContext<FloatingMenuContextValue>({
  closeHandler: null,
  helpHandler: null,
  copyText: null,
  showRefresh: false,
  tabletopActive: false,
  setCloseHandler: () => {},
  setHelpHandler: () => {},
  setCopyText: () => {},
  setShowRefresh: () => {},
  setTabletopActive: () => {},
});

export function FloatingMenuProvider({ children }: { children: ReactNode }) {
  const [closeHandler, setCloseHandlerState] = useState<(() => void) | null>(
    null,
  );
  const [helpHandler, setHelpHandlerState] = useState<(() => void) | null>(
    null,
  );
  const [copyText, setCopyText] = useState<string | null>(null);
  const [showRefresh, setShowRefresh] = useState(false);
  const [tabletopActive, setTabletopActive] = useState(false);

  const setCloseHandler = useCallback((fn: (() => void) | null) => {
    // Store the function reference itself, not a deferred call result —
    // useState would otherwise invoke our callback during set.
    setCloseHandlerState(() => fn);
  }, []);

  const setHelpHandler = useCallback((fn: (() => void) | null) => {
    setHelpHandlerState(() => fn);
  }, []);

  return (
    <FloatingMenuContext.Provider
      value={{
        closeHandler,
        helpHandler,
        copyText,
        showRefresh,
        tabletopActive,
        setCloseHandler,
        setHelpHandler,
        setCopyText,
        setShowRefresh,
        setTabletopActive,
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
  // Keep a ref to the latest fn so screens don't need to memoize the
  // handler every render. The context only stores a stable forwarder
  // and is updated/cleared once per mount.
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ref.current) {
      setCloseHandler(null);
      return;
    }
    setCloseHandler(() => ref.current?.());
    return () => setCloseHandler(null);
    // Only re-run on mount/unmount — fn changes are picked up via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCloseHandler]);
}

/** Register a help handler that becomes the ? icon in the floating menu. */
export function useRegisterHelpHandler(fn: (() => void) | null) {
  const { setHelpHandler } = useFloatingMenu();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ref.current) {
      setHelpHandler(null);
      return;
    }
    setHelpHandler(() => ref.current?.());
    return () => setHelpHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHelpHandler]);
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

/**
 * Mark the seeker as being on the draw-table card-selection view.
 * Used by the global BottomNav and quill UI to stay out of the way
 * during card selection and reappear once cards are cast / revealed.
 */
export function useRegisterTabletopActive(active: boolean) {
  const { setTabletopActive } = useFloatingMenu();
  useEffect(() => {
    setTabletopActive(active);
    return () => setTabletopActive(false);
  }, [active, setTabletopActive]);
}