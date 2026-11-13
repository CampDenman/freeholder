// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Genuine Ed25519 caller vectors; no DB financial rows are minted.
import { randomUUID } from "node:crypto";
import { describe,it,expect } from "vitest";
import type { MerchantControlledObservation } from "@/adapters/payments";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { CONTROLLED_CALL_PURPOSE,originalControlledCall,finishedControlledCall } from "@/modules/subscriptions/controlled-provider-proof";
import type { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import type { subscriptionControlledOperations,subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { signProviderReadProof } from "@/modules/subscriptions/provider-read-signatures";
import { controlledRawFinancialReview } from "@/modules/subscriptions/controlled-provider-raw-financial-review";
type Journal=Awaited<ReturnType<typeof controlledProviderJournal>>;
function source(){
 const id=randomUUID(),subscriptionId=randomUUID(),termsId=randomUUID();
 const resource={id,subscriptionId,termsId,generation:1,originalSourceRevision:"a".repeat(64),createdAt:new Date(),originalScope:{providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:"acct_originalPlatform",
  subscriptionId,termsId,generation:1,providerCustomerRef:"cus_originalBuyer",providerMethodRef:"pm_originalMethod",providerProductRef:"prod_originalZero",currency:"CAD",interval:"month",intervalCount:1,
  acceptedPeriodEnd:"2026-12-01T00:00:00.000Z",acceptedTrialEnd:null}} satisfies typeof subscriptionControlledResources.$inferSelect;
 const history:Journal={operations:[],calls:[],facts:[],finishes:[],stops:[],verifications:[],chargeOrigins:[],closures:[],unfinished:[],count:1,revision:"0".repeat(64)};
 history.revision=merchantTaxDigest({operations:[],calls:[],facts:[],finishes:[],stops:[],verifications:[],chargeOrigins:[],closures:[]});
 function append(kind:typeof subscriptionControlledOperations.$inferSelect["kind"],actual?:MerchantControlledObservation,options:{payload?:Record<string,unknown>;unfinished?:boolean}={}){
  const originalRequest={scopeDigest:merchantTaxDigest(resource.originalScope),payload:options.payload??{},parentFinancialRevision:"b".repeat(64)},operation={id:randomUUID(),resourceId:id,kind,ordinal:history.operations.length+1,
   originalRequest,requestDigest:merchantTaxDigest(originalRequest),idempotencyKey:`original-raw-control:${randomUUID()}`,previousEvidenceRevision:history.revision,acceptedQuoteDigest:"c".repeat(64),createdAt:new Date()};
  const callId=randomUUID(),caller=merchantPhysicalCaller(),admission=signProviderReadProof("admission",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:id,kind,callId,requestDigest:operation.requestDigest,callerId:caller.id,caller,completionDigest:"d".repeat(64),admittedSourceRevision:operation.previousEvidenceRevision});
  const call={id:callId,operationId:operation.id,admission,admissionDigest:merchantTaxDigest(admission),createdAt:new Date()};
  expect(originalControlledCall(operation,call)).not.toBeNull();history.operations.push(operation);history.calls.push(call);
  const fact=actual?{id:randomUUID(),callId,ordinal:1,actual,actualDigest:merchantTaxDigest(actual),createdAt:new Date()}:null;if(fact)history.facts.push(fact);
  if(options.unfinished)history.unfinished.push(callId);else{
   const actualResult={outcome:"returned",result:{rawVector:true}},proof=signProviderReadProof("finish",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:id,callId,requestDigest:operation.requestDigest,
    admissionDigest:call.admissionDigest,callerId:caller.id,completionDigest:"d".repeat(64),outcome:"returned",factsDigest:merchantTaxDigest(actualResult)});
   const finish={callId,proof,proofDigest:merchantTaxDigest(proof),actualResult,createdAt:new Date()};expect(finishedControlledCall(operation,call,finish)).toBe(true);history.finishes.push(finish);
  }
  history.count=1+history.operations.length+history.calls.length+history.facts.length+history.finishes.length+history.stops.length+history.verifications.length+history.chargeOrigins.length+history.closures.length;
  history.revision=merchantTaxDigest({operations:history.operations,calls:history.calls,facts:history.facts,finishes:history.finishes,stops:history.stops,verifications:history.verifications,chargeOrigins:history.chargeOrigins,closures:history.closures});
  return{operation,call,fact};
 }
 const bootstrap=append("bootstrap");
 const metadata={freeholder_controlled_subscription_version:"1",freeholder_subscription_id:subscriptionId,freeholder_subscription_terms_id:termsId,freeholder_controlled_generation:"1",freeholder_platform_account_id:resource.originalScope.providerPlatformAccountId,
  freeholder_bootstrap_operation_id:bootstrap.operation.id,freeholder_bootstrap_request_digest:bootstrap.operation.requestDigest};
 return{resource,history,append,bootstrap,metadata,review:()=>controlledRawFinancialReview(resource,history)};
}
describe("authenticated zero-transport raw financial review",()=>{
 it("retains positive intent debt even when cash_observed and its canonical bridge never existed",()=>{const s=source(),actual=s.append("read_invoice",{kind:"intent_read",raw:{id:"pi_originalPositive",customer:s.resource.originalScope.providerCustomerRef,amount:500,amount_received:500,amount_capturable:0,currency:"cad",status:"succeeded"}},{payload:{providerInvoiceRef:"in_original"}});
  expect(s.review().rawPositiveFactIds).toEqual([actual.fact!.id]);expect(s.review().facts[0]).toMatchObject({providerIntentRefs:["pi_originalPositive"],providerInvoiceRefs:["in_original"],reportedPositiveMoney:true});
 });
 it("retains actual invoice-paid evidence before PI enumeration or owner interpretation can fail",()=>{const s=source(),actual=s.append("read_invoice",{kind:"invoice_read",raw:{id:"in_original",status:"paid",total:500,amount_paid:500,amount_remaining:0}});
  expect(s.review().rawPositiveFactIds).toEqual([actual.fact!.id]);expect(s.review().facts[0]!.reasons).toContain("positive_invoice");
 });
 it("holds nonzero unpaid invoice and pending PI without inventing received money",()=>{const s=source();s.append("read_invoice",{kind:"invoice_read",raw:{id:"in_original",status:"open",total:500,amount_paid:0,amount_remaining:500}});
  s.append("read_invoice",{kind:"intent_read",raw:{id:"pi_pending",status:"processing",amount:500,amount_received:0,amount_capturable:0}});
  expect(s.review().rawPositiveFactIds).toHaveLength(0);expect(s.review().unsettledFactIds).toHaveLength(2);
 });
 it("ignores nonpayable preview amounts and static product/price values as cash",()=>{const s=source();s.append("preview_proration",{kind:"proration_preview",raw:{id:"upcoming_in_estimate",status:"paid",amount_paid:500,total:500,lines:{data:[{amount:500}]}}});s.append("read_invoice",{kind:"price_read",raw:{id:"price_static",unit_amount:500}});
  expect(s.review().facts).toEqual([]);
 });
 it("discovers genuine original-bootstrap financial facts after a lost ACK and excludes unrelated subscriptions in the same customer list",()=>{const s=source();const original={id:"sub_originalDiscovered",customer:{id:s.resource.originalScope.providerCustomerRef},metadata:s.metadata,latest_invoice:{id:"in_originalDiscovered",total:500,amount_paid:0,amount_remaining:500},items:{data:[{price:{unit_amount:500,unit_amount_decimal:"500"}}]}};
  const unrelated={...original,id:"sub_other",metadata:{freeholder_bootstrap_operation_id:randomUUID()},latest_invoice:{id:"in_otherPaid",total:500,amount_paid:500,amount_remaining:0}};
  const actual=s.append("discover_bootstrap",{kind:"subscription_list_read",raw:{data:[unrelated,original],has_more:false}},{payload:{bootstrapOperationId:s.bootstrap.operation.id,bootstrapRequestDigest:s.bootstrap.operation.requestDigest}});
  expect(s.review().factIds).toEqual([actual.fact!.id]);expect(s.review().rawPositiveFactIds).toEqual([]);expect(s.review().facts[0]!.providerInvoiceRefs).toEqual(["in_originalDiscovered"]);
 });
 it("refuses a conflicting same original nonce/customer/generation claim instead of choosing equal amounts",()=>{const s=source();s.append("discover_bootstrap",{kind:"subscription_list_read",raw:{data:[{id:"sub_claim",customer:"cus_other",metadata:{...s.metadata,freeholder_controlled_generation:"2"},latest_invoice:{id:"in_claim",total:500,amount_paid:500,amount_remaining:0}}]}},{payload:{bootstrapOperationId:s.bootstrap.operation.id,bootstrapRequestDigest:s.bootstrap.operation.requestDigest}});
  expect(s.review().facts[0]!.reasons).toContain("discovery_ancestry");expect(s.review().rawPositiveFactIds).toHaveLength(1);
 });
 it("holds a real nonzero recurring bootstrap even if its current invoice is zero",()=>{const s=source();s.append("read_bootstrap",{kind:"subscription_read",raw:{id:"sub_original",metadata:s.metadata,customer:s.resource.originalScope.providerCustomerRef,latest_invoice:{id:"in_zero",total:0,amount_paid:0,amount_remaining:0},items:{data:[{price:{unit_amount:500,unit_amount_decimal:"500"}}]}}});
  expect(s.review().rawPositiveFactIds).toEqual([]);expect(s.review().facts[0]!.reasons).toContain("nonzero_recurring_item");
 });
 it("never releases an older unfinished physical caller or positive occurrence through a genuinely finished later zero read",()=>{const s=source(),first=s.append("read_invoice",{kind:"intent_read",raw:{id:"pi_original",status:"succeeded",amount:500,amount_received:500}},{unfinished:true});s.append("read_invoice",{kind:"invoice_read",raw:{id:"in_later_zero",status:"paid",total:0,amount_paid:0,amount_remaining:0}});
  expect(s.review().unfinishedCallIds).toEqual([first.call.id]);expect(s.review().rawPositiveFactIds).toEqual([first.fact!.id]);
 });
});
