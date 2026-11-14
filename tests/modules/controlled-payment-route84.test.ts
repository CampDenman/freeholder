// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Legacy-body conservation and actual SQL capability boundary.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { closeDb, hasDatabase } from "../helpers/spine";

const original = readFileSync("deploy/subscription-agreement-fee80.fragment.sql", "utf8");
const continuation = readFileSync("deploy/subscription-controlled-payment-route84.fragment.sql", "utf8");
function guard(source: string) {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION guard_merchant_agreement_payment_route()");
  return source.slice(start, source.indexOf("$$;", source.indexOf("AS $$", start)) + 3);
}
describe("controlled route preserves the complete historical guard", () => {
  it("changes only the gross attempt condition, retaining every historical body byte outside the exact verified controlled-origin alternative", () => {
    expect(guard(continuation).replace("(NEW.origin_kind<>'attempt' AND NOT freeholder_controlled_subscription_route_valid(to_jsonb(NEW)))", "NEW.origin_kind<>'attempt'")).toBe(guard(original));
  });
});

describe.runIf(hasDatabase)("genuine installed controlled route SQL boundaries (not native application acceptance)", () => {
  afterAll(closeDb);
  it("requires the exact enabled full historical and controlled BEFORE guards", async () => {
    const [installed] = await db().execute<{ ready: boolean }>(sql`select freeholder_controlled_subscription_route_ready() as ready`);
    expect(installed?.ready).toBe(true);
    const rollback = new Error("restore exact trigger state by transaction rollback");
    await expect(db().transaction(async tx => {
      await tx.execute(sql`alter table merchant_agreement_payment_routes disable trigger subscription_controlled_agreement_route_guard`);
      const [disabled] = await tx.execute<{ ready: boolean }>(sql`select freeholder_controlled_subscription_route_ready() as ready`);
      expect(disabled?.ready).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await db().execute<{ ready: boolean }>(sql`select freeholder_controlled_subscription_route_ready() as ready`))[0]?.ready).toBe(true);
  });
  it("refuses a legacy scalar marker and a new pointer with no real batch/receipt/link, without creating money", async () => {
    await db().transaction(async tx => {
      const [before] = await tx.execute<{ count: string }>(sql`select count(*)::text as count from payments`);
      await tx.execute(sql`select set_config('freeholder.controlled_cash_application_v1',${JSON.stringify({collectionId:randomUUID(),receiptId:randomUUID(),revision:'a'.repeat(64)})},true)`);
      await tx.execute(sql`select set_config('freeholder.controlled_cash_application_batch_v1','',true)`);
      expect((await tx.execute<{ valid: boolean }>(sql`select freeholder_controlled_subscription_route_valid('{}'::jsonb) as valid`))[0]?.valid).toBe(false);
      const pointer = { batchId: randomUUID(), collectionId: randomUUID(), receiptId: randomUUID(), admissionDigest: "a".repeat(64) };
      await tx.execute(sql`select set_config('freeholder.controlled_cash_application_batch_v1',${JSON.stringify(pointer)},true)`);
      expect((await tx.execute<{ valid: boolean }>(sql`select freeholder_controlled_subscription_route_valid('{}'::jsonb) as valid`))[0]?.valid).toBe(false);
      expect((await tx.execute<{ count: string }>(sql`select count(*)::text as count from payments`))[0]?.count).toBe(before?.count);
    });
  });
});
