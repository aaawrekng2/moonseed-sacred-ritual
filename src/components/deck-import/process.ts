/**
 * Client-side image processing for bulk deck import (Stamp BH).
 *
 * Decode → resize (longest edge 1536, never upscale) → mask (rounded
 * rect or circle) → encode WebP. Also emits a 256px thumbnail.
 */
import { applyRoundedCorners } from "@/components/photo/PhotoCapture";

export type ProcessedImage = {
  display: Blob;
  thumbnail: Blob;
  /** Source longest edge in pixels (used for low-res flagging). */
  sourceLongestEdge: number;
};

function applyCircularMask(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const size = Math.min(src.width, src.height);
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  // Center-crop the source square first.
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
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

async function canvasToWebp(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("WebP encode failed"))),
      "image/webp",
      quality,
    );
  });
}

export async function processImageBlob(
  blob: Blob,
  shape: "rectangle" | "round",
  cornerRadiusPercent: number,
): Promise<ProcessedImage> {
  const { img, url } = await blobToImage(blob);
  try {
    const sourceLongestEdge = Math.max(img.naturalWidth, img.naturalHeight);

    // Display: 1536 longest edge.
    let displayCanvas = drawScaled(img, 1536);
    if (shape === "round") displayCanvas = applyCircularMask(displayCanvas);
    else displayCanvas = applyRoundedCorners(displayCanvas, cornerRadiusPercent);
    const display = await canvasToWebp(displayCanvas, 0.85);

    // Thumbnail: 256 longest edge.
    let thumbCanvas = drawScaled(img, 256);
    if (shape === "round") thumbCanvas = applyCircularMask(thumbCanvas);
    else thumbCanvas = applyRoundedCorners(thumbCanvas, cornerRadiusPercent);
    const thumbnail = await canvasToWebp(thumbCanvas, 0.8);

    return { display, thumbnail, sourceLongestEdge };
  } finally {
    URL.revokeObjectURL(url);
  }
}