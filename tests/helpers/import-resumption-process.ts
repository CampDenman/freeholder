// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
export async function runImportResumptionProcess(id: string, uploadId: string) {
  const database = process.env.DATABASE_URL;
  if (!database || !/test/i.test(new URL(database).pathname)) throw new Error("A fresh import worker requires the qualification's explicit disposable database.");
  const directory = await mkdtemp(join(tmpdir(), "freeholder-import-process-")), output = join(directory, "result.json");
  try {
    await execute(process.execPath, ["tests/fixtures/run-import-resumption-probe.mjs"], {
      cwd: process.cwd(), timeout: 60_000, maxBuffer: 1_048_576,
      env: {
        PATH: process.env.PATH, NODE_ENV: "test", TEST_DATABASE_URL: database,
        SESSION_SECRET: "vitest-deterministic-session-secret-key-32+",
        CREDENTIAL_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        FREEHOLDER_STORAGE: "local", LOCAL_STORAGE_ROOT: process.env.LOCAL_STORAGE_ROOT ?? resolve(".data/media"),
        FREEHOLDER_JOBS: "off", FREEHOLDER_IMPORT_PROBE_RUN_ID: id, FREEHOLDER_IMPORT_PROBE_UPLOAD_ID: uploadId, FREEHOLDER_IMPORT_PROBE_OUTPUT: output,
      },
    });
    return z.object({ pid: z.number().int().positive(), result: z.object({ id: z.uuid(), status: z.string(), error: z.string().nullable(), counts: z.record(z.string(), z.number()) }) }).parse(JSON.parse(await readFile(output, "utf8")));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
