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
import { AlertTriangle, Check, Loader2, RotateCcw, Upload, X } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/use-confirm";
import { getCardName, getCardImagePath } from "@/lib/tarot";
import { CardPicker } from "@/components/cards/CardPicker";
import { PhotoCapture } from "@/components/photo/PhotoCapture";
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
import { fetchDeckCards } from "@/lib/custom-decks";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { saveCard, removeCard, type SaveResult } from "@/lib/per-card-save";
import {
  captureSnapshotIfMissing,
  deleteSnapshot,
  getSnapshot,
  restoreSnapshot,
} from "@/lib/import-snapshot";

const ZIP_MAX_BYTES = 20 * 1024 * 1024;
const VALID_EXT = /\.(png|jpe?g|webp|gif)$/i;

type Phase =
  | { kind: "loading" }
  | { kind: "upload"; resumable: boolean }
  | { kind: "extracting" }
  | { kind: "workspace" }
  | { kind: "restoring"; done: number; total: number };

type Tab = "unassigned" | "assigned" | "skipped" | "default";

type WorkspaceState = {
  session: ImportSession;
};

/** Per-slot save state used by the workspace UI (Stamp CB, Group 2). */
export type CardState = "saving" | "saved" | "failed";

/** Top-level status indicator state (Stamp CB, Group 3). */
type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved-flash"; until: number };

export function ZipImporter({
  userId,
  deckId,
  shape,
  cornerRadiusPercent,
  existingBackUrl,
  onCancel,
  onDone,
}: {
  userId: string;
  deckId: string;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  existingBackUrl?: string | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  // BLa Fix A — track whether the user's chosen save path requested
  // session deletion, so the Summary's Done button doesn't unconditionally
  // wipe sessions that 'Save and continue later' wanted to preserve.
  const [sessionDeletedOnSave, setSessionDeletedOnSave] = useState(true);
  const queueRef = useRef<EncodingQueue>(new EncodingQueue());
  const saverRef = useRef(makeThrottledSaver(deckId));
  const confirm = useConfirm();

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
          // Pre-populate session with synthetic markers (BLa Fix B).
          // Existing cards are tracked ONLY in session.assigned. Their
          // image data lives in the shadow asset store so the workspace
          // renderer can resolve them via findImage() / blobUrls without
          // polluting the Unassigned bucket.
          const session = makeEmptySession(deckId);
          const assets = ensureAssetStore(session);
          for (const c of existingCards) {
            const k = `EXISTING:${c.card_id}`;
            assets[k] = {
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

  // BN Fix 1 — replace the raw blob for an image (used by the Edit /
  // 4-corner crop refine flow). Updates dimensions, drops any cached
  // encoded asset, and re-enqueues encoding.
  const handleUpdateRawBlob = useCallback(
    (imageKey: string, blob: Blob, dims: { width: number; height: number }) => {
      mutate((s) => {
        const update = (img: ImportImage | undefined) => {
          if (!img) return;
          img.rawBlob = blob;
          img.width = dims.width;
          img.height = dims.height;
        };
        update(s.unassigned[imageKey]);
        update(s.skipped[imageKey]);
        const store = ensureAssetStore(s);
        update(store[imageKey]);
        delete s.encoded[imageKey];
      });
      // Re-enqueue encoding with the fresh blob.
      queueRef.current
        .enqueue(imageKey, blob, { shape, cornerRadiusPercent })
        .then((asset) => {
          setWorkspace((cur) => {
            if (!cur) return cur;
            const next = cloneSession(cur.session);
            next.encoded[asset.key] = asset;
            saverRef.current.schedule(next);
            return { session: next };
          });
        })
        .catch((e) => console.warn("re-encode failed", e));
    },
    [mutate, shape, cornerRadiusPercent],
  );

  const handleSave = useCallback(async (deleteSessionAfter: boolean) => {
    if (!workspace) return;
    setSessionDeletedOnSave(deleteSessionAfter);
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
        deleteSessionAfter,
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
    const ok = await confirm({
      title: "Discard this import?",
      description: "Your in-progress changes will be lost.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      destructive: true,
    });
    if (!ok) return;
    await deleteSession(deckId);
    setWorkspace(null);
    setPhase({ kind: "upload", resumable: false });
  }, [deckId, confirm]);

  /* ---------- Renders ---------- */
  let body: React.ReactNode;
  if (phase.kind === "loading") body = <Centered text="Checking for saved progress…" />;
  else if (phase.kind === "upload") body = <UploadStep onFile={handleFile} onCancel={handleCancel} />;
  else if (phase.kind === "extracting") body = <Centered text="Reading your zip…" />;
  else if (phase.kind === "saving") body = <Centered text={`Saving deck… ${phase.done}/${phase.total}`} />;
  else if (phase.kind === "summary") {
    body = (
      <Summary
        written={phase.written}
        failedCardIds={phase.failedCardIds}
        cardBackFailed={phase.cardBackFailed}
        onDone={async () => {
          if (sessionDeletedOnSave) {
            await deleteSession(deckId);
          }
          onDone();
        }}
      />
    );
  } else if (!workspace) body = <Centered text="Loading…" />;
  else
    body = (
      <Workspace
        session={workspace.session}
        onAssign={handleAssign}
        onSkip={handleSkip}
        onUnskip={handleUnskip}
        onUnassign={handleUnassign}
        onUpdateRawBlob={handleUpdateRawBlob}
        onSave={handleSave}
        onCancel={handleCancel}
        onDiscard={handleDiscard}
        shape={shape}
        cornerRadiusPercent={cornerRadiusPercent}
        existingBackUrl={existingBackUrl ?? null}
      />
    );

  // BM Fix 1.1 — full-screen takeover so the deck grid view never bleeds
  // through behind the wizard.
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto"
      style={{
        background: "var(--color-background)",
        overscrollBehavior: "contain",
      }}
    >
      <div className="mx-auto w-full max-w-5xl px-4">{body}</div>
    </div>
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
        style={{ background: "var(--surface-card)", borderColor: "var(--border-default)" }}
      >
        <h2
          className="mb-2 italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-md)",
            color: "var(--color-foreground)",
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
          style={{
            borderColor: "var(--accent)",
            background: "var(--accent)",
            color: "var(--accent-foreground)",
            fontSize: "var(--text-body-sm)",
          }}
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
  onUpdateRawBlob,
  onSave,
  onCancel,
  onDiscard,
  shape,
  cornerRadiusPercent,
  existingBackUrl,
}: {
  session: ImportSession;
  onAssign: (imageKey: string, cardId: number | "BACK") => void;
  onSkip: (imageKey: string) => void;
  onUnskip: (imageKey: string) => void;
  onUnassign: (slot: string) => void;
  onUpdateRawBlob: (imageKey: string, blob: Blob, dims: { width: number; height: number }) => void;
  onSave: (deleteSessionAfter: boolean) => void;
  onCancel: () => void;
  onDiscard: () => void;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  existingBackUrl?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("unassigned");
  // Zoom modal context: which image, opened from which filter view.
  const [zoom, setZoom] = useState<
    | null
    | {
        imageKey: string;
        from: "unassigned" | "assigned" | "skipped";
        // For 'assigned', the slot it currently occupies (for reassign defaults).
        slot?: string;
      }
  >(null);
  // CardPicker for assignment / reassignment. preserves zoom context so
  // hitting Back returns to the same zoom modal (BL Fix 5).
  const [picker, setPicker] = useState<
    | null
    | {
        imageKey: string;
        previousZoom: NonNullable<typeof zoom>;
      }
  >(null);
  // Card-back picker modal (BL Fix 4 — banner tap).
  const [showBackPicker, setShowBackPicker] = useState(false);
  // BN Fix 1 — Edit / 4-corner crop refine overlay.
  const [editing, setEditing] = useState<
    | null
    | {
        imageKey: string;
        previousZoom: NonNullable<typeof zoom>;
      }
  >(null);
  // BN Fix 2 — inline picker for assigning to a default slot.
  const [defaultPickerCardId, setDefaultPickerCardId] = useState<number | null>(null);
  // Save confirmation dialog (BL Fix 6).
  const [saveDialog, setSaveDialog] = useState<
    | null
    | {
        kind: "empty" | "skipped-only" | "unassigned-present" | "skipped-and-unassigned";
        skippedCount: number;
        unassignedCount: number;
      }
  >(null);

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

  // BO Fix 4 — high-res source resolution for the ZoomModal. The grid
  // continues to use thumbnail-quality (resolveSrc above); only the
  // zoom popup pulls the 1536px display blob / displayUrl so it doesn't
  // look pixelated when scaled up. Returned object URLs are revoked
  // by the caller via a useEffect cleanup keyed on the image key.
  const resolveZoomSrc = useCallback(
    (key: string): { src: string; revoke: boolean } => {
      if (!key) return { src: "", revoke: false };
      if (key.startsWith("EXISTING:")) {
        const img = findImage(session, key);
        return { src: img?.existingUrl ?? "", revoke: false };
      }
      const encoded = session.encoded[key];
      if (encoded?.displayBlob) {
        try {
          return { src: URL.createObjectURL(encoded.displayBlob), revoke: true };
        } catch {
          /* fall through */
        }
      }
      const img = findImage(session, key);
      if (img?.existingUrl) return { src: img.existingUrl, revoke: false };
      if (img?.rawBlob && img.rawBlob.size > 0) {
        try {
          return { src: URL.createObjectURL(img.rawBlob), revoke: true };
        } catch {
          /* */
        }
      }
      // Last resort — fall back to the thumbnail.
      return { src: resolveSrc(key), revoke: false };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );

  // Memoize the high-res zoom URL for the lifetime of the open modal
  // and revoke it when the modal closes or the image changes.
  const [zoomSrc, setZoomSrc] = useState("");
  useEffect(() => {
    if (!zoom) {
      setZoomSrc("");
      return;
    }
    const { src, revoke } = resolveZoomSrc(zoom.imageKey);
    setZoomSrc(src);
    return () => {
      if (revoke && src.startsWith("blob:")) URL.revokeObjectURL(src);
    };
  }, [zoom, resolveZoomSrc]);

  const unassignedKeys = Object.keys(session.unassigned);
  const skippedKeys = Object.keys(session.skipped);
  const assignedSlots = Object.keys(session.assigned);
  const numericAssigned = assignedSlots.filter((s) => s !== BACK_KEY);
  // CA — also recognize a card back already saved on the deck (e.g. from
  // the camera capture flow), not just one assigned in this session.
  const hasBack = !!session.assigned[BACK_KEY] || !!existingBackUrl;

  // BX — diagnostic instrumentation for the "0/78 counter never updates"
  // bug. Logs on every Workspace re-render so we can correlate UI state
  // with the underlying session map.
  console.log("[BX-counter]", {
    numericAssignedLen: numericAssigned.length,
    totalCards: 78,
    unassignedKeys: unassignedKeys.length,
    skippedKeys: skippedKeys.length,
    assignedMapSize: assignedSlots.length,
    hasBack,
    assignedKeysSample: assignedSlots.slice(0, 5),
  });

  // BN Fix 2 — set of card_ids that will be customized (non-default)
  // after save. Defined here so both the chip count and the Default
  // tab render share one source of truth.
  const customizedCardIds = useMemo(() => {
    const set = new Set<number>();
    for (const slot of Object.keys(session.assigned)) {
      if (slot === BACK_KEY) continue;
      set.add(Number(slot));
    }
    return set;
  }, [session.assigned]);
  const defaultCount = 78 - customizedCardIds.size;

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

  // BL Fix 11 — auto-switch tab when current view empties after action.
  const autoSwitch = useCallback(
    (justActedFrom: Tab, postAssigned: number, postUnassigned: number, postSkipped: number) => {
      const empty = (n: number) => n === 0;
      if (justActedFrom === "unassigned" && empty(postUnassigned)) {
        if (!empty(postAssigned)) setTab("assigned");
        else if (!empty(postSkipped)) setTab("skipped");
      } else if (justActedFrom === "assigned" && empty(postAssigned)) {
        setTab("unassigned");
      } else if (justActedFrom === "skipped" && empty(postSkipped)) {
        if (!empty(postUnassigned)) setTab("unassigned");
        else if (!empty(postAssigned)) setTab("assigned");
      }
    },
    [],
  );

  // BL Fix 5 — CardPicker overlay (assign / reassign).
  if (picker) {
    const ctx = picker;
    return (
      <CardPicker
        mode="photography"
        photographedIds={photographedIds}
        resolveImageSrc={resolveImageSrcForPicker}
        title="Which card is this?"
        onCancel={() => {
          // Return to the prior zoom modal.
          setPicker(null);
          setZoom(ctx.previousZoom);
        }}
        onSelect={(cardId) => {
          onAssign(ctx.imageKey, cardId);
          setPicker(null);
          // After assignment the image is in 'assigned'; close any zoom.
          setZoom(null);
          // Auto-switch if we just emptied the source view.
          const fromTab = ctx.previousZoom.from;
          // Compute post-counts (best-effort; counts are slightly stale
          // but autoSwitch handles the obvious empty case).
          const postUn = fromTab === "unassigned" ? unassignedKeys.length - 1 : unassignedKeys.length;
          const postSk = fromTab === "skipped" ? skippedKeys.length - 1 : skippedKeys.length;
          const postAs = numericAssigned.length + 1;
          autoSwitch(fromTab, postAs, postUn, postSk);
        }}
      />
    );
  }

  const handleSaveTap = () => {
    const skippedCount = skippedKeys.length;
    // Count "real" unassigned (exclude existing markers — those just
    // mean the user hasn't replaced a previously-imported card).
    const realUnassigned = Object.values(session.unassigned).filter(
      (img) => !img.existingUrl,
    ).length;
    const assignedCount = numericAssigned.length + (hasBack ? 1 : 0);

    if (assignedCount === 0) {
      setSaveDialog({ kind: "empty", skippedCount, unassignedCount: realUnassigned });
      return;
    }
    if (realUnassigned > 0 && skippedCount > 0) {
      setSaveDialog({
        kind: "skipped-and-unassigned",
        skippedCount,
        unassignedCount: realUnassigned,
      });
      return;
    }
    if (realUnassigned > 0) {
      setSaveDialog({
        kind: "unassigned-present",
        skippedCount,
        unassignedCount: realUnassigned,
      });
      return;
    }
    if (skippedCount > 0) {
      setSaveDialog({ kind: "skipped-only", skippedCount, unassignedCount: 0 });
      return;
    }
    onSave(true);
  };

  return (
    <section className="py-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-md)",
            color: "var(--color-foreground)",
          }}
        >
          Import workspace
        </h2>
        <span
          className="ml-auto"
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.85,
          }}
        >
          {numericAssigned.length}/78 cards · {hasBack ? "back set" : "no back"} · {skippedKeys.length} skipped
        </span>
      </div>

      {/* Tab chips — BO Fix 1: HorizontalScroll wraps the row so the
          off-screen Default chip gets an edge fade + chevron affordance. */}
      <HorizontalScroll
        className="mb-3"
        contentClassName="gap-2"
        fadeColor="var(--color-background)"
      >
        <Chip active={tab === "unassigned"} onClick={() => setTab("unassigned")}>
          Unassigned ({unassignedKeys.length})
        </Chip>
        <Chip active={tab === "assigned"} onClick={() => setTab("assigned")}>
          Assigned ({numericAssigned.length})
        </Chip>
        <Chip active={tab === "skipped"} onClick={() => setTab("skipped")}>
          Skipped ({skippedKeys.length})
        </Chip>
        <Chip active={tab === "default"} onClick={() => setTab("default")}>
          Default ({defaultCount})
        </Chip>
      </HorizontalScroll>

      {/* Card-back banner (BL Fix 4 — State A only). */}
      {!hasBack && (
        <button
          type="button"
          onClick={() => setShowBackPicker(true)}
          className="mb-4 block w-full rounded-md border px-3 py-2 text-left italic"
          style={{
            background: "var(--accent-faint, color-mix(in oklab, var(--accent) 12%, transparent))",
            borderColor: "var(--border-default)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Card back not chosen — tap to pick one
        </button>
      )}

      {/* Tab body */}
      {tab === "unassigned" && (
        <ImageGrid
          keys={unassignedKeys}
          session={session}
          resolveSrc={resolveSrc}
          emptyText="All images placed. Tap Assigned to review, or save to finish."
          variant="unassigned"
          onClick={(k) => setZoom({ imageKey: k, from: "unassigned" })}
        />
      )}
      {tab === "assigned" && (
        <AssignedGrid
          session={session}
          resolveSrc={resolveSrc}
          hasBack={hasBack}
          onTap={(slot, key) => setZoom({ imageKey: key, from: "assigned", slot })}
          onUnassign={onUnassign}
        />
      )}
      {tab === "skipped" && (
        <ImageGrid
          keys={skippedKeys}
          session={session}
          resolveSrc={resolveSrc}
          emptyText="Nothing skipped."
          variant="skipped"
          onClick={(k) => setZoom({ imageKey: k, from: "skipped" })}
          onAction={(k) => onUnskip(k)}
        />
      )}
      {tab === "default" && (
        <DefaultGrid
          customizedCardIds={customizedCardIds}
          session={session}
          resolveSrc={resolveSrc}
          defaultCount={defaultCount}
          onPickDefault={(cardId: number) => {
            if (unassignedKeys.length === 0) {
              toast(
                "All your imported images are assigned. Upload more images or photograph a card to fill this slot.",
              );
              return;
            }
            setDefaultPickerCardId(cardId);
          }}
        />
      )}

      {/* Footer actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSaveTap}
          className="rounded-md px-4 py-2"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground)",
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
            opacity: 0.85,
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
            opacity: 0.85,
          }}
        >
          Close (keeps progress)
        </button>
      </div>

      {/* Zoom modal (BL Fix 1, 3, 4) */}
      {zoom && (
        <ZoomModal
          src={zoomSrc || resolveSrc(zoom.imageKey)}
          context={zoom.from}
          canUseAsBack={zoom.from === "unassigned" && !hasBack}
          canEdit={
            // EXISTING markers have no real raw blob to refine.
            !zoom.imageKey.startsWith("EXISTING:")
          }
          shape={shape}
          cornerRadiusPercent={cornerRadiusPercent}
          onBack={() => setZoom(null)}
          onEdit={() => {
            const ctx = zoom;
            setZoom(null);
            setEditing({ imageKey: ctx.imageKey, previousZoom: ctx });
          }}
          onPickCard={() => {
            const ctx = zoom;
            setZoom(null);
            setPicker({ imageKey: ctx.imageKey, previousZoom: ctx });
          }}
          onReassign={() => {
            const ctx = zoom;
            setZoom(null);
            setPicker({ imageKey: ctx.imageKey, previousZoom: ctx });
          }}
          onUseAsBack={() => {
            const ctx = zoom;
            onAssign(ctx.imageKey, "BACK");
            setZoom(null);
            const postUn = unassignedKeys.length - 1;
            autoSwitch("unassigned", numericAssigned.length, postUn, skippedKeys.length);
          }}
          onSkip={() => {
            const ctx = zoom;
            onSkip(ctx.imageKey);
            setZoom(null);
            const postUn = unassignedKeys.length - 1;
            autoSwitch("unassigned", numericAssigned.length, postUn, skippedKeys.length + 1);
          }}
          onSendBackToUnassigned={() => {
            const ctx = zoom;
            if (ctx.from === "assigned" && ctx.slot) {
              onUnassign(ctx.slot);
              const postAs = numericAssigned.length - 1;
              autoSwitch("assigned", postAs, unassignedKeys.length + 1, skippedKeys.length);
            } else if (ctx.from === "skipped") {
              onUnskip(ctx.imageKey);
              const postSk = skippedKeys.length - 1;
              autoSwitch("skipped", numericAssigned.length, unassignedKeys.length + 1, postSk);
            }
            setZoom(null);
          }}
        />
      )}

      {/* Card-back picker modal (BL Fix 4 banner tap) */}
      {showBackPicker && (
        <CardBackPickerModal
          unassignedKeys={unassignedKeys}
          resolveSrc={resolveSrc}
          onPick={(k) => {
            onAssign(k, "BACK");
            setShowBackPicker(false);
          }}
          onCancel={() => setShowBackPicker(false)}
        />
      )}

      {/* Save confirmation dialog (BL Fix 6) */}
      {saveDialog && (
        <SaveConfirmDialog
          info={saveDialog}
          onCancel={() => setSaveDialog(null)}
          onSaveAndFinish={() => {
            setSaveDialog(null);
            onSave(true);
          }}
          onSaveContinueLater={() => {
            setSaveDialog(null);
            onSave(false);
          }}
        />
      )}

      {/* BN Fix 1 — Edit / 4-corner crop refine overlay */}
      {editing && (() => {
        const img = findImage(session, editing.imageKey);
        if (!img || img.existingUrl) {
          // Can't refine an EXISTING:* synthetic — close.
          setEditing(null);
          return null;
        }
        const ctx = editing;
        return (
          <div className="fixed inset-0 z-[140]">
            <PhotoCapture
              shape={shape === "round" ? "round" : "rectangle"}
              cornerRadiusPercent={cornerRadiusPercent}
              outputMaxDimension={1536}
              initialBlob={img.rawBlob}
              guideText="Drag the corners to refine the crop"
              onCancel={() => {
                setEditing(null);
                setZoom(ctx.previousZoom);
              }}
              onCapture={(blob, dims) => {
                onUpdateRawBlob(ctx.imageKey, blob, dims);
                setEditing(null);
                setZoom(ctx.previousZoom);
              }}
            />
          </div>
        );
      })()}

      {/* BN Fix 2 — inline picker for assigning to a default slot */}
      {defaultPickerCardId !== null && (
        <CardBackPickerModal
          unassignedKeys={unassignedKeys}
          resolveSrc={resolveSrc}
          onPick={(k) => {
            const cardId = defaultPickerCardId;
            setDefaultPickerCardId(null);
            if (cardId !== null) onAssign(k, cardId);
          }}
          onCancel={() => setDefaultPickerCardId(null)}
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
        color: active ? "var(--accent-foreground)" : "var(--color-foreground)",
        borderColor: active ? "var(--accent)" : "var(--border-default)",
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
  variant,
  onAction,
}: {
  keys: string[];
  session: ImportSession;
  resolveSrc: (key: string) => string;
  emptyText: string;
  onClick: (key: string) => void;
  variant?: "unassigned" | "skipped";
  onAction?: (key: string) => void;
}) {
  if (keys.length === 0) {
    return (
      <p
        className="py-8 text-center italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.85,
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
          <div key={key} className="relative">
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
            {variant === "skipped" && onAction && (
              <ThumbnailIconButton
                aria-label="Move back to unassigned"
                title="Move back to unassigned"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(key);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </ThumbnailIconButton>
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
  hasBack,
  onTap,
  onUnassign,
}: {
  session: ImportSession;
  resolveSrc: (key: string) => string;
  hasBack: boolean;
  onTap: (slot: string, key: string) => void;
  onUnassign: (slot: string) => void;
}) {
  const backKey = session.assigned[BACK_KEY];
  const backSrc = backKey ? resolveSrc(backKey) : "";
  // BX — sub-filter by suit. Standard tarot ordering:
  // Majors 0-21, Wands 22-35, Cups 36-49, Swords 50-63, Pentacles 64-77.
  type SuitFilter = "all" | "major" | "wands" | "cups" | "swords" | "pentacles";
  const [suitFilter, setSuitFilter] = useState<SuitFilter>("all");
  const inFilter = (i: number): boolean => {
    switch (suitFilter) {
      case "all": return true;
      case "major": return i >= 0 && i <= 21;
      case "wands": return i >= 22 && i <= 35;
      case "cups": return i >= 36 && i <= 49;
      case "swords": return i >= 50 && i <= 63;
      case "pentacles": return i >= 64 && i <= 77;
    }
  };
  const SUIT_CHIPS: { id: SuitFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "major", label: "Majors" },
    { id: "wands", label: "Wands" },
    { id: "cups", label: "Cups" },
    { id: "swords", label: "Swords" },
    { id: "pentacles", label: "Pentacles" },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {SUIT_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={suitFilter === c.id}
            onClick={() => setSuitFilter(c.id)}
          >
            {c.label}
          </Chip>
        ))}
      </div>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {suitFilter === "all" && hasBack && backKey && (
        <div className="relative">
          <button
            type="button"
            onClick={() => onTap(BACK_KEY, backKey)}
            className="relative block aspect-[0.625] w-full overflow-hidden rounded border"
            style={{
              borderColor: "var(--accent)",
              background: "var(--surface-card)",
            }}
            title="Card Back — tap to view"
          >
            {backSrc && (
              <img src={backSrc} alt="Card Back" className="h-full w-full object-cover" />
            )}
            <span
              className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-center text-[9px] uppercase tracking-wider"
              style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
            >
              Card Back
            </span>
          </button>
          <ThumbnailIconButton
            aria-label="Unassign card back"
            title="Unassign"
            onClick={(e) => {
              e.stopPropagation();
              onUnassign(BACK_KEY);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </ThumbnailIconButton>
        </div>
      )}
      {Array.from({ length: 78 }, (_, i) => {
        if (!inFilter(i)) return null;
        const slot = String(i);
        const key = session.assigned[slot];
        const src = key ? resolveSrc(key) : "";
        const isExisting = key?.startsWith("EXISTING:");
        return (
          <div key={i} className="relative">
            <button
              type="button"
              onClick={() => key && onTap(slot, key)}
              disabled={!key}
              className="relative block aspect-[0.625] w-full overflow-hidden rounded border"
              style={{
                borderColor: key ? "var(--accent)" : "var(--border-subtle)",
                background: "var(--surface-card)",
              }}
              title={getCardName(i)}
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
            {key && (
              <ThumbnailIconButton
                aria-label={`Unassign ${getCardName(i)}`}
                title="Unassign"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnassign(slot);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </ThumbnailIconButton>
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}

/** Small overlay icon button shown in the top-right of a thumbnail. */
function ThumbnailIconButton({
  children,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-1 top-1 flex items-center justify-center rounded-full border"
      style={{
        width: 28,
        height: 28,
        background: "color-mix(in oklab, var(--surface-card) 85%, transparent)",
        borderColor: "var(--border-subtle)",
        color: "var(--color-foreground)",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function CardBackPickerModal({
  unassignedKeys,
  resolveSrc,
  onPick,
  onCancel,
}: {
  unassignedKeys: string[];
  resolveSrc: (key: string) => string;
  onPick: (key: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay, rgba(0,0,0,0.85))" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 rounded-xl border p-4"
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <h3
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-sm)",
            color: "var(--color-foreground)",
          }}
        >
          Pick a card back
        </h3>
        <div className="flex-1 overflow-y-auto">
          {unassignedKeys.length === 0 ? (
            <p
              className="italic"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground)",
                opacity: 0.7,
              }}
            >
              No unassigned images to choose from.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {unassignedKeys.map((k) => {
                const src = resolveSrc(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onPick(k)}
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
        <button
          type="button"
          onClick={onCancel}
          className="self-end rounded-md px-4 py-2"
          style={{
            color: "var(--color-foreground)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SaveConfirmDialog({
  info,
  onCancel,
  onSaveAndFinish,
  onSaveContinueLater,
}: {
  info: {
    kind: "empty" | "skipped-only" | "unassigned-present" | "skipped-and-unassigned";
    skippedCount: number;
    unassignedCount: number;
  };
  onCancel: () => void;
  onSaveAndFinish: () => void;
  onSaveContinueLater: () => void;
}) {
  let title = "Save";
  let body = "";
  let showContinueLater = false;

  if (info.kind === "empty") {
    title = "Save?";
    body = "Nothing assigned yet. Save anyway?";
  } else if (info.kind === "skipped-only") {
    title = "Save?";
    body = `${info.skippedCount} image${info.skippedCount === 1 ? "" : "s"} skipped will be discarded. Save?`;
  } else if (info.kind === "unassigned-present") {
    title = "Some images aren't placed yet";
    body = `${info.unassignedCount} image${info.unassignedCount === 1 ? "" : "s"} still unassigned. Keep them for later or discard?`;
    showContinueLater = true;
  } else if (info.kind === "skipped-and-unassigned") {
    title = "Some images aren't placed yet";
    body = `${info.unassignedCount} unassigned and ${info.skippedCount} skipped. Continue later or finish now?`;
    showContinueLater = true;
  }

  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay, rgba(0,0,0,0.85))" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border p-5"
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <h3
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-sm)",
            color: "var(--color-foreground)",
          }}
        >
          {title}
        </h3>
        <p style={{ fontSize: "var(--text-body-sm)", color: "var(--color-foreground)" }}>
          {body}
        </p>
        <div className="flex flex-col gap-2">
          {showContinueLater && (
            <button
              type="button"
              onClick={onSaveContinueLater}
              className="rounded-md px-4 py-2 font-medium"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground, #000)",
                fontSize: "var(--text-body-sm)",
              }}
            >
              Save and continue later
            </button>
          )}
          <button
            type="button"
            onClick={onSaveAndFinish}
            className="rounded-md px-4 py-2 font-medium"
            style={{
              background: showContinueLater
                ? "transparent"
                : "var(--accent)",
              color: showContinueLater
                ? "var(--color-foreground)"
                : "var(--accent-foreground, #000)",
              fontSize: "var(--text-body-sm)",
              borderWidth: showContinueLater ? 1 : 0,
              borderStyle: "solid",
              borderColor: "var(--border-subtle)",
            }}
          >
            {showContinueLater ? "Save and finish" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2"
            style={{
              color: "var(--color-foreground)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ZoomModal({
  src,
  context,
  canUseAsBack,
  canEdit,
  shape,
  cornerRadiusPercent,
  onPickCard,
  onReassign,
  onUseAsBack,
  onSkip,
  onBack,
  onEdit,
  onSendBackToUnassigned,
}: {
  src: string;
  context: "unassigned" | "assigned" | "skipped";
  canUseAsBack: boolean;
  canEdit: boolean;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  onPickCard: () => void;
  onReassign: () => void;
  onUseAsBack: () => void;
  onSkip: () => void;
  onBack: () => void;
  onEdit: () => void;
  onSendBackToUnassigned: () => void;
}) {
  const imgStyle: React.CSSProperties =
    shape === "round"
      ? {
          clipPath: "circle(50%)",
          width: "100%",
          height: "auto",
          maxHeight: "70vh",
          objectFit: "contain",
          display: "block",
        }
      : {
          width: "100%",
          height: "auto",
          maxHeight: "70vh",
          objectFit: "contain",
          display: "block",
          borderRadius: `${(cornerRadiusPercent / 100) * 200}px`,
        };
  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center p-4"
      style={{ background: "var(--surface-overlay, rgba(0,0,0,0.85))" }}
      onClick={onBack}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(85vw, 600px)",
          maxWidth: "min(85vw, 600px)",
          maxHeight: "70vh",
        }}
      >
        <img src={src} alt="" style={imgStyle} />
      </div>
      <div
        className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row sm:flex-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        {context === "unassigned" && (
          <>
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
              Assign to a card
            </button>
            {canUseAsBack && (
              <button
                type="button"
                onClick={onUseAsBack}
                className="rounded-md border px-4 py-2"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--color-foreground)",
                  fontSize: "var(--text-body-sm)",
                }}
              >
                Use as card back
              </button>
            )}
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-4 py-2"
              style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
            >
              Skip
            </button>
          </>
        )}
        {context === "assigned" && (
          <>
            <button
              type="button"
              onClick={onReassign}
              className="rounded-md px-4 py-2 font-medium"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground, #000)",
                fontSize: "var(--text-body-sm)",
              }}
            >
              Reassign to different card
            </button>
            <button
              type="button"
              onClick={onSendBackToUnassigned}
              className="rounded-md px-4 py-2"
              style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
            >
              Send back to unassigned
            </button>
          </>
        )}
        {context === "skipped" && (
          <>
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
              Assign to a card
            </button>
            <button
              type="button"
              onClick={onSendBackToUnassigned}
              className="rounded-md px-4 py-2"
              style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
            >
              Send back to unassigned
            </button>
          </>
        )}
        {/* BN Fix 1 — Edit / 4-corner crop refine */}
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border px-4 py-2"
            style={{
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "var(--accent-foreground)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-4 py-2"
          style={{ color: "var(--color-foreground)", fontSize: "var(--text-body-sm)" }}
        >
          Back
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

/* ================================================================== */
/*  DefaultGrid — BN Fix 2 (Default chip view)                         */
/* ================================================================== */

function DefaultGrid({
  customizedCardIds,
  session,
  resolveSrc,
  defaultCount,
  onPickDefault,
}: {
  customizedCardIds: Set<number>;
  session: ImportSession;
  resolveSrc: (key: string) => string;
  defaultCount: number;
  onPickDefault: (cardId: number) => void;
}) {
  return (
    <div>
      <p
        className="mb-3"
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.85,
        }}
      >
        {defaultCount} card{defaultCount === 1 ? "" : "s"} will use the default
        image after save. Tap a card to assign one of your images.
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 78 }, (_, i) => {
          const customized = customizedCardIds.has(i);
          const key = customized ? session.assigned[String(i)] : undefined;
          const src = key ? resolveSrc(key) : "";
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (!customized) onPickDefault(i);
              }}
              disabled={customized}
              className="relative block aspect-[0.625] w-full overflow-hidden rounded border"
              style={{
                borderColor: customized ? "var(--accent)" : "var(--border-subtle)",
                background: "var(--surface-card)",
              }}
              title={getCardName(i)}
            >
              {customized && src ? (
                <img
                  src={src}
                  alt={getCardName(i)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={getCardImagePath(i)}
                  alt={getCardName(i)}
                  className="h-full w-full object-cover"
                  style={{ opacity: 0.65 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
