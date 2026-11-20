// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Opt-in genuine current service/TCP quota producer; no ambient environment.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const stage = process.env.FREEHOLDER_MEDIA_TRANSFER_QUOTA_ROLE_STAGE;
if (!["ack_before_fin", "verified_copy", "adopted_copy", "retired_source", "privacy_queued", "unknown_target", "not_attempted_target", "late_original"].includes(stage ?? "")) throw new Error("Choose one explicit quota-producer control.");
const url = new URL(process.env.TEST_DATABASE_URL ?? "invalid");
const output = process.env.FREEHOLDER_MEDIA_TRANSFER_QUOTA_ROLE_OUTPUT;
const tcpState = process.env.FREEHOLDER_MEDIA_TRANSFER_QUOTA_ROLE_TCP_STATE;
if (tcpState && (!tcpState.startsWith("/tmp/") || !tcpState.endsWith(".json"))) throw new Error("Use an explicit temporary synthetic TCP state file.");
if (url.hostname !== "127.0.0.1" || url.port !== "55448" || url.username !== "postgres" || url.password || url.search || !/^\/media_quota_role_(?:ack|verified|adopted|retired|privacy|unknown|unattempted|late)_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Use a new explicitly named disposable quota-producer database.");
if (!output?.startsWith("/tmp/") || !output.endsWith(".json")) throw new Error("Write the UUID-only quota manifest to an explicit temporary JSON file.");
if (process.env.CI) throw new Error("This preserved service/TCP producer is not an ordinary CI test.");
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
  test: { include: ["tests/fixtures/media-transfer-quota-role.probe.ts"], globalSetup: [], environment: "node", fileParallelism: false, testTimeout: 120000, hookTimeout: 120000 },
});
