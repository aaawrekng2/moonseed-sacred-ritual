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

/**
 * DX/DY — Per-deck CSS corner radius for the active deck. The stored
 * integer is now a PERCENTAGE (0–15, 0%-15%) rather than pixels —
 * percentage scales proportionally across all card sizes. Returns null
 * if the seeker has no override saved. Pair with {@link cornerRadiusStyle}.
 */
export function useActiveDeckCornerRadius(): number | null {
  const { imageMap } = useActiveDeck();
  return imageMap.cornerRadiusPx;
}

/**
 * DB-3.1 — Resolve a card image for a SPECIFIC deck_id.
 *
 * Used when displaying a saved/historical reading: the reading's saved
 * `deck_id` determines which deck's images render — NOT the seeker's
 * currently-active deck. When `deckId` is null/undefined or the deck has
 * no override for a given card, falls back to the default Rider-Waite
 * asset path (same contract as {@link useActiveDeckImage}).
 *
 * Rules of Hooks: cannot be called inside `.map()`. The pattern is to
 * extract each row into its own component (e.g. `ReadingRow`) so the
 * hook runs at the top level of that component.
 */
export function useDeckImage(deckId: string | null | undefined): (
  cardIndex: number,
  size?: "display" | "thumbnail",
) => string | null {
  const [imageMap, setImageMap] = useState<DeckImageMap>(EMPTY_DECK_IMAGE_MAP);
  // DD-3 — track in-flight custom-deck fetches so consumers can render a
  // neutral placeholder instead of flashing the default Rider-Waite art
  // before the user's custom card image resolves. When `deckId` is null
  // we fall through immediately (no fetch, no flash).
  const [isLoading, setIsLoading] = useState<boolean>(!!deckId);

  useEffect(() => {
    if (!deckId) {
      setImageMap(EMPTY_DECK_IMAGE_MAP);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const map = await buildDeckImageMap(deckId);
        if (!cancelled) {
          setImageMap(map);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setImageMap(EMPTY_DECK_IMAGE_MAP);
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  return useCallback(
    (cardIndex: number, size: "display" | "thumbnail" = "display") => {
      if (deckId && isLoading) return null;
      return resolveCardImage(cardIndex, imageMap, size);
    },
    [imageMap, isLoading, deckId],
  );
}

/**
 * DX/DY — Resolve the per-deck CSS corner radius (percentage) for a
 * SPECIFIC deck_id.
 * Returns null when the deck has no override (or no deckId is provided),
 * letting the existing app-default border-radius rule apply.
 */
export function useDeckCornerRadius(deckId: string | null | undefined): number | null {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    if (!deckId) {
      setValue(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await buildDeckImageMap(deckId);
        if (!cancelled) setValue(map.cornerRadiusPx);
      } catch {
        if (!cancelled) setValue(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  return value;
}

/**
 * DX/DY — Inline CSS for applying a saved deck corner radius. The value
 * is treated as a PERCENTAGE so the curve scales proportionally with
 * card size (8% on a 280px card ≈ 22px curve; 8% on a 50px thumb ≈ 4px).
 * Returns an
 * empty object when `radiusPx` is null so the existing app-wide rule
 * keeps applying. Use as `style={{ ...other, ...cornerRadiusStyle(r) }}`.
 */
export function cornerRadiusStyle(radiusPx: number | null): { borderRadius?: string } {
  return radiusPx == null ? {} : { borderRadius: `${radiusPx}%` };
}