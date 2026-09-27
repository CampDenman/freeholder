// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: real-browser proof for the hardened public playground — a visitor
// edits content, a privileged API call is refused as that visitor, and the
// hourly reset (truncate + reseed, mirroring deploy/docker-selfhost/playground/
// reset.sh's recreate) signs the visitor out and restores the sample data.
//
// This suite boots the production standalone build with FREEHOLDER_PLAYGROUND=1
// on its own disposable database, separate from the accessibility/journey
// suites: those prove the product; this one proves the disposable instance.
import { defineConfig } from "@playwright/test";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env — normal in CI.
  }
}

const databaseUrl =
  process.env.PLAYGROUND_DATABASE_URL ??
  process.env.BROWSER_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);

if (!databaseUrl) {
  throw new Error(
    "The playground browser suite needs PLAYGROUND_DATABASE_URL, " +
      "BROWSER_DATABASE_URL or TEST_DATABASE_URL pointing at a disposable database.",
  );
}

let databaseName: string;
try {
  databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
} catch {
  throw new Error("The playground test database URL is not a valid URL.");
}
if (!/(?:playground|test|a11y)/i.test(databaseName)) {
  throw new Error(
    `Refusing to truncate database "${databaseName}": its name must contain "playground", "test" or "a11y".`,
  );
}

const baseURL =
  process.env.PLAYGROUND_BASE_URL ??
  process.env.BROWSER_BASE_URL ??
  "http://localhost:3100";

Object.assign(process.env, {
  APP_URL: baseURL,
  DATABASE_URL: databaseUrl,
  FREEHOLDER_PLAYGROUND: "1",
  FREEHOLDER_SEED_DEMO: "1",
  FREEHOLDER_JOBS: "off",
  // Playwright's global setup owns this disposable database migration. The
  // server starts before global setup, so allowing both paths to migrate would
  // manufacture a schema race that no browser behaviour depends on.
  FREEHOLDER_SKIP_MIGRATE: "1",
  FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1",
  LOCAL_STORAGE_ROOT: "test-results/playground-media",
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? "playground-browser-session-secret-32+",
  CREDENTIAL_KEY:
    process.env.CREDENTIAL_KEY ??
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
});

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "playground.spec.ts",
  tsconfig: "./tsconfig.json",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  globalSetup: "./tests/setup/migrate.ts",
  outputDir: "test-results/playground",
  use: {
    baseURL,
    browserName: "chromium",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-browser-server.mjs",
    url: `${baseURL}/api/health/live`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
