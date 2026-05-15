/**
 * Q35b — First-run welcome modal. Shown once per signed-in seeker
 * (gated by user_preferences.welcome_modal_seen). Three slides
 * advanced via a single CTA button. Replayable from Settings via
 * the "tarotseed:show-welcome" custom event.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Wand2, BookOpen, Settings as SettingsIcon } from "lucide-react";

type Props = { open: boolean; onClose: () => void };

export function WelcomeModal({ open, onClose }: Props) {
  const [slide, setSlide] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [fade, setFade] = useState(1);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) {
      setSlide(0);
      setFade(1);
    }
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  const next = () => {
    if (slide >= 2) {
      onClose();
      return;
    }
    setFade(0);
    window.setTimeout(() => {
      setSlide((s) => Math.min(2, s + 1));
      setFade(1);
    }, 200);
  };

  const titleStyle: React.CSSProperties = {
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-heading-lg, 26px)",
    color: "var(--color-foreground, var(--foreground))",
    margin: 0,
    textAlign: "center",
  };
  const bodyStyle: React.CSSProperties = {
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-body, 16px)",
    lineHeight: 1.6,
    color: "var(--color-foreground, var(--foreground))",
    opacity: 0.8,
    margin: 0,
    textAlign: "center",
  };

  const Item = ({
    icon,
    text,
  }: {
    icon: React.ReactNode;
    text: string;
  }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{ color: "var(--accent)", opacity: 0.8, marginTop: 2 }}>
        {icon}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm, 14px)",
          color: "var(--color-foreground, var(--foreground))",
          opacity: 0.85,
          lineHeight: 1.5,
        }}
      >
        {text}
      </span>
    </div>
  );

  const slides = [
    <div key="s0" style={{ display: "grid", gap: 18 }}>
      <h2 style={titleStyle}>Welcome to Tarot Seed.</h2>
      <p style={bodyStyle}>
        Tarot that remembers you. Draw cards, reflect, and watch your
        patterns emerge over time.
      </p>
      <div
        style={{
          textAlign: "center",
          fontSize: "var(--text-heading-lg, 26px)",
          color: "var(--gold)",
          opacity: 0.7,
        }}
      >
        ☽
      </div>
    </div>,
    <div key="s1" style={{ display: "grid", gap: 18 }}>
      <h2 style={titleStyle}>Draw. Reflect. Remember.</h2>
      <div style={{ display: "grid", gap: 12 }}>
        <Item
          icon={<Wand2 size={16} />}
          text="Pull cards from the home screen whenever you feel called."
        />
        <Item
          icon={<BookOpen size={16} />}
          text="Your readings are saved to your journal automatically."
        />
        <Item
          icon={<Wand2 size={16} />}
          text="Patterns emerge in Insights as you read over time."
        />
      </div>
    </div>,
    <div key="s2" style={{ display: "grid", gap: 18 }}>
      <h2 style={titleStyle}>Help us grow.</h2>
      <p style={bodyStyle}>
        Found a bug or have an idea? We read every piece of feedback. You
        can reach us anytime in Settings → Feedback.
      </p>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 999,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <SettingsIcon
            size={14}
            style={{ color: "var(--color-foreground)", opacity: 0.6 }}
          />
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              color: "var(--gold)",
              fontSize: "var(--text-body-sm, 14px)",
            }}
          >
            Feedback
          </span>
        </span>
      </div>
    </div>,
  ];

  const node = (
    <div
      className="modal-scrim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal, 1000)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4, 16px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Tarot Seed"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-xl, 20px)",
          padding: "var(--space-6, 24px)",
          display: "grid",
          gap: 20,
        }}
      >
        <div
          style={{
            transition: "opacity 200ms ease",
            opacity: fade,
            minHeight: 180,
          }}
        >
          {slides[slide]}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 6,
          }}
          aria-hidden="true"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background:
                  i === slide
                    ? "var(--accent)"
                    : "var(--color-foreground, var(--foreground))",
                opacity: i === slide ? 1 : 0.25,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={next}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body, 16px)",
              color: "var(--accent)",
              padding: "4px 0",
            }}
          >
            {slide === 2 ? "Begin →" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}