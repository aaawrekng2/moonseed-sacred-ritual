/**
 * FU-16 — Canonical inline empty state for section-level use.
 * Renders inside a surface-card with modest italic muted text.
 * For page-level empty states use EmptyHero instead.
 */
export function EmptyNote({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg p-4 text-center"
      style={{
        background: "var(--surface-card)",
        fontStyle: "italic",
        fontSize: "var(--text-body-sm)",
        opacity: 0.75,
      }}
    >
      {text}
    </div>
  );
}