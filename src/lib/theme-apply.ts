/**
 * Phase BS — single source of truth for writing a CommunityTheme's full
 * token set onto the live document. Both the Themes carousel and the
 * sanctuary wand cycler call into here so adding a new token is one edit.
 */
import type { CommunityTheme } from "@/lib/community-themes";
import { applyHeadingFont } from "@/lib/use-saved-themes";

export function applyCommunityTheme(theme: CommunityTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Background gradient
  root.style.setProperty("--bg-gradient-left", theme.bgLeft);
  root.style.setProperty("--bg-gradient-right", theme.bgRight);
  // BT — atmosphere overlay (radial glow). Themes that opt in supply
  // an 8-digit RGBA hex; .bg-cosmos / --gradient-cosmos read this var.
  // Themes that omit it (Daybreak / Nightfall) get a clean flat
  // gradient because the var falls back to `transparent`.
  if (theme.atmosphereOverlay) {
    root.style.setProperty("--atmosphere-overlay", theme.atmosphereOverlay);
    root.style.setProperty("--atmosphere-enabled", "1");
  } else {
    root.style.removeProperty("--atmosphere-overlay");
    root.style.setProperty("--atmosphere-enabled", "0");
  }
  // Surfaces (forms, cards, dialogs, popovers)
  root.style.setProperty("--surface-card", theme.surface);
  root.style.setProperty("--surface-card-hover", theme.surfaceElevated);
  root.style.setProperty("--surface-elevated", theme.surfaceElevated);
  // Page background — written so any component that reads var(--background)
  // (modals, full-screen routes, the 92% sticky-header mix in journal.tsx)
  // gets the theme value instead of the :root default.
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--color-background", theme.background);
  // Card semantic tokens — shadcn components and Tailwind's bg-card use these.
  root.style.setProperty("--card", theme.card);
  root.style.setProperty("--card-foreground", theme.foreground);
  // Surface overlay — sticky headers, drawer panels, recessed chrome.
  // Replaces the hardcoded oklch(0.08 0.03 280) and oklch(0.10 0.03 280)
  // literals that were leaking dark-mode values into Daybreak.
  root.style.setProperty("--surface-overlay", theme.surfaceOverlay);
  // Muted-foreground variants — strong and weak. Used by Settings and
  // ThemesTab labels. Without these, Daybreak shows cream text on white.
  root.style.setProperty("--muted-foreground-strong", theme.foregroundMutedStrong);
  root.style.setProperty("--muted-foreground-weak", theme.foregroundMutedWeak);
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
  root.style.setProperty("--accent-color", theme.accent);
  root.style.setProperty("--primary", theme.accent);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-foreground", theme.accentForeground);
  root.style.setProperty("--ring", `${theme.accent}99`);
  // FT-1 — popover surfaces (dropdowns, popovers, floating panels)
  root.style.setProperty("--popover", theme.popover);
  root.style.setProperty("--popover-foreground", theme.popoverForeground);
  // FT-1 — form input surface (search bars, text fields, selects)
  root.style.setProperty("--input", theme.input);
  // FT-1 — destructive foreground (text on error backgrounds)
  root.style.setProperty("--destructive-foreground", theme.destructiveForeground);
  // FT-1 — state indicator tokens (foundation for active-state audit).
  // Production default: passive uses neutral, action uses accent.
  // Audit themes override these to test alternative rules.
  root.style.setProperty("--state-active-bg-passive", theme.stateActiveBgPassive);
  root.style.setProperty("--state-active-fg-passive", theme.stateActiveFgPassive);
  // FT-2 — emphasis-state tokens. Used by surfaces that have crossed a
  // threshold and deserve attention (HeroCard when a stalker is detected,
  // future unread badges, etc.). Distinct from state-active-* which is
  // for passive selection indicators. Derived from accent so themes don't
  // need new fields — future themes can add explicit fields if they want
  // emphasis to differ from accent.
  root.style.setProperty("--emphasis-bg-passive", `${theme.accent}3d`); // ~24% alpha
  root.style.setProperty("--emphasis-fg-passive", theme.accent);
  // BT Fix 4A — apply the recommended heading font alongside colors.
  // Font size is intentionally NOT touched: that's a user preference
  // independent of theme.
  if (theme.recommendedFont) {
    applyHeadingFont(theme.recommendedFont);
  }
  // 9-6-W — light themes (Daybreak) need a deeper drop-shadow instead of
  // a gold glow so the placed-card emphasis isn't washed out by a bright
  // background. Other themes inherit the default gold-glow chain defined
  // in styles.css.
  if (theme.key === "daybreak") {
    root.style.setProperty(
      "--card-emphasis-filter",
      "drop-shadow(0 4px 12px rgba(0,0,0,0.35)) drop-shadow(0 8px 24px rgba(0,0,0,0.25))",
    );
  } else {
    root.style.removeProperty("--card-emphasis-filter");
  }
}