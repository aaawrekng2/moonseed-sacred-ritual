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
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDeckCards,
  fetchDeckProcessingStatus,
  type DeckProcessingStatus,
  type CustomDeck,
  type CustomDeckCard,
} from "@/lib/custom-decks";
import { variantUrlFor, variantUrlPngFallback } from "@/lib/active-deck";
import { removeCard as removeCardSave, saveCard } from "@/lib/per-card-save";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { PerCardEditModal } from "@/components/deck-import/PerCardEditModal";
import { RadiusPreviewScreen } from "@/components/deck-overview/RadiusPreviewScreen";
import {
  SourceZipPickerModal,
  type ZipPickerTarget,
} from "@/components/deck-import/SourceZipPickerModal";
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
  // 9-6-AH — live processing status for the Re-optimize button.
  const [procStatus, setProcStatus] = useState<DeckProcessingStatus | null>(
    null,
  );
  const [reoptimizing, setReoptimizing] = useState(false);

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
  // 9-6-AH continuation — Fix 3: hold the matched assets between
  // extraction and the save loop so the user can preview the corner
  // radius on real cards before we commit.
  const [pendingImport, setPendingImport] = useState<{
    assets: ImportAsset[];
    result: ImportSessionResult;
  } | null>(null);
  // 26-05-08-K — Fix 7C: numbering-prompt state. When the user uploads
  // an oracle zip whose filenames are mostly numbered, pause the
  // pipeline and ask whether to strip leading numbers from card names.
  const [pendingNumberingChoice, setPendingNumberingChoice] = useState<
    | null
    | { assets: ImportAsset[]; oracleMeta: Map<string, { name: string; description: string }> }
  >(null);
  // 26-05-08-K — Fix 6: pick an already-uploaded card as the deck back.
  const [pickingBack, setPickingBack] = useState(false);
  // 26-05-08-Q9 — per-card recovery flow + back-from-zip picker target.
  const [zipPickerTarget, setZipPickerTarget] =
    useState<ZipPickerTarget | null>(null);
  const [localSourceZipPath, setLocalSourceZipPath] = useState<string | null>(
    deck.source_zip_path ?? null,
  );
  useEffect(() => {
    setLocalSourceZipPath(deck.source_zip_path ?? null);
  }, [deck.source_zip_path]);
  const [localBackUrl, setLocalBackUrl] = useState<string | null>(
    deck.card_back_url ?? null,
  );
  // 26-05-08-Q — Fix 8: default deck-edit view is the editable list
  // (card_name + card_description per row for AI prompt context).
  // Persist user's preference per browser.
  const VIEW_MODE_KEY = "moonseed:deck-edit-view-mode";
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    return v === "grid" ? "grid" : "list";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    }
  }, [viewMode]);
  useEffect(() => {
    setLocalBackUrl(deck.card_back_url ?? null);
  }, [deck.card_back_url]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialActionFiredRef = useRef(false);
  // 9-6-AG — set true to abort the variants pass mid-loop.
  const cancelImportRef = useRef(false);
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

  // 9-6-AH — poll background processing status so the Re-optimize
  // button can surface when there are pending or failed cards.
  useEffect(() => {
    let cancelled = false;
    const expected = deckType === "oracle" ? cards.length : 78;
    if (expected === 0) return;
    const tick = async () => {
      const s = await fetchDeckProcessingStatus(deckId, expected);
      if (!cancelled) setProcStatus(s);
    };
    void tick();
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deckId, deckType, cards.length]);

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

  /**
   * 26-05-08-Q — Fix 8: persist edits to per-card name / description.
   * These power the editable list view and feed the AI prompt builder
   * via custom_deck_cards.card_name / card_description.
   */
  const saveCardMeta = async (
    cardId: number,
    patch: { card_name?: string | null; card_description?: string | null },
  ) => {
    const { error } = await supabase
      .from("custom_deck_cards")
      .update(patch)
      .eq("deck_id", deckId)
      .eq("card_id", cardId)
      .is("archived_at", null);
    if (error) {
      toast.error(`Couldn't save: ${error.message}`);
      return false;
    }
    setCards((prev) =>
      prev.map((c) => (c.card_id === cardId ? { ...c, ...patch } : c)),
    );
    return true;
  };

  /**
   * 9-6-AH — Re-optimize: reset any failed cards back to 'pending' with
   * attempts=0 so the background queue picks them up, then ping the
   * queue once to give it an immediate kick.
   */
  const handleReoptimize = async () => {
    if (reoptimizing) return;
    setReoptimizing(true);
    try {
      const { error: resetErr } = await supabase
        .from("custom_deck_cards")
        .update({
          processing_status: "pending",
          variant_attempts: 0,
          variant_last_attempt_at: null,
        })
        .eq("deck_id", deckId)
        .is("archived_at", null)
        .in("processing_status", ["pending", "failed"]);
      if (resetErr) throw resetErr;
      // Kick the queue once. It's verify_jwt=false; service-role anon is fine.
      try {
        await supabase.functions.invoke("process-variant-queue", {});
      } catch {
        /* non-fatal — pg_cron will pick it up within 30s */
      }
      toast.success("Re-optimizing in the background.");
    } catch (err) {
      console.error("[Re-optimize] failed", err);
      toast.error("Couldn't queue re-optimize.");
    } finally {
      setReoptimizing(false);
    }
  };

  const handleZipUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Please upload a .zip file.");
      return;
    }
    cancelImportRef.current = false;
    setBusy(true);
    setImportProgress({ phase: "extract", current: 0, total: 1 });
    try {
      // 26-05-08-Q9 — persist original zip first so per-card recovery
      // is available even if individual card uploads fail later.
      try {
        const sourcePath = `${userId}/${deckId}/_source.zip`;
        const { error: sourceErr } = await supabase.storage
          .from("custom-deck-images")
          .upload(sourcePath, file, {
            contentType: "application/zip",
            upsert: true,
          });
        if (sourceErr) {
          console.warn("[deck-import] source zip upload failed", sourceErr);
        } else {
          await supabase
            .from("custom_decks")
            .update({ source_zip_path: sourcePath })
            .eq("id", deckId);
          setLocalSourceZipPath(sourcePath);
        }
      } catch (e) {
        console.warn("[deck-import] source zip persistence threw", e);
      }
      const { assets, oracleMeta } = await extractZip(file);
      // 26-05-08-K — Fix 7C: if oracle deck and >half filenames are
      // numbered, ask the user whether to strip the numbers from
      // card names before processing.
      const numberedRe = /^\d+[_\-\s.]/;
      const numberedCount = assets.filter((a) => numberedRe.test(a.filename)).length;
      const isMostlyNumbered = numberedCount * 2 > assets.length;
      if (deckType === "oracle" && isMostlyNumbered) {
        setImportProgress(null);
        setPendingNumberingChoice({ assets, oracleMeta });
        return;
      }
      finishExtraction(assets, oracleMeta, true);
    } catch (err) {
      if (err instanceof ZipTooLargeError || err instanceof ZipEmptyError) {
        toast.error(err.message);
      } else {
        console.error("[DeckOverview] zip upload failed", err);
        toast.error("Couldn't read that zip.");
      }
      setImportProgress(null);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /**
   * 26-05-08-K — Fix 7C: shared continuation after extractZip. Optionally
   * overrides oracleName to keep the leading number in display.
   */
  const finishExtraction = (
    assets: ImportAsset[],
    oracleMeta: Map<string, { name: string; description: string }>,
    stripNumbers: boolean,
  ) => {
    setImportProgress({ phase: "match", current: 0, total: assets.length });
    const result = processImportAssets(assets, deckType, oracleMeta);
    if (deckType === "oracle" && !stripNumbers) {
      // Override oracleName with the raw title-cased stem (numbers kept).
      for (const a of assets) {
        const stem = a.filename.replace(/\.[^.]+$/, "");
        const cleaned = stem.replace(/[_\-]+/g, " ").trim();
        a.oracleName = cleaned
          .split(/\s+/)
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
          .join(" ");
      }
    }
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
    setImportProgress(null);
    setPendingImport({ assets, result });
  };

  const commitImportWithRadius = async (radius: number) => {
    if (!pendingImport) return;
    const { assets, result } = pendingImport;
    setPendingImport(null);
    setBusy(true);
    try {
      // Persist the chosen radius on the deck record so per-card edits
      // and re-imports use the same default going forward.
      await supabase
        .from("custom_decks")
        .update({ corner_radius_percent: radius })
        .eq("id", deckId);

      const opts = {
        shape: deck.shape === "round" ? ("round" as const) : ("rectangle" as const),
        cornerRadiusPercent: radius,
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
      // 26-05-08-O — variants encoded client-side; no queue involvement.
      void savedCardIds;
      await reload();
      toast.success(
        result.matchedCount === totalSlots
          ? `Deck saved. All cards are ready.`
          : `Saved ${result.matchedCount} of ${totalSlots || result.matchedCount} cards. All cards are ready.`,
        { duration: 5000 },
      );
    } catch (err) {
      console.error("[DeckOverview] commit import failed", err);
      toast.error("Couldn't save the import.");
    } finally {
      setBusy(false);
      setImportProgress(null);
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

  const onTileTap = async (
    cardId: number,
    slotKind: "saved" | "ambiguous" | "empty-tarot",
  ) => {
    if (pickedAssetKey) {
      void handleDropOnSlot(cardId);
      return;
    }
    if (slotKind === "empty-tarot") {
      // 26-05-08-J — Fix 6: if there's a failed row with an
      // original_path for this slot, auto-retry instead of opening
      // the camera. The user already gave us pixels — re-run them.
      const { data: failedRow } = await supabase
        .from("custom_deck_cards")
        .select("id, original_path, processing_status")
        .eq("deck_id", deckId)
        .eq("card_id", cardId)
        .is("archived_at", null)
        .maybeSingle();
      // 26-05-08-K — also retry stuck "pending" rows, not just "failed".
      if (failedRow?.original_path) {
        await supabase
          .from("custom_deck_cards")
          .update({
            processing_status: "pending",
            variant_attempts: 0,
            variant_last_attempt_at: null,
          })
          .eq("id", failedRow.id);
        try {
          await supabase.functions.invoke("process-variant-queue", {});
        } catch {
          /* non-fatal — pg_cron will pick it up */
        }
        toast.message(`Retrying card ${cardId}…`);
        void reload();
        return;
      }
      onAction({ kind: "capture-card", cardId });
      return;
    }
    setActionSheetCardId(cardId);
  };

  /**
   * 26-05-08-J — Fix 7: Re-upload the original zip and only save
   * matches for cards that are CURRENTLY failed or empty. Already-
   * saved cards are left untouched.
   */
  const handleReuploadZip = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setBusy(true);
      setImportProgress({ phase: "extract", current: 0, total: 1 });
      try {
        const { assets, oracleMeta } = await extractZip(file);
        setImportProgress({
          phase: "match",
          current: 0,
          total: assets.length,
        });
        const result = processImportAssets(assets, deckType, oracleMeta);

        const { data: existingRows } = await supabase
          .from("custom_deck_cards")
          .select("card_id, processing_status")
          .eq("deck_id", deckId)
          .is("archived_at", null);
        const savedIds = new Set(
          (existingRows ?? [])
            .filter((r) => r.processing_status === "saved")
            .map((r) => r.card_id),
        );

        const assetByKey = new Map(assets.map((a) => [a.key, a]));
        const workItems: Array<{
          cardId: number;
          asset: ImportAsset;
        }> = [];
        for (const [slotStr, assetKey] of Object.entries(result.assigned)) {
          if (slotStr === "BACK") continue;
          const cardId = Number(slotStr);
          if (savedIds.has(cardId)) continue;
          const a = assetByKey.get(assetKey);
          if (!a) continue;
          workItems.push({ cardId, asset: a });
        }

        if (workItems.length === 0) {
          toast.message("No new cards to re-import.");
          return;
        }

        const opts = {
          shape:
            deck.shape === "round"
              ? ("round" as const)
              : ("rectangle" as const),
          cornerRadiusPercent: defaultRadiusPercent,
        };
        setImportProgress({
          phase: "upload",
          current: 0,
          total: workItems.length,
        });
        let uploadedCount = 0;
        for (const item of workItems) {
          await saveCard({
            userId,
            deckId,
            cardId: item.cardId,
            cardKey: item.asset.key,
            image: assetToImportImage(item.asset),
            opts,
            skipAutoVariant: true,
          });
          uploadedCount++;
          setImportProgress({
            phase: "upload",
            current: uploadedCount,
            total: workItems.length,
          });
        }
        try {
          await supabase.functions.invoke("process-variant-queue", {});
        } catch {
          /* non-fatal */
        }
        await reload();
        toast.success(
          `Re-imported ${workItems.length} card${workItems.length === 1 ? "" : "s"}. Processing in background.`,
        );
      } catch (err) {
        if (err instanceof ZipTooLargeError || err instanceof ZipEmptyError) {
          toast.error(err.message);
        } else {
          console.error("[DeckOverview] re-upload failed", err);
          toast.error("Re-upload failed.");
        }
      } finally {
        setBusy(false);
        setImportProgress(null);
      }
    };
    input.click();
  };

  const isEmpty = cards.length === 0 && !deck.card_back_url;
  const showProminentCTAs = isEmpty;

  const headerButtons = (
    <div className="flex items-center gap-2">
      {procStatus && !procStatus.isComplete && (
        <button
          type="button"
          onClick={() => void handleReoptimize()}
          disabled={reoptimizing}
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 px-2.5 py-1.5 text-xs hover:bg-gold/10 disabled:opacity-50"
          aria-label="Re-optimize deck images"
          title={
            procStatus.failed > 0
              ? `Retry ${procStatus.failed} failed card${procStatus.failed === 1 ? "" : "s"}`
              : `${procStatus.pending} card${procStatus.pending === 1 ? "" : "s"} still processing`
          }
        >
          {reoptimizing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Re-optimize</span>
        </button>
      )}
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

      {/* 26-05-08-J — Fix 4: failed-card recovery banner. */}
      {procStatus && procStatus.failed > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
          <div className="min-w-0 flex-1 text-sm">
            <strong>
              {procStatus.failed} card
              {procStatus.failed === 1 ? "" : "s"} didn&rsquo;t process.
            </strong>{" "}
            <span className="text-muted-foreground">
              The original images are still saved — try again or re-upload
              the zip.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleReoptimize()}
            disabled={reoptimizing || busy}
            className="text-sm italic underline disabled:opacity-50"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleReuploadZip}
            disabled={busy}
            className="text-sm italic underline disabled:opacity-50"
          >
            Upload zip again
          </button>
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
          <p className="text-[11px] italic text-muted-foreground">
            A full 78-card import takes about 2-3 minutes. Don&rsquo;t close
            this window.
          </p>
        </div>
      )}

      {/* Card-back tile */}
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-border/60 bg-foreground/[0.02] p-3">
        <button
          type="button"
          onClick={() =>
            localBackUrl
              ? setActionSheetCardId("BACK")
              : onAction({ kind: "capture-back" })
          }
          className="relative flex h-20 w-14 items-center justify-center overflow-hidden rounded border border-border/60 bg-background"
          title={localBackUrl ? "Tap to edit card back" : "Set card back"}
        >
          {localBackUrl ? (
            <img
              src={localBackUrl}
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
            {localBackUrl ? "Tap to replace or remove" : "Tap to set"}
          </p>
          {cards.length > 0 && (
            <button
              type="button"
              onClick={() => setPickingBack(true)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] italic text-muted-foreground underline hover:opacity-80"
            >
              <ImageIcon className="h-3 w-3" /> Choose from uploaded cards
            </button>
          )}
          {localSourceZipPath && (
            <button
              type="button"
              onClick={() => setZipPickerTarget("BACK")}
              className="ml-3 mt-1 inline-flex items-center gap-1 text-[11px] italic text-muted-foreground underline hover:opacity-80"
            >
              <Upload className="h-3 w-3" /> Pick from zip
            </button>
          )}
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading cards…
        </div>
      ) : (
        <>
        {/* 26-05-08-Q — Fix 8: view-mode toggle (List default / Grid). */}
        <div className="mb-2 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
              viewMode === "list"
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border/60 text-muted-foreground hover:bg-foreground/5",
            )}
            title="List view (edit names & descriptions)"
          >
            <ListIcon className="h-3.5 w-3.5" /> List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            aria-pressed={viewMode === "grid"}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
              viewMode === "grid"
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border/60 text-muted-foreground hover:bg-foreground/5",
            )}
            title="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Grid
          </button>
        </div>
        {viewMode === "grid" ? (
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
                {rawSrc && (
                  <TileImage rawSrc={rawSrc} alt={label} />
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
        ) : (
          <ul
            className="space-y-2"
            style={{
              paddingBottom:
                unmatchedAssets.length > 0 && drawerOpen ? "120px" : undefined,
            }}
          >
            {tiles.map((tile) => {
              if (tile.kind === "add-new") {
                return (
                  <li key="add-new">
                    <button
                      type="button"
                      onClick={() =>
                        onAction({
                          kind: "capture-card",
                          cardId: nextOracleId(),
                        })
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground hover:bg-foreground/[0.03]"
                    >
                      <Plus className="h-4 w-4" /> Add new card
                    </button>
                  </li>
                );
              }
              if (tile.kind === "empty-tarot") {
                const tileSrc = getCardImagePath(tile.cardId);
                return (
                  <li
                    key={tile.cardId}
                    className="flex items-center gap-3 rounded-md border border-dashed border-border/60 p-2"
                  >
                    <button
                      type="button"
                      onClick={() => onTileTap(tile.cardId, "empty-tarot")}
                      className="relative h-16 w-12 shrink-0 overflow-hidden rounded border border-border/40"
                      title="Tap to add photo"
                    >
                      <img
                        src={tileSrc}
                        alt={getCardName(tile.cardId)}
                        className="h-full w-full object-contain opacity-25"
                        loading="lazy"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{getCardName(tile.cardId)}</p>
                      <p className="text-[11px] italic text-muted-foreground">
                        Not yet added — tap thumbnail to capture
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setZipPickerTarget(tile.cardId)}
                      className="shrink-0 rounded-full border border-gold/60 px-3 py-1 text-[11px] italic text-gold hover:bg-gold/10"
                    >
                      Tap to fix
                    </button>
                  </li>
                );
              }
              const photo = tile.photo;
              const rawSrc = photo.thumbnail_url ?? photo.display_url ?? null;
              const defaultName =
                tile.cardId < 1000
                  ? getCardName(tile.cardId)
                  : `Card ${tile.cardId}`;
              const isAmbiguous = tile.kind === "ambiguous";
              // Q3 — Fix 7: a card whose display_url matches the deck's
              // chosen card_back_url is "used as back". Stay in the list
              // (still editable) but mark visually so the seeker knows
              // it's been promoted to the back of the deck.
              const isUsedAsBack =
                !!localBackUrl &&
                (photo.display_url === localBackUrl ||
                  photo.thumbnail_url === localBackUrl);
              return (
                <li
                  key={tile.cardId}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-2",
                    isAmbiguous
                      ? "border-yellow-500/60 bg-yellow-500/5"
                      : isUsedAsBack
                        ? "border-2 border-gold/60"
                        : "border-border/60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onTileTap(
                        tile.cardId,
                        isAmbiguous ? "ambiguous" : "saved",
                      )
                    }
                    className="relative h-20 w-14 shrink-0 overflow-hidden rounded border border-border/40 bg-background"
                    title="Tap to edit photo"
                  >
                    {rawSrc && <TileImage rawSrc={rawSrc} alt={defaultName} />}
                    {isAmbiguous && (
                      <span className="absolute right-0.5 top-0.5 rounded-full bg-yellow-500/90 p-0.5 text-cosmos">
                        <AlertTriangle className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      type="text"
                      defaultValue={photo.card_name ?? defaultName}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        const current = photo.card_name ?? defaultName;
                        if (next === current) return;
                        void saveCardMeta(tile.cardId, {
                          card_name: next || null,
                        });
                      }}
                      placeholder={defaultName}
                      className="w-full rounded border border-border/40 bg-background px-2 py-1 text-sm focus:border-gold/60 focus:outline-none"
                      aria-label={`Card name for ${defaultName}`}
                    />
                    {isUsedAsBack && (
                      <p className="mt-0.5 text-[10px] italic text-gold/70">
                        Used as back
                      </p>
                    )}
                    <textarea
                      defaultValue={photo.card_description ?? ""}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        const current = (photo.card_description ?? "").trim();
                        if (next === current) return;
                        void saveCardMeta(tile.cardId, {
                          card_description: next || null,
                        });
                      }}
                      placeholder="Description for the AI reader (meaning, symbolism, themes…)"
                      rows={2}
                      className="w-full resize-y rounded border border-border/40 bg-background px-2 py-1 text-xs leading-snug text-muted-foreground focus:border-gold/60 focus:text-foreground focus:outline-none"
                      aria-label={`Description for ${defaultName}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        </>
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

      {/* 9-6-AH continuation — Fix 3: radius preview overlay. */}
      {pendingImport &&
        createPortal(
          <RadiusPreviewScreen
            shape={deck.shape === "round" ? "round" : "rectangle"}
            initialRadius={defaultRadiusPercent}
            items={(() => {
              const assignedKeys = new Set(
                Object.values(pendingImport.result.assigned),
              );
              return pendingImport.assets
                .filter((a) => assignedKeys.has(a.key))
                .slice(0, 5)
                .map((a) => {
                  const slotEntry = Object.entries(
                    pendingImport.result.assigned,
                  ).find(([, k]) => k === a.key);
                  let cardName = a.oracleName ?? a.filename;
                  if (slotEntry) {
                    const slot = slotEntry[0];
                    if (slot !== "BACK" && /^\d+$/.test(slot)) {
                      const id = Number(slot);
                      if (id < ORACLE_BASE) cardName = getCardName(id);
                    }
                  }
                  return {
                    thumbnailDataUrl: a.thumbnailDataUrl ?? "",
                    fullDataUrl: a.fullDataUrl,
                    cardName,
                  };
                });
            })()}
            onCommit={(radius) => void commitImportWithRadius(radius)}
            onSkip={() => void commitImportWithRadius(defaultRadiusPercent)}
            onCancel={() => {
              setPendingImport(null);
              setImportResult(null);
              setUnmatchedAssets([]);
              setAmbiguousAssetByCardId(new Map());
            }}
          />,
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
                    "Step 1 of 3: Reading the zip…"}
                  {importProgress.phase === "match" &&
                    "Step 2 of 3: Matching cards…"}
                  {importProgress.phase === "upload" &&
                    `Step 3 of 3: Saving cards… ${importProgress.current} of ${importProgress.total}`}
                </p>
              </div>
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
              {importProgress.phase === "variants" && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => { cancelImportRef.current = true; }}
                    className="text-xs italic text-muted-foreground underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* 26-05-08-K — Fix 7C: numbering prompt */}
      {pendingNumberingChoice &&
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
              <p className="mb-4 text-sm">
                Your files appear to be numbered. How should card names be displayed?
              </p>
              {(() => {
                const sample = pendingNumberingChoice.assets.find((a) => /^\d/.test(a.filename))
                  ?? pendingNumberingChoice.assets[0];
                if (!sample) return null;
                const stem = sample.filename.replace(/\.[^.]+$/, "");
                const stripped = stem.replace(/^\d+[_\-\s.]+/, "").replace(/[_\-]+/g, " ").trim() || stem;
                const kept = stem.replace(/[_\-]+/g, " ").trim();
                return (
                  <div className="flex flex-col gap-2 text-sm">
                    <button
                      type="button"
                      className="text-left underline hover:opacity-80"
                      onClick={() => {
                        const choice = pendingNumberingChoice;
                        setPendingNumberingChoice(null);
                        finishExtraction(choice.assets, choice.oracleMeta, true);
                      }}
                    >
                      Strip the numbers (e.g. &ldquo;{stem}&rdquo; → &ldquo;{stripped}&rdquo;)
                    </button>
                    <button
                      type="button"
                      className="text-left underline hover:opacity-80"
                      onClick={() => {
                        const choice = pendingNumberingChoice;
                        setPendingNumberingChoice(null);
                        finishExtraction(choice.assets, choice.oracleMeta, false);
                      }}
                    >
                      Keep the numbers (e.g. &ldquo;{stem}&rdquo; → &ldquo;{kept}&rdquo;)
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>,
          document.body,
        )}

      {/* 26-05-08-K — Fix 6: pick-an-uploaded-card-as-back overlay */}
      {pickingBack &&
        createPortal(
          <div
            className="fixed inset-0 z-[130] overflow-y-auto p-5"
            style={{
              background: "color-mix(in oklab, var(--color-background) 92%, black)",
            }}
          >
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs italic text-muted-foreground">
                  Tap a card to use as the deck back
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPickingBack(false)}
                    className="text-xs italic text-muted-foreground underline"
                  >
                    Cancel
                  </button>
                  {/* 26-05-08-N — Fix 6: explicit exit. The back is
                      saved the moment a card is tapped, but the
                      seeker may have arrived here without intending to
                      change it; Done returns to the deck either way. */}
                  <button
                    type="button"
                    onClick={() => setPickingBack(false)}
                    className="text-xs italic text-gold underline"
                  >
                    Done — return to deck
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {cards.map((card) => {
                  const src = card.thumbnail_url ?? card.display_url ?? null;
                  if (!src) return null;
                  const isCurrent =
                    !!localBackUrl &&
                    (card.display_url === localBackUrl ||
                      card.thumbnail_url === localBackUrl);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const newBackUrl = card.display_url ?? src;
                        const newBackThumb =
                          card.thumbnail_url ?? card.display_url ?? src;
                        const { error } = await supabase
                          .from("custom_decks")
                          .update({
                            card_back_url: newBackUrl,
                            card_back_thumb_url: newBackThumb,
                          })
                          .eq("id", deckId);
                        setBusy(false);
                        if (error) {
                          toast.error(`Couldn't set card back: ${error.message}`);
                          return;
                        }
                        setLocalBackUrl(newBackUrl);
                        setPickingBack(false);
                        toast.success("Card back updated");
                      }}
                      className={cn(
                        "group relative aspect-[2/3] overflow-hidden rounded hover:border-gold/60",
                        isCurrent
                          ? "border-2 border-gold"
                          : "border border-border/60",
                      )}
                    >
                      <img
                        src={src}
                        alt={card.card_name ?? `Card ${card.card_id}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                      {isCurrent && (
                        <span className="absolute right-1 top-1 rounded-full border border-gold/50 bg-gold/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                          Current
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
      {/* 26-05-08-Q9 — per-card / back recovery from source zip */}
      {zipPickerTarget !== null && (
        <SourceZipPickerModal
          open
          onClose={() => setZipPickerTarget(null)}
          userId={userId}
          deckId={deckId}
          sourceZipPath={localSourceZipPath}
          target={zipPickerTarget}
          opts={{
            shape:
              deck.shape === "round"
                ? ("round" as const)
                : ("rectangle" as const),
            cornerRadiusPercent: defaultRadiusPercent,
          }}
          onSaved={() => {
            void reload();
          }}
        />
      )}
    </section>
  );
}

function firstEmptyTarotId(photoMap: Map<number, CustomDeckCard>): number {
  for (let i = 0; i < 78; i++) if (!photoMap.has(i)) return i;
  return 0;
}

/**
 * 9-6-AG — Tile <img> with .webp → .png → original fallback chain.
 * Mirrors CardImage's logic but works directly off a storage URL so
 * it covers oracle slots (cardId >= 1000) too.
 */
function TileImage({ rawSrc, alt }: { rawSrc: string; alt: string }) {
  const [failedFor, setFailedFor] = useState<null | "webp" | "png">(null);
  const webpSrc = variantUrlFor(rawSrc, "md");
  const pngSrc = variantUrlPngFallback(rawSrc, "md");
  const src =
    failedFor === null ? (webpSrc ?? rawSrc)
    : failedFor === "webp" ? (pngSrc ?? rawSrc)
    : rawSrc;
  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-contain"
      loading="lazy"
      onError={() => {
        if (failedFor === null) setFailedFor("webp");
        else if (failedFor === "webp") setFailedFor("png");
      }}
    />
  );
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
  onReplaceFromZip,
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
  onReplaceFromZip?: () => void;
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
          {onReplaceFromZip && (
            <SheetButton
              icon={FolderArchive}
              label="Replace from source zip"
              onClick={onReplaceFromZip}
            />
          )}
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