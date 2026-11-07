// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError, type Actor, type Tx } from "@/core/service";
import { PLAYGROUND_BASELINE_MODULE, PLAYGROUND_ROW_CAPS } from "./playground-policy";

/**
 * Check each new row inside its owning transaction. The service kernel's
 * preflight cannot see inserts already staged by another call in that same
 * transaction; bulk inline creation must count them before the next insert.
 * The table lock serializes concurrent creators without locking real sites.
 */
export async function checkPlaygroundInsert(tx: Tx, actor: Actor, serviceName: string): Promise<void> {
  if (env().FREEHOLDER_PLAYGROUND !== "1" || actor.kind === "system") return;
  const cap = PLAYGROUND_ROW_CAPS[serviceName];
  if (!cap) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`playground-cap:${cap.table}`}))`);
  const [stored] = await tx.execute<{ baseline: Record<string, number> | null }>(sql`
    select config->'baseline' as baseline from module_settings
    where module = ${PLAYGROUND_BASELINE_MODULE}
  `);
  const [current] = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from ${sql.identifier(cap.table)}
  `);
  if (Number(current?.count ?? 0) - Number(stored?.baseline?.[cap.table] ?? 0) >= cap.limit) {
    throw new ServiceError("rate_limited", "This playground surface is full. Try again after the hourly reset.");
  }
}
