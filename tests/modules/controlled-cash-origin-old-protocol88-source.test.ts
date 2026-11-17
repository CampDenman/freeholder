// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33/C1.08: genuine old-source identity and forward-test reversibility.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import publicBoundary from "../../deploy/controlled-safe-public-boundary88.source.json";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";

const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const edit = z.object({ before: z.string(), after: z.string() }).strict();
const successor = z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), edits: z.array(edit) }).strict();
const continuation = z.object({
 copyright: z.string(), protocol: z.literal("controlled_cash_origin_old_protocol_harness88.v1"), checklist: z.array(z.string()), status: z.string(), productBehaviorChanged: z.literal(false),
 preUpgrade: z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/), testPath: z.string(), testSha256: z.string(), runtimePath: z.string(), runtimeSha256: z.string(), adapterPath: z.string(), adapterSha256: z.string(),
  migrations: z.literal(86), lastMigration: z.literal("0085_controlled_collection_application"), lastMigrationWhen: z.literal(1793310000065), caseName: z.string(), timeoutMs: z.literal(180000),
 }).strict(),
 successor, masterSuccessor: z.object({ path: z.literal("MASTER.md"), beforeSha256: z.string(), afterSha256: z.string(), exactAppend: z.string() }).strict(), newFiles: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()),
}).passthrough().parse(JSON.parse(read("deploy/controlled-cash-origin-old-protocol88.source.json")));

describe("controlled cash-origin genuine old-protocol source continuation", () => {
 it("loads the actual pinned pre-upgrade test, adapter, runtime and migration boundary", () => {
  const old = continuation.preUpgrade;
  for (const [path, expected] of [[old.testPath, old.testSha256], [old.runtimePath, old.runtimeSha256], [old.adapterPath, old.adapterSha256]] as const) {
   const source = execFileSync("git", ["show", `${old.commit}:${path}`], { encoding: "utf8" });
   expect(sha(source)).toBe(expected);
  }
  const test = execFileSync("git", ["show", `${old.commit}:${old.testPath}`], { encoding: "utf8" });
  expect(test).toContain(`it(${JSON.stringify(old.caseName)},async()=>{`);
  expect(test).toContain('amountMinor:"scripted malformed provider counter"');
  expect(test).toContain("expect(current.unfinished).toEqual([])");
  expect(test).toContain('toMatchObject({verified:true,rawCashReview:true})');
  expect(test).toContain("timeout:180000");
  const journal = z.object({ entries: z.array(z.object({ when: z.number(), tag: z.string() })) }).parse(JSON.parse(execFileSync("git", ["show", `${old.commit}:db/migrations/meta/_journal.json`], { encoding: "utf8" })));
  expect(journal.entries).toHaveLength(old.migrations); expect(journal.entries.at(-1)).toMatchObject({ tag: old.lastMigration, when: old.lastMigrationWhen });
 });

 it("reverses only the two forward test edits to the exact integrated-newer predecessor", () => {
  const exact = continuation.successor; let source = read(exact.path);
  expect(sha(source)).toBe(exact.afterSha256);
  for (const delta of [...exact.edits].reverse()) {
   expect(source.split(delta.after)).toHaveLength(2); source = source.replace(delta.after, () => delta.before);
  }
  expect(sha(source)).toBe(exact.beforeSha256);
 });

 it("reverses only the new status paragraph to the exact current-integration MASTER", () => {
  const exact = continuation.masterSuccessor; let source = restoreRowHashLedgerSource(exact.path, read(exact.path));
  const latest = publicBoundary.files.find(row => row.path === exact.path); if (!latest) throw new Error("Require the newest MASTER source continuation.");
  expect(sha(source)).toBe(latest.afterSha256);
  for (const delta of [...latest.edits].reverse()) { expect(source.split(delta.after)).toHaveLength(2); source = source.replace(delta.after, () => delta.before); }
  expect(sha(source)).toBe(latest.beforeSha256);
  expect(sha(source)).toBe(exact.afterSha256); expect(source.split(exact.exactAppend)).toHaveLength(2);
  expect(sha(source.replace(exact.exactAppend, ""))).toBe(exact.beforeSha256);
 });

 it("uses a real old child, fresh preserved database and original bound without retention mocks or writer changes", () => {
  const exact = continuation.newFiles.find(row => row.path === "tests/helpers/controlled-cash-origin-old-protocol88.ts");
  expect(exact).toBeDefined(); if (!exact) throw new Error("Require the old-protocol harness successor.");
  const source = read(exact.path); expect(sha(source)).toBe(exact.sha256);
  for (const required of ['spawnSync("git", ["archive", "--format=tar"', '"node_modules/vitest/vitest.mjs", "run"', 'CREATE DATABASE', "TEST_DATABASE_URL: target.toString()", "databasePreserved: true", "timeout: 180000"]) expect(source).toContain(required);
  expect(source).not.toMatch(/DROP\s+DATABASE|TRUNCATE\s+TABLE|vi\.|mockImplementation|controlledSafeOwnedSnapshot|assertControlledSafeSnapshot|freeholder_controlled_safe_response_ready/);
  expect(continuation.productBehaviorChanged).toBe(false);
 });
});
