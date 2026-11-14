// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: real HTTP adapter + fictional bank only; no money/DB authority.
import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import type { MerchantControlledBootstrapRequest,MerchantControlledObservation,MerchantControlledInvoiceReadRequest } from "@/adapters/payments";
import { merchantIntentEvidence } from "@/adapters/payments/stripe-merchant-scope";
import { controlledCollectionEdge84 } from "../helpers/merchant-controlled-collection84";
async function source(){
 const remote=controlledCollectionEdge84(),observed:MerchantControlledObservation[]=[],request:MerchantControlledBootstrapRequest={providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:"acct_fixturePlatform",destinationAccountId:"acct_originalSeller",settlementMerchantAccountId:"acct_originalSeller",
  subscriptionId:randomUUID(),termsId:randomUUID(),generation:1,providerCustomerRef:"cus_originalBootstrap",providerMethodRef:"pm_originalBootstrap",providerProductRef:"prod_originalBootstrap",currency:"CAD",interval:"month",intervalCount:1,acceptedPeriodEnd:"2027-01-01T00:00:00.000Z",acceptedTrialEnd:null,
  operationId:randomUUID(),requestDigest:"a".repeat(64),idempotencyKey:`prepared-original-zero:${randomUUID()}`,onObserved:async actual=>{observed.push(actual);}};
 const create=remote.provider.createMerchantControlledBootstrap?.bind(remote.provider),read=remote.provider.inspectMerchantControlledInvoice?.bind(remote.provider);if(!create||!read)throw Error("Use the actual controlled HTTP adapter methods.");
 const acknowledgment=await create(request);if(!acknowledgment.providerInvoiceRef)throw Error("The actual original fictional bootstrap invoice must exist.");
 const input:MerchantControlledInvoiceReadRequest={...request,bootstrapOperationId:request.operationId,bootstrapRequestDigest:request.requestDigest,providerSubscriptionRef:acknowledgment.providerSubscriptionRef,providerInvoiceRef:acknowledgment.providerInvoiceRef};
 return{remote,observed,request,input,read};
}
describe("complete fictional original zero bank document",()=>{
 it("retains original bootstrap method/route/tax fields through the actual adapter before any positive target exists",async()=>{
  const f=await source(),original=f.observed.find(row=>row.kind==="bootstrap_subscription")?.raw;if(!original)throw Error("Retain the actual bootstrap POST observation.");
  const actual=await f.read(f.input);expect(actual).toMatchObject({totalMinor:0,paidMinor:0,remainingMinor:0,completeLines:true,completePayments:true,suppliesPaidAuthority:false});
  for(const field of ["collection_method","default_payment_method","automatic_tax","discounts","default_tax_rates","transfer_data","on_behalf_of"])expect(actual.actualInvoice[field]).toEqual(original[field]);
  expect(actual.actualInvoice).toMatchObject({application_fee_amount:null,total_discount_amounts:[],total_taxes:[],total_tax_amounts:[],paid_out_of_band:false});expect(merchantIntentEvidence(f.input,actual.actualInvoice).merchantRouteVerified).toBe(true);
  expect(f.observed.filter(row=>row.kind==="invoice_read").map(row=>row.raw)).toContainEqual(actual.actualInvoice);expect(f.remote.counts()).toMatchObject({updatePosts:0,draftPosts:0,itemPosts:0,payPosts:0});
 });
 it("keeps the original invoice frozen when the later fictional subscription changes",async()=>{
  const f=await source(),first=await f.read(f.input),current=f.remote.currentSubscription();if(!current)throw Error("The actual original bank subscription must exist.");
  current.default_payment_method="pm_laterBankMethod";current.transfer_data={destination:"acct_laterBankSeller"};current.on_behalf_of="acct_laterBankSeller";current.automatic_tax={enabled:true};
  const later=await f.read(f.input);expect(later.actualInvoice).toEqual(first.actualInvoice);expect(merchantIntentEvidence(f.input,later.actualInvoice).merchantRouteVerified).toBe(true);expect(f.remote.counts().payPosts).toBe(0);
 });
 it("refuses a missing original bank tax field instead of inventing a known-false default",async()=>{
  const f=await source(),current=f.remote.currentSubscription();if(!current)throw Error("The actual original bank subscription must exist.");delete current.automatic_tax;
  await expect(f.read(f.input)).rejects.toThrow();expect(f.observed.some(row=>row.kind==="invoice_read")).toBe(false);expect(f.remote.counts().payPosts).toBe(0);
 });
});
