/**
 * 26-05-08-Q9 — Source-zip picker modal.
 *
 * Lets a seeker recover a single failed/missing card slot (or the deck
 * back) by picking any image from the original imported zip stored at
 * `custom_decks.source_zip_path`. Falls back to a single-file device
 * upload when the source zip is unavailable.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  assetToImportImage,
  extractZip,
  type ImportAsset,
} from "@/lib/deck-import-pipeline";
import { saveCard } from "@/lib/per-card-save";
import { getCardName } from "@/lib/tarot";

const DECK_BUCKET = "custom-deck-images";

export type ZipPickerTarget = number | "BACK";

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  deckId: string;
  /** Storage path under `custom-deck-images`. May be null → device fallback. */
  sourceZipPath: string | null;
  /** Slot to fill: numeric card_id, or "BACK" for the deck back. */
  target: ZipPickerTarget;
  /** Encoding opts — must match deck shape/radius. */
  opts: {
    shape: "rectangle" | "round";
    cornerRadiusPercent: number;
  };
  /** Called after a successful save so the parent can reload. */
  onSaved: () => void;
};

function targetLabel(target: ZipPickerTarget): string {
  if (target === "BACK") return "the card back";
  if (target < 1000) return getCardName(target);
  return `card ${target}`;
}

export function SourceZipPickerModal({
  open,
  onClose,
  userId,
  deckId,
  sourceZipPath,
  target,
  opts,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<ImportAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!sourceZipPath) {
      setAssets(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: signErr } = await supabase.storage
          .from(DECK_BUCKET)
          .createSignedUrl(sourceZipPath, 60 * 10);
        if (signErr || !data?.signedUrl) {
          throw new Error(signErr?.message ?? "Couldn't fetch source zip");
        }
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw new Error(`Zip download failed (${res.status})`);
        const blob = await res.blob();
        const { assets: list } = await extractZip(blob);
        if (cancelled) return;
        setAssets(list);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[SourceZipPicker] fetch failed", e);
        setError(msg);
        setAssets(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceZipPath]);

  const label = useMemo(() => targetLabel(target), [target]);

  const doSave = async (image: {
    key: string;
    filename: string;
    rawBlob: Blob;
    width: number;
    height: number;
  }) => {
    setBusyKey(image.key);
    try {
      const res = await saveCard({
        userId,
        deckId,
        cardId: target,
        cardKey: target === "BACK" ? "back" : `card-${target}`,
        image,
        opts,
      });
      if (res.status === "failed") {
        toast.error(`Couldn't save: ${res.error}`);
        return;
      }
      toast.success(`Saved ${label}.`);
      onSaved();
      onClose();
    } finally {
      setBusyKey(null);
    }
  };

  const handlePickAsset = async (asset: ImportAsset) => {
    if (busyKey) return;
    const ok = window.confirm(`Use ${asset.filename} for ${label}?`);
    if (!ok) return;
    await doSave(assetToImportImage(asset));
  };

  const handleDeviceUpload = async (file: File) => {
    if (!file) return;
    let width = 0;
    let height = 0;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      width = img.naturalWidth;
      height = img.naturalHeight;
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal */
    }
    await doSave({
      key: `device-${Date.now()}-${file.name}`,
      filename: file.name,
      rawBlob: file,
      width,
      height,
    });
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[140] overflow-y-auto p-5"
      style={{
        background: "color-mix(in oklab, var(--color-background) 94%, black)",
      }}
    >
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-lg italic"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Pick a card from the original zip
            </h2>
            <p className="mt-1 text-xs italic text-muted-foreground">
              Filling: {label}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-foreground/5"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading source zip…
          </div>
        )}

        {!loading && (!sourceZipPath || error || !assets) && (
          <div className="space-y-3 rounded-lg border border-dashed border-border/60 p-4 text-sm">
            <p className="text-muted-foreground">
              {sourceZipPath
                ? `Couldn't read the source zip${error ? ` (${error})` : ""}.`
                : "No source zip is stored for this deck. You can upload a single image instead."}
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm hover:bg-gold/20">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleDeviceUpload(f);
                }}
              />
              Upload image from device
            </label>
          </div>
        )}

        {!loading && assets && assets.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {assets.map((asset) => {
              const isBusy = busyKey === asset.key;
              return (
                <button
                  key={asset.key}
                  type="button"
                  disabled={!!busyKey}
                  onClick={() => void handlePickAsset(asset)}
                  className="group relative flex flex-col gap-1 rounded border border-border/60 bg-background p-1 hover:border-gold/60 disabled:opacity-50"
                  title={asset.filename}
                >
                  <div
                    className="aspect-[2/3] overflow-hidden rounded bg-foreground/[0.03]"
                    style={{ position: "relative" }}
                  >
                    {asset.thumbnailDataUrl ? (
                      <img
                        src={asset.thumbnailDataUrl}
                        alt={asset.filename}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : null}
                    {isBusy && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="h-5 w-5 animate-spin text-gold" />
                      </div>
                    )}
                  </div>
                  <p
                    className="truncate text-[10px] italic text-muted-foreground"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {asset.filename}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
