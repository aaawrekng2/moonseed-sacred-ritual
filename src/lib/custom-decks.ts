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
  /** 26-05-08-Q9 — storage path of the original imported zip,
   *  used by the per-card recovery flow. */
  source_zip_path?: string | null;
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
  /**
   * 26-05-08-P — Fix 5: per-card display name override. Populated for
   * any card_id whose `card_name` column is non-null. Lets the app
   * resolve oracle card titles ("Card 1005" → "The Awakening") in
   * any sync render path without re-fetching the deck row.
   */
  nameByCardId: Record<number, string>;
};

export const EMPTY_DECK_IMAGE_MAP: DeckImageMap = {
  display: {},
  thumbnail: {},
  back: null,
  cornerRadiusPercent: null,
  aspectByCardId: {},
  nameByCardId: {},
};

// Q27 Fix 1 — Module-level cache for buildDeckImageMap, shared across
// all CardImage instances. Without this, every CardImage independently
// fetches the deck map and generates fresh signed URLs, causing
// thousands of parallel requests that cancel each other.
const deckImageMapCache = new Map<string, Promise<DeckImageMap>>();
const deckImageMapCacheExpiry = new Map<string, number>();
const DECK_MAP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function invalidateDeckImageMap(deckId: string): void {
  deckImageMapCache.delete(deckId);
  deckImageMapCacheExpiry.delete(deckId);
}

export function invalidateAllDeckImageMaps(): void {
  deckImageMapCache.clear();
  deckImageMapCacheExpiry.clear();
}

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
    // 26-05-08-L — defensive: card back is stored on `custom_decks`
    // (card_back_url / card_back_thumb_url), NOT in custom_deck_cards.
    // We still guard against any legacy/sentinel back row by excluding
    // negative card_id values so a back never enters the draw pool.
    .gte("card_id", 0)
    .is("archived_at", null);
  if (error) throw error;
  return (data ?? []) as CustomDeckCard[];
}

async function buildDeckImageMapUncached(
  deckId: string,
): Promise<DeckImageMap> {
  const cards = await fetchDeckCards(deckId);
  const map: DeckImageMap = {
    display: {},
    thumbnail: {},
    back: null,
    cornerRadiusPercent: null,
    aspectByCardId: {},
    nameByCardId: {},
  };
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
    // 26-05-08-P — Fix 5: capture per-card name overrides.
    if (c.card_name && c.card_name.trim()) {
      map.nameByCardId[c.card_id] = c.card_name.trim();
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
    // 26-05-08-L — Fix 4: never use a stored signed URL (contains
    // `token=`) as a fallback. Those tokens expire and surface as
    // broken images on the next session. Only use the stored URL
    // when it looks like a public/permanent URL.
    if (
      !map.display[c.card_id] &&
      c.display_url &&
      !c.display_url.includes("token=")
    ) {
      map.display[c.card_id] = c.display_url;
    }
    if (
      !map.thumbnail[c.card_id] &&
      c.thumbnail_url &&
      !c.thumbnail_url.includes("token=")
    ) {
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
  // 26-05-08-M — Fix 6: if any per-card display/thumbnail URL matches
  // the deck's card_back_url, that card is being repurposed as the
  // back. Remove it from the draw pool so it never appears as a
  // drawable card face.
  if (map.back) {
    const backUrl = map.back;
    for (const [k, v] of Object.entries(map.display)) {
      if (v === backUrl) delete map.display[Number(k)];
    }
    for (const [k, v] of Object.entries(map.thumbnail)) {
      if (v === backUrl) delete map.thumbnail[Number(k)];
    }
  }
  // EC-1 — read corner_radius_percent (the column DeckEditor saves to).
  // The corner_radius_px column is legacy and no longer used at runtime.
  const cr = (deck as { corner_radius_percent?: number | null } | null)
    ?.corner_radius_percent;
  // Clamp legacy values (which could be up to 30 from the older slider)
  // so they don't render as huge percentages on existing rows.
  map.cornerRadiusPercent =
    typeof cr === "number" ? Math.max(0, Math.min(20, Math.round(cr))) : null;
  // 9-6-Y — pre-measure natural aspects so CardImage's wrapper can
  // render at the correct height on FIRST PAINT. Without this, decks
  // whose card images aren't 5:8 briefly clip at the bottom while the
  // IMG decodes and onLoad fires.
  if (typeof window !== "undefined") {
    const entries = Object.entries(map.display);
    if (entries.length > 0) {
      try {
        await Promise.all(
          entries.map(([cardIdStr, url]) =>
            new Promise<void>((resolve) => {
              const cardId = Number(cardIdStr);
              if (!Number.isFinite(cardId)) {
                resolve();
                return;
              }
              const img = new Image();
              const done = () => resolve();
              img.onload = () => {
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  map.aspectByCardId[cardId] =
                    img.naturalHeight / img.naturalWidth;
                }
                done();
              };
              img.onerror = done;
              // Prefer thumbnail (smaller, faster) for measurement;
              // aspect is identical to the full image.
              img.src = map.thumbnail[cardId] ?? url;
            }),
          ),
        );
      } catch {
        // best-effort only
      }
    }
  }
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
): string | null {
  const override = map ? map[size][cardIndex] : undefined;
  if (override) return override;
  // 26-05-08-Q6 — Fix 1: return null (was "") for oracle ids without a
  // map entry. Empty string broke `??` fallback chains in CardImage and
  // share-card-shared because "" is not nullish — so when both specific
  // and active resolvers missed, baseFaceSrc stayed "" and downstream
  // variantUrlFor("") returned null, leaving the <img> unrendered.
  if (cardIndex >= 1000) return null;
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

/**
 * 9-6-AH — Live processing status for the background variant queue.
 * Polled by the My Decks list to show "Optimizing… X of N" while
 * card images are still being generated.
 */
export type DeckProcessingStatus = {
  total: number;
  saved: number;
  pending: number;
  failed: number;
  isComplete: boolean;
};

export async function fetchDeckProcessingStatus(
  deckId: string,
  expectedTotal: number,
): Promise<DeckProcessingStatus> {
  const { data } = await supabase
    .from("custom_deck_cards")
    .select("processing_status")
    .eq("deck_id", deckId)
    .is("archived_at", null);
  const rows = (data ?? []) as Array<{ processing_status: string }>;
  const saved = rows.filter((r) => r.processing_status === "saved").length;
  const pending = rows.filter((r) => r.processing_status === "pending").length;
  const failed = rows.filter((r) => r.processing_status === "failed").length;
  return {
    total: expectedTotal,
    saved,
    pending,
    failed,
    isComplete:
      pending === 0 && failed === 0 && saved >= expectedTotal,
  };
}