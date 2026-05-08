/**
 * 9-6-AB — Unified Deck Overview Screen.
 *
 * Consolidates the deck management surface. Owns:
 *   - Header with inline-editable deck name + back arrow
 *   - Take-photo / Upload entry buttons (prominent for empty decks)
 *   - Card-back tile
 *   - Card grid (78 fixed for tarot, saved + Add for oracle)
 *   - Action sheet (Edit / Replace photo / Replace upload / Remove,
 *     plus "Confirm match" for ambiguous tiles)
 *   - Match-result banner after a zip upload
 *   - Ambiguous-match yellow border + warning icon
 *   - Unmatched-thumbnails sticky drawer with tap-to-pickup-then-drop
 *
 * Zip uploads run through the shared `deck-import-pipeline` module so
 * this screen and the legacy ZipImporter share one extraction +
 * matching code path.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
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
import { removeCard as removeCardSave, saveCard } from "@/lib/per-card-save";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { PerCardEditModal } from "@/components/deck-import/PerCardEditModal";
import {
  assetToImportImage,
  extractZip,
  processImportAssets,
  ZipEmptyError,
  ZipTooLargeError,
  type ImportAsset,
  type ImportSessionResult,
} from "@/lib/deck-import-pipeline";
import { cn } from "@/lib/utils";

const ORACLE_BASE = 1000;

export type DeckOverviewAction =
  | { kind: "capture-card"; cardId: number }
  | { kind: "capture-back" };

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
  /** Delegate capture flows to the parent (which owns PhotoCapture). */
  onAction: (action: DeckOverviewAction) => void;
  /** Back arrow / close handler. */
  onClose: () => void;
  /** 9-6-AB — when set, fire on mount: "upload" auto-opens the zip
   *  picker. Used by the new-deck flow that came in via "Import zip". */
  initialAction?: "upload";
};

type Tile =
  | { kind: "saved"; cardId: number; photo: CustomDeckCard }
  | {
      kind: "ambiguous";
      cardId: number;
      photo: CustomDeckCard;
      matchScore: number;
    }
  | { kind: "empty-tarot"; cardId: number }
  | { kind: "add-new" };

export function DeckOverviewScreen({
  userId,
  deckId,
  deck,
  name,
  defaultRadiusPercent,
  onNameChange,
  onAction,
  onClose,
  initialAction,
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

  const [importResult, setImportResult] = useState<ImportSessionResult | null>(
    null,
  );
  const [unmatchedAssets, setUnmatchedAssets] = useState<ImportAsset[]>([]);
  const [ambiguousAssetByCardId, setAmbiguousAssetByCardId] = useState<
    Map<number, { assetKey: string; matchScore: number }>
  >(new Map());
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [pickedAssetKey, setPickedAssetKey] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{
    phase: "extract" | "match" | "upload" | "variants";
    current: number;
    total: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialActionFiredRef = useRef(false);
  const deckType = deck.deck_type ?? "tarot";

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

  // 9-6-AB — auto-open the file picker when the parent routed in via
  // an "Import zip" intent.
  useEffect(() => {
    if (initialAction === "upload" && !initialActionFiredRef.current) {
      initialActionFiredRef.current = true;
      requestAnimationFrame(() => fileInputRef.current?.click());
    }
  }, [initialAction]);

  const photoMap = useMemo(
    () => new Map(cards.map((c) => [c.card_id, c])),
    [cards],
  );

  const tiles: Tile[] = useMemo(() => {
    const buildSaved = (cardId: number, photo: CustomDeckCard): Tile => {
      const amb = ambiguousAssetByCardId.get(cardId);
      if (amb) {
        return {
          kind: "ambiguous",
          cardId,
          photo,
          matchScore: amb.matchScore,
        };
      }
      return { kind: "saved", cardId, photo };
    };
    if (deckType === "tarot") {
      return Array.from({ length: 78 }, (_, i) => {
        const photo = photoMap.get(i);
        return photo ? buildSaved(i, photo) : { kind: "empty-tarot", cardId: i };
      });
    }
    const saved = [...photoMap.entries()]
      .map(([cardId, photo]) => buildSaved(cardId, photo))
      .sort((a, b) => {
        const aId = "cardId" in a ? a.cardId : 0;
        const bId = "cardId" in b ? b.cardId : 0;
        return aId - bId;
      });
    return [...saved, { kind: "add-new" }];
  }, [deckType, photoMap, ambiguousAssetByCardId]);

  const totalLabel =
    deckType === "tarot"
      ? `${cards.length} of 78 cards · tarot`
      : `${cards.length} cards · oracle`;

  const totalSlots = deckType === "tarot" ? 78 : cards.length;

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

  const triggerUpload = () => fileInputRef.current?.click();

  const handleZipUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Please upload a .zip file.");
      return;
    }
    setBusy(true);
    setImportProgress({ phase: "extract", current: 0, total: 1 });
    try {
      const { assets, oracleMeta } = await extractZip(file);
      setImportProgress({ phase: "match", current: 0, total: assets.length });
      const result = processImportAssets(assets, deckType, oracleMeta);
      setImportResult(result);
      setBannerDismissed(false);
      setDrawerOpen(true);
      setUnmatchedAssets(
        assets.filter((a) => result.unmatched[a.key] !== undefined),
      );
      setAmbiguousAssetByCardId(
        new Map(
          result.ambiguous.map((a) => [
            a.cardId,
            { assetKey: a.assetKey, matchScore: a.matchScore },
          ]),
        ),
      );

      const opts = {
        shape: deck.shape === "round" ? ("round" as const) : ("rectangle" as const),
        cornerRadiusPercent: defaultRadiusPercent,
      };
      const assetByKey = new Map(assets.map((a) => [a.key, a]));

      // 9-6-AE — build work list and upload sequentially with progress;
      // defer variant generation until uploads complete.
      const workItems: Array<{ cardId: number | "BACK"; asset: ImportAsset }> = [];
      if (result.cardBackKey) {
        const a = assetByKey.get(result.cardBackKey);
        if (a) workItems.push({ cardId: "BACK", asset: a });
      }
      for (const [slotStr, assetKey] of Object.entries(result.assigned)) {
        if (slotStr === "BACK") continue;
        const a = assetByKey.get(assetKey);
        if (!a) continue;
        workItems.push({ cardId: Number(slotStr), asset: a });
      }
      setImportProgress({ phase: "upload", current: 0, total: workItems.length });
      const savedCardIds: number[] = [];
      let uploadedCount = 0;
      for (const item of workItems) {
        const res = await saveCard({
          userId,
          deckId,
          cardId: item.cardId,
          cardKey: item.asset.key,
          image: assetToImportImage(item.asset),
          opts,
          skipAutoVariant: true,
        });
        uploadedCount++;
        setImportProgress({ phase: "upload", current: uploadedCount, total: workItems.length });
        if (res.status === "saved" && item.cardId !== "BACK") {
          savedCardIds.push(item.cardId);
        }
      }
      // Sequential variant pass — one invoke at a time.
      if (savedCardIds.length > 0) {
        setImportProgress({ phase: "variants", current: 0, total: savedCardIds.length });
        const { data: sess } = await supabase.auth.getSession();
        const jwt = sess.session?.access_token;
        if (jwt) {
          let vDone = 0;
          for (const cardId of savedCardIds) {
            try {
              await supabase.functions.invoke("generate-deck-variants", {
                body: { deckId, cardId },
                headers: { Authorization: `Bearer ${jwt}` },
              });
            } catch (err) {
              console.warn("[DeckOverview] variant gen failed", { cardId, err });
            }
            vDone++;
            setImportProgress({ phase: "variants", current: vDone, total: savedCardIds.length });
          }
        }
      }
      await reload();
      toast.success(
        `Matched ${result.matchedCount} of ${totalSlots || result.matchedCount} cards`,
      );
    } catch (err) {
      if (err instanceof ZipTooLargeError || err instanceof ZipEmptyError) {
        toast.error(err.message);
      } else {
        console.error("[DeckOverview] zip upload failed", err);
        toast.error("Couldn't read that zip.");
      }
    } finally {
      setBusy(false);
      setImportProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmMatch = (cardId: number) => {
    setAmbiguousAssetByCardId((prev) => {
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
    setImportResult((prev) => {
      if (!prev) return prev;
      const ambiguous = prev.ambiguous.filter((a) => a.cardId !== cardId);
      return {
        ...prev,
        ambiguous,
        ambiguousCount: ambiguous.length,
      };
    });
  };

  const handleDropOnSlot = async (cardId: number) => {
    if (!pickedAssetKey) return;
    const asset = unmatchedAssets.find((a) => a.key === pickedAssetKey);
    if (!asset) return;
    setBusy(true);
    const opts = {
      shape: deck.shape === "round" ? ("round" as const) : ("rectangle" as const),
      cornerRadiusPercent: defaultRadiusPercent,
    };
    const res = await saveCard({
      userId,
      deckId,
      cardId,
      cardKey: asset.key,
      image: assetToImportImage(asset),
      opts,
    });
    setBusy(false);
    if (res.status === "failed") {
      toast.error(`Couldn't assign image: ${res.error}`);
      return;
    }
    setPickedAssetKey(null);
    setUnmatchedAssets((prev) => prev.filter((a) => a.key !== asset.key));
    await reload();
  };

  const onTileTap = (cardId: number, slotKind: "saved" | "ambiguous" | "empty-tarot") => {
    if (pickedAssetKey) {
      void handleDropOnSlot(cardId);
      return;
    }
    if (slotKind === "empty-tarot") {
      onAction({ kind: "capture-card", cardId });
      return;
    }
    setActionSheetCardId(cardId);
  };

  const isEmpty = cards.length === 0 && !deck.card_back_url;
  const showProminentCTAs = isEmpty;

  const headerButtons = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() =>
          onAction({
            kind: "capture-card",
            cardId:
              deckType === "oracle"
                ? nextOracleId()
                : firstEmptyTarotId(photoMap),
          })
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 px-2.5 py-1.5 text-xs hover:bg-gold/10"
        aria-label="Take photo"
      >
        <Camera className="h-4 w-4" />
        <span className="hidden sm:inline">Photo</span>
      </button>
      <button
        type="button"
        onClick={triggerUpload}
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
      {/* Hidden file input for zip upload. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleZipUpload(file);
        }}
      />

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

      {/* Match-result banner */}
      {importResult && !bannerDismissed && (
        <div
          className="mb-4 flex items-start gap-3 rounded-lg border p-3"
          style={{
            background: "color-mix(in oklab, var(--accent) 12%, transparent)",
            borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
          }}
        >
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Matched {importResult.matchedCount} of {totalSlots || importResult.matchedCount} from filenames
            </p>
            <p className="text-xs text-muted-foreground">
              {importResult.ambiguousCount} need review · {importResult.unmatchedCount} unmatched
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="rounded-md p-1 hover:bg-foreground/5"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pickup hint */}
      {pickedAssetKey && (
        <div className="mb-3 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs">
          Tap a card slot to drop the picked image, or tap the thumbnail again to release.
        </div>
      )}

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
                    deckType === "oracle"
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
              onClick={triggerUpload}
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
        <div
          className="grid grid-cols-4 gap-2 sm:grid-cols-6"
          style={{
            paddingBottom:
              unmatchedAssets.length > 0 && drawerOpen ? "120px" : undefined,
          }}
        >
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
                  onClick={() => onTileTap(tile.cardId, "empty-tarot")}
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
                    {pickedAssetKey ? "Tap to drop" : "Tap to add"}
                  </span>
                </button>
              );
            }
            const photo = tile.photo;
            const rawSrc = photo.thumbnail_url ?? photo.display_url ?? null;
            const tileSrc = rawSrc
              ? variantUrlFor(rawSrc, "md") ?? rawSrc
              : null;
            const label =
              photo.card_name ??
              (tile.cardId < 1000
                ? getCardName(tile.cardId)
                : `Card ${tile.cardId}`);
            const isAmbiguous = tile.kind === "ambiguous";
            return (
              <button
                key={tile.cardId}
                type="button"
                onClick={() =>
                  onTileTap(tile.cardId, isAmbiguous ? "ambiguous" : "saved")
                }
                className={cn(
                  "group relative aspect-[2/3] overflow-hidden rounded",
                  isAmbiguous
                    ? "border-2 border-yellow-500"
                    : "border border-border/60",
                )}
                title={isAmbiguous ? `${label} · low-confidence match` : label}
              >
                {tileSrc && (
                  <img
                    src={tileSrc}
                    alt={label}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                )}
                {isAmbiguous ? (
                  <span className="absolute right-1 top-1 rounded-full bg-yellow-500/90 p-0.5 text-cosmos">
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="absolute right-1 top-1 rounded-full bg-gold/90 p-0.5 text-cosmos">
                    <Check className="h-3 w-3" />
                  </span>
                )}
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
            isAmbiguous={
              actionSheetCardId !== "BACK" &&
              ambiguousAssetByCardId.has(actionSheetCardId)
            }
            onClose={() => setActionSheetCardId(null)}
            onConfirmMatch={() => {
              if (actionSheetCardId !== "BACK") {
                handleConfirmMatch(actionSheetCardId);
              }
              setActionSheetCardId(null);
            }}
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
              setActionSheetCardId(null);
              triggerUpload();
            }}
            onRemove={() => void handleRemove(actionSheetCardId)}
          />,
          document.body,
        )}

      {/* Unmatched drawer */}
      {unmatchedAssets.length > 0 && drawerOpen &&
        createPortal(
          <div
            className="fixed inset-x-0 z-[110] border-t p-3"
            style={{
              bottom:
                "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))",
              background: "var(--surface-card, var(--background))",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">
                {unmatchedAssets.length} image
                {unmatchedAssets.length === 1 ? "" : "s"} need a slot
              </p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md p-1 hover:bg-foreground/5"
                aria-label="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {unmatchedAssets.map((asset) => {
                const isPicked = pickedAssetKey === asset.key;
                return (
                  <button
                    key={asset.key}
                    type="button"
                    onClick={() =>
                      setPickedAssetKey(isPicked ? null : asset.key)
                    }
                    className={cn(
                      "flex-none overflow-hidden rounded border bg-background",
                      isPicked
                        ? "border-2 border-gold"
                        : "border-border/60",
                    )}
                    style={{ width: 48, height: 72 }}
                    title={asset.filename}
                  >
                    {asset.thumbnailDataUrl && (
                      <img
                        src={asset.thumbnailDataUrl}
                        alt={asset.filename}
                        className="h-full w-full object-contain"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] italic text-muted-foreground">
              {pickedAssetKey
                ? "Tap a card slot to assign"
                : "Tap a thumbnail to pick it up"}
            </p>
          </div>,
          document.body,
        )}

      {/* 9-6-AE — Zip-import progress modal */}
      {importProgress &&
        createPortal(
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center"
            style={{
              background: "color-mix(in oklab, var(--color-background) 70%, black)",
            }}
          >
            <div
              className="w-full max-w-sm rounded-xl border p-5"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--surface-card, var(--background))",
              }}
            >
              <div className="mb-3 flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-gold" />
                <p className="text-sm font-medium">
                  {importProgress.phase === "extract" &&
                    "Step 1 of 4: Reading the zip…"}
                  {importProgress.phase === "match" &&
                    "Step 2 of 4: Matching cards…"}
                  {importProgress.phase === "upload" &&
                    `Step 3 of 4: Saving cards… ${importProgress.current} of ${importProgress.total}`}
                  {importProgress.phase === "variants" &&
                    `Step 4 of 4: Optimizing images… ${importProgress.current} of ${importProgress.total}`}
                </p>
              </div>
              {importProgress.phase === "variants" && (
                <p className="mb-3 text-xs text-muted-foreground">
                  This is the longest step. About 2 minutes for 78 cards.
                </p>
              )}
              {importProgress.phase === "upload" && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Saving each card to your library.
                </p>
              )}
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{
                  background: "color-mix(in oklab, var(--gold) 12%, transparent)",
                }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={importProgress.total || 1}
                aria-valuenow={importProgress.current}
              >
                <div
                  className="h-full transition-[width] duration-200 ease-out"
                  style={{
                    width: `${
                      importProgress.total
                        ? Math.max(
                            2,
                            Math.min(
                              100,
                              (importProgress.current / importProgress.total) * 100,
                            ),
                          )
                        : 4
                    }%`,
                    background: "var(--gold)",
                    opacity: 0.85,
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] italic text-muted-foreground">
                Keep this screen open until the import finishes.
              </p>
            </div>
          </div>,
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
  isAmbiguous,
  onClose,
  onConfirmMatch,
  onEdit,
  onReplacePhoto,
  onReplaceUpload,
  onRemove,
}: {
  target: number | "BACK";
  busy: boolean;
  isAmbiguous: boolean;
  onClose: () => void;
  onConfirmMatch: () => void;
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
        background: "color-mix(in oklab, var(--color-background) 70%, black)",
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
          {isAmbiguous && (
            <SheetButton
              icon={Check}
              label="Confirm match"
              onClick={onConfirmMatch}
            />
          )}
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