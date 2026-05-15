/**
 * Q64 — First-time AI token notice.
 *
 * Wrap any AI-firing button with `useTokenNotice()`. The hook returns
 * a `guard(run)` helper: pass it the function that should fire after
 * the seeker dismisses the notice. If the seeker has previously
 * tapped "Don't remind me" the notice is skipped entirely and `run`
 * is invoked immediately. Otherwise a small in-place card appears
 * once per session with two dismiss options.
 *
 * The notice itself is a tiny popover anchored to the bottom of the
 * viewport so it never displaces page content.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PERMANENT_KEY = "tarotseed:tokenNoticeDismissed";
const SESSION_KEY = "tarotseed:tokenNoticeSeen";

function isPermanentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PERMANENT_KEY) === "true";
  } catch {
    return false;
  }
}

function isSeenThisSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function useTokenNotice() {
  const [pending, setPending] = useState<null | (() => void)>(null);

  const guard = useCallback((run: () => void) => {
    if (isPermanentlyDismissed() || isSeenThisSession()) {
      run();
      return;
    }
    setPending(() => run);
  }, []);

  const dismissSession = useCallback(() => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      /* noop */
    }
    pending?.();
    setPending(null);
  }, [pending]);

  const dismissForever = useCallback(() => {
    try {
      window.localStorage.setItem(PERMANENT_KEY, "true");
    } catch {
      /* noop */
    }
    pending?.();
    setPending(null);
  }, [pending]);

  return {
    guard,
    notice: pending ? (
      <TokenNoticeOverlay onSession={dismissSession} onForever={dismissForever} />
    ) : null,
  };
}

function TokenNoticeOverlay({
  onSession,
  onForever,
}: {
  onSession: () => void;
  onForever: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 32,
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: 360,
        width: "calc(100% - 32px)",
        padding: 14,
        borderRadius: 12,
        background: "var(--surface-elevated)",
        border: "1px solid color-mix(in oklch, var(--gold) 35%, transparent)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        fontFamily: "var(--font-serif)",
      }}
    >
      <p
        style={{
          margin: 0,
          marginBottom: 10,
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          lineHeight: 1.4,
        }}
      >
        This action uses AI and costs tokens. Look for the sparkle icon —
        it always means tokens will be spent.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onForever}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--foreground-muted)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            padding: "6px 8px",
          }}
        >
          Don&apos;t remind me
        </button>
        <button
          type="button"
          onClick={onSession}
          style={{
            background: "var(--gold)",
            color: "var(--accent-foreground, var(--background))",
            border: "none",
            cursor: "pointer",
            borderRadius: 8,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            padding: "6px 12px",
          }}
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}