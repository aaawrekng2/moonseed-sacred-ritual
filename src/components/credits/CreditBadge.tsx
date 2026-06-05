/**
 * Q101 #8c — CreditBadge.
 *
 * Compact balance pill (number + sparkle). First-ever tap opens an
 * intro modal; subsequent taps open a popover with the balance,
 * next refill, subscription type, and a "Get more" link placeholder.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCredits } from "@/lib/use-credits";
import { useAIEnabled } from "@/lib/use-ai-enabled";
import { formatDateLong } from "@/lib/dates";

const INTRO_KEY = "credits_intro_seen";

function fmtDate(d: Date): string {
  return formatDateLong(d.toISOString());
}

export function CreditBadge() {
  // EK37 — Gate on AI features. If AI is off for this user, the
  // credit badge does not render at all. No "credits" affordance, no
  // hint that token purchases exist, nothing.
  const aiEnabled = useAIEnabled();
  const { balance, nextRefillAt, subscriptionType, loading } = useCredits();
  const [introOpen, setIntroOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // EK37 — Early return BEFORE any hooks below. Hooks above (state +
  // refs) must run unconditionally; useEffect below also runs but is
  // gated internally. The render branch is the actual gate.

  useEffect(() => {
    if (!popoverOpen) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setPopoverOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  function handleTap() {
    const seen =
      typeof window !== "undefined" && localStorage.getItem(INTRO_KEY) === "true";
    if (!seen) {
      setIntroOpen(true);
      return;
    }
    setPopoverOpen((v) => !v);
  }

  function dismissIntro() {
    if (typeof window !== "undefined") localStorage.setItem(INTRO_KEY, "true");
    setIntroOpen(false);
    setPopoverOpen(true);
  }

  const btnStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "none",
    border: "none",
    padding: "4px 8px",
    cursor: "pointer",
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-body-sm)",
    color: "var(--color-foreground)",
    opacity: loading ? 0.5 : 1,
  };

  // EK37 — Render nothing when AI features are off (or loading).
  // null while resolving prevents a flash of the badge on slow networks.
  if (aiEnabled !== true) return null;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={handleTap} style={btnStyle} aria-label="Credits balance">
        <span>{balance}</span>
        <Sparkles size={14} strokeWidth={1.5} style={{ color: "var(--accent, var(--gold))" }} />
      </button>

      {popoverOpen && (
        <div
          role="dialog"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: "var(--z-popover, 70)" as unknown as number,
            minWidth: 220,
            padding: 14,
            borderRadius: 12,
            background: "var(--surface-elevated)",
            border: "1px solid var(--border-subtle, color-mix(in oklch, var(--gold) 18%, transparent))",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            color: "var(--color-foreground)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-display, 32px)",
              lineHeight: 1,
              color: "var(--color-foreground)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {balance}
            <Sparkles size={20} strokeWidth={1.5} style={{ color: "var(--accent, var(--gold))" }} />
          </div>
          {nextRefillAt && (
            <div
              style={{
                marginTop: 8,
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                opacity: 0.7,
              }}
            >
              Next refill: {fmtDate(nextRefillAt)}
            </div>
          )}
          {subscriptionType && (
            <div
              style={{
                marginTop: 2,
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                opacity: 0.6,
              }}
            >
              {subscriptionType}
            </div>
          )}
          <Link
            to="/credits"
            onClick={() => setPopoverOpen(false)}
            style={{
              display: "inline-block",
              marginTop: 10,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--accent, var(--gold))",
            }}
          >
            Get more →
          </Link>
        </div>
      )}

      {introOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setIntroOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 420,
              width: "100%",
              padding: 20,
              borderRadius: 16,
              background: "var(--surface-elevated)",
              border: "1px solid var(--border-subtle, color-mix(in oklch, var(--gold) 18%, transparent))",
              color: "var(--color-foreground)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-sm)",
                color: "var(--gold)",
              }}
            >
              <Sparkles size={18} strokeWidth={1.5} />
              Credits
            </div>
            <p
              style={{
                marginTop: 10,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                lineHeight: 1.5,
                opacity: 0.85,
              }}
            >
              Credits power the AI features in Tarot Seed — each deep reading,
              lens, or memory pull uses a small amount. Your balance refills
              automatically with your subscription. Tap the credits indicator
              any time to see your balance.
            </p>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button
                type="button"
                onClick={dismissIntro}
                style={{
                  background: "none",
                  border: "none",
                  padding: "6px 0",
                  cursor: "pointer",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body)",
                  color: "var(--accent, var(--gold))",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}