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
import { X } from "lucide-react";
import { getCardName } from "@/lib/tarot";
import { useActiveDeckImage } from "@/lib/active-deck";
import { useEffect, useState } from "react";

interface CardZoomModalProps {
  cardId: number;
  reversed?: boolean;
  onClose: () => void;
}

export function CardZoomModal({ cardId, reversed, onClose }: CardZoomModalProps) {
  const cardImg = useActiveDeckImage();
  // DB-1.2 — viewing-only rotate. Local state, never persists; saved
  // reading data is unaffected.
  const [tempUpright, setTempUpright] = useState(false);
  const showRotated = !!reversed && !tempUpright;
  // Allow Escape key to close on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Zoomed view of ${getCardName(cardId)}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close zoom"
        className="absolute right-4 top-4 z-10 rounded-full bg-black/40 p-2 text-white"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X size={24} />
      </button>
      <img
        src={cardImg(cardId)}
        alt={getCardName(cardId)}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        style={{
          transform: showRotated ? "rotate(180deg)" : undefined,
          transition: "transform 300ms ease",
          boxShadow: "0 0 80px -10px rgba(212,175,55,0.5)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      {reversed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTempUpright((v) => !v);
          }}
          className="absolute left-1/2 -translate-x-1/2 text-sm italic text-gold/80 hover:text-gold transition-colors"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
            fontFamily: "var(--font-serif)",
            opacity: "var(--ro-plus-15)",
          }}
        >
          {tempUpright
            ? "Show as drawn (reversed)"
            : "Rotate (for this viewing only)"}
        </button>
      )}
    </div>
  );
}