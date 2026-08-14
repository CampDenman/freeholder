// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real-browser accessibility and product-journey gates for MASTER.md §43
// C1.21-C1.22.
//
// This suite truncates its database. Locally it only accepts an explicitly
// named BROWSER_DATABASE_URL, A11Y_DATABASE_URL or TEST_DATABASE_URL whose
// database name makes its
// disposable purpose obvious. CI may use DATABASE_URL, but the same name
// check still applies. A development database can therefore never be reached
// by accidentally running a browser gate.
import { defineConfig } from "@playwright/test";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env is normal in CI.
  }
}

const databaseUrl =
  process.env.BROWSER_DATABASE_URL ??
  process.env.A11Y_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);

if (!databaseUrl) {
  throw new Error(
    "The browser suite needs BROWSER_DATABASE_URL, A11Y_DATABASE_URL or " +
      "TEST_DATABASE_URL pointing at a disposable database.",
  );
}

let databaseName: string;
try {
  databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
} catch {
  throw new Error("The accessibility test database URL is not a valid URL.");
}
if (!/(?:test|a11y)/i.test(databaseName)) {
  throw new Error(
    `Refusing to truncate database "${databaseName}": its name must contain "test" or "a11y".`,
  );
}

const baseURL =
  process.env.BROWSER_BASE_URL ??
  process.env.A11Y_BASE_URL ??
  "http://localhost:3100";
const sessionSecret =
  process.env.SESSION_SECRET ?? "a11y-deterministic-session-secret-key-32+";
const credentialKey =
  process.env.CREDENTIAL_KEY ??
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

Object.assign(process.env, {
  APP_URL: baseURL,
  CREDENTIAL_KEY: credentialKey,
  DATABASE_URL: databaseUrl,
  FREEHOLDER_JOBS: "off",
  FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1",
  LOCAL_STORAGE_ROOT: "test-results/browser-media",
  SESSION_SECRET: sessionSecret,
});

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  tsconfig: "./tsconfig.json",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report/browser" }]]
    : "line",
  globalSetup: "./tests/setup/migrate.ts",
  outputDir: "test-results/browser",
  use: {
    baseURL,
    browserName: "chromium",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    colorScheme: "light",
    locale: "en-CA",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-browser-server.mjs",
    url: `${baseURL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
