import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SpreadMode } from "@/lib/spreads";

const STAR_PATH =
  "M12 2 L13.6 10.4 L22 12 L13.6 13.6 L12 22 L10.4 13.6 L2 12 L10.4 10.4 Z";

function StarGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

function ThreeStars() {
  return (
    <span className="flex items-center gap-1">
      <StarGlyph size={10} />
      <StarGlyph size={12} />
      <StarGlyph size={10} />
    </span>
  );
}

function CelticGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function DiamondGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M12 2 L22 12 L12 22 L2 12 Z" />
      <path d="M12 7 L17 12 L12 17 L7 12 Z" opacity="0.55" />
    </svg>
  );
}

// 9-6-O — Custom: small grid glyph hinting "pick how many".
function CustomGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" opacity="0.4" />
    </svg>
  );
}

const SPREADS: {
  id: SpreadMode;
  label: string;
  Glyph: () => ReactNode;
  hint: string;
}[] = [
  {
    id: "single",
    label: "Single",
    Glyph: () => <StarGlyph size={14} />,
    hint: "One card. Today's whisper.",
  },
  {
    id: "three",
    label: "Three",
    Glyph: ThreeStars,
    hint: "Three cards. Past · present · path.",
  },
  {
    id: "celtic",
    label: "Celtic",
    Glyph: CelticGlyph,
    hint: "Ten cards. The full Celtic Cross.",
  },
  {
    id: "yes_no",
    label: "Yes / No",
    Glyph: DiamondGlyph,
    hint: "Quick directional pull.",
  },
  {
    id: "custom",
    label: "Custom",
    Glyph: CustomGlyph,
    hint: "Pick how many cards (1-10).",
  },
];

export function SpreadIconsRow({
  onSelect,
}: {
  onSelect?: (spread: SpreadMode) => void;
}) {
  // Q93 #6 — Yes/No disclaimer modal.
  // "Got it" dismisses for the session (state only).
  // "Don't show for 2 weeks" stores an expiry timestamp in localStorage.
  const [showYesNoModal, setShowYesNoModal] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const handleSelect = (id: SpreadMode) => {
    if (id === "yes_no" && !sessionDismissed) {
      try {
        const raw = window.localStorage.getItem("tarotseed:yesno-disclaimer-until");
        const until = raw ? Number(raw) : 0;
        if (!Number.isFinite(until) || Date.now() >= until) {
          setShowYesNoModal(true);
          return;
        }
      } catch {
        setShowYesNoModal(true);
        return;
      }
    }
    onSelect?.(id);
  };
  // EG-3 — hover tooltips removed. The first-time onboarding hint
  // ("Tap a draw type to begin.") is mounted from Home via the shared
  // <Hint /> component, anchored to this row. Per-spread sr-only hints
  // remain for screen readers.
  return (
    <>
    <div
      className="flex justify-between px-4 pb-4"
      style={{
        opacity: "var(--ro-plus-20)",
        maxWidth: 480,
        width: "100%",
        margin: "0 auto",
      }}
    >
      {SPREADS.map(({ id, label, Glyph, hint: spreadHint }) => (
        <button
          key={id}
          type="button"
          onClick={() => handleSelect(id)}
          aria-describedby={`spread-hint-${id}`}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 py-2 transition-colors",
            "text-muted-foreground hover:text-gold focus:text-gold focus:outline-none",
          )}
        >
          {/* 9-6-Y — fixed glyph box so SVGs with mismatched intrinsic
              heights (Yes/No previously rode high) all sit at the same
              vertical center. */}
          <span
            className="flex items-center justify-center"
            style={{ width: 28, height: 28 }}
          >
            <Glyph />
          </span>
          <span className="clarity-label font-display text-[11px] italic tracking-wide">
            {label}
          </span>
          <span id={`spread-hint-${id}`} className="sr-only">
            {spreadHint}
          </span>
        </button>
      ))}
    </div>
    {showYesNoModal && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="yesno-disclaimer-title"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          background: "rgba(0,0,0,0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
        onClick={() => setShowYesNoModal(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 16,
            maxWidth: 380,
            width: "100%",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h2
            id="yesno-disclaimer-title"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-lg)",
              color: "var(--gold)",
              margin: 0,
            }}
          >
            A note about Yes/No readings
          </h2>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body)",
              lineHeight: 1.6,
              color: "var(--foreground)",
              opacity: 0.9,
              margin: 0,
            }}
          >
            Yes/No readings are for reflection and entertainment only. They
            offer a moment of pause, not a definitive answer. Never use a
            tarot reading to make important life, health, financial, or
            legal decisions. The cards are a mirror, not an oracle.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setSessionDismissed(true);
                setShowYesNoModal(false);
                onSelect?.("yes_no");
              }}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                color: "var(--gold)",
                background: "none",
                border: "none",
                padding: "8px 0",
                cursor: "pointer",
              }}
            >
              Got it
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const expiry = Date.now() + 14 * 24 * 60 * 60 * 1000;
                  window.localStorage.setItem(
                    "tarotseed:yesno-disclaimer-until",
                    String(expiry),
                  );
                } catch {
                  // ignore
                }
                setSessionDismissed(true);
                setShowYesNoModal(false);
                onSelect?.("yes_no");
              }}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--muted-foreground)",
                background: "none",
                border: "none",
                padding: "4px 0",
                cursor: "pointer",
                opacity: 0.7,
              }}
            >
              Don't show for 2 weeks
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}