// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Opt-in preserved-history probes: no .env load, migration, reset or seed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const control = process.env.FREEHOLDER_BUYER_HISTORY_CONTROL;
if (control !== "legacy_customer" && control !== "missing_repair") throw new Error("Choose one explicit buyer history control.");
const url = new URL(process.env.TEST_DATABASE_URL ?? "invalid");
const kind = control === "legacy_customer" ? "localmode" : "missing";
if (url.hostname !== "127.0.0.1" || url.port !== "55447" || url.username !== "postgres" || url.password || url.search
  || !new RegExp(`^/freeholder_buyer_${kind}80_review_(before|after)_v10_test_20261112$`).test(url.pathname)) {
  throw new Error("Buyer history probes require a NEW explicitly named disposable review clone.");
}
if (process.env.CI) throw new Error("Preserved local history probes are never ordinary CI tests.");
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
  test: { include: ["tests/fixtures/buyer-erasure-history.probe.ts"], globalSetup: [], environment: "node", fileParallelism: false,
    testTimeout: 60000, hookTimeout: 30000 },
});
