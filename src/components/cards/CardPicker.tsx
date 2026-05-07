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
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Lock, X } from "lucide-react";
import { TAROT_DECK, getCardName, getCardImagePath } from "@/lib/tarot";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search-input";
import { useActiveDeckImage, useDeckImage } from "@/lib/active-deck";
import { useAuth } from "@/lib/auth";
import { fetchUserDecks, type CustomDeck } from "@/lib/custom-decks";

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
  /** 9-6-G — when set, renders a per-slot deck switcher dropdown.
   *  `deckId` is the currently selected deck (null = active deck). */
  deckId?: string | null;
  onDeckChange?: (deckId: string | null) => void;
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
  deckId,
  onDeckChange,
}: CardPickerProps) {
  const [query, setQuery] = useState("");
  const [suit, setSuit] = useState<Suit>("All");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pendingReversed, setPendingReversed] = useState(false);
  const [reviewingCardId, setReviewingCardId] = useState<number | null>(null);

  // 9-6-G — per-slot deck switching. Both hooks must run unconditionally.
  const { user } = useAuth();
  const [decks, setDecks] = useState<CustomDeck[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void fetchUserDecks(user.id).then((d) => {
      if (!cancelled) setDecks(d);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const activeResolve = useActiveDeckImage();
  const specificResolve = useDeckImage(deckId ?? null);
  const resolveImg = (idx: number, size: "display" | "thumbnail" = "thumbnail") => {
    if (resolveImageSrc) return resolveImageSrc(idx);
    if (deckId) return specificResolve(idx, size) ?? getCardImagePath(idx);
    return activeResolve(idx, size);
  };
  const activeDeckObj = decks.find((d) => d.id === deckId);
  const isOracleDeck = activeDeckObj?.deck_type === "oracle";

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
        resolveImageSrc={(i) => resolveImg(i, "display")}
        embedded={embedded}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--color-background)] text-[var(--color-foreground)]",
        embedded ? "absolute inset-0" : "fixed inset-0",
      )}
      style={{
        overscrollBehavior: "contain",
        ...(embedded ? {} : { zIndex: "var(--z-modal)" }),
      }}
    >
      {reviewingCardId !== null && (
        <ReviewPhoto
          cardIndex={reviewingCardId}
          src={resolveImg(reviewingCardId, "display")}
          onRetake={() => {
            const id = reviewingCardId;
            setReviewingCardId(null);
            onSelect(id, false);
          }}
          onDone={() => setReviewingCardId(null)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 p-3">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="rounded-full p-2 hover:bg-foreground/10"
            aria-label="Back"
            style={{ width: 40, height: 40 }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <div style={{ width: 40, height: 40 }} />
        )}
        <div className="text-sm uppercase tracking-[0.25em] opacity-70">
          {title ?? (mode === "photography" ? "Choose card" : "Pick card")}
        </div>
        <div style={{ width: 40, height: 40 }} />
      </div>

      {/* Search + filters */}
      <div className="space-y-2 border-b border-border/40 p-3">
        {onDeckChange && decks.length > 1 && (
          <div
            className="mb-3 flex items-center gap-2"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
            }}
          >
            <span style={{ opacity: 0.7 }}>Deck:</span>
            <select
              value={deckId ?? ""}
              onChange={(e) => onDeckChange(e.target.value || null)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
                padding: "4px 8px",
                fontFamily: "inherit",
                fontSize: "inherit",
                color: "inherit",
                fontStyle: "italic",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="">Active deck</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search 78 cards…"
        />
        {!isOracleDeck && (
          <div className="flex flex-wrap gap-1.5">
            {SUITS.map((s) => (
              <button
                key={s}
                onClick={() => setSuit(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  suit === s
                    ? "border-foreground/60 bg-foreground/15"
                    : "border-border/60 bg-transparent hover:bg-foreground/10",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {cards.map(({ idx, name }) => {
            const isExcluded = mode === "manual-entry" && excluded.has(idx);
            const isShot = mode === "photography" && photographed.has(idx);
            const src = resolveImg(idx, "thumbnail");
            const dimDefault = mode === "photography" && !isShot;
            return (
              <button
                key={idx}
                disabled={isExcluded}
                onClick={() => handleTap(idx)}
                className={cn(
                  "group relative flex flex-col items-stretch overflow-hidden rounded-lg border border-border/40 bg-foreground/5 text-left transition active:scale-[0.98]",
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
        embedded ? "absolute inset-0" : "fixed inset-0",
      )}
      style={embedded ? undefined : { zIndex: "var(--z-modal)" }}
    >
      <div className="flex items-center justify-between border-b border-border/40 p-3">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-foreground/10" aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-sm uppercase tracking-[0.25em] opacity-70">{getCardName(cardIndex)}</div>
        <div className="w-9" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="w-44">
          <div className="aspect-[0.625] overflow-hidden rounded-xl border border-border/40 bg-black shadow-xl">
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
            className="font-display italic text-sm opacity-70 hover:opacity-100 transition-opacity"
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            className="font-display italic text-sm"
            style={{ color: "var(--accent)" }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewPhoto({
  cardIndex,
  src,
  onRetake,
  onDone,
}: {
  cardIndex: number;
  src: string;
  onRetake: () => void;
  onDone: () => void;
}) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center p-6"
      style={{
        background: "color-mix(in oklab, var(--color-background) 85%, black)",
        zIndex: "var(--z-modal-nested)",
      }}
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-xl border p-5"
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--border-subtle)",
          color: "var(--color-foreground)",
        }}
      >
        <div className="text-sm uppercase tracking-[0.25em] opacity-70">
          {getCardName(cardIndex)}
        </div>
        <div className="w-56">
          <div
            className="aspect-[0.625] overflow-hidden rounded-lg border"
            style={{ borderColor: "var(--border-subtle)", background: "#000" }}
          >
            <img src={src} alt="" className="h-full w-full object-cover" />
          </div>
        </div>
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onDone}
            className="flex-1 rounded-md border px-4 py-2 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--color-foreground)",
            }}
          >
            Done
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="flex-1 rounded-md px-4 py-2 text-sm font-medium"
            style={{
              background: "var(--accent, var(--gold))",
              color: "var(--accent-foreground, #000)",
            }}
          >
            Retake
          </button>
        </div>
      </div>
    </div>
  );
}