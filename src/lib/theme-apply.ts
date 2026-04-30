/**
 * Phase BS — single source of truth for writing a CommunityTheme's full
 * token set onto the live document. Both the Themes carousel and the
 * sanctuary wand cycler call into here so adding a new token is one edit.
 */
import type { CommunityTheme } from "@/lib/community-themes";

export function applyCommunityTheme(theme: CommunityTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Background gradient
  root.style.setProperty("--bg-gradient-left", theme.bgLeft);
  root.style.setProperty("--bg-gradient-right", theme.bgRight);
  // Surfaces (forms, cards, dialogs, popovers)
  root.style.setProperty("--surface-card", theme.surface);
  root.style.setProperty("--surface-card-hover", theme.surfaceElevated);
  root.style.setProperty("--surface-elevated", theme.surfaceElevated);
  // Borders
  root.style.setProperty("--border-subtle", theme.borderSubtle);
  root.style.setProperty("--border-default", theme.borderDefault);
  root.style.setProperty("--border", theme.borderDefault);
  // Text
  root.style.setProperty("--color-foreground", theme.foreground);
  root.style.setProperty("--foreground", theme.foreground);
  root.style.setProperty("--foreground-muted", theme.foregroundMuted);
  root.style.setProperty("--muted-foreground", theme.foregroundMuted);
  // Accent (used for primary action, focus ring, selection — NOT body text)
  root.style.setProperty("--gold", theme.accent);
  root.style.setProperty("--accent-color", theme.accent);
  root.style.setProperty("--primary", theme.accent);
  root.style.setProperty("--accent-foreground", theme.accentForeground);
  root.style.setProperty("--gold-foreground", theme.accentForeground);
  root.style.setProperty("--ring", `${theme.accent}99`);
}