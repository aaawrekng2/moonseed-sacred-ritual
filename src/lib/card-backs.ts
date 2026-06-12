export type CardBackId =
  | "signature"
  | "celestial"
  | "void"
  | "ember"
  | "ocean"
  | "verdant";

export const CARD_BACKS = [
  {
    id: "signature",
    label: "Signature",
    description: "The TarotSeed gate — ornate gold arch and the violet eye",
  },
  { id: "celestial", label: "Celestial", description: "Silver moon and stars on deep violet" },
  { id: "void", label: "Void", description: "Sacred geometry on near-black" },
  { id: "ember", label: "Ember", description: "Golden triangle sigil on deep amber" },
  { id: "ocean", label: "Ocean", description: "Wave forms on midnight blue" },
  { id: "verdant", label: "Verdant", description: "Botanical form on forest dark" },
] as const;

/**
 * EK122 — the Signature image back is the house default, shown on the
 * home gateway, the draw table, and everywhere a back appears unless the
 * seeker has chosen a different back or is on a custom deck.
 */
export const DEFAULT_CARD_BACK: CardBackId = "signature";

/**
 * EK122 — the Signature back is a fixed image (not procedural SVG), shipped
 * in three sizes so the draw table / slots never pay for the hero weight.
 * Pick by the back's rendered width.
 */
export const SIGNATURE_BACK_SRC = {
  full: "/cards/tarotseed-back.webp",
  sm: "/cards/tarotseed-back-sm.webp",
  thumb: "/cards/tarotseed-back-thumb.webp",
} as const;

export function signatureBackSrc(width: number): string {
  if (width >= 220) return SIGNATURE_BACK_SRC.full;
  if (width >= 110) return SIGNATURE_BACK_SRC.sm;
  return SIGNATURE_BACK_SRC.thumb;
}
const STORAGE_KEY = "tarotseed:card-back";

export function getStoredCardBack(): CardBackId {
  if (typeof window === "undefined") return DEFAULT_CARD_BACK;
  const v = localStorage.getItem(STORAGE_KEY) as CardBackId | null;
  if (v && CARD_BACKS.some((b) => b.id === v)) return v;
  return DEFAULT_CARD_BACK;
}

export function setStoredCardBack(id: CardBackId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, id);
  window.dispatchEvent(
    new CustomEvent<CardBackId>("tarotseed:card-back-changed", { detail: id }),
  );
}