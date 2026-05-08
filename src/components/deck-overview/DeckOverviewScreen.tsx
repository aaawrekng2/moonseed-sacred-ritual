/**
 * 9-6-AA — Unified Deck Overview Screen (shell).
 *
 * Single screen for viewing & editing a custom deck. Replaces the
 * legacy `kind: "grid"` view inside DeckEditor. Owns:
 *   - Header with inline-editable deck name + back arrow
 *   - "Take photo" / "Upload" entry buttons (prominent for empty decks,
 *     compact in the header otherwise)
 *   - Card-back tile (separate prominent slot above the grid)
 *   - Card grid (78 fixed for tarot, saved + Add for oracle)
 *   - Action sheet (Edit crop & corners / Replace with photo / Replace
 *     with upload / Remove from deck)
 *   - Per-card edit modal (delegated to PerCardEditModal)
 *
 * Out of scope for the shell phase (deferred to 9-6-AB):
 *   - Match-result banner from a recent zip import
 *   - Unmatched-thumbnails drawer
 *   - Ambiguous-match yellow border + warning icon
 * The shell delegates Take-photo / Upload to the existing PhotoCapture
 * and ZipImporter pipelines via callback props so all working
 * upload/extract/match code stays intact.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDeckCards,
  type CustomDeck,
  type CustomDeckCard,
} from "@/lib/custom-decks";
import { variantUrlFor } from "@/lib/active-deck";
import { removeCard as removeCardSave } from "@/lib/per-card-save";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { PerCardEditModal } from "@/components/deck-import/PerCardEditModal";
import { cn } from "@/lib/utils";

const ORACLE_BASE = 1000;

export type DeckOverviewAction =
  | { kind: "capture-card"; cardId: number }
  | { kind: "capture-back" }
  | { kind: "upload" };

type Props = {
  userId: string;
  deckId: string;
  deck: CustomDeck;
  /** Live deck name (mirrored from parent so edits propagate up). */
  name: string;
  /** Default per-deck radius percent — handed to PerCardEditModal. */
  defaultRadiusPercent: number;
  /** Notify parent of name change so it can refresh its local state. */
  onNameChange: (next: string) => void;
  /** Delegate to existing capture/import flows. */
  onAction: (action: DeckOverviewAction) => void;
  /** Back arrow / close handler. */
  onClose: () => void;
};

type Tile =
  | { kind: "saved"; cardId: number; photo: CustomDeckCard }
  | { kind: "empty-tarot"; cardId: number }
  | { kind: "add-new" };

export function DeckOverviewScreen({
  userId: _userId,
  deckId,
  deck,
  name,
  defaultRadiusPercent,
  onNameChange,
  onAction,
  onClose,
}: Props) {
  const [cards, setCards] = useState<CustomDeckCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [editingBack, setEditingBack] = useState(false);
  const [actionSheetCardId, setActionSheetCardId] = useState<
    number | "BACK" | null
  >(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [savingName, setSavingName] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const list = await fetchDeckCards(deckId);
    setCards(list);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  const photoMap = useMemo(
    () => new Map(cards.map((c) => [c.card_id, c])),
    [cards],
  );

  const tiles: Tile[] = useMemo(() => {
    if (deck.deck_type === "tarot") {
      return Array.from({ length: 78 }, (_, i) => {
        const photo = photoMap.get(i);
        return photo
          ? ({ kind: "saved", cardId: i, photo } satisfies Tile)
          : ({ kind: "empty-tarot", cardId: i } satisfies Tile);
      });
    }
    const saved = [...photoMap.entries()]
      .map(([cardId, photo]) =>
        ({ kind: "saved", cardId, photo } satisfies Tile),
      )
      .sort((a, b) => a.cardId - b.cardId);
    return [...saved, { kind: "add-new" }];
  }, [deck.deck_type, photoMap]);

  const totalLabel =
    deck.deck_type === "tarot"
      ? `${cards.length} of 78 cards · tarot`
      : `${cards.length} cards · oracle`;

  const nextOracleId = () => {
    const ids = [...photoMap.keys()].filter((id) => id >= ORACLE_BASE);
    return ids.length === 0 ? ORACLE_BASE : Math.max(...ids) + 1;
  };

  const saveName = async () => {
    const next = draftName.trim();
    if (!next || next === name) {
      setEditingName(false);
      setDraftName(name);
      return;
    }
    setSavingName(true);
    const { error } = await supabase
      .from("custom_decks")
      .update({ name: next })
      .eq("id", deckId);
    setSavingName(false);
    setEditingName(false);
    if (error) {
      toast.error(`Couldn't rename deck: ${error.message}`);
      setDraftName(name);
      return;
    }
    onNameChange(next);
  };

  const handleRemove = async (cardId: number | "BACK") => {
    setBusy(true);
    const res = await removeCardSave({
      deckId,
      cardId,
      cardKey: cardId === "BACK" ? "back" : `card-${cardId}`,
    });
    setBusy(false);
    setActionSheetCardId(null);
    if (res.status === "failed") {
      toast.error(`Couldn't remove card: ${res.error}`);
      return;
    }
    await reload();
  };

  const isEmpty = cards.length === 0 && !deck.card_back_url;
  const showProminentCTAs = isEmpty;

  const headerButtons = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onAction({ kind: "capture-card", cardId: deck.deck_type === "oracle" ? nextOracleId() : firstEmptyTarotId(photoMap) })}
        className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 px-2.5 py-1.5 text-xs hover:bg-gold/10"
        aria-label="Take photo"
      >
        <Camera className="h-4 w-4" />
        <span className="hidden sm:inline">Photo</span>
      </button>
      <button
        type="button"
        onClick={() => onAction({ kind: "upload" })}
        className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 px-2.5 py-1.5 text-xs hover:bg-gold/10"
        aria-label="Upload images"
      >
        <Upload className="h-4 w-4" />
        <span className="hidden sm:inline">Upload</span>
      </button>
    </div>
  );

  return (
    <section className="py-6">
      {/* Header */}
      <header className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-foreground/5"
            aria-label="Back to deck list"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            My Decks
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                autoFocus
                value={draftName}
                disabled={savingName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setDraftName(name);
                  }
                }}
                className="w-full bg-transparent border-b border-gold/40 text-2xl font-semibold italic outline-none"
                style={{ fontFamily: "var(--font-serif)" }}
                maxLength={60}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group inline-flex max-w-full items-baseline gap-2 text-left"
                title="Tap to rename"
              >
                <h1
                  className="truncate text-2xl font-semibold italic"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {name}
                </h1>
                <Pencil className="h-3.5 w-3.5 opacity-40 group-hover:opacity-80" />
              </button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{totalLabel}</p>
          </div>
          {!showProminentCTAs && headerButtons}
        </div>
      </header>

      {/* Prominent CTAs for empty decks */}
      {showProminentCTAs && (
        <div className="mb-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 bg-foreground/[0.02] p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Start by adding cards to your deck.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() =>
                onAction({
                  kind: "capture-card",
                  cardId:
                    deck.deck_type === "oracle"
                      ? nextOracleId()
                      : firstEmptyTarotId(photoMap),
                })
              }
              className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm hover:bg-gold/20"
            >
              <Camera className="h-4 w-4" /> Take photo
            </button>
            <button
              type="button"
              onClick={() => onAction({ kind: "upload" })}
              className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm hover:bg-gold/20"
            >
              <Upload className="h-4 w-4" /> Upload images
            </button>
          </div>
          <p className="text-[11px] italic text-muted-foreground">
            Upload one image, many, or a zip
          </p>
        </div>
      )}

      {/* Card-back tile */}
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-border/60 bg-foreground/[0.02] p-3">
        <button
          type="button"
          onClick={() =>
            deck.card_back_url
              ? setActionSheetCardId("BACK")
              : onAction({ kind: "capture-back" })
          }
          className="relative flex h-20 w-14 items-center justify-center overflow-hidden rounded border border-border/60 bg-background"
          title={deck.card_back_url ? "Tap to edit card back" : "Set card back"}
        >
          {deck.card_back_url ? (
            <img
              src={deck.card_back_url}
              alt="Card back"
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Card back
          </p>
          <p className="text-sm">
            {deck.card_back_url ? "Tap to replace or remove" : "Tap to set"}
          </p>
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading cards…
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {tiles.map((tile) => {
            if (tile.kind === "add-new") {
              return (
                <button
                  key="add-new"
                  type="button"
                  onClick={() =>
                    onAction({
                      kind: "capture-card",
                      cardId: nextOracleId(),
                    })
                  }
                  className="group relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded border border-dashed border-border/60 hover:bg-foreground/[0.03]"
                  aria-label="Add new card"
                >
                  <Plus className="h-8 w-8 text-muted-foreground" />
                </button>
              );
            }
            if (tile.kind === "empty-tarot") {
              const tileSrc = getCardImagePath(tile.cardId);
              return (
                <button
                  key={tile.cardId}
                  type="button"
                  onClick={() =>
                    onAction({ kind: "capture-card", cardId: tile.cardId })
                  }
                  className="group relative aspect-[2/3] overflow-hidden rounded border border-dashed border-border/60"
                  title={getCardName(tile.cardId)}
                >
                  <img
                    src={tileSrc}
                    alt={getCardName(tile.cardId)}
                    className="h-full w-full object-contain"
                    style={{ opacity: 0.25 }}
                    loading="lazy"
                  />
                  <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[8px] uppercase tracking-wider text-white/70">
                    Tap to add
                  </span>
                </button>
              );
            }
            const rawSrc =
              tile.photo.thumbnail_url ?? tile.photo.display_url ?? null;
            const tileSrc = rawSrc
              ? variantUrlFor(rawSrc, "md") ?? rawSrc
              : null;
            const label =
              tile.photo.card_name ??
              (tile.cardId < 1000
                ? getCardName(tile.cardId)
                : `Card ${tile.cardId}`);
            return (
              <button
                key={tile.cardId}
                type="button"
                onClick={() => setActionSheetCardId(tile.cardId)}
                className="group relative aspect-[2/3] overflow-hidden rounded border border-border/60"
                title={label}
              >
                {tileSrc && (
                  <img
                    src={tileSrc}
                    alt={label}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                )}
                <span className="absolute right-1 top-1 rounded-full bg-gold/90 p-0.5 text-cosmos">
                  <Check className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Per-card edit modal */}
      {editingCardId !== null && (
        <PerCardEditModal
          deckId={deckId}
          deckName={name}
          defaultRadiusPercent={defaultRadiusPercent}
          initialCardId={editingCardId}
          onClose={async () => {
            setEditingCardId(null);
            await reload();
          }}
        />
      )}

      {/* Card-back edit modal */}
      {editingBack && (
        <PerCardEditModal
          deckId={deckId}
          deckName={name}
          defaultRadiusPercent={defaultRadiusPercent}
          backMode
          onClose={async () => {
            setEditingBack(false);
            await reload();
          }}
        />
      )}

      {/* Action sheet */}
      {actionSheetCardId !== null &&
        createPortal(
          <ActionSheet
            target={actionSheetCardId}
            busy={busy}
            onClose={() => setActionSheetCardId(null)}
            onEdit={() => {
              if (actionSheetCardId === "BACK") setEditingBack(true);
              else setEditingCardId(actionSheetCardId);
              setActionSheetCardId(null);
            }}
            onReplacePhoto={() => {
              if (actionSheetCardId === "BACK")
                onAction({ kind: "capture-back" });
              else
                onAction({
                  kind: "capture-card",
                  cardId: actionSheetCardId,
                });
              setActionSheetCardId(null);
            }}
            onReplaceUpload={() => {
              onAction({ kind: "upload" });
              setActionSheetCardId(null);
            }}
            onRemove={() => void handleRemove(actionSheetCardId)}
          />,
          document.body,
        )}
    </section>
  );
}

function firstEmptyTarotId(photoMap: Map<number, CustomDeckCard>): number {
  for (let i = 0; i < 78; i++) if (!photoMap.has(i)) return i;
  return 0;
}

function ActionSheet({
  target,
  busy,
  onClose,
  onEdit,
  onReplacePhoto,
  onReplaceUpload,
  onRemove,
}: {
  target: number | "BACK";
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onReplacePhoto: () => void;
  onReplaceUpload: () => void;
  onRemove: () => void;
}) {
  const title =
    target === "BACK"
      ? "Card back"
      : target < 1000
        ? getCardName(target)
        : `Card ${target}`;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
      style={{
        background:
          "color-mix(in oklab, var(--color-background) 70%, black)",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-xl border bg-background p-2 sm:rounded-xl"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--surface-card)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <p
            className="italic"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-heading-sm)",
            }}
          >
            {title}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-foreground/5"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col">
          <SheetButton icon={Pencil} label="Edit crop & corners" onClick={onEdit} />
          <SheetButton
            icon={Camera}
            label="Replace with photo"
            onClick={onReplacePhoto}
          />
          <SheetButton
            icon={Upload}
            label="Replace with upload"
            onClick={onReplaceUpload}
          />
          <SheetButton
            icon={Trash2}
            label={busy ? "Removing…" : "Remove from deck"}
            destructive
            disabled={busy}
            onClick={onRemove}
          />
        </div>
      </div>
    </div>
  );
}

function SheetButton({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm transition-colors",
        destructive
          ? "text-red-400 hover:bg-red-500/10"
          : "hover:bg-foreground/5",
        disabled && "opacity-50",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}