// SPDX-License-Identifier: AGPL-3.0-only
// The one sacred database (MASTER.md §2, principle 12). Lazy singleton so
// importing this module never connects — only use does.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "@/core/env";

export type Database = ReturnType<typeof createDb>;

function createDb() {
  const client = postgres(databaseUrl(), { onnotice: () => {} });
  return drizzle(client);
}

let instance: Database | undefined;

export function db(): Database {
  instance ??= createDb();
  return instance;
}
