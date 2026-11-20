// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// Same dedicated-session runner as boot and test setup. Never echo credentials.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { runMigrationsOnDedicatedSession } from "../src/core/migrate-runner.mjs";

export const DEFAULT_MIGRATION_URL = "postgres://postgres:postgres@localhost:5432/freeholder_dev";
export function loadMigrationEnvironment() {
  try { process.loadEnvFile(".env"); }
  catch (error) {
    // Missing .env is normal; malformed/unreadable files must not silently fall
    // back to a different database. This value is inspected, never printed.
    const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
    if (code?.value !== "ENOENT") throw new Error("Migration environment could not be loaded.");
  }
}
export function migrationDatabaseUrl() {
  // Match drizzle.config.ts exactly, including an explicitly empty value.
  return process.env.DATABASE_URL ?? DEFAULT_MIGRATION_URL;
}
// The driver wraps: DrizzleQueryError carries no code of its own and puts the
// real PostgresError in `cause`. Reading only the outermost own code made
// every PostgreSQL code in this list unreachable -- 55006 and 55P03 have
// always been named here and could never be reported -- so a refused
// migration printed MIGRATION_FAILED and named nothing. The walk is bounded
// and cycle-safe, and still reads own data properties only: never a getter's
// return, never a message, never a query.
export function migrationFailureCode(error) {
  try {
    const allowed = new Set(["FH_MIGRATION_BOUNDARY_IDENTITY", "FH_MIGRATION_BOUNDARY_UNPINNED", "FH_MIGRATION_PREFIX_MISMATCH", "55006", "55P03"]);
    const own = (target, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const seen = new Set();
    for (let current = error; current && typeof current === "object" && !seen.has(current) && seen.size < 4; current = own(current, "cause")) {
      seen.add(current);
      const code = own(current, "code");
      if (typeof code === "string" && allowed.has(code)) return code;
    }
    return "MIGRATION_FAILED";
  } catch { return "MIGRATION_FAILED"; }
}
export async function main() {
  loadMigrationEnvironment();
  const client = postgres(migrationDatabaseUrl(), { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  try { await runMigrationsOnDedicatedSession(client, { migrationsFolder: "db/migrations" }); }
  finally { await client.end(); }
  process.stdout.write("Database migrations complete.\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => {
    process.stderr.write(`Database migration failed: ${migrationFailureCode(error)}\n`);
    process.exitCode = 1;
  });
}
