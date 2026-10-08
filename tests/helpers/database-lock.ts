// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Wait for the competing transaction to reach its actual database lock,
// instead of assuming a scheduling delay proves that requests overlapped.
import { setTimeout } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";

export async function waitForBlockedQuery(table: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await db().execute(sql`select 1 from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
      and wait_event_type = 'Lock' and query like ${`%${table}%`} limit 1`);
    if (rows.length) return;
    await setTimeout(25);
  }
  throw new Error(`The competing ${table} query did not reach its database lock.`);
}
