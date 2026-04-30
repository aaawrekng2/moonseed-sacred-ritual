/**
 * ZipImporter — session-backed bulk deck import (Stamp BK).
 *
 * Architecture (Phase BJ):
 *   - One IndexedDB session per deck holds raw blobs + assignments +
 *     per-image encoded WebP assets. The wizard mutates this session
 *     freely; nothing is written to Supabase until the user taps Save.
 *   - Encoding runs on a concurrency-capped queue the moment a user
 *     assigns an image to a slot, so by the time they hit Save the
 *     uploads are mostly just network I/O.
 *   - "Re-import" / resume: opening the importer for a deck that has
 *     existing custom_deck_cards rows pre-populates the assigned panel
 *     with synthetic EXISTING:* markers. The user sees their existing
 *     deck and can replace individual slots; only changed slots get
 *     archived and re-uploaded on Save.
 *
 * UI shape:
 *   1. Upload (or resume banner if a session exists)
 *   2. Workspace — three-tab view: Unassigned | Assigned | Skipped
 *      Tap an image → ZoomModal → Pick a card (CardPicker) or Skip
 *      Tap an assigned slot → unassign / replace
 *      Card-back picker is a compact inline panel.
 *   3. Save → atomic commit (via deck-import-commit).
 *   4. Summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Upload, X } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCardName, getCardImagePath } from "@/lib/tarot";
import { CardPicker } from "@/components/cards/CardPicker";
import { matchFilenames, isCardBackFilename } from "./matcher";
import {
  BACK_KEY,
  computeImageKey,
  deleteSession,
  getSession,
  makeThrottledSaver,
  saveSession,
  type EncodedAsset,
  type ImportImage,
  type ImportSession,
} from "@/lib/import-session";
import { EncodingQueue } from "@/lib/deck-image-pipeline";
import { commitImportSession } from "@/lib/deck-import-commit";
import { fetchDeckCards } from "@/lib/custom-decks";

const ZIP_MAX_BYTES = 20 * 1024 * 1024;
const VALID_EXT = /\.(png|jpe?g|webp|gif)$/i;

type Phase =
  | { kind: "loading" }
  | { kind: "upload"; resumable: boolean }
  | { kind: "extracting" }
  | { kind: "workspace" }
  | { kind: "saving"; total: number; done: number }
  | {
      kind: "summary";
      written: number;
      failedCardIds: number[];
      cardBackFailed: boolean;
    };

type Tab = "unassigned" | "assigned" | "skipped";

type WorkspaceState = {
  session: ImportSession;
};

export function ZipImporter({
  userId,
  deckId,
  shape,
  cornerRadiusPercent,
  onCancel,
  onDone,
}: {
  userId: string;
  deckId: string;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const queueRef = useRef<EncodingQueue>(new EncodingQueue());
  const saverRef = useRef(makeThrottledSaver(deckId));

  // Bootstrap: check for existing session OR existing deck rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await getSession(deckId);
        if (cancelled) return;
        if (existing && Object.keys(existing.unassigned).length + Object.keys(existing.assigned).length > 0) {
          setWorkspace({ session: existing });
          setPhase({ kind: "workspace" });
          return;
        }
        // No session: check for existing deck cards (re-import path).
        const existingCards = await fetchDeckCards(deckId);
        if (cancelled) return;
        if (existingCards.length > 0) {
          // Pre-populate session with synthetic markers.
          const session = makeEmptySession(deckId);
          for (const c of existingCards) {
            const k = `EXISTING:${c.card_id}`;
            session.unassigned[k] = {
              key: k,
              filename: `${getCardName(c.card_id)} (current)`,
              rawBlob: new Blob(),
              width: 0,
              height: 0,
              existingUrl: c.thumbnail_url || c.display_url,
            };
            session.assigned[String(c.card_id)] = k;
          }
          await saveSession(session);
          setWorkspace({ session });
          setPhase({ kind: "workspace" });
          return;
        }
        setPhase({ kind: "upload", resumable: false });
      } catch (err) {
        console.error("[ZipImporter] bootstrap failed", err);
        setPhase({ kind: "upload", resumable: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  /* ---------- Zip extraction ---------- */
  const handleFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".zip")) {
      toast.error("Please upload a .zip file.");
      return;
    }
    if (file.size > ZIP_MAX_BYTES) {
      toast.error("Zip is too large. Maximum size is 20MB.");
      return;
    }
    setPhase({ kind: "extracting" });
    try {
      const zip = await JSZip.loadAsync(file);
      const entries: JSZip.JSZipObject[] = [];
      zip.forEach((_path, entry) => {
        if (!entry.dir) entries.push(entry);
      });
      const session = makeEmptySession(deckId);
      const rawByName = new Map<string, Blob>();
      for (const entry of entries) {
        const base = entry.name.split("/").pop() ?? entry.name;
        if (!VALID_EXT.test(base)) continue;
        const blob = await entry.async("blob");
        rawByName.set(base, blob);
      }
      if (rawByName.size === 0) {
        toast.error("No card images found in this zip.");
        setPhase({ kind: "upload", resumable: false });
        return;
      }
      const names = Array.from(rawByName.keys());
      const match = matchFilenames(names);
      // Auto-assign matched cards.
      const filenameToKey = new Map<string, string>();
      for (const [name, blob] of rawByName) {
        const key = await computeImageKey(name, blob);
        filenameToKey.set(name, key);
        const img = await makeImportImage(key, name, blob);
        session.unassigned[key] = img;
      }
      for (const [filename, cardId] of match.assignments) {
        const key = filenameToKey.get(filename);
        if (!key) continue;
        session.assigned[String(cardId)] = key;
      }
      if (match.cardBackFile) {
        const key = filenameToKey.get(match.cardBackFile);
        if (key) session.assigned[BACK_KEY] = key;
      }
      // Auto-detect any "back*"-named files even if matcher missed them.
      if (!session.assigned[BACK_KEY]) {
        for (const name of names) {
          if (isCardBackFilename(name)) {
            const k = filenameToKey.get(name);
            if (k) {
              session.assigned[BACK_KEY] = k;
              break;
            }
          }
        }
      }
      await saveSession(session);
      setWorkspace({ session });
      setPhase({ kind: "workspace" });
      // Kick off encoding for assigned images upfront.
      kickoffEncoding(session, queueRef.current, { shape, cornerRadiusPercent }, (asset) => {
        // Update session via setter on next render.
        setWorkspace((prev) => {
          if (!prev) return prev;
          const next = cloneSession(prev.session);
          next.encoded[asset.key] = asset;
          saverRef.current.schedule(next);
          return { session: next };
        });
      });
    } catch (err) {
      console.error("Zip read failed", err);
      toast.error("Couldn't read that zip.");
      setPhase({ kind: "upload", resumable: false });
    }
  }, [deckId, shape, cornerRadiusPercent]);

  /* ---------- Mutators ---------- */
  const mutate = useCallback((mutator: (s: ImportSession) => void) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const next = cloneSession(prev.session);
      mutator(next);
      saverRef.current.schedule(next);
      return { session: next };
    });
  }, []);

  const handleAssign = useCallback((imageKey: string, cardId: number | "BACK") => {
    const slot = cardId === "BACK" ? BACK_KEY : String(cardId);
    mutate((s) => {
      // Remove image from unassigned/skipped.
      const fromUn = s.unassigned[imageKey];
      const fromSk = s.skipped[imageKey];
      const img = fromUn ?? fromSk;
      // If neither bucket has it, it's already assigned somewhere — pull
      // from the shadow asset store.
      const shadow = ensureAssetStore(s)[imageKey];
      const sourceImg = img ?? shadow;
      if (!sourceImg) return;
      delete s.unassigned[imageKey];
      delete s.skipped[imageKey];
      // If slot already occupied, push displaced image back to unassigned.
      const displaced = s.assigned[slot];
      if (displaced && displaced !== imageKey) {
        const displacedImg = findImage(s, displaced);
        if (displacedImg && !displaced.startsWith("EXISTING:")) {
          s.unassigned[displaced] = displacedImg;
        }
      }
      // Remove imageKey from any other slot it may have occupied.
      for (const k of Object.keys(s.assigned)) {
        if (s.assigned[k] === imageKey) delete s.assigned[k];
      }
      s.assigned[slot] = imageKey;
      // Stash in shadow asset store so findImage() can still locate it
      // after it's been removed from unassigned/skipped.
      ensureAssetStore(s)[imageKey] = sourceImg;
    });
    // Trigger encoding for this image if not already encoded.
    setWorkspace((prev) => {
      if (!prev) return prev;
      const img = findImage(prev.session, imageKey);
      if (img && !img.existingUrl && !prev.session.encoded[imageKey]) {
        queueRef.current
          .enqueue(imageKey, img.rawBlob, { shape, cornerRadiusPercent })
          .then((asset) => {
            setWorkspace((cur) => {
              if (!cur) return cur;
              const next = cloneSession(cur.session);
              next.encoded[asset.key] = asset;
              saverRef.current.schedule(next);
              return { session: next };
            });
          })
          .catch((e) => console.warn("encode failed", e));
      }
      return prev;
    });
  }, [mutate, shape, cornerRadiusPercent]);

  const handleSkip = useCallback((imageKey: string) => {
    mutate((s) => {
      const img = s.unassigned[imageKey];
      if (!img) return;
      delete s.unassigned[imageKey];
      s.skipped[imageKey] = img;
    });
  }, [mutate]);

  const handleUnskip = useCallback((imageKey: string) => {
    mutate((s) => {
      const img = s.skipped[imageKey];
      if (!img) return;
      delete s.skipped[imageKey];
      s.unassigned[imageKey] = img;
    });
  }, [mutate]);

  const handleUnassign = useCallback((slot: string) => {
    mutate((s) => {
      const imageKey = s.assigned[slot];
      if (!imageKey) return;
      delete s.assigned[slot];
      const img = findImage(s, imageKey);
      if (img && !imageKey.startsWith("EXISTING:")) {
        s.unassigned[imageKey] = img;
      }
    });
  }, [mutate]);

  const handleSave = useCallback(async () => {
    if (!workspace) return;
    await saverRef.current.flush();
    const total = Object.keys(workspace.session.assigned).length;
    setPhase({ kind: "saving", total, done: 0 });
    try {
      const result = await commitImportSession({
        session: workspace.session,
        userId,
        deckId,
        shape,
        cornerRadiusPercent,
        queue: queueRef.current,
      });
      setPhase({
        kind: "summary",
        written: result.written,
        failedCardIds: result.failedCardIds,
        cardBackFailed: result.cardBackFailed,
      });
    } catch (err) {
      console.error("commit failed", err);
      toast.error("Save failed. Your progress is preserved — try again.");
      setPhase({ kind: "workspace" });
    }
  }, [workspace, userId, deckId, shape, cornerRadiusPercent]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleDiscard = useCallback(async () => {
    if (!confirm("Discard this import? Your in-progress changes will be lost.")) return;
    await deleteSession(deckId);
    setWorkspace(null);
    setPhase({ kind: "upload", resumable: false });
  }, [deckId]);

  /* ---------- Renders ---------- */
  if (phase.kind === "loading") return <Centered text="Checking for saved progress…" />;
  if (phase.kind === "upload") return <UploadStep onFile={handleFile} onCancel={handleCancel} />;
  if (phase.kind === "extracting") return <Centered text="Reading your zip…" />;
  if (phase.kind === "saving") return <Centered text={`Saving deck… ${phase.done}/${phase.total}`} />;
  if (phase.kind === "summary") {
    return (
      <Summary
        written={phase.written}
        failedCardIds={phase.failedCardIds}
        cardBackFailed={phase.cardBackFailed}
        onDone={async () => {
          await deleteSession(deckId);
          onDone();
        }}
      />
    );
  }
  if (!workspace) return <Centered text="Loading…" />;
  return (
    <Workspace
      session={workspace.session}
      onAssign={handleAssign}
      onSkip={handleSkip}
      onUnskip={handleUnskip}
      onUnassign={handleUnassign}
      onSave={handleSave}
      onCancel={handleCancel}
      onDiscard={handleDiscard}
    />
  );
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function makeEmptySession(deckId: string): ImportSession {
  return {
    deckId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    unassigned: {},
    assigned: {},
    skipped: {},
    encoded: {},
  };
}

/** Asset store keeps raw blobs/encoded for assigned images so we can
 *  unassign them later. Stored on session under a non-typed bucket. */
function ensureAssetStore(s: ImportSession): Record<string, ImportImage> {
  const anyS = s as ImportSession & { _assets?: Record<string, ImportImage> };
  if (!anyS._assets) anyS._assets = {};
  return anyS._assets;
}

function findImage(s: ImportSession, imageKey: string): ImportImage | null {
  if (s.unassigned[imageKey]) return s.unassigned[imageKey];
  if (s.skipped[imageKey]) return s.skipped[imageKey];
  const store = (s as ImportSession & { _assets?: Record<string, ImportImage> })._assets;
  return store?.[imageKey] ?? null;
}

function cloneSession(s: ImportSession): ImportSession {
  // Shallow clone is fine — blobs/assets are immutable; we mutate
  // top-level dicts only.
  return {
    ...s,
    unassigned: { ...s.unassigned },
    assigned: { ...s.assigned },
    skipped: { ...s.skipped },
    encoded: { ...s.encoded },
    ...(("_assets" in s) ? { _assets: { ...(s as ImportSession & { _assets?: Record<string, ImportImage> })._assets } } : {}),
  } as ImportSession;
}

async function makeImportImage(
  key: string,
  filename: string,
  blob: Blob,
): Promise<ImportImage> {
  let width = 0;
  let height = 0;
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    width = img.naturalWidth;
    height = img.naturalHeight;
    URL.revokeObjectURL(url);
  } catch {
    /* non-fatal */
  }
  return { key, filename, rawBlob: blob, width, height };
}

function kickoffEncoding(
  session: ImportSession,
  queue: EncodingQueue,
  opts: { shape: "rectangle" | "round"; cornerRadiusPercent: number },
  onAsset: (a: EncodedAsset) => void,
) {
  const seen = new Set<string>();
  for (const slot of Object.keys(session.assigned)) {
    const key = session.assigned[slot];
    if (seen.has(key)) continue;
    seen.add(key);
    if (session.encoded[key]) continue;
    const img = findImage(session, key);
    if (!img || img.existingUrl) continue;
    queue.enqueue(key, img.rawBlob, opts).then(onAsset).catch(() => {});
  }
}

/* ================================================================== */
/*  Upload step                                                        */
/* ================================================================== */

function UploadStep({
  onFile,
  onCancel,
}: {
  onFile: (file: File) => void;
  onCancel: () => void;
}) {
  return (
    <section className="py-8">
      <div
        className="mx-auto max-w-md rounded-xl border p-6 text-center"
        style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}
      >
        <h2
          className="mb-2 italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-md)",
            color: "var(--accent)",
          }}
        >
          Import deck from zip
        </h2>
        <p
          className="mb-5"
          style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", opacity: 0.85 }}
        >
          Upload a .zip with your card images (up to 20MB). Filenames help us
          auto-match — anything unmatched, you'll place by hand. You can save
          partial progress and come back later.
        </p>
        <label
          className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", fontSize: "var(--text-body-sm)" }}
        >
          <Upload className="h-4 w-4" />
          Choose zip file
          <input
            type="file"
            accept="application/zip,.zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="italic underline"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.7,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 py-10">
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--accent)" }} />
      <p
        className="italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body)",
          color: "var(--color-foreground)",
        }}
      >
        {text}
      </p>
    </section>
  );
}

/* ================================================================== */
/*  Workspace — three-tab assign/skip/save UI                          */
/* ================================================================== */

function Workspace({
  session,
  onAssign,
  onSkip,
  onUnskip,
  onUnassign,
  onSave,
  onCancel,
  onDiscard,
}: {
  session: ImportSession;
  onAssign: (imageKey: string, cardId: number | "BACK") => void;
  onSkip: (imageKey: string) => void;
  onUnskip: (imageKey: string) => void;
  onUnassign: (slot: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  const [tab, setTab] = useState<Tab>("unassigned");
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const [pickerForImage, setPickerForImage] = useState<string | null>(null);
  const [pickerForBack, setPickerForBack] = useState(false);

  // Build blob URL cache for raw blobs.
  const blobUrls = useMemo(() => {
    const map = new Map<string, string>();
    const seen = new Set<string>();
    const collect = (img: ImportImage) => {
      if (seen.has(img.key)) return;
      seen.add(img.key);
      if (img.existingUrl) {
        map.set(img.key, img.existingUrl);
        return;
      }
      try {
        map.set(img.key, URL.createObjectURL(img.rawBlob));
      } catch {
        /* */
      }
    };
    for (const img of Object.values(session.unassigned)) collect(img);
    for (const img of Object.values(session.skipped)) collect(img);
    const store = (session as ImportSession & { _assets?: Record<string, ImportImage> })._assets;
    if (store) for (const img of Object.values(store)) collect(img);
    return map;
  }, [session]);

  useEffect(() => () => {
    for (const url of blobUrls.values()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
  }, [blobUrls]);

  // Prefer encoded thumbnail for assigned items if available.
  const thumbUrls = useMemo(() => {
    const m = new Map<string, string>();
    for (const [key, asset] of Object.entries(session.encoded)) {
      try {
        m.set(key, URL.createObjectURL(asset.thumbnailBlob));
      } catch {
        /* */
      }
    }
    return m;
  }, [session.encoded]);
  useEffect(() => () => {
    for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
  }, [thumbUrls]);

  const resolveSrc = (key: string): string => {
    return thumbUrls.get(key) ?? blobUrls.get(key) ?? "";
  };

  const unassignedKeys = Object.keys(session.unassigned);
  const skippedKeys = Object.keys(session.skipped);
  const assignedSlots = Object.keys(session.assigned);
  const numericAssigned = assignedSlots.filter((s) => s !== BACK_KEY);
  const hasBack = !!session.assigned[BACK_KEY];

  const photographedIds = useMemo(
    () => numericAssigned.map((s) => Number(s)),
    [numericAssigned],
  );

  const resolveImageSrcForPicker = useCallback(
    (cardId: number) => {
      const k = session.assigned[String(cardId)];
      if (!k) return getCardImagePath(cardId);
      return resolveSrc(k) || getCardImagePath(cardId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.assigned, thumbUrls, blobUrls],
  );

  // CardPicker: assign image to chosen card.
  if (pickerForImage) {
    const previewUrl = resolveSrc(pickerForImage);
    return (
      <>
        {previewUrl && (
          <div
            className="pointer-events-none fixed left-3 top-3 z-[120] overflow-hidden rounded border shadow-lg"
            style={{ borderColor: "var(--accent)", background: "var(--surface-card)", width: 64, height: 64 }}
          >
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <CardPicker
          mode="photography"
          photographedIds={photographedIds}
          resolveImageSrc={resolveImageSrcForPicker}
          title="Which card is this?"
          onCancel={() => setPickerForImage(null)}
          onSelect={(cardId) => {
            onAssign(pickerForImage, cardId);
            setPickerForImage(null);
          }}
        />
      </>
    );
  }

  // CardPicker for picking the card back: reuse the same UI but treat it
  // as a single "BACK" slot. We render an inline image grid below so we
  // don't actually open CardPicker for back. Disregard.

  return (
    <section className="py-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-md)",
            color: "var(--accent)",
          }}
        >
          Import workspace
        </h2>
        <span
          className="ml-auto"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          {numericAssigned.length}/78 cards · {hasBack ? "back set" : "no back"} · {skippedKeys.length} skipped
        </span>
      </div>

      {/* Tab chips */}
      <div className="mb-3 flex gap-2 overflow-x-auto">
        <Chip active={tab === "unassigned"} onClick={() => setTab("unassigned")}>
          Unassigned ({unassignedKeys.length})
        </Chip>
        <Chip active={tab === "assigned"} onClick={() => setTab("assigned")}>
          Assigned ({numericAssigned.length})
        </Chip>
        <Chip active={tab === "skipped"} onClick={() => setTab("skipped")}>
          Skipped ({skippedKeys.length})
        </Chip>
      </div>

      {/* Card-back panel — always visible at top of all tabs */}
      <CardBackPanel
        session={session}
        resolveSrc={resolveSrc}
        unassignedKeys={unassignedKeys}
        onAssign={(k) => onAssign(k, "BACK")}
        onClear={() => onUnassign(BACK_KEY)}
      />

      {/* Tab body */}
      {tab === "unassigned" && (
        <ImageGrid
          keys={unassignedKeys}
          session={session}
          resolveSrc={resolveSrc}
          emptyText="No unassigned images. Everything has a home."
          onClick={(k) => setZoomKey(k)}
        />
      )}
      {tab === "assigned" && (
        <AssignedGrid
          session={session}
          resolveSrc={resolveSrc}
          onUnassign={onUnassign}
        />
      )}
      {tab === "skipped" && (
        <ImageGrid
          keys={skippedKeys}
          session={session}
          resolveSrc={resolveSrc}
          emptyText="Nothing skipped."
          onClick={(k) => setZoomKey(k)}
          actionLabel="Move back to Unassigned"
          onAction={(k) => onUnskip(k)}
        />
      )}

      {/* Footer actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={numericAssigned.length === 0 && !hasBack}
          className="rounded-md px-4 py-2 disabled:opacity-50"
          style={{
            background: "var(--accent)",
            color: "#000",
            fontSize: "var(--text-body-sm)",
            fontWeight: 600,
          }}
        >
          Save deck
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="italic underline"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.6,
          }}
        >
          Discard import
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto"
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          Close (keeps progress)
        </button>
      </div>

      {/* Zoom modal */}
      {zoomKey && (
        <ZoomModal
          src={resolveSrc(zoomKey)}
          inSkipped={!!session.skipped[zoomKey]}
          onPickCard={() => {
            const k = zoomKey;
            setZoomKey(null);
            setPickerForImage(k);
          }}
          onSkip={() => {
            onSkip(zoomKey);
            setZoomKey(null);
          }}
          onUnskip={() => {
            onUnskip(zoomKey);
            setZoomKey(null);
          }}
          onBack={() => setZoomKey(null)}
        />
      )}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap rounded-full border px-3 py-1.5"
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#000" : "var(--color-foreground)",
        borderColor: active ? "var(--accent)" : "var(--border-subtle)",
        fontSize: "var(--text-body-sm)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function ImageGrid({
  keys,
  session,
  resolveSrc,
  emptyText,
  onClick,
  actionLabel,
  onAction,
}: {
  keys: string[];
  session: ImportSession;
  resolveSrc: (key: string) => string;
  emptyText: string;
  onClick: (key: string) => void;
  actionLabel?: string;
  onAction?: (key: string) => void;
}) {
  if (keys.length === 0) {
    return (
      <p
        className="py-8 text-center"
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.6,
        }}
      >
        {emptyText}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
      {keys.map((key) => {
        const img = session.unassigned[key] ?? session.skipped[key];
        const src = resolveSrc(key);
        return (
          <div key={key} className="space-y-1">
            <button
              type="button"
              onClick={() => onClick(key)}
              className="block aspect-square w-full overflow-hidden rounded border"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--surface-card)",
              }}
            >
              {src ? (
                <img src={src} alt={img?.filename ?? ""} className="h-full w-full object-cover" />
              ) : null}
            </button>
            {actionLabel && onAction && (
              <button
                type="button"
                onClick={() => onAction(key)}
                className="block w-full italic underline"
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--accent)",
                }}
              >
                {actionLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AssignedGrid({
  session,
  resolveSrc,
  onUnassign,
}: {
  session: ImportSession;
  resolveSrc: (key: string) => string;
  onUnassign: (slot: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {Array.from({ length: 78 }, (_, i) => {
        const slot = String(i);
        const key = session.assigned[slot];
        const src = key ? resolveSrc(key) : "";
        const isExisting = key?.startsWith("EXISTING:");
        return (
          <button
            key={i}
            type="button"
            onClick={() => key && onUnassign(slot)}
            className="relative aspect-[0.625] overflow-hidden rounded border"
            style={{
              borderColor: key ? "var(--accent)" : "var(--border-subtle)",
              background: "var(--surface-card)",
            }}
            title={key ? `${getCardName(i)} — tap to unassign` : getCardName(i)}
          >
            {src ? (
              <img src={src} alt={getCardName(i)} className="h-full w-full object-cover" />
            ) : (
              <img
                src={getCardImagePath(i)}
                alt={getCardName(i)}
                className="h-full w-full object-cover"
                style={{ opacity: 0.25, filter: "grayscale(100%)" }}
              />
            )}
            {isExisting && (
              <span
                className="absolute left-1 top-1 rounded px-1 text-[9px] uppercase"
                style={{ background: "var(--surface-card)", color: "var(--color-foreground)", opacity: 0.85 }}
              >
                current
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CardBackPanel({
  session,
  resolveSrc,
  unassignedKeys,
  onAssign,
  onClear,
}: {
  session: ImportSession;
  resolveSrc: (key: string) => string;
  unassignedKeys: string[];
  onAssign: (key: string) => void;
  onClear: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const currentKey = session.assigned[BACK_KEY];
  const currentSrc = currentKey ? resolveSrc(currentKey) : "";
  return (
    <div
      className="mb-4 flex items-center gap-3 rounded-md border p-3"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}
    >
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {currentSrc ? (
          <img src={currentSrc} alt="Card back" className="h-full w-full object-cover" />
        ) : (
          <span style={{ fontSize: 10, color: "var(--color-foreground)", opacity: 0.5 }}>none</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
          }}
        >
          Card back {currentKey ? "selected" : "not chosen"}
        </p>
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          The image shown when cards are face-down.
        </p>
      </div>
      {currentKey && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md p-1.5 hover:opacity-80"
          aria-label="Clear card back"
          style={{ color: "var(--color-foreground)", opacity: 0.6 }}
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        className="rounded-md border px-3 py-1.5"
        style={{
          borderColor: "var(--accent)",
          color: "var(--accent)",
          fontSize: "var(--text-body-sm)",
        }}
      >
        {currentKey ? "Replace" : "Pick"}
      </button>
      {picking && (
        <div
          className="absolute left-0 right-0 z-30 mt-2 max-h-72 overflow-y-auto border-t p-3"
          style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)", marginTop: 80 }}
        >
          {unassignedKeys.length === 0 ? (
            <p style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", opacity: 0.7 }}>
              No unassigned images to choose from.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {unassignedKeys.map((k) => {
                const src = resolveSrc(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      onAssign(k);
                      setPicking(false);
                    }}
                    className="aspect-square overflow-hidden rounded border"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    {src && <img src={src} alt="" className="h-full w-full object-cover" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ZoomModal({
  src,
  inSkipped,
  onPickCard,
  onSkip,
  onUnskip,
  onBack,
}: {
  src: string;
  inSkipped: boolean;
  onPickCard: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onBack: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center p-4"
      style={{ background: "var(--surface-overlay, rgba(0,0,0,0.85))" }}
    >
      <img src={src} alt="" style={{ maxHeight: "78vh", maxWidth: "100%" }} className="rounded" />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-4 py-2"
          style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
        >
          Back
        </button>
        {inSkipped ? (
          <button
            type="button"
            onClick={onUnskip}
            className="rounded-md px-4 py-2"
            style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
          >
            Move to Unassigned
          </button>
        ) : (
          <button
            type="button"
            onClick={onSkip}
            className="rounded-md px-4 py-2"
            style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
          >
            Skip
          </button>
        )}
        <button
          type="button"
          onClick={onPickCard}
          className="rounded-md px-4 py-2 font-medium"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground, #000)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Pick a card
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Summary                                                            */
/* ================================================================== */

function Summary({
  written,
  failedCardIds,
  cardBackFailed,
  onDone,
}: {
  written: number;
  failedCardIds: number[];
  cardBackFailed: boolean;
  onDone: () => void;
}) {
  const ok = failedCardIds.length === 0 && !cardBackFailed;
  return (
    <section className="mx-auto max-w-md py-10 text-center">
      <h2
        className="mb-4 italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-heading-md)",
          color: ok ? "var(--accent)" : "var(--color-foreground)",
        }}
      >
        {ok ? "Deck saved" : "Saved with issues"}
      </h2>
      <p
        className="mb-2"
        style={{ fontSize: "var(--text-body)", color: "var(--color-foreground)" }}
      >
        {written} card{written === 1 ? "" : "s"} written.
      </p>
      {failedCardIds.length > 0 && (
        <p style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", opacity: 0.85 }}>
          Failed: {failedCardIds.map((id) => getCardName(id)).join(", ")}.
        </p>
      )}
      {cardBackFailed && (
        <p style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)", opacity: 0.85 }}>
          Card back failed to save.
        </p>
      )}
      <button
        type="button"
        onClick={onDone}
        className="mt-6 rounded-md px-5 py-2 font-medium"
        style={{ background: "var(--accent)", color: "#000", fontSize: "var(--text-body-sm)" }}
      >
        Done
      </button>
    </section>
  );
}
