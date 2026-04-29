import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  getDayInTz,
  getDayOffsetInTz,
  getTodayInTz,
  getYmdInTz,
  getDatePartsInTz,
} from "./use-timezone";

/**
 * Property-based tests for tz-aware day math.
 *
 * On failure we want THREE things, not just a stack trace:
 *   1. The invariant's plain-English name.
 *   2. The shrunk minimal counter-example as `{ iso, tz, n? }` — Date
 *      objects render uselessly in test output, ISO strings are
 *      reproducible.
 *   3. The fast-check seed + path so a developer can rerun the exact
 *      failing sequence locally with `FC_SEED=... FC_PATH=...`.
 *
 * The `runProperty` helper below packages all of that.
 */

const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Anchorage",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Kolkata", // UTC+5:30 — half-hour offset
  "Asia/Tokyo",
  "Asia/Kathmandu", // UTC+5:45 — quarter-hour offset
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Chatham", // UTC+12:45 — bizarre offset
] as const;

// Instant range: 18 months covering Sep 2025 → Mar 2027.
//
// Why this window (and why it's enough):
//   - It contains TWO Northern-Hemisphere DST cycles (spring-forward
//     Mar 2026 + Mar 2027, fall-back Nov 2025 + Nov 2026) for US/EU/UK.
//   - It contains TWO Southern-Hemisphere cycles for AU/NZ (Apr + Oct
//     transitions in 2026), plus Pacific/Chatham's :45 offset shifts.
//   - It still spans a year boundary, so YMD-string comparisons cross
//     both month and year rollovers.
// We previously sampled a 7-year window, but per-zone case counts in
// the coverage summary showed every zone hit ≥30 times even with the
// tighter window — the extra years bought no additional bug-finding
// power, only wall-clock time.
const MIN_MS = Date.UTC(2025, 8, 1); // 2025-09-01
const MAX_MS = Date.UTC(2027, 2, 31); // 2027-03-31

const arbInstant = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms));
const arbZone = fc.constantFrom(...ZONES);
// Day offsets: ±60 instead of ±120. The helpers are linear in N — once
// round-trip / composition pass over a ±2-month span we're not learning
// anything new from ±4-month inputs.
const arbOffset = fc.integer({ min: -60, max: 60 });

// Default fast-check iterations per property. 150 still hits every one
// of the 14 zones ~10 times per invariant (verified via the coverage
// summary), which is enough to catch real regressions.
const DEFAULT_NUM_RUNS = 150;

/**
 * Coverage tracker.
 *
 * Property-based tests are only as trustworthy as their distribution: a
 * green run that happened to skip half the zones is a silent gap. We
 * therefore record, per invariant:
 *   - status (passed / failed),
 *   - total cases checked (== fast-check `numRuns` on success, or the
 *     count up to the failing case),
 *   - per-zone case counts (so a reviewer can see e.g. that
 *     Pacific/Chatham was hit 36 times this run, not zero).
 *
 * Predicates call `recordCase(invariant, tz)` on every iteration; the
 * `runProperty` wrapper finalizes status + total. `afterAll` prints a
 * table and, in CI, appends it to $GITHUB_STEP_SUMMARY and dumps a
 * JSON artifact to /tmp/timezone-property-coverage.json.
 */
type InvariantStats = {
  invariant: string;
  status: "passed" | "failed" | "pending";
  totalCases: number;
  perZone: Record<string, number>;
};
const coverage = new Map<string, InvariantStats>();

function ensureStats(invariant: string): InvariantStats {
  let s = coverage.get(invariant);
  if (!s) {
    s = { invariant, status: "pending", totalCases: 0, perZone: {} };
    coverage.set(invariant, s);
  }
  return s;
}

function recordCase(invariant: string, tz: string): void {
  const s = ensureStats(invariant);
  s.totalCases += 1;
  s.perZone[tz] = (s.perZone[tz] ?? 0) + 1;
}

/**
 * Render a tuple of property inputs as a human-readable object. Dates
 * become ISO strings; everything else is passed through. This is what
 * gets printed when an invariant fails.
 */
function renderInputs(inputs: readonly unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  inputs.forEach((value, idx) => {
    const key = `arg${idx}`;
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = value;
    }
  });
  return out;
}

type RunOptions = {
  invariant: string;
  // Built externally via fc.property(...) — keeping the type loose here
  // sidesteps fast-check's tuple-arity inference, which fights with
  // strict generics across versions.
  property: fc.IRawProperty<unknown>;
  numRuns?: number;
  /** Optional pretty-printer override for the shrunk counter-example. */
  format?: (counterexample: readonly unknown[]) => Record<string, unknown>;
};

/**
 * Wrapper around fc.check that:
 *  - runs the property in verbose mode so fast-check prints the seed,
 *    path, and full failing-value list,
 *  - intercepts the run report and, on failure, throws a single error
 *    whose message names the invariant and shows the minimal
 *    counter-example as a JSON object plus a copy-pasteable rerun hint.
 */
function runProperty(opts: RunOptions): void {
  // Pre-register so the invariant shows up in the summary even if 0
  // cases ran (e.g. fast-check rejected every input).
  ensureStats(opts.invariant);
  // fc.check returns Promise<RunDetails> for async properties and
  // RunDetails for sync ones. Our predicates are all sync, so narrow.
  // CI pins FC_SEED so failures on a pull request are byte-for-byte
  // reproducible locally with the same env var. When unset (typical
  // local dev) fast-check picks a fresh seed each run for broader
  // coverage over time.
  const seedEnv = process.env.FC_SEED;
  const seed = seedEnv !== undefined && seedEnv !== "" ? Number(seedEnv) : undefined;
  if (seed !== undefined && !Number.isFinite(seed)) {
    throw new Error(`FC_SEED must be a finite number, got: ${JSON.stringify(seedEnv)}`);
  }
  const result = fc.check(opts.property, {
    numRuns: opts.numRuns ?? DEFAULT_NUM_RUNS,
    verbose: fc.VerbosityLevel.Verbose,
    ...(seed !== undefined ? { seed } : {}),
  }) as fc.RunDetails<unknown>;

  const stats = ensureStats(opts.invariant);
  if (!result.failed) {
    stats.status = "passed";
    return;
  }
  stats.status = "failed";

  const counterexample = (result.counterexample ?? []) as readonly unknown[];
  const rendered = opts.format
    ? opts.format(counterexample)
    : renderInputs(counterexample);

  const underlyingError =
    "errorInstance" in result && result.errorInstance instanceof Error
      ? result.errorInstance.message
      : "error" in result && typeof (result as { error?: unknown }).error === "string"
        ? ((result as { error: string }).error)
        : "<no error message>";

  const lines = [
    `INVARIANT BROKEN: ${opts.invariant}`,
    "",
    "Minimal counter-example (after shrinking):",
    JSON.stringify(rendered, null, 2),
    "",
    `Underlying error: ${underlyingError}`,
    "",
    "Reproduce locally with the same RNG path:",
    `  fc.assert(prop, { seed: ${result.seed}, path: ${JSON.stringify(result.counterexamplePath)} })`,
    "",
    `Total runs before failure: ${result.numRuns}`,
    `Shrink steps: ${result.numShrinks}`,
    "",
    buildReproSnippet({
      invariant: opts.invariant,
      rendered,
      seed: result.seed,
      path: result.counterexamplePath,
      underlyingError,
    }),
  ];

  throw new Error(lines.join("\n"));
}

/**
 * Pull the failing zone + primary instant out of a rendered
 * counter-example object.
 *
 * Per-invariant `format` callbacks use slightly different key shapes
 * (`iso` vs `aIso`/`bIso`/`cIso`, scalars `n` or `a`/`b`). We don't want
 * to thread invariant-specific knowledge into the reporter, so this
 * walks the object and picks:
 *   - `tz`: the value under the `tz` key (every format includes one),
 *   - `instantIso`: the FIRST string-valued key whose name ends with
 *     `iso` (case-insensitive). Shrinking already minimized the
 *     primary instant, so the first one is the most useful seed.
 *   - `extras`: everything else (e.g. `n`, `a`, `b`) for context.
 */
function extractReproParts(rendered: Record<string, unknown>): {
  tz: string;
  instantIso: string | null;
  extras: Record<string, unknown>;
} {
  let tz = "<unknown>";
  let instantIso: string | null = null;
  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rendered)) {
    if (key === "tz" && typeof value === "string") {
      tz = value;
      continue;
    }
    if (
      instantIso === null &&
      typeof value === "string" &&
      key.toLowerCase().endsWith("iso")
    ) {
      instantIso = value;
      continue;
    }
    extras[key] = value;
  }

  return { tz, instantIso, extras };
}

/**
 * Build a copy-pasteable failure report:
 *   - A Markdown block ready to drop into a GitHub issue (invariant
 *     label, failing zone, instant ISO, error, rerun command).
 *   - A standalone Vitest test snippet that pins the failing instant
 *     and zone as a hard-coded regression test, so the developer's
 *     first action after triaging is "paste this into use-timezone.test.ts".
 */
function buildReproSnippet(args: {
  invariant: string;
  rendered: Record<string, unknown>;
  seed: number;
  path: string | null;
  underlyingError: string;
}): string {
  const { invariant, rendered, seed, path, underlyingError } = args;
  const { tz, instantIso, extras } = extractReproParts(rendered);
  const isoLiteral = instantIso ?? "<NO_ISO_FOUND_IN_COUNTEREXAMPLE>";
  const extrasJson = Object.keys(extras).length
    ? `\n// Other shrunk inputs: ${JSON.stringify(extras)}`
    : "";

  // Short, stable test name derived from the invariant's leading clause
  // (everything before the first colon). Keeps generated snippets
  // grep-friendly: `regression: <thing>`.
  const testName = `regression: ${invariant.split(":")[0].trim().toLowerCase()} (${tz} @ ${isoLiteral})`;

  const vitestSnippet = [
    "// ─── Paste this into src/lib/use-timezone.test.ts ───",
    `import { describe, it, expect } from "vitest";`,
    `import { getDayInTz, getDayOffsetInTz, getTodayInTz, getYmdInTz, getDatePartsInTz } from "./use-timezone";`,
    "",
    `describe("regression: ${invariant.replace(/"/g, '\\"')}", () => {`,
    `  it(${JSON.stringify(testName)}, () => {`,
    `    const tz = ${JSON.stringify(tz)};`,
    `    const instant = new Date(${JSON.stringify(isoLiteral)});${extrasJson}`,
    `    // TODO: assert the specific behavior expected for this instant/tz pair.`,
    `    // Original failure: ${underlyingError.replace(/\n/g, " ")}`,
    `    expect(getYmdInTz(getTodayInTz(tz, instant), tz)).toMatchSnapshot();`,
    `  });`,
    `});`,
  ].join("\n");

  const issueBlock = [
    "─── GitHub-issue-ready report (copy from here ↓) ───",
    "",
    "### Timezone property failure",
    "",
    `- **Invariant:** ${invariant}`,
    `- **Failing timezone:** \`${tz}\``,
    `- **Minimal instant (UTC ISO):** \`${isoLiteral}\``,
    Object.keys(extras).length
      ? `- **Other shrunk inputs:** \`${JSON.stringify(extras)}\``
      : "- **Other shrunk inputs:** _(none)_",
    `- **Underlying error:** \`${underlyingError.replace(/`/g, "\\`")}\``,
    "",
    "**Reproduce locally:**",
    "```bash",
    `FC_SEED=${seed} npm run test:tz:property`,
    "```",
    "",
    "**Or rerun the exact shrunk path in fast-check:**",
    "```ts",
    `fc.assert(prop, { seed: ${seed}, path: ${JSON.stringify(path)} });`,
    "```",
    "",
    "**Suggested regression test (paste into `src/lib/use-timezone.test.ts`):**",
    "```ts",
    vitestSnippet,
    "```",
    "",
    "─── (copy to here ↑) ───",
  ].join("\n");

  return issueBlock;
}

function formatCoverageTable(): string {
  const rows = Array.from(coverage.values());
  if (rows.length === 0) return "(no invariants recorded)";

  // Use the FULL canonical zone list (not just zones-seen) so a zone
  // that received zero cases still appears as a `0` column. That way
  // distribution gaps stand out the moment you look at the table.
  const orderedZones = [...ZONES];

  const header = ["Invariant", "Status", "Cases", ...orderedZones, "Missed zones"];
  const body = rows.map((r) => {
    const missed = missedZonesFor(r);
    return [
      r.invariant,
      r.status.toUpperCase(),
      String(r.totalCases),
      ...orderedZones.map((z) => String(r.perZone[z] ?? 0)),
      // Empty string (rendered as "—") when the property hit every
      // zone, so the gap-finding signal is visually loud.
      missed.length ? missed.join(", ") : "—",
    ];
  });

  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );
  const fmtRow = (cells: string[]) =>
    "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  const sep = "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";

  return [fmtRow(header), sep, ...body.map(fmtRow)].join("\n");
}

function formatMarkdownTable(): string {
  // GitHub step summary uses GFM tables; reuse the same column layout.
  const rows = Array.from(coverage.values());
  const orderedZones = [...ZONES];

  const header = ["Invariant", "Status", "Cases", ...orderedZones, "Missed zones"];
  const sep = header.map(() => "---");
  const body = rows.map((r) => {
    const missed = missedZonesFor(r);
    return [
      r.invariant,
      r.status === "passed" ? "✅ PASS" : r.status === "failed" ? "❌ FAIL" : "⚠️ PENDING",
      String(r.totalCases),
      ...orderedZones.map((z) => {
        const n = r.perZone[z] ?? 0;
        // Bold the zero-cells so reviewers spot gaps even before they
        // read the dedicated column.
        return n === 0 ? "**0**" : String(n);
      }),
      missed.length ? `⚠️ ${missed.join(", ")}` : "—",
    ];
  });
  const toRow = (cells: string[]) => "| " + cells.join(" | ") + " |";
  return [toRow(header), toRow(sep), ...body.map(toRow)].join("\n");
}

/** Zones from the canonical list that this invariant never exercised. */
function missedZonesFor(stats: InvariantStats): string[] {
  return ZONES.filter((z) => (stats.perZone[z] ?? 0) === 0);
}

afterAll(() => {
  const table = formatCoverageTable();
  const passed = Array.from(coverage.values()).filter((r) => r.status === "passed").length;
  const failed = Array.from(coverage.values()).filter((r) => r.status === "failed").length;
  const total = coverage.size;

  // Plain-text table to stdout — visible in `vitest run` output and CI logs.
  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "─── Timezone property-based coverage summary ───",
      table,
      `Invariants: ${passed}/${total} passed${failed ? `, ${failed} FAILED` : ""}`,
      "────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );

  // JSON artifact for downstream tooling (CI uploads, dashboards, etc.).
  try {
    const payload = {
      generatedAt: new Date().toISOString(),
      seed: process.env.FC_SEED ?? null,
      summary: { total, passed, failed },
      invariants: Array.from(coverage.values()),
    };
    writeFileSync(
      "/tmp/timezone-property-coverage.json",
      JSON.stringify(payload, null, 2),
    );
  } catch {
    // Non-fatal: /tmp may not be writable in some sandboxed runners.
  }

  // GitHub Actions: render the table on the workflow's Summary tab.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(
        summaryPath,
        [
          "## Timezone property-based coverage",
          "",
          `**Seed:** \`${process.env.FC_SEED ?? "(unpinned)"}\``,
          `**Result:** ${passed}/${total} invariants passed${failed ? `, **${failed} failed**` : ""}`,
          "",
          formatMarkdownTable(),
          "",
        ].join("\n"),
      );
    } catch {
      // Non-fatal: failing to write the summary should not fail the suite.
    }
  }
});

describe("getDayInTz / getDayOffsetInTz — property-based invariants", () => {
  it("round-trip: offset(getDayInTz(today, n), today) === n", () => {
    const INV =
      "Round-trip: shifting today by N days then measuring the offset back to today must yield N.";
    runProperty({
      invariant: INV,
      property: fc.property(arbInstant, arbZone, arbOffset, (instant, tz, n) => {
        recordCase(INV, tz);
        const today = getTodayInTz(tz, instant);
        const shifted = getDayInTz(today, n, tz);
        const measured = getDayOffsetInTz(shifted, today, tz);
        expect(measured).toBe(n);
      }),
      format: ([instant, tz, n]) => ({
        iso: (instant as Date).toISOString(),
        tz: tz as string,
        n: n as number,
      }),
    });
  });

  it("symmetry: offset(a, b) === -offset(b, a)", () => {
    const INV = "Symmetry: getDayOffsetInTz must be antisymmetric in its two arguments.";
    runProperty({
      invariant: INV,
      property: fc.property(arbInstant, arbInstant, arbZone, (aInstant, bInstant, tz) => {
        recordCase(INV, tz);
        const a = getTodayInTz(tz, aInstant);
        const b = getTodayInTz(tz, bInstant);
        const ab = getDayOffsetInTz(a, b, tz);
        const ba = getDayOffsetInTz(b, a, tz);
        // Normalize -0 → 0 so toBe (Object.is) treats them equal.
        expect(ab + 0).toBe(-ba + 0);
      }),
      format: ([a, b, tz]) => ({
        aIso: (a as Date).toISOString(),
        bIso: (b as Date).toISOString(),
        tz: tz as string,
      }),
    });
  });

  it("transitive: offset(a, c) === offset(a, b) + offset(b, c)", () => {
    const INV = "Transitivity: day offsets must compose like integer subtraction.";
    runProperty({
      invariant: INV,
      property: fc.property(
        arbInstant,
        arbInstant,
        arbInstant,
        arbZone,
        (aI, bI, cI, tz) => {
          recordCase(INV, tz);
          const a = getTodayInTz(tz, aI);
          const b = getTodayInTz(tz, bI);
          const c = getTodayInTz(tz, cI);
          expect(getDayOffsetInTz(a, c, tz)).toBe(
            getDayOffsetInTz(a, b, tz) + getDayOffsetInTz(b, c, tz),
          );
        },
      ),
      format: ([a, b, c, tz]) => ({
        aIso: (a as Date).toISOString(),
        bIso: (b as Date).toISOString(),
        cIso: (c as Date).toISOString(),
        tz: tz as string,
      }),
    });
  });

  it("noon stability: getDayInTz always anchors at local hour=12", () => {
    const INV = "Noon stability: every day-cell anchor must report local hour=12.";
    runProperty({
      invariant: INV,
      property: fc.property(arbInstant, arbZone, arbOffset, (instant, tz, n) => {
        recordCase(INV, tz);
        const today = getTodayInTz(tz, instant);
        const shifted = getDayInTz(today, n, tz);
        const { hour } = getDatePartsInTz(shifted, tz);
        expect(hour).toBe(12);
      }),
      format: ([instant, tz, n]) => ({
        iso: (instant as Date).toISOString(),
        tz: tz as string,
        n: n as number,
      }),
    });
  });

  it("YMD monotonicity: positive offset → later YMD, negative → earlier", () => {
    const INV =
      "YMD monotonicity: forward day walks must produce lexicographically-greater YMDs and vice versa.";
    runProperty({
      invariant: INV,
      property: fc.property(
        arbInstant,
        arbZone,
        fc.integer({ min: 1, max: 90 }),
        (instant, tz, n) => {
          recordCase(INV, tz);
          const today = getTodayInTz(tz, instant);
          const future = getYmdInTz(getDayInTz(today, n, tz), tz);
          const past = getYmdInTz(getDayInTz(today, -n, tz), tz);
          const now = getYmdInTz(today, tz);
          expect(future > now).toBe(true);
          expect(past < now).toBe(true);
        },
      ),
      format: ([instant, tz, n]) => ({
        iso: (instant as Date).toISOString(),
        tz: tz as string,
        n: n as number,
      }),
    });
  });

  it("step uniqueness: today, today±1, today±2 are all distinct YMDs", () => {
    const INV =
      "Step uniqueness: a 5-day window centered on today must contain 5 distinct YMD keys.";
    runProperty({
      invariant: INV,
      property: fc.property(arbInstant, arbZone, (instant, tz) => {
        recordCase(INV, tz);
        const today = getTodayInTz(tz, instant);
        const ymds = [-2, -1, 0, 1, 2].map((o) =>
          getYmdInTz(getDayInTz(today, o, tz), tz),
        );
        expect(new Set(ymds).size).toBe(5);
      }),
      format: ([instant, tz]) => ({
        iso: (instant as Date).toISOString(),
        tz: tz as string,
      }),
    });
  });

  it("composition: getDayInTz(getDayInTz(t, a), b) === getDayInTz(t, a+b)", () => {
    const INV =
      "Composition: stepping a then b days must equal stepping a+b days in one go.";
    runProperty({
      invariant: INV,
      property: fc.property(
        arbInstant,
        arbZone,
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: -60, max: 60 }),
        (instant, tz, a, b) => {
          recordCase(INV, tz);
          const today = getTodayInTz(tz, instant);
          const stepwise = getDayInTz(getDayInTz(today, a, tz), b, tz);
          const direct = getDayInTz(today, a + b, tz);
          expect(getYmdInTz(stepwise, tz)).toBe(getYmdInTz(direct, tz));
        },
      ),
      format: ([instant, tz, a, b]) => ({
        iso: (instant as Date).toISOString(),
        tz: tz as string,
        a: a as number,
        b: b as number,
      }),
    });
  });

  it("24h-shift bound: a +24h jump always lands 0, 1, or 2 days later", () => {
    const INV =
      "24h-shift bound: getDayOffsetInTz of (a + 24h, a) must be 0 (DST loss), 1 (normal), or 2 (DST gain).";
    runProperty({
      invariant: INV,
      // Bumped above the default because this is the only invariant that
      // exercises DST gain/loss directly. With the narrower 18-month
      // instant window, 400 runs land ~28 cases per zone — still enough
      // to hit both spring-forward and fall-back transitions for every
      // zone in the set.
      numRuns: 400,
      property: fc.property(arbInstant, arbZone, (instant, tz) => {
        recordCase(INV, tz);
        const a = instant;
        const b = new Date(instant.getTime() + 24 * 60 * 60 * 1000);
        const offset = getDayOffsetInTz(b, a, tz);
        expect([0, 1, 2]).toContain(offset);
      }),
      format: ([instant, tz]) => ({
        iso: (instant as Date).toISOString(),
        tz: tz as string,
      }),
    });
  });
});
