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
  corner_radius_px: number | null;
  card_back_url: string | null;
  card_back_thumb_url: string | null;
  is_complete: boolean;
  is_active: boolean;
  created_at: string;
  /** 9-6-A — 'tarot' (78 cards) or 'oracle' (variable). */
  deck_type: "tarot" | "oracle";
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
  /** 9-6-A — oracle decks store user-supplied per-card name + meaning. */
  card_name?: string | null;
  card_description?: string | null;
};

/** Per-card override map: card index (0..77) -> image URL. */
export type DeckImageMap = {
  display: Record<number, string>;
  thumbnail: Record<number, string>;
  back: string | null;
  /**
   * EC-2 — saved per-deck CSS border-radius as a PERCENTAGE (0-15) of
   * card width. Null means "use the app's existing default". Resolved
   * at deck-load time so render sites can apply inline `border-radius`
   * without an extra round trip.
   */
  cornerRadiusPercent: number | null;
  /**
   * 9-6-Y — Pre-measured natural aspect (height / width) per card.
   * Lets CardImage size its wrapper correctly on FIRST PAINT, avoiding
   * the brief bottom-crop while the IMG decodes and onLoad fires.
   */
  aspectByCardId: Record<number, number>;
};

export const EMPTY_DECK_IMAGE_MAP: DeckImageMap = {
  display: {},
  thumbnail: {},
  back: null,
  cornerRadiusPercent: null,
  aspectByCardId: {},
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
  const map: DeckImageMap = { display: {}, thumbnail: {}, back: null, cornerRadiusPercent: null };
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
    // 9-6-I — wrap batch sign in try/catch; storage occasionally
    // returns 504s. Fall back to stored display_url/thumbnail_url
    // for any cards we couldn't sign.
    try {
      const { data: signed, error } = await supabase.storage
        .from("custom-deck-images")
        .createSignedUrls(allPaths, yearSecs);
      if (error) {
        console.warn("[buildDeckImageMap] batch sign failed", error);
      } else {
        for (const entry of signed ?? []) {
          if (!entry.signedUrl || !entry.path) continue;
          const meta = pathToCard.get(entry.path);
          if (!meta) continue;
          map[meta.kind][meta.cardId] = entry.signedUrl;
        }
      }
    } catch (err) {
      console.warn("[buildDeckImageMap] batch sign threw", err);
    }
  }
  // 9-6-J — ALWAYS run the stored-URL fallback, not just inside the
  // catch path. Batch sign can succeed without returning entries for
  // every requested path; without this, oracle cards (IDs ≥ 1000)
  // get no display URL and resolveCardImage previously fell through
  // to /cards/card-1009.jpg (404).
  for (const c of cards) {
    if (c.source === "default") continue;
    if (!map.display[c.card_id] && c.display_url) {
      map.display[c.card_id] = c.display_url;
    }
    if (!map.thumbnail[c.card_id] && c.thumbnail_url) {
      map.thumbnail[c.card_id] = c.thumbnail_url;
    }
  }
  // Pull the deck row separately for back image.
  const { data: deck } = await supabase
    .from("custom_decks")
    .select("card_back_url, card_back_path, corner_radius_percent")
    .eq("id", deckId)
    .maybeSingle();
  const backPath = (deck as { card_back_path?: string | null } | null)?.card_back_path ?? null;
  if (backPath) {
    // 9-6-I — wrap back sign in try/catch with fallback to stored URL.
    try {
      const { data: signed, error } = await supabase.storage
        .from("custom-deck-images")
        .createSignedUrl(backPath, yearSecs);
      if (error) {
        console.warn("[buildDeckImageMap] back sign failed", error);
        map.back = (deck?.card_back_url as string | null | undefined) ?? null;
      } else {
        map.back = signed?.signedUrl ?? (deck?.card_back_url as string | null | undefined) ?? null;
      }
    } catch (err) {
      console.warn("[buildDeckImageMap] back sign threw", err);
      map.back = (deck?.card_back_url as string | null | undefined) ?? null;
    }
  } else {
    map.back = (deck?.card_back_url as string | null | undefined) ?? null;
  }
  // EC-1 — read corner_radius_percent (the column DeckEditor saves to).
  // The corner_radius_px column is legacy and no longer used at runtime.
  const cr = (deck as { corner_radius_percent?: number | null } | null)
    ?.corner_radius_percent;
  // Clamp legacy values (which could be up to 30 from the older slider)
  // so they don't render as huge percentages on existing rows.
  map.cornerRadiusPercent =
    typeof cr === "number" ? Math.max(0, Math.min(20, Math.round(cr))) : null;
  // 9-6-P — diagnostic: how many cards have been processed by the
  // edge function (and therefore have the corner-cropped variant)
  // versus how many are still on the raw upload.
  try {
    const totalCards = cards.filter((c) => c.source !== "default").length;
    const processedCards = cards.filter(
      (c) =>
        c.source !== "default" &&
        (c as { processing_status?: string }).processing_status === "saved",
    ).length;
    console.log(
      "[buildDeckImageMap] deck=",
      deckId,
      "processed=",
      processedCards,
      "of",
      totalCards,
    );
  } catch {
    // ignore logging errors
  }
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
  if (override) return override;
  // 9-6-J — oracle card IDs (≥ 1000) have no Rider-Waite default.
  // Returning the constructed `/cards/card-1009.jpg` path produces a
  // hard 404 in the network panel. Return an empty string so the
  // consumer renders a placeholder/empty card instead.
  if (cardIndex >= 1000) return "";
  return getDefaultCardImagePath(cardIndex);
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

/**
 * EO-9 — Read user's premium status from user_preferences.
 * Replaces the AW-era stub that always returned false.
 */
export async function isPremiumUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase
    .from("user_preferences")
    .select("is_premium, premium_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.is_premium) return false;
  if (data.premium_expires_at) {
    const exp = new Date(data.premium_expires_at).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) return false;
  }
  return true;
}

export const FREE_DECK_LIMIT = 3;