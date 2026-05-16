/**
 * Q65 — Story share modal.
 *
 * A focused, story-specific share surface that mirrors the look of the
 * Phase 9.5a Share Builder without depending on its reading-shaped
 * ShareContext. Renders an off-screen 1080x1920 canvas with the
 * pattern name, associated cards, reading count, and the pattern's
 * narrative description, then hands the captured PNG to useShareCard.
 */
import { useEffect, useMemo, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ShareCardFrame,
  ShareCardRow,
  SHARE_CARD_W,
  SHARE_CARD_H,
} from "./levels/share-card-shared";
import { useShareCard } from "./useShareCard";
import { useShareColor } from "./use-share-color";
import { getShareColor } from "./share-types";
import type { SharePick } from "./share-types";

export function StoryShareModal({
  open,
  onOpenChange,
  patternName,
  description,
  cardIds,
  readingCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patternName: string;
  description: string;
  cardIds: number[];
  readingCount: number;
}) {
  const { color: colorId } = useShareColor();
  const color = getShareColor(colorId);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const { busy, preview, prepare, confirm, cancelPreview } = useShareCard();

  // Cap cards shown so the row doesn't crowd the canvas.
  const picks: SharePick[] = useMemo(
    () =>
      cardIds
        .slice(0, 5)
        .map((cardIndex, i) => ({ id: i, cardIndex, isReversed: false })),
    [cardIds],
  );

  useEffect(() => {
    if (!open && preview) cancelPreview();
  }, [open, preview, cancelPreview]);

  const PREVIEW_MAX_W = 280;
  const PREVIEW_MAX_H = 480;
  const scale = Math.min(
    PREVIEW_MAX_W / SHARE_CARD_W,
    PREVIEW_MAX_H / SHARE_CARD_H,
  );
  const previewWidth = Math.round(SHARE_CARD_W * scale);
  const previewHeight = Math.round(SHARE_CARD_H * scale);

  const handleShare = () => {
    if (!captureRef.current) return;
    void prepare(captureRef.current, "#07070d", "share");
  };
  const handleSave = () => {
    if (!captureRef.current) return;
    void prepare(captureRef.current, "#07070d", "save");
  };

  const Card = (
    <ShareCardFrame level="reading" guideName="" accent={color.accent}>
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-display, var(--font-serif))",
          fontStyle: "italic",
          fontSize: 84,
          lineHeight: 1.1,
          color: "var(--accent)",
          letterSpacing: "0.01em",
          margin: "0 auto",
          maxWidth: 900,
        }}
      >
        {patternName}
      </div>
      {picks.length > 0 && <ShareCardRow picks={picks} />}
      {description?.trim() && (
        <p
          style={{
            textAlign: "center",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 38,
            lineHeight: 1.5,
            maxWidth: 880,
            margin: "0 auto",
            opacity: 0.9,
          }}
        >
          {description.length > 320
            ? description.slice(0, 319).trimEnd() + "…"
            : description}
        </p>
      )}
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontSize: 28,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        {readingCount} {readingCount === 1 ? "reading" : "readings"}
      </div>
    </ShareCardFrame>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "modal-scrim fixed inset-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
          style={{ zIndex: "var(--z-modal)" }}
        />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
          style={{
            background: "var(--surface-elevated)",
            border: "1px solid var(--border-default)",
            zIndex: "var(--z-modal)",
            maxWidth: 360,
            width: "calc(100vw - 32px)",
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Share story
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Share this story as an image.
          </DialogPrimitive.Description>

          {/* Live preview */}
          <div
            style={{
              width: previewWidth,
              height: previewHeight,
              margin: "0 auto",
              overflow: "hidden",
              borderRadius: 12,
            }}
          >
            <div
              style={{
                width: SHARE_CARD_W,
                height: SHARE_CARD_H,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {Card}
            </div>
          </div>

          <div className="mt-4 flex justify-center gap-4 text-sm">
            <button
              type="button"
              onClick={handleShare}
              disabled={busy !== null}
              className="italic"
              style={{ color: "var(--accent, var(--gold))", opacity: busy ? 0.4 : 1 }}
            >
              {busy === "share" ? "Preparing…" : "Share"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className="italic"
              style={{ opacity: busy ? 0.4 : 0.7 }}
            >
              {busy === "save" ? "Saving…" : "Download PNG"}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="italic"
              style={{ opacity: 0.5 }}
            >
              Close
            </button>
          </div>

          {/* Off-screen full-size capture target */}
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: -99999,
              top: 0,
              width: SHARE_CARD_W,
              height: SHARE_CARD_H,
              pointerEvents: "none",
            }}
          >
            <div ref={captureRef}>{Card}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {/* Confirm preview (post-capture) */}
      {preview && (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="modal-scrim fixed inset-0"
            style={{ zIndex: "calc(var(--z-modal) + 1)" }}
            onClick={cancelPreview}
          />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-4"
            style={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border-default)",
              zIndex: "calc(var(--z-modal) + 2)",
              maxWidth: 360,
              width: "calc(100vw - 32px)",
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              Confirm share image
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Preview the generated image before sharing.
            </DialogPrimitive.Description>
            <img
              src={preview.dataUrl}
              alt=""
              style={{
                display: "block",
                width: "100%",
                borderRadius: 8,
                maxHeight: "60vh",
                objectFit: "contain",
              }}
            />
            <div className="mt-3 flex justify-center gap-4 text-sm">
              <button
                type="button"
                onClick={() => void confirm()}
                className="italic"
                style={{ color: "var(--accent, var(--gold))" }}
              >
                {preview.intent === "share" ? "Confirm Share" : "Download"}
              </button>
              <button
                type="button"
                onClick={cancelPreview}
                className="italic"
                style={{ opacity: 0.6 }}
              >
                Cancel
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </Dialog>
  );
}