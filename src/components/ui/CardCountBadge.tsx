/**
 * Q61 — Canonical card count badge.
 * Renders a gold pill with italic serif count text, positioned
 * INSIDE the card image bounds at the bottom-right corner.
 * Three-breakpoint responsive sizing (mobile / tablet / desktop)
 * driven entirely by the `.moonseed-card-badge` CSS class in `styles.css`.
 *
 * Use anywhere a count appears on a card. Parent must have
 * position: relative for the absolute positioning to anchor correctly.
 */
export function CardCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="moonseed-card-badge" aria-label={`${count} appearances`}>
      {count}×
    </span>
  );
}