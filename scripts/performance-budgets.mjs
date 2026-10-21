// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11 harness for MASTER.md §15.1. Parses the budget table, decides which
// surfaces must be measured, and fails closed when a required measurement is
// missing or over budget. Browser vitals, editor, job-queue, migration,
// cold-boot and large-dataset runs are opt-in; requesting them without the
// capability is a failure, not a skip.
import { spawnSync } from "node:child_process";
import { cpus, hostname, platform, totalmem } from "node:os";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DATASET_SIZES = Object.freeze({
  small: Object.freeze({
    contacts: 50,
    messages: 200,
    orders: 20,
    products: 10,
    assets: 20,
  }),
  medium: Object.freeze({
    contacts: 5_000,
    messages: 20_000,
    orders: 2_000,
    products: 500,
    assets: 10_000,
  }),
  large: Object.freeze({
    contacts: 100_000,
    messages: 0,
    orders: 0,
    products: 0,
    assets: 0,
  }),
});

const SECTION = /### 15\.1 The performance budgets, defined([\s\S]*?)\nThree rules about the numbers themselves:/;

export const SERVER_SURFACES = Object.freeze([
  "Public page, server render",
  "Admin list (any)",
  "Admin detail",
  "Search (inbox, contacts, help)",
  "Report generation",
]);

export const OPTIONAL_SURFACES = Object.freeze({
  browser: Object.freeze(["Public page, LCP", "Public page, INP", "Public page, CLS"]),
  editor: Object.freeze(["Editor first paint", "Editor keystroke → preview"]),
  jobs: Object.freeze(["Job queue latency"]),
  migration: Object.freeze(["Migration, medium dataset"]),
  boot: Object.freeze(["Cold boot to serving"]),
});

export function parsePerformanceBudgets(master) {
  const section = SECTION.exec(master);
  if (!section) {
    throw new Error("MASTER.md §15.1 budget table is missing.");
  }
  const budgets = [];
  for (const line of section[1].split(/\r?\n/)) {
    const match = /^\|\s*(?!Surface)([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|$/.exec(line);
    if (!match) continue;
    const surface = match[1].trim();
    const raw = match[2].trim();
    if (surface === "Surface" || !raw.includes("≤")) continue;
    const parsed = parseBudgetCell(raw);
    budgets.push({ surface, raw, ...parsed });
  }
  if (budgets.length < 10) {
    throw new Error(`MASTER.md §15.1 parsed ${budgets.length} budget rows; expected the full table.`);
  }
  return budgets;
}

function parseBudgetCell(raw) {
  const cls = /≤\s*([\d.]+)\s*p(\d+)\s*$/.exec(raw);
  if (cls && !/ms|s/.test(raw)) {
    return { limit: Number(cls[1]), unit: "score", percentile: Number(cls[2]) };
  }
  const timed = /≤\s*([\d.]+)\s*(ms|s)\s*(?:p(\d+))?/.exec(raw);
  if (!timed) {
    throw new Error(`Cannot parse budget cell: ${raw}`);
  }
  const amount = Number(timed[1]);
  const ms = timed[2] === "s" ? amount * 1000 : amount;
  return {
    limit: ms,
    unit: "ms",
    percentile: timed[3] ? Number(timed[3]) : null,
  };
}

export function requiredSurfaces(options) {
  const names = new Set(SERVER_SURFACES);
  if (options.measureBrowser) {
    for (const name of OPTIONAL_SURFACES.browser) names.add(name);
  }
  if (options.measureEditor) {
    for (const name of OPTIONAL_SURFACES.editor) names.add(name);
  }
  if (options.measureJobs) names.add(OPTIONAL_SURFACES.jobs[0]);
  if (options.measureMigration) names.add(OPTIONAL_SURFACES.migration[0]);
  if (options.measureBoot) names.add(OPTIONAL_SURFACES.boot[0]);
  return names;
}

/**
 * Fail-closed evaluation.
 *
 * Large datasets are bounded, not budgeted: the harness must still prove a
 * list paginates, but must not apply the medium time caps. Missing a
 * required surface, exceeding a budget, or regressing more than 10% against
 * a previous-release baseline is a failure. An opt-in measurement that was
 * requested and not produced is a failure, never a skip.
 */
export function evaluateMeasurements(input) {
  const failures = [];
  if (input.requested && !input.capable) {
    failures.push(
      `Requested ${input.requested} but this run cannot perform it (${input.incapableReason ?? "capability missing"}).`,
    );
    return { ok: false, failures };
  }
  if (input.dataset === "large") {
    if (input.bounded?.paginated !== true) {
      failures.push("Large-dataset run did not prove pagination stayed correct.");
    }
  }

  const required = requiredSurfaces(input);
  if (input.dataset === "large") {
    for (const name of SERVER_SURFACES) required.delete(name);
  }
  const bySurface = new Map((input.measurements ?? []).map((row) => [row.surface, row]));
  const budgets = new Map((input.budgets ?? []).map((row) => [row.surface, row]));

  for (const surface of required) {
    const measured = bySurface.get(surface);
    const budget = budgets.get(surface);
    if (!measured) {
      failures.push(`Missing measurement for ${surface}.`);
      continue;
    }
    if (!budget) {
      failures.push(`No §15.1 budget for measured surface ${surface}.`);
      continue;
    }
    if (!Number.isFinite(measured.value) || measured.value < 0) {
      failures.push(`Invalid measurement for ${surface}: expected a finite nonnegative number.`);
      continue;
    }
    if (!Number.isFinite(budget.limit) || budget.limit < 0) {
      failures.push(`Invalid budget for ${surface}.`);
      continue;
    }
    if (measured.value > budget.limit) {
      failures.push(
        `${surface}: ${measured.value}${budget.unit} exceeds ${budget.limit}${budget.unit}.`,
      );
    }
    const previous = input.baseline?.[surface];
    if (typeof previous === "number" && measured.value > previous * 1.1) {
      failures.push(
        `${surface}: ${measured.value} regresses more than 10% from previous ${previous}.`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

export function datasetFromEnv(env = process.env) {
  const value = (env.PERF_DATASET ?? "small").toLowerCase();
  if (value !== "small" && value !== "medium" && value !== "large") {
    throw new Error(`PERF_DATASET must be small, medium or large (got ${value}).`);
  }
  return value;
}

export function measurementFlags(env = process.env) {
  return {
    measureBrowser: env.PERF_MEASURE_BROWSER === "1",
    measureEditor: env.PERF_MEASURE_EDITOR === "1",
    measureJobs: env.PERF_MEASURE_JOBS === "1",
    measureMigration: env.PERF_MEASURE_MIGRATION === "1",
    measureBoot: env.PERF_MEASURE_BOOT === "1",
  };
}

/** The acceptance contract (deploy/performance-measurements.md): every run
 * must carry the commit, host configuration, command and complete output, so
 * a diagnostic local run can never be mistaken for the §15.1 reference-target
 * acceptance. */
export function runHeader(env = process.env) {
  const commit = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
  });
  const flags = measurementFlags(env);
  const enabled = [
    "server surfaces (always)",
    flags.measureBrowser ? "browser Core Web Vitals + whole-page HTTP (PERF_MEASURE_BROWSER=1)" : null,
    flags.measureEditor ? "editor first paint + keystroke→preview (PERF_MEASURE_EDITOR=1)" : null,
    flags.measureJobs ? "job queue latency (PERF_MEASURE_JOBS=1)" : null,
    flags.measureMigration ? "migration chain apply (PERF_MEASURE_MIGRATION=1)" : null,
    flags.measureBoot ? "cold boot to serving (PERF_MEASURE_BOOT=1)" : null,
  ].filter(Boolean);
  const command = [
    `PERF_DATASET=${env.PERF_DATASET ?? "small"}`,
    ...Object.entries(flags)
      .filter(([, on]) => on)
      .map(([name]) => `PERF_${name.replace(/^measure/, "MEASURE_").toUpperCase()}=1`),
    "pnpm perf:budgets",
  ].join(" ");
  return [
    "Perf run header — keep this block with the acceptance evidence:",
    `  commit: ${commit.status === 0 ? commit.stdout.trim() : "unknown (not a git checkout)"}`,
    `  host: ${hostname()} · ${platform()} · ${cpus().length} CPUs · ${Math.round(totalmem() / 1024 / 1024 / 1024)}GB RAM`,
    `  command: ${command}`,
    `  dataset: ${env.PERF_DATASET ?? "small"}`,
    `  families: ${enabled.join(" | ")}`,
  ].join("\n");
}

function failRequested(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const checkOnly = process.argv.includes("--check-only");
  const master = readFileSync("MASTER.md", "utf8");
  const budgets = parsePerformanceBudgets(master);
  console.log(`§15.1: ${budgets.length} budgets parsed.`);
  for (const row of budgets) {
    console.log(`  ${row.surface}: ${row.raw}`);
  }
  if (checkOnly) return;

  if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(".env"); } catch { /* Optional, like Vitest's config. */ }
  }
  const dataset = datasetFromEnv();
  const flags = measurementFlags();
  console.log(runHeader());
  console.log(`Measuring ${dataset} dataset.`);
  if (!process.env.TEST_DATABASE_URL && !(process.env.CI && process.env.DATABASE_URL)) {
    console.error("Performance measurements require TEST_DATABASE_URL (or CI DATABASE_URL) pointing at a disposable database. Use --check-only to validate the budget table without measurements.");
    process.exit(1);
  }
  if ((flags.measureBrowser || flags.measureEditor) && process.env.PERF_HAS_PLAYWRIGHT !== "1") {
    failRequested(
      "PERF_MEASURE_BROWSER/PERF_MEASURE_EDITOR require PERF_HAS_PLAYWRIGHT=1. Refusing to skip Core Web Vitals or editor clocks.",
    );
  }
  if ((flags.measureBrowser || flags.measureEditor) &&
      !existsSync(resolve(".next/standalone/server.js"))) {
    failRequested(
      "PERF_MEASURE_BROWSER/PERF_MEASURE_EDITOR require the production standalone build (.next/standalone/server.js). Run pnpm build first; refusing to measure a dev server.",
    );
  }
  if (flags.measureBoot && !existsSync(resolve(".next/BUILD_ID"))) {
    failRequested(
      "PERF_MEASURE_BOOT=1 requires the production build (.next/BUILD_ID). Run pnpm build first; refusing to cold-boot a dev server.",
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "freeholder-performance-"));
  try {
    const reportPath = join(directory, "results.json");
    // Vitest is run through Node directly rather than through the package
    // manager. `spawnSync("pnpm", …)` cannot work on Windows: there is no bare
    // `pnpm` to execute, and naming `pnpm.cmd` is refused outright with EINVAL
    // because Node will not spawn a .cmd without a shell. Turning the shell on
    // would then put a temp path through cmd quoting for no benefit.
    //
    // This matters rather than being a tidy-up: C11.11 asks the owner to
    // produce acceptance evidence, the owner works on Windows, and until now
    // this harness exited before measuring anything there. A gate that only
    // runs on the CI image cannot be the gate somebody signs.
    const vitest = resolve("node_modules", "vitest", "vitest.mjs");
    if (!existsSync(vitest)) {
      throw new Error("vitest is not installed; run the install before measuring.");
    }
    const result = spawnSync(
      process.execPath,
      [vitest, "run", "tests/core/performance-budgets.test.ts",
        "--reporter=default", "--reporter=json", `--outputFile.json=${reportPath}`],
      { stdio: "inherit", env: process.env },
    );
    if (result.status !== 0) throw new Error(`Performance test runner failed (${result.status ?? result.error?.message}).`);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const measured = report.testResults?.flatMap((file) => file.assertionResults ?? [])
      .find((test) => test.title === "measures the requested dataset with verified fixture counts");
    if (measured?.status !== "passed") {
      throw new Error("The required seeded measurement did not pass; skipped tests are not performance evidence.");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
