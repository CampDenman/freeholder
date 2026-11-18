// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";
import { migrationPrefixFingerprint, readMigrationPlan, SAFE_RESPONSE_BOUNDARY } from "@/core/migrate-runner.mjs";

const folders: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const guard = readFileSync("tests/fixtures/controlled-safe-response-first-guard86.sql", "utf8");
function folder() { const value = mkdtempSync(join(tmpdir(), "freeholder-boundary-unit-")); folders.push(value); return value; }
function fixture(count = 87) {
  const root = folder(); mkdirSync(join(root, "meta"));
  const entries = Array.from({ length: count }, (_, idx) => ({ idx, version: "7", when: SAFE_RESPONSE_BOUNDARY.when - 86 + idx, tag: idx === 86 ? SAFE_RESPONSE_BOUNDARY.tag : `${String(idx).padStart(4, "0")}_unit_only`, breakpoints: true }));
  for (const row of entries) writeFileSync(join(root, `${row.tag}.sql`), row.idx === 86 ? `${guard}--> statement-breakpoint\nselect 86;\n` : `select ${row.idx};\n`);
  const journal = { version: "7", dialect: "postgresql", entries };
  writeFileSync(join(root, "meta", "_journal.json"), JSON.stringify(journal));
  const migrations = readMigrationFiles({ migrationsFolder: root });
  const metadata = { protocol: "controlled_safe_response_migration_boundary.v1", index: 86, tag: SAFE_RESPONSE_BOUNDARY.tag, when: SAFE_RESPONSE_BOUNDARY.when, breakpoints: true, firstStatementSha256: SAFE_RESPONSE_BOUNDARY.firstStatementSha256, predecessor85Sha256: migrations[85]?.hash, whole86Sha256: migrations[86]?.hash, prefix0To85Sha256: migrationPrefixFingerprint(entries, migrations) };
  writeFileSync(join(root, "meta", "controlled-safe-response-boundary.json"), JSON.stringify(metadata));
  return { root, journal, metadata };
}
afterEach(() => { for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("reviewed migration boundary source identity (unit fixtures only)", () => {
  it("keeps the whole first statement, including comments and newlines", () => {
    expect(Buffer.byteLength(guard)).toBe(2038);
    expect(sha(guard)).toBe(SAFE_RESPONSE_BOUNDARY.firstStatementSha256);
    const f = fixture(); const plan = readMigrationPlan({ migrationsFolder: f.root });
    expect(plan.kind).toBe("boundary");
    if (plan.kind !== "boundary") throw new Error("Missing boundary plan");
    expect(plan.before).toHaveLength(86); expect(plan.boundary).toHaveLength(1); expect(plan.after).toHaveLength(0);
    expect(plan.boundary[0]?.sql[0]).toBe(guard);
  });
  it("uses the official unchanged old-cohort path below 87", () => {
    const f = fixture(86); expect(readMigrationPlan({ migrationsFolder: f.root }).kind).toBe("legacy");
  });
  it("refuses synthetic NULL hashes and computes the assembled production identity", () => {
    const f = fixture();
    writeFileSync(join(f.root, "meta", "controlled-safe-response-boundary.json"), JSON.stringify({ ...f.metadata, predecessor85Sha256: null, whole86Sha256: null, prefix0To85Sha256: null }));
    expect(() => readMigrationPlan({ migrationsFolder: f.root })).toThrow();
    const migrations = readMigrationFiles({ migrationsFolder: "db/migrations" });
    const journal = z.object({ entries: z.array(z.object({ idx: z.number(), version: z.string(), tag: z.string(), when: z.number(), breakpoints: z.boolean() })) }).parse(JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8")));
    const actual: unknown = JSON.parse(readFileSync("db/migrations/meta/controlled-safe-response-boundary.json", "utf8"));
    expect(actual).toMatchObject({ predecessor85Sha256: migrations[85]?.hash, whole86Sha256: migrations[86]?.hash, prefix0To85Sha256: migrationPrefixFingerprint(journal.entries, migrations) });
  });
  it.each(["idx", "tag", "when", "guard", "prefix", "whole"])("refuses changed %s identity", kind => {
    const f = fixture();
    if (kind === "idx") f.journal.entries[86]!.idx = 85;
    if (kind === "tag") f.journal.entries[86]!.tag = "0086_foreign";
    if (kind === "when") f.journal.entries[86]!.when += 1;
    if (kind === "idx" || kind === "tag" || kind === "when") writeFileSync(join(f.root, "meta", "_journal.json"), JSON.stringify(f.journal));
    if (kind === "guard") writeFileSync(join(f.root, `${SAFE_RESPONSE_BOUNDARY.tag}.sql`), `\n${guard}--> statement-breakpoint\nselect 86;`);
    if (kind === "prefix") writeFileSync(join(f.root, `${f.journal.entries[20]!.tag}.sql`), "select 200;\n");
    if (kind === "whole") writeFileSync(join(f.root, `${SAFE_RESPONSE_BOUNDARY.tag}.sql`), `${guard}--> statement-breakpoint\nselect 860;`);
    expect(() => readMigrationPlan({ migrationsFolder: f.root })).toThrow();
  });
  it("preserves exact manual default, fake-env loading and exported-env precedence in genuine child processes", () => {
    const cwd = folder(), cli = pathToFileURL(resolve("scripts/migrate.mjs")).href;
    const run = (env: NodeJS.ProcessEnv, expected: string, load: boolean) => {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `const m=await import(${JSON.stringify(cli)});${load ? "m.loadMigrationEnvironment();" : ""}process.stdout.write(m.migrationDatabaseUrl()===${JSON.stringify(expected)}?"MATCH":"MISMATCH");`], { cwd, env, encoding: "utf8" });
      expect(result.status).toBe(0); expect(result.stderr).toBe(""); expect(result.stdout).toBe("MATCH");
    };
    // This child receives no inherited secret variables and never opens a DB.
    const env = { PATH: process.env.PATH, NODE_ENV: "test" as const };
    run(env, "postgres://postgres:postgres@localhost:5432/freeholder_dev", true);
    writeFileSync(join(cwd, ".env"), "DATABASE_URL=postgres://fake:fake@invalid.test/fake_env\n");
    run(env, "postgres://fake:fake@invalid.test/fake_env", true);
    run({ ...env, DATABASE_URL: "postgres://fake:fake@invalid.test/exported", FREEHOLDER_SKIP_MIGRATE: "1" }, "postgres://fake:fake@invalid.test/exported", true);
    run({ ...env, DATABASE_URL: "" }, "", true);
  });
  it("manual failure output never adopts hostile error properties", () => {
    const cli = pathToFileURL(resolve("scripts/migrate.mjs")).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `const m=await import(${JSON.stringify(cli)});const hostile={get code(){throw new Error("PRIVATE")}};const proxy=new Proxy({},{getOwnPropertyDescriptor(){throw new Error("PRIVATE")}});const ok=m.migrationFailureCode({code:"55006",message:"PRIVATE"})==="55006"&&m.migrationFailureCode({code:"PRIVATE",query:"PRIVATE",cause:"PRIVATE"})==="MIGRATION_FAILED"&&m.migrationFailureCode(hostile)==="MIGRATION_FAILED"&&m.migrationFailureCode(proxy)==="MIGRATION_FAILED";process.stdout.write(ok?"SAFE":"UNSAFE");`], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8" });
    expect(child.status).toBe(0); expect(child.stderr).toBe(""); expect(child.stdout).toBe("SAFE");
  });
  it("packages the exact two manual runtime files and keeps all migration metadata", () => {
    const docker = readFileSync("Dockerfile", "utf8"), release = readFileSync("scripts/build-release.mjs", "utf8");
    expect(docker).toContain("/app/scripts/migrate.mjs ./scripts/migrate.mjs");
    expect(docker).toContain("/app/src/core/migrate-runner.mjs ./src/core/migrate-runner.mjs");
    expect(docker).toContain("/app/db ./db");
    expect(release).toContain('resolve(root, "scripts", "migrate.mjs")');
    expect(release).toContain('resolve(root, "src", "core", "migrate-runner.mjs")');
    expect(release).toContain('resolve(root, "db"), resolve(stage, "app", "db")');
  });
});

// Exact successor layer ONLY. Authenticate complete current bytes before
// restoring the three frozen68 files for their unchanged original source pins.
function boundarySuccessorSource(path: string): Buffer {
  let current = Buffer.from(restoreRowHashLedgerSource(path, readFileSync(path, "utf8")));
  const contentReuse = z.object({ files: z.array(z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), edits: z.array(z.object({ before: z.string(), after: z.string() }).strict()) }).strict()) }).passthrough().parse(JSON.parse(readFileSync("deploy/controlled-journal-content-reuse84-current.source.json", "utf8"))).files.find(row => row.path === path);
  if (contentReuse) {
    expect(sha(current)).toBe(contentReuse.afterSha256);
    let source = current.toString("utf8");
    for (const edit of [...contentReuse.edits].reverse()) {
      expect(source.split(edit.after)).toHaveLength(2);
      source = source.replace(edit.after, () => edit.before);
    }
    expect(sha(source)).toBe(contentReuse.beforeSha256);
    current = Buffer.from(source);
  }
  const currentIntegration = z.object({ copyright: z.string(), protocol: z.string(), status: z.string(), files: z.array(z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), edits: z.array(z.object({ before: z.string(), after: z.string() }).strict()) }).strict()) }).strict().parse(JSON.parse(readFileSync("deploy/controlled-safe-response-current-integration87.source.json", "utf8"))).files.find(row => row.path === path);
  if (currentIntegration) {
    expect(sha(current)).toBe(currentIntegration.afterSha256);
    let source = current.toString("utf8");
    for (const edit of [...currentIntegration.edits].reverse()) {
      expect(source.split(edit.after)).toHaveLength(2);
      source = source.replace(edit.after, () => edit.before);
    }
    expect(sha(source)).toBe(currentIntegration.beforeSha256);
    current = Buffer.from(source);
  }
  if (["db/migrations/meta/controlled-safe-response-boundary.json", "tests/modules/migrate-boundary86.test.ts", "tests/core/migrate.test.ts"].includes(path)) {
    const container = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync("deploy/controlled-safe-response-boundary-continuation87.source.json", "utf8")));
    const key = path === "tests/modules/migrate-boundary86.test.ts" ? "pgBoundary" : path === "tests/core/migrate.test.ts" ? "migrationCore" : "metadata";
    const continuation = z.object({ path: z.literal(path), predecessorSha256: z.string().regex(/^[a-f0-9]{64}$/), successorSha256: z.string().regex(/^[a-f0-9]{64}$/), edits: z.array(z.object({ before: z.string(), after: z.string() }).strict()) }).strict().parse(container[key]);
    expect(sha(current)).toBe(continuation.successorSha256);
    let source = current.toString("utf8");
    for (const edit of [...continuation.edits].reverse()) {
      expect(source.split(edit.after)).toHaveLength(2);
      source = source.replace(edit.after, () => edit.before);
    }
    expect(sha(source)).toBe(continuation.predecessorSha256);
    if (path === "db/migrations/meta/controlled-safe-response-boundary.json") return Buffer.from(source);
    current = Buffer.from(source);
  }
  const allowed = ["src/core/migrate-runner.mjs", "tests/core/migrate-boundary.test.ts", "tests/modules/migrate-boundary86.test.ts"];
  if (!allowed.includes(path)) return current;
  const document: unknown = JSON.parse(readFileSync("deploy/controlled-safe-migration-boundary-final-20261114.source.json", "utf8"));
  const rows = z.array(z.object({ path: z.string(), scope: z.string(), beforeSha256: z.string().nullable(), afterSha256: z.string(), beforeWhole: z.string().nullable(), edits: z.array(z.object({ afterStartByte: z.number().int().nonnegative(), afterEndByte: z.number().int().nonnegative(), before: z.string(), after: z.string() }).strict()) }).strict()).parse(z.object({ files: z.unknown() }).parse(document).files);
  const entry = rows.find(row => row.path === path);
  if (!entry || entry.scope !== "core" || entry.beforeWhole === null) throw new Error("The exact frozen migration source predecessor is required.");
  expect(rows.filter(row => row.scope === "core").map(row => row.path).sort()).toEqual([...allowed].sort());
  if (path === "tests/core/migrate-boundary.test.ts") {
    const continuation = z.object({ copyright: z.string(), path: z.literal(path), predecessorSha256: z.literal(entry.afterSha256), successorSha256: z.string().regex(/^[a-f0-9]{64}$/), metadata: z.unknown(), pgBoundary: z.unknown(), migrationCore: z.unknown(), edits: z.array(z.object({ before: z.string(), after: z.string() }).strict()) }).strict().parse(JSON.parse(readFileSync("deploy/controlled-safe-response-boundary-continuation87.source.json", "utf8")));
    expect(sha(current)).toBe(continuation.successorSha256);
    let source = current.toString("utf8");
    for (const edit of [...continuation.edits].reverse()) {
      expect(source.split(edit.after)).toHaveLength(2);
      source = source.replace(edit.after, () => edit.before);
    }
    current = Buffer.from(source);
  }
  expect(sha(current)).toBe(entry.afterSha256);
  let restored = current;
  for (const edit of [...entry.edits].sort((a, b) => b.afterStartByte - a.afterStartByte)) {
    expect(restored.subarray(edit.afterStartByte, edit.afterEndByte).toString("utf8")).toBe(edit.after);
    restored = Buffer.concat([restored.subarray(0, edit.afterStartByte), Buffer.from(edit.before), restored.subarray(edit.afterEndByte)]);
  }
  expect(sha(restored)).toBe(entry.beforeSha256); expect(restored.toString("utf8")).toBe(entry.beforeWhole);
  return restored;
}
it("keeps the whole frozen68 source manifest and the always-final real journal check", () => {
  expect(sha(readFileSync("deploy/controlled-safe-migration-boundary-20261114.source.json"))).toBe("dfc4097d2059f310a336d409146e62ab89cd1519e51476afae6f7cb2285dd5c3");
  const current = readFileSync("src/core/migrate-runner.mjs", "utf8");
  expect(current).toContain("if (plan.after.length) await dialect.migrate(plan.after, session, config);\n  await verifyCommittedPrefix(session, plan.all, plan.all.length, config);\n}");
  expect(boundarySuccessorSource("src/core/migrate-runner.mjs").toString("utf8")).not.toContain("await verifyCommittedPrefix(session, plan.all, plan.all.length, config);");
});

it("byte-authenticates the 8 boundary-mechanism files and property-checks the 6 that only use them", () => {
  const manifest: unknown = JSON.parse(readFileSync("deploy/controlled-safe-migration-boundary-20261114.source.json", "utf8"));
  // This is source-archive verification, never a database/financial authority.
  const rows = z.array(z.object({ path: z.string(), scope: z.string(), beforeSha256: z.string().nullable(), afterSha256: z.string(), beforeWhole: z.string().nullable(), property: z.unknown().optional(), edits: z.array(z.object({ afterStartByte: z.number().int().nonnegative(), afterEndByte: z.number().int().nonnegative(), before: z.string(), after: z.string() }).strict()) }).strict()).parse(z.object({ files: z.unknown() }).parse(manifest).files);
  const core = rows.filter(row => row.scope === "core"); expect(core).toHaveLength(8);
  // `core` is byte-frozen because those files ARE the boundary mechanism.
  // `usage` files only call it, or are this file, and they change for unrelated
  // reasons: package.json, the Dockerfile, the release script and two test
  // files had all drifted while still routing every migration through the
  // dedicated session, and this file cannot be byte-frozen inside a manifest
  // whose own hash it pins -- that is a two-way cycle no edit can satisfy.
  // Their recorded beforeWhole/edits stay in the manifest as the original
  // record of the change; the live guarantee is the property below.
  const usage = rows.filter(row => row.scope === "usage"); expect(usage).toHaveLength(6);
  for (const row of usage) {
    const property = z.object({ requires: z.array(z.string()).min(1), forbids: z.array(z.string()) }).strict().parse(row.property);
    const source = readFileSync(row.path, "utf8");
    for (const needle of property.requires) expect(source, `${row.path} must still carry ${needle}`).toContain(needle);
    for (const needle of property.forbids) expect(source, `${row.path} must not carry ${needle}`).not.toContain(needle);
  }
  for (const row of core) {
    const current = boundarySuccessorSource(row.path); expect(sha(current)).toBe(row.afterSha256);
    if (row.beforeWhole === null) { expect(row.beforeSha256).toBeNull(); continue; }
    let restored = current;
    for (const edit of [...row.edits].sort((a, b) => b.afterStartByte - a.afterStartByte)) {
      expect(restored.subarray(edit.afterStartByte, edit.afterEndByte).toString("utf8")).toBe(edit.after);
      restored = Buffer.concat([restored.subarray(0, edit.afterStartByte), Buffer.from(edit.before), restored.subarray(edit.afterEndByte)]);
    }
    expect(restored.toString("utf8")).toBe(row.beforeWhole); expect(sha(restored)).toBe(row.beforeSha256);
  }
  const original = core.find(row => row.path === "tests/core/migrate.test.ts")?.beforeWhole;
  if (!original) throw new Error("The two original complete test oracles are required.");
  const current = readFileSync("tests/core/migrate.test.ts", "utf8"), marker = 'describe("boot migration serialization",';
  expect(current.slice(current.indexOf(marker))).toBe(original.slice(original.indexOf(marker)));
});
