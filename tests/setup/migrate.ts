// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Global setup: bring the test database to the current schema before anything
// runs, so the suite can never fail on a migration somebody forgot to apply —
// and so CI needs no separate migrate step. No DATABASE_URL means no
// database-backed tests at all (see vitest.config.ts), so this is a no-op.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  } finally {
    await client.end();
  }
}
