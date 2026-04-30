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

  // Accent — primary actions, focus rings, selection. NOT body text.
  accent: string;
  accentForeground: string;

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
    accent: "#f59e0b", accentForeground: "#1e1b4b",
    atmosphereOverlay: "#5b21b66b",
  },
  {
    key: "midnight-oracle", name: "Midnight Oracle",
    tagline: "The dark night. Where the unconscious speaks.",
    recommendedFont: "Cinzel",
    bgLeft: "#0a0a0f", bgRight: "#1e0a3c",
    surface: "#16162e", surfaceElevated: "#1e1e3d",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#ede9fe", foregroundMuted: "#a78bfa",
    accent: "#a78bfa", accentForeground: "#0a0a0f",
    atmosphereOverlay: "#4c1d9540",
  },
  {
    key: "blood-moon", name: "Blood Moon",
    tagline: "Transformation. The reading that changes everything.",
    recommendedFont: "Cinzel",
    bgLeft: "#1a0000", bgRight: "#5c0000",
    surface: "#330505", surfaceElevated: "#421010",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#fff5f0", foregroundMuted: "#fca5a5",
    accent: "#fb7185", accentForeground: "#1a0000",
    atmosphereOverlay: "#7f1d1d66",
  },
  {
    key: "citrine-dawn", name: "Citrine Dawn",
    tagline: "Awakening. The first light of new understanding.",
    recommendedFont: "Playfair Display",
    bgLeft: "#1a1308", bgRight: "#3d2c0a",
    surface: "#2a1f0c", surfaceElevated: "#372a14",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#fefce8", foregroundMuted: "#fde68a",
    accent: "#facc15", accentForeground: "#1a1308",
    atmosphereOverlay: "#a162074d",
  },
  {
    key: "cups-tide", name: "Cups & Tide",
    tagline: "Water. Emotion. The deep currents of the heart.",
    recommendedFont: "Playfair Display",
    bgLeft: "#001a2c", bgRight: "#042234",
    surface: "#0a2a3f", surfaceElevated: "#10374f",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#ecfeff", foregroundMuted: "#a5f3fc",
    accent: "#67e8f9", accentForeground: "#001a2c",
    atmosphereOverlay: "#0e74904d",
  },
  {
    key: "wands-ember", name: "Wands & Ember",
    tagline: "Fire. Will. The spark that moves you.",
    recommendedFont: "Cinzel",
    bgLeft: "#1c0a0a", bgRight: "#3d1408",
    surface: "#2a1410", surfaceElevated: "#3a1d18",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#fff7ed", foregroundMuted: "#fed7aa",
    accent: "#fb923c", accentForeground: "#1c0a0a",
    atmosphereOverlay: "#9a34124d",
  },
  {
    key: "pentacles-moss", name: "Pentacles & Moss",
    tagline: "Earth. Patience. The slow work of building.",
    recommendedFont: "Lora",
    bgLeft: "#0a1a14", bgRight: "#16352b",
    surface: "#102a20", surfaceElevated: "#173a2c",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#ecfdf5", foregroundMuted: "#86efac",
    accent: "#34d399", accentForeground: "#0a1a14",
    atmosphereOverlay: "#1665344d",
  },
  {
    key: "peacocks-tail", name: "Peacock\u2019s Tail",
    tagline: "The shimmering threshold. All colors before unity.",
    recommendedFont: "Playfair Display",
    bgLeft: "#0d0a1f", bgRight: "#2a0a3d",
    surface: "#1a1430", surfaceElevated: "#241a3f",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#faf5ff", foregroundMuted: "#d8b4fe",
    accent: "#c084fc", accentForeground: "#0d0a1f",
    atmosphereOverlay: "#6b21a866",
  },
  {
    key: "nightfall", name: "Nightfall",
    tagline: "Stillness, after sundown.",
    recommendedFont: "Raleway",
    bgLeft: "#000000", bgRight: "#1d1d1f",
    surface: "#1c1c1e", surfaceElevated: "#2c2c2e",
    borderSubtle: "#ffffff14", borderDefault: "#ffffff1f",
    foreground: "#f5f5f7", foregroundMuted: "#aeaeb2",
    accent: "#0a84ff", accentForeground: "#ffffff",
  },
  {
    key: "daybreak", name: "Daybreak",
    tagline: "Daylight clarity. Nothing in the way.",
    recommendedFont: "Raleway",
    bgLeft: "#ffffff", bgRight: "#f5f5f7",
    surface: "#ffffff", surfaceElevated: "#fbfbfd",
    borderSubtle: "#0000000f", borderDefault: "#0000001f",
    foreground: "#1d1d1f", foregroundMuted: "#6e6e73",
    accent: "#0066cc", accentForeground: "#ffffff",
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
