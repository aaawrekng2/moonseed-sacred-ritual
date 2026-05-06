import type { CSSProperties } from "react";

type EmptyHeroCta = {
  label: string;
  onClick: () => void;
  /** "primary" = rounded-full gold pill (default). "text" =
   * uppercase letterspaced no-background button (used for
   * reset/clear actions like CLEAR FILTERS). */
  variant?: "primary" | "text";
};

type EmptyHeroProps = {
  /** Headline. Italic serif, var(--text-heading-sm), opacity 0.85. */
  title: string;
  /** Optional supporting prose. Italic serif, var(--text-body-sm),
   * opacity 0.7, lineHeight 1.7, max-w-md. */
  subtitle?: string;
  /** Optional call-to-action button. */
  cta?: EmptyHeroCta;
  className?: string;
};

/**
 * FU-16 — Canonical page-level empty state. Used wherever an
 * entire page or tab has nothing to show. For a small empty note
 * inside a section that has other content, use EmptyNote instead.
 */
export function EmptyHero({
  title,
  subtitle,
  cta,
  className = "",
}: EmptyHeroProps) {
  const titleStyle: CSSProperties = {
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-heading-sm)",
    opacity: 0.85,
    lineHeight: 1.5,
  };
  const subtitleStyle: CSSProperties = {
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: "var(--text-body-sm)",
    opacity: 0.7,
    lineHeight: 1.7,
  };
  return (
    <div className={`py-16 text-center ${className}`}>
      <div style={titleStyle}>{title}</div>
      {subtitle && (
        <div className="mx-auto mt-2 max-w-md" style={subtitleStyle}>
          {subtitle}
        </div>
      )}
      {cta && cta.variant === "text" ? (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-6 inline-flex items-center uppercase"
          style={{
            fontFamily: "var(--font-display, var(--font-serif))",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.15em",
            color: "var(--gold)",
          }}
        >
          {cta.label}
        </button>
      ) : cta ? (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-6 inline-flex items-center rounded-full px-4 py-2 text-sm"
          style={{
            background:
              "color-mix(in oklch, var(--gold) 24%, transparent)",
            color: "var(--gold)",
            fontStyle: "italic",
          }}
        >
          {cta.label}
        </button>
      ) : null}
    </div>
  );
}