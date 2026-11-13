// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Real HTTP adapter against a fictional edge, never live provider acceptance.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantControlledBootstrapRequest, MerchantControlledSubscriptionReadRequest } from "@/adapters/payments";
function scope(){return{providerApiVersion:"2026-10-28.endive" as const,providerPlatformAccountId:"acct_originalPlatform",destinationAccountId:"acct_originalSeller",settlementMerchantAccountId:"acct_originalSeller",
 subscriptionId:randomUUID(),termsId:randomUUID(),generation:1,providerCustomerRef:"cus_originalControlled",providerMethodRef:"pm_originalControlled",providerProductRef:"prod_originalControlled",
 currency:"CAD",interval:"month" as const,intervalCount:1,acceptedPeriodEnd:"2026-12-01T00:00:00.000Z",acceptedTrialEnd:"2026-12-01T00:00:00.000Z"};}
describe("birth-safe controlled provider transport",()=>{
 it("creates only an explicit zero item with atomic default_incomplete, retaining real ACK before interpretation and never rewriting accepted trial/anchor",async()=>{
  let form:URLSearchParams|undefined;const observed:unknown[]=[];
  const fetcher=vi.fn<typeof fetch>(async(input,init={})=>{const url=new URL(input instanceof Request?input.url:input instanceof URL?input.href:input);expect(url.origin).toBe("https://stripe.example.test");
   if(url.pathname==="/v1/account")return Response.json({id:"acct_originalPlatform"});
   expect(new Headers(init.headers).get("stripe-version")).toBe("2026-10-28.endive");expect(new Headers(init.headers).has("stripe-account")).toBe(false);
   expect(url.pathname).toBe("/v1/subscriptions");expect(init.method).toBe("POST");form=new URLSearchParams(init.body as URLSearchParams);
   return Response.json({id:"sub_originalControlled",latest_invoice:"in_originalPreparation"});});
  const provider=createStripePayments({secretKey:"sk_declared_controlled_fixture",apiBase:"https://stripe.example.test",fetch:fetcher});
  const request:MerchantControlledBootstrapRequest={...scope(),operationId:randomUUID(),requestDigest:"a".repeat(64),idempotencyKey:"original-controlled-zero",onObserved:async actual=>{observed.push(actual);}};
  expect(await provider.createMerchantControlledBootstrap!(request)).toEqual({providerSubscriptionRef:"sub_originalControlled",providerInvoiceRef:"in_originalPreparation"});
  expect(form!.get("payment_behavior")).toBe("default_incomplete");expect(form!.get("items[0][price_data][unit_amount]")).toBe("0");expect(form!.has("items[1][price_data][unit_amount]")).toBe(false);expect(form!.get("proration_behavior")).toBe("none");
  for(const name of ["trial_end","trial_period_days","billing_cycle_anchor","pause_collection[behavior]","application_fee_percent"])expect(form!.has(name)).toBe(false);
  expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({kind:"bootstrap_subscription",raw:{id:"sub_originalControlled"}});
 });
 it("does not mistake a pause POST acknowledgment for an independently returned paused/zero inventory",async()=>{
  const accepted=scope(),operationId=randomUUID(),observed:unknown[]=[];
  const metadata={freeholder_controlled_subscription_version:"1",freeholder_controlled_transport:"zero_only_preparation",freeholder_subscription_id:accepted.subscriptionId,
   freeholder_subscription_terms_id:accepted.termsId,freeholder_controlled_generation:"1",freeholder_bootstrap_operation_id:operationId,freeholder_bootstrap_request_digest:"a".repeat(64),freeholder_platform_account_id:accepted.providerPlatformAccountId};
  const value={id:"sub_originalControlled",customer:accepted.providerCustomerRef,collection_method:"charge_automatically",currency:"cad",default_payment_method:accepted.providerMethodRef,
   status:"active",metadata,pause_collection:null,latest_invoice:null,billing_cycle_anchor:1793491200,trial_end:null,trial_start:null,pending_update:null,schedule:null,cancel_at:null,cancel_at_period_end:false,
   automatic_tax:{enabled:false},default_tax_rates:[],discounts:[],pending_invoice_item_interval:null,next_pending_invoice_item_invoice:null,
   transfer_data:{destination:accepted.destinationAccountId},on_behalf_of:accepted.settlementMerchantAccountId,
   items:{has_more:false,data:[{id:"si_originalControlled",quantity:1,tax_rates:[],current_period_start:1793491200,current_period_end:1796083200,
    price:{id:"price_originalZero",product:accepted.providerProductRef,currency:"cad",unit_amount:0,unit_amount_decimal:"0",billing_scheme:"per_unit",type:"recurring",transform_quantity:null,tax_behavior:"exclusive",recurring:{interval:"month",interval_count:1,usage_type:"licensed"}}}]}};
  const fetcher=vi.fn<typeof fetch>(async(input,init={})=>{const url=new URL(input instanceof Request?input.url:input instanceof URL?input.href:input);if(url.pathname==="/v1/account")return Response.json({id:accepted.providerPlatformAccountId});
   if(init.method==="POST"){expect(new URLSearchParams(init.body as URLSearchParams).get("pause_collection[behavior]")).toBe("keep_as_draft");return Response.json({...value,pause_collection:{behavior:"keep_as_draft",resumes_at:null}});}
   return Response.json(value);});
  const provider=createStripePayments({secretKey:"sk_declared_controlled_fixture",apiBase:"https://stripe.example.test",fetch:fetcher});
  const request:MerchantControlledSubscriptionReadRequest={...accepted,bootstrapOperationId:operationId,bootstrapRequestDigest:"a".repeat(64),providerSubscriptionRef:value.id,onObserved:async actual=>{observed.push(actual);}};
  await provider.pauseMerchantControlledBootstrap!({...request,operationId:randomUUID(),requestDigest:"b".repeat(64),idempotencyKey:"original-pause"});
  const actual=await provider.inspectMerchantControlledBootstrap!(request);
  expect(actual).toMatchObject({collectionPausedAsDraft:false,completeZeroRecurringItem:true,financiallyQuiesced:false,positiveCollectionAdmissible:false,originalAcceptedTrialEnd:accepted.acceptedTrialEnd});
  expect(observed).toHaveLength(2);expect(observed[0]).toMatchObject({kind:"pause_subscription"});expect(observed[1]).toMatchObject({kind:"subscription_read",raw:{pause_collection:null}});
 });
 it("retains an unexpected positive raw bootstrap response before refusing its unproved identity",async()=>{
  const retained:unknown[]=[];const fetcher=vi.fn<typeof fetch>(async input=>new URL(input instanceof Request?input.url:input instanceof URL?input.href:input).pathname==="/v1/account"?Response.json({id:"acct_originalPlatform"}):Response.json({id:"unexpected-resource",latest_invoice:{id:"in_actualUnexpected",total:500,status:"open",auto_advance:false}}));
  const provider=createStripePayments({secretKey:"sk_declared_controlled_fixture",apiBase:"https://stripe.example.test",fetch:fetcher});
  await expect(provider.createMerchantControlledBootstrap!({...scope(),operationId:randomUUID(),requestDigest:"c".repeat(64),idempotencyKey:"declared-original-bootstrap",onObserved:async actual=>{retained.push(actual);}})).rejects.toThrow();
  expect(retained).toMatchObject([{kind:"bootstrap_subscription",raw:{latest_invoice:{total:500,auto_advance:false}}}]);
 });
});
