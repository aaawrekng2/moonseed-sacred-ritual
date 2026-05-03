/**
 * DV-7 — Archive view.
 *
 * Lists soft-deleted readings ordered by `archived_at` desc. Each row
 * shows a countdown to permanent deletion and reveals Restore +
 * Delete-forever actions on swipe (mobile) or hover (desktop).
 */
import { useCallback, useEffect, useState } from "react";
import { Archive as ArchiveIcon, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  daysUntilPurge,
  deleteReadingForever,
  fetchArchivedReadings,
  restoreReading,
} from "@/lib/readings-archive";
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
import { spreadLabelOf } from "./archive-helpers";

type ArchivedRow = {
  id: string;
  spread_type: string;
  archived_at: string;
  created_at: string;
  question: string | null;
  interpretation: string | null;
};

export function ArchiveView({
  onChanged,
}: {
  /** Called after a row is restored or permanently deleted so the parent journal can refetch. */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fetchFn = useServerFn(fetchArchivedReadings);
  const restoreFn = useServerFn(restoreReading);
  const deleteFn = useServerFn(deleteReadingForever);

  const load = useCallback(async () => {
    const headers = await getAuthHeaders();
    const res = await fetchFn({ headers });
    setRows((res.readings ?? []) as ArchivedRow[]);
  }, [fetchFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = async (id: string) => {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    const headers = await getAuthHeaders();
    const res = await restoreFn({ data: { readingId: id }, headers });
    if (!res.ok) {
      toast.error("Couldn't restore reading.");
      void load();
      return;
    }
    toast.success("Reading restored.");
    onChanged?.();
  };

  const handleDeleteConfirmed = async () => {
    const id = pendingDelete;
    if (!id) return;
    setPendingDelete(null);
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    const headers = await getAuthHeaders();
    const res = await deleteFn({ data: { readingId: id }, headers });
    if (!res.ok) {
      toast.error("Couldn't delete reading.");
      void load();
      return;
    }
    toast.success("Reading deleted.");
    onChanged?.();
  };

  if (rows === null) {
    return (
      <p
        className="mt-12 text-center font-display text-sm italic text-muted-foreground"
        style={{ opacity: "var(--ro-plus-10)" }}
      >
        …
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p
        className="mx-auto mt-16 max-w-sm text-center font-display text-[14px] italic text-muted-foreground"
        style={{ opacity: "var(--ro-plus-20)" }}
      >
        Nothing here. Archived readings appear here for 30 days before
        they&rsquo;re permanently deleted.
      </p>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-4">
        {rows.map((r) => (
          <ArchiveRow
            key={r.id}
            row={r}
            onRestore={() => void handleRestore(r.id)}
            onRequestDelete={() => setPendingDelete(r.id)}
          />
        ))}
      </ul>
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete forever?</AlertDialogTitle>
            <AlertDialogDescription>
              This reading will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteConfirmed()}
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground, #1a1a1a)",
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ArchiveRow({
  row,
  onRestore,
  onRequestDelete,
}: {
  row: ArchivedRow;
  onRestore: () => void;
  onRequestDelete: () => void;
}) {
  const isMobile = useIsMobile();
  const [revealed, setRevealed] = useState(false);
  const [hover, setHover] = useState(false);
  const days = daysUntilPurge(row.archived_at);
  const showActions = isMobile ? revealed : hover;

  // Touch swipe tracking (mobile).
  const startX = { current: 0 } as { current: number };
  const dx = { current: 0 } as { current: number };

  return (
    <li
      className="relative overflow-hidden rounded-2xl"
      style={{
        border: "1px solid color-mix(in oklab, var(--gold) 8%, transparent)",
        background: "color-mix(in oklab, oklch(0.10 0.03 280) 30%, transparent)",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Action layer (sits behind the row content). */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{
          opacity: showActions ? 1 : 0,
          pointerEvents: showActions ? "auto" : "none",
          transition: "opacity 160ms ease-out",
        }}
      >
        <button
          type="button"
          onClick={onRestore}
          className="flex flex-col items-center justify-center gap-1 px-4 font-display text-[10px] uppercase tracking-[0.18em]"
          style={{
            background: "color-mix(in oklab, var(--gold) 10%, transparent)",
            color: "var(--gold)",
          }}
        >
          <RotateCcw size={16} strokeWidth={1.5} />
          Restore
        </button>
        <button
          type="button"
          onClick={onRequestDelete}
          className="flex flex-col items-center justify-center gap-1 px-4 font-display text-[10px] uppercase tracking-[0.18em]"
          style={{
            background: "color-mix(in oklab, oklch(0.55 0.2 25) 28%, transparent)",
            color: "oklch(0.85 0.12 25)",
          }}
        >
          <Trash2 size={16} strokeWidth={1.5} />
          Delete
        </button>
      </div>
      {/* Sliding content */}
      <button
        type="button"
        onClick={() => {
          // Toggle the action drawer on tap. Archived readings are
          // read-only from this view; restore them to view in detail.
          setRevealed((r) => !r);
        }}
        onTouchStart={(e) => {
          startX.current = e.touches[0]?.clientX ?? 0;
          dx.current = 0;
        }}
        onTouchMove={(e) => {
          dx.current = (e.touches[0]?.clientX ?? 0) - startX.current;
        }}
        onTouchEnd={() => {
          if (dx.current < -60) setRevealed(true);
          else if (dx.current > 40) setRevealed(false);
        }}
        className="relative block w-full px-4 py-4 text-left transition-transform"
        style={{
          transform: showActions ? "translateX(-160px)" : "translateX(0)",
          background:
            "color-mix(in oklab, oklch(0.10 0.03 280) 80%, transparent)",
          transition: "transform 220ms ease-out",
        }}
      >
        <div
          className="font-display text-[11px] italic"
          style={{
            color: "var(--foreground-muted, var(--muted-foreground))",
            opacity: "var(--ro-plus-30)",
          }}
        >
          Permanently deletes in{" "}
          <span style={{ color: "var(--accent)", opacity: 0.85 }}>
            {days} {days === 1 ? "day" : "days"}
          </span>
        </div>
        <div
          className="mt-1 flex items-baseline gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
          style={{ opacity: "var(--ro-plus-30)" }}
        >
          <span>{spreadLabelOf(row.spread_type)}</span>
          <span style={{ opacity: 0.7 }}>
            archived {new Date(row.archived_at).toLocaleDateString()}
          </span>
        </div>
        {row.question && (
          <p
            className="mt-2 font-display text-[13px] italic"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            {row.question}
          </p>
        )}
        {row.interpretation && (
          <p
            className="mt-1 font-display text-[12px] italic text-muted-foreground"
            style={{
              opacity: "var(--ro-plus-10)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {row.interpretation}
          </p>
        )}
        {!isMobile && !revealed && (
          <span
            aria-hidden
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{
              opacity: hover ? 0.6 : 0,
              transition: "opacity 160ms ease",
              color: "var(--foreground-muted, var(--muted-foreground))",
            }}
          >
            <ArchiveIcon size={14} strokeWidth={1.5} />
          </span>
        )}
      </button>
    </li>
  );
}