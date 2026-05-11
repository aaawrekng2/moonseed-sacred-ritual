/**
 * Settings → Data tab (CJ).
 *
 * Sections:
 *   1. Full backup — pick categories, see size estimates, download a ZIP
 *      that includes JSON rows AND (premium-only) binary assets
 *      (deck images, photos)
 *   2. Restore from backup — upload one or more ZIP parts, preview the
 *      manifest, pick categories, and replay them into the account.
 *      Conflict policy is row-merge (skip duplicates); preferences is
 *      the lone exception and overwrites with explicit confirmation.
 *   3. Sign out
 *   4. Clear local cache
 *
 * Account deletion is intentionally not exposed in-app — users contact
 * support so we can clean up across all tables atomically.
 */
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  FileUp,
  Loader2,
  Lock,
  LogOut,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
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
import {
  executeRestore,
  readBackupManifest,
  type BackupManifestV1,
  type RestoreResult,
} from "@/lib/backup-restore";
import type JSZip from "jszip";
import { ImportFlow, type ImportResult } from "@/components/import/ImportFlow";
import { usePremium } from "@/lib/premium";
import { formatDateTime } from "@/lib/dates";
import { PhotoArchive } from "./PhotoArchive";

const CATEGORY_LABEL: Record<string, string> = {
  readings: "Readings",
  preferences: "Preferences",
  user_tags: "Tags",
  user_streaks: "Streak history",
  custom_guides: "Custom guides",
  custom_decks: "Custom decks",
  reading_photos: "Reading photos",
};
const PREMIUM_CATEGORY_IDS = new Set(["custom_decks", "reading_photos"]);

type RestorePhase = "pick" | "preview" | "running" | "done";
type LoadedPart = {
  file: File;
  manifest: BackupManifestV1;
  zip: JSZip;
};

export function DataTab() {
  const { user } = useSettings();
  const [signingOut, setSigningOut] = useState(false);
  const confirm = useConfirm();

  // CU — read real premium state. While loading, suppress lock UI so
  // premium users don't see categories briefly flash locked.
  const { isPremium, loading: premiumLoading } = usePremium(user?.id);
  // While loading we treat the user as premium so premium categories
  // don't briefly flash locked for premium users.
  const effectivePremium = premiumLoading || isPremium;

  // CU — when premium state resolves to false, drop premium categories
  // from the seeded selection so a free user doesn't have them queued.
  useEffect(() => {
    if (premiumLoading) return;
    if (isPremium) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of PREMIUM_CATEGORY_IDS) {
        next.delete(id as BackupCategoryId);
      }
      return next;
    });
  }, [premiumLoading, isPremium]);

  const [selected, setSelected] = useState<Set<BackupCategoryId>>(
    () =>
      new Set(
        BACKUP_CATEGORIES.filter((c) => effectivePremium || !c.premium).map(
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

  // ---- Restore state ----
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("pick");
  const [parts, setParts] = useState<LoadedPart[]>([]);
  const [restoreSelected, setRestoreSelected] = useState<Set<string>>(new Set());
  const [restoreMessage, setRestoreMessage] = useState<string>("");
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CS — universal CSV importer (TarotPulse + generic with column mapping)
  const [importOpen, setImportOpen] = useState(false);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);

  const resetRestore = () => {
    setRestorePhase("pick");
    setParts([]);
    setRestoreSelected(new Set());
    setRestoreMessage("");
    setRestoreResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    try {
      const loaded: LoadedPart[] = [];
      for (const f of arr) {
        const { manifest, zip } = await readBackupManifest(f);
        loaded.push({ file: f, manifest, zip });
      }
      // Validate against existing parts (same exported_at, schema 1).
      const all = [...parts, ...loaded];
      const exportedAts = new Set(all.map((p) => p.manifest.exported_at));
      if (exportedAts.size > 1) {
        toast.error("Those files come from different backups");
        return;
      }
      const totalParts = all[0].manifest.total_parts ?? 1;
      const indices = new Set<number>();
      for (const p of all) {
        const idx = p.manifest.part_index ?? 1;
        if (idx < 1 || idx > totalParts || indices.has(idx)) {
          toast.error("Mismatched or duplicate part");
          return;
        }
        indices.add(idx);
      }
      setParts(all);
      // Prefill selection from part-1 manifest categories.
      const part1 = all.find((p) => (p.manifest.part_index ?? 1) === 1) ?? all[0];
      if (part1) {
        const next = new Set<string>();
        for (const c of part1.manifest.categories) {
          if (PREMIUM_CATEGORY_IDS.has(c) && !effectivePremium) continue;
          next.add(c);
        }
        setRestoreSelected(next);
      }
      setRestorePhase("preview");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't read backup");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const totalParts =
    parts[0]?.manifest.total_parts ?? (parts.length > 0 ? 1 : 0);
  const haveAllParts = totalParts > 0 && parts.length === totalParts;

  const toggleRestoreCategory = (id: string) => {
    if (PREMIUM_CATEGORY_IDS.has(id) && !effectivePremium) return;
    setRestoreSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runRestore = async () => {
    if (parts.length === 0 || restoreSelected.size === 0) return;
    const part1 =
      parts.find((p) => (p.manifest.part_index ?? 1) === 1) ?? parts[0];

    // Build a confirmation summary.
    const lines: string[] = [];
    for (const id of restoreSelected) {
      const info = part1.manifest.contents[id];
      const label = CATEGORY_LABEL[id] ?? id;
      if (id === "preferences") {
        lines.push("Your preferences will be REPLACED with the backed-up settings.");
      } else {
        const n = info?.rows ?? 0;
        lines.push(`${n} ${label.toLowerCase()} will be added (any duplicates skipped).`);
      }
    }
    lines.push("This cannot be undone.");

    const ok = await confirm({
      title: "Restore from backup?",
      description: lines.join(" "),
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
      destructive: false,
    });
    if (!ok) return;

    setRestorePhase("running");
    setRestoreMessage("Validating backup…");
    try {
      const orderedZips = [...parts]
        .sort(
          (a, b) =>
            (a.manifest.part_index ?? 1) - (b.manifest.part_index ?? 1),
        )
        .map((p) => p.zip);
      const r = await executeRestore({
        zips: orderedZips,
        selectedCategories: Array.from(restoreSelected),
        userId: user.id,
        isPremium: effectivePremium,
        onProgress: (msg) => setRestoreMessage(msg),
      });
      setRestoreResult(r);
      setRestorePhase("done");
      toast.success("Restore complete");
    } catch (e) {
      toast.error((e as Error).message || "Restore failed");
      setRestorePhase("preview");
    }
  };

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
      if (cat?.premium && !effectivePremium) return sum;
      return sum + (estimates[id]?.bytes ?? 0);
    },
    0,
  );

  const toggle = (id: BackupCategoryId) => {
    const cat = BACKUP_CATEGORIES.find((c) => c.id === id);
    if (cat?.premium && !effectivePremium) return;
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
        isPremium: effectivePremium,
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
    await signOutAndClear();
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
            const locked = c.premium && !effectivePremium;
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
                ? `Packing ${backupProgress.phase} ${
                    typeof backupProgress.pct === "number"
                      ? `${Math.round(backupProgress.pct)}%`
                      : `(${backupProgress.current}/${backupProgress.total})`
                  }`
                : "Preparing…"
              : "Download backup (.zip)"}
          </Button>
          {backupRunning && backupProgress && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{
                background:
                  "color-mix(in oklab, var(--gold) 12%, transparent)",
              }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(backupProgress.pct ?? 0)}
            >
              <div
                className="h-full transition-[width] duration-200 ease-out"
                style={{
                  width: `${Math.max(2, Math.min(100, backupProgress.pct ?? 0))}%`,
                  background: "var(--gold)",
                  opacity: 0.85,
                }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Large backups (lots of photos or custom decks) may take a minute.
            Keep this tab open until the download begins.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Restore from backup"
        description="Upload a backup ZIP (or all parts of a multi-part backup), pick what to restore, and merge it into your account."
      >
        <RestorePanel
          phase={restorePhase}
          parts={parts}
          totalParts={totalParts}
          haveAllParts={haveAllParts}
          selected={restoreSelected}
          effectivePremium={effectivePremium}
          message={restoreMessage}
          result={restoreResult}
          fileInputRef={fileInputRef}
          onFiles={(f) => void handleFiles(f)}
          onToggle={toggleRestoreCategory}
          onRestore={() => void runRestore()}
          onReset={resetRestore}
          onRemovePart={(idx) =>
            setParts((prev) => prev.filter((_, i) => i !== idx))
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Import from another app"
        description="Bring your reading history from any tarot journal."
      >
        <p className="text-xs text-muted-foreground">
          Currently supports: TarotPulse · Generic CSV (with column mapping)
        </p>
        {lastImport && (
          <div className="rounded-lg border border-border/40 bg-foreground/5 p-3 text-xs">
            Imported {lastImport.imported.toLocaleString()} readings from{" "}
            <strong>{lastImport.sourceFormat}</strong>.
          </div>
        )}
        <Button
          variant="ghost"
          onClick={() => setImportOpen(true)}
          className="w-full justify-start gap-2 sm:w-auto"
        >
          <FileUp className="h-4 w-4" />
          Choose CSV file
        </Button>
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
        title="Archived photos"
        description="Reading photos you removed are kept here so you can restore or permanently delete them."
      >
        <PhotoArchive userId={user.id} />
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

      {importOpen && (
        <ImportFlow
          onClose={() => setImportOpen(false)}
          onImported={(r) => setLastImport(r)}
        />
      )}
    </div>
  );
}

type RestorePanelProps = {
  phase: RestorePhase;
  parts: LoadedPart[];
  totalParts: number;
  haveAllParts: boolean;
  selected: Set<string>;
  effectivePremium: boolean;
  message: string;
  result: RestoreResult | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[] | null) => void;
  onToggle: (id: string) => void;
  onRestore: () => void;
  onReset: () => void;
  onRemovePart: (idx: number) => void;
};

function RestorePanel({
  phase,
  parts,
  totalParts,
  haveAllParts,
  selected,
  effectivePremium,
  message,
  result,
  fileInputRef,
  onFiles,
  onToggle,
  onRestore,
  onReset,
  onRemovePart,
}: RestorePanelProps) {
  if (phase === "pick") {
    return (
      <div className="space-y-3">
        <label
          htmlFor="restore-file"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground hover:bg-foreground/5"
        >
          <FileUp className="h-6 w-6" />
          <span>Drop a backup ZIP here, or click to choose a file.</span>
        </label>
        <input
          ref={fileInputRef}
          id="restore-file"
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
    );
  }

  if (phase === "preview") {
    const part1 =
      parts.find((p) => (p.manifest.part_index ?? 1) === 1) ?? parts[0];
    const created = part1
      ? formatDateTime(part1.manifest.exported_at)
      : "";
    const categories = part1?.manifest.categories ?? [];

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border/40 p-3 text-xs">
          <div className="mb-2 text-muted-foreground">Created: {created}</div>
          <div className="space-y-1">
            {Array.from({ length: Math.max(totalParts, 1) }).map((_, i) => {
              const idx = i + 1;
              const found = parts.find(
                (p) => (p.manifest.part_index ?? 1) === idx,
              );
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between"
                >
                  <span>
                    Part {idx} of {totalParts || 1}
                    {found ? `: ${found.file.name}` : ""}
                  </span>
                  {found ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => onRemovePart(parts.indexOf(found))}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose file
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        <div className="space-y-2">
          {categories.map((id) => {
            const label = CATEGORY_LABEL[id] ?? id;
            const info = part1?.manifest.contents[id];
            const locked = PREMIUM_CATEGORY_IDS.has(id) && !effectivePremium;
            return (
              <label
                key={id}
                className={`flex items-start gap-3 rounded-lg border border-border/40 p-2.5 ${
                  locked
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer hover:bg-foreground/5"
                }`}
              >
                <Checkbox
                  checked={selected.has(id)}
                  onCheckedChange={() => onToggle(id)}
                  disabled={locked}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {locked && (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {label}
                      {id === "preferences" && (
                        <span className="text-xs italic text-muted-foreground">
                          (replaces current)
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {info?.rows != null ? `${info.rows}` : ""}
                      {info?.files ? ` · ${info.files} files` : ""}
                      {locked && <span className="ml-2 italic">Premium</span>}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onRestore}
            disabled={!haveAllParts || selected.size === 0}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Restore selected
          </Button>
          <Button variant="ghost" onClick={onReset}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/40 p-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{message || "Restoring…"}</span>
      </div>
    );
  }

  // phase === "done"
  const skippedPremium =
    Object.values(result?.perCategory ?? {}).reduce(
      (s, v) => s + (v.filesSkippedPremium ?? 0),
      0,
    ) > 0;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/40 p-3 text-sm">
        <div className="mb-2 font-medium">Restore complete</div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {Object.entries(result?.perCategory ?? {}).map(([id, r]) => {
            const label = CATEGORY_LABEL[id] ?? id;
            if (id === "preferences") {
              return <li key={id}>{label}: {r.overwrote ? "replaced" : "no change"}</li>;
            }
            return (
              <li key={id}>
                {label}: {r.inserted} added
                {r.skipped > 0 ? ` (${r.skipped} already present)` : ""}
                {r.failed > 0 ? `, ${r.failed} failed` : ""}
              </li>
            );
          })}
        </ul>
        {skippedPremium && (
          <p className="mt-2 text-xs italic text-muted-foreground">
            Custom decks and reading photo images were not restored
            (Premium feature). Their metadata was preserved.
          </p>
        )}
      </div>
      <Button onClick={onReset}>Done</Button>
    </div>
  );
}