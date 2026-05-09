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
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, Lock, X } from "lucide-react";
import { TAROT_DECK, getCardName, getCardImagePath } from "@/lib/tarot";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search-input";
import { AdaptiveCardImage } from "@/components/card/AdaptiveCardImage";
import { useActiveDeckImage, useDeckImage, variantUrlFor } from "@/lib/active-deck";
import { useAuth } from "@/lib/auth";
import {
  fetchUserDecks,
  fetchDeckCards,
  type CustomDeck,
  type CustomDeckCard,
} from "@/lib/custom-decks";

export type CardPickerMode = "photography" | "manual-entry";

/** 9-6-N — derive a human name from an oracle card's filename slug. */
function deriveNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const stem = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (!stem) return null;
  return (
    stem
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || null
  );
}

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
  onSelect: (
    cardIndex: number,
    isReversed: boolean,
    deckId: string | null,
    cardName: string,
  ) => void;
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

  // 9-6-M — custom deck-picker dropdown (replaces unstylable native <select>).
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const deckPickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!deckPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        deckPickerRef.current &&
        !deckPickerRef.current.contains(e.target as Node)
      ) {
        setDeckPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [deckPickerOpen]);

  // 9-6-H — when a custom deck is selected, render that deck's actual
  // cards (not the 78 fixed tarot indices). Critical for oracle decks
  // whose cards have user-supplied names and ids starting at 1000.
  const [deckCards, setDeckCards] = useState<CustomDeckCard[]>([]);
  useEffect(() => {
    if (!deckId) {
      setDeckCards([]);
      return;
    }
    let cancelled = false;
    void fetchDeckCards(deckId).then((cards) => {
      if (!cancelled) {
        // 26-05-08-M — Fix 6: when the seeker chose one of their
        // uploaded cards as the deck back, that card has a real
        // positive card_id but its display_url matches the deck's
        // card_back_url. Filter it out so it doesn't appear as a
        // drawable card.
        const selectedDeck = decks.find((d) => d.id === deckId) ?? null;
        const backUrl =
          selectedDeck?.card_back_url ?? selectedDeck?.card_back_thumb_url ?? null;
        setDeckCards(
          cards
            // 26-05-08-L — never show the card back in the picker.
            // Back is stored on `custom_decks`, not in this table, but
            // we guard `card_id >= 0` defensively in case of legacy rows.
            .filter((c) => {
              if (c.source === "default") return false;
              if (c.card_id < 0) return false;
              if (backUrl) {
                if (c.display_url === backUrl) return false;
                if (c.thumbnail_url === backUrl) return false;
              }
              return true;
            })
            .sort((a, b) => a.card_id - b.card_id),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [deckId, decks]);

  const photographed = useMemo(() => new Set(photographedIds), [photographedIds]);
  const excluded = useMemo(() => new Set(excludeCardIds), [excludeCardIds]);

  // 9-6-H — gridItems unify default tarot + custom-deck rendering.
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (deckId && deckCards.length > 0) {
      return deckCards
        .map((c) => ({
          idx: c.card_id,
          name:
            c.card_name ??
            deriveNameFromPath(c.display_path) ??
            getCardName(c.card_id) ??
            `Card ${c.card_id}`,
          // 9-6-N — prefer thumbnail to avoid loading multi-MB grid tiles.
          // 9-6-P — route through variantUrlFor so the picker grid shows
          // the corner-cropped -full.webp variant rather than the raw
          // upload (relevant before the edge function rewrites URLs).
          src:
            variantUrlFor(c.thumbnail_url ?? c.display_url, "full") ??
            (c.thumbnail_url ?? c.display_url),
        }))
        .filter(({ name }) => !q || name.toLowerCase().includes(q));
    }
    return TAROT_DECK.map((name, idx) => ({
      idx,
      name,
      src: undefined as string | undefined,
    })).filter(({ idx, name }) => {
      if (suit !== "All" && suitOf(idx) !== suit) return false;
      if (q && !name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, suit, deckId, deckCards]);

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
    const item = cards.find((c) => c.idx === cardIndex);
    onSelect(
      cardIndex,
      false,
      deckId ?? null,
      item?.name ?? getCardName(cardIndex) ?? `Card ${cardIndex}`,
    );
  };

  if (pendingId !== null) {
    const pendingItem = cards.find((c) => c.idx === pendingId);
    return (
      <ConfirmReversed
        cardIndex={pendingId}
        name={pendingItem?.name ?? getCardName(pendingId)}
        isReversed={pendingReversed}
        onToggle={setPendingReversed}
        onBack={() => setPendingId(null)}
        onConfirm={() =>
          onSelect(
            pendingId,
            pendingReversed,
            deckId ?? null,
            pendingItem?.name ?? getCardName(pendingId) ?? `Card ${pendingId}`,
          )
        }
        // 9-6-O — use thumbnail for the post-pick confirmation preview;
        // the full-size display URL is wasteful here.
        resolveImageSrc={(i) => resolveImg(i, "thumbnail")}
        embedded={embedded}
        deckId={deckId ?? null}
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
            onSelect(
              id,
              false,
              deckId ?? null,
              getCardName(id) ?? `Card ${id}`,
            );
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
        {onDeckChange && decks.length > 0 && (
          <div
            className="mb-3 flex items-center gap-2"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
            }}
          >
            <span style={{ opacity: 0.7 }}>Deck:</span>
            <div className="relative" ref={deckPickerRef}>
              <button
                type="button"
                onClick={() => setDeckPickerOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md border px-2 py-1"
                style={{
                  background: "var(--surface-card)",
                  borderColor: "var(--border-subtle)",
                  fontStyle: "italic",
                  color: "inherit",
                }}
              >
                {activeDeckObj?.card_back_thumb_url || activeDeckObj?.card_back_url ? (
                  <img
                    src={(activeDeckObj.card_back_thumb_url ?? activeDeckObj.card_back_url) as string}
                    alt=""
                    className="h-6 w-6 rounded object-cover"
                  />
                ) : null}
                <span>{activeDeckObj?.name ?? "Active deck"}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {deckPickerOpen && (
                <div
                  className="absolute left-0 top-full mt-1 flex min-w-[200px] flex-col rounded-md border p-1 shadow-lg"
                  style={{
                    background: "var(--surface-elevated, var(--background))",
                    borderColor: "var(--border-subtle)",
                    zIndex: "var(--z-popover, 50)" as unknown as number,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onDeckChange(null);
                      setDeckPickerOpen(false);
                    }}
                    className="rounded px-2 py-1.5 text-left text-sm italic hover:bg-foreground/10"
                  >
                    Active deck
                  </button>
                  {decks.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        onDeckChange(d.id);
                        setDeckPickerOpen(false);
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/10"
                    >
                      {d.card_back_thumb_url || d.card_back_url ? (
                        <img
                          src={(d.card_back_thumb_url ?? d.card_back_url) as string}
                          alt=""
                          className="h-8 w-8 rounded object-cover"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded bg-foreground/10" />
                      )}
                      <span>{d.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
          {cards.map(({ idx, name, src: itemSrc }) => {
            const isExcluded = mode === "manual-entry" && excluded.has(idx);
            const isShot = mode === "photography" && photographed.has(idx);
            const src = itemSrc ?? resolveImg(idx, "thumbnail");
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
                <div className="relative aspect-[0.625] w-full">
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain"
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
  name,
  isReversed,
  onToggle,
  onBack,
  onConfirm,
  resolveImageSrc,
  embedded = false,
  deckId = null,
}: {
  cardIndex: number;
  name: string;
  isReversed: boolean;
  onToggle: (v: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
  resolveImageSrc?: (cardIndex: number) => string;
  embedded?: boolean;
  deckId?: string | null;
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
        <div className="text-sm uppercase tracking-[0.25em] opacity-70">{name}</div>
        <div className="w-9" />
      </div>
      {/* 9-6-H — tighter sizing so Back/Confirm fit on short bottom sheets. */}
      <div className="flex flex-col items-center justify-start gap-3 p-4">
        <div className="w-32">
          <AdaptiveCardImage
            src={src}
            reversed={isReversed}
            borderRadius={12}
            className="border border-border/40 shadow-xl"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
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
          <AdaptiveCardImage
            src={src}
            borderRadius={8}
            className="border"
            style={{ borderColor: "var(--border-subtle)" }}
          />
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