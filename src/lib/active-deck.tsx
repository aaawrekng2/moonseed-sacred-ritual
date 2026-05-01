/**
 * ActiveDeckContext (Stamp AV).
 *
 * Loads the seeker's active custom deck once at app load and exposes
 * the per-card image map so render code can stay synchronous.
 * Pair with {@link useActiveDeckImage} to resolve card art with
 * automatic Rider-Waite fallback.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildDeckImageMap,
  EMPTY_DECK_IMAGE_MAP,
  fetchActiveDeck,
  resolveCardImage,
  type CustomDeck,
  type DeckImageMap,
} from "@/lib/custom-decks";
import { useAuth } from "@/lib/auth";

type Ctx = {
  activeDeck: CustomDeck | null;
  imageMap: DeckImageMap;
  loading: boolean;
  /** Re-fetch after the seeker switches decks or photographs more cards. */
  refresh: () => Promise<void>;
};

const ActiveDeckCtx = createContext<Ctx>({
  activeDeck: null,
  imageMap: EMPTY_DECK_IMAGE_MAP,
  loading: true,
  refresh: async () => {},
});

export function ActiveDeckProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeDeck, setActiveDeck] = useState<CustomDeck | null>(null);
  const [imageMap, setImageMap] = useState<DeckImageMap>(EMPTY_DECK_IMAGE_MAP);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setActiveDeck(null);
      setImageMap(EMPTY_DECK_IMAGE_MAP);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const deck = await fetchActiveDeck(user.id);
      setActiveDeck(deck);
      if (deck) {
        const map = await buildDeckImageMap(deck.id);
        setImageMap(map);
      } else {
        setImageMap(EMPTY_DECK_IMAGE_MAP);
      }
    } catch {
      // Non-fatal — fall back to default deck silently.
      setImageMap(EMPTY_DECK_IMAGE_MAP);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Ctx>(
    () => ({ activeDeck, imageMap, loading, refresh }),
    [activeDeck, imageMap, loading, refresh],
  );

  return <ActiveDeckCtx.Provider value={value}>{children}</ActiveDeckCtx.Provider>;
}

export function useActiveDeck(): Ctx {
  return useContext(ActiveDeckCtx);
}

/** Resolve a card image (custom deck override → Rider-Waite fallback). */
export function useActiveDeckImage(): (
  cardIndex: number,
  size?: "display" | "thumbnail",
) => string {
  const { imageMap } = useActiveDeck();
  return useCallback(
    (cardIndex: number, size: "display" | "thumbnail" = "display") =>
      resolveCardImage(cardIndex, imageMap, size),
    [imageMap],
  );
}

/**
 * The active deck's photographed card-back URL, or null when the
 * seeker has no active custom deck (or hasn't photographed a back yet).
 * Pair with {@link CardBack} to render the themed default when null.
 */
export function useActiveCardBackUrl(): string | null {
  const { imageMap } = useActiveDeck();
  return imageMap.back ?? null;
}