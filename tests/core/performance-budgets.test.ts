// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: §15.1 budgets are machine-checked. Small dataset runs in CI when a
// database is present. Medium/large and browser/editor/job/migration/boot
// surfaces are opt-in and fail closed when requested without the capability.
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { measureQueueLatency } from "../helpers/queue-performance";
import {
  assertPortFree,
  browserPrerequisites,
  ensureOwnerSessionToken,
  measureBrowserSurfaces,
  measureEditorClocks,
  startPerfBrowserServer,
  type RunningServer,
} from "../helpers/performance-browser";
import { measureMigrationClock } from "../helpers/performance-migration";
import { bootPrerequisites, measureColdBoot } from "../helpers/performance-boot";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { revenueReport } from "@/modules/reporting/service";
import { listContacts } from "@/core/contacts/service";

const master = readFileSync("MASTER.md", "utf8");
const budgets = parsePerformanceBudgets(master);

// The seeded measurement gains wall-clock budget when an opt-in family is
// requested: each family below names its own worst-case cost.
const requestedFlags = measurementFlags();
const MEASURE_TIMEOUT =
  180_000 +
  (requestedFlags.measureBrowser ? 420_000 : 0) +
  (requestedFlags.measureEditor ? 360_000 : 0) +
  (requestedFlags.measureBoot ? 600_000 : 0) +
  (requestedFlags.measureMigration ? 120_000 : 0);

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
    expect(evaluateMeasurements({
      dataset: "large", bounded: { paginated: true }, measureBrowser: true,
    }).ok).toBe(false);
    expect(
      evaluateMeasurements({ dataset: "large", bounded: { paginated: false } }).ok,
    ).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid timing %s instead of passing a failed clock", (value) => {
    const result = evaluateMeasurements({
      dataset: "small", budgets,
      measurements: budgets.map((budget) => ({ surface: budget.surface, value })),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("Invalid measurement"))).toBe(true);
  });

  it("refuses a measurement run without a disposable database, while allowing table-only validation", () => {
    const directory = mkdtempSync(join(tmpdir(), "freeholder-perf-cli-test-"));
    const script = resolve("scripts/performance-budgets.mjs");
    const env = { ...process.env };
    delete env.TEST_DATABASE_URL;
    delete env.DATABASE_URL;
    delete env.CI;
    try {
      copyFileSync("MASTER.md", join(directory, "MASTER.md"));
      const measured = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: "utf8" });
      expect(measured.status).toBe(1);
      expect(measured.stderr).toContain("require TEST_DATABASE_URL");
      const tableOnly = spawnSync(process.execPath, [script, "--check-only"], { cwd: directory, env, encoding: "utf8" });
      expect(tableOnly.status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

describe.runIf(hasDatabase)("seeded dataset measurements", { timeout: 180_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("does not repeat or omit contacts whose import timestamps tie", async () => {
    const ids = Array.from({ length: 60 }, (_, i) =>
      `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await db().insert(contacts).values(ids.map((id, i) => ({
      id, name: `Imported ${i}`, email: `imported-${i}@example.test`,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })));
    const seen = [];
    for (const offset of [0, 25, 50]) {
      const page = await listContacts.call({ limit: 25, offset }, OWNER);
      expect(page.total).toBe(60);
      seen.push(...page.rows.map((row) => row.id));
    }
    expect(seen).toEqual([...ids].reverse());
  });

  it("measures the requested dataset with verified fixture counts", { timeout: MEASURE_TIMEOUT }, async () => {
    const dataset = datasetFromEnv();
    const flags = measurementFlags();
    if (
      (flags.measureBrowser || flags.measureEditor) &&
      process.env.PERF_HAS_PLAYWRIGHT !== "1"
    ) {
      throw new Error(
        "PERF_MEASURE_BROWSER/PERF_MEASURE_EDITOR without Playwright is fail-closed.",
      );
    }

    if (dataset === "large") {
      const seed = await seedPerformanceDataset("large");
      const page = await listContacts.call({ limit: 25, offset: 0 }, OWNER);
      expect(page.rows).toHaveLength(25);
      expect(page.total).toBe(DATASET_SIZES.large.contacts);
      const second = await listContacts.call({ limit: 25, offset: 25 }, OWNER);
      const last = await listContacts.call({ limit: 25, offset: DATASET_SIZES.large.contacts - 25 }, OWNER);
      expect(second.rows).toHaveLength(25);
      expect(last.rows).toHaveLength(25);
      expect(new Set([...page.rows, ...second.rows, ...last.rows].map((row) => row.id)).size).toBe(75);
      const verdict = evaluateMeasurements({
        dataset: "large",
        ...flags,
        bounded: { paginated: page.rows.length === 25 && page.total === DATASET_SIZES.large.contacts },
      });
      expect(verdict.failures).toEqual([]);
      expect(seed.slug).toBe("perf-home");
      return;
    }

    const size = dataset === "medium" ? "medium" : "small";
    const seed = await seedPerformanceDataset(size);
    const report = await revenueReport.call({ days: 90, timezone: "UTC" }, OWNER);
    expect(report.totals).toEqual([{ currency: "CAD", amountMinor: DATASET_SIZES[size].orders * 2500 }]);
    expect(report.months.reduce((sum, row) => sum + row.invoices, 0)).toBe(DATASET_SIZES[size].orders);
    const measurements = await measureServerSurfaces(seed);
    const detail: Record<string, unknown> = {};
    if (flags.measureJobs) {
      const queue = await measureQueueLatency();
      expect(queue.samples).toHaveLength(20);
      expect(queue.completed).toBe(20);
      measurements.push(queue);
    }

    // Browser, editor and cold-boot clocks need the production build; the
    // harness refuses to run them against anything else, and the shared
    // standalone server is started once for both browser-side families.
    const browserSide = flags.measureBrowser || flags.measureEditor;
    let server: RunningServer | undefined;
    let sessionToken: string | undefined;
    if (browserSide) {
      const capable = browserPrerequisites({
        hasPlaywrightMarker: process.env.PERF_HAS_PLAYWRIGHT === "1",
        standaloneServerJs: resolve(".next/standalone/server.js"),
        databaseUrl: process.env.DATABASE_URL,
      });
      if (!capable.ok) {
        throw new Error(`Browser/editor measurement requested but cannot run: ${capable.reason}.`);
      }
      const port = Number(process.env.PERF_BROWSER_PORT ?? 3100);
      await assertPortFree("127.0.0.1", port);
      server = await startPerfBrowserServer({
        host: "127.0.0.1",
        port,
        databaseUrl: process.env.DATABASE_URL!,
        env: process.env,
      });
      sessionToken = await ensureOwnerSessionToken();
    }
    try {
      if (flags.measureBrowser) {
        const measured = await measureBrowserSurfaces({
          baseUrl: server!.baseUrl,
          sessionToken: sessionToken!,
          slug: seed.slug,
          contactId: seed.contactId,
          samples: Number(process.env.PERF_BROWSER_SAMPLES ?? 7),
        });
        detail.browser = measured.detail;
        // Whole-page HTTP timing supersedes the service/component clocks for
        // the surfaces it honestly covers.
        const bySurface = new Map(measurements.map((row) => [row.surface, row]));
        for (const row of measured.rows) bySurface.set(row.surface, row);
        measurements.splice(0, measurements.length, ...bySurface.values());
      }
      if (flags.measureEditor) {
        const editor = await measureEditorClocks({
          baseUrl: server!.baseUrl,
          sessionToken: sessionToken!,
          pageId: seed.pageId,
          pageTitle: "Performance home",
          headingFieldId: "perf-home-heading-text",
          paintSamples: Number(process.env.PERF_EDITOR_SAMPLES ?? 7),
          keystrokeSamples: Number(process.env.PERF_KEYSTROKE_SAMPLES ?? 5),
        });
        detail.editor = editor.detail;
        measurements.push(...editor.rows);
      }
    } finally {
      await server?.stop();
    }

    if (flags.measureMigration) {
      const migration = await measureMigrationClock();
      detail.migration = migration;
      measurements.push(migration);
    }
    if (flags.measureBoot) {
      const capable = bootPrerequisites({
        buildId: resolve(".next/BUILD_ID"),
        databaseUrl: process.env.DATABASE_URL,
      });
      if (!capable.ok) {
        throw new Error(`Cold-boot measurement requested but cannot run: ${capable.reason}.`);
      }
      const boot = await measureColdBoot({
        boots: Number(process.env.PERF_BOOT_SAMPLES ?? 3),
        databaseUrl: process.env.DATABASE_URL!,
        env: process.env,
      });
      detail.boot = boot;
      measurements.push(boot);
    }

    console.info(JSON.stringify({ dataset: size, counts: DATASET_SIZES[size], measurements, detail }));
    const verdict = evaluateMeasurements({
      dataset: size,
      ...flags,
      budgets,
      measurements,
    });
    expect(verdict.failures, verdict.failures.join("\n")).toEqual([]);
  });
});
