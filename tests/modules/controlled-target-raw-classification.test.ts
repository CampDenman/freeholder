// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: actual Ed25519 caller/raw vectors, mock canonical projection.
// No ServiceContext, canonical DB rows, provider or native acceptance is minted.
import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import type { MerchantControlledObservation } from "@/adapters/payments";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { classifyControlledTargetRawFacts,type ControlledRawTarget } from "@/modules/invoicing/controlled-target-raw-policy";
import { controlledRawFinancialReview } from "@/modules/subscriptions/controlled-provider-raw-financial-review";
import { CONTROLLED_CALL_PURPOSE,originalControlledCall,finishedControlledCall } from "@/modules/subscriptions/controlled-provider-proof";
import type { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import type { subscriptionControlledOperations } from "@/modules/subscriptions/controlled-provider-schema";
import { signProviderReadProof } from "@/modules/subscriptions/provider-read-signatures";
type History=Awaited<ReturnType<typeof controlledProviderJournal>>;
type Operation=typeof subscriptionControlledOperations.$inferSelect;
const sha="a".repeat(64),start="2026-11-01T00:00:00.000Z",end="2026-12-01T00:00:00.000Z";
function vector(options:{paid?:boolean;contradictory?:boolean;unfinished?:boolean;precision?:boolean;incompletePayments?:boolean;historicalIncomplete?:boolean}={}){
 const resource:ControlledRawTarget["resource"]={id:randomUUID(),subscriptionId:randomUUID(),termsId:randomUUID(),generation:1,originalSourceRevision:sha,createdAt:new Date(),originalScope:{
  subscriptionId:"",termsId:"",generation:1,providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:"acct_originalPlatform",providerAccountId:"acct_originalSeller",
  providerCustomerRef:"cus_original",providerMethodRef:"pm_original",providerProductRef:"prod_original",currency:"CAD",interval:"month",intervalCount:1,acceptedPeriodEnd:end,acceptedTrialEnd:null}};
 resource.originalScope.subscriptionId=resource.subscriptionId;resource.originalScope.termsId=resource.termsId;
 const history:History={operations:[],calls:[],facts:[],finishes:[],stops:[],verifications:[],chargeOrigins:[],closures:[],unfinished:[],count:1,revision:sha};
 function append(kind:Operation["kind"],payload:Record<string,unknown>,make:(operation:Operation)=>{facts:MerchantControlledObservation[];result:Record<string,unknown>},unfinished=false){
  const originalRequest={scopeDigest:merchantTaxDigest(resource.originalScope),payload,parentFinancialRevision:sha},operation:Operation={id:randomUUID(),resourceId:resource.id,kind,ordinal:history.operations.length+1,
   originalRequest,requestDigest:merchantTaxDigest(originalRequest),idempotencyKey:`raw-target:${randomUUID()}`,previousEvidenceRevision:history.revision,acceptedQuoteDigest:sha,createdAt:new Date()};
  const callId=randomUUID(),caller=merchantPhysicalCaller(),admission=signProviderReadProof("admission",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:resource.id,kind,callId,requestDigest:operation.requestDigest,
   callerId:caller.id,caller,completionDigest:sha,admittedSourceRevision:operation.previousEvidenceRevision}),call={id:callId,operationId:operation.id,admission,admissionDigest:merchantTaxDigest(admission),createdAt:new Date()};
  expect(originalControlledCall(operation,call)).not.toBeNull();history.operations.push(operation);history.calls.push(call);
  const observed=make(operation),facts=observed.facts.map((actual,index)=>({id:randomUUID(),callId,ordinal:index+1,actual,actualDigest:merchantTaxDigest(actual),createdAt:new Date()}));history.facts.push(...facts);
  if(unfinished)history.unfinished.push(callId);else{
   const actualResult={outcome:"returned",result:observed.result},proof=signProviderReadProof("finish",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:resource.id,callId,requestDigest:operation.requestDigest,
    admissionDigest:call.admissionDigest,callerId:caller.id,completionDigest:sha,outcome:"returned",factsDigest:merchantTaxDigest(actualResult)}),finish={callId,proof,proofDigest:merchantTaxDigest(proof),actualResult,createdAt:new Date()};
   expect(finishedControlledCall(operation,call,finish)).toBe(true);history.finishes.push(finish);
   history.verifications.push({operationId:operation.id,callId,actualResult:observed.result,actualResultDigest:merchantTaxDigest(observed.result),evidenceRevision:merchantTaxDigest({operations:history.operations,calls:history.calls,facts:history.facts,finishes:history.finishes,stops:history.stops,verifications:history.verifications,chargeOrigins:history.chargeOrigins,closures:history.closures}),createdAt:new Date()});
  }
  history.count=1+history.operations.length+history.calls.length+history.facts.length+history.finishes.length+history.verifications.length+history.stops.length+history.chargeOrigins.length+history.closures.length;
  history.revision=merchantTaxDigest({operations:history.operations,calls:history.calls,facts:history.facts,finishes:history.finishes,stops:history.stops,verifications:history.verifications,chargeOrigins:history.chargeOrigins,closures:history.closures});return{operation,call,facts};
 }
 let tag:Record<string,string>={};
 const bootstrap=append("bootstrap",{},operation=>{
  tag={freeholder_controlled_subscription_version:"1",freeholder_subscription_id:resource.subscriptionId,freeholder_subscription_terms_id:resource.termsId,freeholder_controlled_generation:"1",
   freeholder_platform_account_id:resource.originalScope.providerPlatformAccountId,freeholder_bootstrap_operation_id:operation.id,freeholder_bootstrap_request_digest:operation.requestDigest};
  return{facts:[{kind:"bootstrap_subscription",raw:{id:"sub_original",customer:"cus_original",metadata:tag}}],result:{providerSubscriptionRef:"sub_original"}};
 });
 const componentId=randomUUID(),provenance={kind:"net" as const,providerProductRef:"prod_original",providerPreviewLineRef:"il_preview",originalProviderItemRef:"si_original",originalProviderPriceRef:"price_zero",canonicalCalculationDigest:sha},provenanceDigest=merchantTaxDigest(provenance),manifest:ControlledRawTarget["manifest"]={protocol:"controlled_net_gross.v1",collectionId:randomUUID(),quoteId:randomUUID(),canonicalInvoiceId:randomUUID(),termsId:resource.termsId,
  acceptedQuoteDigest:sha,canonicalTargetDigest:sha,currency:"CAD",grossMinor:1000,creditedMinor:0,cashDueMinor:1000,applicationFeeMinor:0,
  components:[{id:componentId,position:0,kind:"net",amountMinor:1000,providerProductRef:"prod_original",periodStart:start,periodEnd:end,provenanceDigest}]};
 const calendar={bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original",originalComponents:[{kind:"principal",subscriptionItemRef:"si_original",providerPriceRef:"price_zero",providerProductRef:"prod_original",amountMinor:0,interval:"month",intervalCount:1,
  actualPeriodStart:start,actualPeriodEnd:end,taxQuoteDigest:sha,profileId:randomUUID(),profileVersion:1}],originalAnchor:start,originalProviderTrialEnd:null,originalPeriodStart:start,originalPeriodEnd:end,prorationAt:start,currentReadDigest:sha,
  target:{providerProductRef:"prod_original",principalMinor:1000,interval:"month",intervalCount:1},taxComponent:null};
 const base={bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original",manifest,calendar,
  invoiceOrigin:{kind:"created_draft",creatorOperationId:null,creatorRequestDigest:null},lineBindings:[]};
 let invoiceMetadata:Record<string,unknown>={};
 function invoice(paid:number,total=1000){return{id:"in_original",subscription:"sub_original",customer:"cus_original",metadata:invoiceMetadata,parent:{subscription_details:{subscription:"sub_original",metadata:tag}},currency:"cad",status:paid===total&&total>0?"paid":"draft",
  total,subtotal:total,amount_due:total,amount_paid:paid,amount_remaining:total-paid,auto_advance:false,collection_method:"charge_automatically",default_payment_method:"pm_original",automatic_tax:{enabled:false},discounts:[],default_tax_rates:[],
  starting_balance:0,ending_balance:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,total_discount_amounts:[],total_taxes:[],application_fee_amount:0,transfer_data:null,on_behalf_of:null};}
 const creator=append("create_draft",base,operation=>{
  invoiceMetadata={...tag,freeholder_controlled_collection_protocol:manifest.protocol,freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_collection_quote_id:manifest.quoteId,
   freeholder_canonical_invoice_id:manifest.canonicalInvoiceId,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_collection_quote_digest:manifest.acceptedQuoteDigest,
   freeholder_controlled_creator_operation_id:operation.id,freeholder_controlled_creator_request_digest:operation.requestDigest};
  return{facts:[{kind:"controlled_draft_created",raw:invoice(0,0)}],result:{providerInvoiceRef:"in_original",requiresIndependentRead:true,suppliesPaidAuthority:false}};
 });
 const itemCreator=append("add_invoice_component",{...base,invoiceOrigin:{kind:"created_draft",creatorOperationId:creator.operation.id,creatorRequestDigest:creator.operation.requestDigest},providerInvoiceRef:"in_original",componentId},operation=>({facts:[{kind:"controlled_item_created",raw:{id:"ii_original",invoice:"in_original",customer:"cus_original",amount:1000,currency:"cad",
  metadata:{freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_component_id:componentId,freeholder_controlled_component_digest:provenanceDigest,freeholder_canonical_target_digest:sha,
   freeholder_controlled_item_operation_id:operation.id,freeholder_controlled_item_request_digest:operation.requestDigest}}}],result:{providerInvoiceRef:"in_original",componentId,providerInvoiceItemRef:"ii_original",providerPriceRef:"price_original",requiresIndependentRead:true}}));
 const line:Record<string,unknown>={...(options.precision?{quantity_decimal:"1.000000000001"}:{}),id:"il_original",amount:1000,currency:"cad",quantity:1,period:{start:Date.parse(start)/1000,end:Date.parse(end)/1000},parent:{invoice_item_details:{invoice_item:"ii_original"}},pricing:{price_details:{price:"price_original",product:"prod_original"}},
  metadata:{freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_component_id:componentId,freeholder_controlled_component_digest:provenanceDigest,freeholder_canonical_target_digest:sha,freeholder_controlled_item_operation_id:itemCreator.operation.id,freeholder_controlled_item_request_digest:itemCreator.operation.requestDigest},discount_amounts:[],taxes:[]};
 const paid=options.paid===false?0:1000,intent={id:"pi_original",customer:"cus_original",amount:1000,amount_received:paid,amount_capturable:0,currency:"cad",status:paid?"succeeded":"canceled",latest_charge:paid?"ch_original":null,transfer_data:null,on_behalf_of:null};
 const payment={id:"inpay_original",invoice:"in_original",payment:{type:"payment_intent",payment_intent:"pi_original"},status:paid?"paid":"canceled",amount_requested:1000,amount_paid:paid};
 const cash={provider:"stripe",subscriptionId:resource.subscriptionId,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:"pi_original",providerChargeRef:"ch_original",providerCustomerRef:"cus_original",
  providerPlatformAccountId:resource.originalScope.providerPlatformAccountId,providerAccountId:resource.originalScope.providerAccountId,amountMinor:1000,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true};
 if(options.contradictory||options.unfinished)append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[{kind:"intent_read",raw:{...intent,amount_received:1001}}],result:{retainedBeforeFailure:true}}),options.unfinished);
 if(options.historicalIncomplete)append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[{kind:"invoice_payments_read",raw:{data:[payment],has_more:true}}],result:{retainedBeforeFailure:true}}));
 const current=append("read_invoice",{bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original"},()=>{
  const actualInvoice=invoice(paid),price={id:"price_original",currency:"cad",product:"prod_original",unit_amount:1000};
  const facts:MerchantControlledObservation[]=[{kind:"invoice_read",raw:actualInvoice},{kind:"invoice_payments_read",raw:{data:[payment],has_more:false}},{kind:"intent_read",raw:intent}];
  if(paid)facts.push({kind:"cash_observed",raw:{cash,invoice:actualInvoice,intent,invoicePayment:payment}});
  facts.push({kind:"invoice_lines_read",raw:{data:[line],has_more:false}},{kind:"price_read",raw:price});
  return{facts,result:{providerInvoiceRef:"in_original",providerSubscriptionRef:"sub_original",providerCustomerRef:"cus_original",currency:"CAD",status:actualInvoice.status,totalMinor:1000,paidMinor:paid,remainingMinor:1000-paid,autoAdvance:false,completePayments:!options.incompletePayments,completeLines:true,
   actualInvoice,actualPayments:[payment],actualIntents:[intent],actualCash:paid?[cash]:[],actualLines:[line],actualPrices:[price],suppliesPaidAuthority:false,financiallyQuiesced:false}};
 });
 const target:ControlledRawTarget={resource,history,manifest,binding:{collectionId:manifest.collectionId,resourceId:resource.id,originKind:"created_draft",creatorOperationId:creator.operation.id,providerInvoiceRef:"in_original",operationId:creator.operation.id,callId:creator.call.id,factId:creator.facts[0]!.id,originalEvidenceDigest:sha,createdAt:new Date()},proofs:[],period:{periodAmountMinor:1000,interval:"month",intervalCount:1},
  components:[{id:componentId,collectionId:manifest.collectionId,position:0,kind:"net",amountMinor:1000,currency:"CAD",periodStart:new Date(start),periodEnd:new Date(end),
   provenance,provenanceDigest,createdAt:new Date()}],
  itemReceipts:[{componentId,resourceId:resource.id,originKind:"invoice_item",creatorOperationId:itemCreator.operation.id,providerInvoiceItemRef:"ii_original",providerInvoiceLineRef:"il_original",providerPriceRef:"price_original",operationId:current.operation.id,callId:current.call.id,factId:current.facts.find(row=>row.actual.kind==="invoice_lines_read")!.id,originalEvidenceDigest:sha,createdAt:new Date()}],
  canonicalPaidMinor:paid,canonicalRefundedMinor:0,cash:paid?[{receiptId:randomUUID(),paymentId:randomUUID(),resourceId:resource.id,canonicalInvoiceId:manifest.canonicalInvoiceId,providerInvoiceRef:"in_original",providerIntentRef:"pi_original",providerChargeRef:"ch_original",amountMinor:1000,currency:"CAD"}]:[]};
 if(paid){const original=target.cash[0]!,fact=current.facts.find(row=>row.actual.kind==="cash_observed")!;
  history.chargeOrigins.push({receiptId:original.receiptId,resourceId:resource.id,operationId:current.operation.id,callId:current.call.id,factId:fact.id,
   originalEvidenceDigest:merchantTaxDigest({resource,operation:current.operation,call:current.call,fact,cash}),createdAt:new Date()});history.count++;
 }
 return{target,append,current,creator,itemCreator,line,intent,invoice,calendar,tag,review:()=>controlledRawFinancialReview(resource,history)};
}
describe("exact full15 derived raw financial disposition",()=>{
 it("resolves genuine signed known cash only through exact current inventory and explicit mock canonical receipt identity, retaining every original fact",()=>{
  const v=vector(),before=merchantTaxDigest(v.target.history),raw=v.review(),actual=classifyControlledTargetRawFacts([v.target]);
  expect(raw.rawPositiveFactIds.length).toBeGreaterThan(0);expect(actual.unresolvedFactIds).toEqual([]);expect(actual.resolutions.map(row=>row.factId).sort()).toEqual([...raw.factIds].sort());
  expect(actual.resolutions.filter(row=>raw.rawPositiveFactIds.includes(row.factId)).every(row=>row.disposition==="canonical_cash"&&row.receiptIds.includes(v.target.cash[0]!.receiptId))).toBe(true);
  expect(merchantTaxDigest(v.target.history)).toBe(before);expect(v.review()).toEqual(raw);
 });
 it("recognizes an owned nonautomatic draft and canceled zero intent without calling it paid principal",()=>{
  const v=vector({paid:false}),actual=classifyControlledTargetRawFacts([v.target]);expect(actual.unresolvedFactIds).toEqual([]);
  expect(actual.resolutions.every(row=>row.disposition==="owned_nonautomatic_obligation"&&row.receiptIds.length===0)).toBe(true);
 });
 it.each(["NULL-payment","foreign-PI","foreign-invoice","foreign-charge","unapplied-cash"] as const)("keeps positive raw review for %s despite an equal amount",change=>{
  const v=vector();if(change==="NULL-payment"||change==="unapplied-cash")v.target.cash=[];
  if(change==="foreign-PI")v.target.cash[0]!.providerIntentRef="pi_foreign";
  if(change==="foreign-invoice")v.target.cash[0]!.canonicalInvoiceId=randomUUID();
  if(change==="foreign-charge")v.target.cash[0]!.providerChargeRef="ch_foreign";
  const actual=classifyControlledTargetRawFacts([v.target]);expect(v.review().rawPositiveFactIds.every(id=>actual.unresolvedFactIds.includes(id))).toBe(true);
 });
 it("does not let a fresh complete success erase an earlier genuine signed contradictory positive amount",()=>{
  const v=vector({contradictory:true}),first=v.target.history.facts.find(row=>row.actual.kind==="intent_read"&&row.actual.raw.amount_received===1001)!;
  expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(first.id);expect(first.actual.raw.amount_received).toBe(1001);expect(v.target.canonicalPaidMinor).toBe(1000);
 });
 it("does not borrow a later completed caller to release the genuine older unfinished invocation",()=>{
  const v=vector({unfinished:true}),actual=classifyControlledTargetRawFacts([v.target]);expect(v.target.history.unfinished).toHaveLength(1);
  expect(actual.resolutions).toEqual([]);expect(actual.unresolvedFactIds.sort()).toEqual(v.review().factIds.sort());
 });
 it("requires a real complete same-caller result, not an invented later zero flag or missing page",()=>{
  const v=vector();v.target.history.verifications=v.target.history.verifications.filter(row=>row.operationId!==v.current.operation.id);
  expect(classifyControlledTargetRawFacts([v.target]).resolutions).toEqual([]);
 });
 it("retains a genuinely signed incomplete historical payment inventory despite a later complete target read",()=>{
  const v=vector({historicalIncomplete:true}),prior=v.target.history.facts.find(row=>row.actual.kind==="invoice_payments_read"&&row.actual.raw.has_more===true)!;
  const actual=classifyControlledTargetRawFacts([v.target]);expect(actual.unresolvedFactIds).toContain(prior.id);
  expect(actual.resolutions.some(row=>row.factId===v.current.facts.find(fact=>fact.actual.kind==="invoice_read")!.id)).toBe(true);
  expect(v.target.history.facts).toContain(prior);
 });
 it.each(["missing-origin","foreign-origin","wrong-finish","incomplete-payments","precision"] as const)("retains review after %s rather than trusting an apparent paid flag",change=>{
  const v=vector({precision:change==="precision",incompletePayments:change==="incomplete-payments"});
  if(change==="missing-origin")v.target.history.chargeOrigins=[];
  if(change==="foreign-origin")v.target.history.chargeOrigins[0]!.receiptId=randomUUID();
  if(change==="wrong-finish")v.target.history.finishes.find(row=>row.callId===v.current.call.id)!.proofDigest="b".repeat(64);
  expect(classifyControlledTargetRawFacts([v.target]).resolutions).toEqual([]);
 });
 it("classifies a genuine signed paused price epoch separately while retaining unrelated bank debt",()=>{
  const v=vector({paid:false});v.target.calendarAuthority={periodStart:start,periodEnd:end,anchor:start,trialEnd:null,periodAmountMinor:1000,interval:"month",intervalCount:1};
  let calendarRaw:Record<string,unknown>={};
  const update=v.append("update_calendar",{...v.calendar,collectionId:v.target.manifest.collectionId,acceptedQuoteDigest:v.target.manifest.acceptedQuoteDigest},operation=>{
   calendarRaw={id:"sub_original",customer:"cus_original",currency:"cad",default_payment_method:"pm_original",status:"active",schedule:null,cancel_at:null,cancel_at_period_end:false,pending_update:null,latest_invoice:null,
    collection_method:"charge_automatically",pause_collection:{behavior:"keep_as_draft",resumes_at:null},automatic_tax:{enabled:false},billing_mode:{type:"flexible"},discounts:[],default_tax_rates:[],billing_cycle_anchor:Date.parse(start)/1000,trial_end:null,
    transfer_data:null,on_behalf_of:null,items:{has_more:false,data:[{id:"si_original",quantity:1,current_period_start:Date.parse(start)/1000,current_period_end:Date.parse(end)/1000,price:{id:"price_epoch",unit_amount:1000,currency:"cad",product:"prod_original",recurring:{interval:"month",interval_count:1}}}]},
    metadata:{...v.tag,freeholder_controlled_price_epoch_id:v.target.manifest.collectionId,freeholder_controlled_update_operation_id:operation.id,freeholder_controlled_update_request_digest:operation.requestDigest,
     freeholder_controlled_accepted_quote_digest:v.target.manifest.acceptedQuoteDigest,freeholder_controlled_collection_policy:"canonical_gross_target_locked_credit_no_wallet"}};
   return{facts:[{kind:"calendar_updated",raw:calendarRaw}],result:{providerSubscriptionRef:"sub_original",providerInvoiceRef:null,requiresIndependentRead:true}};
  });
  const read=v.append("read_calendar",{bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest,providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"subscription_read",raw:calendarRaw}],
   result:{providerSubscriptionRef:"sub_original",providerInvoiceRef:null,providerCustomerRef:"cus_original",collectionPausedAsDraft:true,actualRaw:calendarRaw,currentReadDigest:merchantTaxDigest(calendarRaw),suppliesPaidAuthority:false,financiallyQuiesced:false}}));
  const actual=classifyControlledTargetRawFacts([v.target]);expect(actual.resolutions.map(row=>row.factId)).toEqual(expect.arrayContaining([update.facts[0]!.id,read.facts[0]!.id]));
  expect(actual.unresolvedFactIds).toContain(v.current.facts.find(row=>row.actual.kind==="invoice_read")!.id);
 });
 it.each(["positive-balance","unknown-balance","issued-note","truncated-note-list"] as const)("retains signed %s review even after another genuine zero-customer projection",kind=>{
  const v=vector(),customer={id:"cus_original",currency:"cad",balance:kind==="positive-balance"?-250:kind==="unknown-balance"?null:0,invoice_credit_balance:{cad:0},cash_balance:null};
  const facts:MerchantControlledObservation[]=[{kind:"customer_financial_read",raw:customer}];
  if(kind==="issued-note"||kind==="truncated-note-list")facts.push({kind:"customer_credit_notes_read",raw:{data:kind==="issued-note"?[{id:"cn_unassigned",customer:"cus_original",invoice:"in_other",status:"issued",amount:250,credit_amount:250,currency:"cad"}]:[],has_more:kind==="truncated-note-list"}});
  const first=v.append("read_customer_financials",{providerSubscriptionRef:"sub_original"},()=>({facts,result:{providerCustomerRef:"cus_original",balanceState:"review",completeCreditNotes:kind!=="truncated-note-list"}}));
  v.append("read_customer_financials",{providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"customer_financial_read",raw:{...customer,balance:0}},{kind:"customer_credit_notes_read",raw:{data:[],has_more:false}}],
   result:{providerCustomerRef:"cus_original",balanceState:"known_zero",completeCreditNotes:true}}));
  const actual=classifyControlledTargetRawFacts([v.target]);
  const review=first.facts.find(fact=>kind==="positive-balance"||kind==="unknown-balance"?fact.actual.kind==="customer_financial_read":fact.actual.kind==="customer_credit_notes_read")!;
  expect(actual.unresolvedFactIds).toContain(review.id);expect(v.target.history.facts).toContain(review);expect(actual.resolutions.some(row=>row.factId===review.id)).toBe(false);
 });
 it("keeps original gross cash ownership separate from actual refund debt or remaining principal",()=>{
  const v=vector();v.target.canonicalRefundedMinor=500;const actual=classifyControlledTargetRawFacts([v.target]);
  expect(actual.unresolvedFactIds).toEqual([]);expect(actual.resolutions.every(row=>row.canonicalRefundedMinor===500)).toBe(true);
  expect(v.target.cash[0]!.amountMinor).toBe(1000);expect(JSON.stringify(actual)).not.toMatch(/principalSafe|financiallyQuiesced|refundSettled|paidAccess/);
 });
});
