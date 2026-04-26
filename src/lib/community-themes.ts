/**
 * Community Themes — curated, named (gradient + accent) presets that
 * apply instantly when tapped. Stored selection persists in
 * localStorage under `moonseed:community-theme` so it survives reload
 * without a DB migration. Applying a community theme also writes the
 * gradient + accent through to user_preferences via the caller.
 */
export type CommunityTheme = {
  key: string;
  name: string;
  tagline: string;
  bgLeft: string;
  bgRight: string;
  accent: string;
};

export const COMMUNITY_THEMES: ReadonlyArray<CommunityTheme> = [
  {
    key: "mystic-default",
    name: "Mystic",
    tagline: "The original. Where every reading begins.",
    bgLeft: "#1e1b4b",
    bgRight: "#2d1b69",
    accent: "#f59e0b",
  },
  {
    key: "midnight-oracle",
    name: "Midnight Oracle",
    tagline: "For readings done in the small hours.",
    bgLeft: "#0a0a0f",
    bgRight: "#5706ba",
    accent: "#a78bfa",
  },
  {
    key: "blood-moon",
    name: "Blood Moon",
    tagline: "Transformation. The reading that changes everything.",
    bgLeft: "#1a0000",
    bgRight: "#7c0303",
    accent: "#fb7185",
  },
  {
    key: "celestial-tides",
    name: "Celestial Tides",
    tagline: "The ocean and the moon, in conversation.",
    bgLeft: "#001a2c",
    bgRight: "#0a1628",
    accent: "#e0f2fe",
  },
  {
    key: "ember-and-ash",
    name: "Ember & Ash",
    tagline: "Grounded in earth. Patient as stone.",
    bgLeft: "#1c1410",
    bgRight: "#2d1a0e",
    accent: "#d97706",
  },
];

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
