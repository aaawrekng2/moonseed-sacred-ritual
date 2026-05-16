/**
 * Reading enrichment panel.
 *
 * Mounted inside the Reading Detail overlay. Lets the user enrich a saved
 * reading with a note, tags, photos, and a favorite toggle. All edits
 * persist via a single 800ms debounced auto-save (see {@link useDebouncedSave}).
 *
 * Loading states are intentionally subtle — a tiny dot/text indicator near
 * each section rather than blocking spinners, so the panel still feels like
 * "a gentle invitation, not a form" (per the Phase 6 spec).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Check, CheckCheck, Copy, Heart, Loader2, Network, Pencil, Plus, Share2, StickyNote, Tag as TagIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/compress-image";
import { uploadWithQuota } from "@/lib/storage-upload";
import { Link, useNavigate } from "@tanstack/react-router";
import { HelpIcon } from "@/components/help/HelpIcon";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import { LoadingText } from "@/components/ui/loading-text";
import { JournalPrompts } from "@/components/tarot/JournalPrompts";
import { resolvePromptsForFirstCard } from "@/lib/journal-prompts/resolve";
import { useServerFn } from "@tanstack/react-start";
import { generateTailoredPrompt } from "@/lib/tailored-prompt.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { PhotoCapture } from "@/components/photo/PhotoCapture";
import { useConfirm } from "@/hooks/use-confirm";

/* ---------- Types ---------- */

export type EnrichmentReading = {
  id: string;
  user_id: string;
  note: string | null;
  is_favorite: boolean;
  tags: string[] | null;
};

export type EnrichmentTag = { id: string; name: string; usage_count: number };

export type EnrichmentPhoto = {
  id: string;
  storage_path: string;
  caption: string | null;
  created_at: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  reading: EnrichmentReading;
  tagLibrary: EnrichmentTag[];
  isOracle: boolean;
  /**
   * Called whenever the local view of the reading changes. The parent uses this
   * to keep the Journal list in sync without re-fetching.
   */
  onReadingChange: (next: EnrichmentReading) => void;
  /**
   * Called whenever the tag library changes (a new tag was inserted, or
   * usage_count was updated). Parent re-syncs its tag strip.
   */
  onTagLibraryChange: (next: EnrichmentTag[]) => void;
  /**
   * Called when photos are added/removed. Parent uses this to refresh the
   * gallery view's photo counts.
   */
  onPhotoCountChange: (readingId: string, count: number) => void;
  /**
   * Optional plaintext rendering of the reading's interpretation. When
   * provided, a Copy icon renders alongside the other enrichment icons
   * and writes this text to the clipboard on tap.
   */
  copyText?: string;
  /**
   * Optional handler invoked when the seeker taps the share icon. When
   * provided, a Share2 icon renders alongside the other action icons —
   * this is the single share trigger per screen (opens the ShareBuilder).
   * Omit to hide the icon entirely.
   */
  onShare?: () => void;
  /**
   * 26-05-08-Q12 — When true, the note section is open by default
   * (used in the journal detail view, where notes should be visible
   * without an extra tap).
   */
  defaultNoteOpen?: boolean;
  /**
   * 26-05-08-Q12 — Reading context used by the JournalPrompts panel.
   * When present, the panel renders curated journaling prompts above
   * the note textarea using the FIRST card's prompts.
   */
  cardIds?: number[];
  /** Optional per-card prompts for oracle decks, keyed by card_id. */
  customCardPromptsByCardId?: Record<number, string[] | null | undefined>;
  /** Cached tailored prompt for this reading (string) or null. */
  tailoredPrompt?: string | null;
  /** Seeker's question for this reading — required to enable tailored prompt. */
  question?: string | null;
  /** Called after the tailored prompt is generated so the parent can refresh. */
  onTailoredPromptUpdate?: (prompt: string) => void;
  /** Q14 Fix 5 — whether this reading already had a prompt inserted. */
  journalPromptUsed?: boolean;
  /** Called once the seeker inserts a prompt for the first time. */
  onJournalPromptUsed?: () => void;
};

const SAVE_DELAY_MS = 800;
const NOTE_SAVE_DELAY_MS = 3000;

// Photo upload limits — checked client-side before compression so we can
// give a friendly message instead of failing deep inside the canvas step.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_PHOTO_DIMENSION = 8000; // px on the longest edge

/**
 * Read an image's natural width/height without keeping it in memory.
 * Resolves to null if the file can't be decoded as an image.
 */
function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- Hook: debounced save ---------- */

function useDebouncedSave(delay: number = SAVE_DELAY_MS) {
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(0);

  const schedule = useCallback(
    (fn: () => Promise<void>) => {
      if (timer.current) clearTimeout(timer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      setState("saving");
      timer.current = setTimeout(() => {
        inflight.current += 1;
        const myTurn = inflight.current;
        void (async () => {
          try {
            await fn();
            // Only flip to "saved" if no newer save started while we were running.
            if (inflight.current === myTurn) {
              setState("saved");
              savedTimer.current = setTimeout(() => setState("idle"), 1500);
            }
          } catch {
            if (inflight.current === myTurn) setState("error");
          }
        })();
      }, delay);
    },
    [delay],
  );

  // Cleanup on unmount.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  return { state, schedule };
}

/* ---------- Component ---------- */

export function EnrichmentPanel({
  reading,
  tagLibrary,
  isOracle,
  onReadingChange,
  onTagLibraryChange,
  onPhotoCountChange,
  copyText,
  onShare,
  defaultNoteOpen,
  cardIds,
  customCardPromptsByCardId,
  tailoredPrompt: tailoredPromptProp,
  question,
  onTailoredPromptUpdate,
  journalPromptUsed,
  onJournalPromptUsed,
}: Props) {
  // Local mirrors of the reading fields so typing is responsive.
  const [note, setNote] = useState(reading.note ?? "");
  const [tags, setTags] = useState<string[]>(reading.tags ?? []);
  const [favorite, setFavorite] = useState(reading.is_favorite);
  // Q14 Fix 6 — transient gold checkmark flashed after Save tap.
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    },
    [],
  );

  // UI toggles for the inline editors.
  const [openSection, setOpenSection] = useState<
    "note" | "tags" | null
  >(defaultNoteOpen ? "note" : null);
  const [tagInput, setTagInput] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Q30 Fix B3 — auto-grow the note textarea so long notes never
  // gain an inner scrollbar.
  useLayoutEffect(() => {
    const ta = noteTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  });

  // Photos for this reading.
  const [photos, setPhotos] = useState<EnrichmentPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photosLoading, setPhotosLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Phase 9.5b — Stamp AQ. In-app PhotoCapture overlay for journal
  // photos. The hidden file input remains as a fallback for users on
  // desktops without a camera or who want to upload an existing image.
  const [cameraOpen, setCameraOpen] = useState(false);

  // 9-6-AD — fullscreen photo viewer + delete confirm.
  const [photoViewerSrc, setPhotoViewerSrc] = useState<string | null>(null);
  const confirm = useConfirm();

  // Copy-to-clipboard transient state for the inline copy icon.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const handleCopy = useCallback(async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop — clipboard may be blocked */
    }
  }, [copyText]);

  // Re-sync local state ONLY when the parent swaps to a different reading
  // row. Re-running this effect on every note/tag/favorite change closes
  // the open section out from under the user mid-edit (Phase 7 bug 7).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNote(reading.note ?? "");
    setTags(reading.tags ?? []);
    setFavorite(reading.is_favorite);
    setOpenSection(defaultNoteOpen ? "note" : null);
    setTagInput("");
  }, [reading.id]);

  // Load photos for this reading.
  useEffect(() => {
    let cancelled = false;
    setPhotosLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("reading_photos")
        .select("id,storage_path,caption,created_at")
        .eq("reading_id", reading.id)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        setPhotos([]);
        setPhotoUrls({});
        setPhotosLoading(false);
        return;
      }
      const rows = (data ?? []) as EnrichmentPhoto[];
      setPhotos(rows);
      // Sign URLs for each photo (bucket is private).
      const urls: Record<string, string> = {};
      await Promise.all(
        rows.map(async (p) => {
          const { data: signed } = await supabase.storage
            .from("reading-photos")
            .createSignedUrl(p.storage_path, 60 * 60);
          if (signed?.signedUrl) urls[p.id] = signed.signedUrl;
        }),
      );
      if (cancelled) return;
      setPhotoUrls(urls);
      setPhotosLoading(false);
      onPhotoCountChange(reading.id, rows.length);
    })();
    return () => {
      cancelled = true;
    };
    // onPhotoCountChange intentionally excluded — parent passes a stable cb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.id]);

  /* ---------- Save engines ---------- */

  const noteSave = useDebouncedSave();
  // Notes get a longer debounce so the auto-save indicator doesn't
  // flicker (and the textarea doesn't feel "judged") while the user
  // is mid-thought, especially on mobile.
  const noteSaveDebounced = useDebouncedSave(NOTE_SAVE_DELAY_MS);
  const tagsSave = useDebouncedSave();
  const favSave = useDebouncedSave(0); // immediate

  const persistNote = useCallback(
    (next: string) => {
      noteSaveDebounced.schedule(async () => {
        const { error } = await supabase
          .from("readings")
          .update({ note: next.length > 0 ? next : null })
          .eq("id", reading.id);
        if (error) throw error;
        onReadingChange({ ...reading, note: next.length > 0 ? next : null });
      });
    },
    [noteSaveDebounced, reading, onReadingChange],
  );

  const persistTags = useCallback(
    (next: string[]) => {
      tagsSave.schedule(async () => {
        const { error } = await supabase
          .from("readings")
          .update({ tags: next })
          .eq("id", reading.id);
        if (error) throw error;
        onReadingChange({ ...reading, tags: next });
      });
    },
    [tagsSave, reading, onReadingChange],
  );

  const persistFavorite = useCallback(
    (next: boolean) => {
      favSave.schedule(async () => {
        const { error } = await supabase
          .from("readings")
          .update({ is_favorite: next })
          .eq("id", reading.id);
        if (error) throw error;
        onReadingChange({ ...reading, is_favorite: next });
      });
    },
    [favSave, reading, onReadingChange],
  );

  /* ---------- Handlers ---------- */

  const handleNoteChange = (v: string) => {
    setNote(v);
    persistNote(v);
  };

  const toggleTag = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = tags.includes(trimmed);
    const next = exists ? tags.filter((t) => t !== trimmed) : [...tags, trimmed];
    setTags(next);
    persistTags(next);

    // Update the tag library: insert if new, increment/decrement usage_count.
    void (async () => {
      if (exists) {
        // Decrement (or no-op if missing). We keep the row even at 0 so it
        // stays in the library — the user can re-pick it later.
        const lib = tagLibrary.find(
          (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (lib) {
          const nextCount = Math.max(0, lib.usage_count - 1);
          await supabase
            .from("user_tags")
            .update({ usage_count: nextCount })
            .eq("id", lib.id);
          onTagLibraryChange(
            tagLibrary.map((t) =>
              t.id === lib.id ? { ...t, usage_count: nextCount } : t,
            ),
          );
        }
      } else {
        const lib = tagLibrary.find(
          (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (lib) {
          const nextCount = lib.usage_count + 1;
          await supabase
            .from("user_tags")
            .update({ usage_count: nextCount })
            .eq("id", lib.id);
          onTagLibraryChange(
            tagLibrary.map((t) =>
              t.id === lib.id ? { ...t, usage_count: nextCount } : t,
            ),
          );
        } else {
          const { data, error } = await supabase
            .from("user_tags")
            .insert({ user_id: reading.user_id, name: trimmed, usage_count: 1 })
            .select("id,name,usage_count")
            .single();
          if (!error && data) {
            onTagLibraryChange([...(tagLibrary ?? []), data as EnrichmentTag]);
          }
        }
      }
    })();
  };

  const handleTagInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = tagInput.trim();
    if (!v) return;
    if (!tags.includes(v)) toggleTag(v);
    setTagInput("");
  };

  const toggleFavorite = () => {
    const next = !favorite;
    setFavorite(next);
    persistFavorite(next);
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setUploadError(
        `That photo is ${formatMb(file.size)} — please choose one under 8 MB.`,
      );
      return;
    }
    // Decode just enough to read the natural dimensions. Catches absurdly
    // large scanner/camera originals before we hand them to the canvas
    // compressor (which would otherwise allocate a huge bitmap).
    const dims = await readImageDimensions(file);
    if (!dims) {
      setUploadError("That image couldn't be read — try a different photo.");
      return;
    }
    if (
      dims.width > MAX_PHOTO_DIMENSION ||
      dims.height > MAX_PHOTO_DIMENSION
    ) {
      setUploadError(
        `That photo is ${dims.width}×${dims.height}px — please choose one under ${MAX_PHOTO_DIMENSION}px on the longest side.`,
      );
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      // Compress before upload — keeps the bucket lean and uploads fast.
      const compressed = await compressImage(file, 1200, 0.8);
      await persistPhotoBlob(compressed, "image/jpeg", "jpg");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  /**
   * Persist a freshly captured/compressed photo blob to the
   * `reading-photos` bucket and append a row to `reading_photos`.
   * Shared by the file picker and the in-app PhotoCapture (Stamp AQ)
   * so both paths produce identical journal entries.
   */
  const persistPhotoBlob = async (
    blob: Blob,
    contentType: string,
    extension: string,
  ) => {
    const path = `${reading.user_id}/${reading.id}/${crypto.randomUUID()}.${extension}`;
    const upRes = await uploadWithQuota({
      userId: reading.user_id,
      bucket: "reading-photos",
      path,
      file: blob,
      eventType: "photo",
      contentType,
      cacheControl: "3600",
      upsert: false,
      readingId: reading.id,
    });
    if (!upRes.ok) throw new Error(upRes.error);
    const { data: row, error: insErr } = await supabase
      .from("reading_photos")
      .insert({
        reading_id: reading.id,
        user_id: reading.user_id,
        storage_path: path,
      })
      .select("id,storage_path,caption,created_at")
      .single();
    if (insErr) throw insErr;
    const { data: signed } = await supabase.storage
      .from("reading-photos")
      .createSignedUrl(path, 60 * 60);
    const newRow = row as EnrichmentPhoto;
    const nextPhotos = [...photos, newRow];
    setPhotos(nextPhotos);
    if (signed?.signedUrl) {
      setPhotoUrls((prev) => ({ ...prev, [newRow.id]: signed.signedUrl }));
    }
    onPhotoCountChange(reading.id, nextPhotos.length);
  };

  const removePhoto = async (photo: EnrichmentPhoto) => {
    const prevPhotos = photos;
    const nextPhotos = photos.filter((p) => p.id !== photo.id);
    setPhotos(nextPhotos);
    onPhotoCountChange(reading.id, nextPhotos.length);
    // 9-6-AC — soft-delete to archive instead of hard delete. The
    // storage object stays so the user can restore from Settings →
    // Data → Photo archive.
    const { error } = await supabase
      .from("reading_photos")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", photo.id);
    if (error) {
      // rollback on failure
      setPhotos(prevPhotos);
      onPhotoCountChange(reading.id, prevPhotos.length);
      return;
    }
  };

  /* ---------- Derived ---------- */

  const hasNote = note.trim().length > 0;
  const hasTags = tags.length > 0;
  const hasPhotos = photos.length > 0;

  // Suggested tags = library minus tags already on this reading, top 6.
  const suggestions = useMemo(() => {
    const set = new Set(tags.map((t) => t.toLowerCase()));
    return tagLibrary
      .filter((t) => !set.has(t.name.toLowerCase()))
      .slice(0, 6);
  }, [tagLibrary, tags]);

  const anySaving =
    noteSave.state === "saving" ||
    noteSaveDebounced.state === "saving" ||
    tagsSave.state === "saving" ||
    favSave.state === "saving";
  const anySaved =
    noteSave.state === "saved" ||
    noteSaveDebounced.state === "saved" ||
    tagsSave.state === "saved" ||
    favSave.state === "saved";
  const anyError =
    noteSave.state === "error" ||
    noteSaveDebounced.state === "error" ||
    tagsSave.state === "error" ||
    favSave.state === "error";

  /* ---------- Render ---------- */

  return (
    <section
      aria-label="Enrich this reading"
      className="mx-auto mt-10 max-w-prose"
    >
      <PatternSurfacingLine readingId={reading.id} />
      {/* Hairline divider */}
      <div
        className="mb-5 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, color-mix(in oklab, var(--gold) 18%, transparent), transparent)",
        }}
      />

      {/* Action row — sticky just above the bottom nav so it stays
          accessible while the seeker scrolls through the spread above. */}
      <div
        style={{
          position: "sticky",
          bottom: "calc(var(--bottom-nav-height, 64px) + var(--space-2))",
          zIndex: 30,
          background:
            "linear-gradient(180deg, transparent 0%, var(--color-background, #06060c) 60%)",
          paddingTop: "var(--space-4)",
          paddingBottom: "var(--space-2)",
        }}
        className="flex items-center justify-center gap-3"
      >
        <div className="flex items-center justify-center gap-5">
          <IconAction
            label={favorite ? "Unfavorite" : "Favorite"}
            active={favorite}
            onClick={toggleFavorite}
          >
            <Heart
              size={18}
              strokeWidth={1.5}
              fill={favorite ? "currentColor" : "none"}
            />
          </IconAction>
          {copyText && (
            <IconAction
              label={copied ? "Copied" : "Copy reading"}
              active={copied}
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <CheckCheck size={18} strokeWidth={1.5} />
              ) : (
                <Copy size={18} strokeWidth={1.5} />
              )}
            </IconAction>
          )}
          <IconAction
            label="Note"
            active={hasNote}
            onClick={() =>
              setOpenSection((p) => (p === "note" ? null : "note"))
            }
          >
            <StickyNote size={18} strokeWidth={1.5} fill={hasNote ? "currentColor" : "none"} />
          </IconAction>
          <IconAction
            label="Tags"
            active={hasTags}
            onClick={() =>
              setOpenSection((p) => (p === "tags" ? null : "tags"))
            }
          >
            <TagIcon size={18} strokeWidth={1.5} />
          </IconAction>
          <IconAction
            label="Add photo"
            active={hasPhotos}
            onClick={() => setCameraOpen(true)}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 size={18} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <Camera size={18} strokeWidth={1.5} />
            )}
          </IconAction>
          {onShare && (
            <IconAction
              label="Share"
              active={false}
              onClick={onShare}
            >
              <Share2 size={18} strokeWidth={1.5} />
            </IconAction>
          )}
          <StoryMembershipIcon readingId={reading.id} userId={reading.user_id} />
        </div>
      </div>
      <div className="mt-1 flex justify-center">
        <SaveIndicator
          saving={anySaving}
          saved={anySaved}
          error={anyError}
        />
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChosen}
      />
      {uploadError && (
        <p
          className="mt-2 font-display text-[12px] italic text-red-300"
          style={{ opacity: "var(--ro-plus-30)" }}
        >
          {uploadError}
        </p>
      )}

      {/* Phase 9.5b — Stamp AQ. Shared in-app camera (PhotoCapture).
          The seeker can also tap "upload a file instead" inside the
          overlay's empty-camera state to fall back to the file picker. */}
      {cameraOpen && (
        <PhotoCapture
          shape="free"
          outputMaxDimension={1600}
          outputQuality={0.85}
          guideText="Capture this reading"
          onCancel={() => setCameraOpen(false)}
          onCapture={async (blob) => {
            setCameraOpen(false);
            setUploadError(null);
            setUploading(true);
            try {
              await persistPhotoBlob(blob, "image/webp", "webp");
            } catch (err) {
              setUploadError(
                err instanceof Error ? err.message : "Upload failed.",
              );
            } finally {
              setUploading(false);
            }
          }}
        />
      )}

      {/* Note editor */}
      {openSection === "note" && (
        <div className="mt-4 flex flex-col gap-3">
          <JournalPromptsSlot
            cardIds={cardIds}
            customCardPromptsByCardId={customCardPromptsByCardId}
            tailoredPrompt={tailoredPromptProp ?? null}
            question={question ?? null}
            readingId={reading.id}
            value={note}
            onChange={(next) => handleNoteChange(next)}
            textareaRef={noteTextareaRef}
            onTailoredPromptUpdate={onTailoredPromptUpdate}
            defaultHidden={!!journalPromptUsed}
            onPromptUsed={onJournalPromptUsed}
          />
          <textarea
            ref={noteTextareaRef}
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder={
              defaultNoteOpen
                ? "What does this reading mean to you?"
                : isOracle
                  ? "What stirs within you…"
                  : "Add a note…"
            }
            className="w-full resize-none rounded-md font-display text-[15px] italic text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            style={{
              background: "color-mix(in oklch, var(--gold) 5%, transparent)",
              borderLeft:
                "2px solid color-mix(in oklch, var(--gold) 30%, transparent)",
              opacity: "var(--ro-plus-40)",
              padding: "12px 16px",
              minHeight: 120,
              overflow: "hidden",
            }}
          />
          <button
            type="button"
            onClick={() => {
              // Q14 Fix 6 — persist but keep the note inline; never collapse.
              persistNote(note);
              setSavedFlash(true);
              if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
              savedFlashTimer.current = setTimeout(() => setSavedFlash(false), 1400);
            }}
            style={{
              alignSelf: "flex-end",
              background: "transparent",
              border: "none",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--gold)",
              opacity: "var(--ro-plus-30)",
              cursor: "pointer",
              padding: "4px 0",
              borderBottom:
                "1px solid color-mix(in oklch, var(--gold) 30%, transparent)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {savedFlash && (
              <Check size={13} strokeWidth={2} style={{ color: "var(--gold)" }} />
            )}
            {savedFlash ? "Saved" : "Save"}
          </button>
        </div>
      )}

      {/* Tag editor */}
      {openSection === "tags" && (
        <div className="mt-4 space-y-3">
          {/* Active tags */}
          {hasTags && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className="group inline-flex items-center gap-1 font-display text-[13px] italic text-gold"
                  style={{
                    opacity: "var(--ro-plus-40)",
                    borderBottom:
                      "1px solid color-mix(in oklab, var(--gold) 60%, transparent)",
                    paddingBottom: 1,
                  }}
                >
                  {t}
                  <X
                    size={11}
                    strokeWidth={1.5}
                    className="opacity-60 transition-opacity group-hover:opacity-100"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <span
                className="block font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                style={{ opacity: "var(--ro-plus-10)" }}
              >
                Suggested
              </span>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleTag(s.name)}
                    className="inline-flex items-center gap-1 font-display text-[13px] italic text-gold"
                    style={{ opacity: "var(--ro-plus-10)" }}
                  >
                    <Plus size={10} strokeWidth={1.5} />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New tag input */}
          <form
            onSubmit={handleTagInputSubmit}
            className="flex items-center gap-2"
          >
            <TagIcon
              size={12}
              strokeWidth={1.5}
              className="text-gold"
              style={{ opacity: "var(--ro-plus-10)" }}
              aria-hidden
            />
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder={
                isOracle ? "Tag name…" : "Tag name…"
              }
              className="w-full bg-transparent py-1 font-display text-[13px] italic text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              style={{
                borderBottom:
                  "1px solid color-mix(in oklab, var(--gold) 18%, transparent)",
              }}
            />
          </form>
        </div>
      )}

      {/* Photos gallery */}
      {(photosLoading || hasPhotos) && (
        <div className="mt-5">
          {photosLoading ? (
            <LoadingText>Loading photos…</LoadingText>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md"
                  style={{
                    border:
                      "1px solid color-mix(in oklab, var(--gold) 14%, transparent)",
                  }}
                >
                  {photoUrls[p.id] ? (
                    <button
                      type="button"
                      onClick={() => setPhotoViewerSrc(photoUrls[p.id])}
                      aria-label="View photo"
                      className="block h-full w-full"
                    >
                      <img
                        src={photoUrls[p.id]}
                        alt={p.caption ?? "Reading photo"}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        style={{ opacity: "var(--ro-plus-40)" }}
                      />
                    </button>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Loader2
                        size={14}
                        strokeWidth={1.5}
                        className="animate-spin text-gold"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirm({
                        title: "Remove this photo?",
                        description:
                          "It moves to the photo archive. You can restore it from Settings → Data.",
                        confirmLabel: "Remove",
                        cancelLabel: "Cancel",
                      });
                      if (ok) void removePhoto(p);
                    }}
                    aria-label="Remove photo"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <X size={11} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {photoViewerSrc && (
        <div
          onClick={() => setPhotoViewerSrc(null)}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-label="Photo viewer"
        >
          <img
            src={photoViewerSrc}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </section>
  );
}

/* ---------- Sub-components ---------- */

function IconAction({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-opacity",
        "text-gold disabled:cursor-not-allowed",
      )}
      style={{
        opacity: active ? "var(--ro-plus-50)" : "var(--ro-plus-10)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * DM-6 — Story-membership icon. Visible only when the reading belongs to
 * one or more patterns (Stories). First tap opens a hint modal explaining
 * what the icon means; subsequent taps (after the seeker dismisses with
 * "don't show again") navigate directly. The hint is keyed on
 * `dismissed_hints.story_membership_icon` and is restored by Reset Hints.
 */
function StoryMembershipIcon({
  readingId,
  userId,
}: {
  readingId: string;
  userId: string;
}) {
  const navigate = useNavigate();
  const [memberOf, setMemberOf] = useState<{ id: string; name: string }[]>([]);
  const [hintDismissed, setHintDismissed] = useState(true);
  const [hintOpen, setHintOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("patterns")
        .select("id, name, reading_ids")
        .contains("reading_ids", [readingId]);
      if (cancelled) return;
      const rows = (data ?? []) as Array<{ id: string; name: string }>;
      setMemberOf(rows.map((r) => ({ id: r.id, name: r.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [readingId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("dismissed_hints")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const hints =
        ((data as { dismissed_hints?: Record<string, boolean> } | null)
          ?.dismissed_hints) ?? {};
      setHintDismissed(hints.story_membership_icon === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (memberOf.length === 0) return null;

  const goToStory = () => {
    if (memberOf.length === 1) {
      void navigate({
        to: "/stories/$patternId",
        params: { patternId: memberOf[0].id },
      });
    } else {
      void navigate({ to: "/stories" });
    }
  };

  const onTap = () => {
    if (hintDismissed) {
      goToStory();
    } else {
      setDontShowAgain(false);
      setHintOpen(true);
    }
  };

  const onConfirm = async () => {
    if (dontShowAgain) {
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("dismissed_hints")
          .eq("user_id", userId)
          .maybeSingle();
        const cur =
          ((data as { dismissed_hints?: Record<string, boolean> } | null)
            ?.dismissed_hints) ?? {};
        await supabase
          .from("user_preferences")
          .update({ dismissed_hints: { ...cur, story_membership_icon: true } } as never)
          .eq("user_id", userId);
        setHintDismissed(true);
      } catch {
        /* non-fatal */
      }
    }
    setHintOpen(false);
    goToStory();
  };

  const label =
    memberOf.length === 1
      ? `Part of Story: ${memberOf[0].name}`
      : `Part of ${memberOf.length} Stories`;

  return (
    <>
      <IconAction label={label} active onClick={onTap}>
        <Network size={18} strokeWidth={1.5} />
      </IconAction>
      <AlertDialog open={hintOpen} onOpenChange={setHintOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Story membership</AlertDialogTitle>
            <AlertDialogDescription>
              This reading is part of{" "}
              {memberOf.length === 1
                ? `the “${memberOf[0].name}” Story`
                : `${memberOf.length} Stories`}
              . Tapping this icon opens{" "}
              {memberOf.length === 1 ? "that Story" : "the Stories index"} so
              you can see every reading inside it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: "var(--text-body-sm)",
              cursor: "pointer",
            }}
          >
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(v) => setDontShowAgain(v === true)}
            />
            Don't show this again
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TextAction({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-display text-[13px] italic text-gold transition-opacity"
      style={{
        opacity: active ? "var(--ro-plus-40)" : "var(--ro-plus-10)",
      }}
    >
      {label}
    </button>
  );
}

function SaveIndicator({
  saving,
  saved,
  error,
}: {
  saving: boolean;
  saved: boolean;
  error: boolean;
}) {
  let text: string | null = null;
  let cls = "text-muted-foreground";
  if (error) {
    text = "Couldn't save";
    cls = "text-red-300";
  } else if (saving) {
    text = "Saving…";
  } else if (saved) {
    text = "Saved";
  }
  return (
    <span
      className={cn(
        "font-display text-[10px] uppercase tracking-[0.18em] transition-opacity",
        cls,
      )}
      style={{ opacity: text ? "var(--ro-plus-20)" : "0" }}
      aria-live="polite"
    >
      {text ?? "·"}
    </span>
  );
}

/* ---------- Pattern surfacing (Phase 9) ---------- */

const DISMISS_STORAGE_PREFIX = "pattern-suggestion-dismissed:";
// Dismissals expire after 30 days so a long-lived pattern can resurface later.
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isDismissed(readingId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_PREFIX + readingId);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at?: number };
    if (typeof parsed?.at !== "number") return false;
    if (Date.now() - parsed.at > DISMISS_TTL_MS) {
      window.localStorage.removeItem(DISMISS_STORAGE_PREFIX + readingId);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function markDismissed(readingId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DISMISS_STORAGE_PREFIX + readingId,
      JSON.stringify({ at: Date.now() }),
    );
  } catch {
    // ignore quota errors
  }
}

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? singular + "s");
}

function buildReason(
  source: "cards" | "tags" | "both",
  sharedCards: string[],
  sharedTags: string[],
): string {
  const cardN = sharedCards.length;
  const tagN = sharedTags.length;
  const cardPart = `${cardN} ${pluralize(cardN, "card")}`;
  const tagPreview = sharedTags.slice(0, 2).map((t) => `“${t}”`).join(" and ");
  const tagPart =
    tagN <= 2
      ? `${pluralize(tagN, "the tag", "the tags")} ${tagPreview}`
      : `${tagN} tags including ${tagPreview}`;
  if (source === "cards") return `shares ${cardPart}`;
  if (source === "tags") return `shares ${tagPart}`;
  return `shares ${cardPart} and ${tagPart}`;
}

function PatternSurfacingLine({ readingId }: { readingId: string }) {
  const [pattern, setPattern] = useState<{
    id: string;
    name: string;
    lifecycle_state: string;
  } | null>(null);
  // DU-11 — Resonance-scored suggestion. Only the single strongest
  // match is ever surfaced (cap = 1) and only when its resonance score
  // crosses the 0.5 threshold (geometric mean of draw-overlap and
  // story-pool overlap, plus a small tag bonus).
  type PatternSuggestion = {
    id: string;
    name: string;
    lifecycle_state: string;
    resonance: number;
    sharedCards: number[];
    // EX-3 — orientation lookup keyed by cardId (from this reading's
    // own card_orientations), so reversed cards rotate in the resonance
    // shared-cards row.
    cardOrientations: Record<number, boolean>;
    sharedTags: string[];
    drawSize: number;
    poolSize: number;
    storyCardPool: number[];
    readingCount: number;
  };
  const [suggestions, setSuggestions] = useState<PatternSuggestion[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => isDismissed(readingId));
  // DU-12 — deck for the current reading so shared-card thumbnails use
  // the deck the seeker actually drew with. EW-3: passed straight to
  // <CardImage deckId> — image resolution + corner radius are handled
  // inside the shared component.
  const [readingDeckId, setReadingDeckId] = useState<string | null>(null);
  const [readingCardDeckIds, setReadingCardDeckIds] = useState<string[] | null>(null);
  // DU-12 — "Tell me more" disclosure for the surfaced match.
  const [tellMoreOpen, setTellMoreOpen] = useState(false);
  // DL-7 — first-tap "Connect" hint modal. Persisted via
  // user_preferences.dismissed_hints (jsonb). When the
  // 'connect_to_story' key is true the modal is skipped.
  const [hintTarget, setHintTarget] = useState<PatternSuggestion | null>(null);
  const [hintDismissForever, setHintDismissForever] = useState(false);
  const [hintAlreadyDismissed, setHintAlreadyDismissed] = useState<boolean | null>(
    null,
  );
  const [hintUserId, setHintUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;
      if (cancelled) return;
      setHintUserId(uid);
      if (!uid) {
        setHintAlreadyDismissed(true);
        return;
      }
      const { data } = await supabase
        .from("user_preferences")
        .select("dismissed_hints")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled) return;
      const hints = ((data as { dismissed_hints?: Record<string, boolean> } | null)
        ?.dismissed_hints) ?? {};
      setHintAlreadyDismissed(hints.connect_to_story === true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPattern(null);
    setSuggestions([]);
    setTellMoreOpen(false);
    setDismissed(isDismissed(readingId));
    void (async () => {
      const { data: r } = await supabase
        .from("readings")
       .select("pattern_id, user_id, card_ids, card_orientations, tags, deck_id, card_deck_ids")
        .eq("id", readingId)
        .maybeSingle();
      const row = r as
        | {
            pattern_id: string | null;
            user_id: string;
            card_ids: number[] | null;
            card_orientations: boolean[] | null;
            tags: string[] | null;
            deck_id: string | null;
            card_deck_ids: string[] | null;
          }
        | null;
      if (!row || cancelled) return;
      setReadingDeckId(row.deck_id ?? null);
      setReadingCardDeckIds(row.card_deck_ids ?? null);
      // Already attached → show the "aligns with your Story" line.
      if (row.pattern_id) {
        const { data: p } = await supabase
          .from("patterns")
          .select("id, name, lifecycle_state")
          .eq("id", row.pattern_id)
          .maybeSingle();
        if (!cancelled && p) {
          setPattern(p as { id: string; name: string; lifecycle_state: string });
        }
        return;
      }
      // Not attached → look for an active pattern that resonates by
      // shared cards or tags.
      const { data: patternRows } = await supabase
        .from("patterns")
        .select("id, name, lifecycle_state, reading_ids")
        .eq("user_id", row.user_id)
        .in("lifecycle_state", ["emerging", "active", "reawakened"]);
      const patterns = (patternRows ?? []) as Array<{
        id: string;
        name: string;
        lifecycle_state: string;
        reading_ids: string[];
      }>;
      if (patterns.length === 0) return;

      // Pull each candidate pattern's readings to compare cards/tags.
      const allReadingIds = Array.from(
        new Set(patterns.flatMap((p) => p.reading_ids ?? [])),
      ).filter((id) => id !== readingId);
      if (allReadingIds.length === 0) return;
      const { data: relRows } = await supabase
        .from("readings")
        .select("id, card_ids, tags")
        .in("id", allReadingIds)
        .is("archived_at", null);
      const rel = ((relRows ?? []) as Array<{
        id: string;
        card_ids: number[] | null;
        tags: string[] | null;
      }>).reduce<Record<string, { cards: Set<number>; tags: Set<string> }>>(
        (acc, x) => {
          acc[x.id] = {
            cards: new Set(x.card_ids ?? []),
            tags: new Set((x.tags ?? []).map((t) => t.toLowerCase())),
          };
          return acc;
        },
        {},
      );

      const myCards = new Set(row.card_ids ?? []);
      const myTags = new Set((row.tags ?? []).map((t) => t.toLowerCase()));
      // EX-3 — pair each cardId with its orientation from this reading.
      const myOrientations: Record<number, boolean> = {};
      const ids = row.card_ids ?? [];
      const ors = row.card_orientations ?? [];
      for (let i = 0; i < ids.length; i++) {
        myOrientations[ids[i]] = !!ors[i];
      }

      const scored: PatternSuggestion[] = [];
      for (const p of patterns) {
        const sharedCardSet = new Set<number>();
        const sharedTagSet = new Set<string>();
        const storyCardPool = new Set<number>();
        for (const rid of p.reading_ids ?? []) {
          const meta = rel[rid];
          if (!meta) continue;
          for (const c of meta.cards) storyCardPool.add(c);
          for (const c of myCards) if (meta.cards.has(c)) sharedCardSet.add(c);
          for (const t of myTags) if (meta.tags.has(t)) sharedTagSet.add(t);
        }
        const cardCount = sharedCardSet.size;
        const drawSize = myCards.size;
        const poolSize = storyCardPool.size;
        if (cardCount === 0 && sharedTagSet.size === 0) continue;
        // DU-11 — resonance: geometric mean of (draw overlap) and
        // (story-pool overlap), penalizing weakness in either direction.
        // Threshold tuned so most draws produce no Connect prompt.
        const drawOverlapRatio = drawSize > 0 ? cardCount / drawSize : 0;
        const storyOverlapRatio = poolSize > 0 ? cardCount / poolSize : 0;
        const cardResonance = Math.sqrt(drawOverlapRatio * storyOverlapRatio);
        const tagBonus = sharedTagSet.size * 0.05;
        const resonance = cardResonance + tagBonus;
        if (resonance < 0.5) continue;
        scored.push({
          id: p.id,
          name: p.name,
          lifecycle_state: p.lifecycle_state,
          resonance,
          sharedCards: Array.from(sharedCardSet),
          cardOrientations: myOrientations,
          sharedTags: Array.from(sharedTagSet),
          drawSize,
          poolSize,
          storyCardPool: Array.from(storyCardPool),
          readingCount: (p.reading_ids ?? []).length,
        });
      }
      if (!cancelled && scored.length > 0) {
        // DU-11 — only ever surface the single strongest match.
        scored.sort((a, b) => b.resonance - a.resonance);
        setSuggestions(scored.slice(0, 1));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readingId]);

  const attach = useCallback(
    async (target: PatternSuggestion) => {
      if (attachingId) return;
      setAttachingId(target.id);
      try {
        const { data: pat } = await supabase
          .from("patterns")
          .select("id, name, lifecycle_state, reading_ids")
          .eq("id", target.id)
          .maybeSingle();
        const p = pat as
          | { id: string; name: string; lifecycle_state: string; reading_ids: string[] }
          | null;
        if (!p) {
          toast.error("Couldn't find that pattern", {
            description: "It may have been retired. Please try again.",
          });
          setSuggestions((prev) => prev.filter((s) => s.id !== target.id));
          return;
        }
        const nextReadings = Array.from(
          new Set([...(p.reading_ids ?? []), readingId]),
        );
        const [{ error: e1 }, { error: e2 }] = await Promise.all([
          supabase.from("readings").update({ pattern_id: p.id }).eq("id", readingId),
          supabase
            .from("patterns")
            .update({ reading_ids: nextReadings })
            .eq("id", p.id),
        ]);
        if (e1 || e2) {
          if (!e1 && e2) {
            await supabase
              .from("readings")
              .update({ pattern_id: null })
              .eq("id", readingId);
          }
          toast.error("Couldn't connect to pattern", {
            description: "Please check your connection and try again.",
          });
          return;
        }
        setSuggestions([]);
        setPattern({ id: p.id, name: p.name, lifecycle_state: p.lifecycle_state });
      } catch (err) {
        toast.error("Couldn't connect to pattern", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      } finally {
        setAttachingId(null);
      }
    },
    [attachingId, readingId],
  );

  const onConnectTap = (s: PatternSuggestion) => {
    if (hintAlreadyDismissed) {
      void attach(s);
    } else {
      setHintDismissForever(false);
      setHintTarget(s);
    }
  };

  const confirmConnect = async () => {
    const target = hintTarget;
    if (!target) return;
    if (hintDismissForever && hintUserId) {
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("dismissed_hints")
          .eq("user_id", hintUserId)
          .maybeSingle();
        const cur = ((data as { dismissed_hints?: Record<string, boolean> } | null)
          ?.dismissed_hints) ?? {};
        await supabase
          .from("user_preferences")
          .update({ dismissed_hints: { ...cur, connect_to_story: true } })
          .eq("user_id", hintUserId);
        setHintAlreadyDismissed(true);
      } catch {
        /* non-fatal */
      }
    }
    setHintTarget(null);
    void attach(target);
  };

  if (pattern) {
    return (
      <div
        className="mx-auto mb-4 max-w-prose text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          opacity: "var(--ro-plus-30)",
        }}
      >
        <span style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}>
          This reading aligns with your{" "}
        </span>
        <Link
          to="/stories"
          search={{ focus: pattern.id }}
          title={`Open the ${pattern.name} Story`}
          aria-label={`Open the ${pattern.name} Story`}
          style={{
            color: "var(--gold)",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          Story
        </Link>
        <HelpIcon articleId="stories" />
        <span style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}>
          : {pattern.name}.
        </span>
      </div>
    );
  }

  if (suggestions.length === 0 || dismissed) return null;

  const busy = attachingId !== null;
  const s = suggestions[0];
  const isAttaching = attachingId === s.id;
  const heading =
    s.resonance >= 0.7
      ? "An echo from your past."
      : "This reading touches a Story.";
  const rarity =
    s.resonance >= 0.7
      ? `This is rare. Your draw shares ${s.sharedCards.length} of ${s.drawSize} cards with this Story, which contains only ${s.poolSize} unique cards.`
      : `Your draw echoes ${s.sharedCards.length} of your ${s.drawSize} cards in this Story.`;

  return (
    <div
      className="mx-auto mb-4 max-w-prose"
      style={{
        background: "var(--surface-card)",
        // ET-4 — outer border removed; surface-card alone provides
        // adequate visual grouping without competing with card art.
        borderRadius: "var(--radius-lg, 14px)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        animation: "connect-panel-rise 600ms ease-out both",
      }}
    >
      {/* DU-12 — keyframes are local to this panel. */}
      <style>{`
        @keyframes connect-panel-rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {/* 1. Resonance heading */}
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-sm, 17px)",
          color: "var(--accent, var(--gold))",
          opacity: 0.8,
          textAlign: "center",
        }}
      >
        {heading}
      </h3>

      {/* 2. Shared card thumbnails with glow halo */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {s.sharedCards.map((cardId) => (
          <div
            key={cardId}
            style={{
              position: "relative",
              width: 74,
              aspectRatio: "1 / 1.75",
            }}
          >
            {/* EW-3 — radial halo behind the shared-card thumbnail.
                The thumbnail itself is now <CardImage>, which handles
                deck-aware artwork, corner radius, loading skeleton, and
                drops the legacy 1px accent border. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: -14,
                background:
                  "radial-gradient(circle, color-mix(in oklab, var(--accent, var(--gold)) 40%, transparent) 0%, transparent 70%)",
                filter: "blur(8px)",
                opacity: 0.6,
                pointerEvents: "none",
              }}
            />
            <CardImage
              cardId={cardId}
              variant="face"
              size="thumbnail"
              deckId={(readingCardDeckIds?.[cardId] ?? readingDeckId) ?? null}
              reversed={!!s.cardOrientations[cardId]}
              ariaLabel={getCardName(cardId)}
            />
          </div>
        ))}
      </div>

      {/* 3. Rarity statement */}
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          color: "var(--foreground-muted)",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        {rarity}
      </p>

      {/* 4. Story name + link */}
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body)",
          color: "var(--foreground-muted)",
          textAlign: "center",
        }}
      >
        <span>This is your Story: </span>
        <Link
          to="/stories/$patternId"
          params={{ patternId: s.id }}
          style={{
            color: "var(--accent, var(--gold))",
            textDecoration: "none",
            borderBottom:
              "1px solid color-mix(in oklab, var(--accent, var(--gold)) 50%, transparent)",
            paddingBottom: 1,
          }}
        >
          {s.name}
        </Link>
      </div>

      {/* 5. Tell me more disclosure */}
      <button
        type="button"
        onClick={() => setTellMoreOpen((o) => !o)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--foreground-muted)",
        }}
      >
        {tellMoreOpen ? "Hide details" : "Tell me more"}
      </button>
      {tellMoreOpen && (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--foreground-muted)",
            textAlign: "center",
            lineHeight: 1.6,
            opacity: 0.85,
          }}
        >
          {s.name} contains {s.poolSize} unique{" "}
          {s.poolSize === 1 ? "card" : "cards"} across {s.readingCount}{" "}
          {s.readingCount === 1 ? "reading" : "readings"}:{" "}
          {s.storyCardPool.map((id) => getCardName(id)).join(", ")}.
        </p>
      )}

      {/* 6. Actions */}
      <button
        type="button"
        onClick={() => onConnectTap(s)}
        disabled={busy}
        style={{
          marginTop: 4,
          background: "var(--accent, var(--gold))",
          color: "var(--accent-foreground, #1e1b4b)",
          border: "none",
          borderRadius: 8,
          padding: "10px 20px",
          cursor: busy ? "default" : "pointer",
          fontFamily: "var(--font-display, inherit)",
          fontSize: 12,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: busy && !isAttaching ? 0.4 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {isAttaching && (
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              border:
                "1.5px solid color-mix(in oklab, var(--accent-foreground, #1e1b4b) 35%, transparent)",
              borderTopColor: "var(--accent-foreground, #1e1b4b)",
              animation: "spin 0.8s linear infinite",
              display: "inline-block",
            }}
          />
        )}
        {isAttaching ? "Connecting…" : "Connect this reading"}
      </button>
      <button
        type="button"
        onClick={() => {
          markDismissed(readingId);
          setDismissed(true);
        }}
        disabled={busy}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: busy ? "default" : "pointer",
          color: "var(--foreground-muted)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          opacity: 0.7,
        }}
      >
        Let it stand alone
      </button>
      {hintTarget && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setHintTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 420,
              width: "100%",
              background: "var(--surface-card)",
              border: "1px solid color-mix(in oklab, var(--gold) 25%, transparent)",
              borderRadius: 12,
              padding: 20,
              fontFamily: "var(--font-serif)",
              color: "var(--foreground)",
              textAlign: "left",
            }}
          >
            <h3 style={{ margin: 0, fontStyle: "italic", fontSize: "var(--text-heading-sm, 17px)" }}>
              Connect this reading to a Story?
            </h3>
            <p style={{ marginTop: 12, fontSize: "var(--text-body-sm)", lineHeight: 1.6, opacity: 0.85 }}>
              Connecting links this reading to the <strong style={{ color: "var(--gold)" }}>{hintTarget.name}</strong> Story.
              Once connected, this reading appears in the Story's collection,
              and Tarot Seed tracks how the Story evolves over time.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: "var(--text-body-sm)" }}>
              <input
                type="checkbox"
                checked={hintDismissForever}
                onChange={(e) => setHintDismissForever(e.target.checked)}
              />
              Don't show this again
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setHintTarget(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "color-mix(in oklab, var(--foreground) 60%, transparent)",
                  cursor: "pointer",
                  fontFamily: "var(--font-display, inherit)",
                  fontSize: 12,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmConnect()}
                style={{
                  background: "color-mix(in oklab, var(--gold) 20%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--gold) 50%, transparent)",
                  color: "var(--gold)",
                  cursor: "pointer",
                  fontFamily: "var(--font-display, inherit)",
                  fontSize: 12,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  padding: "8px 16px",
                  borderRadius: 8,
                }}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- JournalPromptsSlot ---------- */

/**
 * 26-05-08-Q12 — Wraps `<JournalPrompts>` with the per-card resolver,
 * the optional premium "tailored prompt" cycler position, and the AI
 * fetch that fires when the seeker taps "Tap to use" on that slot.
 */
const TAILORED_PLACEHOLDER = "Get a tailored prompt for this reading";

function JournalPromptsSlot({
  cardIds,
  customCardPromptsByCardId,
  tailoredPrompt,
  question,
  readingId,
  value,
  onChange,
  textareaRef,
  onTailoredPromptUpdate,
  defaultHidden,
  onPromptUsed,
}: {
  cardIds: number[] | undefined;
  customCardPromptsByCardId: Record<number, string[] | null | undefined> | undefined;
  tailoredPrompt: string | null;
  question: string | null;
  readingId: string;
  value: string;
  onChange: (next: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onTailoredPromptUpdate?: (prompt: string) => void;
  defaultHidden?: boolean;
  onPromptUsed?: () => void;
}) {
  const generate = useServerFn(generateTailoredPrompt);
  const [localTailored, setLocalTailored] = useState<string | null>(tailoredPrompt);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLocalTailored(tailoredPrompt);
  }, [tailoredPrompt, readingId]);

  const firstCardId = cardIds?.[0];
  const customPrompts = firstCardId != null ? customCardPromptsByCardId?.[firstCardId] : null;
  const staticPrompts = useMemo(
    () => resolvePromptsForFirstCard(firstCardId, customPrompts),
    [firstCardId, customPrompts],
  );

  const prompts = useMemo(() => {
    const list = [...(staticPrompts ?? [])];
    list.push(localTailored ? localTailored : TAILORED_PLACEHOLDER);
    return list.length > 0 ? list : null;
  }, [staticPrompts, localTailored]);

  const handleBeforeInsert = useCallback(
    async (active: string): Promise<string | null> => {
      // Static prompt — pass through.
      if (active !== TAILORED_PLACEHOLDER) return active;
      if (!question || !question.trim()) {
        toast("Add your question to enable tailored prompts.");
        return null;
      }
      setLoading(true);
      try {
        const headers = await getAuthHeaders();
        const res = (await generate({ data: { readingId }, headers })) as
          | { ok: true; prompt: string }
          | { ok: false; error: string };
        if (!res.ok) {
          // Q22 Fix 2 — branch on the structured error code so the
          // seeker gets an actionable message (and we focus the
          // question field when one is needed).
          switch (res.error) {
            case "question_required": {
              toast(
                "Add a question to this reading first — tailored prompts use it for context.",
              );
              const qInput = document.querySelector(
                "[data-reading-question-input]",
              ) as HTMLElement | null;
              if (qInput) {
                qInput.scrollIntoView({ behavior: "smooth", block: "center" });
                window.setTimeout(() => qInput.focus(), 400);
              }
              break;
            }
            case "not_found":
              toast.error("Reading not found.");
              break;
            case "ai_unavailable":
              toast.error(
                "Couldn't reach the AI right now. Try again in a moment.",
              );
              break;
            case "quota_exceeded":
              toast.error(
                "You've used your AI credits for this month. View usage in Settings → Usage.",
              );
              break;
            case "rate_limited":
              toast.error("Too many AI requests right now. Try again shortly.");
              break;
            case "ai_disabled":
              toast.error("AI is currently disabled on your account.");
              break;
            default:
              toast.error("Couldn't generate a tailored prompt right now.");
          }
          return null;
        }
        setLocalTailored(res.prompt);
        onTailoredPromptUpdate?.(res.prompt);
        return res.prompt;
      } finally {
        setLoading(false);
      }
    },
    [question, generate, readingId, onTailoredPromptUpdate],
  );

  if (!prompts) return null;

  return (
    <JournalPrompts
      prompts={prompts}
      textareaRef={textareaRef}
      value={value}
      onChange={onChange}
      beforeInsert={handleBeforeInsert}
      loading={loading}
      defaultHidden={defaultHidden}
      onPromptUsed={onPromptUsed}
    />
  );
}