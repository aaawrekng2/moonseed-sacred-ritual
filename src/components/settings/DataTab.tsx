/**
 * Settings → Data tab (CJ; EB adds Delete Selected Data).
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
 *   5. Delete selected data (EB) — destructive, MFA-or-text-gated
 */
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Eye,
  FileUp,
  Loader2,
  Lock,
  LogOut,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { signOutAndClear } from "@/lib/sign-out";
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
  analyzeBackup,
  readInspectParts,
  type BackupAnalysis,
} from "@/lib/backup-inspect";
import {
  executeRestore,
  readBackupManifest,
  countReadingsInRange,
  type BackupManifestV1,
  type RestoreResult,
  type RestoreMode,
  type RestoreDateRange,
} from "@/lib/backup-restore";
import { parseIsoDay, endOfDayInTz } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import type JSZip from "jszip";
import { ImportFlow, type ImportResult } from "@/components/import/ImportFlow";
import { formatDateTime, formatMonthYear, formatDateShort } from "@/lib/dates";
import { PhotoArchive } from "./PhotoArchive";
import { DeleteDataModal } from "./DeleteDataModal";

const CATEGORY_LABEL: Record<string, string> = {
  readings: "Readings",
  preferences: "Preferences",
  user_tags: "Tags",
  user_streaks: "Streak history",
  custom_guides: "Custom guides",
  custom_decks: "Custom decks",
  reading_photos: "Reading photos",
};

type RestorePhase = "pick" | "preview" | "running" | "done";

type RestoreStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done";
  current?: number;
  total?: number;
};
type LoadedPart = {
  file: File;
  manifest: BackupManifestV1;
  zip: JSZip;
};

export function DataTab() {
  const { user } = useSettings();
  const [signingOut, setSigningOut] = useState(false);
  const confirm = useConfirm();
  // EB — Delete Selected Data modal state.
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [selected, setSelected] = useState<Set<BackupCategoryId>>(
    () =>
      new Set(
        BACKUP_CATEGORIES.map((c) => c.id),
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
  // EK142 — conflict mode, optional date range (readings only), and the
  // typed-confirmation that gates the destructive overwrite path.
  const { effectiveTz } = useTimezone();
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("merge");
  const [useRange, setUseRange] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [eraseConfirm, setEraseConfirm] = useState("");
  const [rangedReadingCount, setRangedReadingCount] = useState<number | null>(null);
  // v2.1 — live step checklist for the blocking restore modal.
  const [restoreSteps, setRestoreSteps] = useState<RestoreStep[]>([]);
  // v2.2 — earliest/latest reading in the uploaded backup, shown in the popup.
  const [readingsSpan, setReadingsSpan] = useState<{
    start: string;
    end: string;
  } | null>(null);
  // v2.3 — Check Data (read-only backup inspector).
  const checkFileRef = useRef<HTMLInputElement>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkAnalysis, setCheckAnalysis] = useState<BackupAnalysis | null>(
    null,
  );
  const [checkView, setCheckView] = useState<"report" | "browse">("report");

  const handleCheckFiles = async (files: FileList | File[] | null) => {
    if (!files || (Array.isArray(files) ? files.length : files.length) === 0)
      return;
    setCheckBusy(true);
    try {
      const parts = await readInspectParts(Array.from(files));
      const analysis = await analyzeBackup(parts);
      setCheckAnalysis(analysis);
      setCheckView("report");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't read that file");
    } finally {
      setCheckBusy(false);
      if (checkFileRef.current) checkFileRef.current.value = "";
    }
  };
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
    setRestoreMode("merge");
    setUseRange(false);
    setRangeStart("");
    setRangeEnd("");
    setEraseConfirm("");
    setRangedReadingCount(null);
    setRestoreSteps([]);
    setReadingsSpan(null);
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
          next.add(c);
        }
        setRestoreSelected(next);
      }
      // v2.2 — find the earliest/latest reading so the popup can show the span.
      setReadingsSpan(null);
      try {
        if (part1?.manifest.categories.includes("readings")) {
          const entry = part1.zip.file("readings/readings.json");
          if (entry) {
            const rows = JSON.parse(await entry.async("string")) as Array<{
              created_at?: string;
            }>;
            const stamps = rows
              .map((r) => r.created_at)
              .filter((s): s is string => typeof s === "string" && s.length > 0)
              .sort();
            if (stamps.length > 0) {
              setReadingsSpan({
                start: stamps[0],
                end: stamps[stamps.length - 1],
              });
            }
          }
        }
      } catch {
        // Non-fatal — the span is a nicety; skip it if the file can't be read.
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
    setRestoreSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // EK142 — translate the picked dates into UTC instants via the timezone
  // module, so the window matches the seeker's calendar days. Readings only.
  const buildDateRange = (): RestoreDateRange => {
    if (!useRange || (!rangeStart && !rangeEnd)) return null;
    return {
      startIso: rangeStart
        ? parseIsoDay(rangeStart, effectiveTz).toISOString()
        : null,
      endIso: rangeEnd
        ? endOfDayInTz(parseIsoDay(rangeEnd, effectiveTz), effectiveTz).toISOString()
        : null,
    };
  };

  // EK142 — keep the readings preview count accurate while a range is active.
  useEffect(() => {
    let cancelled = false;
    const part1 =
      parts.find((p) => (p.manifest.part_index ?? 1) === 1) ?? parts[0];
    if (
      !part1 ||
      !restoreSelected.has("readings") ||
      !useRange ||
      (!rangeStart && !rangeEnd)
    ) {
      setRangedReadingCount(null);
      return;
    }
    void (async () => {
      const n = await countReadingsInRange(part1.zip, buildDateRange());
      if (!cancelled) setRangedReadingCount(n);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, restoreSelected, useRange, rangeStart, rangeEnd, effectiveTz]);

  // v2.1 — build the planned step list (mirrors the engine's emit order) so
  // the modal can show pending steps too, and a helper to advance them.
  const buildSteps = (mode: RestoreMode, cats: Set<string>): RestoreStep[] => {
    const overwrite = mode === "overwrite";
    const s: { key: string; label: string }[] = [];
    if (overwrite) s.push({ key: "safety_backup", label: "Saving a safety backup" });
    s.push({ key: "validate", label: "Validating the backup file" });
    if (cats.has("readings")) {
      if (overwrite) s.push({ key: "clear_readings", label: "Clearing current readings" });
      s.push({ key: "readings", label: "Restoring readings" });
    }
    if (cats.has("preferences")) s.push({ key: "preferences", label: "Restoring preferences" });
    if (cats.has("user_tags")) s.push({ key: "tags", label: "Restoring tags" });
    if (cats.has("user_streaks")) s.push({ key: "streaks", label: "Restoring streak history" });
    if (cats.has("custom_guides")) s.push({ key: "guides", label: "Restoring custom guides" });
    if (cats.has("custom_decks")) {
      if (overwrite) s.push({ key: "clear_decks", label: "Clearing current decks" });
      s.push({ key: "decks", label: "Restoring custom decks" });
    }
    if (cats.has("reading_photos")) {
      if (overwrite) s.push({ key: "clear_photos", label: "Clearing current photos" });
      s.push({ key: "photos", label: "Restoring reading photos" });
    }
    return s.map((x) => ({ ...x, status: "pending" as const }));
  };

  const markStep = (key: string, patch?: { current?: number; total?: number }) => {
    setRestoreSteps((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx === -1) return prev;
      return prev.map((s, i) =>
        i < idx
          ? { ...s, status: "done" as const }
          : i === idx
            ? { ...s, status: "active" as const, ...patch }
            : { ...s, status: "pending" as const },
      );
    });
  };

  const runRestore = async () => {
    if (parts.length === 0 || restoreSelected.size === 0) return;
    const overwrite = restoreMode === "overwrite";
    if (overwrite && eraseConfirm.trim().toUpperCase() !== "ERASE") {
      toast.error("Type ERASE to confirm the overwrite.");
      return;
    }

    setRestoreSteps(buildSteps(restoreMode, restoreSelected));
    setRestorePhase("running");
    try {
      // Safety backup before an overwrite erases anything.
      if (overwrite) {
        markStep("safety_backup");
        const snapshot = await createBackup({
          userId: user.id,
          categories: BACKUP_CATEGORIES.map((c) => c.id),
        });
        const snapUrl = URL.createObjectURL(snapshot);
        const a = document.createElement("a");
        a.href = snapUrl;
        a.download = `tarotseed-safety-backup-before-restore-${new Date()
          .toISOString()
          .slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(snapUrl);
      }

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
        mode: restoreMode,
        dateRange: buildDateRange(),
        onProgress: (e) => {
          if (e.key === "done") return;
          markStep(e.key, { current: e.current, total: e.total });
        },
      });
      setRestoreSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
      setRestoreResult(r);
      setRestorePhase("done");
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
      return sum + (estimates[id]?.bytes ?? 0);
    },
    0,
  );

  const toggle = (id: BackupCategoryId) => {
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
        onProgress: (p) => setBackupProgress(p),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // eslint-disable-next-line no-restricted-syntax -- backup filename: UTC ISO day is intentional (deterministic, locale-free)
      a.download = `tarotseed-backup-${new Date().toISOString().slice(0, 10)}.zip`;
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
      description: "All locally cached Tarot Seed settings on this device will be removed. Your account data is unaffected.",
      confirmLabel: "Clear",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("tarotseed:") || k.startsWith("arcana:"))
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
            const locked = false;
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
          message={restoreMessage}
          result={restoreResult}
          fileInputRef={fileInputRef}
          mode={restoreMode}
          onModeChange={(m) => {
            setRestoreMode(m);
            if (m === "merge") setEraseConfirm("");
          }}
          useRange={useRange}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onRangeToggle={setUseRange}
          onRangeStart={setRangeStart}
          onRangeEnd={setRangeEnd}
          rangedReadingCount={rangedReadingCount}
          eraseConfirm={eraseConfirm}
          onEraseConfirm={setEraseConfirm}
          steps={restoreSteps}
          readingsSpan={readingsSpan}
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
        title="Check data"
        description="Inspect any backup file before you rely on it. Reads the file only — your account is never touched."
      >
        <input
          ref={checkFileRef}
          type="file"
          accept=".zip,application/zip"
          multiple
          className="hidden"
          onChange={(e) => void handleCheckFiles(e.target.files)}
        />
        <Button
          variant="ghost"
          onClick={() => checkFileRef.current?.click()}
          disabled={checkBusy}
          className="w-full justify-start gap-2 sm:w-auto"
        >
          {checkBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ClipboardCheck className="h-4 w-4" />
          )}
          {checkBusy ? "Reading file…" : "Check a backup file"}
        </Button>
        <p className="text-xs text-muted-foreground">
          See exactly what's inside — counts, dates, image files — and browse
          the actual records.
        </p>
      </SettingsSection>

      {checkAnalysis && (
        <CheckDataModal
          analysis={checkAnalysis}
          view={checkView}
          onView={setCheckView}
          onClose={() => setCheckAnalysis(null)}
        />
      )}

      <SettingsSection
        title="Import from another app"
        description="Bring your spread history from any tarot journal."
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
        description="Spread photos you removed are kept here so you can restore or permanently delete them."
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
      </SettingsSection>

      {/* EB — Danger Zone. Delete Selected Data with checkbox scope
          + MFA-or-text verification gate. */}
      <SettingsSection
        title="Delete data"
        description="Permanently remove selected categories of your data. Optionally also close your sign-in account."
      >
        <Button
          variant="outline"
          onClick={() => setDeleteOpen(true)}
          className="w-full justify-start gap-2 sm:w-auto"
          style={{
            borderColor:
              "color-mix(in oklab, var(--destructive, #b94c4c) 45%, transparent)",
            color: "var(--color-foreground)",
          }}
        >
          <Trash2 className="h-4 w-4" />
          Delete my selected data
        </Button>
      </SettingsSection>

      <DeleteDataModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />

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
  message: string;
  result: RestoreResult | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  mode: RestoreMode;
  onModeChange: (m: RestoreMode) => void;
  useRange: boolean;
  rangeStart: string;
  rangeEnd: string;
  onRangeToggle: (on: boolean) => void;
  onRangeStart: (v: string) => void;
  onRangeEnd: (v: string) => void;
  rangedReadingCount: number | null;
  eraseConfirm: string;
  onEraseConfirm: (v: string) => void;
  steps: RestoreStep[];
  readingsSpan: { start: string; end: string } | null;
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
  result,
  fileInputRef,
  mode,
  onModeChange,
  useRange,
  rangeStart,
  rangeEnd,
  onRangeToggle,
  onRangeStart,
  onRangeEnd,
  rangedReadingCount,
  eraseConfirm,
  onEraseConfirm,
  steps,
  readingsSpan,
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

  // v2.2 — preview, running, and done all render inside ONE blocking popup
  // that opens the instant a backup is uploaded.
  const part1 =
    parts.find((p) => (p.manifest.part_index ?? 1) === 1) ?? parts[0];
  const created = part1 ? formatDateTime(part1.manifest.exported_at) : "";
  const categories = part1?.manifest.categories ?? [];

  const spanLabel = readingsSpan
    ? formatMonthYear(readingsSpan.start) === formatMonthYear(readingsSpan.end)
      ? formatMonthYear(readingsSpan.start)
      : `${formatMonthYear(readingsSpan.start)} – ${formatMonthYear(readingsSpan.end)}`
    : "";

  const setupBody = (
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

        {part1 && (
          <div className="rounded-lg bg-foreground/5 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              What&apos;s inside
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {categories.map((id) => {
                const info = part1.manifest.contents[id];
                const label = CATEGORY_LABEL[id] ?? id;
                const n = info?.files
                  ? `${info.rows ?? 0} · ${info.files} files`
                  : `${info?.rows ?? 0}`;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span style={{ color: "var(--gold)" }}>{n}</span>
                  </div>
                );
              })}
            </div>
            {spanLabel && (
              <div className="mt-2 text-xs italic text-muted-foreground">
                Readings span {spanLabel}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {categories.map((id) => {
            const label = CATEGORY_LABEL[id] ?? id;
            const info = part1?.manifest.contents[id];
            const locked = false;
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

        {(() => {
          const overwrite = mode === "overwrite";
          const readingsSelected = selected.has("readings");
          const eraseOk =
            !overwrite || eraseConfirm.trim().toUpperCase() === "ERASE";
          return (
            <>
              <div>
                <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  How to restore
                </div>
                <div className="inline-flex gap-1 rounded-full border border-border/50 p-1">
                  <button
                    type="button"
                    onClick={() => onModeChange("merge")}
                    className={`rounded-full px-4 py-1 text-sm transition-colors ${
                      !overwrite
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    onClick={() => onModeChange("overwrite")}
                    className={`rounded-full px-4 py-1 text-sm transition-colors ${
                      overwrite
                        ? "bg-destructive/15 text-destructive"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Overwrite
                  </button>
                </div>
              </div>

              {readingsSelected && (
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={useRange}
                      onCheckedChange={(v) => onRangeToggle(v === true)}
                    />
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    Limit to a date range
                  </label>
                  {useRange && (
                    <div className="space-y-2 pl-6">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <input
                          type="date"
                          value={rangeStart}
                          max={rangeEnd || undefined}
                          onChange={(e) => onRangeStart(e.target.value)}
                          className="rounded-md border border-border/50 bg-transparent px-2 py-1 text-sm"
                          aria-label="Start date"
                        />
                        <span className="text-muted-foreground">to</span>
                        <input
                          type="date"
                          value={rangeEnd}
                          min={rangeStart || undefined}
                          onChange={(e) => onRangeEnd(e.target.value)}
                          className="rounded-md border border-border/50 bg-transparent px-2 py-1 text-sm"
                          aria-label="End date"
                        />
                      </div>
                      <p className="text-xs italic text-muted-foreground">
                        Applies to readings (and their photos) only. Other
                        categories restore in full.
                        {rangedReadingCount != null &&
                          ` ${rangedReadingCount} reading${
                            rangedReadingCount === 1 ? "" : "s"
                          } in range.`}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div
                className={`rounded-lg p-3 text-xs leading-relaxed ${
                  overwrite
                    ? "bg-destructive/5 text-muted-foreground"
                    : "bg-foreground/5 text-muted-foreground"
                }`}
              >
                {overwrite
                  ? "Erases the selected categories from your account, then restores the backup. A safety backup of your current data downloads first, so this stays reversible."
                  : "Adds entries from the backup. Anything already in your account is skipped — nothing is removed."}
              </div>

              {overwrite && (
                <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    This erases the selected categories first
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your current data in the selected categories is removed,
                    then replaced with the backup. A full backup of your
                    current data is saved to your downloads first.{" "}
                    <span className="text-foreground">
                      Verify that backup saved, and run Check Data on it before
                      proceeding.
                    </span>
                  </p>
                  <label className="block text-xs text-muted-foreground">
                    Type{" "}
                    <span className="font-semibold tracking-wide text-destructive">
                      ERASE
                    </span>{" "}
                    to confirm
                  </label>
                  <input
                    type="text"
                    value={eraseConfirm}
                    onChange={(e) => onEraseConfirm(e.target.value)}
                    placeholder="ERASE"
                    className="w-full rounded-md border border-destructive/50 bg-transparent px-3 py-2 text-sm tracking-wide outline-none focus:border-destructive"
                    aria-label="Type ERASE to confirm"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={onRestore}
                  disabled={!haveAllParts || selected.size === 0 || !eraseOk}
                  variant={overwrite ? "destructive" : "default"}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {overwrite ? "Erase & restore" : "Restore selected"}
                </Button>
                <Button variant="ghost" onClick={onReset}>
                  Cancel
                </Button>
              </div>
            </>
          );
        })()}
      </div>
    );

  // running + done bodies (preview is setupBody above) — all share the popup.
  const doneCount = steps.filter((s) => s.status === "done").length;
  const activeReadings = steps.find(
    (s) => s.status === "active" && s.key === "readings",
  );
  const activeFrac =
    activeReadings && activeReadings.total
      ? (activeReadings.current ?? 0) / activeReadings.total
      : 0;
  const pct = steps.length
    ? Math.min(100, Math.round(((doneCount + activeFrac) / steps.length) * 100))
    : phase === "done" ? 100 : 0;

  const skippedPremium =
    Object.values(result?.perCategory ?? {}).reduce(
      (s, v) => s + (v.filesSkippedPremium ?? 0),
      0,
    ) > 0;

  const modeLabel =
    mode === "overwrite" ? "Overwrite" : "Merge";
  const rangeLabel =
    useRange && (rangeStart || rangeEnd)
      ? `${rangeStart || "start"} – ${rangeEnd || "today"}`
      : "all dates";
  const readingsInserted = result?.perCategory?.readings?.inserted ?? 0;

  const body =
    phase === "preview" ? (
      setupBody
    ) : phase === "done" ? (
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" style={{ color: "var(--gold)" }} />
            <span className="text-lg font-medium">Restore complete</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {modeLabel} · {rangeLabel}
          </p>
        </div>

        <div className="space-y-1.5 text-sm">
          {Object.entries(result?.perCategory ?? {}).map(([id, r]) => {
            const label = CATEGORY_LABEL[id] ?? id;
            let right: string;
            if (id === "preferences" || id === "user_streaks") {
              right = r.overwrote || r.inserted > 0 ? "replaced" : "no change";
            } else {
              right = `${r.inserted} ${r.overwrote ? "restored" : "added"}`;
              if (r.skipped > 0) right += ` · ${r.skipped} already present`;
              if (r.failed > 0) right += ` · ${r.failed} failed`;
            }
            return (
              <div key={id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{label}</span>
                <span style={{ color: "var(--gold)" }}>{right}</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-foreground/5 p-3 text-xs leading-relaxed text-muted-foreground">
          {mode === "overwrite"
            ? `Your journal now holds ${readingsInserted} reading${readingsInserted === 1 ? "" : "s"}. Verify that a backup of your previous data was saved to your downloads, and run Check Data on it before relying on this restore.`
            : `${readingsInserted} reading${readingsInserted === 1 ? "" : "s"} added to your journal. Anything already present was left untouched.`}
          {skippedPremium && (
            <span className="mt-1 block italic">
              Custom deck and reading-photo images need Premium; their metadata was preserved.
            </span>
          )}
        </div>

        <Button onClick={onReset} className="w-full">
          OK
        </Button>
      </div>
    ) : (
      <div className="space-y-4">
        <div>
          <div className="text-lg font-medium">Restoring your data</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Please keep this open until it finishes.
          </p>
        </div>

        <div
          className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
          role="progressbar"
          aria-valuenow={pct}
        >
          <div
            className="h-full transition-[width] duration-200 ease-out"
            style={{ width: `${Math.max(3, pct)}%`, background: "var(--gold)", opacity: 0.9 }}
          />
        </div>

        <div className="space-y-2.5">
          {steps.map((s) => (
            <div key={s.key} className="flex items-center gap-2.5 text-sm">
              {s.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--gold)" }} />
              ) : s.status === "active" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--gold)" }} />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              )}
              <span className={s.status === "pending" ? "text-muted-foreground/50" : ""}>
                {s.label}
                {s.key === "readings" && s.status === "active" && s.total ? (
                  <span className="text-muted-foreground">
                    {" "}
                    {s.current ?? 0} / {s.total}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground/70">
          The button to close appears when everything is done.
        </p>
      </div>
    );

  return createPortal(
    <div
      className="modal-scrim fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal)" }}
    >
      <div
        className={`w-full ${phase === "preview" ? "max-w-md" : "max-w-sm"} max-h-[85vh] overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl`}
        style={{ borderColor: "color-mix(in oklab, var(--gold) 22%, transparent)" }}
      >
        {body}
      </div>
    </div>,
    document.body,
  );
}
// v2.3 — Check Data: read-only inspector modal (report + browse).
function CheckStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span style={{ color: "var(--gold)" }}>{value}</span>
    </div>
  );
}

function CheckDataModal({
  analysis,
  view,
  onView,
  onClose,
}: {
  analysis: BackupAnalysis;
  view: "report" | "browse";
  onView: (v: "report" | "browse") => void;
  onClose: () => void;
}) {
  const a = analysis;
  const has = (c: string) => a.categories.includes(c);
  const [tab, setTab] = useState<"readings" | "tags" | "decks">("readings");

  const span =
    a.readings.spanStart && a.readings.spanEnd
      ? formatMonthYear(a.readings.spanStart) ===
        formatMonthYear(a.readings.spanEnd)
        ? formatMonthYear(a.readings.spanStart)
        : `${formatMonthYear(a.readings.spanStart)} – ${formatMonthYear(a.readings.spanEnd)}`
      : "—";

  const ROW_CAP = 500;
  const shownReadings = a.readingRows.slice(0, ROW_CAP);

  const report = (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <ClipboardCheck
          className="mt-0.5 h-5 w-5 shrink-0"
          style={{ color: "var(--gold)" }}
        />
        <div className="min-w-0">
          <div className="text-lg font-medium">Check data</div>
          <div className="truncate text-xs text-muted-foreground">
            {a.fileName} · {formatBytes(a.fileSizeBytes)}
          </div>
          <div className="text-xs text-muted-foreground">
            Created {a.exportedAt ? formatDateTime(a.exportedAt) : "—"} · schema
            v{a.schemaVersion}
            {a.totalParts > 1
              ? ` · ${a.partsPresent}/${a.totalParts} parts`
              : ""}
          </div>
        </div>
      </div>

      {has("readings") && (
        <div className="rounded-lg bg-foreground/5 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Readings
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <CheckStat label="Total" value={`${a.readings.total}`} />
            <CheckStat label="Favorites" value={`${a.readings.favorites}`} />
            <CheckStat label="Deep readings" value={`${a.readings.deep}`} />
            <CheckStat label="With photos" value={`${a.readings.withPhotos}`} />
            <CheckStat
              label="Distinct cards"
              value={`${a.readings.distinctCards}`}
            />
            <CheckStat label="Reversed" value={`${a.readings.reversed}`} />
          </div>
          <div className="mt-2 text-xs italic text-muted-foreground">
            Span {span}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-foreground/5 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Everything else
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {has("user_tags") && <CheckStat label="Tags" value={`${a.tags}`} />}
          {has("user_streaks") && (
            <CheckStat
              label="Streak"
              value={a.streakDays != null ? `${a.streakDays} d` : "—"}
            />
          )}
          {has("custom_decks") && (
            <CheckStat
              label="Decks"
              value={`${a.decks.count} · ${a.decks.imageFiles} img`}
            />
          )}
          {has("reading_photos") && (
            <CheckStat
              label="Photos"
              value={`${a.photos.count} · ${a.photos.imageFiles} img`}
            />
          )}
          {has("custom_guides") && (
            <CheckStat label="Guides" value={`${a.guides}`} />
          )}
          {has("preferences") && (
            <CheckStat
              label="Preferences"
              value={a.hasPreferences ? "yes" : "no"}
            />
          )}
        </div>
      </div>

      {a.integrity.ok ? (
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-center gap-2 text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            Manifest counts match the files
          </div>
          <div className="flex items-center gap-2 text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            {a.integrity.imageFilesTotal} image file
            {a.integrity.imageFilesTotal === 1 ? "" : "s"} present, none missing
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            Things to check
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {a.integrity.issues.map((iss, i) => (
              <li key={i}>{iss}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={() => onView("browse")} className="flex-1 gap-2">
          <Eye className="h-4 w-4" />
          View data
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );

  const tabs: { id: "readings" | "tags" | "decks"; label: string; show: boolean }[] =
    [
      { id: "readings", label: "Readings", show: a.readingRows.length > 0 },
      { id: "tags", label: "Tags", show: a.tagList.length > 0 },
      { id: "decks", label: "Decks", show: a.deckList.length > 0 },
    ];
  const activeTab = tabs.find((t) => t.id === tab && t.show)
    ? tab
    : (tabs.find((t) => t.show)?.id ?? "readings");

  const browse = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onView("report")}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to report"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="truncate text-sm font-medium">{a.fileName}</div>
      </div>

      <div className="flex gap-4 border-b border-border/40 pb-2 text-sm italic">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                activeTab === t.id
                  ? "pb-1.5"
                  : "pb-1.5 text-muted-foreground hover:text-foreground"
              }
              style={
                activeTab === t.id
                  ? {
                      color: "var(--gold)",
                      borderBottom: "1.5px solid var(--gold)",
                    }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
      </div>

      {activeTab === "readings" && (
        <div className="flex flex-col gap-2.5">
          {shownReadings.map((r, i) => (
            <div
              key={i}
              className="border-b border-foreground/5 pb-2 last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {r.date ? formatDateShort(r.date) : "—"}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {r.favorite && <span style={{ color: "var(--gold)" }}>★</span>}
                  {r.deep && <span className="italic">deep</span>}
                </span>
              </div>
              <div className="text-sm">{r.cards.join(" · ")}</div>
              {r.question && (
                <div className="text-xs italic text-muted-foreground">
                  {r.question}
                </div>
              )}
            </div>
          ))}
          <div className="pt-1 text-center text-xs text-muted-foreground">
            {a.readingRows.length > ROW_CAP
              ? `Showing first ${ROW_CAP} of ${a.readingRows.length} readings`
              : `${a.readingRows.length} reading${a.readingRows.length === 1 ? "" : "s"}`}
          </div>
        </div>
      )}

      {activeTab === "tags" && (
        <div className="flex flex-wrap gap-2">
          {a.tagList.map((t, i) => (
            <span
              key={i}
              className="rounded-full border border-border/50 px-2.5 py-1 text-xs"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {activeTab === "decks" && (
        <div className="flex flex-col gap-2">
          {a.deckList.map((d, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 border-b border-foreground/5 pb-2 text-sm last:border-0"
            >
              <span>{d.name}</span>
              <span className="text-xs text-muted-foreground">
                {d.cards} cards
              </span>
            </div>
          ))}
        </div>
      )}

      <Button variant="ghost" onClick={onClose} className="w-full">
        Close
      </Button>
    </div>
  );

  return createPortal(
    <div
      className="modal-scrim fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal)" }}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl"
        style={{
          borderColor: "color-mix(in oklab, var(--gold) 22%, transparent)",
        }}
      >
        {view === "report" ? report : browse}
      </div>
    </div>,
    document.body,
  );
}
