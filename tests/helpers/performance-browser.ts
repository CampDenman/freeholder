// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: whole-page browser clocks (Core Web Vitals + HTTP timing) and the
// editor's two §15.1 clocks, measured against the production standalone build
// with real Chromium. No web-vitals dependency: the harness injects the same
// PerformanceObserver data the library would read, and reports nothing it did
// observe. A missing observer signal is a failure, never a skip.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { db } from "@/core/db";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { users, totpFactors } from "@/core/auth/schema";
import { businessProfile } from "@/core/settings/schema";
import { OWNER } from "./spine";
import { percentile } from "./performance";

export interface MeasurementRow {
  surface: string;
  value: number;
}

export interface BrowserSample {
  /** Largest Contentful Paint, ms from navigation start. */
  lcp: number | null;
  /** Cumulative Layout Shift (unitless). */
  cls: number;
  /** Longest interaction latency observed this load, ms. */
  inp: number | null;
  /** Document time to first byte — server render through HTTP, ms. */
  ttfb: number;
  /** Full page load, ms. */
  load: number;
}

export interface BrowserMeasurement extends MeasurementRow {
  samples: BrowserSample[];
}

const SETTLE_MS = 300;
const NAVIGATION_TIMEOUT_MS = 45_000;

/**
 * Injected into every document before page scripts run. Collects exactly the
 * PerformanceObserver signals the §15.1 rows name; reads them back with
 * `window.__fhVitals()`.
 */
export const VITALS_INIT_SCRIPT = `(() => {
  if (window.self !== window.top) return;
  const vitals = { lcp: [], cls: 0, events: [], fcp: null, ttfb: null, load: null };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) vitals.lcp.push(entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) vitals.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId) {
          vitals.events.push({ id: entry.interactionId, duration: entry.duration });
        }
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") vitals.fcp = entry.startTime;
      }
    }).observe({ type: "paint", buffered: true });
    const [nav] = performance.getEntriesByType("navigation");
    if (nav) {
      vitals.ttfb = nav.responseStart;
      const finish = () => { vitals.load = nav.loadEventEnd; };
      if (nav.loadEventEnd > 0) finish();
      else addEventListener("load", () => setTimeout(finish, 0), { once: true });
    }
  } catch {
    // Observers unavailable: the sample readback fails closed instead.
  }
  window.__fhVitals = vitals;
})();`;

type RawVitals = {
  lcp: number[];
  cls: number;
  events: Array<{ id: number; duration: number }>;
  fcp: number | null;
  ttfb: number | null;
  load: number | null;
};

/** Fail-closed capability check, kept pure so the contract tests can drive it. */
export function browserPrerequisites(input: {
  hasPlaywrightMarker: boolean;
  standaloneServerJs: string;
  databaseUrl: string | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.hasPlaywrightMarker) {
    return { ok: false, reason: "PERF_HAS_PLAYWRIGHT=1 was not set" };
  }
  if (!existsSync(input.standaloneServerJs)) {
    return {
      ok: false,
      reason: `production standalone build is missing (${input.standaloneServerJs}); run pnpm build before requesting browser clocks`,
    };
  }
  if (!input.databaseUrl) {
    return { ok: false, reason: "no DATABASE_URL for the standalone server" };
  }
  return { ok: true };
}

export async function assertPortFree(host: string, port: number): Promise<void> {
  await new Promise<void>((promiseResolve, promiseReject) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      promiseReject(
        new Error(
          `Port ${port} is already in use; the browser measurement server needs it free (set PERF_BROWSER_PORT to use another).`,
        ),
      );
    });
    socket.once("error", () => {
      socket.destroy();
      promiseResolve();
    });
  });
}

export async function waitForHttpOk(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = "no response yet";
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error(`Timed out waiting for ${url}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}: ${String(lastError)}`);
}

export interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Start the production standalone build the way the browser gate does
 * (scripts/start-browser-server.mjs copies static assets and migrations into
 * .next/standalone and imports the traced server), pointed at the already
 * migrated measurement database. The process group is killed on stop so a
 * failed measurement never leaks a server on the port.
 */
export async function startPerfBrowserServer(input: {
  host: string;
  port: number;
  databaseUrl: string;
  env?: NodeJS.ProcessEnv;
}): Promise<RunningServer> {
  const baseUrl = `http://${input.host}:${input.port}`;
  const child = spawn("node", ["scripts/start-browser-server.mjs"], {
    cwd: resolve("."),
    detached: true,
    env: {
      ...input.env,
      BROWSER_BASE_URL: baseUrl,
      DATABASE_URL: input.databaseUrl,
      APP_URL: baseUrl,
      FREEHOLDER_JOBS: "off",
      FREEHOLDER_SKIP_MIGRATE: "1",
      FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1",
      LOCAL_STORAGE_ROOT: "test-results/perf-media",
      PORT: String(input.port),
      HOSTNAME: input.host,
    } as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 20_000) output = output.slice(-20_000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 20_000) output = output.slice(-20_000);
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const exited = await new Promise<boolean>((r) => {
      const timer = setTimeout(() => r(false), 15_000);
      child.once("exit", () => {
        clearTimeout(timer);
        r(true);
      });
    });
    if (!exited) {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      await new Promise((r) => child.once("exit", r));
    }
  };
  try {
    await waitForHttpOk(`${baseUrl}/api/health/live`, 120_000);
  } catch (error) {
    await stop().catch(() => undefined);
    throw new Error(
      `The standalone measurement server did not become healthy: ${error instanceof Error ? error.message : String(error)}\n${output}`,
    );
  }
  return { baseUrl, stop };
}

/**
 * Insert the owner rows the admin surfaces authenticate against (only if the
 * current fixture lacks them) and mint a real database session. Mirrors
 * tests/browser/owner-session.ts without truncating the seeded fixture.
 */
export async function ensureOwnerSessionToken(): Promise<string> {
  await db()
    .insert(users)
    .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
    .onConflictDoNothing();
  await db()
    .insert(totpFactors)
    .values({ userId: OWNER.userId, encryptedSecret: "perf-browser-fixture" })
    .onConflictDoNothing();
  await db()
    .insert(businessProfile)
    .values({
      name: "Perf Studio",
      country: "CA",
      baseCurrency: "CAD",
      timezone: "America/Vancouver",
      defaultLocale: "en",
      enabledLocales: ["en"],
      setupCompletedAt: new Date(),
    })
    .onConflictDoNothing();
  const session = await db().transaction((tx) =>
    createSession(tx, OWNER.userId, { twoFactorVerified: true }),
  );
  return session.token;
}

function summarizeSample(vitals: RawVitals, requireInteraction: boolean): BrowserSample {
  if (vitals.ttfb === null || !Number.isFinite(vitals.ttfb)) {
    throw new Error("Browser sample has no navigation timing entry; refusing to invent a render time.");
  }
  const lcp = vitals.lcp.length > 0 ? vitals.lcp[vitals.lcp.length - 1]! : null;
  if (lcp === null || !Number.isFinite(lcp)) {
    throw new Error("Browser sample produced no LCP entry; refusing to pass a missing clock.");
  }
  const interaction = vitals.events.reduce<number | null>(
    (worst, event) =>
      worst === null ? event.duration : Math.max(worst, event.duration),
    null,
  );
  if (requireInteraction && interaction === null) {
    throw new Error(
      "INP sample observed no interaction timing entries despite a real input; refusing to pass a missing clock.",
    );
  }
  return {
    lcp,
    cls: Number.isFinite(vitals.cls) ? vitals.cls : NaN,
    inp: interaction,
    ttfb: vitals.ttfb,
    load: vitals.load ?? NaN,
  };
}

/**
 * Turn per-load samples into the §15.1 surfaces. p75 for the Web Vitals, p95
 * for server render, matching the budget table. Fail-closed on empty samples
 * or non-finite values — the same discipline as the service clocks.
 */
export function summarizeBrowserSamples(input: {
  samples: BrowserSample[];
  requireInteraction: boolean;
}): {
  lcpP75: number;
  /** p75 interaction latency, or null when the surface was not interacted with. */
  inpP75: number | null;
  clsP75: number;
  serverRenderP95: number;
} {
  const { samples, requireInteraction } = input;
  if (samples.length === 0) throw new Error("No browser samples were collected.");
  const finite = (value: number | null, name: string) => {
    if (value === null || !Number.isFinite(value) || value < 0) {
      throw new Error(`Browser ${name} sample is missing or invalid; refusing to pass it.`);
    }
    return value;
  };
  const lcp = percentile(samples.map((s) => finite(s.lcp, "LCP")), 75);
  const cls = percentile(samples.map((s) => finite(s.cls, "CLS")), 75);
  const ttfb = percentile(samples.map((s) => finite(s.ttfb, "server render")), 95);
  const inpSamples = samples.map((s) => s.inp);
  if (requireInteraction && inpSamples.some((value) => value === null)) {
    throw new Error("At least one load produced no INP interaction sample.");
  }
  const inp = requireInteraction
    ? percentile(
        inpSamples.map((value) => finite(value, "INP")),
        75,
      )
    : null;
  return { lcpP75: lcp, inpP75: inp, clsP75: cls, serverRenderP95: ttfb };
}

async function samplePageLoad(input: {
  context: BrowserContext;
  url: string;
  interact: boolean;
}): Promise<BrowserSample> {
  const page = await input.context.newPage();
  try {
    await page.goto(input.url, {
      waitUntil: "load",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(SETTLE_MS);
    if (input.interact) {
      // Real input through CDP, the same event pipeline a user drives. The
      // click target is the page heading: present on every measured surface
      // and never a navigation control.
      const heading = page.locator("h1").first();
      await heading.waitFor({ state: "visible", timeout: 15_000 });
      await heading.click({ position: { x: 2, y: 2 } });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(SETTLE_MS);
    }
    const vitals = await page.evaluate(() => (window as unknown as { __fhVitals?: RawVitals }).__fhVitals);
    if (!vitals) throw new Error("The vitals collector never installed; the sample is void.");
    return summarizeSample(vitals, input.interact);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Whole-page clocks for the public storefront page, one admin list and one
 * admin detail, against the production build on the seeded dataset.
 *
 * Sample strategy: one discarded warm-up load per surface (it pays first-hit
 * compile, connection and font-cache costs that steady-state loads do not),
 * then ${samples} measured loads in the same browser context. LCP/CLS/INP are
 * read per load from PerformanceObserver; server render is the document's
 * time-to-first-byte. The first measured load of each surface follows the
 * warm-up, so JIT and module-graph costs stay out of the reported numbers.
 */
export async function measureBrowserSurfaces(input: {
  baseUrl: string;
  sessionToken: string;
  slug: string;
  contactId: string;
  samples: number;
}): Promise<{
  rows: MeasurementRow[];
  detail: Record<string, BrowserMeasurement>;
}> {
  if (!Number.isInteger(input.samples) || input.samples < 3) {
    throw new Error("Browser measurement needs at least 3 samples after the warm-up discard.");
  }
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(VITALS_INIT_SCRIPT);
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: input.sessionToken,
        url: input.baseUrl,
      },
    ]);
    // Warm the server graph before any timed load.
    await samplePageLoad({
      context,
      url: `${input.baseUrl}/${input.slug}`,
      interact: false,
    });

    const publicSamples: BrowserSample[] = [];
    for (let i = 0; i < input.samples; i += 1) {
      publicSamples.push(
        await samplePageLoad({
          context,
          url: `${input.baseUrl}/${input.slug}`,
          interact: true,
        }),
      );
    }
    const publicSummary = summarizeBrowserSamples({
      samples: publicSamples,
      requireInteraction: true,
    });
    if (publicSummary.inpP75 === null) {
      throw new Error("Public page INP is required but was not measured.");
    }
    const inpP75 = publicSummary.inpP75;

    const adminListSamples: BrowserSample[] = [];
    for (let i = 0; i < input.samples; i += 1) {
      adminListSamples.push(
        await samplePageLoad({
          context,
          url: `${input.baseUrl}/admin/contacts`,
          interact: false,
        }),
      );
    }
    const adminList = summarizeBrowserSamples({
      samples: adminListSamples,
      requireInteraction: false,
    });

    const adminDetailSamples: BrowserSample[] = [];
    for (let i = 0; i < input.samples; i += 1) {
      adminDetailSamples.push(
        await samplePageLoad({
          context,
          url: `${input.baseUrl}/admin/contacts/${input.contactId}`,
          interact: false,
        }),
      );
    }
    const adminDetail = summarizeBrowserSamples({
      samples: adminDetailSamples,
      requireInteraction: false,
    });

    const detail: Record<string, BrowserMeasurement> = {
      "Public page, LCP": {
        surface: "Public page, LCP",
        value: publicSummary.lcpP75,
        samples: publicSamples,
      },
      "Public page, INP": {
        surface: "Public page, INP",
        value: inpP75,
        samples: publicSamples,
      },
      "Public page, CLS": {
        surface: "Public page, CLS",
        value: publicSummary.clsP75,
        samples: publicSamples,
      },
      "Public page, server render": {
        surface: "Public page, server render",
        value: publicSummary.serverRenderP95,
        samples: publicSamples,
      },
      "Admin list (any)": {
        surface: "Admin list (any)",
        value: adminList.serverRenderP95,
        samples: adminListSamples,
      },
      "Admin detail": {
        surface: "Admin detail",
        value: adminDetail.serverRenderP95,
        samples: adminDetailSamples,
      },
    };
    return {
      rows: [
        { surface: "Public page, LCP", value: publicSummary.lcpP75 },
        { surface: "Public page, INP", value: inpP75 },
        { surface: "Public page, CLS", value: publicSummary.clsP75 },
        { surface: "Public page, server render", value: publicSummary.serverRenderP95 },
        { surface: "Admin list (any)", value: adminList.serverRenderP95 },
        { surface: "Admin detail", value: adminDetail.serverRenderP95 },
      ],
      detail,
    };
  } finally {
    await browser.close();
  }
}

export interface EditorMeasurement extends MeasurementRow {
  samples: number[];
}

/**
 * The editor's two clocks on /admin/pages/{pageId}:
 *
 * - First paint: FCP of the editing-surface navigation, p95, one discarded
 *   warm-up navigation first.
 * - Keystroke → preview: a real keypress in the heading field, then the
 *   preview frame is polled (mutation observation through the same-origin
 *   iframe document) until the stored text renders. The current editor
 *   debounces autosave by 1.2s and renders only stored state, so an honest
 *   sample includes that debounce; the harness reports what it observes.
 */
export async function measureEditorClocks(input: {
  baseUrl: string;
  sessionToken: string;
  pageId: string;
  /** Title of the seeded fixture page — the editing surface's h1. */
  pageTitle: string;
  /** Block id of the seeded heading block + its text prop, forming the field id. */
  headingFieldId: string;
  paintSamples: number;
  keystrokeSamples: number;
}): Promise<{ rows: MeasurementRow[]; detail: Record<string, EditorMeasurement> }> {
  if (!Number.isInteger(input.paintSamples) || input.paintSamples < 3) {
    throw new Error("Editor first paint needs at least 3 samples after warm-up.");
  }
  if (!Number.isInteger(input.keystrokeSamples) || input.keystrokeSamples < 1) {
    throw new Error("Editor keystroke measurement needs at least 1 sample.");
  }
  const editorUrl = `${input.baseUrl}/admin/pages/${input.pageId}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(VITALS_INIT_SCRIPT);
    await context.addCookies([
      { name: SESSION_COOKIE, value: input.sessionToken, url: input.baseUrl },
    ]);

    const readFcp = async (): Promise<number> => {
      const page = await context.newPage();
      try {
        await page.goto(editorUrl, {
          waitUntil: "load",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        // The editing surface, not just any pixel: the fixture page title,
        // the block palette, and the preview frame must all be there.
        await page
          .getByRole("heading", { level: 1, name: input.pageTitle })
          .waitFor();
        await page.getByRole("button", { name: "Add a block" }).first().waitFor();
        await page.getByTitle("Preview").waitFor();
        const vitals = await page.evaluate(
          () => (window as unknown as { __fhVitals?: RawVitals }).__fhVitals,
        );
        if (!vitals || vitals.fcp === null || !Number.isFinite(vitals.fcp)) {
          throw new Error("Editor navigation produced no first-contentful-paint entry.");
        }
        return vitals.fcp;
      } finally {
        await page.close().catch(() => undefined);
      }
    };

    await readFcp(); // warm-up navigation, discarded
    const paint: number[] = [];
    for (let i = 0; i < input.paintSamples; i += 1) paint.push(await readFcp());
    const firstPaintP95 = percentile(paint, 95);

    // Keystroke → preview, measured on a fresh editor page.
    const page = await context.newPage();
    try {
      await page.goto(editorUrl, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
      const field = page.locator(`#${input.headingFieldId}`);
      await field.waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTitle("Preview").waitFor();
      const keystrokes: number[] = [];
      for (let i = 0; i < input.keystrokeSamples; i += 1) {
        const token = `perf${i}`;
        await field.click();
        const started = await page.evaluate(() => performance.now());
        await page.keyboard.type(` ${token}`, { delay: 15 });
        const deadline = Date.now() + 30_000;
        let painted: number | null = null;
        while (Date.now() < deadline) {
          const done = await page
            .waitForFunction(
              (wanted) => {
                const frame = document.querySelector('iframe[title="Preview"]');
                const doc = frame instanceof HTMLIFrameElement ? frame.contentDocument : null;
                try {
                  return doc !== null && doc.body.innerText.includes(wanted);
                } catch {
                  return false; // frame mid-reload
                }
              },
              token,
              { polling: 100, timeout: 1_000 },
            )
            .then(() => true)
            .catch(() => false);
          if (done) {
            painted = await page.evaluate(() => performance.now());
            break;
          }
        }
        if (painted === null || !Number.isFinite(painted)) {
          throw new Error(
            `Keystroke sample ${i} never reached the preview frame within 30 seconds.`,
          );
        }
        const latency = painted - started;
        if (!Number.isFinite(latency) || latency < 0) {
          throw new Error(`Keystroke sample ${i} produced an invalid latency.`);
        }
        keystrokes.push(latency);
      }
      const keystrokeP95 = percentile(keystrokes, 95);
      const detail: Record<string, EditorMeasurement> = {
        "Editor first paint": {
          surface: "Editor first paint",
          value: firstPaintP95,
          samples: paint,
        },
        "Editor keystroke → preview": {
          surface: "Editor keystroke → preview",
          value: keystrokeP95,
          samples: keystrokes,
        },
      };
      return {
        rows: [
          { surface: "Editor first paint", value: firstPaintP95 },
          { surface: "Editor keystroke → preview", value: keystrokeP95 },
        ],
        detail,
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
}
