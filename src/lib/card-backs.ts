export type CardBackId = "celestial" | "void" | "ember" | "ocean" | "verdant";

export const CARD_BACKS = [
  { id: "celestial", label: "Celestial", description: "Silver moon and stars on deep violet" },
  { id: "void", label: "Void", description: "Sacred geometry on near-black" },
  { id: "ember", label: "Ember", description: "Golden triangle sigil on deep amber" },
  { id: "ocean", label: "Ocean", description: "Wave forms on midnight blue" },
  { id: "verdant", label: "Verdant", description: "Botanical form on forest dark" },
] as const;

export const DEFAULT_CARD_BACK: CardBackId = "celestial";
const STORAGE_KEY = "moonseed:card-back";

export function getStoredCardBack(): CardBackId {
  if (typeof window === "undefined") return DEFAULT_CARD_BACK;
  const v = localStorage.getItem(STORAGE_KEY) as CardBackId | null;
  if (v && CARD_BACKS.some((b) => b.id === v)) return v;
  return DEFAULT_CARD_BACK;
}

export function setStoredCardBack(id: CardBackId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, id);
}