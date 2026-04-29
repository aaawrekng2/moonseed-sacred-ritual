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

const MIN_MS = Date.UTC(2024, 0, 1);
const MAX_MS = Date.UTC(2030, 11, 31);

const arbInstant = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms));
const arbZone = fc.constantFrom(...ZONES);
const arbOffset = fc.integer({ min: -120, max: 120 });

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
    numRuns: opts.numRuns ?? 500,
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
  ];

  throw new Error(lines.join("\n"));
}

function formatCoverageTable(): string {
  const rows = Array.from(coverage.values());
  if (rows.length === 0) return "(no invariants recorded)";

  // All zones any invariant touched, in stable canonical order.
  const zonesSeen = new Set<string>();
  rows.forEach((r) => Object.keys(r.perZone).forEach((z) => zonesSeen.add(z)));
  const orderedZones = ZONES.filter((z) => zonesSeen.has(z));

  const header = ["Invariant", "Status", "Cases", ...orderedZones];
  const body = rows.map((r) => [
    r.invariant,
    r.status.toUpperCase(),
    String(r.totalCases),
    ...orderedZones.map((z) => String(r.perZone[z] ?? 0)),
  ]);

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
  const zonesSeen = new Set<string>();
  rows.forEach((r) => Object.keys(r.perZone).forEach((z) => zonesSeen.add(z)));
  const orderedZones = ZONES.filter((z) => zonesSeen.has(z));

  const header = ["Invariant", "Status", "Cases", ...orderedZones];
  const sep = header.map(() => "---");
  const body = rows.map((r) => [
    r.invariant,
    r.status === "passed" ? "✅ PASS" : r.status === "failed" ? "❌ FAIL" : "⚠️ PENDING",
    String(r.totalCases),
    ...orderedZones.map((z) => String(r.perZone[z] ?? 0)),
  ]);
  const toRow = (cells: string[]) => "| " + cells.join(" | ") + " |";
  return [toRow(header), toRow(sep), ...body.map(toRow)].join("\n");
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
    runProperty({
      invariant:
        "Round-trip: shifting today by N days then measuring the offset back to today must yield N.",
      property: fc.property(arbInstant, arbZone, arbOffset, (instant, tz, n) => {
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
    runProperty({
      invariant: "Symmetry: getDayOffsetInTz must be antisymmetric in its two arguments.",
      property: fc.property(arbInstant, arbInstant, arbZone, (aInstant, bInstant, tz) => {
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
    runProperty({
      invariant: "Transitivity: day offsets must compose like integer subtraction.",
      property: fc.property(
        arbInstant,
        arbInstant,
        arbInstant,
        arbZone,
        (aI, bI, cI, tz) => {
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
    runProperty({
      invariant: "Noon stability: every day-cell anchor must report local hour=12.",
      property: fc.property(arbInstant, arbZone, arbOffset, (instant, tz, n) => {
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
    runProperty({
      invariant:
        "YMD monotonicity: forward day walks must produce lexicographically-greater YMDs and vice versa.",
      property: fc.property(
        arbInstant,
        arbZone,
        fc.integer({ min: 1, max: 90 }),
        (instant, tz, n) => {
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
    runProperty({
      invariant:
        "Step uniqueness: a 5-day window centered on today must contain 5 distinct YMD keys.",
      property: fc.property(arbInstant, arbZone, (instant, tz) => {
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
    runProperty({
      invariant:
        "Composition: stepping a then b days must equal stepping a+b days in one go.",
      property: fc.property(
        arbInstant,
        arbZone,
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: -60, max: 60 }),
        (instant, tz, a, b) => {
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
    runProperty({
      invariant:
        "24h-shift bound: getDayOffsetInTz of (a + 24h, a) must be 0 (DST loss), 1 (normal), or 2 (DST gain).",
      numRuns: 1000,
      property: fc.property(arbInstant, arbZone, (instant, tz) => {
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
