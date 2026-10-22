// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Count other connections holding a transaction open, so a provider stub can
// prove it was called with no service transaction waiting on it (§11).
import { sql } from "drizzle-orm";
import { db } from "@/core/db";

export async function openTransactions(): Promise<number> {
  const rows = await db().execute<{ open: number }>(sql`select count(*)::int as open
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
    and state in ('idle in transaction', 'idle in transaction (aborted)')`);
  return Number(rows[0]?.open ?? 0);
}
