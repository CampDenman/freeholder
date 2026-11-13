// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Explicit no-reset harness; only the new deterministic nonce-named probe runs.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const source = process.env.TEST_DATABASE_URL;
if (!source) throw new Error("Declare the explicit disposable switch-probe harness URL.");
const target = new URL(source);
if (target.hostname !== "127.0.0.1" || target.port !== "55447" || !/^\/freeholder_switch_harness79_[a-f0-9]{12}$/.test(target.pathname)) throw new Error("Use a new named local switch-probe harness, never an existing proof database.");
process.env.DATABASE_URL = source;
const sessionSecret = "vitest-switch-probe-session-secret-only-32+";
const credentialKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.SESSION_SECRET = sessionSecret; process.env.CREDENTIAL_KEY = credentialKey;
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)),
    "@freeholder/plugin-kit": fileURLToPath(new URL("../../packages/plugin-kit/src/index.ts", import.meta.url)),
    "@freeholder/templates": fileURLToPath(new URL("../../packages/templates/src/presets.ts", import.meta.url)) } },
  test: { include: ["tests/core/playground.test.ts"], environment: "node", fileParallelism: false, globalSetup: [],
    testNamePattern: /keeps the requested database through an actual producer poll during close/,
    testTimeout: 60000, hookTimeout: 60000,
    env: { DATABASE_URL: source, SESSION_SECRET: sessionSecret, CREDENTIAL_KEY: credentialKey } },
});
