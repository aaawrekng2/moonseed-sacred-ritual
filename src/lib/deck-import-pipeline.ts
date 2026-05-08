/**
 * 9-6-AB — Shared zip-import pipeline.
 *
 * Pulls extraction + matching out of ZipImporter.tsx so both the new
 * DeckOverviewScreen and the legacy ZipImporter can share one
 * implementation. The pipeline is deliberately UI-agnostic: it returns
 * structured data and lets the caller decide how to persist (per-card
 * autosave vs session-backed wizard).
 */
import JSZip from "jszip";
import {
  matchFilenames,
  isCardBackFilename,
} from "@/components/deck-import/matcher";

const ZIP_MAX_BYTES = 20 * 1024 * 1024;
const VALID_EXT = /\.(png|jpe?g|webp|gif)$/i;
const ORACLE_ID_BASE = 1000;
const BACK_KEY = "BACK";
/** Score boundary: matcher gives 5 (keyword-only) or 10 (rank+suit /
 *  number+keyword). Everything below 5 is treated as ambiguous. */
const HIGH_CONFIDENCE_SCORE = 5;

export type ImportAsset = {
  /** Stable identity for the asset within an import session. */
  key: string;
  filename: string;
  blob: Blob;
  width: number;
  height: number;
  /** Tiny inline preview for drawer / pickup affordance. */
  thumbnailDataUrl?: string;
  /** Oracle metadata, populated when deckType === "oracle". */
  oracleName?: string;
  oracleDescription?: string;
};

export type ImportSessionResult = {
  /** slot key ("BACK" or "0".."77" or oracle id) → asset key */
  assigned: Record<string, string>;
  /** asset key → asset, only for assets that did not match any slot. */
  unmatched: Record<string, ImportAsset>;
  /** Slots that were assigned with a low confidence score (review me). */
  ambiguous: Array<{ cardId: number; assetKey: string; matchScore: number }>;
  cardBackKey: string | null;
  matchedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
};

export type ExtractZipResult = {
  assets: ImportAsset[];
  /** Optional sidecar CSV mapping (oracle decks). Lower-cased filename
   *  stem → { name, description }. */
  oracleMeta: Map<string, { name: string; description: string }>;
};

export class ZipTooLargeError extends Error {
  constructor() {
    super("Zip is too large. Maximum size is 20MB.");
    this.name = "ZipTooLargeError";
  }
}

export class ZipEmptyError extends Error {
  constructor() {
    super("No card images found in this zip.");
    this.name = "ZipEmptyError";
  }
}

/* --------------------------- helpers --------------------------- */

function parseCsvMetadata(
  csvText: string,
): Map<string, { name: string; description: string }> {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const fiIdx = headers.indexOf("filename");
  const nameIdx = headers.indexOf("name");
  const descIdx = headers.indexOf("description");
  const map = new Map<string, { name: string; description: string }>();
  if (fiIdx < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]
      .split(",")
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    const filenameRaw = cols[fiIdx] ?? "";
    const stem = filenameRaw.replace(/\.[^.]+$/, "").toLowerCase();
    if (!stem) continue;
    map.set(stem, {
      name: nameIdx >= 0 ? cols[nameIdx] ?? filenameRaw : filenameRaw,
      description: descIdx >= 0 ? cols[descIdx] ?? "" : "",
    });
  }
  return map;
}

function oracleNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[_\-]+/g, " ").trim();
  return cleaned
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

async function blobToHex(blob: Blob, max = 128): Promise<string> {
  const slice = blob.slice(0, max);
  const buf = new Uint8Array(await slice.arrayBuffer());
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function computeKey(filename: string, blob: Blob): Promise<string> {
  const head = await blobToHex(blob);
  return `${filename}::${blob.size}::${head}`;
}

async function readDimensionsAndThumbnail(
  blob: Blob,
): Promise<{ width: number; height: number; thumbnailDataUrl?: string }> {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    let thumbnailDataUrl: string | undefined;
    try {
      const TARGET = 96;
      const scale = Math.min(1, TARGET / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        thumbnailDataUrl = canvas.toDataURL("image/webp", 0.7);
      }
    } catch {
      /* non-fatal */
    }
    return { width, height, thumbnailDataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* --------------------------- API --------------------------- */

export async function extractZip(blob: Blob): Promise<ExtractZipResult> {
  if (blob.size > ZIP_MAX_BYTES) throw new ZipTooLargeError();
  const zip = await JSZip.loadAsync(blob);
  const entries: JSZip.JSZipObject[] = [];
  zip.forEach((_path, entry) => {
    if (!entry.dir) entries.push(entry);
  });
  const assets: ImportAsset[] = [];
  let oracleMeta = new Map<string, { name: string; description: string }>();
  for (const entry of entries) {
    const base = entry.name.split("/").pop() ?? entry.name;
    if (/\.csv$/i.test(base)) {
      try {
        const text = await entry.async("string");
        oracleMeta = parseCsvMetadata(text);
      } catch {
        /* non-fatal */
      }
      continue;
    }
    if (!VALID_EXT.test(base)) continue;
    const fileBlob = await entry.async("blob");
    const key = await computeKey(base, fileBlob);
    const dims = await readDimensionsAndThumbnail(fileBlob);
    assets.push({
      key,
      filename: base,
      blob: fileBlob,
      width: dims.width,
      height: dims.height,
      thumbnailDataUrl: dims.thumbnailDataUrl,
    });
  }
  if (assets.length === 0) throw new ZipEmptyError();
  return { assets, oracleMeta };
}

export function processImportAssets(
  assets: ImportAsset[],
  deckType: "tarot" | "oracle",
  oracleMeta?: Map<string, { name: string; description: string }>,
): ImportSessionResult {
  const assigned: Record<string, string> = {};
  const unmatched: Record<string, ImportAsset> = {};
  const ambiguous: Array<{
    cardId: number;
    assetKey: string;
    matchScore: number;
  }> = [];
  let cardBackKey: string | null = null;

  if (deckType === "oracle") {
    const sorted = [...assets].sort((a, b) =>
      a.filename.localeCompare(b.filename, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    sorted.forEach((asset, idx) => {
      const cardId = ORACLE_ID_BASE + idx;
      const stem = asset.filename.replace(/\.[^.]+$/, "").toLowerCase();
      const meta = oracleMeta?.get(stem);
      asset.oracleName = meta?.name ?? oracleNameFromFilename(asset.filename);
      asset.oracleDescription = meta?.description ?? "";
      assigned[String(cardId)] = asset.key;
    });
    return {
      assigned,
      unmatched,
      ambiguous,
      cardBackKey: null,
      matchedCount: sorted.length,
      ambiguousCount: 0,
      unmatchedCount: 0,
    };
  }

  // Tarot
  const filenameToAsset = new Map<string, ImportAsset>();
  for (const asset of assets) filenameToAsset.set(asset.filename, asset);
  const names = assets.map((a) => a.filename);
  const match = matchFilenames(names);

  for (const [filename, info] of match.scoredAssignments) {
    const asset = filenameToAsset.get(filename);
    if (!asset) continue;
    assigned[String(info.cardId)] = asset.key;
    if (info.score < HIGH_CONFIDENCE_SCORE) {
      ambiguous.push({
        cardId: info.cardId,
        assetKey: asset.key,
        matchScore: info.score,
      });
    }
  }

  if (match.cardBackFile) {
    const asset = filenameToAsset.get(match.cardBackFile);
    if (asset) {
      cardBackKey = asset.key;
      assigned[BACK_KEY] = asset.key;
    }
  }
  if (!cardBackKey) {
    for (const asset of assets) {
      if (isCardBackFilename(asset.filename)) {
        cardBackKey = asset.key;
        assigned[BACK_KEY] = asset.key;
        break;
      }
    }
  }

  // 9-6-AF — if exactly 1 file remains unmatched after a complete
  // 78-card match AND no back was named recognizably, treat the
  // lone leftover as the card back.
  if (!cardBackKey) {
    const assignedKeysSoFar = new Set(Object.values(assigned));
    const leftover = assets.filter((a) => !assignedKeysSoFar.has(a.key));
    const numericMatched = Object.keys(assigned).filter(
      (k) => k !== BACK_KEY,
    ).length;
    if (numericMatched === 78 && leftover.length === 1) {
      cardBackKey = leftover[0].key;
      assigned[BACK_KEY] = leftover[0].key;
    }
  }

  // Anything not assigned is unmatched.
  const assignedKeys = new Set(Object.values(assigned));
  for (const asset of assets) {
    if (!assignedKeys.has(asset.key)) unmatched[asset.key] = asset;
  }

  const matchedCount = Object.keys(assigned).filter((k) => k !== BACK_KEY)
    .length;
  return {
    assigned,
    unmatched,
    ambiguous,
    cardBackKey,
    matchedCount,
    ambiguousCount: ambiguous.length,
    unmatchedCount: Object.keys(unmatched).length,
  };
}

/** Convenience: convert an ImportAsset to the shape per-card-save needs. */
export function assetToImportImage(asset: ImportAsset): {
  key: string;
  filename: string;
  rawBlob: Blob;
  width: number;
  height: number;
  oracleName?: string;
  oracleDescription?: string;
} {
  return {
    key: asset.key,
    filename: asset.filename,
    rawBlob: asset.blob,
    width: asset.width,
    height: asset.height,
    oracleName: asset.oracleName,
    oracleDescription: asset.oracleDescription,
  };
}

export { ORACLE_ID_BASE, HIGH_CONFIDENCE_SCORE, BACK_KEY };