// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33/C1.08: execute the actual pre-safe adapter/runtime and test.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { z } from "zod";

export const CONTROLLED_CASH_ORIGIN_PRE_UPGRADE = Object.freeze({
 commit: "426009a1983711c81cef0447862120c682598515",
 testPath: "tests/modules/controlled-cash-origin-batch84.test.ts",
 testSha256: "074dc686ca5adba367044792bbc93737a3b31e47a0d1019083d1145f2e2317d2",
 runtimePath: "src/modules/subscriptions/controlled-provider-runtime.ts",
 runtimeSha256: "8a691af37824ff20bb41c43f058d762351a7b4810c11167e9d7f9c83e71b22a7",
 adapterPath: "src/adapters/payments/stripe.ts",
 adapterSha256: "c6ebf95682f9b8bb4ec37be49358df9b47c496ae329e396a73f486c64b4df6d4",
 migrations: 86,
 lastMigration: "0085_controlled_collection_application",
 caseName: "retains a scripted malformed late cash callback through the real holder and keeps its raw review flag",
});

const resultDocument = z.object({
 numTotalTests: z.number().int(),
 numPassedTests: z.number().int(),
 numFailedTests: z.number().int(),
 testResults: z.array(z.object({
  assertionResults: z.array(z.object({ title: z.string(), status: z.string() })),
 })),
});
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export async function runControlledCashOriginPreUpgradeMalformed() {
 const databaseUrl = process.env.DATABASE_URL;
 if (!databaseUrl) throw new Error("The old-protocol native requires an explicitly declared disposable PostgreSQL server.");
 const name = `fh_origin_old_test_${randomUUID().replaceAll("-", "")}`;
 const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
 try { await admin.unsafe(`CREATE DATABASE "${name}"`); }
 finally { await admin.end(); }
 const target = new URL(databaseUrl); target.pathname = `/${name}`;

 const workspace = mkdtempSync(join(tmpdir(), "freeholder-origin-old-protocol88-"));
 const source = join(workspace, "source"); mkdirSync(source);
 const archived = spawnSync("git", ["archive", "--format=tar", CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.commit], {
  cwd: process.cwd(), maxBuffer: 256 * 1024 * 1024,
 });
 if (archived.error || archived.status !== 0) throw new Error(`Unable to archive the pinned pre-upgrade source: ${archived.error?.message ?? archived.stderr.toString()}`);
 const extracted = spawnSync("tar", ["-xf", "-", "-C", source], { input: archived.stdout, maxBuffer: 16 * 1024 * 1024 });
 if (extracted.error || extracted.status !== 0) throw new Error(`Unable to unpack the pinned pre-upgrade source: ${extracted.error?.message ?? extracted.stderr.toString()}`);
 symlinkSync(join(process.cwd(), "node_modules"), join(source, "node_modules"), process.platform === "win32" ? "junction" : "dir");

 for (const [path, expected] of [
  [CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.testPath, CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.testSha256],
  [CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.runtimePath, CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.runtimeSha256],
  [CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.adapterPath, CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.adapterSha256],
 ] as const) {
  const actual = sha(readFileSync(join(source, path), "utf8"));
  if (actual !== expected) throw new Error(`The pinned pre-upgrade source does not match its preserved hash: ${path}`);
 }
 const journal = z.object({ entries: z.array(z.object({ tag: z.string() })) }).parse(JSON.parse(readFileSync(join(source, "db/migrations/meta/_journal.json"), "utf8")));
 if (journal.entries.length !== CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.migrations || journal.entries.at(-1)?.tag !== CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.lastMigration) {
  throw new Error("The actual pre-upgrade migration prefix must end at 0085.");
 }

 const output = join(workspace, "result.json"), stdout = join(workspace, "stdout.log"), stderr = join(workspace, "stderr.log");
 const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", TEST_DATABASE_URL: target.toString(), DATABASE_URL: target.toString() };
 delete env.FREEHOLDER_JOBS; delete env.NEXT_PHASE;
 const child = spawnSync(process.execPath, [
  "node_modules/vitest/vitest.mjs", "run", CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.testPath,
  "--testNamePattern", CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.caseName,
  "--bail=1", "--retry=0", "--maxWorkers=1", "--reporter=default", "--reporter=json", `--outputFile=${output}`,
 ], { cwd: source, env, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
 writeFileSync(stdout, child.stdout ?? ""); writeFileSync(stderr, child.stderr ?? "");
 if (child.error) throw new Error(`The actual pre-upgrade case did not complete within its original 180-second bound: ${child.error.message}; database ${name}; logs ${workspace}`);
 if (child.status !== 0) throw new Error(`The actual pre-upgrade case failed with status ${child.status}; database ${name}; logs ${workspace}; ${(child.stderr || child.stdout).slice(-4000)}`);
 const result = resultDocument.parse(JSON.parse(readFileSync(output, "utf8")));
 const assertions = result.testResults.flatMap(row => row.assertionResults), selected = assertions.filter(row => row.title === CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.caseName);
 if (result.numTotalTests !== 5 || result.numPassedTests !== 1 || result.numFailedTests !== 0 || selected.length !== 1 || selected[0]?.status !== "passed") {
  throw new Error(`The old-protocol run did not pass exactly the original malformed case; database ${name}; result ${output}`);
 }
 const evidence = {
  protocol: "controlled_cash_origin_old_protocol_harness88.v1",
  sourceCommit: CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.commit,
  database: name,
  databasePreserved: true,
  migrations: CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.migrations,
  lastMigration: CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.lastMigration,
  caseName: CONTROLLED_CASH_ORIGIN_PRE_UPGRADE.caseName,
  passed: result.numPassedTests,
  failed: result.numFailedTests,
  timeoutMs: 180000,
  workspace,
 };
 writeFileSync(join(workspace, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
 return evidence;
}
