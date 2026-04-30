/**
 * ZipImporter — bulk-import card images from a .zip (Stamp BH).
 *
 * Drives the multi-step flow described in Prompt BH:
 *   1. Upload         — pick a .zip, extract entries client-side
 *   2. Auto-match     — score filenames against the 78 cards
 *   3a. Review grid   — high-match path (≥60 matched)
 *   3b. Wizard        — sequential picker for low-match
 *   4. Card back      — confirm/pick the deck back
 *   5. Processing     — resize/mask/encode/upload
 *   6. Summary        — results + return to deck grid
 *
 * The owning component (DeckEditor) renders us when its mode kind is
 * one of the import-* values. We never own the deck row itself —
 * that's created upstream so partial saves are recoverable.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Upload, X, Check, ImageIcon } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCardName, getCardImagePath } from "@/lib/tarot";
import { processImageBlob } from "./process";
import {
  canonicalOrder,
  matchFilenames,
  type MatchResult,
} from "./matcher";
import { CardPicker } from "@/components/cards/CardPicker";

const DECK_BUCKET = "custom-deck-images";
const ZIP_MAX_BYTES = 20 * 1024 * 1024;
const VALID_EXT = /\.(png|jpe?g|webp|gif)$/i;
const LOW_RES_THRESHOLD = 800;

type Phase =
  | { kind: "upload" }
  | { kind: "extracting" }
  | { kind: "review"; data: ExtractedDeck }
  | { kind: "wizard"; data: ExtractedDeck }
  | { kind: "back"; data: ExtractedDeck }
  | {
      kind: "processing";
      data: ExtractedDeck;
      done: number;
      total: number;
    }
  | {
      kind: "summary";
      assignedCount: number;
      skippedCount: number;
      lowResIds: number[];
      failedIds: number[];
      hasBack: boolean;
    };

type ExtractedDeck = {
  /** filename → blob */
  blobs: Map<string, Blob>;
  /** card_id → filename */
  assignments: Map<number, string>;
  /** filenames not assigned to any card (the "tray") */
  tray: string[];
  /** filename considered the card-back (or null) */
  cardBack: string | null;
};

function makeBlobUrlMap(deck: ExtractedDeck): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, blob] of deck.blobs) {
    out.set(name, URL.createObjectURL(blob));
  }
  return out;
}

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
  /** Fired when user taps Done on the summary screen. */
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });

  const handleFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".zip") && file.type !== "application/zip" && file.type !== "application/x-zip-compressed") {
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
      const blobs = new Map<string, Blob>();
      const entries: JSZip.JSZipObject[] = [];
      zip.forEach((_path, entry) => {
        if (!entry.dir) entries.push(entry);
      });
      for (const entry of entries) {
        const base = entry.name.split("/").pop() ?? entry.name;
        if (!VALID_EXT.test(base)) continue;
        const blob = await entry.async("blob");
        blobs.set(base, blob);
      }
      if (blobs.size === 0) {
        toast.error("No card images found in this zip. Make sure the zip contains image files.");
        setPhase({ kind: "upload" });
        return;
      }
      const filenames = Array.from(blobs.keys());
      const match: MatchResult = matchFilenames(filenames);
      const assignments = new Map<number, string>();
      for (const [file, cardId] of match.assignments) {
        assignments.set(cardId, file);
      }
      const data: ExtractedDeck = {
        blobs,
        assignments,
        tray: match.unmatched,
        cardBack: match.cardBackFile,
      };
      if (assignments.size >= 60) setPhase({ kind: "review", data });
      else setPhase({ kind: "wizard", data });
    } catch (err) {
      console.error("Zip read failed", err);
      toast.error("Couldn't read that zip file.");
      setPhase({ kind: "upload" });
    }
  }, []);

  if (phase.kind === "upload") {
    return <UploadStep onFile={handleFile} onCancel={onCancel} />;
  }
  if (phase.kind === "extracting") {
    return <Centered text="Reading your deck…" />;
  }
  if (phase.kind === "review") {
    return (
      <ReviewGrid
        data={phase.data}
        onCancel={onCancel}
        onSwitchToWizard={() =>
          setPhase({ kind: "wizard", data: phase.data })
        }
        onProceed={() => setPhase({ kind: "back", data: phase.data })}
      />
    );
  }
  if (phase.kind === "wizard") {
    return (
      <Wizard
        data={phase.data}
        onCancel={onCancel}
        onProceed={() => setPhase({ kind: "back", data: phase.data })}
      />
    );
  }
  if (phase.kind === "back") {
    return (
      <CardBackStep
        data={phase.data}
        onCancel={onCancel}
        onProceed={async () => {
          // Move into processing.
          const data = phase.data;
          const total = data.assignments.size + (data.cardBack ? 1 : 0);
          setPhase({ kind: "processing", data, done: 0, total });
          await runProcessing({
            data,
            userId,
            deckId,
            shape,
            cornerRadiusPercent,
            onProgress: (done) =>
              setPhase({ kind: "processing", data, done, total }),
            onComplete: (result) =>
              setPhase({
                kind: "summary",
                assignedCount: result.assignedCount,
                skippedCount: 78 - result.assignedCount,
                lowResIds: result.lowResIds,
                failedIds: result.failedIds,
                hasBack: result.hasBack,
              }),
          });
        }}
      />
    );
  }
  if (phase.kind === "processing") {
    return (
      <Centered
        text={`Saving your deck… ${phase.done} of ${phase.total} processed`}
      />
    );
  }
  return <Summary phase={phase} onDone={onDone} />;
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Upload                                                    */
/* ------------------------------------------------------------------ */

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
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--border-subtle)",
        }}
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
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.85,
          }}
        >
          Upload a .zip containing your card images. Up to 20MB. Filenames
          help us auto-match — if they don't match, you'll pick each card by
          hand.
        </p>

        <label
          className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2"
          style={{
            borderColor: "var(--accent)",
            color: "var(--accent)",
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
      <Loader2
        className="h-6 w-6 animate-spin"
        style={{ color: "var(--accent)" }}
      />
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

/* ------------------------------------------------------------------ */
/*  Step 3a — Review grid                                              */
/* ------------------------------------------------------------------ */

function ReviewGrid({
  data,
  onCancel,
  onSwitchToWizard,
  onProceed,
}: {
  data: ExtractedDeck;
  onCancel: () => void;
  onSwitchToWizard: () => void;
  onProceed: () => void;
}) {
  // Local mutable state — drag-drop swaps shift entries between
  // assignments and tray. We seed from the immutable `data` once.
  const [assignments, setAssignments] = useState(
    () => new Map(data.assignments),
  );
  const [tray, setTray] = useState<string[]>(() => [...data.tray]);
  const [selectedTrayName, setSelectedTrayName] = useState<string | null>(null);

  // Object URL cache for blobs we render in the grid.
  const blobUrls = useMemo(() => makeBlobUrlMap(data), [data]);
  useEffect(() => {
    return () => {
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    };
  }, [blobUrls]);

  // Mirror local state back to data so the next step (back/processing) sees fresh values.
  useEffect(() => {
    data.assignments = assignments;
    data.tray = tray;
  }, [assignments, tray, data]);

  const assignToCard = (filename: string, cardId: number) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      const previousFile = next.get(cardId) ?? null;
      next.set(cardId, filename);
      // Remove this filename from any other slot it occupied.
      for (const [cid, fn] of next) {
        if (cid !== cardId && fn === filename) next.delete(cid);
      }
      setTray((prevTray) => {
        const t = prevTray.filter((n) => n !== filename);
        if (previousFile && previousFile !== filename) t.push(previousFile);
        return t;
      });
      return next;
    });
    setSelectedTrayName(null);
  };

  const matched = assignments.size;

  const handleSave = async () => {
    if (matched < 78) {
      const ok = confirm(
        `Save with ${matched} cards? You can photograph the rest later.`,
      );
      if (!ok) return;
    }
    onProceed();
  };

  return (
    <section className="py-6">
      <div
        className="mb-4 rounded-md border px-4 py-3"
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--border-subtle)",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
        }}
      >
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>
          {matched} of 78
        </span>{" "}
        auto-matched. Drag images to fix mismatches or fill empty slots.
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 78 }, (_, i) => {
          const filename = assignments.get(i);
          const src = filename ? blobUrls.get(filename) : null;
          return (
            <button
              type="button"
              key={i}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const name = e.dataTransfer.getData("text/plain");
                if (name) assignToCard(name, i);
              }}
              onClick={() => {
                if (selectedTrayName) assignToCard(selectedTrayName, i);
              }}
              className="group relative aspect-[0.625] overflow-hidden rounded border"
              style={{
                borderColor: src
                  ? "var(--border-subtle)"
                  : "var(--border-subtle)",
                background: "var(--surface-card)",
              }}
              title={getCardName(i)}
            >
              {src ? (
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
                  style={{ opacity: 0.25, filter: "grayscale(100%)" }}
                />
              )}
              {src && (
                <span
                  className="absolute right-1 top-1 rounded-full p-0.5"
                  style={{ background: "var(--accent)", color: "#000" }}
                >
                  <Check className="h-3 w-3" />
                </span>
              )}
              {!src && (
                <span
                  className="pointer-events-none absolute inset-x-0 bottom-1 text-center"
                  style={{
                    fontSize: "10px",
                    color: "var(--color-foreground)",
                    opacity: 0.55,
                  }}
                >
                  Drop image here
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tray.length > 0 && (
        <div
          className="mt-4 rounded-md border p-2"
          style={{
            background: "var(--surface-card)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <p
            className="mb-2 px-1"
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.7,
            }}
          >
            Unmatched ({tray.length})
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tray.map((name) => {
              const url = blobUrls.get(name);
              const selected = selectedTrayName === name;
              return (
                <button
                  type="button"
                  key={name}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", name)
                  }
                  onClick={() =>
                    setSelectedTrayName(selected ? null : name)
                  }
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded border"
                  style={{
                    borderColor: selected
                      ? "var(--accent)"
                      : "var(--border-subtle)",
                    borderWidth: selected ? 2 : 1,
                  }}
                  title={name}
                >
                  {url && (
                    <img
                      src={url}
                      alt={name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          className="rounded-md px-4 py-2"
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
          onClick={onSwitchToWizard}
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--accent)",
          }}
        >
          Switch to wizard
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
          Cancel
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3b — Sequential wizard                                        */
/* ------------------------------------------------------------------ */

function Wizard({
  data,
  onCancel,
  onProceed,
}: {
  data: ExtractedDeck;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const [assignments, setAssignments] = useState(
    () => new Map(data.assignments),
  );
  const [available, setAvailable] = useState<string[]>(() => [...data.tray]);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [pass, setPass] = useState<1 | 2>(1);
  const [zoom, setZoom] = useState<string | null>(null);

  const blobUrls = useMemo(() => makeBlobUrlMap(data), [data]);
  useEffect(
    () => () => {
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    },
    [blobUrls],
  );

  // Mirror local state to parent envelope.
  useEffect(() => {
    data.assignments = assignments;
    data.tray = available;
  }, [assignments, available, data]);

  const order = useMemo(() => canonicalOrder(), []);

  // Compute next target card.
  const target = useMemo(() => {
    if (pass === 1) {
      for (const id of order) {
        if (!assignments.has(id) && !skipped.includes(id)) return id;
      }
      return null;
    }
    // Pass 2: revisit previously skipped cards.
    for (const id of skipped) if (!assignments.has(id)) return id;
    return null;
  }, [pass, order, assignments, skipped]);

  // Auto-advance to pass 2 / proceed when no target left in current pass.
  useEffect(() => {
    if (target !== null) return;
    if (pass === 1 && skipped.length > 0) {
      setPass(2);
      return;
    }
    onProceed();
  }, [target, pass, skipped.length, onProceed]);

  const assignedCount = assignments.size;

  const useImage = (filename: string) => {
    if (target === null) return;
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(target, filename);
      return next;
    });
    setAvailable((prev) => prev.filter((n) => n !== filename));
    // If we had skipped this card on pass 1, drop from skipped list.
    setSkipped((prev) => prev.filter((id) => id !== target));
    setZoom(null);
  };

  const skipCurrent = () => {
    if (target === null) return;
    setSkipped((prev) => (prev.includes(target) ? prev : [...prev, target]));
  };

  const skipAllRemaining = () => {
    const remainingCount = 78 - assignments.size;
    if (
      !confirm(
        `Save deck with ${assignments.size} cards? ${remainingCount} will be empty.`,
      )
    )
      return;
    onProceed();
  };

  if (target === null) return <Centered text="Wrapping up…" />;

  return (
    <section className="py-4">
      {/* Header */}
      <div
        className="sticky top-0 z-10 -mx-4 mb-3 border-b px-4 py-3 backdrop-blur"
        style={{
          background: "color-mix(in oklab, var(--surface-card) 92%, transparent)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-7 shrink-0 items-center justify-center rounded border"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              opacity: 0.7,
            }}
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p
              className="italic"
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--color-foreground)",
                opacity: 0.6,
              }}
            >
              Now choosing
            </p>
            <p
              className="truncate italic"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-heading-sm)",
                color: "var(--accent)",
              }}
            >
              {getCardName(target)}
            </p>
          </div>
        </div>

        <div
          className="mt-2 h-1 w-full overflow-hidden rounded-full"
          style={{ background: "var(--border-subtle)" }}
        >
          <div
            className="h-full"
            style={{
              width: `${(assignedCount / 78) * 100}%`,
              background: "var(--accent)",
              transition: "width 200ms ease",
            }}
          />
        </div>
        <p
          className="mt-1"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          {assignedCount} of 78 assigned · {skipped.length} skipped
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {available.map((name) => {
          const url = blobUrls.get(name);
          return (
            <button
              type="button"
              key={name}
              onClick={() => setZoom(name)}
              className="aspect-square overflow-hidden rounded border"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--surface-card)",
              }}
            >
              {url && (
                <img
                  src={url}
                  alt={name}
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={skipCurrent}
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--accent)",
          }}
        >
          Skip this card
        </button>
        {pass === 2 && (
          <button
            type="button"
            onClick={skipAllRemaining}
            className="italic"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.7,
            }}
          >
            Skip all remaining
          </button>
        )}
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
          Cancel
        </button>
      </div>

      {zoom && (
        <ZoomModal
          src={blobUrls.get(zoom) ?? ""}
          onUse={() => useImage(zoom)}
          onBack={() => setZoom(null)}
        />
      )}
    </section>
  );
}

function ZoomModal({
  src,
  onUse,
  onBack,
}: {
  src: string;
  onUse: () => void;
  onBack: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center p-4"
      style={{ background: "var(--surface-overlay, rgba(0,0,0,0.85))" }}
    >
      <img
        src={src}
        alt=""
        style={{ maxHeight: "80vh", maxWidth: "100%" }}
        className="rounded"
      />
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-4 py-2"
          style={{
            background: "transparent",
            color: "var(--color-foreground)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onUse}
          className="rounded-md px-4 py-2 font-medium"
          style={{
            background: "var(--accent)",
            color: "#000",
            fontSize: "var(--text-body-sm)",
          }}
        >
          Use this
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4 — Card back                                                 */
/* ------------------------------------------------------------------ */

function CardBackStep({
  data,
  onCancel,
  onProceed,
}: {
  data: ExtractedDeck;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const blobUrls = useMemo(() => makeBlobUrlMap(data), [data]);
  useEffect(
    () => () => {
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    },
    [blobUrls],
  );

  // Pool of images NOT currently assigned to any card.
  const assignedFiles = new Set(data.assignments.values());
  const pool = Array.from(data.blobs.keys()).filter(
    (n) => !assignedFiles.has(n),
  );

  if (data.cardBack && !picking) {
    const url = blobUrls.get(data.cardBack);
    return (
      <section className="flex flex-col items-center py-8">
        <h2
          className="mb-4 italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-md)",
            color: "var(--accent)",
          }}
        >
          Is this your card back?
        </h2>
        {url && (
          <img
            src={url}
            alt="Candidate card back"
            style={{ maxHeight: "50vh" }}
            className="rounded"
          />
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="rounded-md px-4 py-2"
            style={{
              background: "transparent",
              color: "var(--color-foreground)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            No, pick another
          </button>
          <button
            type="button"
            onClick={onProceed}
            className="rounded-md px-4 py-2 font-medium"
            style={{
              background: "var(--accent)",
              color: "#000",
              fontSize: "var(--text-body-sm)",
            }}
          >
            Yes, use this
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="py-6">
      <h2
        className="mb-3 italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-heading-sm)",
          color: "var(--accent)",
        }}
      >
        Choose card back
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {pool.map((name) => {
          const url = blobUrls.get(name);
          return (
            <button
              type="button"
              key={name}
              onClick={() => setZoom(name)}
              className="aspect-square overflow-hidden rounded border"
              style={{
                borderColor:
                  data.cardBack === name
                    ? "var(--accent)"
                    : "var(--border-subtle)",
                borderWidth: data.cardBack === name ? 2 : 1,
                background: "var(--surface-card)",
              }}
            >
              {url && (
                <img src={url} alt={name} className="h-full w-full object-cover" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => {
            data.cardBack = null;
            onProceed();
          }}
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          Skip card back
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
          Cancel
        </button>
      </div>

      {zoom && (
        <ZoomModal
          src={blobUrls.get(zoom) ?? ""}
          onUse={() => {
            data.cardBack = zoom;
            setZoom(null);
            onProceed();
          }}
          onBack={() => setZoom(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 5 — Processing                                                */
/* ------------------------------------------------------------------ */

type ProcessResult = {
  assignedCount: number;
  lowResIds: number[];
  failedIds: number[];
  hasBack: boolean;
};

async function runProcessing(args: {
  data: ExtractedDeck;
  userId: string;
  deckId: string;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  onProgress: (done: number) => void;
  onComplete: (result: ProcessResult) => void;
}): Promise<void> {
  const { data, userId, deckId, shape, cornerRadiusPercent, onProgress, onComplete } = args;
  const lowResIds: number[] = [];
  const failedIds: number[] = [];
  let done = 0;
  let assignedCount = 0;

  // Process card slots serially.
  for (const [cardId, filename] of data.assignments) {
    const blob = data.blobs.get(filename);
    if (!blob) {
      failedIds.push(cardId);
      done++;
      onProgress(done);
      continue;
    }
    try {
      const processed = await processImageBlob(blob, shape, cornerRadiusPercent);
      if (processed.sourceLongestEdge < LOW_RES_THRESHOLD) lowResIds.push(cardId);

      const ts = Date.now();
      const displayPath = `${userId}/${deckId}/card-${cardId}-${ts}.webp`;
      const thumbPath = `${userId}/${deckId}/card-${cardId}-${ts}-thumb.webp`;

      const upDisplay = await supabase.storage
        .from(DECK_BUCKET)
        .upload(displayPath, processed.display, {
          contentType: "image/webp",
          upsert: true,
        });
      if (upDisplay.error) throw upDisplay.error;
      const upThumb = await supabase.storage
        .from(DECK_BUCKET)
        .upload(thumbPath, processed.thumbnail, {
          contentType: "image/webp",
          upsert: true,
        });
      if (upThumb.error) throw upThumb.error;

      const year = 60 * 60 * 24 * 365;
      const [{ data: dispSigned }, { data: thumbSigned }] = await Promise.all([
        supabase.storage.from(DECK_BUCKET).createSignedUrl(displayPath, year),
        supabase.storage.from(DECK_BUCKET).createSignedUrl(thumbPath, year),
      ]);

      // Replace any existing row.
      await supabase
        .from("custom_deck_cards")
        .delete()
        .eq("deck_id", deckId)
        .eq("card_id", cardId);
      const ins = await supabase.from("custom_deck_cards").insert({
        deck_id: deckId,
        user_id: userId,
        card_id: cardId,
        display_url: dispSigned?.signedUrl ?? "",
        thumbnail_url: thumbSigned?.signedUrl ?? "",
        display_path: displayPath,
        thumbnail_path: thumbPath,
      });
      if (ins.error) throw ins.error;
      assignedCount++;
    } catch (err) {
      console.error(`Failed to process card ${cardId}`, err);
      failedIds.push(cardId);
    }
    done++;
    onProgress(done);
  }

  // Card back (if any).
  let hasBack = false;
  if (data.cardBack) {
    const blob = data.blobs.get(data.cardBack);
    if (blob) {
      try {
        const processed = await processImageBlob(blob, shape, cornerRadiusPercent);
        const ts = Date.now();
        const path = `${userId}/${deckId}/back-${ts}.webp`;
        const thumbPath = `${userId}/${deckId}/back-${ts}-thumb.webp`;
        await supabase.storage
          .from(DECK_BUCKET)
          .upload(path, processed.display, {
            contentType: "image/webp",
            upsert: true,
          });
        await supabase.storage
          .from(DECK_BUCKET)
          .upload(thumbPath, processed.thumbnail, {
            contentType: "image/webp",
            upsert: true,
          });
        const year = 60 * 60 * 24 * 365;
        const [{ data: backSigned }, { data: backThumbSigned }] =
          await Promise.all([
            supabase.storage.from(DECK_BUCKET).createSignedUrl(path, year),
            supabase.storage.from(DECK_BUCKET).createSignedUrl(thumbPath, year),
          ]);
        await supabase
          .from("custom_decks")
          .update({
            card_back_url: backSigned?.signedUrl ?? null,
            card_back_thumb_url: backThumbSigned?.signedUrl ?? null,
          })
          .eq("id", deckId);
        hasBack = true;
      } catch (err) {
        console.error("Card-back processing failed", err);
      }
    }
    done++;
    onProgress(done);
  }

  if (assignedCount >= 78 && hasBack) {
    await supabase
      .from("custom_decks")
      .update({ is_complete: true })
      .eq("id", deckId);
  }

  onComplete({ assignedCount, lowResIds, failedIds, hasBack });
}

/* ------------------------------------------------------------------ */
/*  Step 6 — Summary                                                   */
/* ------------------------------------------------------------------ */

function Summary({
  phase,
  onDone,
}: {
  phase: Extract<Phase, { kind: "summary" }>;
  onDone: () => void;
}) {
  const { assignedCount, skippedCount, lowResIds, failedIds } = phase;
  const [showLowRes, setShowLowRes] = useState(false);
  return (
    <section className="mx-auto max-w-md py-10 text-center">
      <h2
        className="mb-4 italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-heading-md)",
          color: "var(--accent)",
        }}
      >
        Imported — {assignedCount} of 78 cards
      </h2>

      <div
        className="space-y-3"
        style={{
          fontSize: "var(--text-body)",
          color: "var(--color-foreground)",
        }}
      >
        {skippedCount > 0 && (
          <p>
            {skippedCount} skipped — photograph them anytime to complete the deck.
          </p>
        )}
        {lowResIds.length > 0 && (
          <p>
            {lowResIds.length} low-resolution images flagged. They're saved at
            original size — you may want to retake those.
            <br />
            <button
              type="button"
              onClick={() => setShowLowRes(true)}
              className="mt-1 underline"
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--accent)",
              }}
            >
              See which
            </button>
          </p>
        )}
        {failedIds.length > 0 && (
          <p>
            {failedIds.length} cards failed to process:{" "}
            {failedIds.map((id) => getCardName(id)).join(", ")}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-6 rounded-md px-5 py-2 font-medium"
        style={{
          background: "var(--accent)",
          color: "#000",
          fontSize: "var(--text-body-sm)",
        }}
      >
        Done
      </button>

      {showLowRes && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowLowRes(false)}
        >
          <div
            className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-lg border p-4 text-left"
            style={{
              background: "var(--surface-card)",
              borderColor: "var(--border-subtle)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3
                className="italic"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-heading-sm)",
                  color: "var(--accent)",
                }}
              >
                Low-resolution cards
              </h3>
              <button
                type="button"
                onClick={() => setShowLowRes(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-1">
              {lowResIds.map((id) => (
                <li
                  key={id}
                  style={{
                    fontSize: "var(--text-body-sm)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {getCardName(id)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}