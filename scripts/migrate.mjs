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
export function migrationFailureCode(error) {
  try {
    const descriptor = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
    const code = descriptor && "value" in descriptor ? descriptor.value : undefined;
    const allowed = new Set(["FH_MIGRATION_BOUNDARY_IDENTITY", "FH_MIGRATION_BOUNDARY_UNPINNED", "FH_MIGRATION_PREFIX_MISMATCH", "55006", "55P03"]);
    return typeof code === "string" && allowed.has(code) ? code : "MIGRATION_FAILED";
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
