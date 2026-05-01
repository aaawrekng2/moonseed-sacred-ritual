/**
 * CSV import — parser + date-format inference (CS).
 *
 * Wraps papaparse with: auto-detected delimiter, header trimming,
 * stable row shape (Record<string, string>), and a sample-based
 * date-format inferer used by the wizard's preview step.
 */
import Papa from "papaparse";

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: string;
};

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      dynamicTyping: false,
      worker: false,
      complete: (results) => {
        const headers = (results.meta.fields ?? []).map((h) => String(h).trim());
        const rows = (results.data ?? []) as Array<Record<string, string>>;
        resolve({
          headers,
          rows,
          delimiter: results.meta.delimiter ?? ",",
        });
      },
      error: (err) => reject(err),
    });
  });
}

/* ------------------------- Date format inference ------------------------- */

export type DateFormat =
  | "iso"
  | "us"
  | "eu"
  | "named"
  | "unknown";

const ISO_RE = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_RE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/;
const NAMED_RE = /^(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2})(?:,\s*\d{4})?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}$|^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}$/i;

function looksLikeUsLocale(): boolean {
  try {
    const lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    return /^en-US/i.test(lang);
  } catch {
    return false;
  }
}

/**
 * Inspect a sample of date strings and pick the most likely format.
 * Returns "unknown" if nothing parses cleanly.
 */
export function detectDateFormat(samples: string[]): DateFormat {
  const candidates = samples
    .map((s) => (s ?? "").toString().trim())
    .filter((s) => s.length > 0)
    .slice(0, 10);
  if (candidates.length === 0) return "unknown";

  let isoOk = 0;
  let slashAmbiguous = 0;
  let usOnly = 0;
  let euOnly = 0;
  let namedOk = 0;

  for (const s of candidates) {
    if (ISO_RE.test(s)) {
      isoOk++;
      continue;
    }
    if (NAMED_RE.test(s)) {
      namedOk++;
      continue;
    }
    const m = s.match(SLASH_RE);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > 12 && b <= 12) euOnly++;
      else if (b > 12 && a <= 12) usOnly++;
      else slashAmbiguous++;
    }
  }

  if (isoOk === candidates.length) return "iso";
  if (namedOk === candidates.length) return "named";
  if (usOnly > 0 && euOnly === 0) return "us";
  if (euOnly > 0 && usOnly === 0) return "eu";
  if (slashAmbiguous + usOnly + euOnly === candidates.length) {
    return looksLikeUsLocale() ? "us" : "eu";
  }
  return "unknown";
}

/** Best-effort parse of a single date string under a chosen format. */
export function parseDateAs(value: string, fmt: DateFormat): Date | null {
  const s = (value ?? "").toString().trim();
  if (!s) return null;
  if (fmt === "iso" || ISO_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  if (fmt === "named" || NAMED_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(SLASH_RE);
  if (m) {
    let mo: number, day: number;
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    if (fmt === "us") {
      mo = Number(m[1]);
      day = Number(m[2]);
    } else {
      day = Number(m[1]);
      mo = Number(m[2]);
    }
    const d = new Date(yr, mo - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback to JS Date
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}