// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: §15.1 budgets are machine-checked. Small dataset runs in CI when a
// database is present. Medium/large and browser/job/migration/boot surfaces
// are opt-in and fail closed when requested without the capability.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DATASET_SIZES,
  datasetFromEnv,
  evaluateMeasurements,
  measurementFlags,
  parsePerformanceBudgets,
} from "../../scripts/performance-budgets.mjs";
import { measureServerSurfaces, seedPerformanceDataset } from "../helpers/performance";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { listContacts } from "@/core/contacts/service";

const master = readFileSync("MASTER.md", "utf8");
const budgets = parsePerformanceBudgets(master);

describe("§15.1 budget table", () => {
  it("names every surface the completion item asked for", () => {
    const names = budgets.map((row) => row.surface);
    expect(names).toEqual([
      "Public page, LCP",
      "Public page, INP",
      "Public page, CLS",
      "Public page, server render",
      "Admin list (any)",
      "Admin detail",
      "Editor first paint",
      "Editor keystroke → preview",
      "Search (inbox, contacts, help)",
      "Report generation",
      "Job queue latency",
      "Migration, medium dataset",
      "Cold boot to serving",
    ]);
    expect(budgets.find((row) => row.surface === "Public page, LCP")).toMatchObject({
      limit: 2500,
      percentile: 75,
    });
    expect(budgets.find((row) => row.surface === "Admin list (any)")).toMatchObject({
      limit: 800,
      percentile: 95,
    });
    expect(DATASET_SIZES.medium).toEqual({
      contacts: 5_000,
      messages: 20_000,
      orders: 2_000,
      products: 500,
      assets: 10_000,
    });
  });

  it("fails closed when a required measurement is missing or over budget", () => {
    const over = evaluateMeasurements({
      dataset: "small",
      budgets,
      measurements: [
        { surface: "Public page, server render", value: 301 },
        { surface: "Admin list (any)", value: 10 },
        { surface: "Admin detail", value: 10 },
        { surface: "Search (inbox, contacts, help)", value: 10 },
        { surface: "Report generation", value: 10 },
      ],
    });
    expect(over.ok).toBe(false);
    expect(over.failures.some((row) => row.includes("server render"))).toBe(true);

    const missing = evaluateMeasurements({
      dataset: "small",
      budgets,
      measurements: [],
    });
    expect(missing.ok).toBe(false);
    expect(missing.failures.length).toBeGreaterThan(0);

    const skippedBrowser = evaluateMeasurements({
      dataset: "small",
      requested: "browser vitals",
      capable: false,
      incapableReason: "Playwright not available",
      budgets,
      measurements: [],
    });
    expect(skippedBrowser.ok).toBe(false);

    const large = evaluateMeasurements({
      dataset: "large",
      bounded: { paginated: true },
    });
    expect(large.ok).toBe(true);
    expect(
      evaluateMeasurements({ dataset: "large", bounded: { paginated: false } }).ok,
    ).toBe(false);
  });

  it("fails a >10% regression against the previous release even under the cap", () => {
    const result = evaluateMeasurements({
      dataset: "small",
      budgets,
      measurements: [
        { surface: "Public page, server render", value: 200 },
        { surface: "Admin list (any)", value: 200 },
        { surface: "Admin detail", value: 200 },
        { surface: "Search (inbox, contacts, help)", value: 200 },
        { surface: "Report generation", value: 200 },
      ],
      baseline: { "Admin list (any)": 100 },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.some((row) => row.includes("10%"))).toBe(true);
  });
});

describe.runIf(hasDatabase)("seeded small-dataset measurements", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("stays inside §15.1 caps on the small seed, and paginates when large is requested", async () => {
    const dataset = datasetFromEnv();
    const flags = measurementFlags();
    if (dataset === "large") {
      const seed = await seedPerformanceDataset("large");
      const page = await listContacts.call({ limit: 25, offset: 0 }, OWNER);
      expect(page.rows).toHaveLength(25);
      expect(page.total).toBe(DATASET_SIZES.large.contacts);
      const verdict = evaluateMeasurements({
        dataset: "large",
        bounded: { paginated: page.rows.length === 25 && page.total === DATASET_SIZES.large.contacts },
      });
      expect(verdict.failures).toEqual([]);
      expect(seed.slug).toBe("perf-home");
      return;
    }

    if (flags.measureBrowser && process.env.PERF_HAS_PLAYWRIGHT !== "1") {
      throw new Error("PERF_MEASURE_BROWSER=1 without Playwright is fail-closed.");
    }
    if (flags.measureJobs) {
      throw new Error("PERF_MEASURE_JOBS=1 is fail-closed until the worker harness is wired.");
    }
    if (flags.measureMigration) {
      throw new Error("PERF_MEASURE_MIGRATION=1 is fail-closed until a medium migrate clock is wired.");
    }
    if (flags.measureBoot) {
      throw new Error("PERF_MEASURE_BOOT=1 is fail-closed until a cold process spawn is wired.");
    }

    const size = dataset === "medium" ? "medium" : "small";
    const seed = await seedPerformanceDataset(size);
    const measurements = await measureServerSurfaces(seed);
    const verdict = evaluateMeasurements({
      dataset: size,
      ...flags,
      budgets,
      measurements,
    });
    expect(verdict.failures, verdict.failures.join("\n")).toEqual([]);
  });
});
