import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getCardName, type TarotCardId } from "@/lib/tarot";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns the first card's display name from a card_ids array.
 * Falls back to "Reading" when no cards are present.
 */
export function firstCardName(cardIds: TarotCardId[] | null | undefined): string {
  if (!cardIds || cardIds.length === 0) return "Reading";
  return getCardName(cardIds[0]);
}
