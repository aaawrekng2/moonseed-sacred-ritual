/**
 * v2.29 — Manual update prompt. When a newer build is deployed (detected by
 * useVersionCheck), shows a slim dismissible banner with a Refresh action that
 * hard-reloads (drops the service worker + caches). Never auto-reloads, so it
 * can't interrupt a reading or a half-typed reflection.
 */
import { useState } from "react";
import { useVersionCheck, hardRefresh } from "@/lib/use-version-check";

export function UpdateBanner() {
  const { updateReady } = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!updateReady || dismissed) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "var(--z-toast)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        maxWidth: "calc(100vw - 24px)",
        padding: "10px 16px",
        borderRadius: "var(--radius-full, 9999px)",
        background: "var(--surface-elevated)",
        border: "1px solid var(--border-subtle)",
        boxShadow:
          "0 6px 24px color-mix(in oklab, var(--cosmos, #0a0a14) 40%, transparent)",
        fontFamily: "var(--font-serif)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-body-sm)",
          fontStyle: "italic",
          color: "var(--color-foreground)",
          whiteSpace: "nowrap",
        }}
      >
        A new version is available
      </span>
      <button
        type="button"
        onClick={() => {
          setRefreshing(true);
          void hardRefresh();
        }}
        disabled={refreshing}
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--gold)",
          background: "none",
          border: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          padding: 0,
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground-muted)",
          background: "none",
          border: "none",
          cursor: "pointer",
          lineHeight: 1,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
