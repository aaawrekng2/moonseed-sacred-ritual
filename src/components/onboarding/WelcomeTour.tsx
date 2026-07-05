/**
 * v2.90 — Home-screen welcome tour. Replaces the old centered WelcomeModal.
 *
 * A coach-mark walkthrough that anchors to real home-screen elements via
 * [data-tour="..."] selectors and steps a box + directional arrow through
 * them (top menu → moon carousel → moon ladder → draw types). It fires from
 * index.tsx once the splash hero card has landed, and shows every visit until
 * the seeker taps "Don't show again" (hard-dismissed via the shared hint
 * store: localStorage for anonymous, user_preferences for signed-in).
 *
 * If the moon carousel is turned off in settings, the carousel + ladder steps
 * are skipped so the tour never points at something that isn't there.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

type TourStep = {
  key: string;
  target: string;
  placement: "above" | "below";
  title: string;
  body: string;
};

type Props = {
  open: boolean;
  showCarousel: boolean;
  /** Completed or tapped away for this visit (re-greets next visit). */
  onFinish: () => void;
  /** Permanent dismiss. */
  onDontShowAgain: () => void;
};

const footerBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "4px 0",
  cursor: "pointer",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption, 0.8rem)",
  color: "var(--color-foreground)",
  opacity: 0.6,
};

export function WelcomeTour({
  open,
  showCarousel,
  onFinish,
  onDontShowAgain,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const steps: TourStep[] = [
    {
      key: "top-menu",
      target: '[data-tour="top-menu"]',
      placement: "below",
      title: "Welcome to Tarot Seed",
      body: "Your menu lives up here — Journal, Insights, Stories, and Settings, anytime.",
    },
    ...(showCarousel
      ? ([
          {
            key: "carousel",
            target: '[data-tour="moon-carousel"]',
            placement: "below",
            title: "Your moon carousel",
            body: "Today\u2019s phase at a glance. Tap \u201cSet location\u201d for accurate moonrise and moonset times.",
          },
          {
            key: "ladder",
            target: '[data-tour="moon-carousel"]',
            placement: "below",
            title: "The moon ladder",
            body: "The moons at the far left and right jump to new and full moons \u2014 tap right for upcoming dates, left for past ones.",
          },
        ] as TourStep[])
      : []),
    {
      key: "draw",
      target: '[data-tour="draw-types"]',
      placement: "above",
      title: "Choose a draw",
      body: "When you\u2019re ready, pick a draw type to begin.",
    },
  ];

  const total = steps.length;
  const current = steps[Math.min(step, total - 1)];

  const targetSel = current?.target ?? "";
  useLayoutEffect(() => {
    if (!open || !targetSel) return;
    let raf = 0;
    let count = 0;
    // v2.91 — measure into state ONLY when the rect actually changed, so an
    // identical measurement can't trigger a re-render. That self-feeding
    // setRect, plus the old tick/scroll cycle and the fresh `current` object
    // in the deps, caused React #185 (max update depth) on load.
    const measureOnce = () => {
      const el = document.querySelector(targetSel);
      const r = el ? el.getBoundingClientRect() : null;
      setRect((prev) => {
        if (!r) return prev === null ? prev : null;
        if (
          prev &&
          prev.top === r.top &&
          prev.left === r.left &&
          prev.width === r.width &&
          prev.height === r.height
        ) {
          return prev;
        }
        return r;
      });
    };
    const loop = () => {
      measureOnce();
      count += 1;
      if (count < 8) raf = requestAnimationFrame(loop);
    };
    loop();
    // Passive remeasure on real resize/scroll; measureOnce bails when nothing
    // changed, so these can never feed themselves.
    const onWin = () => measureOnce();
    window.addEventListener("resize", onWin, { passive: true });
    window.addEventListener("scroll", onWin, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, step, targetSel]);

  if (!open || !mounted || typeof document === "undefined" || !current) {
    return null;
  }

  const isLast = step >= total - 1;
  const next = () => (isLast ? onFinish() : setStep((s) => s + 1));

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const boxW = Math.min(300, vw - 32);
  const gap = 14;
  const targetCx = rect ? rect.left + rect.width / 2 : vw / 2;
  let boxLeft = targetCx - boxW / 2;
  boxLeft = Math.max(16, Math.min(boxLeft, vw - boxW - 16));

  const arrow: "up" | "down" = current.placement === "below" ? "up" : "down";
  const boxVertical: React.CSSProperties = !rect
    ? { top: Math.max(16, vh / 2 - 90) }
    : current.placement === "below"
      ? { top: Math.max(16, Math.min(rect.bottom + gap, vh - 200)) }
      : { bottom: Math.max(16, Math.min(vh - rect.top + gap, vh - 200)) };

  const arrowLeft = Math.max(
    14,
    Math.min(targetCx - boxLeft - 8, boxW - 24),
  );

  const node = (
    <div style={{ position: "fixed", inset: 0, zIndex: 12000 }}>
      {/* Modal catcher — blocks page interaction during the tour. */}
      <div style={{ position: "absolute", inset: 0 }} />
      {/* Spotlight: dim everything except the target (falls back to a full
          dim if the target isn't on screen this step). */}
      {rect ? (
        <div
          style={{
            position: "absolute",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 12,
            border: "1.5px solid var(--accent, #d9b25f)",
            boxShadow: "0 0 0 9999px rgba(6,4,16,0.68)",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(6,4,16,0.68)",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Coach box */}
      <div
        style={{
          position: "absolute",
          left: boxLeft,
          ...boxVertical,
          width: boxW,
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 14,
          padding: 16,
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
          display: "grid",
          gap: 12,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            width: 0,
            height: 0,
            left: arrowLeft,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            ...(arrow === "up"
              ? { top: -8, borderBottom: "8px solid var(--surface-card)" }
              : { bottom: -8, borderTop: "8px solid var(--surface-card)" }),
          }}
        />
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md, 20px)",
            color: "var(--color-foreground)",
          }}
        >
          {current.title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body, 15px)",
            lineHeight: 1.55,
            color: "var(--color-foreground)",
            opacity: 0.85,
          }}
        >
          {current.body}
        </div>
        <div
          style={{ display: "flex", justifyContent: "center", gap: 6 }}
          aria-hidden="true"
        >
          {steps.map((_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background:
                  i === step
                    ? "var(--accent, #d9b25f)"
                    : "var(--color-foreground)",
                opacity: i === step ? 1 : 0.25,
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button type="button" onClick={onDontShowAgain} style={footerBtn}>
            Don't show again
          </button>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                style={footerBtn}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              style={{
                ...footerBtn,
                color: "var(--accent, #d9b25f)",
                fontSize: "var(--text-body, 16px)",
                opacity: 1,
              }}
            >
              {isLast ? "Begin →" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
