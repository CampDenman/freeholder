// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Pure retained-result selection, never native/HMAC acceptance.
import { describe,expect,it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { readControlledCollectionInventory,originalBootstrapZeroInvoice,type ControlledCollectionInventorySource } from "@/modules/subscriptions/controlled-provider-collection-inventory";
function fixture(){
 const invoice={id:"in_originalZero",total:0,amount_paid:0,amount_remaining:0,status:"paid",auto_advance:false,amount_due:0,starting_balance:0,ending_balance:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0};
 const source:ControlledCollectionInventorySource={resource:{id:"resource",originalScope:{providerCustomerRef:"cus_original",currency:"CAD"}},canonical:{count:5},history:{count:20,unfinished:[],closures:[],
  operations:[{id:"bootstrapRead",kind:"read_bootstrap",ordinal:3,originalRequest:{payload:{}}},{id:"list",kind:"list_invoices",ordinal:10,originalRequest:{payload:{}}},{id:"read",kind:"read_invoice",ordinal:11,originalRequest:{payload:{providerInvoiceRef:invoice.id}}}],
  calls:[{id:"caller",operationId:"read"}],facts:[{callId:"caller",actual:{kind:"invoice_read",raw:invoice}}],
  verifications:[{operationId:"bootstrapRead",actualResultDigest:"a".repeat(64),actualResult:{completeZeroRecurringItem:true,providerSubscriptionRef:"sub_original",providerInvoiceRef:invoice.id}},
   {operationId:"list",actualResultDigest:"b".repeat(64),actualResult:{complete:true,providerSubscriptionRef:"sub_original",providerInvoiceRefs:[invoice.id],actualInvoices:[invoice]}},
   {operationId:"read",actualResultDigest:"c".repeat(64),actualResult:{providerInvoiceRef:invoice.id,providerSubscriptionRef:"sub_original",providerCustomerRef:"cus_original",currency:"CAD",status:"paid",totalMinor:0,paidMinor:0,remainingMinor:0,autoAdvance:false,completePayments:true,completeLines:true,actualCash:[],actualPayments:[],actualIntents:[],actualLines:[{amount:0}],actualPrices:[{unit_amount:0}],actualInvoice:invoice,suppliesPaidAuthority:false}}]}};
 return{source,invoice};
}
describe("complete causally admitted collection inventory",()=>{
 it("binds the complete list and each actual independent invoice read without claiming financial authority",()=>{const f=fixture(),actual=readControlledCollectionInventory(f.source,9);expect(actual.reads.map(row=>row.operation.id)).toEqual(["read"]);expect(actual).not.toHaveProperty("allowed");expect(actual).not.toHaveProperty("principalSafe");});
 it("refuses an older inventory after a newly admitted bank writer",()=>{const f=fixture();expect(()=>readControlledCollectionInventory(f.source,10)).toThrow();});
 it("refuses a newer complete list without the new corresponding invoice read",()=>{const f=fixture();f.source.history.operations.push({id:"laterList",kind:"list_invoices",ordinal:12,originalRequest:{payload:{}}});f.source.history.verifications.push({...f.source.history.verifications[1]!,operationId:"laterList"});expect(()=>readControlledCollectionInventory(f.source)).toThrow();});
 it("never releases an unfinished original caller through later successful GET results",()=>{const f=fixture();f.source.history.unfinished.push({id:"actual-original-caller"});expect(()=>readControlledCollectionInventory(f.source)).toThrow();});
 it("requires every actual list occurrence exactly once",()=>{const f=fixture();f.source.history.verifications[1]!.actualResult.providerInvoiceRefs=["in_originalZero","in_missingActual"];expect(()=>readControlledCollectionInventory(f.source)).toThrow();});
 it("refuses a returned body without its exact authentic retained raw invoice occurrence",()=>{const f=fixture();f.source.history.facts=[];expect(()=>readControlledCollectionInventory(f.source)).toThrow();});
 it("recognizes only the real original bootstrap invoice as harmless zero preparation",()=>{const f=fixture(),actual=readControlledCollectionInventory(f.source);expect(originalBootstrapZeroInvoice(f.source,actual.reads[0]!,12)).toBe(true);actual.reads[0]!.providerInvoiceRef="in_sameAmountOther";expect(originalBootstrapZeroInvoice(f.source,actual.reads[0]!,12)).toBe(false);});
 it("retains contradictory positive original money instead of treating a zero-price calendar as no cash",()=>{const f=fixture();f.invoice.total=500;f.invoice.amount_paid=500;const row=f.source.history.verifications[2]!;row.actualResult.totalMinor=500;row.actualResult.paidMinor=500;row.actualResult.actualCash=[{providerPaymentIntentRef:"pi_actual",amountMinor:500}];row.actualResultDigest=merchantTaxDigest(row.actualResult);const actual=readControlledCollectionInventory(f.source);expect(actual.reads[0]!.actual.actualCash).toHaveLength(1);expect(originalBootstrapZeroInvoice(f.source,actual.reads[0]!,12)).toBe(false);});
 it("uses one complete aggregate bound rather than independent per-array limits",()=>{const f=fixture();f.source.history.count=4995;expect(()=>readControlledCollectionInventory(f.source)).toThrow();});
});
