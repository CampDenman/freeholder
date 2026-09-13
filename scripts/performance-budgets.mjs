// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11 harness for MASTER.md §15.1. Parses the budget table, decides which
// surfaces must be measured, and fails closed when a required measurement is
// missing or over budget. Browser vitals, editor, job-queue, migration and
// large-dataset runs are opt-in; requesting them without the capability is a
// failure, not a skip.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    return { ok: failures.length === 0, failures };
  }

  const required = requiredSurfaces(input);
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
    measureJobs: env.PERF_MEASURE_JOBS === "1",
    measureMigration: env.PERF_MEASURE_MIGRATION === "1",
    measureBoot: env.PERF_MEASURE_BOOT === "1",
  };
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

  const dataset = datasetFromEnv();
  const flags = measurementFlags();
  if ((dataset === "medium" || dataset === "large") && !process.env.DATABASE_URL) {
    console.error(
      `PERF_DATASET=${dataset} requires DATABASE_URL. Refusing to skip a requested dataset.`,
    );
    process.exit(1);
  }
  if (flags.measureBrowser && process.env.PERF_HAS_PLAYWRIGHT !== "1") {
    console.error(
      "PERF_MEASURE_BROWSER=1 requires PERF_HAS_PLAYWRIGHT=1. Refusing to skip Core Web Vitals.",
    );
    process.exit(1);
  }

  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "tests/core/performance-budgets.test.ts"],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
