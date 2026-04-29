#!/usr/bin/env node
/**
 * compare-tz-coverage.mjs
 *
 * Diffs the current run's timezone property-coverage JSON against the
 * previous run's JSON and prints a regression report.
 *
 * Inputs (CLI args, both required):
 *   --current  path to this run's JSON (typically coverage-artifacts/latest.json)
 *   --previous path to the previous run's JSON (downloaded by CI)
 *
 * Optional:
 *   --summary  path to append a Markdown report to (e.g. $GITHUB_STEP_SUMMARY)
 *   --fail-on-disappeared-zone  exit 1 if any (invariant, zone) pair went from >0 to 0
 *   --drop-threshold N  warn when a zone's case count drops by more than N
 *                       cases relative to the previous run (default: 5)
 *
 * Exit codes:
 *   0  no regressions detected (or only warnings)
 *   1  one or more invariants lost coverage on a zone (only if
 *      --fail-on-disappeared-zone is set)
 *   2  bad CLI / unreadable input
 *
 * The previous-run JSON is expected to follow the schema written by
 * src/lib/use-timezone.property.test.ts:
 *   { invariants: [{ invariant, status, totalCases, perZone }] }
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs";

function parseArgs(argv) {
  const out = { dropThreshold: 5, failOnDisappearedZone: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--current") out.current = argv[++i];
    else if (a === "--previous") out.previous = argv[++i];
    else if (a === "--summary") out.summary = argv[++i];
    else if (a === "--fail-on-disappeared-zone") out.failOnDisappearedZone = true;
    else if (a === "--drop-threshold") out.dropThreshold = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: compare-tz-coverage.mjs --current <path> --previous <path> [--summary <path>] [--fail-on-disappeared-zone] [--drop-threshold N]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function loadJson(path, label) {
  if (!path) {
    console.error(`Missing required --${label} argument`);
    process.exit(2);
  }
  if (!existsSync(path)) {
    console.error(`${label} file not found: ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${label} JSON at ${path}: ${err.message}`);
    process.exit(2);
  }
}

function indexInvariants(report) {
  const map = new Map();
  for (const inv of report.invariants ?? []) {
    map.set(inv.invariant, inv);
  }
  return map;
}

function compare(current, previous, opts) {
  const cur = indexInvariants(current);
  const prev = indexInvariants(previous);

  /** @type {Array<{invariant: string, kind: "disappeared"|"dropped", zone: string, prev: number, now: number}>} */
  const findings = [];

  // Newly-missing invariants (an entire property disappeared, e.g. test was
  // renamed without bumping baseline). Treat as informational.
  const droppedInvariants = [];
  for (const name of prev.keys()) {
    if (!cur.has(name)) droppedInvariants.push(name);
  }

  // New invariants in this run — informational, not a regression.
  const newInvariants = [];
  for (const name of cur.keys()) {
    if (!prev.has(name)) newInvariants.push(name);
  }

  for (const [name, curInv] of cur) {
    const prevInv = prev.get(name);
    if (!prevInv) continue;
    const allZones = new Set([
      ...Object.keys(prevInv.perZone ?? {}),
      ...Object.keys(curInv.perZone ?? {}),
    ]);
    for (const zone of allZones) {
      const before = prevInv.perZone?.[zone] ?? 0;
      const after = curInv.perZone?.[zone] ?? 0;
      if (before > 0 && after === 0) {
        findings.push({ invariant: name, kind: "disappeared", zone, prev: before, now: after });
      } else if (after < before && before - after > opts.dropThreshold) {
        findings.push({ invariant: name, kind: "dropped", zone, prev: before, now: after });
      }
    }
  }

  return { findings, droppedInvariants, newInvariants };
}

function renderText({ findings, droppedInvariants, newInvariants }, current, previous) {
  const lines = [];
  lines.push("─── Timezone coverage diff vs. previous run ───");
  lines.push(`  previous: seed=${previous.seed ?? "?"}, generatedAt=${previous.generatedAt ?? "?"}`);
  lines.push(`  current:  seed=${current.seed ?? "?"}, generatedAt=${current.generatedAt ?? "?"}`);
  lines.push("");

  if (newInvariants.length) {
    lines.push(`New invariants (no baseline yet): ${newInvariants.length}`);
    newInvariants.forEach((n) => lines.push(`  + ${n}`));
    lines.push("");
  }
  if (droppedInvariants.length) {
    lines.push(`Invariants present in baseline but missing now: ${droppedInvariants.length}`);
    droppedInvariants.forEach((n) => lines.push(`  - ${n}`));
    lines.push("");
  }

  if (findings.length === 0) {
    lines.push("✅ No per-zone regressions detected.");
  } else {
    const disappeared = findings.filter((f) => f.kind === "disappeared");
    const dropped = findings.filter((f) => f.kind === "dropped");
    if (disappeared.length) {
      lines.push(`⛔ ${disappeared.length} (invariant, zone) pair(s) went from >0 cases to ZERO:`);
      for (const f of disappeared) {
        lines.push(`   • ${f.invariant}`);
        lines.push(`       zone=${f.zone}   ${f.prev} → ${f.now}`);
      }
      lines.push("");
    }
    if (dropped.length) {
      lines.push(`⚠️  ${dropped.length} (invariant, zone) pair(s) lost noticeable coverage:`);
      for (const f of dropped) {
        lines.push(`   • ${f.invariant}`);
        lines.push(`       zone=${f.zone}   ${f.prev} → ${f.now}   (Δ -${f.prev - f.now})`);
      }
    }
  }
  lines.push("───────────────────────────────────────────────");
  return lines.join("\n");
}

function renderMarkdown({ findings, droppedInvariants, newInvariants }, current, previous) {
  const lines = [];
  lines.push("## Timezone coverage diff vs. previous run");
  lines.push("");
  lines.push(`- **Previous run:** seed \`${previous.seed ?? "?"}\` at \`${previous.generatedAt ?? "?"}\``);
  lines.push(`- **Current run:** seed \`${current.seed ?? "?"}\` at \`${current.generatedAt ?? "?"}\``);
  lines.push("");

  if (newInvariants.length) {
    lines.push(`### ➕ New invariants (no baseline)`);
    newInvariants.forEach((n) => lines.push(`- ${n}`));
    lines.push("");
  }
  if (droppedInvariants.length) {
    lines.push(`### ➖ Invariants no longer present`);
    droppedInvariants.forEach((n) => lines.push(`- ${n}`));
    lines.push("");
  }

  if (findings.length === 0) {
    lines.push("✅ **No per-zone regressions detected.**");
    return lines.join("\n");
  }

  lines.push("| Severity | Invariant | Zone | Previous | Current | Δ |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const f of findings) {
    const sev = f.kind === "disappeared" ? "⛔ DISAPPEARED" : "⚠️ DROP";
    lines.push(`| ${sev} | ${f.invariant} | \`${f.zone}\` | ${f.prev} | ${f.now} | -${f.prev - f.now} |`);
  }
  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv);
  const current = loadJson(opts.current, "current");
  const previous = loadJson(opts.previous, "previous");
  const result = compare(current, previous, opts);

  console.log(renderText(result, current, previous));

  if (opts.summary) {
    try {
      appendFileSync(opts.summary, "\n" + renderMarkdown(result, current, previous) + "\n");
    } catch (err) {
      console.error(`Failed to append Markdown summary: ${err.message}`);
    }
  }

  const disappeared = result.findings.some((f) => f.kind === "disappeared");
  if (opts.failOnDisappearedZone && disappeared) {
    console.error("::error::Coverage regression: at least one (invariant, zone) pair lost ALL cases vs. the previous run.");
    process.exit(1);
  }
  process.exit(0);
}

main();