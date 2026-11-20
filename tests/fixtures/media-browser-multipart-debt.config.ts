// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const output = process.env.FREEHOLDER_MEDIA_BROWSER_MULTIPART_OUTPUT;
const url = new URL(process.env.TEST_DATABASE_URL ?? "invalid");
if (!output?.startsWith("/tmp/") || !output.endsWith(".json")) throw new Error("Use an explicit temporary UUID-only multipart manifest.");
// The caller hands this fixture the browser suite's OWN database --
// `TEST_DATABASE_URL: process.env.DATABASE_URL` at the spawn site -- and
// playwright.a11y.config.ts already states the contract for it: the name must
// contain "test" or "a11y", and "CI may use DATABASE_URL". The guard here also
// demanded 127.0.0.1:55448 with no password, which is one developer's
// disposable cluster: nothing in this repository starts a PostgreSQL on 55448,
// so in CI this fixture could never start and every locale of its spec failed
// before reaching the behaviour under test. The property that matters is kept
// -- never a database whose name does not announce itself as disposable.
if (url.search || !/(?:test|a11y)/i.test(url.pathname.replace(/^\//, ""))) throw new Error("Use the browser suite's disposable test or a11y database.");
process.env.DATABASE_URL = url.href;
process.env.FREEHOLDER_SKIP_MIGRATE = "1";
process.env.FREEHOLDER_JOBS = "off";
process.env.SESSION_SECRET ??= "vitest-deterministic-session-secret-key-32+";
process.env.CREDENTIAL_KEY ??= "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("../../src", import.meta.url)),
    "@freeholder/plugin-kit": fileURLToPath(new URL("../../packages/plugin-kit/src/index.ts", import.meta.url)),
    "@freeholder/templates": fileURLToPath(new URL("../../packages/templates/src/presets.ts", import.meta.url)),
  } },
  test: { include: ["tests/fixtures/media-browser-multipart-debt.probe.ts"], globalSetup: [], environment: "node", fileParallelism: false, testTimeout: 120000, hookTimeout: 120000 },
});
