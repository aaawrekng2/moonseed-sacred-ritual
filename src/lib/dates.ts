/**
 * FU-17 — Canonical date formatting helpers.
 *
 * Five context-appropriate formats. Use the helper that matches
 * the surface, never call toLocaleDateString directly in component
 * or route code.
 *
 * Specialized helpers (patterns.formatMonthSince,
 * lunation.formatLunationRange, use-timezone.formatTimeInTz,
 * MoonCarousel formatShortDate, MoonFeaturesPage long-month
 * formatDate) live in their respective files — they have
 * specific contexts that don't fit the canonical set.
 */

/**
 * Relative time for compact list contexts. Falls back to an
 * absolute short date past 30 days, since "47w ago" is less
 * useful than "Mar 12, 2025" for old readings.
 */
export function formatTimeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now - then);
  const diffMin = diffMs / 60000;
  const diffH = diffMin / 60;
  const diffD = diffH / 24;
  if (diffMin < 1) return "Just now";
  if (diffH < 1) return `${Math.floor(diffMin)}m ago`;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 2) return "Yesterday";
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)}w ago`;
  return formatDateShort(iso);
}

/**
 * Short date for chart axes and inline contexts. Year only when
 * the date is not in the current calendar year.
 */
export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Full date with year always shown. For headers, formal contexts.
 */
export function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Full date plus time for moments where the exact timestamp matters.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Month + year only, for calendar-style headers.
 */
export function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}