/**
 * FD-2 — Per-card edit modal.
 *
 * Minimal thin-slice UI launched from Settings → Decks. Lets the
 * user pick one card from a custom deck and adjust its corner-radius
 * percentage. While the slider drags we apply CSS `border-radius`
 * for instant feedback. On slider release we rasterize the result
 * via Canvas — this preview matches what the Edge Function will
 * bake into the saved `-full.webp` variant.
 *
 * "Save card" invokes the Edge Function in single-card mode. On
 * success the IMG src is bumped with a cache-buster so the new
 * rounded `-full.webp` shows immediately.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchDeckCards, type CustomDeckCard } from "@/lib/custom-decks";
import { getCardName } from "@/lib/tarot";
import { useConfirm } from "@/hooks/use-confirm";
import { Modal } from "@/components/ui/modal";
import { LoadingText } from "@/components/ui/loading-text";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// FI-2 — 4-corner crop coordinates in IMG NATURAL pixel space.
type CropCoords = {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  bl: { x: number; y: number };
  br: { x: number; y: number };
};

function defaultCropFor(w: number, h: number): CropCoords {
  return {
    tl: { x: 0, y: 0 },
    tr: { x: w, y: 0 },
    bl: { x: 0, y: h },
    br: { x: w, y: h },
  };
}

function isCropCoords(v: unknown): v is CropCoords {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  for (const k of ["tl", "tr", "bl", "br"]) {
    const p = o[k] as { x?: unknown; y?: unknown } | undefined;
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return false;
  }
  return true;
}

type Props = {
  deckId: string;
  deckName: string;
  defaultRadiusPercent: number;
  onClose: () => void;
};

export function PerCardEditModal({
  deckId,
  deckName,
  defaultRadiusPercent,
  onClose,
}: Props) {
  const confirm = useConfirm();
  const [cards, setCards] = useState<CustomDeckCard[] | null>(null);
  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<number, string>>({});
  const [radius, setRadius] = useState<number>(defaultRadiusPercent);
  const [savedRadii, setSavedRadii] = useState<Record<number, number>>({});
  // FI-2 — per-card crop coords loaded from DB.
  const [savedCrops, setSavedCrops] = useState<Record<number, CropCoords>>({});
  const [crop, setCrop] = useState<CropCoords | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // FJ-1 — abort controller for batch processing (Cancel button).
  const [batchAbort, setBatchAbort] = useState<AbortController | null>(null);
  // FI-3 — choice dialog state for "Apply to all".
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyScope, setApplyScope] = useState<"unsaved" | "all">("unsaved");
  const [canvasPreview, setCanvasPreview] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // FG-3 — show big radius number overlay only while user is dragging.
  const [isSliding, setIsSliding] = useState(false);
  // FE-2 — track the natural dimensions of the loaded preview so we
  // can compute a single px corner radius (rather than a percent that
  // CSS interprets per-axis and turns into an ellipse on tarot-aspect
  // cards).
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  // FF-1 — track the IMG's RENDERED size (not natural). Applying a
  // natural-pixel radius to a rendered IMG that's been scaled down by
  // maxHeight: 75vh produces visually-maxed corners far below the
  // slider's range. Using clientWidth/Height keeps the visual radius
  // proportional to the actual on-screen size.
  const [renderedDims, setRenderedDims] = useState<
    { w: number; h: number } | null
  >(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);

  // Phase 9.5a — zoom/pan transform applied to the preview IMG.
  // zoom is a multiplier (1 = native fit-to-viewport size). pan is
  // pixel offset in screen space, applied as a CSS translate before
  // the scale. Reset on card change so each card opens at 1.0/0,0.
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<
    | {
        dist: number;
        mid: { x: number; y: number };
        zoom: number;
        pan: { x: number; y: number };
      }
    | null
  >(null);
  const panStartRef = useRef<
    | { pointer: { x: number; y: number }; pan: { x: number; y: number } }
    | null
  >(null);

  // Load card list + per-card radii.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchDeckCards(deckId);
        if (cancelled) return;
        const photographed = list
          .filter((c) => c.source !== "default" && !!c.display_path)
          .sort((a, b) => a.card_id - b.card_id);
        setCards(photographed);
        // Sign URLs in one batch.
        const paths = photographed.map((c) => c.display_path);
        if (paths.length > 0) {
          const { data: signed } = await supabase.storage
            .from("custom-deck-images")
            .createSignedUrls(paths, 60 * 60);
          if (cancelled) return;
          const map: Record<number, string> = {};
          for (let i = 0; i < photographed.length; i++) {
            const url = signed?.[i]?.signedUrl;
            if (url) map[photographed[i].card_id] = url;
          }
          setSignedUrls(map);
        }
        // Pull existing per-card radii in a separate query so we
        // don't have to widen CustomDeckCard everywhere.
        // FK-1 — include processing_status so pendingCount can be
        // computed at modal open. Without this, the Resume button
        // never appears on stuck decks.
        const { data: rows } = await supabase
          .from("custom_deck_cards")
          .select("card_id, corner_radius_percent, crop_coords, processing_status")
          .eq("deck_id", deckId)
          .is("archived_at", null);
        if (cancelled) return;
        const sr: Record<number, number> = {};
        const sc: Record<number, CropCoords> = {};
        for (const r of rows ?? []) {
          if (typeof r.corner_radius_percent === "number") {
            sr[r.card_id] = r.corner_radius_percent;
          }
          if (isCropCoords(r.crop_coords)) {
            sc[r.card_id] = r.crop_coords;
          }
        }
        setSavedRadii(sr);
        setSavedCrops(sc);
        // FK-1 — merge processing_status onto cards so pendingCount works
        // immediately on open (fetchDeckCards may not include it).
        const statusByCard = new Map<number, string>();
        for (const r of rows ?? []) {
          if (typeof r.processing_status === "string") {
            statusByCard.set(r.card_id, r.processing_status);
          }
        }
        setCards((prev) =>
          prev
            ? prev.map((c) => {
                const s = statusByCard.get(c.card_id);
                return s
                  ? ({ ...(c as unknown as object), processing_status: s } as unknown as CustomDeckCard)
                  : c;
              })
            : prev,
        );
        if (photographed.length > 0) {
          const first = photographed[0].card_id;
          setActiveCardId(first);
          setRadius(sr[first] ?? defaultRadiusPercent);
        }
      } catch (err) {
        console.error("[FD-2] failed to load deck cards", err);
        toast.error("Failed to load deck cards.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, defaultRadiusPercent]);

  const activeUrl = useMemo(
    () => (activeCardId !== null ? signedUrls[activeCardId] ?? null : null),
    [activeCardId, signedUrls],
  );

  // Rasterize current preview to match the server bake.
  function renderCanvasPreview(): void {
    const img = imgRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const canvas = document.createElement("canvas");
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = Math.round((Math.min(w, h) * radius) / 100);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, w, h);
    setCanvasPreview(canvas.toDataURL("image/webp", 0.85));
  }

  // Reset Canvas preview whenever the active card changes.
  useEffect(() => {
    setCanvasPreview(null);
    setImgDims(null);
    setRenderedDims(null);
    // FI-2 — clear crop until imgDims arrive; we'll hydrate then.
    setCrop(null);
    // Phase 9.5a — reset zoom/pan when switching cards so each card
    // opens at native fit-to-viewport size with no offset.
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeCardId]);

  // FI-2 — hydrate crop from saved coords (or default rect) once we
  // know the natural dimensions of the loaded image.
  useEffect(() => {
    if (activeCardId === null || !imgDims) return;
    const saved = savedCrops[activeCardId];
    setCrop(saved ?? defaultCropFor(imgDims.w, imgDims.h));
  }, [activeCardId, imgDims, savedCrops]);

  // FF-1 — observe rendered size of the preview IMG. Fires on initial
  // mount, modal resize, viewport rotation, and whenever the image
  // node is swapped out for a new card.
  useEffect(() => {
    const node = imgRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (node.clientWidth > 0 && node.clientHeight > 0) {
        setRenderedDims({ w: node.clientWidth, h: node.clientHeight });
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [activeCardId, activeUrl, canvasPreview]);

  async function handleSave() {
    if (activeCardId === null || busy) return;
    setBusy(true);
    try {
      // First persist the chosen radius so the edge fn picks it up.
      const patch: {
        corner_radius_percent: number;
        processing_status: string;
        crop_coords?: CropCoords;
      } = {
        corner_radius_percent: radius,
        processing_status: "pending",
      };
      if (crop) patch.crop_coords = crop;
      const { error: updErr } = await supabase
        .from("custom_deck_cards")
        .update(patch)
        .eq("deck_id", deckId)
        .eq("card_id", activeCardId);
      if (updErr) throw updErr;

      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) throw new Error("Not signed in.");
      const { data, error } = await supabase.functions.invoke(
        "generate-deck-variants",
        {
          body: { deckId, cardId: activeCardId },
          headers: { Authorization: `Bearer ${jwt}` },
        },
      );
      if (error) throw error;
      const result = (data ?? {}) as {
        ok?: boolean;
        error?: string;
        step?: string;
      };
      if (!result.ok) {
        // FG-1 — surface the named-step from the edge function so the
        // failure point is visible without digging through logs.
        const stepLabel = result.step ? ` (step: ${result.step})` : "";
        throw new Error(`${result.error ?? "Processing failed."}${stepLabel}`);
      }
      setSavedRadii((prev) => ({ ...prev, [activeCardId]: radius }));
      if (crop) {
        setSavedCrops((prev) => ({ ...prev, [activeCardId]: crop }));
      }
      // Cache-bust the visible image so the new -full.webp shows.
      setVersion((v) => v + 1);
      toast.success(`${getCardName(activeCardId)} saved.`);
    } catch (err) {
      console.error("[FD-3] save card failed", err);
      // FG-1 — also try to extract the step from a FunctionsHttpError
      // body when supabase-js wraps the response.
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  // FI-3 — open the choice dialog instead of going straight to confirm.
  function handleApplyToAll() {
    if (bulkBusy || busy) return;
    if (!cards || cards.length === 0) return;
    setApplyScope("unsaved");
    setApplyDialogOpen(true);
  }

  // FI-3 — perform the apply with the chosen scope (unsaved-only or all).
  async function applyToSelected(scope: "unsaved" | "all") {
    const list = cards ?? [];
    const targets = scope === "unsaved"
      ? list.filter((c) => !(c.card_id in savedRadii))
      : list;
    const targetCount = targets.length;
    if (targetCount === 0) {
      toast.info("No cards to update.");
      return;
    }

    setBulkBusy(true);
    try {
      const updatePatch: {
        corner_radius_percent: number;
        processing_status: string;
        crop_coords?: CropCoords;
      } = {
        corner_radius_percent: radius,
        processing_status: "pending",
      };
      if (crop) updatePatch.crop_coords = crop;

      const targetIds = targets.map((c) => c.card_id);
      const { error } = await supabase
        .from("custom_deck_cards")
        .update(updatePatch)
        .eq("deck_id", deckId)
        .is("archived_at", null)
        .in("card_id", targetIds);
      if (error) throw error;

      const nextRadii: Record<number, number> = {};
      const nextCrops: Record<number, CropCoords> = {};
      for (const c of targets) {
        nextRadii[c.card_id] = radius;
        if (crop) nextCrops[c.card_id] = crop;
      }
      setSavedRadii((prev) => ({ ...prev, ...nextRadii }));
      if (crop) setSavedCrops((prev) => ({ ...prev, ...nextCrops }));
      toast.success(`Settings applied to ${targetCount} cards.`);

      const goProcess = await confirm({
        title: `Process ${targetCount} cards now?`,
        description: "This may take several minutes. You can also do it later from Settings → Decks.",
        confirmLabel: "Process now",
        cancelLabel: "Not now",
      });
      if (!goProcess) return;

      await processCards(targets);
    } catch (err) {
      console.error("[FI-3] apply-to-all failed", err);
      toast.error(
        err instanceof Error ? err.message : "Apply to all failed.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  // FJ-1 — Reusable batch processing loop with progress, cancel, and
  // 60s per-card timeout. Used by both Apply-to-all and Resume.
  async function processCards(targets: CustomDeckCard[]) {
    const targetCount = targets.length;
    if (targetCount === 0) return;

    const { data: sess } = await supabase.auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) throw new Error("Not signed in.");

    const abortController = new AbortController();
    setBatchAbort(abortController);

    let done = 0;
    let failed = 0;
    let cancelled = false;

    const progressId = toast.loading(`Starting… 0/${targetCount}`, {
      duration: Infinity,
      cancel: {
        label: "Cancel",
        onClick: () => {
          cancelled = true;
          abortController.abort();
        },
      },
    });

    try {
      for (let i = 0; i < targets.length; i++) {
        if (cancelled) break;
        const c = targets[i];

        toast.loading(
          `Processing ${i + 1}/${targetCount} (${getCardName(c.card_id)})…`,
          { id: progressId },
        );

        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 60000);

        try {
          const invokePromise = supabase.functions.invoke(
            "generate-deck-variants",
            {
              body: { deckId, cardId: c.card_id },
              headers: { Authorization: `Bearer ${jwt}` },
            },
          );

          const result = (await Promise.race([
            invokePromise,
            new Promise((_, reject) => {
              abortController.signal.addEventListener(
                "abort",
                () => reject(new Error("Batch cancelled by user")),
                { once: true },
              );
              timeoutController.signal.addEventListener(
                "abort",
                () => reject(new Error("Card processing timeout (60s)")),
                { once: true },
              );
            }),
          ])) as {
            data?: { ok?: boolean; error?: string; step?: string };
            error?: unknown;
          };

          clearTimeout(timeoutId);

          if (result.error) throw result.error;
          const data = result.data ?? {};
          if (!data.ok) {
            failed++;
            console.warn(
              `[FJ-1] card ${c.card_id} failed`,
              data.step,
              data.error,
            );
          }
        } catch (e) {
          clearTimeout(timeoutId);
          failed++;
          const msg = (e as Error).message ?? String(e);
          if (msg.includes("cancelled")) {
            cancelled = true;
            break;
          }
          console.warn(`[FJ-1] card ${c.card_id} threw`, e);
        }
        done++;
      }

      // Re-fetch saved state from DB so UI reflects reality.
      try {
        const { data: rows } = await supabase
          .from("custom_deck_cards")
          .select("card_id, corner_radius_percent, crop_coords, processing_status")
          .eq("deck_id", deckId)
          .is("archived_at", null);
        const sr: Record<number, number> = {};
        const sc: Record<number, CropCoords> = {};
        for (const r of rows ?? []) {
          if (
            r.processing_status === "saved" &&
            typeof r.corner_radius_percent === "number"
          ) {
            sr[r.card_id] = r.corner_radius_percent;
          }
          if (
            r.processing_status === "saved" &&
            isCropCoords(r.crop_coords)
          ) {
            sc[r.card_id] = r.crop_coords;
          }
        }
        setSavedRadii(sr);
        setSavedCrops(sc);
        // Also refresh the cards list so pendingCount recomputes.
        const fresh = await fetchDeckCards(deckId);
        setCards(
          fresh
            .filter((c) => c.source !== "default" && !!c.display_path)
            .sort((a, b) => a.card_id - b.card_id),
        );
      } catch (e) {
        console.warn("[FJ-1] post-batch refresh failed", e);
      }

      setVersion((v) => v + 1);

      if (cancelled) {
        toast.warning(
          `Cancelled. Processed ${done - failed}/${targetCount}.`,
          { id: progressId, duration: 4000 },
        );
      } else if (failed > 0) {
        toast.error(
          `Processed ${done - failed}/${targetCount}. ${failed} failed — check console.`,
          { id: progressId, duration: 5000 },
        );
      } else {
        toast.success(`All ${targetCount} cards processed.`, {
          id: progressId,
          duration: 4000,
        });
      }
    } finally {
      setBatchAbort(null);
    }
  }

  // FJ-3 — count of cards with settings applied but processing pending.
  const pendingCount = useMemo(() => {
    return (cards ?? []).filter((c) => {
      const r = c as unknown as {
        processing_status?: string;
        corner_radius_percent?: number | null;
      };
      return r.processing_status === "pending" && r.corner_radius_percent != null;
    }).length;
  }, [cards]);

  // FJ-3 — Resume processing handler.
  async function handleResumeProcessing() {
    if (bulkBusy || busy) return;
    const list = cards ?? [];
    const targets = list.filter((c) => {
      const r = c as unknown as {
        processing_status?: string;
        corner_radius_percent?: number | null;
      };
      return r.processing_status === "pending" && r.corner_radius_percent != null;
    });
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      await processCards(targets);
    } catch (err) {
      console.error("[FJ-3] resume failed", err);
      toast.error(
        err instanceof Error ? err.message : "Resume failed.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  const previewSrc = canvasPreview ?? activeUrl;
  // FF-1 — derive radius from RENDERED dimensions so the visible
  // proportion matches the slider's percentage on-screen. The Canvas
  // preview + Edge Function still use the natural-size formula
  // (min(w,h) * radius / 100) which produces the same VISUAL ratio
  // once the saved image is rendered at any size.
  const cssRadiusPx = renderedDims
    ? Math.round((Math.min(renderedDims.w, renderedDims.h) * radius) / 100)
    : 0;
  const previewStyle: React.CSSProperties = canvasPreview
    ? {} // Canvas image already has rounded transparent corners baked in.
    : { borderRadius: `${cssRadiusPx}px`, overflow: "hidden" };

  const cardCount = cards?.length ?? 0;

  // Phase 9.5a — wheel zoom (desktop + mac trackpad pinch).
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.001);
    const nextZoom = Math.min(8, Math.max(1, zoom * factor));
    if (nextZoom === zoom) return;
    const ratio = nextZoom / zoom;
    setZoom(nextZoom);
    setPan({
      x: cursorX - (cursorX - pan.x) * ratio,
      y: cursorY - (cursorY - pan.y) * ratio,
    });
  }

  function onPreviewPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('[role="slider"], button, input')) return;
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    wrap.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchStartRef.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom,
        pan: { ...pan },
      };
      panStartRef.current = null;
    } else if (pointersRef.current.size === 1) {
      panStartRef.current = {
        pointer: { x: e.clientX, y: e.clientY },
        pan: { ...pan },
      };
    }
  }

  function onPreviewPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = Array.from(pointersRef.current.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const start = pinchStartRef.current;
      const wrap = previewWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const midX = start.mid.x - rect.left;
      const midY = start.mid.y - rect.top;
      const nextZoom = Math.min(
        8,
        Math.max(1, start.zoom * (dist / start.dist)),
      );
      const ratio = nextZoom / start.zoom;
      setZoom(nextZoom);
      setPan({
        x: midX - (midX - start.pan.x) * ratio,
        y: midY - (midY - start.pan.y) * ratio,
      });
    } else if (pointersRef.current.size === 1 && panStartRef.current) {
      const start = panStartRef.current;
      setPan({
        x: start.pan.x + (e.clientX - start.pointer.x),
        y: start.pan.y + (e.clientY - start.pointer.y),
      });
    }
  }

  function onPreviewPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size < 1) panStartRef.current = null;
  }

  return (
    <Modal
      open
      onClose={onClose}
      nested
      size="lg"
      title={`Round corners — ${deckName}`}
      subtitle="Per-card rounding baked into a transparent-corner image at save."
    >
      <div className="flex h-[80dvh] flex-col text-foreground">
        {/* FG-2 — On mobile: preview takes the full width, card list
            becomes a horizontal scroll row UNDERNEATH. On md+: keep
            the original sidebar grid + side preview layout. */}
        {/* FK-2 — enable vertical scroll on mobile when content
            overflows. Desktop layout (md+) still uses flex-row with
            internal scrolling on the sidebar. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:overflow-y-visible">
          {/* Editor — first on mobile (order-1), right side on desktop (order-2). */}
          <section className="order-1 flex min-w-0 flex-1 flex-col gap-3 md:order-2">
            {activeCardId === null ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select a card to edit.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {getCardName(activeCardId)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {canvasPreview
                      ? "Canvas preview (matches saved)"
                      : "Live preview (CSS)"}
                  </p>
                </div>

                <div
                  ref={previewWrapRef}
                  className="relative flex items-center justify-center rounded-md bg-cosmos/40 p-4"
                >
                  {previewSrc ? (
                    <img
                      ref={imgRef}
                      key={`${activeCardId}-${version}`}
                      src={
                        canvasPreview
                          ? canvasPreview
                          : `${previewSrc}${previewSrc.includes("?") ? "&" : "?"}v=${version}`
                      }
                      alt={getCardName(activeCardId)}
                      crossOrigin="anonymous"
                      onLoad={(e) => {
                        const i = e.currentTarget;
                        if (i.naturalWidth > 0 && i.naturalHeight > 0) {
                          setImgDims({ w: i.naturalWidth, h: i.naturalHeight });
                        }
                      }}
                      style={{
                        // FE-3 — larger preview so radius changes are
                        // clearly visible while sliding.
                        // Slightly tighter on mobile to leave room for
                        // the horizontal thumbnail row.
                        maxHeight: "60vh",
                        maxWidth: "100%",
                        width: "auto",
                        ...previewStyle,
                      }}
                    />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin opacity-60" />
                  )}
                  {/* FI-2 — Crop corner handles. Only shown on raw image
                      preview (not the rounded canvas snapshot) and only
                      once both natural + rendered sizes are known. */}
                  {/* FJ-2 — Handles stay visible whenever crop is set,
                      even after the Canvas preview renders. The handles
                      ARE the edit UI; hiding them defeats the purpose. */}
                  {crop && imgDims && renderedDims && imgRef.current ? (
                    <CropHandles
                      imgEl={imgRef.current}
                      crop={crop}
                      imgDims={imgDims}
                      renderedDims={renderedDims}
                      onChange={(next) => setCrop(next)}
                      onRelease={() => renderCanvasPreview()}
                    />
                  ) : null}
                  {/* FG-3 — Big radius value overlay while dragging. */}
                  {isSliding ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    >
                      <div
                        className="font-bold tabular-nums"
                        style={{
                          fontSize: "clamp(48px, 12vw, 120px)",
                          color: "white",
                          textShadow: "0 2px 12px rgba(0,0,0,0.7)",
                          letterSpacing: "-0.02em",
                          lineHeight: 1,
                        }}
                      >
                        {radius}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground">
                    Radius
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={radius}
                    onChange={(e) => {
                      setRadius(Number(e.target.value));
                      setCanvasPreview(null);
                    }}
                    onPointerDown={() => setIsSliding(true)}
                    onPointerUp={() => {
                      setIsSliding(false);
                      renderCanvasPreview();
                    }}
                    onPointerCancel={() => setIsSliding(false)}
                    onKeyDown={() => setIsSliding(true)}
                    onKeyUp={() => {
                      setIsSliding(false);
                      renderCanvasPreview();
                    }}
                    onBlur={() => setIsSliding(false)}
                    className="flex-1"
                    disabled={busy || bulkBusy}
                  />
                  <span className="w-8 text-right text-xs tabular-nums">
                    {radius}%
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {pendingCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleResumeProcessing}
                      disabled={busy || bulkBusy}
                      title="Pick up where the last batch left off. No settings will be changed."
                      className="text-sm text-gold underline-offset-2 hover:underline disabled:opacity-50 mr-auto"
                    >
                      Resume processing ({pendingCount} pending)
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleApplyToAll}
                    disabled={busy || bulkBusy || cardCount === 0}
                    className="rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-sm font-medium hover:bg-muted/40 disabled:opacity-50"
                  >
                    {bulkBusy ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…
                      </span>
                    ) : (
                      `Apply to all (${cardCount})`
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy || bulkBusy || activeCardId === null}
                    className="rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
                  >
                    {busy ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                      </span>
                    ) : (
                      "Save card"
                    )}
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Card list — second on mobile (horizontal scroll), first on desktop (sidebar grid). */}
          <aside
            className={
              "order-2 flex shrink-0 gap-2 md:order-1 " +
              "flex-row overflow-x-auto overflow-y-hidden " +
              "md:w-44 md:flex-col md:overflow-x-hidden md:overflow-y-auto"
            }
          >
            {cards === null ? (
              <LoadingText>Loading card details…</LoadingText>
            ) : cardCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                No photographed cards in this deck yet.
              </p>
            ) : (
              <ul className="flex flex-row gap-1.5 md:grid md:grid-cols-3 md:gap-1.5">
                {cards.map((c) => {
                  const isActive = c.card_id === activeCardId;
                  const isSaved = c.card_id in savedRadii;
                  return (
                    <li key={c.id} className="shrink-0 md:shrink">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCardId(c.card_id);
                          setRadius(savedRadii[c.card_id] ?? defaultRadiusPercent);
                        }}
                        className={
                          "block aspect-[2/3] h-24 overflow-hidden rounded border-2 md:h-auto md:w-full " +
                          (isActive
                            ? "border-gold"
                            : isSaved
                              ? "border-emerald-500/50"
                              : "border-border/50 hover:border-gold/50")
                        }
                        title={getCardName(c.card_id)}
                      >
                        {signedUrls[c.card_id] ? (
                          <img
                            src={signedUrls[c.card_id]}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      {/* FI-3 — Apply-to-all choice dialog. */}
      <AlertDialog
        open={applyDialogOpen}
        onOpenChange={(o) => { if (!o) setApplyDialogOpen(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply settings to which cards?</AlertDialogTitle>
            <AlertDialogDescription>
              Radius {radius}%{crop ? " · Cropped" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2 text-sm">
            {(() => {
              const list = cards ?? [];
              const unsavedCount = list.filter(
                (c) => !(c.card_id in savedRadii),
              ).length;
              const totalCount = list.length;
              const savedCount = totalCount - unsavedCount;
              return (
                <>
                  <label className="flex items-start gap-2 cursor-pointer rounded-md border border-border/40 p-2 hover:bg-muted/30">
                    <input
                      type="radio"
                      name="apply-scope"
                      value="unsaved"
                      checked={applyScope === "unsaved"}
                      onChange={() => setApplyScope("unsaved")}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">Unsaved cards only ({unsavedCount})</span>
                      <span className="block text-xs text-muted-foreground">
                        Skips cards you've already saved.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer rounded-md border border-border/40 p-2 hover:bg-muted/30">
                    <input
                      type="radio"
                      name="apply-scope"
                      value="all"
                      checked={applyScope === "all"}
                      onChange={() => setApplyScope("all")}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">All cards ({totalCount})</span>
                      <span className="block text-xs text-muted-foreground">
                        {savedCount > 0
                          ? `Will overwrite ${savedCount} already-saved card${savedCount === 1 ? "" : "s"}.`
                          : "Updates every photographed card."}
                      </span>
                    </span>
                  </label>
                </>
              );
            })()}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setApplyDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setApplyDialogOpen(false);
                void applyToSelected(applyScope);
              }}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </Modal>
  );
}

// FI-2 — Draggable corner-crop overlay. Renders 4 small handles plus
// SVG quad outline. Coordinates kept in IMG NATURAL pixel space.
function CropHandles({
  imgEl,
  crop,
  imgDims,
  renderedDims,
  onChange,
  onRelease,
}: {
  imgEl: HTMLImageElement;
  crop: CropCoords;
  imgDims: { w: number; h: number };
  renderedDims: { w: number; h: number };
  onChange: (next: CropCoords) => void;
  onRelease: () => void;
}) {
  const [, force] = useState(0);

  // Re-measure offset on each render (cheap; layout-stable).
  const wrap = imgEl.parentElement;
  if (!wrap) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();
  const offX = imgRect.left - wrapRect.left;
  const offY = imgRect.top - wrapRect.top;

  function natToRendered(p: { x: number; y: number }) {
    return {
      x: (p.x / imgDims.w) * renderedDims.w,
      y: (p.y / imgDims.h) * renderedDims.h,
    };
  }

  function startDrag(
    e: React.PointerEvent<HTMLDivElement>,
    corner: keyof CropCoords,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startCrop = { ...crop[corner] };
    let latest = crop;

    function onMove(ev: PointerEvent) {
      const dxRendered = ev.clientX - startX;
      const dyRendered = ev.clientY - startY;
      const dxNatural = (dxRendered / renderedDims.w) * imgDims.w;
      const dyNatural = (dyRendered / renderedDims.h) * imgDims.h;
      const next: CropCoords = {
        ...latest,
        [corner]: {
          x: Math.max(0, Math.min(imgDims.w, startCrop.x + dxNatural)),
          y: Math.max(0, Math.min(imgDims.h, startCrop.y + dyNatural)),
        },
      };
      latest = next;
      onChange(next);
      force((n) => n + 1);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onRelease();
    }
    // FK-3 — passive:false so any future preventDefault inside onMove
    // isn't silently ignored on touch devices.
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
  }

  const corners: (keyof CropCoords)[] = ["tl", "tr", "bl", "br"];
  const pts = corners.map((k) => natToRendered(crop[k]));

  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: offX,
          top: offY,
          width: renderedDims.w,
          height: renderedDims.h,
        }}
      >
        <polygon
          points={`${pts[0].x},${pts[0].y} ${pts[1].x},${pts[1].y} ${pts[3].x},${pts[3].y} ${pts[2].x},${pts[2].y}`}
          fill="none"
          stroke="hsl(var(--gold, 45 80% 60%))"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          opacity="0.85"
        />
      </svg>
      {corners.map((k, i) => {
        const p = pts[i];
        return (
          // FK-3 — bigger hit target (h-8 w-8 = 32px) and z-20 so
          // pointerdown reaches the handle even when other layers
          // (slider, IMG, polygon) sit underneath.
          <div
            key={k}
            role="slider"
            aria-label={`Crop ${k} handle`}
            onPointerDown={(e) => startDrag(e, k)}
            className="absolute z-20 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold bg-background/90 shadow-md cursor-grab active:cursor-grabbing touch-none"
            style={{
              left: offX + p.x,
              top: offY + p.y,
            }}
          />
        );
      })}
    </>
  );
}