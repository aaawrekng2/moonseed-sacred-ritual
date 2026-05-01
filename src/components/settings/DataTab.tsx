/**
 * Settings → Data tab (CI).
 *
 * Sections:
 *   1. Full backup — pick categories, see size estimates, download a ZIP
 *      that includes JSON rows AND (premium-only) binary assets
 *      (deck images, photos)
 *   2. Sign out
 *   3. Clear local cache
 *
 * Account deletion is intentionally not exposed in-app — users contact
 * support so we can clean up across all tables atomically.
 */
import { useEffect, useState } from "react";
import { Archive, Loader2, Lock, LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "./SettingsContext";
import { SettingsSection } from "./sections";
import { useConfirm } from "@/hooks/use-confirm";
import {
  BACKUP_CATEGORIES,
  formatBytes,
  type BackupCategoryId,
} from "@/lib/backup-categories";
import { createBackup, type BackupProgress } from "@/lib/backup-export";

export function DataTab() {
  const { user } = useSettings();
  const [signingOut, setSigningOut] = useState(false);
  const confirm = useConfirm();

  // TODO: wire to Stripe in Phase 10. Until premium ships, every account
  // is treated as free-tier so binary-asset categories stay locked.
  const isPremium = false;

  const [selected, setSelected] = useState<Set<BackupCategoryId>>(
    () =>
      new Set(
        BACKUP_CATEGORIES.filter((c) => isPremium || !c.premium).map(
          (c) => c.id,
        ),
      ),
  );
  const [estimates, setEstimates] = useState<
    Record<BackupCategoryId, { count: number; bytes: number }>
  >({} as Record<BackupCategoryId, { count: number; bytes: number }>);
  const [estimating, setEstimating] = useState(true);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setEstimating(true);
      const next: Record<string, { count: number; bytes: number }> = {};
      await Promise.all(
        BACKUP_CATEGORIES.map(async (c) => {
          try {
            next[c.id] = await c.estimate(user.id);
          } catch {
            next[c.id] = { count: 0, bytes: 0 };
          }
        }),
      );
      if (!cancelled) {
        setEstimates(next as Record<BackupCategoryId, { count: number; bytes: number }>);
        setEstimating(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const totalBytes = Array.from(selected).reduce(
    (sum, id) => {
      const cat = BACKUP_CATEGORIES.find((c) => c.id === id);
      if (cat?.premium && !isPremium) return sum;
      return sum + (estimates[id]?.bytes ?? 0);
    },
    0,
  );

  const toggle = (id: BackupCategoryId) => {
    const cat = BACKUP_CATEGORIES.find((c) => c.id === id);
    if (cat?.premium && !isPremium) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBackup = async () => {
    if (selected.size === 0) {
      toast.error("Pick at least one category");
      return;
    }
    setBackupRunning(true);
    setBackupProgress(null);
    try {
      const blob = await createBackup({
        userId: user.id,
        categories: Array.from(selected),
        isPremium,
        onProgress: (p) => setBackupProgress(p),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moonseed-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't create backup");
    } finally {
      setBackupRunning(false);
      setBackupProgress(null);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    setSigningOut(false);
    if (error) {
      toast.error("Couldn't sign out");
      return;
    }
    window.location.href = "/";
  };

  const clearLocal = async () => {
    if (typeof window === "undefined") return;
    const ok = await confirm({
      title: "Clear cached settings?",
      description: "All locally cached Moonseed settings on this device will be removed. Your account data is unaffected.",
      confirmLabel: "Clear",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("moonseed:") || k.startsWith("arcana:"))
      .forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Full backup"
        description="Choose what to include. Custom decks and photos are bundled as image files alongside their JSON metadata."
      >
        <div className="space-y-3">
          {BACKUP_CATEGORIES.map((c) => {
            const est = estimates[c.id];
            const locked = c.premium && !isPremium;
            return (
              <label
                key={c.id}
                className={`flex items-start gap-3 rounded-lg border border-border/40 p-3 ${
                  locked
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer hover:bg-foreground/5"
                }`}
              >
                <Checkbox
                  checked={selected.has(c.id)}
                  onCheckedChange={() => toggle(c.id)}
                  disabled={locked}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {locked && (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {c.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {estimating
                        ? "…"
                        : est && est.count > 0
                          ? `${est.count} · ~${formatBytes(est.bytes)}`
                          : "empty"}
                      {locked && (
                        <span className="ml-2 italic">Premium</span>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
              </label>
            );
          })}

          <div className="flex items-center justify-between border-t border-border/40 pt-3 text-sm">
            <span className="text-muted-foreground">
              Estimated download
            </span>
            <span className="font-medium">
              {estimating ? "calculating…" : `~${formatBytes(totalBytes)}`}
            </span>
          </div>

          <Button
            onClick={() => void runBackup()}
            disabled={backupRunning || selected.size === 0}
            className="w-full justify-start gap-2 sm:w-auto"
          >
            {backupRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            {backupRunning
              ? backupProgress
                ? `Packing ${backupProgress.phase} (${backupProgress.current}/${backupProgress.total})`
                : "Preparing…"
              : "Download backup (.zip)"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Large backups (lots of photos or custom decks) may take a minute.
            Keep this tab open until the download begins.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Local Cache"
        description="Reset locally cached settings without touching your account."
      >
        <Button
          variant="ghost"
          onClick={clearLocal}
          className="w-full justify-start gap-2 sm:w-auto"
        >
          <RotateCcw className="h-4 w-4" />
          Clear local cache
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Session"
        description="Sign out from this device."
      >
        <Button
          variant="outline"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="w-full justify-start gap-2 sm:w-auto"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          Sign out
        </Button>
        <p className="text-xs text-muted-foreground">
          To delete your account permanently, please contact support.
        </p>
      </SettingsSection>
    </div>
  );
}