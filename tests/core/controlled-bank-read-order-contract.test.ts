// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN source integrity; not a native/cryptographic bank acceptance.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const old=readFileSync(new URL("../../deploy/subscription-controlled-current-bank82.fragment.sql",import.meta.url),"utf8");
const next=readFileSync(new URL("../../deploy/controlled-bank-read-order84.fragment.sql",import.meta.url),"utf8");
describe("actual controlled read-order source boundary",()=>{
 it("preserves the exact frozen complete old financial fragment",()=>{
  expect(createHash("sha256").update(old).digest("hex")).toBe("b4b4c082356b0da4364c3ea46ef1314b040cdf3472bcd3c6f0ae9ce08198b28e");
 });
 it("uses only authentic admission lineage rather than transaction-start time or UUID order",()=>{
  expect(next).toContain("inspection.id=freeholder_controlled_cash_read_latest(receipt_row.id)");expect(next).not.toContain("ORDER BY inspection.created_at");expect(next).not.toContain("ORDER BY inspection.id");
  expect(next).toContain("actual_lineage.admission_fingerprint=encode(sha256(convert_to(to_jsonb(inspection_row)::text,'UTF8')),'hex')");expect(next).toContain("actual_lineage.resource_id=resource_row.id AND actual_lineage.receipt_id=receipt_row.id");
 });
 it("retains complete original bank/receipt/credit/raw/refund/fee/recipient predicates around the one changed selector",()=>{
  const start=old.indexOf("CREATE FUNCTION freeholder_controlled_receipt_bank_observation("),end=old.indexOf("\n--> statement-breakpoint",start),original=old.slice(start,end);
  const originalStart=original.indexOf(" -- Latest namespace admission,"),originalEnd=original.indexOf("\n",original.indexOf("  ORDER BY inspection.created_at DESC,inspection.id DESC LIMIT 1;",originalStart));
  const changedStart=next.indexOf(" -- Real namespace-locked admission sequence"),changedEnd=next.indexOf(" THEN RETURN;END IF;",changedStart)+" THEN RETURN;END IF;".length;
  const reconstructed=(next.slice(next.indexOf("CREATE OR REPLACE FUNCTION"),changedStart)+original.slice(originalStart,originalEnd)+next.slice(changedEnd)).trimEnd()
   .replace("CREATE OR REPLACE FUNCTION","CREATE FUNCTION")
   .replace("\n  'actualAdmissionLineage',(SELECT to_jsonb(actual_lineage) FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id),","")
   .replace("\n  UNION ALL SELECT 'subscription_controlled_cash_inspection_lineages',actual_lineage.inspection_id::text,encode(sha256(convert_to(to_jsonb(actual_lineage)::text,'UTF8')),'hex') FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id IN(SELECT id FROM namespace_inspections)","");
  expect(reconstructed).toBe(original.trimEnd());
 });
 it("includes actual lineage in BOTH immutable bank identity and complete current5000 witness",()=>{
  expect(next).toContain("'actualAdmissionLineage',(SELECT to_jsonb(actual_lineage)");expect(next).toContain("UNION ALL SELECT 'subscription_controlled_cash_inspection_lineages'");expect(next).toContain("IF witness_count>5000 THEN RETURN;END IF;");
  const parent=readFileSync(new URL("../../src/modules/invoicing/controlled-cash-observation-parent.ts",import.meta.url),"utf8");expect(parent).toContain("controlledCashInspectionLineageWitness(ctx.tx,{paymentIds:");expect(parent).toContain("...lineages.entries,...extra");
 });
});
