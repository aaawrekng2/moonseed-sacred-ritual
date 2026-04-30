/**
 * CardPicker — visual grid for choosing one of the 78 tarot cards (Stamp AR).
 *
 * Two modes:
 *   - 'photography'   — used during deck setup; each card shows whether
 *                       it has been photographed yet. All cards stay
 *                       tappable so the user can retake any photo.
 *   - 'manual-entry'  — used when a seeker logs a physical reading;
 *                       cards already placed in the spread are dimmed
 *                       and locked. Optionally surfaces a 'Reversed?'
 *                       confirmation step before firing onSelect.
 */
import { useMemo, useState } from "react";
import { Check, ChevronLeft, Lock, Search, X } from "lucide-react";
import { TAROT_DECK, getCardName, getCardImagePath } from "@/lib/tarot";
import { cn } from "@/lib/utils";

export type CardPickerMode = "photography" | "manual-entry";

export type CardPickerProps = {
  mode: CardPickerMode;
  /** Card ids (0..77) considered "already photographed" in photography mode. */
  photographedIds?: number[];
  /** Card ids (0..77) excluded (locked) in manual-entry mode. */
  excludeCardIds?: number[];
  /** Show a 'Reversed?' confirmation step (manual-entry only). */
  showReversedToggle?: boolean;
  /** Optional override for the per-card thumbnail src (used by deck photography). */
  resolveImageSrc?: (cardIndex: number) => string;
  onSelect: (cardIndex: number, isReversed: boolean) => void;
  onCancel: () => void;
  /** Optional title shown in the header. */
  title?: string;
  /**
   * When true, render filling its parent (absolute inset-0) instead of
   * the default full-viewport fixed overlay. Used by ManualEntryBuilder
   * so the picker sits inside a bottom sheet and the spread stays
   * visible above it.
   */
  embedded?: boolean;
};

type Suit = "All" | "Major Arcana" | "Wands" | "Cups" | "Swords" | "Pentacles";
const SUITS: Suit[] = ["All", "Major Arcana", "Wands", "Cups", "Swords", "Pentacles"];

function suitOf(cardIndex: number): Exclude<Suit, "All"> {
  if (cardIndex < 22) return "Major Arcana";
  const minorIndex = cardIndex - 22;
  const suitIdx = Math.floor(minorIndex / 14);
  return (["Wands", "Cups", "Swords", "Pentacles"] as const)[suitIdx];
}

export function CardPicker({
  mode,
  photographedIds = [],
  excludeCardIds = [],
  showReversedToggle = false,
  resolveImageSrc,
  onSelect,
  onCancel,
  title,
  embedded = false,
}: CardPickerProps) {
  const [query, setQuery] = useState("");
  const [suit, setSuit] = useState<Suit>("All");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pendingReversed, setPendingReversed] = useState(false);
  const [reviewingCardId, setReviewingCardId] = useState<number | null>(null);

  const photographed = useMemo(() => new Set(photographedIds), [photographedIds]);
  const excluded = useMemo(() => new Set(excludeCardIds), [excludeCardIds]);

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TAROT_DECK.map((name, idx) => ({ idx, name }))
      .filter(({ idx, name }) => {
        if (suit !== "All" && suitOf(idx) !== suit) return false;
        if (q && !name.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [query, suit]);

  const handleTap = (cardIndex: number) => {
    if (mode === "manual-entry" && excluded.has(cardIndex)) return;
    if (mode === "photography" && photographed.has(cardIndex)) {
      setReviewingCardId(cardIndex);
      return;
    }
    if (mode === "manual-entry" && showReversedToggle) {
      setPendingId(cardIndex);
      setPendingReversed(false);
      return;
    }
    onSelect(cardIndex, false);
  };

  if (pendingId !== null) {
    return (
      <ConfirmReversed
        cardIndex={pendingId}
        isReversed={pendingReversed}
        onToggle={setPendingReversed}
        onBack={() => setPendingId(null)}
        onConfirm={() => onSelect(pendingId, pendingReversed)}
        resolveImageSrc={resolveImageSrc}
        embedded={embedded}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--color-background)] text-[var(--color-foreground)]",
        embedded ? "absolute inset-0" : "fixed inset-0 z-[100]",
      )}
    >
      {reviewingCardId !== null && (
        <ReviewPhoto
          cardIndex={reviewingCardId}
          src={
            resolveImageSrc
              ? resolveImageSrc(reviewingCardId)
              : getCardImagePath(reviewingCardId)
          }
          onRetake={() => {
            const id = reviewingCardId;
            setReviewingCardId(null);
            onSelect(id, false);
          }}
          onDone={() => setReviewingCardId(null)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 p-3">
        <button
          onClick={onCancel}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-sm uppercase tracking-[0.25em] opacity-70">
          {title ?? (mode === "photography" ? "Choose card" : "Pick card")}
        </div>
        <div className="w-9" />
      </div>

      {/* Search + filters */}
      <div className="space-y-2 border-b border-white/10 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 78 cards…"
            className="w-full rounded-md border border-white/10 bg-white/5 px-9 py-2 text-sm outline-none focus:border-white/30"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUITS.map((s) => (
            <button
              key={s}
              onClick={() => setSuit(s)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                suit === s
                  ? "border-white/60 bg-white/15"
                  : "border-white/15 bg-transparent hover:bg-white/5",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {cards.map(({ idx, name }) => {
            const isExcluded = mode === "manual-entry" && excluded.has(idx);
            const isShot = mode === "photography" && photographed.has(idx);
            const src = resolveImageSrc ? resolveImageSrc(idx) : getCardImagePath(idx);
            const dimDefault = mode === "photography" && !isShot;
            return (
              <button
                key={idx}
                disabled={isExcluded}
                onClick={() => handleTap(idx)}
                className={cn(
                  "group relative flex flex-col items-stretch overflow-hidden rounded-lg border border-white/10 bg-white/5 text-left transition active:scale-[0.98]",
                  isExcluded && "cursor-not-allowed opacity-30",
                )}
                style={{ touchAction: "manipulation" }}
              >
                <div className="relative aspect-[0.625] w-full bg-black">
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    style={
                      dimDefault
                        ? { opacity: 0.3, filter: "grayscale(100%)" }
                        : undefined
                    }
                  />
                  {isShot && (
                    <div className="absolute right-1 top-1 rounded-full bg-emerald-500/90 p-1 text-white">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                  {dimDefault && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-1 text-center text-[10px] uppercase tracking-wider text-white/80">
                      Tap to photograph
                    </div>
                  )}
                  {isExcluded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Lock className="h-5 w-5 text-white/80" />
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 text-[11px] leading-tight opacity-90">
                  {name}
                </div>
              </button>
            );
          })}
        </div>
        {cards.length === 0 && (
          <div className="py-12 text-center text-sm opacity-60">
            No cards match.
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmReversed({
  cardIndex,
  isReversed,
  onToggle,
  onBack,
  onConfirm,
  resolveImageSrc,
  embedded = false,
}: {
  cardIndex: number;
  isReversed: boolean;
  onToggle: (v: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
  resolveImageSrc?: (cardIndex: number) => string;
  embedded?: boolean;
}) {
  const src = resolveImageSrc ? resolveImageSrc(cardIndex) : getCardImagePath(cardIndex);
  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--color-background)] text-[var(--color-foreground)]",
        embedded ? "absolute inset-0" : "fixed inset-0 z-[100]",
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 p-3">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-white/10" aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-sm uppercase tracking-[0.25em] opacity-70">{getCardName(cardIndex)}</div>
        <div className="w-9" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="w-44">
          <div className="aspect-[0.625] overflow-hidden rounded-xl border border-white/10 bg-black shadow-xl">
            <img
              src={src}
              alt=""
              className="h-full w-full object-cover"
              style={{ transform: isReversed ? "rotate(180deg)" : undefined }}
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={isReversed}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4"
          />
          Reversed?
        </label>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="rounded-full border border-white/15 px-5 py-2 text-sm hover:bg-white/5"
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-white/90"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}