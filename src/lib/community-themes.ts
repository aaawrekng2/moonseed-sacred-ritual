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
    tagline: "For readings done in the small hours.",
    bgLeft: "#0a0a0f",
    bgRight: "#1e0a3c",
    accent: "#a78bfa",
    recommendedFont: "Cinzel",
  },
  {
    key: "blood-red",
    name: "Blood Red",
    tagline: "Transformation. The reading that changes everything.",
    bgLeft: "#1a0000",
    bgRight: "#5c0000",
    accent: "#ef4444",
    recommendedFont: "Cinzel",
  },
  {
    key: "celestial-tide",
    name: "Celestial Tide",
    tagline: "The ocean and the moon, in conversation.",
    bgLeft: "#001a2c",
    bgRight: "#042234",
    accent: "#67e8f9",
    recommendedFont: "Playfair Display",
  },
  {
    key: "ember-ash",
    name: "Ember & Ash",
    tagline: "Grounded in earth. Patient as stone.",
    bgLeft: "#1c1410",
    bgRight: "#2d1a0e",
    accent: "#f97316",
    recommendedFont: "Lora",
  },
  {
    key: "forest-veil",
    name: "Forest Veil",
    tagline: "Slow knowing, deep root.",
    bgLeft: "#0a1a14",
    bgRight: "#16352b",
    accent: "#34d399",
    recommendedFont: "Lora",
  },
  {
    key: "bone-pearl",
    name: "Bone & Pearl",
    tagline: "Quiet. Considered. The reading that pauses you.",
    bgLeft: "#0f0f1a",
    bgRight: "#1f1f2e",
    accent: "#e5e7eb",
    recommendedFont: "Playfair Display",
  },
  {
    key: "wildfire",
    name: "Wildfire",
    tagline: "Bold answers. No apologies.",
    bgLeft: "#1c0a0a",
    bgRight: "#4a1a0a",
    accent: "#fde047",
    recommendedFont: "Cinzel",
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
