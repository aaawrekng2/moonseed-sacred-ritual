/**
 * Process-on-assign WebP encoding pipeline (Stamp BJ Fix 5).
 *
 * When the user assigns an image to a card slot in the import wizard,
 * we kick off local encoding so the assigned-view thumbnail can show
 * the real WebP output and the on-Save commit step doesn't have to
 * encode anything synchronously. Uploads do NOT happen here — only
 * locally to the IndexedDB session.
 *
 * Concurrency cap: 2 simultaneous encodings. Errors don't crash the
 * wizard — they're logged and the assigned thumbnail falls back to
 * the raw blob.
 */
import { applyRoundedCorners } from "@/components/photo/PhotoCapture";
import type { EncodedAsset } from "./import-session";

export type ProcessOpts = {
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
};

function applyCircularMask(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const size = Math.min(src.width, src.height);
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  const sx = (src.width - size) / 2;
  const sy = (src.height - size) / 2;
  ctx.drawImage(src, sx, sy, size, size, 0, 0, size, size);
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  return out;
}

async function blobToImage(blob: Blob): Promise<{
  img: HTMLImageElement;
  url: string;
}> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return { img, url };
}

function drawScaled(
  img: HTMLImageElement,
  maxEdge: number,
): HTMLCanvasElement {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("WebP encode failed"))),
      "image/webp",
      quality,
    );
  });
}

async function encode(
  rawBlob: Blob,
  opts: ProcessOpts,
  size: number,
  quality: number,
): Promise<Blob> {
  // BQ Fix 4A — phase-level diagnostic timing.
  const tag = `encode_${size}_${Date.now().toString(36)}`;
  console.time(tag);
  console.time(`${tag}_decode`);
  const { img, url } = await blobToImage(rawBlob);
  console.timeEnd(`${tag}_decode`);
  try {
    console.time(`${tag}_canvas`);
    let canvas = drawScaled(img, size);
    if (opts.shape === "round") canvas = applyCircularMask(canvas);
    else canvas = applyRoundedCorners(canvas, opts.cornerRadiusPercent);
    console.timeEnd(`${tag}_canvas`);
    console.time(`${tag}_webp`);
    const out = await canvasToWebp(canvas, quality);
    console.timeEnd(`${tag}_webp`);
    return out;
  } finally {
    URL.revokeObjectURL(url);
    console.timeEnd(tag);
  }
}

export async function encodeOne(
  key: string,
  rawBlob: Blob,
  opts: ProcessOpts,
): Promise<EncodedAsset> {
  const displayBlob = await encode(rawBlob, opts, 1536, 0.85);
  const thumbnailBlob = await encode(rawBlob, opts, 256, 0.8);
  return { key, displayBlob, thumbnailBlob };
}

/* ------------------------------------------------------------------ */
/*  Concurrency-capped queue                                           */
/* ------------------------------------------------------------------ */

const MAX_CONCURRENT = 2;

type QueueJob = {
  key: string;
  blob: Blob;
  opts: ProcessOpts;
  resolve: (asset: EncodedAsset) => void;
  reject: (err: unknown) => void;
};

export class EncodingQueue {
  private queue: QueueJob[] = [];
  private running = 0;
  /** Subscribers fire whenever an asset finishes (success). */
  private listeners = new Set<(asset: EncodedAsset) => void>();

  enqueue(key: string, blob: Blob, opts: ProcessOpts): Promise<EncodedAsset> {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, blob, opts, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.running < MAX_CONCURRENT && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      encodeOne(job.key, job.blob, job.opts)
        .then((asset) => {
          job.resolve(asset);
          for (const l of this.listeners) {
            try { l(asset); } catch (e) { console.error(e); }
          }
        })
        .catch((err) => {
          console.error(`[deck-image-pipeline] encode failed for ${job.key}`, err);
          job.reject(err);
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  onComplete(fn: (asset: EncodedAsset) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves once the queue is fully drained. */
  async drain(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}