/**
 * v2.29 / v2.32 — Manual update prompt. When a newer build is deployed
 * (detected by useVersionCheck), shows a full-width banner across the top of
 * the screen with a Refresh action that hard-reloads (drops the service worker
 * + caches). Never auto-reloads, so it can't interrupt a reading or a
 * half-typed reflection. Dismissible with the × on the right.
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
        top: 0,
        left: 0,
        right: 0,
        zIndex: "var(--z-toast)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "calc(env(safe-area-inset-top, 0px) + 11px) 44px 11px 18px",
        background: "var(--surface-elevated)",
        borderBottom: "1px solid var(--border-subtle)",
        boxShadow:
          "0 1px 18px color-mix(in oklab, var(--cosmos, #0a0a14) 45%, transparent)",
        fontFamily: "var(--font-serif)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-body-sm)",
          fontStyle: "italic",
          color: "var(--color-foreground)",
          textAlign: "center",
        }}
      >
        A new version of Tarot Seed has arrived
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
          textDecoration: "underline",
          textUnderlineOffset: 3,
          cursor: "pointer",
          whiteSpace: "nowrap",
          padding: 0,
        }}
      >
        {refreshing ? "Updating…" : "Refresh to update"}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          right: 14,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: "16px",
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
