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

// ES-5 — Persist last-known active deck so warm reopen doesn't flash
// the Rider-Waite default before the live fetch returns.
const STORAGE_KEY_DECK = "moonseed.activeDeck";
const STORAGE_KEY_IMAGES = "moonseed.activeDeckImages";

function readCachedDeck(): { deck: CustomDeck | null; map: DeckImageMap } {
  if (typeof window === "undefined") {
    return { deck: null, map: EMPTY_DECK_IMAGE_MAP };
  }
  try {
    const deckRaw = localStorage.getItem(STORAGE_KEY_DECK);
    const imagesRaw = localStorage.getItem(STORAGE_KEY_IMAGES);
    return {
      deck: deckRaw ? (JSON.parse(deckRaw) as CustomDeck) : null,
      map: imagesRaw ? (JSON.parse(imagesRaw) as DeckImageMap) : EMPTY_DECK_IMAGE_MAP,
    };
  } catch {
    return { deck: null, map: EMPTY_DECK_IMAGE_MAP };
  }
}

function writeCachedDeck(deck: CustomDeck | null, map: DeckImageMap) {
  if (typeof window === "undefined") return;
  try {
    if (deck) {
      localStorage.setItem(STORAGE_KEY_DECK, JSON.stringify(deck));
      localStorage.setItem(STORAGE_KEY_IMAGES, JSON.stringify(map));
    } else {
      localStorage.removeItem(STORAGE_KEY_DECK);
      localStorage.removeItem(STORAGE_KEY_IMAGES);
    }
  } catch {
    // Quota / serialization error — ignore.
  }
}

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
  const { user, loading: authLoading } = useAuth();
  // ES-5 — Hydrate from localStorage so warm reopen doesn't flash the
  // Rider-Waite default before the live fetch returns.
  const [activeDeck, setActiveDeck] = useState<CustomDeck | null>(
    () => readCachedDeck().deck,
  );
  const [imageMap, setImageMap] = useState<DeckImageMap>(
    () => readCachedDeck().map,
  );
  const [loading, setLoading] = useState(
    () => readCachedDeck().deck === null,
  );

  const refresh = useCallback(async () => {
    // EE-3 — While auth is still resolving, keep loading=true so the
    // Home hero waits for the user's custom deck instead of briefly
    // rendering the Rider-Waite default before the active-deck
    // context catches up on PWA cold open.
    if (authLoading) {
      // ET-1 — If we have a cached deck hydrated from localStorage,
      // KEEP loading=false. The cache is good enough to render the
      // home hero correctly during auth resolution. Without this guard,
      // the cache is wasted and the default deck flashes on warm reopen.
      if (!activeDeck) setLoading(true);
      return;
    }
    if (!user) {
      setActiveDeck(null);
      setImageMap(EMPTY_DECK_IMAGE_MAP);
      writeCachedDeck(null, EMPTY_DECK_IMAGE_MAP);
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
        writeCachedDeck(deck, map);
      } else {
        setImageMap(EMPTY_DECK_IMAGE_MAP);
        writeCachedDeck(null, EMPTY_DECK_IMAGE_MAP);
      }
    } catch {
      // Non-fatal — fall back to default deck silently.
      setImageMap(EMPTY_DECK_IMAGE_MAP);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading]);

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
  return imageMap.cornerRadiusPercent;
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
        if (!cancelled) setValue(map.cornerRadiusPercent);
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
 * DZ-1 — Inline CSS for applying a saved deck corner radius.
 *
 * Storage is a PERCENTAGE (0–15) interpreted as a fraction of the card
 * WIDTH. To produce TRUE CIRCULAR corners on a non-square rectangle we
 * use CSS's "X% / Y%" border-radius syntax (horizontal radius is % of
 * width, vertical radius is % of height). For a tarot card with aspect
 * ratio W/H ≈ 0.583, the vertical % must be radiusPercent / aspect to
 * match the same pixel radius on both axes.
 *
 * Callers may pass a `widthPx` (when known) to switch to an exact pixel
 * value, or override the default tarot aspect via `aspect` (W/H) for
 * non-standard card shapes (square, round, etc.).
 */
/**
 * EE-1 — Pixel-only border-radius. Asymmetric % fallback removed because
 * rendered card containers have varying aspect ratios (gallery
 * aspect-square, padded slots, share canvases) that don't always match
 * the assumed tarot aspect — producing elliptical corners. If widthPx
 * isn't provided or is 0 (initial render before measurement), returns
 * an empty object: no radius is applied for that frame, and subsequent
 * renders with a measured widthPx will paint the radius cleanly.
 */
export function cornerRadiusStyle(
  radiusPercent: number | null,
  widthPx?: number | null,
): { borderRadius?: string } {
  if (radiusPercent == null) return {};
  if (typeof widthPx !== "number" || widthPx <= 0) return {};
  const px = Math.max(0, Math.round((radiusPercent / 100) * widthPx));
  return { borderRadius: `${px}px` };
}

/**
 * EZ-7 — Variant URL resolution.
 *
 * Card images are stored in `custom-deck-images` at paths like
 *   `<userId>/<deckId>/card-<N>-<ts>.webp`
 *   `<userId>/<deckId>/card-<N>-<ts>-thumb.webp`
 *
 * The Edge Function `generate-deck-variants` writes JPEG variants
 * alongside the originals using suffix swaps:
 *   `<...>/card-<N>-<ts>-sm.jpg`   (200px wide)
 *   `<...>/card-<N>-<ts>-md.jpg`   (400px wide)
 *
 * Signed URLs look like:
 *   `<base>/storage/v1/object/sign/custom-deck-images/<path>?token=...`
 *
 * To produce the variant URL we rewrite the trailing filename in the
 * path part of the URL while preserving the query string (signed
 * token works because the bucket policy is per-object). If the input
 * URL does not look like a stored card image (e.g. a Rider-Waite
 * default `/cards/...` asset bundled with the app), we return it
 * unchanged so callers fall back to the original.
 */
export function variantUrlFor(
  originalUrl: string | null | undefined,
  variant: "sm" | "md" | "full",
): string | null {
  if (!originalUrl) return null;
  // Only rewrite custom-deck-images URLs. Default Rider-Waite assets
  // live under `/cards/` in the app bundle and have no variants.
  if (!originalUrl.includes("/custom-deck-images/")) return originalUrl;
  try {
    const url = new URL(originalUrl);
    const path = url.pathname;
    // Match "<...>/card-N-TS(-thumb)?.<ext>" at the end of the path.
    const m = path.match(
      /^(.*\/card-\d+-\d+)(?:-thumb)?\.(?:webp|png|jpe?g)$/i,
    );
    if (!m) return originalUrl;
    // FD-3 — `-full.webp` is the rounded-alpha master baked at
    // single-card save time. sm/md remain `-${variant}.jpg`
    // (un-rounded; the lack of alpha is invisible at <=400px).
    const newPath =
      variant === "full"
        ? `${m[1]}-full.webp`
        : `${m[1]}-${variant}.jpg`;
    url.pathname = newPath;
    return url.toString();
  } catch {
    return originalUrl;
  }
}