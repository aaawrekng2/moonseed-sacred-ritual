/**
 * EK03 — Table snapshot generator.
 *
 * Generates a PNG image showing the draw table with all 78 cards face-up
 * at their scatter positions. Used as a transparency / trust mechanism:
 * the seeker can copy this image to clipboard BEFORE they pick any
 * cards, then verify after the reading that the cards they picked were
 * always at those positions (proving the deck wasn't rearranged in
 * response to their choices).
 *
 * Implementation: direct canvas drawing using the default card art
 * from `/cards/card-NN.jpg`. We use default art (not the seeker's
 * active custom deck) for two reasons:
 *
 *   1. The proof is about CARD IDENTITY, not visual appearance. A
 *      seeker can read "The Tower" on the snapshot and verify the
 *      card they later pick from that position is The Tower —
 *      regardless of which deck art they're viewing in the app.
 *
 *   2. Custom deck images live on Supabase storage and require signed
 *      URLs + CORS configuration to draw onto a canvas (canvas taint
 *      otherwise). Default images live in /public and are always
 *      same-origin, so they draw without complication.
 */

import type { ScatterCard } from "@/lib/scatter";
// EK08 — Card-name lookup so the placeholder rendering for failed
// image loads shows readable card names (e.g. "The Star") instead of
// just an id number (e.g. "#17"). Better UX when the snapshot is
// degraded due to timeouts. tarot.ts is a pure leaf module — no
// transitive deps that would pull in heavy chunks.
import { getCardName } from "@/lib/tarot";

export type SnapshotParams = {
  /** Scatter cards with (x, y, rotation) in the local container coord space. */
  scatter: ScatterCard[];
  /**
   * Mapping from ScatterCard.id (0..77) to the tarot card id (0..77) that
   * lives at that scatter position. The Tabletop builds this once per
   * session via shuffleDeck(seed) — that fixed mapping is what proves
   * the deck wasn't reshuffled mid-pick.
   */
  deckMapping: number[];
  /** Container width in CSS px (same `size.w` passed to buildScatter). */
  containerWidth: number;
  /** Container height in CSS px (same usable scatter height). */
  containerHeight: number;
  /** Card width in CSS px (same `cardW` Tabletop computes). */
  cardWidth: number;
  /** Card height in CSS px (same `cardH` Tabletop computes). */
  cardHeight: number;
  /**
   * Vertical offset applied to every card.y by buildScatter via
   * `topOffset`. We add it back here so the snapshot matches the
   * coordinate space the seeker is looking at.
   */
  topOffset: number;
};

/**
 * Pre-load all 78 default card images. Returns a Promise that resolves
 * once every image is decoded, fails, OR hits the per-image timeout.
 * Failed/timed-out images become null in the array; the snapshot draws
 * a placeholder rectangle with the card name for those slots rather
 * than failing the whole snapshot.
 *
 * EK08 — Reverted from EK06's fetch-then-blob approach back to plain
 * `<img>` + `crossOrigin="anonymous"`, plus per-image timeouts. The
 * fetch-then-blob path was added in EK06 to bypass a perceived
 * service-worker tainting issue, but the real EK04 problem turned out
 * to be Safari's user-activation lifecycle (fixed in EK07), not canvas
 * tainting. The fetch path then introduced its own failure mode:
 * `Promise.all` waits for ALL 78 promises, and on mobile any single
 * hung fetch (or image decode that never fires onload) stalls the
 * whole pipeline indefinitely. That's why EK07's diagnostic toast
 * showed "snapshot not ready yet" — the status was stuck at
 * "generating" forever.
 *
 * The simpler approach below:
 *
 *   - Plain `new Image()` + `crossOrigin = "anonymous"` + `img.src = url`.
 *     Lovable's production server returns CORS headers for /public
 *     assets, so the canvas can read pixels without taint.
 *   - **3-second per-image timeout.** If a single image's onload/
 *     onerror never fires (hung fetch, blocked decoder, etc.), the
 *     promise resolves to `null` after 3s. The snapshot draws a
 *     dark placeholder with the card name in that position. Loss is
 *     bounded — one stuck image can't stall the whole render.
 *   - The outer caller (generateTableSnapshot) applies a 10-second
 *     overall timeout in case the entire chain of timeouts somehow
 *     compounds beyond expectation.
 */
function loadOneCardImage(url: string, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    let settled = false;
    const settle = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => settle(img);
    img.onerror = () => settle(null);
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      // Already cached + decoded; resolve immediately.
      settle(img);
      return;
    }
    window.setTimeout(() => settle(null), timeoutMs);
  });
}

function loadAllCardImages(): Promise<(HTMLImageElement | null)[]> {
  const promises: Promise<HTMLImageElement | null>[] = [];
  for (let i = 0; i < 78; i++) {
    const id = String(i).padStart(2, "0");
    promises.push(loadOneCardImage(`/cards/card-${id}.jpg`, 3000));
  }
  return Promise.all(promises);
}

/**
 * Generate a PNG blob of the table with every card face-up at its
 * scatter position. Returns null if image loading or canvas encoding
 * fails so the caller can show a graceful "snapshot unavailable"
 * message instead of an exception.
 */
export async function generateTableSnapshot(
  params: SnapshotParams,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  // EK08 — 10-second overall timeout on image loading. The per-image
  // timeout inside loadAllCardImages (3s each) usually keeps total
  // load time well under 10s, but this outer guard ensures the snapshot
  // ALWAYS resolves to a value (blob or null) — never hangs at the
  // image-loading step. Without it, an unexpected mass-stall (e.g.
  // 78 simultaneous fetches all queuing behind a stuck connection
  // pool) could leave the snapshot status pinned at "generating"
  // forever.
  const imagesPromise = loadAllCardImages();
  const overallTimeout = new Promise<(HTMLImageElement | null)[]>((resolve) => {
    window.setTimeout(() => {
      // On timeout, give the canvas an array of 78 nulls so the
      // snapshot still draws (entirely placeholders, but readable
      // with card name text). Better to ship a degraded snapshot
      // than to hang.
      resolve(new Array(78).fill(null));
    }, 10000);
  });
  const images = await Promise.race([imagesPromise, overallTimeout]);
  const canvas = document.createElement("canvas");
  // Use device-pixel-ratio scaling so the snapshot reads sharp when the
  // seeker pastes it into a Retina-aware app, but cap at 2 so large
  // tables don't produce 30MB PNGs.
  const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  canvas.width = Math.round(params.containerWidth * dpr);
  canvas.height = Math.round((params.containerHeight + params.topOffset) * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // Cosmos background — same dark gradient feel as the live table so
  // the pasted image reads as "the table you were looking at" rather
  // than a clinical card grid.
  const bg = ctx.createLinearGradient(0, 0, params.containerWidth, params.containerHeight);
  bg.addColorStop(0, "#1a0d1f");
  bg.addColorStop(1, "#0f0a18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, params.containerWidth, params.containerHeight + params.topOffset);

  // Draw each card at its scatter position + rotation.
  for (const card of params.scatter) {
    const cardId = params.deckMapping[card.id];
    const img = images[cardId];
    // Card center in container coords. scatter.y already has had
    // topOffset added by buildScatter, so we use card.y directly.
    const cx = card.x + params.cardWidth / 2;
    const cy = card.y + params.cardHeight / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((card.rotation * Math.PI) / 180);
    const left = -params.cardWidth / 2;
    const top = -params.cardHeight / 2;
    if (img) {
      // Round corners ~6% of card width — matches the typical card
      // corner radius across decks.
      const r = Math.round(params.cardWidth * 0.06);
      ctx.beginPath();
      ctx.moveTo(left + r, top);
      ctx.lineTo(left + params.cardWidth - r, top);
      ctx.quadraticCurveTo(left + params.cardWidth, top, left + params.cardWidth, top + r);
      ctx.lineTo(left + params.cardWidth, top + params.cardHeight - r);
      ctx.quadraticCurveTo(
        left + params.cardWidth,
        top + params.cardHeight,
        left + params.cardWidth - r,
        top + params.cardHeight,
      );
      ctx.lineTo(left + r, top + params.cardHeight);
      ctx.quadraticCurveTo(left, top + params.cardHeight, left, top + params.cardHeight - r);
      ctx.lineTo(left, top + r);
      ctx.quadraticCurveTo(left, top, left + r, top);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, left, top, params.cardWidth, params.cardHeight);
      ctx.restore();
      // Subtle border so cards read as distinct rectangles when they
      // overlap.
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // EK08 — Placeholder for any image that failed to load or timed
      // out. Dark slate rectangle with the CARD NAME (e.g. "The Star")
      // rendered in two lines, with id number tucked below. This keeps
      // the snapshot useful as a draw-proof artifact even when some
      // images couldn't load: the seeker can still verify "The Star
      // was at this position" without needing to see the art.
      ctx.fillStyle = "#2a1f33";
      ctx.fillRect(left, top, params.cardWidth, params.cardHeight);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, params.cardWidth, params.cardHeight);
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      const cardName = getCardName(cardId);
      // Naive two-line wrap on " of " — covers minors like
      // "Three of Wands" → "Three of" / "Wands". Majors stay one line.
      const splitPoint = cardName.lastIndexOf(" of ");
      const fontSize = Math.round(params.cardWidth * 0.13);
      ctx.font = `italic ${fontSize}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (splitPoint > 0) {
        const line1 = cardName.slice(0, splitPoint + 3); // include " of"
        const line2 = cardName.slice(splitPoint + 4);
        ctx.fillText(line1, 0, -fontSize * 0.65);
        ctx.fillText(line2, 0, fontSize * 0.65);
      } else {
        ctx.fillText(cardName, 0, 0);
      }
    }
    ctx.restore();
  }

  // Watermark in the corner so a pasted snapshot is identifiable as a
  // Tarot Seed draw proof.
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = `italic 11px serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "Tarot Seed — draw proof",
    params.containerWidth - 8,
    params.containerHeight + params.topOffset - 8,
  );

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Write a Blob to the system clipboard as an image/png ClipboardItem.
 *
 * EK04 — Rewritten to fire `navigator.clipboard.write()` synchronously
 * with a Promise inside ClipboardItem. The previous version had a
 * `const item = new ClipboardItem(...); await navigator.clipboard.write([item])`
 * sequence; multiple await hops between the originating user gesture
 * (button click) and the actual write() call meant browsers — Safari
 * especially — saw the write as unprompted and silently rejected.
 *
 * Pattern explained: ClipboardItem accepts a Promise<Blob> as its
 * value. The browser starts the clipboard transaction synchronously
 * with the gesture token live, then awaits the blob promise. So we
 * call write() SYNCHRONOUSLY in the click handler, and the data
 * resolves whenever the blob promise settles — without ever losing
 * the gesture.
 *
 * Returns a Promise<boolean> that resolves true on success, false on
 * any failure (missing API, missing permission, gesture lost, etc.).
 * Callers can use the result for toast feedback; the function itself
 * MUST be invoked synchronously from a user gesture handler.
 */
export function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard || !window.ClipboardItem) {
    return Promise.resolve(false);
  }
  try {
    // The Promise.resolve wraps the already-resolved blob in a Promise
    // so the ClipboardItem honors the "lazy blob" contract. Some
    // browsers (older Safari) require the value to be a Promise even
    // when it's already resolved.
    const item = new ClipboardItem({ [blob.type]: Promise.resolve(blob) });
    return navigator.clipboard
      .write([item])
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
