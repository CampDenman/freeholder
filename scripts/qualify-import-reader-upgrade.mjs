// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: unchanged previous runtime -> normal journal -> current recovery.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const current = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previous = resolve(process.argv[2] ?? "");
const prefix = process.argv[3];
const committedPrivate = process.argv[4] === "--committed-private";
if (process.argv[4] && !committedPrivate) throw new Error("Unknown qualification variant.");
if (!process.argv[2] || !prefix || !/^[a-z][a-z0-9_]{5,42}$/.test(prefix)) throw new Error("Usage: node scripts/qualify-import-reader-upgrade.mjs PREVIOUS_WORKTREE DISPOSABLE_DB_PREFIX; set READER_UPGRADE_ADMIN_URL.");
if (!process.env.READER_UPGRADE_ADMIN_URL) throw new Error("Set READER_UPGRADE_ADMIN_URL to an explicit local disposable Postgres administration URL.");
const adminUrl = new URL(process.env.READER_UPGRADE_ADMIN_URL);
if (!["postgres:", "postgresql:"].includes(adminUrl.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname)) throw new Error("Use an explicit local disposable Postgres administration URL.");
if (existsSync(join(previous, ".env"))) throw new Error("Choose a clean disposable prior checkout without a private .env; preserve the original file.");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: previous, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "src", "app", "db", "package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts", "freeholder.config.ts", "tests/helpers"], { cwd: previous, encoding: "utf8" }).trim()) throw new Error("The previous runtime's product source must be unchanged.");
const priorJournal = JSON.parse(readFileSync(join(previous, "db/migrations/meta/_journal.json"), "utf8"));
const nextJournal = JSON.parse(readFileSync(join(current, "db/migrations/meta/_journal.json"), "utf8"));
if (priorJournal.entries.at(-1)?.idx !== 77 || nextJournal.entries.at(-1)?.idx !== 78 || JSON.stringify(priorJournal.entries) !== JSON.stringify(nextJournal.entries.slice(0, -1))) throw new Error("This proof requires the exact unchanged0–77 predecessor journal followed only by78.");
for (const entry of priorJournal.entries) if (!readFileSync(join(previous, `db/migrations/${entry.tag}.sql`)).equals(readFileSync(join(current, `db/migrations/${entry.tag}.sql`)))) throw new Error("A predecessor migration changed; preserve its original bytes.");
const beforeName = `${prefix}_before`, afterName = `${prefix}_after`, emptyName = `${prefix}_empty`;
const dbUrl = name => { const url = new URL(adminUrl); url.pathname = `/${name}`; return url.href; };
const evidenceDir = mkdtempSync(join(tmpdir(), "freeholder-reader-upgrade-"));
const evidencePath = join(evidenceDir, "original.json");
const configNames = [], fixtureCopies = [];
const database = postgres(adminUrl.href, { max: 1, onnotice: () => {} });
async function journalCount(url, expected) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try { const [row] = await client`select count(*)::int as count from drizzle.__drizzle_migrations`; if (row.count !== expected) throw new Error(`Expected ${expected} normal journal entries, received ${row.count}.`); }
  finally { await client.end(); }
}
function runtimeFixture(worktree, fixture, url, phase) {
  const relative = `tests/upgrade/${fixture}`;
  if (worktree === previous) {
    for (const name of [fixture, "import-reader-data.ts"]) {
      const target = join(previous, "tests/upgrade", name);
      // The caller supplies a disposable prior checkout. The copied files are
      // test inputs only; product code and its journal stay byte-identical.
      if (existsSync(target) && !fixtureCopies.includes(target)) throw new Error("A prior qualification input already exists; preserve it and choose a clean checkout.");
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(current, "tests/upgrade", name), target);
      fixtureCopies.push(target);
    }
  }
  const config = join(worktree, ".reader-upgrade.config.ts");
  if (existsSync(config) && !configNames.includes(config)) throw new Error("A qualification config already exists; preserve it before retrying.");
  configNames.push(config);
  writeFileSync(config, `// Copyright (C) 2026 Tony Aly\n// SPDX-License-Identifier: Apache-2.0\nimport base from "./vitest.config";\nexport default { ...base, test: { ...base.test, include: [${JSON.stringify(relative)}] } };\n`);
  execFileSync("corepack", ["pnpm", "exec", "vitest", "run", "--config", config], {
    cwd: worktree, stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: url, FREEHOLDER_READER_UPGRADE_PHASE: phase, FREEHOLDER_READER_UPGRADE_EVIDENCE: evidencePath, FREEHOLDER_READER_UPGRADE_COMMITTED_PRIVATE: committedPrivate ? "1" : "0" },
  });
}
try {
  for (const name of [beforeName, afterName, emptyName]) {
    const existing = await database`select datname from pg_database where datname=${name}`;
    if (existing.length) throw new Error("Choose a fresh disposable prefix; this proof never overwrites an existing database.");
  }
  await database.unsafe(`create database "${beforeName}"`);
  await database.unsafe(`create database "${emptyName}"`);
  runtimeFixture(previous, "import-reader-previous.fixture.ts", dbUrl(beforeName), "before");
  await journalCount(dbUrl(beforeName), 78);
  await database.unsafe(`create database "${afterName}" template "${beforeName}"`);
  for (const name of [emptyName, afterName]) {
    const client = postgres(dbUrl(name), { max: 1, onnotice: () => {} });
    try { await migrate(drizzle(client), { migrationsFolder: join(current, "db/migrations") }); }
    finally { await client.end(); }
    await journalCount(dbUrl(name), 79);
  }
  const expected = JSON.parse(readFileSync(evidencePath, "utf8"));
  const clone = postgres(dbUrl(afterName), { max: 1, onnotice: () => {} });
  try {
    for (const table of ["contacts", "import_runs", "blog_reader_comments", "audit_log"]) {
      const original = expected.snapshots[table];
      const [row] = await clone.unsafe(`select count(*)::int as count,md5(coalesce(jsonb_agg(to_jsonb(original) order by original.id)::text,'[]')) as hash from "${table}" original`);
      if (JSON.stringify(row) !== JSON.stringify(original)) throw new Error(`Normal migration changed the original ${table} rows.`);
    }
  } finally { await clone.end(); }
  if (!committedPrivate) runtimeFixture(previous, "import-reader-previous.fixture.ts", dbUrl(afterName), "old-after");
  runtimeFixture(current, committedPrivate ? "import-reader-committed-private.fixture.ts" : "import-reader-current.fixture.ts", dbUrl(afterName), "after");
  writeFileSync(join(evidenceDir, "result.json"), JSON.stringify({ previousHead: head, currentHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: current, encoding: "utf8" }).trim(), previousJournal: 78, currentJournal: 79, preservedTables: Object.keys(expected.snapshots), priorWriterRefused: !committedPrivate, humanRecovery: !committedPrivate, committedPrivate }, null, 2));
  console.log(committedPrivate ? `Committed-private prior runtime upgrade boundary passed. Evidence: ${evidenceDir}` : `Reader upgrade passed: normal0–78 empty/populated, original tables preserved, previous writer refused, fresh human recovered the original owner. Evidence: ${evidenceDir}`);
} finally {
  await database.end();
  for (const path of new Set([...configNames, ...fixtureCopies])) rmSync(path, { force: true });
}
