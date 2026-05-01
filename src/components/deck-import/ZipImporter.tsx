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
 *   3. Per-card autosave (Phase CB) — every assignment writes
 *      immediately via per-card-save; no batch commit step.
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
  entryMode = "import",
  initialPhase,
  deckName,
}: {
  userId: string;
  deckId: string;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  existingBackUrl?: string | null;
  onCancel: () => void;
  onDone: () => void;
  /** CC G5 — "import" (zip workflow w/ snapshot+discard) or "edit"
   *  (no snapshot, edit-deck workspace). */
  entryMode?: "import" | "edit";
  /** CC G2 — when set to "upload", force the workspace to land on the
   *  upload phase even if the deck already has saved cards. Used by
   *  the "Import / replace from zip" entry from My Decks. */
  initialPhase?: "upload" | "workspace";
  /** CC G5 — used as the workspace title in edit mode. */
  deckName?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const queueRef = useRef<EncodingQueue>(new EncodingQueue());
  const saverRef = useRef(makeThrottledSaver(deckId));
  const confirm = useConfirm();

  // CB — per-slot save state map. Slot key matches session.assigned keys
  // ("0".."77" or "BACK"). Missing entry = clean/empty.
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  // CB — top-right status indicator state (idle / saving / brief saved).
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const inflightRef = useRef(0);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreProgressRef = useRef<{ done: number; total: number }>({ done: 0, total: 0 });

  const setSlotState = useCallback(
    (slot: string, next: CardState | null) => {
      setCardStates((prev) => {
        const copy = { ...prev };
        if (next === null) delete copy[slot];
        else copy[slot] = next;
        return copy;
      });
    },
    [],
  );

  const beginSave = useCallback(() => {
    inflightRef.current++;
    setStatus({ kind: "saving" });
    if (savedFlashTimer.current) {
      clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = null;
    }
  }, []);

  const endSave = useCallback(() => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);
    if (inflightRef.current === 0) {
      const until = Date.now() + 2000;
      setStatus({ kind: "saved-flash", until });
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = setTimeout(() => {
        setStatus({ kind: "idle" });
        savedFlashTimer.current = null;
      }, 2000);
    }
  }, []);

  // Bootstrap: check for existing session OR existing deck rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // CC G2 — "Import / replace from zip" entry forces the upload
        // phase even when a deck already has saved cards. The user
        // explicitly asked for the file-picker flow.
        if (initialPhase === "upload") {
          // Still hydrate cardStates from existing rows so the workspace
          // (after they pick a zip) shows them as 'saved'.
          try {
            const existingCards = await fetchDeckCards(deckId);
            if (cancelled) return;
            const seeded: Record<string, CardState> = {};
            for (const c of existingCards) seeded[String(c.card_id)] = "saved";
            if (Object.keys(seeded).length > 0) setCardStates(seeded);
          } catch {
            /* non-fatal */
          }
          setPhase({ kind: "upload", resumable: false });
          return;
        }
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
        if (existingCards.length > 0 || entryMode === "edit") {
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
          // CB — seed states + snapshot for existing rows.
          const seeded: Record<string, CardState> = {};
          for (const c of existingCards) seeded[String(c.card_id)] = "saved";
          setCardStates(seeded);
          // CC G5 — snapshots are only meaningful in import mode (the
          // user can roll back). Edit mode treats every save as the
          // source of truth.
          if (entryMode === "import") {
            void captureSnapshotIfMissing(deckId).catch((e) =>
              console.warn("[CB] snapshot capture failed", e),
            );
          }
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
  }, [deckId, entryMode, initialPhase]);

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
      // CB — capture snapshot of current deck state before any autosave
      // writes happen, so Discard can roll back. CC G5 — only in import
      // mode; edit mode has no rollback semantics.
      if (entryMode === "import") {
        void captureSnapshotIfMissing(deckId).catch((e) =>
          console.warn("[CB] snapshot capture failed", e),
        );
      }
      setWorkspace({ session });
      setPhase({ kind: "workspace" });
      // CB — autosave the auto-matched assignments from the zip.
      for (const [slot, key] of Object.entries(session.assigned)) {
        const img = findImage(session, key);
        if (!img || img.existingUrl) continue;
        void runSave(slot, img, key);
      }
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
  }, [deckId, shape, cornerRadiusPercent, entryMode]);

  /* ---------- Mutators ---------- */
  /**
   * CB — Per-card autosave runner. Looks up the image for the slot in
   * the latest workspace session and calls saveCard. Updates the
   * per-slot state map and the global status indicator. Skips
   * EXISTING:* markers (already saved on the deck).
   */
  const runSave = useCallback(
    async (slot: string, image: ImportImage, cardKey: string) => {
      const cardId: number | "BACK" = slot === BACK_KEY ? "BACK" : Number(slot);
      setSlotState(slot, "saving");
      beginSave();
      try {
        const res = await saveCard({
          userId,
          deckId,
          cardId,
          cardKey,
          image,
          opts: { shape, cornerRadiusPercent },
        });
        setSlotState(slot, res.status === "saved" ? "saved" : "failed");
      } catch (err) {
        console.error("[CB-save] runSave threw", err);
        setSlotState(slot, "failed");
      } finally {
        endSave();
      }
    },
    [userId, deckId, shape, cornerRadiusPercent, beginSave, endSave, setSlotState],
  );

  /** CB — remove a slot's active row in Supabase (un-assign). */
  const runRemove = useCallback(
    async (slot: string, cardKey: string) => {
      const cardId: number | "BACK" = slot === BACK_KEY ? "BACK" : Number(slot);
      beginSave();
      try {
        const res = await removeCard({ deckId, cardId, cardKey });
        if (res.status === "saved") setSlotState(slot, null);
        else setSlotState(slot, "failed");
      } finally {
        endSave();
      }
    },
    [deckId, beginSave, endSave, setSlotState],
  );

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
    let displacedSlot: string | null = null;
    let displacedKey: string | null = null;
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
      // Remove imageKey from any other slot it may have occupied. Track
      // it so the autosave below can also clear that slot in Supabase.
      for (const k of Object.keys(s.assigned)) {
        if (s.assigned[k] === imageKey && k !== slot) {
          displacedSlot = k;
          displacedKey = imageKey;
          delete s.assigned[k];
        }
      }
      s.assigned[slot] = imageKey;
      // Stash in shadow asset store so findImage() can still locate it
      // after it's been removed from unassigned/skipped.
      ensureAssetStore(s)[imageKey] = sourceImg;
    });
    // CB — autosave the new assignment. Skip EXISTING:* (already saved).
    if (!imageKey.startsWith("EXISTING:")) {
      // Read latest state inside an updater to ensure we have the image.
      setWorkspace((cur) => {
        if (!cur) return cur;
        const img = findImage(cur.session, imageKey);
        if (img) void runSave(slot, img, imageKey);
        return cur;
      });
    }
    // CB — if we displaced an image from another slot, archive that
    // slot's row in Supabase too.
    if (displacedSlot && displacedKey) {
      void runRemove(displacedSlot, displacedKey);
    }
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
  }, [mutate, shape, cornerRadiusPercent, runSave, runRemove]);

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
    let removedKey: string | null = null;
    mutate((s) => {
      const imageKey = s.assigned[slot];
      if (!imageKey) return;
      removedKey = imageKey;
      delete s.assigned[slot];
      const img = findImage(s, imageKey);
      if (img && !imageKey.startsWith("EXISTING:")) {
        s.unassigned[imageKey] = img;
      }
    });
    if (removedKey) {
      void runRemove(slot, removedKey);
    }
  }, [mutate, runRemove]);

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

  /** CB — retry a single failed slot. Re-reads the image from the
   *  latest session and re-fires saveCard. */
  const handleRetrySlot = useCallback(
    (slot: string) => {
      setWorkspace((cur) => {
        if (!cur) return cur;
        const key = cur.session.assigned[slot];
        if (!key || key.startsWith("EXISTING:")) return cur;
        const img = findImage(cur.session, key);
        if (!img) return cur;
        void runSave(slot, img, key);
        return cur;
      });
    },
    [runSave],
  );

  /** CB — retry every slot currently in 'failed' state. */
  const handleRetryAllFailed = useCallback(() => {
    setWorkspace((cur) => {
      if (!cur) return cur;
      for (const [slot, st] of Object.entries(cardStates)) {
        if (st !== "failed") continue;
        const key = cur.session.assigned[slot];
        if (!key || key.startsWith("EXISTING:")) continue;
        const img = findImage(cur.session, key);
        if (!img) continue;
        void runSave(slot, img, key);
      }
      return cur;
    });
  }, [cardStates, runSave]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  /**
   * CB — Discard import now means "roll back". Per-card autosave has
   * already written assignments to Supabase, so the snapshot we took on
   * workspace entry is the only path back to the original deck state.
   */
  const handleDiscard = useCallback(async () => {
    const ok = await confirm({
      title: "Discard this import?",
      description:
        "Your previously-saved deck will be restored. Any cards you assigned in this session will be reverted.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      destructive: true,
    });
    if (!ok) return;
    const snap = await getSnapshot(deckId);
    if (!snap) {
      // No snapshot — fall back to the old behavior (just clear session).
      await deleteSession(deckId);
      setCardStates({});
      setWorkspace(null);
      setPhase({ kind: "upload", resumable: false });
      onDone();
      return;
    }
    setStatus({ kind: "saving" });
    setPhase({ kind: "restoring", done: 0, total: 79 });
    try {
      await restoreSnapshot({
        userId,
        deckId,
        snapshot: snap,
        onProgress: (done, total) => {
          restoreProgressRef.current = { done, total };
          setPhase({ kind: "restoring", done, total });
        },
      });
      await deleteSnapshot(deckId);
      await deleteSession(deckId);
      setCardStates({});
      setWorkspace(null);
      // Brief saved-flash so user sees confirmation, then exit.
      const until = Date.now() + 1500;
      setStatus({ kind: "saved-flash", until });
      setTimeout(() => setStatus({ kind: "idle" }), 1500);
      onDone();
    } catch (err) {
      console.error("[CB-restore] failed", err);
      toast.error("Couldn't restore your previous deck. Try again.");
      setPhase({ kind: "workspace" });
      setStatus({ kind: "idle" });
    }
  }, [deckId, userId, confirm, onDone]);

  /** CB — close cleanly, preserving session for resume but consuming
   *  the snapshot so a future Discard doesn't roll back to a stale
   *  state. */
  const handleCleanClose = useCallback(async () => {
    await deleteSnapshot(deckId);
    onCancel();
  }, [deckId, onCancel]);

  /* ---------- Renders ---------- */
  const failedCount = useMemo(
    () => Object.values(cardStates).filter((s) => s === "failed").length,
    [cardStates],
  );
  let body: React.ReactNode;
  if (phase.kind === "loading") body = <Centered text="Checking for saved progress…" />;
  else if (phase.kind === "upload")
    body = (
      <UploadStep
        onFile={handleFile}
        onCancel={handleCancel}
        showReplaceNotice={entryMode === "import" && Object.keys(cardStates).length > 0}
      />
    );
  else if (phase.kind === "extracting") body = <Centered text="Reading your zip…" />;
  else if (phase.kind === "restoring")
    body = <Centered text={`Restoring previous deck… ${phase.done}/${phase.total}`} />;
  else if (!workspace) body = <Centered text="Loading…" />;
  else
    body = (
      <Workspace
        session={workspace.session}
        onAssign={handleAssign}
        onSkip={handleSkip}
        onUnskip={handleUnskip}
        onUnassign={handleUnassign}
        onUpdateRawBlob={handleUpdateRawBlob}
        onCancel={handleCleanClose}
        onDiscard={handleDiscard}
        shape={shape}
        cornerRadiusPercent={cornerRadiusPercent}
        existingBackUrl={existingBackUrl ?? null}
        cardStates={cardStates}
        status={status}
        failedCount={failedCount}
        onRetrySlot={handleRetrySlot}
        onRetryAllFailed={handleRetryAllFailed}
        entryMode={entryMode}
        deckName={deckName ?? null}
        onSwitchToUpload={() => setPhase({ kind: "upload", resumable: false })}
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
  showReplaceNotice = false,
}: {
  onFile: (file: File) => void;
  onCancel: () => void;
  showReplaceNotice?: boolean;
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
        {showReplaceNotice && (
          <p
            className="mb-3 italic"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              color: "var(--accent)",
              opacity: 0.95,
            }}
          >
            Replacing existing deck. Discard import to revert.
          </p>
        )}
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
  onCancel,
  onDiscard,
  shape,
  cornerRadiusPercent,
  existingBackUrl,
  cardStates,
  status,
  failedCount,
  onRetrySlot,
  onRetryAllFailed,
  entryMode,
  deckName,
  onSwitchToUpload,
}: {
  session: ImportSession;
  onAssign: (imageKey: string, cardId: number | "BACK") => void;
  onSkip: (imageKey: string) => void;
  onUnskip: (imageKey: string) => void;
  onUnassign: (slot: string) => void;
  onUpdateRawBlob: (imageKey: string, blob: Blob, dims: { width: number; height: number }) => void;
  onCancel: () => void;
  onDiscard: () => void;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  existingBackUrl?: string | null;
  cardStates: Record<string, CardState>;
  status: SaveStatus;
  failedCount: number;
  onRetrySlot: (slot: string) => void;
  onRetryAllFailed: () => void;
  entryMode: "import" | "edit";
  deckName: string | null;
  onSwitchToUpload: () => void;
}) {
  const [tab, setTab] = useState<Tab>(entryMode === "edit" ? "assigned" : "unassigned");
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
  // CB — saveDialog removed; per-card autosave eliminates the batch save flow.

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

  // CC G3 — Real-time counter derived from the per-card state map.
  // BACK_KEY is a separate field on the deck record, not a card —
  // exclude it from numerator AND denominator. Denominator is always 78.
  const savedCount = useMemo(() => {
    let n = 0;
    for (const [slot, st] of Object.entries(cardStates)) {
      if (slot === BACK_KEY) continue;
      if (st === "saved") n += 1;
    }
    // Edit-mode: any assigned slot that hasn't been touched this session
    // is also "saved" on the deck (EXISTING:* markers). Count those too
    // when there's no per-slot state yet.
    for (const slot of numericAssigned) {
      if (cardStates[slot] === undefined) n += 1;
    }
    return Math.min(78, n);
  }, [cardStates, numericAssigned]);

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

  // CB — batch Save handler removed. Per-card autosave handles writes
  // continuously; the workspace footer now exposes Discard + Close only.

  return (
    <section className="py-4">
      {/* CC G1 — Sticky workspace header. Title + status indicator on
          row 1, counter on row 2, tab chips on row 3. Stays visible
          while the card grid scrolls. */}
      <div
        className="mb-3"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "var(--color-background)",
          paddingTop: "var(--space-2, 0.5rem)",
          paddingBottom: "var(--space-2, 0.5rem)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2
            className="italic"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-heading-md)",
              color: "var(--color-foreground)",
            }}
          >
            {entryMode === "edit"
              ? deckName?.trim() || "Edit deck"
              : "Import workspace"}
          </h2>
          <div className="ml-auto">
            <SaveStatusIndicator
              status={status}
              failedCount={failedCount}
              onRetryAllFailed={onRetryAllFailed}
            />
          </div>
        </div>
        <div
          className="mt-1"
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.85,
          }}
        >
          <span>
            {savedCount}/78 cards · {hasBack ? "back set" : "no back"} ·{" "}
          </span>
          {failedCount > 0 ? (
            <span style={{ color: "#ef4444" }}>{failedCount} failed</span>
          ) : (
            <span>{skippedKeys.length} skipped</span>
          )}
        </div>

        {/* Tab chips — hidden in edit mode (Assigned only). */}
        {entryMode === "import" ? (
          <HorizontalScroll
            className="mt-3"
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
        ) : null}
      </div>

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
          cardStates={cardStates}
          onRetrySlot={onRetrySlot}
          entryMode={entryMode}
          unassignedAvailable={unassignedKeys.length > 0}
          onTapEmpty={(cardId) => {
            if (unassignedKeys.length > 0) {
              setDefaultPickerCardId(cardId);
            } else {
              // No staged images — offer to import a zip.
              onSwitchToUpload();
            }
          }}
          onImportZip={onSwitchToUpload}
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

      {/* CC G1/G5 — Footer: Discard (import only) on the left,
          Done on the right. Status indicator now lives at the top. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {entryMode === "import" && (
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
        )}
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-md px-4 py-2 font-medium"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground, #000)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Done
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

      {/* CB — batch SaveConfirmDialog removed; autosave handles writes. */}

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
  cardStates,
  onRetrySlot,
  entryMode,
  unassignedAvailable,
  onTapEmpty,
  onImportZip,
}: {
  session: ImportSession;
  resolveSrc: (key: string) => string;
  hasBack: boolean;
  onTap: (slot: string, key: string) => void;
  onUnassign: (slot: string) => void;
  cardStates: Record<string, CardState>;
  onRetrySlot: (slot: string) => void;
  entryMode: "import" | "edit";
  onTapEmpty: (cardId: number) => void;
  onImportZip: () => void;
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
    { id: "major", label: "Major" },
    { id: "wands", label: "Wands" },
    { id: "cups", label: "Cups" },
    { id: "swords", label: "Swords" },
    { id: "pentacles", label: "Pentacles" },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {SUIT_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={suitFilter === c.id}
            onClick={() =>
              // CC G4 — tapping the active chip clears back to "all".
              setSuitFilter((prev) => (prev === c.id ? "all" : c.id))
            }
          >
            {c.label}
          </Chip>
        ))}
        {entryMode === "edit" && (
          <button
            type="button"
            onClick={onImportZip}
            className="ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1.5 italic"
            style={{
              borderColor: "var(--border-default)",
              color: "var(--color-foreground)",
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              background: "transparent",
            }}
            title="Import / replace from zip"
          >
            <Upload className="h-3.5 w-3.5" /> Import / replace from zip
          </button>
        )}
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
        const slotState = cardStates[slot];
        const isFailed = slotState === "failed";
        const isSaving = slotState === "saving";
        return (
          <div key={i} className="relative">
            <button
              type="button"
              onClick={() => {
                if (!key) {
                  // CC G5 — empty slots are tappable. Open the per-slot
                  // assign action (or the import-zip flow if no images
                  // are staged yet).
                  onTapEmpty(i);
                  return;
                }
                if (isFailed) onRetrySlot(slot);
                else onTap(slot, key);
              }}
              aria-label={key ? getCardName(i) : `${getCardName(i)} — empty, tap to assign`}
              className="relative block aspect-[0.625] w-full overflow-hidden rounded border"
              style={{
                borderColor: isFailed
                  ? "#ef4444"
                  : key
                    ? "var(--accent)"
                    : "var(--border-subtle)",
                borderWidth: isFailed ? 2 : 1,
                background: "var(--surface-card)",
              }}
              title={isFailed ? `${getCardName(i)} — tap to retry save` : getCardName(i)}
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
              {isSaving && (
                <span className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.30)" }}>
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#fff" }} />
                </span>
              )}
              {isFailed && (
                <span
                  className="absolute right-1 bottom-1 inline-flex items-center justify-center rounded-full"
                  style={{ width: 18, height: 18, background: "#ef4444", color: "#fff" }}
                  aria-label="Save failed"
                >
                  <AlertTriangle className="h-3 w-3" />
                </span>
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

/**
 * CB — Linear-style save status indicator. Quiet by default, shows
 * "Saving…" while a write is in flight, "✓ Saved" for ~2s after the
 * last write, and a persistent "⚠ N failed — Retry" pill when any
 * slot is in failed state.
 */
function SaveStatusIndicator({
  status,
  failedCount,
  onRetryAllFailed,
}: {
  status: SaveStatus;
  failedCount: number;
  onRetryAllFailed: () => void;
}) {
  if (failedCount > 0) {
    return (
      <span
        className="inline-flex items-center gap-2"
        style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-body-sm)" }}
      >
        <AlertTriangle className="h-4 w-4" style={{ color: "#ef4444" }} />
        <span style={{ color: "#ef4444" }}>{failedCount} failed</span>
        <button
          type="button"
          onClick={onRetryAllFailed}
          className="underline italic"
          style={{ color: "var(--accent)" }}
        >
          Retry
        </button>
      </span>
    );
  }
  if (status.kind === "saving") {
    return (
      <span
        className="inline-flex items-center gap-2 italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.7,
        }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (status.kind === "saved-flash") {
    return (
      <span
        className="inline-flex items-center gap-2 italic transition-opacity"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
        }}
      >
        <Check className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} /> Saved
      </span>
    );
  }
  return null;
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
