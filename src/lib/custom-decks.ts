/**
 * Custom deck data layer (Stamp AV).
 *
 * Helpers for fetching and resolving the seeker's active custom deck.
 * Callers fetch the active deck's image map once (typically at app
 * load via {@link ActiveDeckProvider}), then resolve card images
 * synchronously through {@link resolveCardImage}.
 *
 * Why a sync resolver: `getCardImagePath` is used in render-side code
 * (ReadingScreen, share captures, journal). Making the original async
 * would require sweeping refactors. Instead we keep the default
 * Rider-Waite path synchronous and overlay a per-card URL map when an
 * active deck is loaded.
 */
import { supabase } from "@/integrations/supabase/client";
import { getCardImagePath as getDefaultCardImagePath } from "@/lib/tarot";

export type CustomDeck = {
  id: string;
  name: string;
  shape: "rectangle" | "round";
  width_inches: number | null;
  height_inches: number | null;
  corner_radius_percent: number;
  card_back_url: string | null;
  card_back_thumb_url: string | null;
  is_complete: boolean;
  is_active: boolean;
  created_at: string;
};

export type CustomDeckCard = {
  id: string;
  deck_id: string;
  card_id: number;
  display_url: string;
  thumbnail_url: string;
  display_path: string;
  thumbnail_path: string;
  source?: "photographed" | "imported" | "default";
  archived_at?: string | null;
};

/** Per-card override map: card index (0..77) -> image URL. */
export type DeckImageMap = {
  display: Record<number, string>;
  thumbnail: Record<number, string>;
  back: string | null;
};

export const EMPTY_DECK_IMAGE_MAP: DeckImageMap = {
  display: {},
  thumbnail: {},
  back: null,
};

export async function fetchUserDecks(userId: string): Promise<CustomDeck[]> {
  const { data, error } = await supabase
    .from("custom_decks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CustomDeck[];
}

export async function fetchActiveDeck(userId: string): Promise<CustomDeck | null> {
  const { data, error } = await supabase
    .from("custom_decks")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as CustomDeck | null) ?? null;
}

export async function fetchDeckCards(deckId: string): Promise<CustomDeckCard[]> {
  const { data, error } = await supabase
    .from("custom_deck_cards")
    .select("*")
    .eq("deck_id", deckId)
    .is("archived_at", null);
  if (error) throw error;
  return (data ?? []) as CustomDeckCard[];
}

export async function buildDeckImageMap(deckId: string): Promise<DeckImageMap> {
  const cards = await fetchDeckCards(deckId);
  const map: DeckImageMap = { display: {}, thumbnail: {}, back: null };
  // Re-sign from storage paths so we never serve stale/expired signed URLs.
  // Falls back to the stored URL when a path is missing (legacy rows).
  const yearSecs = 60 * 60 * 24 * 365;
  const pathToCard = new Map<string, { cardId: number; kind: "display" | "thumbnail" }>();
  const allPaths: string[] = [];
  for (const c of cards) {
    if (c.source === "default") continue;
    if (c.display_path) {
      pathToCard.set(c.display_path, { cardId: c.card_id, kind: "display" });
      allPaths.push(c.display_path);
    } else if (c.display_url) {
      map.display[c.card_id] = c.display_url;
    }
    if (c.thumbnail_path) {
      pathToCard.set(c.thumbnail_path, { cardId: c.card_id, kind: "thumbnail" });
      allPaths.push(c.thumbnail_path);
    } else if (c.thumbnail_url) {
      map.thumbnail[c.card_id] = c.thumbnail_url;
    }
  }
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("custom-deck-images")
      .createSignedUrls(allPaths, yearSecs);
    for (const entry of signed ?? []) {
      if (!entry.signedUrl || !entry.path) continue;
      const meta = pathToCard.get(entry.path);
      if (!meta) continue;
      map[meta.kind][meta.cardId] = entry.signedUrl;
    }
  }
  // Pull the deck row separately for back image.
  const { data: deck } = await supabase
    .from("custom_decks")
    .select("card_back_url")
    .eq("id", deckId)
    .maybeSingle();
  map.back = (deck?.card_back_url as string | null | undefined) ?? null;
  return map;
}

/**
 * Sync resolver. If `map` has an override for `cardIndex`, returns it;
 * otherwise falls back to the default Rider-Waite asset path.
 *
 * Critical: never returns null. A missing override for a card the user
 * hasn't photographed yet still yields a usable Rider-Waite image so
 * readings render correctly during deck setup.
 */
export function resolveCardImage(
  cardIndex: number,
  map: DeckImageMap | null | undefined,
  size: "display" | "thumbnail" = "display",
): string {
  const override = map ? map[size][cardIndex] : undefined;
  return override ?? getDefaultCardImagePath(cardIndex);
}

/**
 * Mark a deck as the active one. Atomic-ish: clears all other
 * `is_active` flags for this user first, then sets the chosen one.
 * The unique partial index `idx_custom_decks_one_active_per_user`
 * keeps things consistent.
 */
export async function setActiveDeck(userId: string, deckId: string | null): Promise<void> {
  await supabase
    .from("custom_decks")
    .update({ is_active: false })
    .eq("user_id", userId);
  if (deckId) {
    await supabase
      .from("custom_decks")
      .update({ is_active: true })
      .eq("id", deckId)
      .eq("user_id", userId);
  }
}

/** Stub for premium gating — Phase 9.5b/AW. Treats everyone as free. */
export async function isPremiumUser(_userId: string): Promise<boolean> {
  return false;
}

export const FREE_DECK_LIMIT = 3;