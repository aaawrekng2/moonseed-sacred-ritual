/**
 * 9-6-AE — Photo Archive panel.
 *
 * Lists every soft-deleted (archived_at IS NOT NULL) reading photo for
 * the signed-in seeker and offers two actions per photo:
 *
 *   - Restore — clear `archived_at` so the photo shows back up on its
 *     reading. Underlying storage object is untouched.
 *   - Delete forever — remove the storage object first, then the row.
 *     Confirmed via the standard confirm dialog.
 *
 * Mounted inside the Data tab so seekers have one place to recover
 * accidentally-removed photos before they're permanently gone.
 */
import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { formatDateTime } from "@/lib/dates";

const PHOTO_BUCKET = "reading-photos";

type ArchivedPhoto = {
  id: string;
  reading_id: string;
  storage_path: string;
  caption: string | null;
  created_at: string;
  archived_at: string;
  signedUrl: string | null;
};

export function PhotoArchive({ userId }: { userId: string }) {
  const [photos, setPhotos] = useState<ArchivedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reading_photos")
      .select("id, reading_id, storage_path, caption, created_at, archived_at")
      .eq("user_id", userId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load archived photos");
      setPhotos([]);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Omit<ArchivedPhoto, "signedUrl">[];
    const signed = await Promise.all(
      rows.map(async (r) => {
        const { data: s } = await supabase.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(r.storage_path, 60 * 60);
        return { ...r, signedUrl: s?.signedUrl ?? null } as ArchivedPhoto;
      }),
    );
    setPhotos(signed);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const restore = async (p: ArchivedPhoto) => {
    setBusyId(p.id);
    const { error } = await supabase
      .from("reading_photos")
      .update({ archived_at: null })
      .eq("id", p.id);
    setBusyId(null);
    if (error) {
      toast.error("Couldn't restore photo");
      return;
    }
    toast.success("Photo restored");
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  };

  const deleteForever = async (p: ArchivedPhoto) => {
    const ok = await confirm({
      title: "Delete this photo forever?",
      description:
        "The image file and its database record will be removed. This cannot be undone.",
      confirmLabel: "Delete forever",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(p.id);
    const { error: storageErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove([p.storage_path]);
    if (storageErr) {
      console.warn("[PhotoArchive] storage remove failed", storageErr);
    }
    const { error } = await supabase
      .from("reading_photos")
      .delete()
      .eq("id", p.id);
    setBusyId(null);
    if (error) {
      toast.error("Couldn't delete photo");
      return;
    }
    toast.success("Photo deleted");
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/40 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading archive…
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No archived photos. Photos you remove from a reading land here for
        30 days before being purged.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {photos.map((p) => (
        <div
          key={p.id}
          className="flex items-start gap-3 rounded-lg border border-border/40 p-2"
        >
          <div
            className="flex-none overflow-hidden rounded border border-border/40 bg-background"
            style={{ width: 56, height: 56 }}
          >
            {p.signedUrl ? (
              <img
                src={p.signedUrl}
                alt={p.caption ?? "Archived photo"}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {p.caption || "Untitled photo"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Removed {formatDateTime(p.archived_at)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busyId === p.id}
                onClick={() => void restore(p)}
              >
                <RotateCcw className="h-3 w-3" /> Restore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-red-400 hover:text-red-300"
                disabled={busyId === p.id}
                onClick={() => void deleteForever(p)}
              >
                <Trash2 className="h-3 w-3" /> Delete forever
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}