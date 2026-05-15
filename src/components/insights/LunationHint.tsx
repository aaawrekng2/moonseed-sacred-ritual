/**
 * Q60 Fix 10 — One-time educational hint explaining what a lunation is.
 * Shared dismiss key across all lunation surfaces.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "moonseed:lunationHintDismissed";

export function LunationHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) setShow(true);
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3"
      style={{
        background: "var(--surface-card)",
        borderRadius: 12,
        borderLeft: "3px solid var(--gold)",
      }}
    >
      <div className="flex-1">
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--gold)",
            marginBottom: 4,
          }}
        >
          What is a lunation?
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.8,
            lineHeight: 1.5,
          }}
        >
          A lunation is one moon cycle — about 29 days from New Moon to New
          Moon. Moonseed groups your readings into these natural chapters so
          you can revisit what emerged during each cycle.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 4,
          opacity: 0.6,
          color: "var(--color-foreground)",
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}