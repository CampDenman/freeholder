// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";
const url=new URL(process.env.TEST_DATABASE_URL??"invalid");
if(url.hostname!=="127.0.0.1"||url.port!=="55448"||url.username!=="postgres"||url.password||url.search||!/^\/[a-z0-9_]*a11y[a-z0-9_]*$/.test(url.pathname))throw new Error("Use the browser suite's explicitly named disposable a11y database.");
process.env.DATABASE_URL=url.href;
process.env.FREEHOLDER_SKIP_MIGRATE="1";
process.env.FREEHOLDER_JOBS="off";
process.env.SESSION_SECRET??="vitest-deterministic-session-secret-key-32+";
process.env.CREDENTIAL_KEY??="00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
export default defineConfig({
 resolve:{alias:{
  "@":fileURLToPath(new URL("../../src",import.meta.url)),
  "@freeholder/plugin-kit":fileURLToPath(new URL("../../packages/plugin-kit/src/index.ts",import.meta.url)),
  "@freeholder/templates":fileURLToPath(new URL("../../packages/templates/src/presets.ts",import.meta.url)),
 }},
 test:{include:["tests/fixtures/return-refund-browser.probe.ts"],globalSetup:[],environment:"node",fileParallelism:false,testTimeout:120000,hookTimeout:120000},
});
