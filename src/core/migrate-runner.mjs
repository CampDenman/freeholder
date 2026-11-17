// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C11.08: actual committed-prefix boundary; no business/env dependency.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";

// The original two signed int32 values spell Free / hold. The caller closes
// its dedicated max1 session; a transaction-level lock would be insufficient.
export const MIGRATION_LOCK_NAMESPACE = 0x46726565;
export const MIGRATION_LOCK_KEY = 0x686f6c64;
export const SAFE_RESPONSE_BOUNDARY = Object.freeze({
  index: 86, tag: "0086_controlled_safe_response", when: 1793310000066,
  breakpoints: true, firstStatementBytes: 2038,
  firstStatementSha256: "14b90f4109f06e5457ddaa0b0c0210516092f0e2e6d8965d067eca7c3370b8d4",
});
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z.object({
  idx: z.number().int().nonnegative(), version: z.string(),
  when: z.number().int().nonnegative().safe(),
  tag: z.string().regex(/^[0-9]{4}_[A-Za-z0-9_-]+$/), breakpoints: z.boolean(),
}).strict();
const sourceJournal = z.object({
  version: z.string(), dialect: z.literal("postgresql"), entries: z.array(entry),
}).strict();
const review = z.object({
  protocol: z.literal("controlled_safe_response_migration_boundary.v1"),
  index: z.literal(86), tag: z.literal(SAFE_RESPONSE_BOUNDARY.tag),
  when: z.literal(SAFE_RESPONSE_BOUNDARY.when), breakpoints: z.literal(true),
  firstStatementSha256: z.literal(SAFE_RESPONSE_BOUNDARY.firstStatementSha256),
  predecessor85Sha256: sha, whole86Sha256: sha, prefix0To85Sha256: sha,
}).strict();
function fail(code) {
  throw Object.assign(new Error("The reviewed migration boundary is unavailable or inconsistent."), { code });
}
const digest = value => createHash("sha256").update(value).digest("hex");

/** Source artifact identity only. This never proves database quiescence. */
export function migrationPrefixFingerprint(entries, migrations) {
  return digest(JSON.stringify(entries.slice(0, 86).map((row, index) => ({
    idx: row.idx, tag: row.tag, when: row.when, hash: migrations[index]?.hash,
  }))));
}
export function readMigrationPlan(config) {
  const migrations = readMigrationFiles(config);
  const document = JSON.parse(readFileSync(join(config.migrationsFolder, "meta", "_journal.json"), "utf8"));
  const rows = Array.isArray(document?.entries) ? document.entries : [];
  const claimed = rows.some(row => row && typeof row === "object" && (
    row.idx >= 86 || row.tag === SAFE_RESPONSE_BOUNDARY.tag ||
    typeof row.tag === "string" && /^[0-9]{4}_/.test(row.tag) && Number(row.tag.slice(0, 4)) >= 86 ||
    row.when >= SAFE_RESPONSE_BOUNDARY.when
  ));
  if (migrations.length < 87 && !claimed && !migrations.some(row => row.folderMillis >= SAFE_RESPONSE_BOUNDARY.when)) {
    return { kind: "legacy", all: migrations };
  }
  const parsed = sourceJournal.safeParse(document);
  if (!parsed.success) fail("FH_MIGRATION_BOUNDARY_IDENTITY");
  const entries = parsed.data.entries;
  if (entries.length !== migrations.length || entries.length < 87 || entries.some((row, index) =>
    row.idx !== index || index > 0 && row.when <= entries[index - 1].when ||
    row.when !== migrations[index].folderMillis || row.breakpoints !== migrations[index].bps
  )) fail("FH_MIGRATION_BOUNDARY_IDENTITY");
  const selected = entries[86], actual = migrations[86], first = actual.sql[0];
  if (selected.tag !== SAFE_RESPONSE_BOUNDARY.tag || selected.when !== SAFE_RESPONSE_BOUNDARY.when ||
    selected.breakpoints !== true || typeof first !== "string" ||
    Buffer.byteLength(first) !== SAFE_RESPONSE_BOUNDARY.firstStatementBytes ||
    digest(first) !== SAFE_RESPONSE_BOUNDARY.firstStatementSha256
  ) fail("FH_MIGRATION_BOUNDARY_IDENTITY");
  let metadata;
  try {
    metadata = review.parse(JSON.parse(readFileSync(join(config.migrationsFolder, "meta", "controlled-safe-response-boundary.json"), "utf8")));
  } catch { fail("FH_MIGRATION_BOUNDARY_UNPINNED"); }
  if (metadata.predecessor85Sha256 !== migrations[85].hash || metadata.whole86Sha256 !== actual.hash ||
    metadata.prefix0To85Sha256 !== migrationPrefixFingerprint(entries, migrations)
  ) fail("FH_MIGRATION_BOUNDARY_IDENTITY");
  return { kind: "boundary", all: migrations, before: migrations.slice(0, 86), boundary: [actual], after: migrations.slice(87) };
}
async function verifyCommittedPrefix(session, migrations, minimum, config) {
  const schema = config.migrationsSchema ?? "drizzle", table = config.migrationsTable ?? "__drizzle_migrations";
  const found = await session.all(sql`select id, hash, created_at::text as created_at from ${sql.identifier(schema)}.${sql.identifier(table)} order by created_at, id`);
  const parsed = z.array(z.object({ id: z.number().int().positive(), hash: sha, created_at: z.string().regex(/^[0-9]+$/) }).strict()).safeParse(found);
  // Compare every actual journal member/hash in source order. Failed sequence
  // allocations may leave SERIAL gaps, so IDs need not equal array offsets.
  if (!parsed.success || parsed.data.length < minimum || parsed.data.length > migrations.length ||
    new Set(parsed.data.map(row => row.created_at)).size !== parsed.data.length ||
    parsed.data.some((row, index) => row.created_at !== String(migrations[index].folderMillis) || row.hash !== migrations[index].hash)
  ) fail("FH_MIGRATION_PREFIX_MISMATCH");
}
/** Caller owns its dedicated max1 client and finally-close. This runner owns
 * ONE session lock across ALL official engine transactions and inspection.
 * Never call from a transaction; production/test/CLI create ordinary clients. */
export async function runMigrationsOnDedicatedSession(client, config) {
  await client`select pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
  const orm = drizzle(client), plan = readMigrationPlan(config);
  if (plan.kind === "legacy") { await migrate(orm, config); return; }
  const dialect = new PgDialect(), session = orm._.session;
  await dialect.migrate(plan.before, session, config);
  await verifyCommittedPrefix(session, plan.all, 86, config);
  await dialect.migrate(plan.boundary, session, config);
  await verifyCommittedPrefix(session, plan.all, 87, config);
  if (plan.after.length) await dialect.migrate(plan.after, session, config);
  await verifyCommittedPrefix(session, plan.all, plan.all.length, config);
}
