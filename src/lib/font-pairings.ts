/**
 * Q81 — Font pairing presets.
 *
 * Each preset sets BOTH --font-display (heading) AND --font-serif (body)
 * together. One-tap visual identity change.
 */
export type FontPairingKey =
  | "classic"
  | "sacred"
  | "modern-mystic"
  | "pure-readability"
  | "editorial";

export type FontPairing = {
  key: FontPairingKey;
  name: string;
  vibe: string;
  display: string;
  body: string;
  /** Google Fonts URL family name (`+` for spaces). */
  googleFamily: string;
};

export const FONT_PAIRINGS: ReadonlyArray<FontPairing> = [
  {
    key: "classic",
    name: "Classic",
    vibe: "Familiar, warm, made for reading.",
    display: "Cormorant Garamond",
    body: "EB Garamond",
    googleFamily:
      "Cormorant+Garamond:wght@400;500;600;700&family=EB+Garamond:wght@400;500;600;700",
  },
  {
    key: "sacred",
    name: "Sacred",
    vibe: "Rich, ritual, tarot-appropriate.",
    display: "Playfair Display",
    body: "Lora",
    googleFamily:
      "Playfair+Display:wght@400;500;600;700&family=Lora:wght@400;500;600;700",
  },
  {
    key: "modern-mystic",
    name: "Modern Mystic",
    vibe: "Contemporary serif heads, clean body.",
    display: "DM Serif Display",
    body: "DM Sans",
    googleFamily: "DM+Serif+Display&family=DM+Sans:wght@400;500;600;700",
  },
  {
    key: "pure-readability",
    name: "Pure Readability",
    vibe: "Maximum clarity. No serif.",
    display: "Inter",
    body: "Inter",
    googleFamily: "Inter:wght@400;500;600;700",
  },
  {
    key: "editorial",
    name: "Editorial",
    vibe: "Magazine-grade, screen-tuned serif.",
    display: "Libre Baskerville",
    body: "Libre Baskerville",
    googleFamily: "Libre+Baskerville:wght@400;700",
  },
];

export const DEFAULT_FONT_PAIRING: FontPairingKey = "pure-readability";

export function getFontPairing(key: string | null | undefined): FontPairing {
  const found = FONT_PAIRINGS.find((p) => p.key === key);
  return found ?? FONT_PAIRINGS[0];
}

export function isFontPairingKey(v: unknown): v is FontPairingKey {
  return (
    typeof v === "string" &&
    FONT_PAIRINGS.some((p) => p.key === (v as FontPairingKey))
  );
}

const PAIRING_KEY = "tarotseed:font-pairing";

/** Inject a Google Fonts <link> for a pairing if not already present. */
export function ensurePairingFontsLoaded(pairing: FontPairing): void {
  if (typeof document === "undefined") return;
  const id = `gf-pairing-${pairing.key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${pairing.googleFamily}&display=swap`;
  document.head.appendChild(link);
}

/** Preload every pairing — used on Themes mount. */
export function preloadAllPairings(): void {
  for (const p of FONT_PAIRINGS) ensurePairingFontsLoaded(p);
}

/** Apply a pairing to :root and persist to localStorage. */
export function applyFontPairing(key: FontPairingKey): void {
  if (typeof document === "undefined") return;
  const p = getFontPairing(key);
  ensurePairingFontsLoaded(p);
  const root = document.documentElement;
  root.style.setProperty(
    "--font-display",
    `"${p.display}", ui-serif, Georgia, serif`,
  );
  root.style.setProperty(
    "--font-serif",
    `"${p.body}", ui-serif, Georgia, serif`,
  );
  try {
    window.localStorage.setItem(PAIRING_KEY, key);
  } catch {
    /* ignore */
  }
}

export function readStoredPairing(): FontPairingKey {
  if (typeof window === "undefined") return DEFAULT_FONT_PAIRING;
  const raw = window.localStorage.getItem(PAIRING_KEY);
  return isFontPairingKey(raw) ? raw : DEFAULT_FONT_PAIRING;
}

/* ---- Text scale (single unified slider) ------------------------ */

export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.3;
export const TEXT_SCALE_DEFAULT = 1.0;
export const TEXT_SCALE_STEP = 0.05;
const SCALE_KEY = "tarotseed:text-scale";

export function clampTextScale(v: number): number {
  if (!Number.isFinite(v)) return TEXT_SCALE_DEFAULT;
  return Math.max(TEXT_SCALE_MIN, Math.min(TEXT_SCALE_MAX, v));
}

export function applyTextScale(scale: number): void {
  if (typeof document === "undefined") return;
  const s = clampTextScale(scale);
  const root = document.documentElement;
  root.style.setProperty("--body-scale", String(s));
  root.style.setProperty("--heading-scale", String(s));
  try {
    window.localStorage.setItem(SCALE_KEY, String(s));
  } catch {
    /* ignore */
  }
}

export function readStoredTextScale(): number {
  if (typeof window === "undefined") return TEXT_SCALE_DEFAULT;
  const raw = window.localStorage.getItem(SCALE_KEY);
  if (!raw) return TEXT_SCALE_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampTextScale(n) : TEXT_SCALE_DEFAULT;
}
