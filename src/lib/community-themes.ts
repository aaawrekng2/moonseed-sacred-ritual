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
  bgLeft: string;
  bgRight: string;
  accent: string;
  /** BQ — recommended heading font (informational; tap doesn't change font). */
  recommendedFont?: ThemeFont;
};

export const COMMUNITY_THEMES: ReadonlyArray<CommunityTheme> = [
  {
    key: "mystic-default",
    name: "Mystic",
    tagline: "Where every reading begins.",
    bgLeft: "#1e1b4b",
    bgRight: "#2d1b69",
    accent: "#f59e0b",
    recommendedFont: "Cormorant Garamond",
  },
  {
    key: "midnight-oracle",
    name: "Midnight Oracle",
    tagline: "The dark night. Where the unconscious speaks.",
    bgLeft: "#0a0a0f",
    bgRight: "#1e0a3c",
    accent: "#a78bfa",
    recommendedFont: "Cinzel",
  },
  {
    key: "blood-moon",
    name: "Blood Moon",
    tagline: "Transformation. The reading that changes everything.",
    bgLeft: "#1a0000",
    bgRight: "#5c0000",
    accent: "#ef4444",
    recommendedFont: "Cinzel",
  },
  {
    key: "citrine-dawn",
    name: "Citrine Dawn",
    tagline: "Awakening. The first light of new understanding.",
    bgLeft: "#1a1308",
    bgRight: "#3d2c0a",
    accent: "#facc15",
    recommendedFont: "Playfair Display",
  },
  {
    key: "cups-tide",
    name: "Cups & Tide",
    tagline: "Water. Emotion. The deep currents of the heart.",
    bgLeft: "#001a2c",
    bgRight: "#042234",
    accent: "#67e8f9",
    recommendedFont: "Playfair Display",
  },
  {
    key: "wands-ember",
    name: "Wands & Ember",
    tagline: "Fire. Will. The spark that moves you.",
    bgLeft: "#1c0a0a",
    bgRight: "#3d1408",
    accent: "#fb923c",
    recommendedFont: "Cinzel",
  },
  {
    key: "pentacles-moss",
    name: "Pentacles & Moss",
    tagline: "Earth. Patience. The slow work of building.",
    bgLeft: "#0a1a14",
    bgRight: "#16352b",
    accent: "#34d399",
    recommendedFont: "Lora",
  },
  {
    key: "peacocks-tail",
    name: "Peacock\u2019s Tail",
    tagline: "The shimmering threshold. All colors before unity.",
    bgLeft: "#0d0a1f",
    bgRight: "#2a0a3d",
    accent: "#c084fc",
    recommendedFont: "Playfair Display",
  },
  {
    key: "clear-sky",
    name: "Clear Sky",
    tagline: "Quiet defaults. The reading without weather.",
    bgLeft: "#111827",
    bgRight: "#1f2937",
    accent: "#60a5fa",
    recommendedFont: "Raleway",
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
