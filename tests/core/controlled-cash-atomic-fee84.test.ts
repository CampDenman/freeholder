// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: strict source/signature controls, not SQL/native acceptance.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { z } from "zod";
import { controlledCashBatchBody } from "@/modules/invoicing/controlled-cash-application-protocol-proof";
import { CONTROLLED_CASH_ATOMIC_PROTOCOL,CONTROLLED_CASH_LEGACY_PROTOCOL,isControlledCashApplicationProtocol } from "@/modules/invoicing/controlled-cash-application-protocol";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { signOriginalCashRecovery,verifyOriginalCashRecovery } from "@/modules/invoicing/original-cash-recovery-proof";
const read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),"utf8"),owned=read("deploy/controlled-cash-atomic-fee84.fragment.sql");
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
function body(name:string){const start=owned.indexOf(`FUNCTION ${name}(`),as=owned.indexOf("AS $$",start),end=owned.indexOf("$$;",as);if(start<0||as<0||end<0)throw Error("Missing actual complete source body");return owned.slice(as+5,end);}
function statement(name:string){const start=owned.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`),end=owned.indexOf("$$;",owned.indexOf("AS $$",start));if(start<0||end<0)throw Error("Missing versioned complete replacement");return owned.slice(start,end+3);}
function batch(protocol:string):Parameters<typeof controlledCashBatchBody>[0]{const id="00000000-0000-4000-8000-000000000001",sha="a".repeat(64);return{id,collectionId:id,quoteId:id,resourceId:id,subscriptionId:id,invoiceId:id,termsId:id,protocol,admissionTransactionId:"1",bankRevision:sha,parentRevision:sha,parentPgRevision:sha,preApplicationRevision:sha,acceptedQuoteDigest:sha,canonicalTargetDigest:sha,beforeEntries:[{table:"invoices",id,fingerprint:sha,hashDomain:"postgres_row"}],mutableBeforeRows:[],requestedReceiptIds:[id],rawBindings:[],invoiceBeforeFingerprint:sha,invoiceBeforeStatus:"sent",invoiceBeforePaidMinor:0,invoiceBeforeCreditedMinor:0,invoiceBeforeRefundedMinor:0,invoiceBeforePaidAt:null,invoiceBeforeUpdatedAt:"2026-11-13 00:00:00.000001+00",expectedCashMinor:4200,expectedFeeMinor:400,currency:"CAD",createdAt:new Date("2026-11-13T00:00:00Z")};}
describe("distinct signed atomic application policy",()=>{
 it("binds each version into the unchanged authentic batch purpose and refuses a copied old signature",()=>{
  const key="prepared-explicit-HMAC-key",original=batch(CONTROLLED_CASH_LEGACY_PROTOCOL),digest=merchantTaxDigest(controlledCashBatchBody(original));
  const signed={...original,digest,authentication:signOriginalCashRecovery("controlled_cash_application_batch.v1",{...original,digest},key)};
  expect(verifyOriginalCashRecovery("controlled_cash_application_batch.v1",signed,controlledCashBatchBody(original),[key])).toBe(true);
  expect(verifyOriginalCashRecovery("controlled_cash_application_batch.v1",signed,controlledCashBatchBody({...original,protocol:CONTROLLED_CASH_ATOMIC_PROTOCOL}),[key])).toBe(false);
  const atomic=batch(CONTROLLED_CASH_ATOMIC_PROTOCOL),atomicDigest=merchantTaxDigest(controlledCashBatchBody(atomic)),actual={...atomic,digest:atomicDigest,authentication:signOriginalCashRecovery("controlled_cash_application_batch.v1",{...atomic,digest:atomicDigest},key)};
  expect(verifyOriginalCashRecovery("controlled_cash_application_batch.v1",actual,controlledCashBatchBody(atomic),["rotated",key])).toBe(true);
  expect(verifyOriginalCashRecovery("controlled_cash_application_batch.v1",actual,controlledCashBatchBody({...atomic,expectedFeeMinor:399}),[key])).toBe(false);
  expect(isControlledCashApplicationProtocol("controlled_cash_atomic.v2")).toBe(false);expect(isControlledCashApplicationProtocol(CONTROLLED_CASH_LEGACY_PROTOCOL)).toBe(true);
 });
 it("keeps target v1 and legacy exported readers strict while only the internal batch path observes actual per-charge fees",()=>{
  const bank=read("src/modules/subscriptions/controlled-provider-collection-cash.ts"),context=read("src/modules/invoicing/controlled-cash-prospective-context.ts");
  expect(bank).toContain("return readControlledCollectionCash(ctx,input,false)");expect(bank).toContain("return readControlledCollectionCash(ctx,input,true)");expect(bank).toContain("protocol:CONTROLLED_COLLECTION_PROTOCOL");
  expect(bank).toContain("sqlBank.current_evidence.fee?.amountMinor??0");expect(bank).toContain("controlledCashBankApplicationEvidence(originalExpectation,facts.evidence)");expect(bank).toContain("controlledAtomicFeeAmounts(");expect(context).toContain("readControlledAtomicCollectionCashAuthority(ctx,request)");expect(context).not.toContain("atomic:");
 });
 it("retains legacy per-prefix floors and applies the final endpoint to every whole batch",()=>{
  const sql=body("freeholder_controlled_cash_receipts_complete");expect(sql).toContain("admitted_batch.protocol='controlled_net_gross.v1' AND receipt_record.fee_minor::numeric IS DISTINCT FROM floor(");
  expect(sql).toContain("original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal)");expect(sql).toContain("receipt_record.prior_cash_minor::numeric IS DISTINCT FROM original_paid");expect(sql).toContain("receipt_record.prior_allocated_fee_minor::numeric IS DISTINCT FROM original_fee");
  expect(body("freeholder_controlled_cash_atomic_fee_valid")).toContain("batch_record.protocol IS DISTINCT FROM 'controlled_cash_atomic.v1'");expect(body("freeholder_controlled_cash_atomic_fee_valid")).toContain("current_stage=freeholder_controlled_cash_stage(");
 });
 it("pins every new policy body as well as the old full route guards and enabled triggers before admission",()=>{
  const ready=body("freeholder_controlled_subscription_route_ready");
  for(const name of ["freeholder_controlled_cash_guard_batch","freeholder_controlled_cash_guard_receipt","freeholder_controlled_cash_receipts_complete","freeholder_controlled_cash_before_settlement","freeholder_controlled_cash_stage","freeholder_controlled_cash_application_shape","freeholder_controlled_cash_atomic_fee_valid","freeholder_controlled_subscription_route_valid","guard_merchant_agreement_payment_route","freeholder_guard_agreement_fee"])expect(ready).toContain(hash(body(name)));
  expect(ready).toContain("t.tgname='merchant_agreement_payment_route_guard'");expect(ready).toContain("t.tgname='subscription_controlled_agreement_route_guard'");expect(ready).toContain("t.tgenabled IN('O','A')");
 });
 it("preserves every old agreement-fee branch and actual alias correction while narrowing only exact staged fee selection",()=>{
  const fee=body("freeholder_guard_agreement_fee");for(const family of ["agreement_fee_duties","agreement_fee_credit_assignments","agreement_fee_cash_assignments","agreement_fee_eligibility","agreement_fee_remittances"])expect(fee).toContain(`TG_TABLE_NAME='${family}'`);
  expect(fee).toContain("jsonb_agg(eligible_payment.id::text ORDER BY eligible_payment.id)");expect(fee).toContain("q.refunded_minor<>0");expect(fee).toContain("freeholder_original_payment_fee(p.id) IS DISTINCT FROM NEW.fee_obligation_minor");expect(fee).toContain("freeholder_controlled_cash_atomic_fee_valid(p.id,NEW.fee_obligation_minor,prior_cash,prior_fee)");
 });
 it("reconstructs every exact original full function from the declared finite deltas instead of silently dropping older guards",()=>{
  const sha=z.string().regex(/^[a-f0-9]{64}$/),manifest=z.object({status:z.literal("SOURCE_ONLY_PREPARED_UNRUN"),replacementSha256:sha,functions:z.array(z.object({name:z.string().regex(/^[a-z0-9_]+$/),beforeStatementSha256:sha,afterStatementSha256:sha,originalCreateOrReplace:z.boolean().optional(),changes:z.union([z.string(),z.array(z.object({before:z.string(),after:z.string()}).strict())])}).passthrough())}).passthrough().parse(JSON.parse(read("deploy/controlled-cash-atomic-fee84.manifest.json")));
  expect(hash(owned)).toBe(manifest.replacementSha256);
  for(const row of manifest.functions){const current=statement(row.name);expect(hash(current)).toBe(row.afterStatementSha256);
   if(typeof row.changes==="string"){expect(row.name).toBe("freeholder_controlled_subscription_route_ready");continue;}
   let original=current;for(const delta of [...row.changes].reverse()){expect(original.split(delta.after)).toHaveLength(2);original=original.replace(delta.after,delta.before);}
   if(row.originalCreateOrReplace===false)original=original.replace("CREATE OR REPLACE FUNCTION","CREATE FUNCTION");expect(hash(original)).toBe(row.beforeStatementSha256);
  }
 });
});
