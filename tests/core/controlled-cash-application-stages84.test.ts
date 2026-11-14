// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN source integrity; no SQL/native acceptance is claimed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),source=read("deploy/controlled-cash-application-stages84.fragment.sql");
describe("exact staged controlled cash source boundaries",()=>{
 it("preserves the signed admission foundation and all original route/period guard bodies",()=>{
  expect(createHash("sha256").update(read("deploy/controlled-cash-application-protocol84.fragment.sql")).digest("hex")).toBe("d6e08c2703ab087343c452d525d438ac18b160bb70d81a875f73cbbc579286fb");
  expect(source.match(/CREATE OR REPLACE FUNCTION\s+(\w+)/g)).toEqual(["CREATE OR REPLACE FUNCTION freeholder_controlled_cash_link_created_payment"]);
  expect(source).not.toContain("CREATE FUNCTION guard_merchant_agreement_payment_route");expect(source).not.toContain("freeholder_subscription_period_cash_application");
 });
 it("compares each genuinely new current row against the OUTER current set, retaining all unowned raw/caller/source rows",()=>{
  expect(source).toContain("original_rows.value->>'table'=current_rows.value->>'table'");expect(source).toContain("original_rows.value->>'id'=current_rows.value->>'id'");
  expect(source).toContain("ELSE RAISE EXCEPTION 'Every other new raw/financial/privacy/caller row stays effective");expect(source).toContain("final_snapshot->'entries' IS DISTINCT FROM normalized_parent->'currentEntries'");
  expect(source).not.toContain("current_setting(");expect(source).not.toContain("set_config(");
 });
 it("checks actual held prefix and real earlier allocations before money mutation without reverse lock acquisition",()=>{
  expect(source).toContain("actual_lock.pid=pg_backend_pid()");expect(source).toContain("'credit-note:'||actual_id::text");expect(source).toContain("'subscription-cash:'");expect(source).not.toContain("pg_advisory_xact_lock(");
  expect(source).toContain("prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric");expect(source).toContain("ORDER BY installment_row.due_at,installment_row.position");expect(source).toContain("allocation_sum IS DISTINCT FROM expected_allocation");
 });
 it("keeps actual whole-batch deferred conservation and real HMAC authentication separate from permission",()=>{
  for(const name of["controlled_cash_batch_complete","controlled_cash_receipt_complete","controlled_cash_link_complete","controlled_cash_payment_complete","controlled_cash_invoice_complete"])expect(source).toContain(`CREATE CONSTRAINT TRIGGER ${name}`);
  expect(source.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(5);expect(source).toContain("PERFORM freeholder_controlled_cash_stage(batch_uuid,null,null)");
  const consumer=read("src/modules/invoicing/controlled-cash-application-stage.ts");expect(consumer).toContain("verifiedControlledCashBatch(batch)");expect(consumer).toContain("verifiedControlledCashReceipt(row)");expect(consumer).toContain("latestControlledCashInspectionLineage(ctx.tx");expect(consumer).toContain("suppliesApplicationAuthority:false");expect(consumer).not.toContain("defineService(");expect(consumer).not.toContain("getService(");
 });
});
