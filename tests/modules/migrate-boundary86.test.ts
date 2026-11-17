// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: real PostgreSQL transaction-boundary evidence ONLY. Temporary
// 86 contains the EXACT frozen first guard and a later probe/failure, not S0 DDL.
// Scratch databases are intentionally preserved for independent root inspection.
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATION_LOCK_KEY, MIGRATION_LOCK_NAMESPACE, SAFE_RESPONSE_BOUNDARY, migrationPrefixFingerprint, runMigrationsOnDedicatedSession } from "@/core/migrate-runner.mjs";

const url = process.env.DATABASE_URL;
const actualJournal = z.object({ version: z.string(), dialect: z.literal("postgresql"), entries: z.array(z.object({ idx: z.number().int(), version: z.string(), when: z.number().int(), tag: z.string(), breakpoints: z.boolean() }).strict()) }).strict().parse(JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8")));
const guard = readFileSync("tests/fixtures/controlled-safe-response-first-guard86.sql", "utf8");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const proofRows = z.array(z.object({ id: z.number().int(), hash: z.string(), created_at: z.string(), xmin: z.string() }).strict());
const evidence: Array<{ database: string; case: string; rows?: z.infer<typeof proofRows>; boundaryOnly: true }> = [];
const options = { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } };

function sourceFixture(failLater = false, laterMigration: "none" | "select" | "corrupt" = "none") {
  const folder = mkdtempSync(join(tmpdir(), "freeholder-boundary-pg-source-"));
  mkdirSync(join(folder, "meta"));
  const prefix = actualJournal.entries.slice(0, 86);
  if (prefix.length !== 86 || prefix.some((row, index) => row.idx !== index)) throw new Error("The actual complete 0..85 source prefix is required.");
  for (const entry of prefix) {
    const from = join("db/migrations", `${entry.tag}.sql`), to = join(folder, `${entry.tag}.sql`);
    cpSync(from, to); expect(sha(readFileSync(to))).toBe(sha(readFileSync(from)));
  }
  expect(Buffer.byteLength(guard)).toBe(2038); expect(sha(guard)).toBe(SAFE_RESPONSE_BOUNDARY.firstStatementSha256);
  const later = `\nCREATE TABLE public.safe_boundary_probe(xid text NOT NULL, prefix_xmin text NOT NULL);\nINSERT INTO public.safe_boundary_probe SELECT txid_current()::text,xmin::text FROM drizzle.__drizzle_migrations WHERE created_at=1793310000065;\n${failLater ? "DO $$ BEGIN RAISE EXCEPTION 'deliberate boundary-only rollback probe' USING ERRCODE='P0001'; END $$;" : ""}\n`;
  writeFileSync(join(folder, `${SAFE_RESPONSE_BOUNDARY.tag}.sql`), `${guard}--> statement-breakpoint${later}`);
  const entries = [...prefix, { idx: 86, version: "7", when: SAFE_RESPONSE_BOUNDARY.when, tag: SAFE_RESPONSE_BOUNDARY.tag, breakpoints: true }];
  if (laterMigration !== "none") {
    entries.push({ idx: 87, version: "7", when: SAFE_RESPONSE_BOUNDARY.when + 1, tag: "0087_boundary_probe_only", breakpoints: true });
    // The negative deliberately CORRUPTS an already genuinely applied row.
    // It never invents an applied prefix or counts this DB as valid acceptance.
    writeFileSync(join(folder, "0087_boundary_probe_only.sql"), laterMigration === "select" ? "SELECT 87;\n" : "UPDATE drizzle.__drizzle_migrations SET hash=repeat('0',64) WHERE created_at=1793310000066;\n");
  }
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...actualJournal, entries }));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  writeFileSync(join(folder, "meta", "controlled-safe-response-boundary.json"), JSON.stringify({ protocol: "controlled_safe_response_migration_boundary.v1", index: 86, tag: SAFE_RESPONSE_BOUNDARY.tag, when: SAFE_RESPONSE_BOUNDARY.when, breakpoints: true, firstStatementSha256: SAFE_RESPONSE_BOUNDARY.firstStatementSha256, predecessor85Sha256: migrations[85]!.hash, whole86Sha256: migrations[86]!.hash, prefix0To85Sha256: migrationPrefixFingerprint(entries, migrations) }));
  return { folder, migrations };
}
async function database(label: string) {
  if (!url) throw new Error("A declared disposable PostgreSQL server is required.");
  const name = `fh_boundary_${randomUUID().replaceAll("-", "")}`;
  // CREATE DATABASE uses a server-generated constrained identifier only. Never
  // overwrite/drop another database or copy a pre-existing journal/ledger.
  const admin = postgres(url, options);
  try { await admin.unsafe(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
  const target = new URL(url); target.pathname = `/${name}`;
  evidence.push({ database: name, case: label, boundaryOnly: true });
  return { name, connect: (onQuery?: (query: string) => void) => postgres(target.toString(), { ...options, ...(onQuery ? { debug: (_connection: number, query: string) => onQuery(query) } : {}) }) };
}
async function journal(client: ReturnType<typeof postgres>) {
  return proofRows.parse(await client`select id,hash,created_at::text as created_at,xmin::text as xmin from drizzle.__drizzle_migrations order by created_at,id`);
}
async function stagePrefix(target: Awaited<ReturnType<typeof database>>, f: ReturnType<typeof sourceFixture>, count = 86) {
  const client = target.connect();
  try {
    // Genuine prior official engine commits, exclusively fixture preparation.
    await new PgDialect().migrate(f.migrations.slice(0, count), drizzle(client)._.session as Parameters<PgDialect["migrate"]>[1], { migrationsFolder: f.folder });
    return await journal(client);
  } finally { await client.end(); }
}
async function observe(target: Awaited<ReturnType<typeof database>>) {
  const client = target.connect();
  try { const rows = await journal(client); evidence.find(row => row.database === target.name)!.rows = rows; return rows; }
  finally { await client.end(); }
}
async function rejection(attempt: Promise<unknown>, expectedCode: string) {
  const outcome = await attempt.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("The actual PostgreSQL guard must refuse.");
  // PgDialect wraps the real server error; inspect the finite code only.
  const outer = z.object({ code: z.string().optional(), cause: z.unknown().optional() }).passthrough().parse(outcome.error);
  const inner = z.object({ code: z.string().optional() }).passthrough().safeParse(outer.cause);
  expect(outer.code ?? (inner.success ? inner.data.code : undefined)).toBe(expectedCode);
}
async function run(target: Awaited<ReturnType<typeof database>>, f: ReturnType<typeof sourceFixture>) {
  const client = target.connect();
  try { await runMigrationsOnDedicatedSession(client, { migrationsFolder: f.folder }); }
  finally { await client.end(); }
}
afterAll(() => {
  if (evidence.length) writeFileSync(join(tmpdir(), `freeholder-boundary86-proof-${process.pid}.json`), JSON.stringify({ classification: "temporary-guard-boundary-only; not S0 acceptance", databasesPreserved: true, evidence }, null, 2));
});

describe.runIf(Boolean(url))("actual official migration 86 transaction boundary (external closed-set drain also required)", { timeout: 180000 }, () => {
  it("commits actual full 0..85 before the exact first guard and writes 86 in a different real transaction", async () => {
    const target = await database("fresh"), f = sourceFixture(); await run(target, f);
    const rows = await observe(target); expect(rows).toHaveLength(87);
    expect(new Set(rows.slice(0, 86).map(row => row.xmin)).size).toBe(1);
    expect(rows[86]!.xmin).not.toBe(rows[85]!.xmin);
    const client = target.connect();
    try {
      const [probe] = z.array(z.object({ xid: z.string(), prefix_xmin: z.string() }).strict()).parse(await client`select xid,prefix_xmin from public.safe_boundary_probe`);
      expect(probe?.prefix_xmin).toBe(rows[85]!.xmin);
      expect((BigInt(probe!.xid) % 4294967296n).toString()).toBe(rows[86]!.xmin);
    } finally { await client.end(); }
  });
  it("checks the complete real journal after a genuine later87 SELECT migration", async () => {
    const target = await database("later87-complete-journal"), f = sourceFixture(false, "select");
    let completeReads = 0;
    const client = target.connect(query => { if (query.includes("select id, hash, created_at::text as created_at")) completeReads++; });
    try { await runMigrationsOnDedicatedSession(client, { migrationsFolder: f.folder }); }
    finally { await client.end(); }
    const rows = await observe(target); expect(rows).toHaveLength(88); expect(completeReads).toBe(3);
    expect(rows.map(row => ({ created_at: row.created_at, hash: row.hash }))).toEqual(f.migrations.map(row => ({ created_at: String(row.folderMillis), hash: row.hash })));
    expect(rows[87]!.xmin).not.toBe(rows[86]!.xmin);
  });
  it("ADVERSARIAL NEGATIVE refuses final integrity after genuine87 corrupts an already engine-applied real journal hash", async () => {
    const target = await database("adversarial87-corrupted-journal-negative"), f = sourceFixture(false, "corrupt");
    let completeReads = 0;
    const client = target.connect(query => { if (query.includes("select id, hash, created_at::text as created_at")) completeReads++; });
    try { await rejection(runMigrationsOnDedicatedSession(client, { migrationsFolder: f.folder }), "FH_MIGRATION_PREFIX_MISMATCH"); }
    finally { await client.end(); }
    // 0..86 really committed before the independently committed87 attack. The
    // bad DB stays preserved and labelled negative; it is NOT valid S0 proof.
    const rows = await observe(target); expect(rows).toHaveLength(88); expect(completeReads).toBe(3);
    expect(rows.slice(0, 86).map(row => ({ created_at: row.created_at, hash: row.hash }))).toEqual(f.migrations.slice(0, 86).map(row => ({ created_at: String(row.folderMillis), hash: row.hash })));
    expect(rows[86]).toMatchObject({ created_at: String(SAFE_RESPONSE_BOUNDARY.when), hash: "0".repeat(64) });
    expect(rows[87]).toMatchObject({ created_at: String(SAFE_RESPONSE_BOUNDARY.when + 1), hash: f.migrations[87]!.hash });
    expect(rows[86]!.xmin).toBe(rows[87]!.xmin);
    const inspector = target.connect();
    try {
      const [probe] = z.array(z.object({ xid: z.string(), prefix_xmin: z.string() }).strict()).parse(await inspector`select xid,prefix_xmin from public.safe_boundary_probe`);
      expect(probe?.prefix_xmin).toBe(rows[85]!.xmin);
      expect((BigInt(probe!.xid) % 4294967296n).toString()).not.toBe(rows[87]!.xmin);
    } finally { await inspector.end(); }
  });
  it("preserves genuine earlier partial commits while installing the remaining prefix before 86", async () => {
    const target = await database("partial-upgrade"), f = sourceFixture();
    const before = await stagePrefix(target, f, 12); expect(before).toHaveLength(12);
    await run(target, f); const rows = await observe(target);
    expect(rows.slice(0, 12)).toEqual(before); expect(rows).toHaveLength(87);
    expect(new Set(rows.slice(12, 86).map(row => row.xmin)).size).toBe(1);
    expect(rows[12]!.xmin).not.toBe(rows[11]!.xmin);
    expect(new Set(rows.slice(0, 86).map(row => row.xmin)).has(rows[86]!.xmin)).toBe(false);
  });
  it("retains the actual committed prefix when a later statement in 86 rolls its real journal/probe back", async () => {
    const target = await database("86-rollback"), f = sourceFixture(true);
    await rejection(run(target, f), "P0001"); const rows = await observe(target);
    expect(rows).toHaveLength(86); expect(new Set(rows.map(row => row.xmin)).size).toBe(1);
    const client = target.connect();
    try { expect(await client`select to_regclass('public.safe_boundary_probe')::text as probe`).toEqual([{ probe: null }]); }
    finally { await client.end(); }
  });
  it("refuses another actual target-database client before any probe or row 86", async () => {
    const target = await database("other-client"), f = sourceFixture(); const before = await stagePrefix(target, f);
    const other = target.connect();
    try { await other`select pg_backend_pid()`; await rejection(run(target, f), "55006"); }
    finally { await other.end(); }
    expect(await observe(target)).toEqual(before);
  });
  it("refuses a genuine prepared transaction (max_prepared_transactions>0 is an explicit required prerequisite)", async () => {
    const target = await database("prepared-transaction"), f = sourceFixture(); const before = await stagePrefix(target, f);
    const preparer = target.connect(), gid = `fh_boundary_${randomUUID().replaceAll("-", "")}`;
    let prepared = false;
    try {
      const [setting] = z.array(z.object({ max_prepared_transactions: z.coerce.number().int() })).parse(await preparer`show max_prepared_transactions`);
      if (!setting || setting.max_prepared_transactions < 1) throw new Error("OPEN prerequisite: run this real prepared-transaction proof on a disposable server with max_prepared_transactions > 0.");
      await preparer.begin(async tx => { await tx`select 1`; await tx.unsafe(`PREPARE TRANSACTION '${gid}'`); prepared = true; });
    } finally { await preparer.end(); }
    try { await rejection(run(target, f), "55006"); }
    finally {
      if (prepared) { const cleaner = target.connect(); try { await cleaner.unsafe(`ROLLBACK PREPARED '${gid}'`); } finally { await cleaner.end(); } }
    }
    expect(await observe(target)).toEqual(before);
  });
  it("refuses a real bootstrap waiting on the same session lock and cancels/drains it before release", async () => {
    const target = await database("waiting-bootstrap"), f = sourceFixture(); const before = await stagePrefix(target, f);
    const first = target.connect(), second = target.connect(); let secondOutcome: Promise<{ ok: boolean }> | undefined;
    try {
      await first`select pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE},${MIGRATION_LOCK_KEY})`;
      secondOutcome = runMigrationsOnDedicatedSession(second, { migrationsFolder: f.folder }).then(() => ({ ok: true }), () => ({ ok: false }));
      let waiter: number | undefined;
      const deadline = Date.now() + 10000;
      while (!waiter && Date.now() < deadline) {
        const rows = z.array(z.object({ pid: z.number().int() }).strict()).parse(await first`select pid from pg_locks where locktype='advisory' and classid=${MIGRATION_LOCK_NAMESPACE}::oid and objid=${MIGRATION_LOCK_KEY}::oid and objsubid=2 and not granted and pid<>pg_backend_pid()`);
        waiter = rows[0]?.pid; if (!waiter) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiter).toBeDefined(); if (!waiter) throw new Error("Observe the genuine waiting second bootstrap.");
      await rejection(runMigrationsOnDedicatedSession(first, { migrationsFolder: f.folder }), "55006");
      await first`select pg_cancel_backend(${waiter})`;
      expect(await secondOutcome).toEqual({ ok: false }); await second.end();
    } finally {
      // Do not release the first lock until the waiting client is truly closed.
      await second.end({ timeout: 1 }); await first.end();
    }
    expect(await observe(target)).toEqual(before);
  });
});

// Requires a REAL built artifact and its bundled Node. Missing paths mean an
// explicit OPEN artifact prerequisite, never a source-copy acceptance claim.
const artifact = process.env.FREEHOLDER_MIGRATION_ARTIFACT_APP;
const runtime = process.env.FREEHOLDER_MIGRATION_ARTIFACT_NODE;
it.runIf(Boolean(artifact && runtime))("resolves actual official imports from byte-identical packaged CLI/runner and migration metadata", () => {
  if (!artifact || !runtime) throw new Error("Supply the actual built artifact and bundled runtime.");
  for (const file of ["scripts/migrate.mjs", "src/core/migrate-runner.mjs", "db/migrations/meta/_journal.json", "db/migrations/meta/controlled-safe-response-boundary.json"]) expect(sha(readFileSync(join(artifact, file)))).toBe(sha(readFileSync(file)));
  const child = spawnSync(runtime, ["--input-type=module", "-e", `const c=await import(${JSON.stringify(pathToFileURL(resolve(artifact, "scripts/migrate.mjs")).href)});const r=await import(${JSON.stringify(pathToFileURL(resolve(artifact, "src/core/migrate-runner.mjs")).href)});if(typeof c.main!=="function"||typeof r.runMigrationsOnDedicatedSession!=="function")process.exit(1);process.stdout.write("ARTIFACT_IMPORTS_OK");`], { cwd: artifact, env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8" });
  expect(child.status).toBe(0); expect(child.stderr).toBe(""); expect(child.stdout).toBe("ARTIFACT_IMPORTS_OK");
});
