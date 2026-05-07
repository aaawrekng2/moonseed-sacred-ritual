/**
 * CZ Group 3 — fullscreen tap-to-zoom for a revealed card.
 *
 * Opens as a modal overlay over the tabletop. Dismisses on:
 *   - tap on the dim backdrop
 *   - tap on the X icon (top right)
 *   - tap on the card image itself
 *
 * Reversed cards are rendered rotated 180° to match the seated
 * orientation in the spread.
 */
import { getCardName } from "@/lib/tarot";
import { useEffect, useState } from "react";
import { CardImage } from "@/components/card/CardImage";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import {
  useActiveDeckCornerRadius,
  useDeckCornerRadius,
} from "@/lib/active-deck";

interface CardZoomModalProps {
  cardId: number;
  reversed?: boolean;
  onClose: () => void;
  /**
   * DT-10a — When viewing a saved reading, pass the reading's saved
   * `deck_id` so the zoom uses the same artwork the reading was drawn
   * with — not the seeker's currently-active deck. Pass null/omit for
   * default Rider-Waite (or the live-active-deck case).
   */
  deckId?: string | null;
}

export function CardZoomModal({ cardId, reversed, onClose, deckId }: CardZoomModalProps) {
  // EY-3 — derive a viewport-aware width and let CardImage handle
  // image loading, corner radius, and orientation via the unified
  // pipeline. The IMG sizes its own height from its natural aspect
  // (EY-2), so we constrain via width only.
  const computeWidth = () => {
    if (typeof window === "undefined") return 320;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    // Target ~85vh height assuming card aspect ~1/1.6, but cap at 90vw.
    const byHeight = (reversed ? 0.78 : 0.85) * vh / 1.6;
    return Math.min(vw * 0.9, byHeight);
  };
  const [imgW, setImgW] = useState<number>(() => computeWidth());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setImgW(computeWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reversed]);
  // DB-1.2 — viewing-only rotate. Local state, never persists; saved
  // reading data is unaffected.
  const [tempUpright, setTempUpright] = useState(false);
  const showRotated = !!reversed && !tempUpright;
  // FB-4 — derive deck-aware radius so the wrapper's gold glow follows
  // the rounded silhouette instead of a square box. Both hooks always
  // run; we pick which to use per render.
  const activeRadius = useActiveDeckCornerRadius();
  const specificRadius = useDeckCornerRadius(deckId ?? null);
  const useSpecific = deckId != null && deckId !== "";
  const deckRadius = useSpecific ? specificRadius : activeRadius;
  return (
    <FullScreenSheet open onClose={onClose} entry="fade" showCloseButton={false}>
      <div
        className="flex h-full flex-col items-center justify-center gap-4 p-4"
        onClick={onClose}
        aria-label={`Zoomed view of ${getCardName(cardId)}`}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            // 9-6-V — drop-shadow follows the rounded card silhouette,
            // eliminating the dark triangular corners that box-shadow
            // painted around the wrapper rectangle.
            filter:
              "drop-shadow(0 0 30px rgba(212,175,55,0.5)) drop-shadow(0 0 60px rgba(212,175,55,0.3))",
            transition: "transform 300ms ease, filter 300ms ease",
          }}
        >
          <CardImage
            cardId={cardId}
            variant="face"
            reversed={showRotated}
            deckId={deckId}
            size="custom"
            widthPx={imgW}
            ariaLabel={getCardName(cardId)}
          />
        </div>
        {reversed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTempUpright((v) => !v);
            }}
            className="text-sm italic text-gold/80 hover:text-gold transition-colors"
            style={{
              marginBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
              fontFamily: "var(--font-serif)",
              opacity: "var(--ro-plus-15)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            {tempUpright
              ? "Show as drawn (reversed)"
              : "Rotate (for this viewing only)"}
          </button>
        )}
      </div>
    </FullScreenSheet>
  );
}