// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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

// The key that encrypts connected accounts (§41). Deterministic and obviously
// fake, for the same reason the session secret above is: the suite has to be
// able to encrypt something, and a developer's real key must never be what it
// reaches for. 32 bytes as hex.
const credentialKey =
  process.env.CREDENTIAL_KEY ??
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.CREDENTIAL_KEY = credentialKey;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@freeholder/plugin-kit": fileURLToPath(
        new URL("./packages/plugin-kit/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // One sacred database (§2 principle 12) means one database for the suite
    // too: files that truncate spine tables must not run beside each other.
    fileParallelism: false,
    // Truncate now covers every installed module. The Vitest defaults (5s
    // tests, 10s hooks) lose the race once catalog/invoicing/cms tables join
    // the spine, and the next test then sees leftover unique emails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: ["./tests/setup/migrate.ts"],
    env: {
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
      SESSION_SECRET: sessionSecret,
      CREDENTIAL_KEY: credentialKey,
    },
  },
});
