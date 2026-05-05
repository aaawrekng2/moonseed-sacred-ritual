/**
 * CSV import wizard (CS).
 *
 * 5-step flow rendered as a full-screen overlay launched from
 * Settings → Data → "Import from another app".
 *   Step 1 — Upload + format detect
 *   Step 2 — Column mapping (skipped for known formats)
 *   Step 3 — Card resolution (matched / probable / unmatched buckets)
 *   Step 4 — Preview summary
 *   Step 5 — Run import + result panel (with undo)
 *
 * Atomic: every reading inserted is tagged with the same
 * `import_batch_id`, so "Undo this import" is a single delete query.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, FileUp, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { useConfirm } from "@/hooks/use-confirm";
import { supabase } from "@/integrations/supabase/client";
import {
  parseCsvFile,
  detectDateFormat,
  parseDateAs,
  type ParsedCsv,
  type DateFormat,
} from "@/lib/import/csv-parser";
import {
  detectFormat,
  suggestField,
  type FormatSignature,
  type MoonseedField,
} from "@/lib/import/format-detector";
import {
  resolveCardName,
  splitOrientation,
  normalizeReversal,
  getAllCardOptions,
  getCanonicalName,
  type CardResolveResult,
} from "@/lib/import/card-resolver";
import { inferSpread } from "@/lib/import/spread-inference";
import { executeImport, undoImport } from "@/lib/import/import-batch";

type Props = {
  onClose: () => void;
  onImported?: (result: ImportResult) => void;
};

export type ImportResult = {
  batchId: string;
  imported: number;
  failed: number;
  sourceFormat: string;
};

type Step = 1 | 2 | 3 | 4 | 5;

type Decision =
  | { kind: "matched"; cardIndex: number }
  | { kind: "probable"; cardIndex: number; accepted: boolean }
  | { kind: "manual"; cardIndex: number }
  | { kind: "skip" }
  | { kind: "as-note" }
  | { kind: "pending" };

const ALL_CARDS = getAllCardOptions();

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ============================================================== */

export function ImportFlow({ onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [format, setFormat] = useState<FormatSignature | null>(null);
  const [mapping, setMapping] = useState<Record<string, MoonseedField>>({});
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  /* ----------------- Step 1: file upload + parse ----------------- */
  const onFile = async (file: File) => {
    try {
      const csv = await parseCsvFile(file);
      if (csv.rows.length === 0) {
        toast.error("That CSV looks empty.");
        return;
      }
      const fmt = detectFormat(csv.headers);
      const initialMap: Record<string, MoonseedField> = {};
      if (fmt.preMap) {
        for (const h of csv.headers) {
          initialMap[h] = fmt.preMap[h] ?? suggestField(h);
        }
      } else {
        for (const h of csv.headers) initialMap[h] = suggestField(h);
      }
      setParsed(csv);
      setFormat(fmt);
      setMapping(initialMap);
      setStep(fmt.id === "tarotpulse" ? 3 : 2);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't read that CSV.");
    }
  };

  /* ----------------- Step 3 prep: collect unique card names ----------------- */
  const cardColumns = useMemo(() => {
    const cols: Array<{ idx: number; col: string; reversedCol?: string }> = [];
    for (let i = 1; i <= 10; i++) {
      const col = Object.entries(mapping).find(([, v]) => v === `card_${i}`)?.[0];
      const reversedCol = Object.entries(mapping).find(
        ([, v]) => v === `card_${i}_reversed`,
      )?.[0];
      if (col) cols.push({ idx: i, col, reversedCol });
    }
    return cols;
  }, [mapping]);

  const uniqueCardNames = useMemo(() => {
    if (!parsed) return [] as string[];
    const set = new Set<string>();
    for (const row of parsed.rows) {
      for (const c of cardColumns) {
        const raw = (row[c.col] ?? "").toString().trim();
        if (!raw) continue;
        const { name } = splitOrientation(raw);
        if (name) set.add(name);
      }
    }
    return Array.from(set);
  }, [parsed, cardColumns]);

  // Initialise decisions when entering step 3.
  useEffect(() => {
    if (step !== 3 || !parsed) return;
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const name of uniqueCardNames) {
        if (next.has(name)) continue;
        const r = resolveCardName(name);
        if (r.kind === "matched") {
          next.set(name, { kind: "matched", cardIndex: r.cardIndex });
        } else if (r.kind === "probable") {
          next.set(name, {
            kind: "probable",
            cardIndex: r.cardIndex,
            accepted: false,
          });
        } else {
          next.set(name, { kind: "pending" });
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, uniqueCardNames.length]);

  const matchedCount = useMemo(() => {
    let n = 0;
    for (const v of decisions.values()) {
      if (v.kind === "matched") n++;
      else if (v.kind === "probable" && v.accepted) n++;
      else if (v.kind === "manual") n++;
    }
    return n;
  }, [decisions]);

  const probableNames = uniqueCardNames.filter(
    (n) => decisions.get(n)?.kind === "probable",
  );
  const unmatchedNames = uniqueCardNames.filter((n) => {
    const d = decisions.get(n);
    return d?.kind === "pending";
  });

  const allDecided =
    unmatchedNames.length === 0 &&
    probableNames.every((n) => {
      const d = decisions.get(n);
      return d?.kind === "probable" && d.accepted;
    });

  /* ----------------- Step 4 prep: build readings ----------------- */
  const dateColumn = useMemo(
    () => Object.entries(mapping).find(([, v]) => v === "date")?.[0] ?? null,
    [mapping],
  );
  const createdAtColumn = useMemo(
    () =>
      Object.entries(mapping).find(([, v]) => v === "created_at_override")?.[0] ??
      null,
    [mapping],
  );
  const questionColumn = useMemo(
    () => Object.entries(mapping).find(([, v]) => v === "question")?.[0] ?? null,
    [mapping],
  );
  const notesColumn = useMemo(
    () => Object.entries(mapping).find(([, v]) => v === "notes")?.[0] ?? null,
    [mapping],
  );
  const tagsColumn = useMemo(
    () => Object.entries(mapping).find(([, v]) => v === "tags")?.[0] ?? null,
    [mapping],
  );

  const dateFormat: DateFormat = useMemo(() => {
    if (!parsed || !dateColumn) return "iso";
    const samples = parsed.rows.slice(0, 50).map((r) => r[dateColumn] ?? "");
    return detectDateFormat(samples);
  }, [parsed, dateColumn]);

  type BuiltReading = {
    spread_type: "single" | "three" | "celtic";
    card_ids: number[];
    card_orientations: boolean[];
    question: string | null;
    note: string | null;
    tags: string[];
    created_at: string;
  };

  const built = useMemo((): { rows: BuiltReading[]; skipped: number } => {
    if (!parsed) return { rows: [], skipped: 0 };
    const rows: BuiltReading[] = [];
    let skipped = 0;

    for (const row of parsed.rows) {
      const cards: { idx: number; reversed: boolean; raw: string; canonical: string | null }[] = [];
      const noteExtras: string[] = [];

      for (const c of cardColumns) {
        const raw = (row[c.col] ?? "").toString().trim();
        if (!raw) continue;
        const split = splitOrientation(raw);
        const decision = decisions.get(split.name);
        if (!decision) continue;

        let cardIndex: number | null = null;
        if (decision.kind === "matched") cardIndex = decision.cardIndex;
        else if (decision.kind === "probable" && decision.accepted) {
          cardIndex = decision.cardIndex;
        } else if (decision.kind === "manual") cardIndex = decision.cardIndex;
        else if (decision.kind === "as-note") {
          noteExtras.push(`Unmapped card: ${split.name}`);
          continue;
        } else if (decision.kind === "skip") {
          continue;
        } else {
          continue;
        }

        // Reversal: dedicated column wins over inline marker.
        let reversed = split.reversed;
        if (c.reversedCol) {
          reversed = normalizeReversal(row[c.reversedCol]);
        }
        cards.push({
          idx: cardIndex!,
          reversed,
          raw,
          canonical: getCanonicalName(cardIndex!),
        });
      }

      if (cards.length === 0) {
        skipped++;
        continue;
      }

      const inferred = inferSpread(cards.length);
      const slotCount =
        inferred.spread_type === "single"
          ? 1
          : inferred.spread_type === "three"
            ? 3
            : 10;
      const kept = cards.slice(0, slotCount);
      const overflow = cards.slice(slotCount);
      if (overflow.length > 0) {
        noteExtras.push(
          `Additional cards: ${overflow
            .map((c) => `${c.canonical}${c.reversed ? " (R)" : ""}`)
            .join(", ")}`,
        );
      }

      const dateRaw = dateColumn ? (row[dateColumn] ?? "").toString() : "";
      const createdAtRaw = createdAtColumn
        ? (row[createdAtColumn] ?? "").toString()
        : "";
      const dt =
        (createdAtRaw && parseDateAs(createdAtRaw, "iso")) ||
        (dateRaw && parseDateAs(dateRaw, dateFormat)) ||
        new Date();

      const baseNote = notesColumn ? (row[notesColumn] ?? "").toString().trim() : "";
      const note =
        [baseNote, ...noteExtras].filter(Boolean).join("\n\n") || null;
      const question = questionColumn
        ? (row[questionColumn] ?? "").toString().trim() || null
        : null;
      const rawTags = tagsColumn ? (row[tagsColumn] ?? "").toString() : "";
      const tags = rawTags
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      rows.push({
        spread_type: inferred.spread_type,
        card_ids: kept.map((c) => c.idx),
        card_orientations: kept.map((c) => c.reversed),
        question,
        note,
        tags,
        created_at: dt.toISOString(),
      });
    }

    return { rows, skipped };
  }, [
    parsed,
    cardColumns,
    decisions,
    dateColumn,
    createdAtColumn,
    questionColumn,
    notesColumn,
    tagsColumn,
    dateFormat,
  ]);

  /* ----------------- Step 5: run import ----------------- */
  const runImport = async () => {
    if (!format || built.rows.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: built.rows.length });
    try {
      // Server function does the actual chunking; the progress bar is
      // an optimistic indicator while we wait for the response.
      const headers = await authHeaders();
      const res = await executeImport({
        data: { readings: built.rows, sourceFormat: format.label },
        headers,
      });
      setProgress({ done: res.imported, total: built.rows.length });
      const r: ImportResult = {
        batchId: res.batchId,
        imported: res.imported,
        failed: res.failed,
        sourceFormat: format.label,
      };
      setResult(r);
      onImported?.(r);
      toast.success(`Imported ${res.imported} readings`);
    } catch (e) {
      toast.error((e as Error).message || "Import failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <FullScreenSheet open onClose={onClose} entry="fade" showCloseButton={false}>
      <div className="flex flex-col h-full">
      <div
        className="mx-auto my-4 flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-elevated)",
          color: "var(--color-foreground)",
          border: "1px solid var(--border-default)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Import · Step {step} of 5
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-foreground/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {step === 1 && <Step1 onFile={onFile} />}
          {step === 2 && parsed && (
            <Step2Mapping
              csv={parsed}
              mapping={mapping}
              setMapping={setMapping}
              onContinue={() => setStep(3)}
              onBack={() => {
                setParsed(null);
                setFormat(null);
                setMapping({});
                setStep(1);
              }}
            />
          )}
          {step === 3 && parsed && format && (
            <Step3Resolution
              format={format}
              uniqueNames={uniqueCardNames}
              decisions={decisions}
              setDecisions={setDecisions}
              matchedCount={matchedCount}
              probableNames={probableNames}
              unmatchedNames={unmatchedNames}
              onBack={() =>
                setStep(format.id === "tarotpulse" ? 1 : 2)
              }
              onContinue={() => setStep(4)}
              continueDisabled={!allDecided}
            />
          )}
          {step === 4 && parsed && format && (
            <Step4Preview
              format={format}
              built={built}
              total={parsed.rows.length}
              onBack={() => setStep(3)}
              onContinue={() => {
                setStep(5);
                void runImport();
              }}
            />
          )}
          {step === 5 && (
            <Step5Result
              running={running}
              progress={progress}
              result={result}
              onClose={onClose}
            />
          )}
        </div>
      </div>
      </div>
    </FullScreenSheet>
  );
}

/* ================================================================
 *                          Step components
 * ================================================================ */

function Step1({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Import from another app
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop a CSV exported from your previous tarot journal. We&apos;ll
          recognise TarotPulse automatically; for any other app you&apos;ll
          map columns in the next step.
        </p>
      </div>
      <label
        htmlFor="import-file"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground hover:bg-foreground/5"
      >
        <FileUp className="h-6 w-6" />
        <span>Drop a CSV here, or click to choose a file.</span>
      </label>
      <input
        ref={inputRef}
        id="import-file"
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

const FIELD_LABELS: Record<MoonseedField, string> = (() => {
  const map: Record<string, string> = {
    ignore: "— Ignore —",
    date: "Reading date",
    created_at_override: "Created at (override)",
    question: "Question",
    notes: "Notes",
    tags: "Tags",
  };
  for (let i = 1; i <= 10; i++) {
    map[`card_${i}`] = `Card ${i}`;
    map[`card_${i}_reversed`] = `Card ${i} reversed`;
    map[`card_${i}_position`] = `Card ${i} position`;
  }
  return map as Record<MoonseedField, string>;
})();

const FIELD_OPTIONS: MoonseedField[] = (() => {
  const arr: MoonseedField[] = [
    "ignore",
    "date",
    "created_at_override",
    "question",
    "notes",
    "tags",
  ];
  for (let i = 1; i <= 10; i++) {
    arr.push(`card_${i}` as MoonseedField);
    arr.push(`card_${i}_reversed` as MoonseedField);
    arr.push(`card_${i}_position` as MoonseedField);
  }
  return arr;
})();

function Step2Mapping({
  csv,
  mapping,
  setMapping,
  onContinue,
  onBack,
}: {
  csv: ParsedCsv;
  mapping: Record<string, MoonseedField>;
  setMapping: (m: Record<string, MoonseedField>) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const hasCard = Object.values(mapping).some((v) => /^card_\d+$/.test(v));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Map columns</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generic CSV · {csv.rows.length} rows · {csv.headers.length} columns. Map at
          least one card column to continue.
        </p>
      </div>

      <div className="space-y-2">
        {csv.headers.map((h) => (
          <div
            key={h}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2"
          >
            <div className="min-w-0 flex-1 truncate text-sm">{h}</div>
            <select
              value={mapping[h] ?? "ignore"}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  [h]: e.target.value as MoonseedField,
                })
              }
              className="rounded-md border border-border/60 bg-transparent px-2 py-1 text-sm"
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {FIELD_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={onContinue} disabled={!hasCard} className="gap-2">
          Continue
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Step3Resolution({
  format,
  uniqueNames,
  decisions,
  setDecisions,
  matchedCount,
  probableNames,
  unmatchedNames,
  onBack,
  onContinue,
  continueDisabled,
}: {
  format: FormatSignature;
  uniqueNames: string[];
  decisions: Map<string, Decision>;
  setDecisions: (m: Map<string, Decision>) => void;
  matchedCount: number;
  probableNames: string[];
  unmatchedNames: string[];
  onBack: () => void;
  onContinue: () => void;
  continueDisabled: boolean;
}) {
  const update = (name: string, d: Decision) => {
    const next = new Map(decisions);
    next.set(name, d);
    setDecisions(next);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Resolve cards</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Detected: <span className="font-medium">{format.label}</span> ·{" "}
          {uniqueNames.length} unique card names · {matchedCount} matched cleanly.
        </p>
      </div>

      {probableNames.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Probable matches</h3>
          {probableNames.map((name) => {
            const d = decisions.get(name);
            if (d?.kind !== "probable") return null;
            return (
              <div
                key={name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1 truncate text-sm">
                  You imported <strong>{name}</strong>. Did you mean{" "}
                  <em>{getCanonicalName(d.cardIndex)}</em>?
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant={d.accepted ? "default" : "outline"}
                    onClick={() =>
                      update(name, { ...d, accepted: true })
                    }
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    Confirm
                  </Button>
                  <select
                    value=""
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) {
                        update(name, { kind: "manual", cardIndex: v });
                      }
                    }}
                    className="rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs"
                  >
                    <option value="">Pick a different card…</option>
                    {ALL_CARDS.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update(name, { kind: "skip" })}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {unmatchedNames.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Unmatched ({unmatchedNames.length})
          </h3>
          {unmatchedNames.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1 truncate text-sm">{name}</div>
              <div className="flex shrink-0 gap-2">
                <select
                  value=""
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) {
                      update(name, { kind: "manual", cardIndex: v });
                    }
                  }}
                  className="rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs"
                >
                  <option value="">Pick the right card…</option>
                  {ALL_CARDS.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update(name, { kind: "skip" })}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update(name, { kind: "as-note" })}
                >
                  Add as note
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {probableNames.length === 0 && unmatchedNames.length === 0 && (
        <p className="text-sm text-muted-foreground">
          All cards matched cleanly — nothing to confirm.
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <Button onClick={onContinue} disabled={continueDisabled} className="gap-2">
          Continue
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Step4Preview({
  format,
  built,
  total,
  onBack,
  onContinue,
}: {
  format: FormatSignature;
  built: {
    rows: Array<{
      spread_type: string;
      card_ids: number[];
      card_orientations: boolean[];
      question: string | null;
      note: string | null;
      tags: string[];
      created_at: string;
    }>;
    skipped: number;
  };
  total: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const dates = built.rows
    .map((r) => new Date(r.created_at).getTime())
    .filter((n) => !Number.isNaN(n));
  const min = dates.length ? new Date(Math.min(...dates)) : null;
  const max = dates.length ? new Date(Math.max(...dates)) : null;
  const spreadCounts: Record<string, number> = {};
  for (const r of built.rows) {
    spreadCounts[r.spread_type] = (spreadCounts[r.spread_type] ?? 0) + 1;
  }
  const allTags = new Set<string>();
  for (const r of built.rows) for (const t of r.tags) allTags.add(t);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Preview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review what&apos;s about to import. Nothing has been saved yet.
        </p>
      </div>

      <div className="rounded-lg border border-border/40 p-3 text-sm">
        <ul className="space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">{built.rows.length}</strong>{" "}
            readings ready to import (from {total} CSV rows · {format.label})
          </li>
          {min && max && (
            <li>
              Date range: {min.toLocaleDateString()} → {max.toLocaleDateString()}
            </li>
          )}
          <li>
            Spread types:{" "}
            {Object.entries(spreadCounts)
              .map(([k, v]) => `${v} ${k}`)
              .join(" · ")}
          </li>
          <li>{allTags.size} unique tags discovered</li>
          {built.skipped > 0 && (
            <li>{built.skipped} rows skipped (no valid cards)</li>
          )}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          First 5 readings
        </h3>
        {built.rows.slice(0, 5).map((r, i) => (
          <div
            key={i}
            className="rounded-lg border border-border/40 px-3 py-2 text-xs"
          >
            <div className="text-muted-foreground">
              {new Date(r.created_at).toLocaleString()} · {r.spread_type}
            </div>
            <div className="mt-1">
              {r.card_ids
                .map((id, j) => `${getCanonicalName(id)}${r.card_orientations[j] ? " (R)" : ""}`)
                .join(" · ")}
            </div>
            {r.question && (
              <div className="mt-1 italic text-muted-foreground">
                “{r.question}”
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={onContinue}
          disabled={built.rows.length === 0}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          Import {built.rows.length} readings
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Step5Result({
  running,
  progress,
  result,
  onClose,
}: {
  running: boolean;
  progress: { done: number; total: number };
  result: ImportResult | null;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);

  const onUndo = async () => {
    if (!result) return;
    const ok = await confirm({
      title: "Delete imported readings?",
      description: `Remove all ${result.imported} readings imported from ${result.sourceFormat}? This cannot be undone.`,
      confirmLabel: "Delete imported readings",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setUndoing(true);
    try {
      const headers = await authHeaders();
      const res = await undoImport({ data: { batchId: result.batchId }, headers });
      toast.success(`Deleted ${res.deleted} readings`);
      setUndone(true);
    } catch (e) {
      toast.error((e as Error).message || "Undo failed");
    } finally {
      setUndoing(false);
    }
  };

  if (running || !result) {
    const pct = progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Importing…</h2>
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            Importing {progress.done.toLocaleString()} of{" "}
            {progress.total.toLocaleString()}…
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {undone ? "Import undone" : "Import complete"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {undone
            ? "All imported readings were removed."
            : `${result.imported.toLocaleString()} readings added · ${result.failed.toLocaleString()} skipped`}
        </p>
      </div>

      {!undone && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const batchId = result?.batchId;
              onClose();
              if (batchId) {
                void navigate({
                  to: "/journal",
                  search: { batch: batchId },
                });
              }
            }}
          >
            View imported readings
          </Button>
          <Button
            variant="outline"
            onClick={() => void onUndo()}
            disabled={undoing}
            className="gap-2"
          >
            {undoing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Undo this import
          </Button>
        </div>
      )}
      {undone && <Button onClick={onClose}>Done</Button>}
    </div>
  );
}