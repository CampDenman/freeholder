// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: contract and plumbing tests for the browser, editor, migration and
// cold-boot measurement families. The real-browser clocks run in the flagged
// perf run and in the existing browser jobs; here the fail-closed edges and
// the measurement plumbing are proven without a production build.
import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  measurementFlags,
  parsePerformanceBudgets,
  evaluateMeasurements,
  requiredSurfaces,
  runHeader,
} from "../../scripts/performance-budgets.mjs";
import {
  assertPortFree,
  browserPrerequisites,
  summarizeBrowserSamples,
  waitForHttpOk,
  type BrowserSample,
} from "../helpers/performance-browser";
import {
  expectedMigrationCount,
  timeMigrationChain,
  measureMigrationClock,
} from "../helpers/performance-migration";
import { bootPrerequisites, findFreePort, measureColdBoot } from "../helpers/performance-boot";
import { hasDatabase } from "../helpers/spine";

const master = readFileSync("MASTER.md", "utf8");
const budgets = parsePerformanceBudgets(master);

describe("measurement family flags", () => {
  const FLAGS_OFF = {
    measureBrowser: false,
    measureEditor: false,
    measureJobs: false,
    measureMigration: false,
    measureBoot: false,
  };

  it("parses the editor flag separately from the browser flag", () => {
    const none = measurementFlags({
      PERF_MEASURE_BROWSER: "0",
      PERF_MEASURE_EDITOR: "0",
    } as unknown as NodeJS.ProcessEnv);
    expect(none).toEqual(FLAGS_OFF);
    const editor = measurementFlags({ PERF_MEASURE_EDITOR: "1" } as unknown as NodeJS.ProcessEnv);
    expect(editor.measureEditor).toBe(true);
    expect(editor.measureBrowser).toBe(false);
    const browser = measurementFlags({ PERF_MEASURE_BROWSER: "1" } as unknown as NodeJS.ProcessEnv);
    expect(browser.measureEditor).toBe(false);
  });

  it("routes editor surfaces to the editor flag, browser surfaces to the browser flag", () => {
    const browserOnly = requiredSurfaces({ ...FLAGS_OFF, measureBrowser: true });
    expect(browserOnly.has("Public page, LCP")).toBe(true);
    expect(browserOnly.has("Editor first paint")).toBe(false);
    const editorOnly = requiredSurfaces({ ...FLAGS_OFF, measureEditor: true });
    expect(editorOnly.has("Editor first paint")).toBe(true);
    expect(editorOnly.has("Editor keystroke → preview")).toBe(true);
    expect(editorOnly.has("Public page, LCP")).toBe(false);
  });

  it("prints the acceptance-contract header with commit, host, command and families", () => {
    const header = runHeader({
      PERF_DATASET: "medium",
      PERF_MEASURE_BROWSER: "1",
      PERF_MEASURE_MIGRATION: "1",
    } as unknown as NodeJS.ProcessEnv);
    expect(header).toContain("commit:");
    expect(header).toContain("host:");
    expect(header).toContain("PERF_DATASET=medium");
    expect(header).toContain("PERF_MEASURE_BROWSER=1");
    expect(header).toContain("PERF_MEASURE_MIGRATION=1");
    expect(header).toContain("pnpm perf:budgets");
    expect(header).toContain("browser Core Web Vitals");
    expect(header).toContain("migration chain apply");
    expect(header).not.toContain("cold boot");
  });

  it("fails closed for each requested family that cannot run", () => {
    for (const [requested, reason] of [
      ["browser vitals", "Playwright not available"],
      ["editor clocks", "Playwright not available"],
      ["migration clock", "no CREATEDB privilege"],
      ["cold boot", "no production build"],
    ] as const) {
      const verdict = evaluateMeasurements({
        dataset: "small",
        requested,
        capable: false,
        incapableReason: reason,
        budgets,
        measurements: [],
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.failures[0]).toContain(requested);
    }
  });
});

describe("browser family plumbing", () => {
  it("refuses to run without the playwright marker, the standalone build, or a database", () => {
    const directory = mkdtempSync(join(tmpdir(), "freeholder-perf-browser-prereq-"));
    try {
      const noMarker = browserPrerequisites({
        hasPlaywrightMarker: false,
        standaloneServerJs: join(directory, "server.js"),
        databaseUrl: "postgres://example",
      });
      expect(noMarker.ok).toBe(false);
      if (!noMarker.ok) expect(noMarker.reason).toContain("PERF_HAS_PLAYWRIGHT");

      const noBuild = browserPrerequisites({
        hasPlaywrightMarker: true,
        standaloneServerJs: join(directory, "server.js"),
        databaseUrl: "postgres://example",
      });
      expect(noBuild.ok).toBe(false);
      if (!noBuild.ok) expect(noBuild.reason).toContain("pnpm build");

      writeFileSync(join(directory, "server.js"), "// stub");
      const noDatabase = browserPrerequisites({
        hasPlaywrightMarker: true,
        standaloneServerJs: join(directory, "server.js"),
        databaseUrl: undefined,
      });
      expect(noDatabase.ok).toBe(false);

      const ready = browserPrerequisites({
        hasPlaywrightMarker: true,
        standaloneServerJs: join(directory, "server.js"),
        databaseUrl: "postgres://example",
      });
      expect(ready.ok).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails when the browser port is occupied", async () => {
    const blocker: NetServer = createNetServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(assertPortFree("127.0.0.1", port)).rejects.toThrow(/already in use/);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
    const free = await findFreePort("127.0.0.1");
    expect(free).toBeGreaterThanOrEqual(3101);
    await assertPortFree("127.0.0.1", free); // must not throw
  });

  const sample = (over: Partial<BrowserSample>): BrowserSample => ({
    lcp: 100,
    cls: 0.01,
    inp: 40,
    ttfb: 80,
    load: 300,
    ...over,
  });

  it("reduces samples to the §15.1 percentiles", () => {
    const samples = [
      sample({ lcp: 100, cls: 0.01, inp: 40, ttfb: 80 }),
      sample({ lcp: 200, cls: 0.05, inp: 80, ttfb: 90 }),
      sample({ lcp: 300, cls: 0.09, inp: 120, ttfb: 100 }),
      sample({ lcp: 400, cls: 0.02, inp: 60, ttfb: 85 }),
    ];
    const summary = summarizeBrowserSamples({ samples, requireInteraction: true });
    expect(summary.lcpP75).toBe(300); // nearest-rank p75 of 4 → 3rd sorted value
    expect(summary.inpP75).toBe(80); // sorted durations: 40, 60, 80, 120
    expect(summary.clsP75).toBe(0.05);
    expect(summary.serverRenderP95).toBe(100); // nearest-rank p95 of 4 → 4th
  });

  it("rejects missing LCP, missing INP interactions, and invalid clocks", () => {
    expect(() =>
      summarizeBrowserSamples({ samples: [sample({ lcp: null })], requireInteraction: false }),
    ).toThrow(/LCP/);
    expect(() =>
      summarizeBrowserSamples({ samples: [sample({ inp: null })], requireInteraction: true }),
    ).toThrow(/INP/);
    expect(() =>
      summarizeBrowserSamples({ samples: [sample({ cls: NaN })], requireInteraction: false }),
    ).toThrow(/invalid/);
    expect(() => summarizeBrowserSamples({ samples: [], requireInteraction: false })).toThrow(
      /No browser samples/,
    );
  });

  it("does not demand INP for surfaces that were not interacted with", () => {
    const summary = summarizeBrowserSamples({
      samples: [sample({ inp: null }), sample({ inp: null, ttfb: 120 })],
      requireInteraction: false,
    });
    expect(summary.inpP75).toBeNull();
    expect(summary.serverRenderP95).toBe(120); // nearest-rank p95 of 2 → 2nd value
    expect(summary.lcpP75).toBe(100);
  });

  it("waits for a real HTTP 200 and times out fail-closed", async () => {
    const server: Server = createServer((request, response) => {
      if (request.url === "/ok") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      } else {
        response.writeHead(503);
        response.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      await waitForHttpOk(`http://127.0.0.1:${port}/ok`, 5_000);
      await expect(
        waitForHttpOk(`http://127.0.0.1:${port}/missing`, 400),
      ).rejects.toThrow(/Timed out/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("migration family plumbing", () => {
  it("counts the collapsed chain from the migrations folder", () => {
    expect(expectedMigrationCount(resolve("db/migrations"))).toBeGreaterThanOrEqual(13);
  });

  it("refuses to measure without a disposable database URL", async () => {
    await expect(
      measureMigrationClock({} as NodeJS.ProcessEnv),
    ).rejects.toThrow(/TEST_DATABASE_URL/);
  });

  it.runIf(hasDatabase)("applies the full chain to a fresh database with a verified journal", async () => {
    const source = process.env.DATABASE_URL;
    expect(source).toBeTruthy();
    const adminUrl = new URL(source!);
    adminUrl.pathname = "/postgres";
    const database = `freeholder_perf_migrplumb_${Date.now().toString(36)}`;
    const target = new URL(source!);
    target.pathname = `/${database}`;
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    await admin.end();
    try {
      const { ms, applied } = await timeMigrationChain({
        databaseUrl: target.toString(),
        migrationsFolder: resolve("db/migrations"),
      });
      expect(applied).toBe(expectedMigrationCount(resolve("db/migrations")));
      expect(ms).toBeGreaterThan(0);
      expect(Number.isFinite(ms)).toBe(true);
    } finally {
      const drop = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
      await drop
        .unsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
        )
        .catch(() => undefined);
      await drop.unsafe(`DROP DATABASE "${database}"`).catch(() => undefined);
      await drop.end().catch(() => undefined);
    }
  }, 60_000);
});

describe("cold-boot family plumbing", () => {
  it("refuses to run without the production build or a database", () => {
    const noBuild = bootPrerequisites({
      buildId: "/nonexistent/.next/BUILD_ID",
      databaseUrl: "postgres://example",
    });
    expect(noBuild.ok).toBe(false);
    if (!noBuild.ok) expect(noBuild.reason).toContain("pnpm build");
    const noDb = bootPrerequisites({
      buildId: "/nonexistent/.next/BUILD_ID",
      databaseUrl: undefined,
    });
    expect(noDb.ok).toBe(false);
  });

  it("rejects fewer than three boots before spawning anything", async () => {
    await expect(
      measureColdBoot({ boots: 2, databaseUrl: "postgres://example" }),
    ).rejects.toThrow(/at least 3 boots/);
  });
});
