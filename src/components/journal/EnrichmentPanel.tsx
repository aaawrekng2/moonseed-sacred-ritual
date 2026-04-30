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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, CheckCheck, Copy, Heart, Loader2, Pencil, Plus, Share2, Tag as TagIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/compress-image";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PhotoCapture } from "@/components/photo/PhotoCapture";

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
}: Props) {
  // Local mirrors of the reading fields so typing is responsive.
  const [note, setNote] = useState(reading.note ?? "");
  const [tags, setTags] = useState<string[]>(reading.tags ?? []);
  const [favorite, setFavorite] = useState(reading.is_favorite);

  // UI toggles for the inline editors.
  const [openSection, setOpenSection] = useState<
    "note" | "tags" | null
  >(null);
  const [tagInput, setTagInput] = useState("");

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
    setOpenSection(null);
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
    const { error: upErr } = await supabase.storage
      .from("reading-photos")
      .upload(path, blob, {
        cacheControl: "3600",
        upsert: false,
        contentType,
      });
    if (upErr) throw upErr;
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
    const { error } = await supabase
      .from("reading_photos")
      .delete()
      .eq("id", photo.id);
    if (error) {
      // rollback on failure
      setPhotos(prevPhotos);
      onPhotoCountChange(reading.id, prevPhotos.length);
      return;
    }
    void supabase.storage.from("reading-photos").remove([photo.storage_path]);
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
            <Pencil size={18} strokeWidth={1.5} />
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

      {/* Note editor */}
      {openSection === "note" && (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            rows={4}
            placeholder={
              isOracle ? "What stirs within you…" : "Add a note…"
            }
            className="w-full resize-none rounded-md font-display text-[15px] italic text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            style={{
              background: "color-mix(in oklch, var(--gold) 5%, transparent)",
              borderLeft:
                "2px solid color-mix(in oklch, var(--gold) 30%, transparent)",
              opacity: "var(--ro-plus-40)",
              padding: "12px 16px",
              minHeight: 120,
            }}
          />
          <button
            type="button"
            onClick={() => {
              persistNote(note);
              setOpenSection(null);
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
            }}
          >
            {isOracle ? "Inscribe & Close" : "Save & Close"}
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
            <div
              className="flex items-center gap-2 font-display text-[12px] italic text-muted-foreground"
              style={{ opacity: "var(--ro-plus-10)" }}
            >
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
              Loading photos…
            </div>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md"
                  style={{
                    border:
                      "1px solid color-mix(in oklab, var(--gold) 14%, transparent)",
                  }}
                >
                  {photoUrls[p.id] ? (
                    <img
                      src={photoUrls[p.id]}
                      alt={p.caption ?? "Reading photo"}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      style={{ opacity: "var(--ro-plus-40)" }}
                    />
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
                    onClick={() => removePhoto(p)}
                    aria-label="Remove photo"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X size={11} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
  // Top matching patterns shown when the reading isn't linked yet.
  type PatternSuggestion = {
    id: string;
    name: string;
    lifecycle_state: string;
    reason: string;
    score: number;
  };
  const [suggestions, setSuggestions] = useState<PatternSuggestion[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => isDismissed(readingId));

  useEffect(() => {
    let cancelled = false;
    setPattern(null);
    setSuggestions([]);
    setDismissed(isDismissed(readingId));
    void (async () => {
      const { data: r } = await supabase
        .from("readings")
        .select("pattern_id, user_id, card_ids, tags")
        .eq("id", readingId)
        .maybeSingle();
      const row = r as
        | {
            pattern_id: string | null;
            user_id: string;
            card_ids: number[] | null;
            tags: string[] | null;
          }
        | null;
      if (!row || cancelled) return;
      // Already attached → show the "lives within" line.
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
        .in("id", allReadingIds);
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

      const scored: PatternSuggestion[] = [];
      for (const p of patterns) {
        const sharedCardSet = new Set<number>();
        const sharedTagSet = new Set<string>();
        for (const rid of p.reading_ids ?? []) {
          const meta = rel[rid];
          if (!meta) continue;
          for (const c of myCards) if (meta.cards.has(c)) sharedCardSet.add(c);
          for (const t of myTags) if (meta.tags.has(t)) sharedTagSet.add(t);
        }
        const cardCount = sharedCardSet.size;
        const tagCount = sharedTagSet.size;
        const score = cardCount * 2 + tagCount;
        if (score < 2) continue;
        const sharedCards = Array.from(sharedCardSet).map((id) => `#${id}`);
        const sharedTags = Array.from(sharedTagSet);
        const source: "cards" | "tags" | "both" =
          cardCount > 0 && tagCount > 0
            ? "both"
            : cardCount > 0
              ? "cards"
              : "tags";
        const reason = buildReason(source, sharedCards, sharedTags);
        scored.push({
          id: p.id,
          name: p.name,
          lifecycle_state: p.lifecycle_state,
          reason,
          score,
        });
      }
      if (!cancelled && scored.length > 0) {
        scored.sort((a, b) => b.score - a.score);
        setSuggestions(scored.slice(0, 3));
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
          This reading lives within{" "}
        </span>
        <Link
          to="/threads/$patternId"
          params={{ patternId: pattern.id }}
          title={`Open the ${pattern.name} chamber`}
          aria-label={`Open the ${pattern.name} pattern chamber`}
          style={{
            color: "var(--gold)",
            textDecoration: "none",
            borderBottom: "1px solid color-mix(in oklab, var(--gold) 40%, transparent)",
          }}
        >
          {pattern.name}
        </Link>
        <span style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}>
          .
        </span>
      </div>
    );
  }

  if (suggestions.length === 0 || dismissed) return null;

  const busy = attachingId !== null;
  const headline =
    suggestions.length === 1
      ? "This reading resonates with a pattern:"
      : `This reading resonates with ${suggestions.length} patterns:`;

  return (
    <div
      className="mx-auto mb-4 max-w-prose text-center"
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-body-sm)",
        opacity: "var(--ro-plus-30)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}>
        {headline}
      </span>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "100%",
        }}
      >
        {suggestions.map((s) => {
          const isThisAttaching = attachingId === s.id;
          return (
            <li
              key={s.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "8px 10px",
                borderTop:
                  "1px solid color-mix(in oklab, var(--gold) 12%, transparent)",
              }}
            >
              <span
                style={{
                  color: "color-mix(in oklab, var(--foreground) 70%, transparent)",
                }}
              >
                {s.reason} with{" "}
                <Link
                  to="/threads/$patternId"
                  params={{ patternId: s.id }}
                  title={`Open the ${s.name} chamber`}
                  aria-label={`Open the ${s.name} pattern chamber — ${s.reason}`}
                  style={{
                    color: "var(--gold)",
                    textDecoration: "none",
                    borderBottom:
                      "1px solid color-mix(in oklab, var(--gold) 40%, transparent)",
                  }}
                >
                  {s.name}
                </Link>
                .
              </span>
              <button
                type="button"
                onClick={() => void attach(s)}
                disabled={busy}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: busy ? "default" : "pointer",
                  color: "var(--gold)",
                  fontFamily: "var(--font-display, inherit)",
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  opacity: busy && !isThisAttaching ? 0.35 : isThisAttaching ? 0.7 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {isThisAttaching && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      border:
                        "1.5px solid color-mix(in oklab, var(--gold) 35%, transparent)",
                      borderTopColor: "var(--gold)",
                      animation: "spin 0.8s linear infinite",
                      display: "inline-block",
                    }}
                  />
                )}
                {isThisAttaching ? "Attaching…" : "Connect"}
              </button>
            </li>
          );
        })}
      </ul>
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
          color: "color-mix(in oklab, var(--foreground) 50%, transparent)",
          fontFamily: "var(--font-display, inherit)",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: busy ? 0.5 : 1,
        }}
      >
        Not now
      </button>
    </div>
  );
}