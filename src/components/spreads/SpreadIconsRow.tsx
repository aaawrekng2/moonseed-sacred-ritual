import { type ReactNode } from "react";
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
];

export function SpreadIconsRow({
  onSelect,
}: {
  onSelect?: (spread: SpreadMode) => void;
}) {
  // EG-3 — hover tooltips removed. The first-time onboarding hint
  // ("Tap a draw type to begin.") is mounted from Home via the shared
  // <Hint /> component, anchored to this row. Per-spread sr-only hints
  // remain for screen readers.
  return (
    <div
      className="grid grid-cols-4 px-6 pb-4"
      style={{
        opacity: "var(--ro-plus-20)",
        maxWidth: 380,
        width: "100%",
        margin: "0 auto",
      }}
    >
      {SPREADS.map(({ id, label, Glyph, hint: spreadHint }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect?.(id)}
          aria-describedby={`spread-hint-${id}`}
          className={cn(
            "flex flex-col items-center justify-end gap-1.5 py-2 transition-colors",
            "text-muted-foreground hover:text-gold focus:text-gold focus:outline-none",
          )}
        >
          <span className="flex h-5 items-center justify-center">
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
  );
}