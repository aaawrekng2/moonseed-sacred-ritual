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
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchDeckCards, type CustomDeckCard } from "@/lib/custom-decks";
import { getCardName } from "@/lib/tarot";
import { useConfirm } from "@/hooks/use-confirm";
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
        const { data: rows } = await supabase
          .from("custom_deck_cards")
          .select("card_id, corner_radius_percent, crop_coords")
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
  }, [activeCardId]);

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
      const { error: updErr } = await supabase
        .from("custom_deck_cards")
        .update({ corner_radius_percent: radius, processing_status: "pending" })
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

  // FG-4 — Apply current radius to every card in the deck, then offer
  // to batch-process them through the edge function (single-card mode
  // per card so the rounded -full.webp variants get baked).
  async function handleApplyToAll() {
    if (bulkBusy || busy) return;
    const list = cards ?? [];
    const total = list.length;
    if (total === 0) return;

    const ok = await confirm({
      title: `Apply radius ${radius}% to all ${total} cards?`,
      description:
        "Updates the per-card setting on every photographed card in this deck.",
      confirmLabel: "Apply to all",
    });
    if (!ok) return;

    setBulkBusy(true);
    try {
      const { error } = await supabase
        .from("custom_deck_cards")
        .update({ corner_radius_percent: radius, processing_status: "pending" })
        .eq("deck_id", deckId)
        .is("archived_at", null);
      if (error) throw error;

      // Reflect locally so thumbnails get the saved-state border.
      const next: Record<number, number> = {};
      for (const c of list) next[c.card_id] = radius;
      setSavedRadii((prev) => ({ ...prev, ...next }));
      toast.success(`Radius ${radius}% set for all ${total} cards.`);

      const goProcess = await confirm({
        title: `Process all ${total} cards now?`,
        description: "This may take several minutes. You can also do it later from Settings → Decks.",
        confirmLabel: "Process now",
        cancelLabel: "Not now",
      });
      if (!goProcess) return;

      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) throw new Error("Not signed in.");

      let done = 0;
      let failed = 0;
      const progressId = toast.loading(`Processing 0/${total}…`);
      for (const c of list) {
        try {
          const { data, error: invErr } = await supabase.functions.invoke(
            "generate-deck-variants",
            {
              body: { deckId, cardId: c.card_id },
              headers: { Authorization: `Bearer ${jwt}` },
            },
          );
          if (invErr) throw invErr;
          const result = (data ?? {}) as { ok?: boolean; error?: string; step?: string };
          if (!result.ok) {
            failed++;
            console.warn(
              `[FG-4] card ${c.card_id} failed`,
              result.step,
              result.error,
            );
          }
        } catch (e) {
          failed++;
          console.warn(`[FG-4] card ${c.card_id} threw`, e);
        }
        done++;
        toast.loading(`Processing ${done}/${total}…`, { id: progressId });
      }
      setVersion((v) => v + 1);
      if (failed > 0) {
        toast.error(
          `Processed ${done - failed}/${total}. ${failed} failed — check console.`,
          { id: progressId },
        );
      } else {
        toast.success(`All ${total} cards processed.`, { id: progressId });
      }
    } catch (err) {
      console.error("[FG-4] apply-to-all failed", err);
      toast.error(
        err instanceof Error ? err.message : "Apply to all failed.",
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

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[95vh] h-[95vh] md:h-auto md:max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gold/30 bg-card text-foreground shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Round corners — {deckName}</h2>
            <p className="text-xs text-muted-foreground">
              Per-card rounding baked into a transparent-corner image at save.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-muted/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* FG-2 — On mobile: preview takes the full width, card list
            becomes a horizontal scroll row UNDERNEATH. On md+: keep
            the original sidebar grid + side preview layout. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row">
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

                <div className="relative flex items-center justify-center rounded-md bg-cosmos/40 p-4">
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
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
      </div>
    </div>,
    document.body,
  );
}