/**
 * v2.3 — Backup inspector ("Check Data").
 *
 * Read-only. Parses one or more backup ZIP parts the seeker picks and
 * returns a full analysis — counts, readings numbers, image-file tallies,
 * an integrity check (manifest claims vs. what's actually in the file), and
 * the actual records so the seeker can browse them. Touches no database and
 * writes nothing; it only reads the file in the browser.
 */
import JSZip from "jszip";
import { getCardName } from "@/lib/tarot";
import { readBackupManifest, type BackupManifestV1 } from "@/lib/backup-restore";

const IMG_RE = /\.(webp|jpe?g|png|gif|avif)$/i;

export type InspectedReading = {
  date: string;
  cards: string[];
  reversed: boolean[];
  question: string;
  favorite: boolean;
  deep: boolean;
  spread: string;
};

export type InspectedDeck = {
  name: string;
  cards: number;
  images: number;
};

export type BackupAnalysis = {
  fileName: string;
  fileSizeBytes: number;
  exportedAt: string;
  schemaVersion: number;
  app: string;
  totalParts: number;
  partsPresent: number;
  categories: string[];

  readings: {
    total: number;
    favorites: number;
    deep: number;
    withPhotos: number;
    distinctCards: number;
    reversed: number;
    spanStart: string | null;
    spanEnd: string | null;
  };
  tags: number;
  streakDays: number | null;
  decks: { count: number; imageFiles: number };
  photos: { count: number; imageFiles: number };
  guides: number;
  hasPreferences: boolean;

  integrity: { ok: boolean; issues: string[]; imageFilesTotal: number };

  // Browse data (read-only).
  readingRows: InspectedReading[];
  tagList: string[];
  deckList: InspectedDeck[];
};

export type InspectInputPart = {
  name: string;
  size: number;
  manifest: BackupManifestV1;
  zip: JSZip;
};

/** Parse raw File objects into inspectable parts (validates the manifest). */
export async function readInspectParts(
  files: File[],
): Promise<InspectInputPart[]> {
  const parts: InspectInputPart[] = [];
  for (const f of files) {
    const { manifest, zip } = await readBackupManifest(f);
    parts.push({ name: f.name, size: f.size, manifest, zip });
  }
  return parts;
}

async function readJsonFromParts<T>(
  parts: InspectInputPart[],
  path: string,
): Promise<T[]> {
  for (const p of parts) {
    const entry = p.zip.file(path);
    if (entry) {
      try {
        const parsed = JSON.parse(await entry.async("string"));
        return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T];
      } catch {
        return [];
      }
    }
  }
  return [];
}

function countImageFiles(parts: InspectInputPart[], prefix: string): number {
  let n = 0;
  for (const p of parts) {
    for (const name of Object.keys(p.zip.files)) {
      const f = p.zip.files[name];
      if (!f.dir && name.startsWith(prefix) && IMG_RE.test(name)) n += 1;
    }
  }
  return n;
}

export async function analyzeBackup(
  parts: InspectInputPart[],
): Promise<BackupAnalysis> {
  const part1 =
    parts.find((p) => (p.manifest.part_index ?? 1) === 1) ?? parts[0];
  const manifest = part1.manifest;
  const contents = manifest.contents ?? {};
  const categories = manifest.categories ?? [];
  const issues: string[] = [];

  // ---- Readings ----
  const readingRowsRaw = await readJsonFromParts<Record<string, unknown>>(
    parts,
    "readings/readings.json",
  );
  // Build custom-deck card-name maps so browse can resolve custom cards.
  const deckRows = await readJsonFromParts<Record<string, unknown>>(
    parts,
    "custom_decks/decks.json",
  );
  const deckNameById = new Map<string, string>();
  const deckCardName = new Map<string, Map<number, string>>();
  for (const d of deckRows) {
    const id = String((d as { id?: unknown }).id ?? "");
    if (id) deckNameById.set(id, String((d as { name?: unknown }).name ?? "Deck"));
  }
  // Each deck folder holds a cards.json; collect card_id -> card_name.
  for (const p of parts) {
    for (const name of Object.keys(p.zip.files)) {
      if (/^custom_decks\/.+\/cards\.json$/.test(name)) {
        try {
          const cards = JSON.parse(
            await p.zip.files[name].async("string"),
          ) as Array<{ deck_id?: string; card_id?: number; card_name?: string | null }>;
          for (const c of cards) {
            if (c.deck_id == null || c.card_id == null) continue;
            const did = String(c.deck_id);
            if (!deckCardName.has(did)) deckCardName.set(did, new Map());
            if (c.card_name && c.card_name.trim()) {
              deckCardName.get(did)!.set(c.card_id, c.card_name.trim());
            }
          }
        } catch {
          // skip unreadable deck card file
        }
      }
    }
  }

  const nameFor = (id: number, deckId: string | null): string => {
    if (deckId) {
      const m = deckCardName.get(deckId);
      const nm = m?.get(id);
      if (nm) return nm;
      return id >= 0 && id <= 77 ? getCardName(id) : "Custom card";
    }
    return id >= 0 && id <= 77 ? getCardName(id) : "Custom card";
  };

  // Photo → which readings have at least one photo.
  const photoRows = await readJsonFromParts<Record<string, unknown>>(
    parts,
    "reading_photos/photos.json",
  );
  const readingIdsWithPhotos = new Set(
    photoRows
      .map((p) => String((p as { reading_id?: unknown }).reading_id ?? ""))
      .filter(Boolean),
  );

  const distinctCards = new Set<number>();
  let favorites = 0;
  let deep = 0;
  let withPhotos = 0;
  let reversed = 0;
  let spanStart: string | null = null;
  let spanEnd: string | null = null;
  const readingRows: InspectedReading[] = [];

  for (const r of readingRowsRaw) {
    const cardIds = (r as { card_ids?: unknown }).card_ids;
    const orients = (r as { card_orientations?: unknown }).card_orientations;
    const deckIds = (r as { card_deck_ids?: unknown }).card_deck_ids;
    const ids = Array.isArray(cardIds) ? (cardIds as number[]) : [];
    const ors = Array.isArray(orients) ? (orients as boolean[]) : [];
    const dks = Array.isArray(deckIds) ? (deckIds as (string | null)[]) : [];
    ids.forEach((id) => distinctCards.add(id));
    reversed += ors.filter(Boolean).length;
    const fav = (r as { is_favorite?: unknown }).is_favorite === true;
    const dp = (r as { is_deep_reading?: unknown }).is_deep_reading === true;
    if (fav) favorites += 1;
    if (dp) deep += 1;
    const rid = String((r as { id?: unknown }).id ?? "");
    if (rid && readingIdsWithPhotos.has(rid)) withPhotos += 1;
    const createdAt = String((r as { created_at?: unknown }).created_at ?? "");
    if (createdAt) {
      if (spanStart === null || createdAt < spanStart) spanStart = createdAt;
      if (spanEnd === null || createdAt > spanEnd) spanEnd = createdAt;
    }
    readingRows.push({
      date: createdAt,
      cards: ids.map((id, i) => nameFor(id, dks[i] ?? null)),
      reversed: ors,
      question: String((r as { question?: unknown }).question ?? ""),
      favorite: fav,
      deep: dp,
      spread: String((r as { spread_type?: unknown }).spread_type ?? ""),
    });
  }
  readingRows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // ---- Tags ----
  const tagRows = await readJsonFromParts<Record<string, unknown>>(
    parts,
    "user_tags/tags.json",
  );
  const tagList = tagRows
    .map((t) =>
      String(
        (t as { name?: unknown; label?: unknown }).name ??
          (t as { label?: unknown }).label ??
          "",
      ),
    )
    .filter(Boolean);

  // ---- Streaks ----
  const streakRows = await readJsonFromParts<Record<string, unknown>>(
    parts,
    "user_streaks/streaks.json",
  );
  let streakDays: number | null = null;
  if (streakRows.length > 0) {
    const s = streakRows[0];
    const longest = (s as { longest_streak?: unknown }).longest_streak;
    const current = (s as { current_streak?: unknown }).current_streak;
    streakDays =
      typeof longest === "number"
        ? longest
        : typeof current === "number"
          ? current
          : null;
  }

  // ---- Decks ----
  const deckImageFiles = countImageFiles(parts, "custom_decks/");
  const deckList: InspectedDeck[] = deckRows.map((d) => {
    const did = String((d as { id?: unknown }).id ?? "");
    const m = deckCardName.get(did);
    return {
      name: deckNameById.get(did) ?? "Deck",
      cards: m ? m.size : 0,
      images: 0, // per-deck image split is unnecessary; total shown separately
    };
  });

  // ---- Photos ----
  const photoImageFiles = countImageFiles(parts, "reading_photos/");

  // ---- Guides ----
  const guideRows = await readJsonFromParts<Record<string, unknown>>(
    parts,
    "custom_guides/guides.json",
  );

  // ---- Preferences ----
  const hasPreferences =
    (contents.preferences?.rows ?? 0) > 0 ||
    parts.some((p) => !!p.zip.file("preferences/preferences.json"));

  // ---- Integrity: manifest claims vs. actual ----
  const claim = (cat: string) => contents[cat]?.rows;
  const check = (cat: string, actual: number, label: string) => {
    const c = claim(cat);
    if (c != null && c !== actual) {
      issues.push(`${label}: file holds ${actual}, manifest says ${c}`);
    }
  };
  check("readings", readingRowsRaw.length, "Readings");
  check("user_tags", tagRows.length, "Tags");
  check("custom_guides", guideRows.length, "Guides");
  check("reading_photos", photoRows.length, "Reading photos");
  check("custom_decks", deckRows.length, "Custom decks");

  const claimedDeckFiles = contents.custom_decks?.files;
  if (claimedDeckFiles != null && claimedDeckFiles !== deckImageFiles) {
    issues.push(
      `Deck images: ${deckImageFiles} in file, manifest says ${claimedDeckFiles}`,
    );
  }
  const claimedPhotoFiles = contents.reading_photos?.files;
  if (claimedPhotoFiles != null && claimedPhotoFiles !== photoImageFiles) {
    issues.push(
      `Reading-photo images: ${photoImageFiles} in file, manifest says ${claimedPhotoFiles}`,
    );
  }

  const totalParts = manifest.total_parts ?? 1;
  if (parts.length < totalParts) {
    issues.push(
      `Multi-part backup: ${parts.length} of ${totalParts} parts loaded`,
    );
  }

  return {
    fileName: part1.name,
    fileSizeBytes: parts.reduce((s, p) => s + p.size, 0),
    exportedAt: manifest.exported_at,
    schemaVersion: manifest.schema_version,
    app: manifest.app,
    totalParts,
    partsPresent: parts.length,
    categories,
    readings: {
      total: readingRowsRaw.length,
      favorites,
      deep,
      withPhotos,
      distinctCards: distinctCards.size,
      reversed,
      spanStart,
      spanEnd,
    },
    tags: tagRows.length,
    streakDays,
    decks: { count: deckRows.length, imageFiles: deckImageFiles },
    photos: { count: photoRows.length, imageFiles: photoImageFiles },
    guides: guideRows.length,
    hasPreferences,
    integrity: {
      ok: issues.length === 0,
      issues,
      imageFilesTotal: deckImageFiles + photoImageFiles,
    },
    readingRows,
    tagList,
    deckList,
  };
}
