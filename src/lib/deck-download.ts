/**
 * EJ32 — Portable deck download.
 *
 * Builds a zip the admin can save and later import into ANY user's
 * account. Strips identity (no user_id, no UUIDs, no source-user
 * storage paths). Preserves all content (name, type, dimensions,
 * corner radius, card back, per-card name/description/journal_prompts/
 * corner_radius_percent/radius_overridden/crop_coords).
 *
 * Layout in the zip:
 *
 *   manifest.json
 *   deck/
 *     deck.json
 *     cards.json
 *     back.{ext}
 *     back-thumb.{ext}
 *     images/
 *       card_{N}.{ext}
 *       card_{N}-thumb.{ext}
 */
import JSZip from "jszip";
import { getDeckExportBundle } from "@/lib/admin.functions";
import { isoDayInTz } from "@/lib/time";

const PORTABLE_SCHEMA_VERSION = 1;

function safeName(s: string | null | undefined): string {
  if (!s) return "deck";
  return s.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "deck";
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "webp";
  return path.slice(dot + 1).toLowerCase();
}

function todayStamp(): string {
  // EJ32 — route through the canonical timezone helper. The
  // filename date should reflect the admin's calendar day in their
  // local timezone, not server UTC.
  const tz =
    typeof Intl !== "undefined"
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC")
      : "UTC";
  return isoDayInTz(new Date(), tz);
}

/** Fields removed from the deck.json — every identity / user /
 *  storage / timestamp field that ties the deck to its origin. */
const DECK_STRIP_FIELDS = new Set([
  "id",
  "user_id",
  "created_at",
  "updated_at",
  "source_zip_path",
  "card_back_url",
  "card_back_thumb_url",
  "card_back_path",
  "card_back_thumb_path",
  "is_active",
]);

/** Same idea for cards. */
const CARD_STRIP_FIELDS = new Set([
  "id",
  "user_id",
  "deck_id",
  "created_at",
  "updated_at",
  "archived_at",
  "processed_at",
  "processing_status",
  "variant_attempts",
  "variant_last_attempt_at",
  "display_url",
  "display_path",
  "thumbnail_url",
  "thumbnail_path",
  "original_path",
]);

function stripFields(row: Record<string, unknown>, strip: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!strip.has(k)) out[k] = v;
  }
  return out;
}

async function fetchBlob(url: string | undefined): Promise<Blob | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/**
 * Build the portable zip + trigger a browser download.
 * Returns when the download has been kicked off.
 */
export async function downloadDeckAsZip(
  deckId: string,
  authHeaders: () => Promise<Record<string, string>>,
): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  let bundle: Awaited<ReturnType<typeof getDeckExportBundle>>;
  try {
    bundle = await getDeckExportBundle({
      data: { deckId },
      headers: await authHeaders(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to load deck" };
  }
  const { deck, cards, signed_urls: signedByPath } = bundle;
  const zip = new JSZip();
  // Manifest — no user_id, no deck_id, just schema info + app name.
  const manifest = {
    app: "Tarot Seed",
    schema_version: PORTABLE_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    deck_name: (deck.name as string | null) ?? null,
    deck_type: (deck.deck_type as string | null) ?? null,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  // Deck folder.
  const folder = zip.folder("deck")!;
  // Portable deck row — full identity stripped.
  const portableDeck = stripFields(deck, DECK_STRIP_FIELDS);
  folder.file("deck.json", JSON.stringify(portableDeck, null, 2));
  // Card back (display + thumb).
  const backPath = (deck.card_back_path as string | null) ?? null;
  const backThumbPath = (deck.card_back_thumb_path as string | null) ?? null;
  if (backPath) {
    const blob = await fetchBlob(signedByPath[backPath]);
    if (blob) folder.file(`back.${extOf(backPath)}`, blob);
  }
  if (backThumbPath) {
    const blob = await fetchBlob(signedByPath[backThumbPath]);
    if (blob) folder.file(`back-thumb.${extOf(backThumbPath)}`, blob);
  }
  // Portable cards — strip identity, keep content. Includes
  // card_id, card_name, card_description, journal_prompts,
  // corner_radius_percent, radius_overridden, crop_coords, source.
  const portableCards: Record<string, unknown>[] = [];
  const imgs = folder.folder("images")!;
  for (const c of cards) {
    const portable = stripFields(c, CARD_STRIP_FIELDS);
    portableCards.push(portable);
    const cardId = c.card_id as number;
    const displayPath = (c.display_path as string | null) ?? null;
    const thumbPath = (c.thumbnail_path as string | null) ?? null;
    if (displayPath) {
      const blob = await fetchBlob(signedByPath[displayPath]);
      if (blob) imgs.file(`card_${cardId}.${extOf(displayPath)}`, blob);
    }
    if (thumbPath) {
      const blob = await fetchBlob(signedByPath[thumbPath]);
      if (blob) imgs.file(`card_${cardId}-thumb.${extOf(thumbPath)}`, blob);
    }
  }
  folder.file("cards.json", JSON.stringify(portableCards, null, 2));
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const filename = `tarotseed-deck-${safeName(deck.name as string | null)}-${todayStamp()}.zip`;
  // Trigger browser save via anchor click.
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL after the click is processed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, filename };
}
