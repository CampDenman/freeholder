// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import * as paymentAdapters from "@/adapters/payments";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import { prepareControlledProviderCalendar } from "@/modules/subscriptions/controlled-provider-execution";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { controlledPeriodEdge84 } from "../helpers/merchant-controlled-period84";

describe.runIf(hasDatabase)("immutable controlled row-hash ledger", () => {
 let original: Awaited<ReturnType<typeof seedActualProviderSubscription80>> | undefined;
 beforeAll(ready, 60000); beforeEach(truncateSpine);
 afterEach(() => { vi.restoreAllMocks(); original?.fixture.cleanup(); original = undefined; });
 afterAll(async () => { await stopJobs(); await closeDb(); });

 it("certifies every actual row once and refuses direct ledger writes", async () => {
  original = await seedActualProviderSubscription80();
  const edge = controlledPeriodEdge84(); vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(edge.provider);
  const prepared = await prepareControlledProviderCalendar.call({ subscriptionId: original.accepted.subscription.id }, OWNER);
  await db().transaction(async tx => { await controlledProviderJournal(tx, prepared.resourceId); });
  const [mismatch] = await db().execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM (
    SELECT r.table_name,r.row_id,r.row_sha256,r.row_bytes FROM subscription_controlled_row_hashes r
    UNION ALL SELECT 'subscription_controlled_resources',id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_resources x
    UNION ALL SELECT 'subscription_controlled_operations',id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_operations x
    UNION ALL SELECT 'subscription_controlled_calls',id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_calls x
    UNION ALL SELECT 'subscription_controlled_facts',id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_facts x
    UNION ALL SELECT 'subscription_controlled_finishes',call_id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_finishes x
    UNION ALL SELECT 'subscription_controlled_stops',call_id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_stops x
    UNION ALL SELECT 'subscription_controlled_verifications',operation_id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_verifications x
    UNION ALL SELECT 'subscription_controlled_charge_origins',receipt_id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_charge_origins x
    UNION ALL SELECT 'subscription_controlled_closures',resource_id,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),octet_length(to_jsonb(x)::text) FROM subscription_controlled_closures x
  ) actual LEFT JOIN subscription_controlled_row_hashes expected ON expected.table_name=actual.table_name AND expected.row_id=actual.row_id
  WHERE expected.row_id IS NULL OR expected.row_sha256 IS DISTINCT FROM actual.row_sha256 OR expected.row_bytes IS DISTINCT FROM actual.row_bytes`);
  expect(mismatch?.count).toBe(0);
  const [headMismatch] = await db().execute<{ count: number }>(sql`WITH actual AS (
    SELECT resource_id,encode(sha256(convert_to(jsonb_agg(jsonb_build_array(table_name,row_id,row_sha256) ORDER BY table_name,row_id)::text,'UTF8')),'hex') AS fingerprint,
      count(*)::int AS physical_count,sum(row_bytes)::bigint AS physical_bytes
    FROM subscription_controlled_row_hashes GROUP BY resource_id
  ) SELECT count(*)::int AS count FROM actual FULL JOIN subscription_controlled_journal_heads h ON h.resource_id=actual.resource_id
  WHERE h.resource_id IS NULL OR actual.resource_id IS NULL OR h.fingerprint IS DISTINCT FROM actual.fingerprint
    OR h.physical_count IS DISTINCT FROM actual.physical_count OR h.physical_bytes IS DISTINCT FROM actual.physical_bytes`);
  expect(headMismatch?.count).toBe(0);
  await expect(db().execute(sql`UPDATE subscription_controlled_journal_heads SET physical_bytes=physical_bytes+1`)).rejects.toThrow();
  await expect(db().execute(sql`DELETE FROM subscription_controlled_journal_heads`)).rejects.toThrow();
  await expect(db().execute(sql`INSERT INTO subscription_controlled_row_hashes(table_name,row_id,row_sha256,row_bytes) VALUES('subscription_controlled_resources',${randomUUID()}::uuid,${"0".repeat(64)},1)`)).rejects.toThrow();
  await expect(db().execute(sql`UPDATE subscription_controlled_row_hashes SET row_bytes=row_bytes+1`)).rejects.toThrow();
  await expect(db().execute(sql`DELETE FROM subscription_controlled_row_hashes`)).rejects.toThrow();
 });
});
