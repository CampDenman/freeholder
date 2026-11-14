// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: real SQL correlation controls, not provider/money acceptance.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/core/db";
import { merchantFeeRefunds } from "@/modules/invoicing/merchant-collection-schema";
import { merchantFeeObservationMatchesRefund } from "@/modules/invoicing/merchant-fee-observation-match";

const query = () => drizzle.mock().select({
  unmatched: sql<boolean>`coalesce(bool_or(${merchantFeeRefunds.status}='accepted' and not ${merchantFeeObservationMatchesRefund()}),false)`,
}).from(merchantFeeRefunds).toSQL();

it("preserves outer refund identity through the real single-table SQL compiler", () => {
  const actual = query();
  expect(actual.params).toEqual([]);
  for (const name of ["id", "provider_ref", "amount_minor", "currency", "application_fee_ref"]) {
    expect(actual.sql).toContain(`"merchant_fee_refunds"."${name}"`);
  }
  expect(actual.sql).not.toContain('a.operation_id="id"');
});

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("actual correlated fee acknowledgement SQL", () => {
  afterAll(closeDb);
  it("retains debt when no acknowledgement exists", async () => {
    const statement = `with merchant_fee_refunds(id,provider_ref,amount_minor,currency,application_fee_ref,status) as
      (values(1,'fr_original',1,'CAD','fee_original','accepted')),
      merchant_fee_observations(id,operation_id,provider_ref,application_fee_ref,amount_minor,currency,binding_verified) as
      (select 2,1,'fr_original','fee_original',1,'CAD',true where false) ${query().sql}`;
    const [actual] = await db().execute<{ unmatched: boolean }>(sql.raw(statement));
    expect(actual?.unmatched).toBe(true);
  });
  it.each([
    ["exact acknowledgement with its own distinct UUID", "'fr_original'", "'fee_original'", "1", "'CAD'", "true", "1", false],
    ["unrelated operation", "'fr_original'", "'fee_original'", "1", "'CAD'", "true", "3", true],
    ["other provider return", "'fr_other'", "'fee_original'", "1", "'CAD'", "true", "1", true],
    ["other original fee", "'fr_original'", "'fee_other'", "1", "'CAD'", "true", "1", true],
    ["other amount", "'fr_original'", "'fee_original'", "2", "'CAD'", "true", "1", true],
    ["other currency", "'fr_original'", "'fee_original'", "1", "'USD'", "true", "1", true],
    ["unverified acknowledgement", "'fr_original'", "'fee_original'", "1", "'CAD'", "false", "1", true],
  ] as const)("retains debt correctly for %s", async (_label, providerRef, feeRef, amount, currency, verified, operationId, expected) => {
    // Immutable local CTE fixtures shadow these names only in this SELECT.
    // No business row, caller, bank fact, schema or sequence is written.
    const statement = `with merchant_fee_refunds(id,provider_ref,amount_minor,currency,application_fee_ref,status) as
      (values(1,'fr_original',1,'CAD','fee_original','accepted')),
      merchant_fee_observations(id,operation_id,provider_ref,application_fee_ref,amount_minor,currency,binding_verified) as
      (values(2,${operationId},${providerRef},${feeRef},${amount},${currency},${verified})) ${query().sql}`;
    const [actual] = await db().execute<{ unmatched: boolean }>(sql.raw(statement));
    expect(actual?.unmatched).toBe(expected);
  });
});
