import { type ReactNode } from "react";

/**
 * EJ — generic wrapper for the 2-column overview grid. Tappable; calls
 * `onTap` (consumers log analytics / navigate). No visible borders per
 * the EI-3 frame-removal lesson — relies on surface contrast + shadow.
 */
export function InsightCard({
  title,
  caption,
  children,
  onTap,
}: {
  title: string;
  caption?: ReactNode;
  children: ReactNode;
  onTap?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full flex-col items-stretch gap-3 p-4 text-left transition-opacity hover:opacity-95"
      style={{
        background: "var(--surface-card)",
        borderRadius: 18,
        boxShadow: "0 1px 3px color-mix(in oklch, var(--cosmos, #0a0a14) 25%, transparent)",
        minHeight: 160,
      }}
    >
      <header
        className="uppercase"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption, 0.7rem)",
          letterSpacing: "0.18em",
          color: "var(--color-foreground)",
          opacity: 0.55,
        }}
      >
        {title}
      </header>
      <div className="flex-1">{children}</div>
      {caption && (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.75,
            lineHeight: 1.4,
          }}
        >
          {caption}
        </div>
      )}
    </button>
  );
}