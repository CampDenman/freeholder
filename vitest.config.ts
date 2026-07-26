// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Test wiring (MASTER.md §15.1). Two rules make this suite safe to run
// anywhere:
//
//  1. Tests never touch the development database. TEST_DATABASE_URL becomes
//     DATABASE_URL for the run. A bare DATABASE_URL is honoured only under CI,
//     where the database is disposable — locally, its absence makes DB-backed
//     tests skip rather than truncate somebody's real data.
//  2. Session hashing needs a secret and CI has none, so the run supplies a
//     deterministic one. It exists only here; env.ts still demands a real
//     secret of anything that isn't a test.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The same file the app reads. Variables already in the environment win, so an
// exported CI value is never clobbered by a developer's .env.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env — normal in CI.
  }
}

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
} else {
  // Deleting is the point: with no test database declared, nothing in the
  // suite should be able to open a connection to whatever DATABASE_URL held.
  delete process.env.DATABASE_URL;
  console.warn(
    "[vitest] No TEST_DATABASE_URL set — database-backed tests will skip.\n" +
      "         Add one to .env (a throwaway database) to run them.",
  );
}

const sessionSecret =
  process.env.SESSION_SECRET ?? "vitest-deterministic-session-secret-key-32+";
process.env.SESSION_SECRET = sessionSecret;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // One sacred database (§2 principle 12) means one database for the suite
    // too: files that truncate spine tables must not run beside each other.
    fileParallelism: false,
    globalSetup: ["./tests/setup/migrate.ts"],
    env: {
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
      SESSION_SECRET: sessionSecret,
    },
  },
});
