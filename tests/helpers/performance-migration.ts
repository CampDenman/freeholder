// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: the migration wall-clock. §15.1 budgets "Migration, medium dataset
// ≤ 60s total — the update window an owner will actually accept". The honest
// local measurement of that window is the full collapsed chain (0000→latest
// in db/migrations) applied to a FRESH database through the same drizzle
// migrator production boots with: it is the largest migration workload any
// instance can pay, it is the only one reproducible without snapshotting the
// medium fixture at every historical schema version, and on the reference
// target it is what a fresh deploy pays too. What it cannot prove is backfill
// cost over a populated medium dataset; deploy/performance-measurements.md
// says so explicitly.
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { migrateToLatest } from "@/core/migrate";
import { resetEnvForTests } from "@/core/env";

export interface MigrationMeasurement {
  surface: "Migration, medium dataset";
  value: number;
  samples: number[];
  database: string;
}

export function expectedMigrationCount(migrationsFolder: string): number {
  return readdirSync(migrationsFolder).filter(
    (name) => name.endsWith(".sql") && /^\d{4}_/.test(name),
  ).length;
}

/**
 * Apply the migration chain to one database and time it, validating at the
 * end that the journal fully applied. Exported separately so contract tests
 * can drive it against their own disposable database.
 */
export async function timeMigrationChain(input: {
  databaseUrl: string;
  migrationsFolder: string;
}): Promise<{ ms: number; applied: number }> {
  const expected = expectedMigrationCount(input.migrationsFolder);
  if (expected === 0) {
    throw new Error(`No migration files found in ${input.migrationsFolder}.`);
  }
  const client = postgres(input.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const started = performance.now();
    await migrate(drizzle(client), { migrationsFolder: input.migrationsFolder });
    const ms = performance.now() - started;
    const [row] = await client<Array<{ applied: number }>>`
      select count(*)::int as applied from drizzle.__drizzle_migrations
    `;
    const applied = row?.applied ?? 0;
    if (applied !== expected) {
      throw new Error(
        `Migration chain validation failed: ${applied} of ${expected} journal entries applied.`,
      );
    }
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Migration clock produced an invalid timing.");
    }
    return { ms, applied };
  } finally {
    await client.end();
  }
}

/**
 * Create a fresh disposable database on the same server as the measurement
 * database, apply the chain through the production boot path
 * (`migrateToLatest`, advisory lock included) with DATABASE_URL pointed at
 * it, then drop it. The timed value is the whole 0000→latest apply.
 */
export async function measureMigrationClock(env: NodeJS.ProcessEnv = process.env): Promise<MigrationMeasurement> {
  const source = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (!source) {
    throw new Error(
      "Migration measurement needs TEST_DATABASE_URL (a disposable database) to create a fresh schema database beside it.",
    );
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL; cannot derive a fresh migration database.");
  }
  const database = `freeholder_perf_migration_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(url);
  targetUrl.pathname = `/${database}`;

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${database}"`);
  } catch (error) {
    await admin.end().catch(() => undefined);
    throw new Error(
      `Cannot create a fresh migration database (does the test user have CREATEDB?): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await admin.end().catch(() => undefined);
  }

  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = targetUrl.toString();
  resetEnvForTests();
  let ms: number;
  try {
    const started = performance.now();
    const result = await migrateToLatest();
    ms = performance.now() - started;
    if (!result.ran) {
      throw new Error(
        `Production migration path refused to run against the fresh database: ${result.reason ?? "no reason"}.`,
      );
    }
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
    resetEnvForTests();
  }

  // Validate the chain fully applied (journal row count), then drop the
  // database. Failure to drop must not void the measurement, but must be
  // loud: a leaked migration database is disposable-environment litter.
  const probe = postgres(targetUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const expected = expectedMigrationCount(resolve("db/migrations"));
    const [row] = await probe<Array<{ applied: number }>>`
      select count(*)::int as applied from drizzle.__drizzle_migrations
    `;
    if ((row?.applied ?? 0) !== expected) {
      throw new Error(
        `Migration measurement validation failed: ${row?.applied ?? 0} of ${expected} journal entries applied to the fresh database.`,
      );
    }
  } finally {
    await probe.end().catch(() => undefined);
  }
  const drop = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await drop.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
    );
    await drop.unsafe(`DROP DATABASE "${database}"`);
  } finally {
    await drop.end().catch(() => undefined);
  }

  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error("Migration clock produced an invalid timing.");
  }
  return {
    surface: "Migration, medium dataset",
    value: Math.round(ms),
    samples: [Math.round(ms)],
    database,
  };
}
