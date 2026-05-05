/**
 * Community Themes — curated, named (gradient + accent) presets that
 * apply instantly when tapped. Stored selection persists in
 * localStorage under `moonseed:community-theme` so it survives reload
 * without a DB migration. Applying a community theme also writes the
 * gradient + accent through to user_preferences via the caller.
 */
import type { ThemeFont } from "@/lib/use-saved-themes";

export type CommunityTheme = {
  key: string;
  name: string;
  tagline: string;
  recommendedFont?: ThemeFont;

  // Page background (gradient)
  bgLeft: string;
  bgRight: string;

  // Surfaces — cards, forms, dialogs, popups sit on these.
  surface: string;
  surfaceElevated: string;

  // Borders
  borderSubtle: string;
  borderDefault: string;

  // Text
  foreground: string;
  foregroundMuted: string;

  // Page background — the bottom-most layer behind the gradient.
  // Components that read var(--background) (modals, full-screen routes, sticky
  // headers using a 92% mix) need a theme-aware value, not the :root default.
  background: string;

  // Card surface — used by shadcn-style components and any surface that
  // reads var(--card). Usually equal to surface but kept separate so future
  // themes can differentiate.
  card: string;

  // Stronger and weaker muted-foreground variants. The base
  // foregroundMuted covers the common case; these two cover the edge
  // cases where text needs slightly more or slightly less presence than
  // the standard muted (used in Settings and ThemesTab labels).
  foregroundMutedStrong: string;
  foregroundMutedWeak: string;

  // Surface for sticky headers, drawer panels, and any chrome that needs
  // to sit slightly recessed from the page background. Replaces the
  // hardcoded oklch(0.08 0.03 280) and oklch(0.10 0.03 280) literals.
  surfaceOverlay: string;

  // Accent — primary actions, focus rings, selection. NOT body text.
  accent: string;
  accentForeground: string;

  // Popover/dropdown surfaces — used by shadcn-style popovers, dropdowns,
  // and any floating panel that sits over the page. Usually equal to
  // surfaceElevated but kept separate so future themes can differentiate.
  popover: string;
  popoverForeground: string;

  // Form input surface — search bars, text fields, selects.
  input: string;

  // Foreground/text on a destructive (error) background.
  destructiveForeground: string;

  // State indicator tokens — the foundation for the active-state audit.
  // Two pairs:
  //   *-passive: current-tab markers, active-filter chips, current
  //     selection highlights. Anything that's passively showing state.
  //   *-action: primary buttons, CTAs, CLEAR FILTERS button. Anything
  //     that's actively asking for a tap.
  // Production themes default to: passive = neutral, action = accent.
  // Audit themes override these to test alternative rules.
  stateActiveBgPassive: string;
  stateActiveFgPassive: string;

  /**
   * Optional radial atmosphere overlay color. Themes that want a "glow"
   * set this to an 8-digit RGBA hex (saturated mid-luminance hue with
   * low alpha baked in). Themes that want a clean flat look (Daybreak,
   * Nightfall) leave it undefined.
   */
  atmosphereOverlay?: string;
};

export const COMMUNITY_THEMES: ReadonlyArray<CommunityTheme> = [
  {
    key: "mystic-default", name: "Mystic",
    tagline: "Where every reading begins.",
    recommendedFont: "Cormorant Garamond",
    bgLeft: "#1e1b4b", bgRight: "#2d1b69",
    surface: "#252056", surfaceElevated: "#2d2664",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#f5f3ff", foregroundMuted: "#c4b8e8",
    background: "#1e1b4b", card: "#252056",
    foregroundMutedStrong: "#e0d8f9", foregroundMutedWeak: "#9989c4",
    surfaceOverlay: "#1a1742",
    accent: "#f59e0b", accentForeground: "#1e1b4b",
    atmosphereOverlay: "#5b21b66b",
    popover: "#2d2664", popoverForeground: "#f5f3ff",
    input: "#252056",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#e0d8f9",
  },
  {
    key: "midnight-oracle", name: "Midnight Oracle",
    tagline: "The dark night. Where the unconscious speaks.",
    recommendedFont: "Cinzel",
    bgLeft: "#0a0a0f", bgRight: "#1e0a3c",
    surface: "#16162e", surfaceElevated: "#1e1e3d",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#ede9fe", foregroundMuted: "#a78bfa",
    background: "#0a0a0f", card: "#16162e",
    foregroundMutedStrong: "#dcd5fb", foregroundMutedWeak: "#7c6cb0",
    surfaceOverlay: "#0d0d1a",
    accent: "#a78bfa", accentForeground: "#0a0a0f",
    atmosphereOverlay: "#4c1d9540",
    popover: "#1e1e3d", popoverForeground: "#ede9fe",
    input: "#16162e",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#dcd5fb",
  },
  {
    key: "blood-moon", name: "Blood Moon",
    tagline: "Transformation. The reading that changes everything.",
    recommendedFont: "Cinzel",
    bgLeft: "#1a0000", bgRight: "#5c0000",
    surface: "#330505", surfaceElevated: "#421010",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#fff5f0", foregroundMuted: "#fca5a5",
    background: "#1a0000", card: "#330505",
    foregroundMutedStrong: "#ffe4dc", foregroundMutedWeak: "#c97070",
    surfaceOverlay: "#150000",
    accent: "#fb7185", accentForeground: "#1a0000",
    atmosphereOverlay: "#7f1d1d66",
    popover: "#421010", popoverForeground: "#fff5f0",
    input: "#330505",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#ffe4dc",
  },
  {
    key: "citrine-dawn", name: "Citrine Dawn",
    tagline: "Awakening. The first light of new understanding.",
    recommendedFont: "Playfair Display",
    bgLeft: "#1a1308", bgRight: "#3d2c0a",
    surface: "#2a1f0c", surfaceElevated: "#372a14",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#fefce8", foregroundMuted: "#fde68a",
    background: "#1a1308", card: "#2a1f0c",
    foregroundMutedStrong: "#fef3c7", foregroundMutedWeak: "#bfa566",
    surfaceOverlay: "#150f06",
    accent: "#facc15", accentForeground: "#1a1308",
    atmosphereOverlay: "#a162074d",
    popover: "#372a14", popoverForeground: "#fefce8",
    input: "#2a1f0c",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#fef3c7",
  },
  {
    key: "cups-tide", name: "Cups & Tide",
    tagline: "Water. Emotion. The deep currents of the heart.",
    recommendedFont: "Playfair Display",
    bgLeft: "#001a2c", bgRight: "#042234",
    surface: "#0a2a3f", surfaceElevated: "#10374f",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#ecfeff", foregroundMuted: "#a5f3fc",
    background: "#001a2c", card: "#0a2a3f",
    foregroundMutedStrong: "#cffafe", foregroundMutedWeak: "#67c5d4",
    surfaceOverlay: "#001423",
    accent: "#67e8f9", accentForeground: "#001a2c",
    atmosphereOverlay: "#0e74904d",
    popover: "#10374f", popoverForeground: "#ecfeff",
    input: "#0a2a3f",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#cffafe",
  },
  {
    key: "wands-ember", name: "Wands & Ember",
    tagline: "Fire. Will. The spark that moves you.",
    recommendedFont: "Cinzel",
    bgLeft: "#1c0a0a", bgRight: "#3d1408",
    surface: "#2a1410", surfaceElevated: "#3a1d18",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#fff7ed", foregroundMuted: "#fed7aa",
    background: "#1c0a0a", card: "#2a1410",
    foregroundMutedStrong: "#ffedd5", foregroundMutedWeak: "#c98a5a",
    surfaceOverlay: "#170707",
    accent: "#fb923c", accentForeground: "#1c0a0a",
    atmosphereOverlay: "#9a34124d",
    popover: "#3a1d18", popoverForeground: "#fff7ed",
    input: "#2a1410",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#ffedd5",
  },
  {
    key: "pentacles-moss", name: "Pentacles & Moss",
    tagline: "Earth. Patience. The slow work of building.",
    recommendedFont: "Lora",
    bgLeft: "#0a1a14", bgRight: "#16352b",
    surface: "#102a20", surfaceElevated: "#173a2c",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#ecfdf5", foregroundMuted: "#86efac",
    background: "#0a1a14", card: "#102a20",
    foregroundMutedStrong: "#d1fae5", foregroundMutedWeak: "#5a9d76",
    surfaceOverlay: "#07150f",
    accent: "#34d399", accentForeground: "#0a1a14",
    atmosphereOverlay: "#1665344d",
    popover: "#173a2c", popoverForeground: "#ecfdf5",
    input: "#102a20",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#d1fae5",
  },
  {
    key: "peacocks-tail", name: "Peacock\u2019s Tail",
    tagline: "The shimmering threshold. All colors before unity.",
    recommendedFont: "Playfair Display",
    bgLeft: "#0d0a1f", bgRight: "#2a0a3d",
    surface: "#1a1430", surfaceElevated: "#241a3f",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#faf5ff", foregroundMuted: "#d8b4fe",
    background: "#0d0a1f", card: "#1a1430",
    foregroundMutedStrong: "#f3e8ff", foregroundMutedWeak: "#9b7bcc",
    surfaceOverlay: "#0a0719",
    accent: "#c084fc", accentForeground: "#0d0a1f",
    atmosphereOverlay: "#6b21a866",
    popover: "#241a3f", popoverForeground: "#faf5ff",
    input: "#1a1430",
    destructiveForeground: "#fff5f0",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#f3e8ff",
  },
  {
    key: "nightfall", name: "Nightfall",
    tagline: "Stillness, after sundown.",
    recommendedFont: "Raleway",
    bgLeft: "#000000", bgRight: "#1d1d1f",
    surface: "#1c1c1e", surfaceElevated: "#2c2c2e",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#f5f5f7", foregroundMuted: "#aeaeb2",
    background: "#000000", card: "#1c1c1e",
    foregroundMutedStrong: "#d1d1d6", foregroundMutedWeak: "#8e8e93",
    surfaceOverlay: "#0a0a0a",
    accent: "#0a84ff", accentForeground: "#ffffff",
    popover: "#2c2c2e", popoverForeground: "#f5f5f7",
    input: "#1c1c1e",
    destructiveForeground: "#ffffff",
    stateActiveBgPassive: "#ffffff14",
    stateActiveFgPassive: "#d1d1d6",
  },
  {
    key: "daybreak", name: "Daybreak",
    tagline: "Daylight clarity. Nothing in the way.",
    recommendedFont: "Raleway",
    bgLeft: "#ffffff", bgRight: "#f5f5f7",
    surface: "#ffffff", surfaceElevated: "#fbfbfd",
    borderSubtle: "#0000000f", borderDefault: "#0000001f",
    foreground: "#1d1d1f", foregroundMuted: "#6e6e73",
    background: "#ffffff", card: "#ffffff",
    foregroundMutedStrong: "#3a3a3c", foregroundMutedWeak: "#8e8e93",
    surfaceOverlay: "#f5f5f7",
    accent: "#0066cc", accentForeground: "#ffffff",
    popover: "#ffffff", popoverForeground: "#1d1d1f",
    input: "#f5f5f7",
    destructiveForeground: "#ffffff",
    stateActiveBgPassive: "#0000000a",
    stateActiveFgPassive: "#3a3a3c",
  },
  // FT-1 — Audit themes. Dev-only. Inherit Mystic's base palette but
  // override state-active tokens to test alternative rules. Hidden in
  // production via the dev-mode filter in ThemesTab.
  {
    key: "audit-neutral", name: "Audit \u00b7 Neutral",
    tagline: "Dev only — passive states use neutral, not accent.",
    recommendedFont: "Cormorant Garamond",
    bgLeft: "#1e1b4b", bgRight: "#2d1b69",
    surface: "#252056", surfaceElevated: "#2d2664",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#f5f3ff", foregroundMuted: "#c4b8e8",
    background: "#1e1b4b", card: "#252056",
    foregroundMutedStrong: "#e0d8f9", foregroundMutedWeak: "#9989c4",
    surfaceOverlay: "#1a1742",
    accent: "#f59e0b", accentForeground: "#1e1b4b",
    atmosphereOverlay: "#5b21b66b",
    popover: "#2d2664", popoverForeground: "#f5f3ff",
    input: "#252056",
    destructiveForeground: "#fff5f0",
    // The variable under audit — force passive state to a pure neutral
    // (no accent tint at all).
    stateActiveBgPassive: "#ffffff1a",
    stateActiveFgPassive: "#e0d8f9",
  },
  {
    key: "audit-accent", name: "Audit \u00b7 Accent",
    tagline: "Dev only — passive states use the accent color, loud.",
    recommendedFont: "Cormorant Garamond",
    bgLeft: "#1e1b4b", bgRight: "#2d1b69",
    surface: "#252056", surfaceElevated: "#2d2664",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#f5f3ff", foregroundMuted: "#c4b8e8",
    background: "#1e1b4b", card: "#252056",
    foregroundMutedStrong: "#e0d8f9", foregroundMutedWeak: "#9989c4",
    surfaceOverlay: "#1a1742",
    accent: "#f59e0b", accentForeground: "#1e1b4b",
    atmosphereOverlay: "#5b21b66b",
    popover: "#2d2664", popoverForeground: "#f5f3ff",
    input: "#252056",
    destructiveForeground: "#fff5f0",
    // The variable under audit — force passive state to use the accent
    // color heavily (mimicking Material Design defaults).
    stateActiveBgPassive: "#f59e0b3d",
    stateActiveFgPassive: "#f59e0b",
  },
];

/**
 * BQ — Resolve a stored community-theme key against the current array.
 * If the key no longer exists (e.g. legacy 'blood-moon'), clear storage
 * and return the default Mystic theme.
 */
export function resolveCommunityTheme(
  storedKey: string | null,
): CommunityTheme | null {
  if (!storedKey) return null;
  const found = COMMUNITY_THEMES.find((t) => t.key === storedKey);
  if (found) return found;
  setStoredCommunityTheme(null);
  return COMMUNITY_THEMES.find((t) => t.key === "mystic-default") ?? null;
}

const STORAGE_KEY = "moonseed:community-theme";

export function getStoredCommunityTheme(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredCommunityTheme(key: string | null) {
  if (typeof window === "undefined") return;
  if (key == null) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, key);
}
