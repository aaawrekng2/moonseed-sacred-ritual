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

/**
 * Formats a timestamp as relative time. Today / Yesterday / Nd ago / formatted date.
 * Used in pattern card reading lists so each row reads as a distinct moment.
 */
export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now - then);
  const diffH = diffMs / (1000 * 60 * 60);
  const diffD = diffH / 24;
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 2) return "Yesterday";
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
