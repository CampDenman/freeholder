// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// Source boundary controls; actual shared-bank application remains UNRUN.
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const source=(file:string)=>readFileSync(new URL(`../../src/modules/invoicing/${file}`,import.meta.url),"utf8");
describe("explicit controlled bank consumption",()=>{
 it("uses the genuine controlled wrapper without a fake generic history projection",()=>{
  const text=source("controlled-cash-application-bank.ts");expect(text).toContain('from "./controlled-cash-inspection-current"');expect(text).toContain("currentControlledCashInspection(ctx,{collectionId:");expect(text).not.toContain("currentOriginalCashInspection");expect(text).not.toContain("current.history");
 });
 it("preserves generic legacy source-history and caller predicates",()=>{
  const text=source("merchant-cash-inspection-current.ts");expect(text).toContain("merchantRefundCashHistory");expect(text).toContain("history.digest!==inspection.sourceHistoryDigest");expect(text).toContain("!history.creatorsQuiesced");expect(text).not.toContain("currentControlledCashInspection");
 });
 it("keeps actual allocation/fee/recipient policy separate from observational permission",()=>{
  const text=source("controlled-cash-application-bank.ts");expect(text).toContain("commercialInvoiceCashHistory(ctx,canonical.invoice)");expect(text).toContain("invoiceCashFeeAllocation(ctx,canonical.invoice");expect(text).toContain("controlledCashBankApplicationEvidence(");expect(text).toContain("current.cash.applied");
 });
 it("retains complete pre-write prospective authority and exact canonical-receipt charge binding",()=>{
  const text=source("controlled-receipt-batch-application.ts");expect(text).toContain("admitControlledCashApplication(ctx,input)");expect(text).toContain("readControlledCashApplicationStage(ctx,{batchId:batch.id,receiptId:receipt.receiptId})");
  expect(text).toContain("bank.actualPaymentEvidence.providerChargeRef!==original.providerChargeRef");expect(text).toContain("original.providerChargeRef===null");expect(text).toContain("receipt.paymentEvidenceDigest");
  expect(text).toContain("paymentId:created.id");expect(text).toContain("freeholder_controlled_cash_before_settlement");expect(text).not.toContain("readControlledCashApplicationBank(ctx");expect(text).not.toContain('getService("invoicing.controlledProviderCashApplicationAuthority")');
 });
});
