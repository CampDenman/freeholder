// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN real SQL boundary controls; not native paid-effect acceptance.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { closeDb, hasDatabase } from "../helpers/spine";
import { periodEnd } from "@/modules/subscriptions/calendar";
describe.runIf(hasDatabase)("installed independent paid-effect SQL boundary155", () => {
  afterAll(closeDb);
  it("refuses an unknown effect without borrowing a previous cash transaction", async () => {
    expect((await db().execute<{ valid: boolean }>(sql`select freeholder_controlled_paid_period_source(${randomUUID()}::uuid) as valid`))[0]?.valid).toBe(false);
  });
  it("requires the actual deferred completion guard as well as all immediate guards", async () => {
    expect((await db().execute<{ ready: boolean }>(sql`select freeholder_controlled_paid_period_ready() as ready`))[0]?.ready).toBe(true);
    const rollback = new Error("restore actual completion trigger by rollback");
    await expect(db().transaction(async tx => {
      await tx.execute(sql`alter table subscription_controlled_paid_period_receipts disable trigger subscription_controlled_paid_period_complete`);
      expect((await tx.execute<{ ready: boolean }>(sql`select freeholder_controlled_paid_period_ready() as ready`))[0]?.ready).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await db().execute<{ ready: boolean }>(sql`select freeholder_controlled_paid_period_ready() as ready`))[0]?.ready).toBe(true);
  });
  it.each([
    { start: "2024-02-29T12:34:56.123Z", interval: "year" as const, count: 1 },
    { start: "2024-01-31T12:34:56.123Z", interval: "month" as const, count: 1 },
    { start: "2026-03-08T09:59:59.123Z", interval: "day" as const, count: 1 },
    { start: "2026-12-31T12:34:56.123Z", interval: "week" as const, count: 2 },
  ])("preserves the exact accepted canonical UTC calendar %j, including existing leap-year rollover", async ({ start, interval, count }) => {
    const [row] = await db().execute<{ ending: string }>(sql`select to_char(freeholder_controlled_paid_period_end(${start}::timestamptz,${JSON.stringify({ interval, intervalCount: count })}::jsonb) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ending`);
    expect(row?.ending).toBe(periodEnd(new Date(start), interval, count).toISOString());
  });
});
