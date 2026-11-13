// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: actual HTTP contract and retained-fact order, no bank-account IO.
import { randomUUID } from "node:crypto";
import { describe,it,expect,vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { controlledSubscriptionFactsDigest } from "@/adapters/payments/controlled-subscription-digest";
import type { MerchantControlledInvoiceActionRequest,MerchantControlledObservation,MerchantControlledCollectionComponent } from "@/adapters/payments";
function fixture(){
 const start="2026-11-01T00:00:00.000Z",end="2026-12-01T00:00:00.000Z",epoch=(iso:string)=>Date.parse(iso)/1000;
 const scope={providerApiVersion:"2026-10-28.endive" as const,providerPlatformAccountId:"acct_originalPlatform",destinationAccountId:"acct_originalSeller",settlementMerchantAccountId:"acct_originalSeller",
  subscriptionId:randomUUID(),termsId:randomUUID(),generation:1,providerCustomerRef:"cus_originalBuyer",providerMethodRef:"pm_originalMethod",providerProductRef:"prod_originalNet",currency:"CAD",interval:"month" as const,intervalCount:1,
  acceptedPeriodEnd:end,acceptedTrialEnd:null};
 const bootstrapOperationId=randomUUID(),bootstrapRequestDigest="b".repeat(64),original={bootstrapOperationId,bootstrapRequestDigest,providerSubscriptionRef:"sub_originalCalendar"};
 const originalTag={freeholder_controlled_subscription_version:"1",freeholder_controlled_transport:"draft_calendar",freeholder_subscription_id:scope.subscriptionId,freeholder_subscription_terms_id:scope.termsId,
  freeholder_controlled_generation:"1",freeholder_bootstrap_operation_id:bootstrapOperationId,freeholder_bootstrap_request_digest:bootstrapRequestDigest,freeholder_platform_account_id:scope.providerPlatformAccountId};
 const current={id:original.providerSubscriptionRef,customer:scope.providerCustomerRef,currency:"cad",status:"active",schedule:null,cancel_at:null,cancel_at_period_end:false,
  default_payment_method:scope.providerMethodRef,metadata:originalTag,pause_collection:{behavior:"keep_as_draft",resumes_at:null},collection_method:"charge_automatically",billing_mode:{type:"flexible"},pending_update:null,
  billing_cycle_anchor:epoch(start),trial_end:null,automatic_tax:{enabled:false},default_tax_rates:[],discounts:[],transfer_data:{destination:scope.destinationAccountId},on_behalf_of:scope.settlementMerchantAccountId,
  items:{has_more:false,data:[{id:"si_originalNet",quantity:1,current_period_start:epoch(start),current_period_end:epoch(end),price:{id:"price_originalNet",product:scope.providerProductRef,currency:"cad",unit_amount:1000}}]}};
 const components:MerchantControlledCollectionComponent[]=[
  {id:randomUUID(),position:0,kind:"net",amountMinor:1000,providerProductRef:scope.providerProductRef,periodStart:start,periodEnd:end,provenanceDigest:"1".repeat(64)},
  {id:randomUUID(),position:1,kind:"merchant_declared_tax_collection",amountMinor:50,providerProductRef:"prod_originalTax",periodStart:start,periodEnd:end,provenanceDigest:"2".repeat(64),taxQuoteDigest:"a".repeat(64),profileId:randomUUID(),profileVersion:1},
  {id:randomUUID(),position:2,kind:"locked_canonical_credit",amountMinor:-200,periodStart:start,periodEnd:end,provenanceDigest:"3".repeat(64),creditNoteId:randomUUID(),applicationIds:[randomUUID()]},
 ];
 const observed:MerchantControlledObservation[]=[],posts:Array<{path:string;form:URLSearchParams}>=[];let status="draft",added=[0,1,2],balance=0,issuedCredit=false,failAfterPay=false,paid=false;
 const operationId=randomUUID(),requestDigest="d".repeat(64),manifest={protocol:"controlled_net_gross.v1" as const,collectionId:randomUUID(),quoteId:randomUUID(),canonicalInvoiceId:randomUUID(),termsId:randomUUID(),acceptedQuoteDigest:"e".repeat(64),canonicalTargetDigest:"f".repeat(64),currency:"CAD",grossMinor:1050,creditedMinor:200,cashDueMinor:850,applicationFeeMinor:40,components};
 const own={freeholder_controlled_collection_protocol:manifest.protocol,freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_collection_quote_id:manifest.quoteId,
  freeholder_canonical_invoice_id:manifest.canonicalInvoiceId,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_collection_quote_digest:manifest.acceptedQuoteDigest,
  freeholder_controlled_creator_operation_id:operationId,freeholder_controlled_creator_request_digest:requestDigest};
 const invoice=()=>({id:"in_originalTarget",customer:scope.providerCustomerRef,currency:"cad",parent:{subscription_details:{subscription:original.providerSubscriptionRef,metadata:originalTag}},metadata:own,
  collection_method:"charge_automatically",default_payment_method:scope.providerMethodRef,auto_advance:false,automatic_tax:{enabled:false},discounts:[],default_tax_rates:[],transfer_data:{destination:scope.destinationAccountId},on_behalf_of:scope.settlementMerchantAccountId,
  status,total:added.reduce((n,i)=>n+components[i]!.amountMinor,0),subtotal:added.reduce((n,i)=>n+components[i]!.amountMinor,0),application_fee_amount:40,
  amount_paid:paid?850:0,amount_remaining:paid?0:850,amount_due:850,starting_balance:0,ending_balance:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,total_discount_amounts:[],total_taxes:[]});
 const lines=()=>added.map(i=>{const c=components[i]!;return{id:`il_actual_${i}`,amount:c.amountMinor,currency:"cad",quantity:1,period:{start:epoch(c.periodStart),end:epoch(c.periodEnd)},discount_amounts:[],taxes:[],
  parent:{type:"invoice_item_details",invoice_item_details:{invoice_item:`ii_actual_${i}`}},pricing:{price_details:{price:c.kind==="locked_canonical_credit"?null:`price_actual_${i}`,product:c.providerProductRef??null}},
  metadata:{...own,freeholder_controlled_component_id:c.id,freeholder_controlled_component_digest:c.provenanceDigest}};});
 const fetcher=vi.fn<typeof fetch>(async(input,init={})=>{const url=new URL(input instanceof Request?input.url:input instanceof URL?input.href:input),path=url.pathname;
  if(path==="/v1/account")return Response.json({id:scope.providerPlatformAccountId});
  expect(new Headers(init.headers).get("stripe-version")).toBe(scope.providerApiVersion);expect(new Headers(init.headers).has("stripe-account")).toBe(false);
  if(init.method==="POST"){
   const form=new URLSearchParams(init.body as URLSearchParams);posts.push({path,form});
   if(path==="/v1/invoices")return Response.json({id:"in_originalTarget"});
   if(path==="/v1/invoiceitems"){const i=components.findIndex(c=>c.id===form.get("metadata[freeholder_controlled_component_id]"));if(i<0)throw new Error("unowned actual component");added.push(i);return Response.json({id:`ii_actual_${i}`,invoice:"in_originalTarget",customer:scope.providerCustomerRef,amount:components[i]!.amountMinor,pricing:{price_details:{price:i===2?null:`price_actual_${i}`}}});}
   if(path.endsWith("/finalize")){status="open";return Response.json(invoice());}
   if(path.endsWith("/pay")){status="paid";paid=true;return Response.json(invoice());}
   if(path==="/v1/invoices/in_originalTarget")return Response.json(invoice());
   throw new Error(`Unexpected physical POST ${path}`);
  }
  if(path===`/v1/subscriptions/${original.providerSubscriptionRef}`)return Response.json(current);
  if(path===`/v1/customers/${scope.providerCustomerRef}`)return Response.json({id:scope.providerCustomerRef,currency:"cad",balance,invoice_credit_balance:{cad:balance},cash_balance:null});
  if(path==="/v1/credit_notes")return Response.json({has_more:false,data:issuedCredit?[{id:"cn_oldPromise",customer:scope.providerCustomerRef,invoice:"in_oldInvoice",currency:"cad",status:"issued",amount:200,credit_amount:0}]:[]});
  if(path==="/v1/invoices/in_originalTarget")return Response.json(invoice());
  if(path==="/v1/invoice_payments")return Response.json({has_more:false,data:paid?[{id:"inpay_actual",invoice:"in_originalTarget",payment:{type:"payment_intent",payment_intent:"pi_originalPositive"}}]:[]});
  if(path==="/v1/payment_intents/pi_originalPositive")return Response.json({id:"pi_originalPositive",customer:scope.providerCustomerRef,currency:"cad",amount_received:850,status:"succeeded",latest_charge:"ch_originalPositive",transfer_data:{destination:scope.destinationAccountId},on_behalf_of:scope.settlementMerchantAccountId});
  if(path==="/v1/invoices/in_originalTarget/lines")return Response.json({has_more:false,data:lines()});
  if(path.startsWith("/v1/prices/")){if(paid&&failAfterPay)return Response.json({error:{message:"Actual auxiliary price read failed"}},{status:503});return Response.json({id:path.split("/").at(-1)});}
  throw new Error(`Unexpected actual GET ${path}`);
 });
 const provider=createStripePayments({secretKey:"sk_declared_contract_fixture",apiBase:"https://stripe.example.test",fetch:fetcher}),onObserved=async(actual:MerchantControlledObservation)=>{observed.push(actual);};
 const calendar={...scope,...original,operationId,requestDigest,idempotencyKey:"original-calendar-projection",onObserved,originalComponents:[{kind:"principal" as const,subscriptionItemRef:"si_originalNet",providerPriceRef:"price_originalNet",providerProductRef:scope.providerProductRef,amountMinor:1000,actualPeriodStart:start,actualPeriodEnd:end,taxQuoteDigest:"a".repeat(64),profileId:components[1]!.profileId!,profileVersion:1}],
  originalAnchor:start,originalProviderTrialEnd:null,originalPeriodStart:start,originalPeriodEnd:end,prorationAt:"2026-11-13T00:00:00.000Z",currentReadDigest:controlledSubscriptionFactsDigest(current),target:{providerProductRef:scope.providerProductRef,principalMinor:1000,interval:scope.interval,intervalCount:1},taxComponent:null};
 const request=():MerchantControlledInvoiceActionRequest=>({...scope,...original,operationId,requestDigest,idempotencyKey:"original-target-physical-call",onObserved,manifest,calendar,providerInvoiceRef:"in_originalTarget",
  invoiceOrigin:{kind:"created_draft",creatorOperationId:operationId,creatorRequestDigest:requestDigest},lineBindings:added.map(i=>({componentId:components[i]!.id,providerInvoiceLineRef:`il_actual_${i}`,providerInvoiceItemRef:`ii_actual_${i}`,providerPriceRef:i===2?null:`price_actual_${i}`}))});
 return{provider,request,observed,posts,components,setAdded:(v:number[])=>{added=v;},setBalance:(v:number)=>{balance=v;},setIssued:()=>{issuedCredit=true;},setOpen:()=>{status="open";},failPriceAfterPay:()=>{failAfterPay=true;}};
}
describe("exact controlled canonical collection HTTP lifecycle",()=>{
 it("creates a nonautomatic isolated draft excluding unrelated pending items",async()=>{const f=fixture();f.setAdded([]);const {providerInvoiceRef,...req}=f.request();expect(providerInvoiceRef).toBe("in_originalTarget");
  await expect(f.provider.prepareMerchantControlledDraft!({...req,mode:"create"})).resolves.toMatchObject({requiresIndependentRead:true,suppliesPaidAuthority:false});
  expect(f.posts).toHaveLength(1);expect(f.posts[0]!.form.get("auto_advance")).toBe("false");expect(f.posts[0]!.form.get("pending_invoice_items_behavior")).toBe("exclude");expect(f.posts[0]!.form.has("paid_out_of_band")).toBe(false);
 });
 it("refuses finalize before the actual fixed dated tax/credit manifest is complete",async()=>{const f=fixture();f.setAdded([0]);await expect(f.provider.finalizeMerchantControlledInvoice!(f.request())).rejects.toThrow();expect(f.posts).toHaveLength(0);expect(f.observed.some(v=>v.kind==="invoice_lines_read")).toBe(true);});
 it("attaches exact locked canonical credit as a negative amount without creating a negative price or wallet credit",async()=>{const f=fixture();f.setAdded([0,1]);await f.provider.addMerchantControlledComponent!({...f.request(),componentId:f.components[2]!.id});
  const form=f.posts[0]!.form;expect(form.get("amount")).toBe("-200");expect(form.get("invoice")).toBe("in_originalTarget");expect(form.has("price_data[unit_amount]")).toBe(false);expect(f.posts.some(p=>p.path.includes("credit_notes"))).toBe(false);
 });
 it("finalizes only the exact existing canonical gross/locked-credit/fixed-fee manifest, retaining its ACK separately",async()=>{const f=fixture();await expect(f.provider.finalizeMerchantControlledInvoice!(f.request())).resolves.toMatchObject({requiresIndependentRead:true,suppliesPaidAuthority:false});
  expect(f.posts).toHaveLength(1);expect(f.posts[0]!.path).toBe("/v1/invoices/in_originalTarget/finalize");expect(f.posts[0]!.form.get("auto_advance")).toBe("false");expect(f.observed.at(-1)?.kind).toBe("controlled_invoice_finalized");
 });
 it("refuses an unrelated customer balance before any physical collection POST",async()=>{const f=fixture();f.setBalance(-200);f.setOpen();await expect(f.provider.payMerchantControlledInvoice!(f.request())).rejects.toThrow();expect(f.posts).toHaveLength(0);});
 it("retains an original issued promise even when the customer aggregate balance is zero and refuses collection",async()=>{const f=fixture();f.setIssued();f.setOpen();await expect(f.provider.payMerchantControlledInvoice!(f.request())).rejects.toThrow();expect(f.posts).toHaveLength(0);expect(f.observed.some(v=>v.kind==="customer_credit_notes_read")).toBe(true);});
 it("retains genuine positive PI/cash before an auxiliary price failure after actual pay",async()=>{const f=fixture();f.setOpen();f.failPriceAfterPay();await expect(f.provider.payMerchantControlledInvoice!(f.request())).rejects.toThrow();
  expect(f.posts.map(p=>p.path)).toEqual(["/v1/invoices/in_originalTarget/pay"]);const paid=f.observed.findIndex(v=>v.kind==="controlled_invoice_paid"),cash=f.observed.findIndex(v=>v.kind==="cash_observed");
  expect(paid).toBeGreaterThan(-1);expect(cash).toBeGreaterThan(paid);expect(f.observed[cash]).toMatchObject({raw:{cash:{amountMinor:850,providerPaymentIntentRef:"pi_originalPositive",providerPlatformAccountId:"acct_originalPlatform",destinationAccountId:"acct_originalSeller",merchantRouteVerified:true}}});
 });
});
