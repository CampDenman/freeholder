// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Opt-in old-producer fixture: no ambient environment or automatic migration.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const kind = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_KIND;
if (!["unknown_unwritten", "retired_written", "unrecoverable_retired_written"].includes(kind ?? "")) throw new Error("Choose one explicit old-producer control.");
const stage = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_STAGE;
if (stage !== "old" && stage !== "current") throw new Error("Choose the explicit old-producer or current-capture stage.");
const url = new URL(process.env.TEST_DATABASE_URL ?? "invalid");
const output = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_OUTPUT;
const schemaRoot = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_SCHEMA_ROOT;
const input = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_INPUT;
if (stage === "old" && (!schemaRoot?.startsWith("/tmp/") || !schemaRoot.endsWith("/db/migrations"))) throw new Error("Select the exact current 0..81 schema prefix source.");
if (stage === "current" && (!input?.startsWith("/tmp/") || !input.endsWith(".json"))) throw new Error("Read the old producer's UUID-only manifest from an explicit temporary JSON file.");
if (url.hostname !== "127.0.0.1" || url.port !== "55448" || url.username !== "postgres" || url.password || url.search || !/^\/media_legacy_anchor_(?:unknown|retired|unrecoverable)_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Use a new explicitly named disposable old-producer database.");
if (!output?.startsWith("/tmp/") || !output.endsWith(".json")) throw new Error("Write the UUID-only producer manifest to an explicit temporary JSON file.");
if (process.env.CI) throw new Error("This preserved old-producer fixture is not an ordinary CI test.");
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
  test: { include: [stage === "old" ? "tests/fixtures/media-legacy-upload-anchor.probe.ts" : "tests/fixtures/media-legacy-upload-anchor-current.probe.ts"], globalSetup: [], environment: "node", fileParallelism: false, testTimeout: 120000, hookTimeout: 120000 },
});
