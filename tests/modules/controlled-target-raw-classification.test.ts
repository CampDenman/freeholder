// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: actual Ed25519 caller/raw vectors, mock canonical projection.
// No ServiceContext, canonical DB rows, provider or native acceptance is minted.
import { randomUUID } from "node:crypto";
import { z } from "zod";
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
function vector(options:{bootstrapZero?:boolean;paid?:boolean;partial?:boolean;contradictory?:boolean;unfinished?:boolean;precision?:boolean;incompletePayments?:boolean;historicalIncomplete?:boolean;nonpayableTax?:true}={}){
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
  acceptedQuoteDigest:sha,canonicalTargetDigest:sha,currency:"CAD",grossMinor:options.nonpayableTax?1200:1000,creditedMinor:0,cashDueMinor:options.nonpayableTax?1200:1000,applicationFeeMinor:0,
  components:[{id:componentId,position:0,kind:"net",amountMinor:1000,providerProductRef:"prod_original",periodStart:start,periodEnd:end,provenanceDigest}]};
 const taxProvenance={kind:"merchant_declared_tax_collection" as const,providerProductRef:"prod_tax",taxQuoteDigest:sha,profileId:randomUUID(),profileVersion:1},taxId=randomUUID(),taxDigest=merchantTaxDigest(taxProvenance);
 if(options.nonpayableTax)manifest.components.push({id:taxId,position:1,kind:"merchant_declared_tax_collection",amountMinor:200,providerProductRef:"prod_tax",periodStart:start,periodEnd:end,provenanceDigest:taxDigest});
 const calendar={bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original",originalComponents:[{kind:"principal",subscriptionItemRef:"si_original",providerPriceRef:"price_zero",providerProductRef:"prod_original",amountMinor:0,interval:"month",intervalCount:1,
  actualPeriodStart:start,actualPeriodEnd:end,taxQuoteDigest:sha,profileId:randomUUID(),profileVersion:1}],originalAnchor:start,originalProviderTrialEnd:null,originalPeriodStart:start,originalPeriodEnd:end,prorationAt:start,currentReadDigest:sha,
  target:{providerProductRef:"prod_original",principalMinor:1000,interval:"month",intervalCount:1},taxComponent:null};
 const base={bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original",manifest,calendar,
  invoiceOrigin:{kind:"created_draft",creatorOperationId:null,creatorRequestDigest:null},lineBindings:[]};
 let invoiceMetadata:Record<string,unknown>={};
 function invoice(paid:number,total=1000){return{id:"in_original",subscription:"sub_original",customer:"cus_original",metadata:invoiceMetadata,parent:{subscription_details:{subscription:"sub_original",metadata:tag}},currency:"cad",status:paid===total&&total>0?"paid":paid>0?"open":"draft",
  total,subtotal:total,amount_due:total,amount_paid:paid,amount_remaining:total-paid,auto_advance:false,collection_method:"charge_automatically",default_payment_method:"pm_original",automatic_tax:{enabled:false},discounts:[],default_tax_rates:[],
  starting_balance:0,ending_balance:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,total_discount_amounts:[],total_taxes:[],application_fee_amount:0,transfer_data:null,on_behalf_of:null};}
 const preparationInvoice={...invoice(0,0),id:"in_bootstrap",status:"paid"};
 if(options.bootstrapZero)append("read_bootstrap",{bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original"},()=>({facts:[],result:{providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_bootstrap",completeZeroRecurringItem:true,
  providerApiVersion:resource.originalScope.providerApiVersion,providerPlatformAccountId:resource.originalScope.providerPlatformAccountId,chargeAccountId:resource.originalScope.providerAccountId??null}}));
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
 const paid=options.paid===false?0:options.partial?500:1000,intent={id:"pi_original",customer:"cus_original",amount:1000,amount_received:paid,amount_capturable:0,currency:"cad",status:paid?"succeeded":"canceled",latest_charge:paid?"ch_original":null,transfer_data:null,on_behalf_of:null};
 const payment={id:"inpay_original",invoice:"in_original",payment:{type:"payment_intent",payment_intent:"pi_original"},status:paid?"paid":"canceled",amount_requested:1000,amount_paid:paid};
 const cash={provider:"stripe",subscriptionId:resource.subscriptionId,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:"pi_original",providerChargeRef:"ch_original",providerCustomerRef:"cus_original",
  providerPlatformAccountId:resource.originalScope.providerPlatformAccountId,providerAccountId:resource.originalScope.providerAccountId,amountMinor:paid||1000,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true};
 if(options.contradictory||options.unfinished)append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[{kind:"intent_read",raw:{...intent,amount_received:1001}}],result:{retainedBeforeFailure:true}}),options.unfinished);
 if(options.historicalIncomplete)append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[{kind:"invoice_payments_read",raw:{data:[payment],has_more:true}}],result:{retainedBeforeFailure:true}}));
 const current=append("read_invoice",{bootstrapOperationId:bootstrap.operation.id,bootstrapRequestDigest:bootstrap.operation.requestDigest,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original"},()=>{
  const actualInvoice=invoice(paid),price={id:"price_original",currency:"cad",product:"prod_original",unit_amount:1000};
  const facts:MerchantControlledObservation[]=[{kind:"invoice_read",raw:actualInvoice},{kind:"invoice_payments_read",raw:{data:options.nonpayableTax?[]:[payment],has_more:false}}];if(!options.nonpayableTax)facts.push({kind:"intent_read",raw:intent});
  if(paid)facts.push({kind:"cash_observed",raw:{cash,invoice:actualInvoice,intent,invoicePayment:payment}});
  facts.push({kind:"invoice_lines_read",raw:{data:[line],has_more:false}},{kind:"price_read",raw:price});
  return{facts,result:{providerInvoiceRef:"in_original",providerSubscriptionRef:"sub_original",providerCustomerRef:"cus_original",currency:"CAD",status:actualInvoice.status,totalMinor:1000,paidMinor:paid,remainingMinor:1000-paid,autoAdvance:false,completePayments:!options.incompletePayments,completeLines:true,
   actualInvoice,actualPayments:options.nonpayableTax?[]:[payment],actualIntents:options.nonpayableTax?[]:[intent],actualCash:paid?[cash]:[],actualLines:[line],actualPrices:[price],suppliesPaidAuthority:false,financiallyQuiesced:false}};
 });
 const target:ControlledRawTarget={resource,history,manifest,binding:{collectionId:manifest.collectionId,resourceId:resource.id,originKind:"created_draft",creatorOperationId:creator.operation.id,providerInvoiceRef:"in_original",operationId:creator.operation.id,callId:creator.call.id,factId:creator.facts[0]!.id,originalEvidenceDigest:sha,createdAt:new Date()},proofs:[],period:{periodAmountMinor:1000,interval:"month",intervalCount:1},
  components:[{id:componentId,collectionId:manifest.collectionId,position:0,kind:"net",amountMinor:1000,currency:"CAD",periodStart:new Date(start),periodEnd:new Date(end),
   provenance,provenanceDigest,createdAt:new Date()}],
  itemReceipts:[{componentId,resourceId:resource.id,originKind:"invoice_item",creatorOperationId:itemCreator.operation.id,providerInvoiceItemRef:"ii_original",providerInvoiceLineRef:"il_original",providerPriceRef:"price_original",operationId:current.operation.id,callId:current.call.id,factId:current.facts.find(row=>row.actual.kind==="invoice_lines_read")!.id,originalEvidenceDigest:sha,createdAt:new Date()}],
  canonicalPaidMinor:paid,canonicalRefundedMinor:0,cash:paid?[{receiptId:randomUUID(),paymentId:randomUUID(),resourceId:resource.id,canonicalInvoiceId:manifest.canonicalInvoiceId,providerInvoiceRef:"in_original",providerIntentRef:"pi_original",providerChargeRef:"ch_original",amountMinor:paid,currency:"CAD"}]:[]};
 if(options.nonpayableTax)target.components.push({id:taxId,collectionId:manifest.collectionId,position:1,kind:"merchant_declared_tax_collection",amountMinor:200,currency:"CAD",periodStart:new Date(start),periodEnd:new Date(end),provenance:taxProvenance,provenanceDigest:taxDigest,createdAt:new Date()});
 if(paid){const original=target.cash[0]!,fact=current.facts.find(row=>row.actual.kind==="cash_observed")!;
  history.chargeOrigins.push({receiptId:original.receiptId,resourceId:resource.id,operationId:current.operation.id,callId:current.call.id,factId:fact.id,
   originalEvidenceDigest:merchantTaxDigest({resource,operation:current.operation,call:current.call,fact,cash}),createdAt:new Date()});history.count++;
 }
 return{target,append,current,creator,itemCreator,line,intent,invoice,preparationInvoice,calendar,tag,review:()=>controlledRawFinancialReview(resource,history)};
}
/** Still a PURE signed-raw vector: no actual receipt/inspection, ServiceContext
 * or DB authority is manufactured. The real initializer obtains those itself. */
function retainedVector(options:Parameters<typeof vector>[0]={}){
 const v=vector(options),owner=v.target.cash[0],origin=v.target.history.chargeOrigins[0],bank=v.target.history.verifications.find(row=>row.operationId===v.current.operation.id);
 if(!owner||!origin||!bank)throw Error("Missing prepared original positive raw vector");
 const result={providerInvoiceRef:"in_original",manifestDigest:merchantTaxDigest(v.target.manifest),customerFinancialDigest:sha,exactManifest:true,suppliesPaidAuthority:false,inventory:bank.actualResult};
 const full=v.append("read_manifest",{bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",manifest:v.target.manifest,calendar:v.calendar,
  invoiceOrigin:{kind:"created_draft",creatorOperationId:v.creator.operation.id,creatorRequestDigest:v.creator.operation.requestDigest},lineBindings:v.target.itemReceipts.map(row=>({componentId:row.componentId,providerInvoiceLineRef:row.providerInvoiceLineRef,providerInvoiceItemRef:row.providerInvoiceItemRef,providerPriceRef:row.providerPriceRef}))},()=>({facts:v.current.facts.map(row=>row.actual),result}));
 v.target.proofs.push({id:randomUUID(),collectionId:v.target.manifest.collectionId,operationId:full.operation.id,callId:full.call.id,resultDigest:merchantTaxDigest(result),canonicalTargetDigest:v.target.manifest.canonicalTargetDigest,customerFinancialDigest:sha,createdAt:new Date()});
 v.target.cash=[];v.target.canonicalPaidMinor=0;
 v.target.prospective={purpose:"controlled_cash_prospective_read.v1",collectionId:v.target.manifest.collectionId,resourceId:v.target.resource.id,subscriptionId:v.target.resource.subscriptionId,invoiceId:v.target.manifest.canonicalInvoiceId,
  acceptedQuoteDigest:v.target.manifest.acceptedQuoteDigest,canonicalTargetDigest:v.target.manifest.canonicalTargetDigest,manifestOperationId:full.operation.id,manifestCallId:full.call.id,manifestResultDigest:merchantTaxDigest(result),manifestDigest:merchantTaxDigest(v.target.manifest),
  actualCanonicalPaidMinor:0,actualBankPaidMinor:v.intent.amount_received,actualBankRemainingMinor:1000-v.intent.amount_received,bankProofRevision:sha,parentPgRevision:sha,revision:sha,
  receipts:[{kind:"retained_unapplied",receiptId:owner.receiptId,collectionId:v.target.manifest.collectionId,resourceId:v.target.resource.id,subscriptionId:v.target.resource.subscriptionId,canonicalInvoiceId:v.target.manifest.canonicalInvoiceId,
   providerInvoiceRef:owner.providerInvoiceRef,providerIntentRef:owner.providerIntentRef,providerChargeRef:"ch_original",amountMinor:owner.amountMinor,currency:owner.currency,originOperationId:origin.operationId,originCallId:origin.callId,originFactId:origin.factId,
   inspectionId:randomUUID(),bankObservationId:randomUUID(),finishCallerId:randomUUID(),immutableBankRevision:sha,namespaceRevision:sha}]};
 return{...v,full,owner};
}
/** A second separately owned real-signed raw history on the SAME original
 * resource. Equal amounts remain distinct through invoice/creator/PI/receipt
 * identities. Its canonical projection is explicitly mock-only, as above. */
function secondOwnedInvoice(v:ReturnType<typeof vector>){
 const sourceComponent=v.target.components[0],sourceManifestComponent=v.target.manifest.components[0];if(!sourceComponent||!sourceManifestComponent)throw Error("Missing prepared canonical component");
 const componentId=randomUUID(),manifest:ControlledRawTarget["manifest"]={...v.target.manifest,collectionId:randomUUID(),quoteId:randomUUID(),canonicalInvoiceId:randomUUID(),components:[{...sourceManifestComponent,id:componentId,position:0,kind:"net",amountMinor:1000,providerProductRef:"prod_original",periodStart:start,periodEnd:end,provenanceDigest:sourceComponent.provenanceDigest}]};
 const base={bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest,providerSubscriptionRef:"sub_original",manifest,calendar:v.calendar,invoiceOrigin:{kind:"created_draft",creatorOperationId:null,creatorRequestDigest:null},lineBindings:[]};
 let metadata:Record<string,unknown>={};
 function invoice(paid:number,total=1000){return{...v.invoice(paid,total),id:"in_second",metadata};}
 const creator=v.append("create_draft",base,operation=>{metadata={...v.tag,freeholder_controlled_collection_protocol:manifest.protocol,freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_collection_quote_id:manifest.quoteId,
  freeholder_canonical_invoice_id:manifest.canonicalInvoiceId,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_collection_quote_digest:manifest.acceptedQuoteDigest,freeholder_controlled_creator_operation_id:operation.id,freeholder_controlled_creator_request_digest:operation.requestDigest};return{facts:[{kind:"controlled_draft_created",raw:invoice(0,0)}],result:{providerInvoiceRef:"in_second",requiresIndependentRead:true,suppliesPaidAuthority:false}};});
 const itemCreator=v.append("add_invoice_component",{...base,providerInvoiceRef:"in_second",componentId,invoiceOrigin:{kind:"created_draft",creatorOperationId:creator.operation.id,creatorRequestDigest:creator.operation.requestDigest}},operation=>({facts:[{kind:"controlled_item_created",raw:{id:"ii_second",invoice:"in_second",customer:"cus_original",amount:1000,currency:"cad",metadata:{freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_component_id:componentId,freeholder_controlled_component_digest:sourceComponent.provenanceDigest,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_item_operation_id:operation.id,freeholder_controlled_item_request_digest:operation.requestDigest}}}],result:{providerInvoiceRef:"in_second",componentId,providerInvoiceItemRef:"ii_second",providerPriceRef:"price_second",requiresIndependentRead:true}}));
 const line={...v.line,id:"il_second",parent:{invoice_item_details:{invoice_item:"ii_second"}},pricing:{price_details:{price:"price_second",product:"prod_original"}},metadata:{freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_component_id:componentId,freeholder_controlled_component_digest:sourceComponent.provenanceDigest,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_item_operation_id:itemCreator.operation.id,freeholder_controlled_item_request_digest:itemCreator.operation.requestDigest}};
 const actualInvoice=invoice(1000),intent={...v.intent,id:"pi_second",amount:1000,amount_received:1000,status:"succeeded",latest_charge:"ch_second"},payment={id:"inpay_second",invoice:"in_second",payment:{type:"payment_intent",payment_intent:"pi_second"},status:"paid",amount_requested:1000,amount_paid:1000};
 const cash={provider:"stripe",subscriptionId:v.target.resource.subscriptionId,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_second",providerPaymentIntentRef:"pi_second",providerChargeRef:"ch_second",providerCustomerRef:"cus_original",providerPlatformAccountId:v.target.resource.originalScope.providerPlatformAccountId,providerAccountId:v.target.resource.originalScope.providerAccountId,amountMinor:1000,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true};
 const current=v.append("read_invoice",{providerInvoiceRef:"in_second",providerSubscriptionRef:"sub_original",bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest},()=>({facts:[{kind:"invoice_read",raw:actualInvoice},{kind:"invoice_payments_read",raw:{data:[payment],has_more:false}},{kind:"intent_read",raw:intent},{kind:"cash_observed",raw:{cash,invoice:actualInvoice,intent,invoicePayment:payment}},{kind:"invoice_lines_read",raw:{data:[line],has_more:false}},{kind:"price_read",raw:{id:"price_second",currency:"cad",product:"prod_original",unit_amount:1000}}],
  result:{providerInvoiceRef:"in_second",providerSubscriptionRef:"sub_original",providerCustomerRef:"cus_original",currency:"CAD",status:"paid",totalMinor:1000,paidMinor:1000,remainingMinor:0,autoAdvance:false,completePayments:true,completeLines:true,actualInvoice,actualPayments:[payment],actualIntents:[intent],actualCash:[cash],actualLines:[line],actualPrices:[{id:"price_second",currency:"cad",product:"prod_original",unit_amount:1000}],suppliesPaidAuthority:false,financiallyQuiesced:false}}));
 const receiptId=randomUUID(),originalFact=current.facts.find(row=>row.actual.kind==="cash_observed"),lineFact=current.facts.find(row=>row.actual.kind==="invoice_lines_read"),creatorFact=creator.facts[0];if(!originalFact||!lineFact||!creatorFact)throw Error("Missing prepared genuine signed original facts");
 const target:ControlledRawTarget={resource:v.target.resource,history:v.target.history,manifest,binding:{collectionId:manifest.collectionId,resourceId:v.target.resource.id,originKind:"created_draft",creatorOperationId:creator.operation.id,providerInvoiceRef:"in_second",operationId:creator.operation.id,callId:creator.call.id,factId:creatorFact.id,originalEvidenceDigest:sha,createdAt:new Date()},proofs:[],period:{...v.target.period},
  components:[{...sourceComponent,id:componentId,collectionId:manifest.collectionId}],itemReceipts:[{componentId,resourceId:v.target.resource.id,originKind:"invoice_item",creatorOperationId:itemCreator.operation.id,providerInvoiceItemRef:"ii_second",providerInvoiceLineRef:"il_second",providerPriceRef:"price_second",operationId:current.operation.id,callId:current.call.id,factId:lineFact.id,originalEvidenceDigest:sha,createdAt:new Date()}],canonicalPaidMinor:1000,canonicalRefundedMinor:0,cash:[{receiptId,paymentId:randomUUID(),resourceId:v.target.resource.id,canonicalInvoiceId:manifest.canonicalInvoiceId,providerInvoiceRef:"in_second",providerIntentRef:"pi_second",providerChargeRef:"ch_second",amountMinor:1000,currency:"CAD"}]};
 v.target.history.chargeOrigins.push({receiptId,resourceId:v.target.resource.id,operationId:current.operation.id,callId:current.call.id,factId:originalFact.id,originalEvidenceDigest:merchantTaxDigest({resource:v.target.resource,operation:current.operation,call:current.call,fact:originalFact,cash}),createdAt:new Date()});v.target.history.count++;
 return{target,invoice:actualInvoice,current};
}
describe("genuine signed raw facts with a typed retained-unapplied projection",()=>{
 it.each([false,true])("preserves actual canonical paid zero while identifying retained full/partial bank cash; partial=%s",partial=>{
  const v=retainedVector({partial}),before=merchantTaxDigest(v.target.history),actual=classifyControlledTargetRawFacts([v.target]);expect(actual.unresolvedFactIds).toEqual([]);
  expect(actual.resolutions.filter(row=>v.review().rawPositiveFactIds.includes(row.factId)).every(row=>row.disposition==="retained_unapplied_cash"&&row.receiptIds.includes(v.owner.receiptId))).toBe(true);
  expect(v.target.cash).toEqual([]);expect(v.target.canonicalPaidMinor).toBe(0);expect(v.target.prospective?.actualBankRemainingMinor).toBe(partial?500:0);
  expect(merchantTaxDigest(v.target.history)).toBe(before);expect(JSON.stringify(v.target.prospective)).not.toMatch(/paymentId|principalSafe|paidAccess|allowed/);
 });
 it.each(["resource","collection","invoice","origin-operation","manifest-caller","charge","currency","amount","fake-paid"] as const)("does not adopt retained cash through a foreign or invented %s",change=>{
  const v=retainedVector(),projection=v.target.prospective;if(!projection)throw Error("Missing prepared retained projection");const first=projection.receipts[0];if(!first)throw Error("Missing prepared exact retained receipt");
  if(change==="resource")v.target.prospective={...projection,resourceId:randomUUID()};
  if(change==="collection")v.target.prospective={...projection,collectionId:randomUUID()};
  if(change==="invoice")v.target.prospective={...projection,invoiceId:randomUUID()};
  if(change==="origin-operation")v.target.prospective={...projection,receipts:[{...first,originOperationId:randomUUID()}]};
  if(change==="manifest-caller")v.target.prospective={...projection,manifestCallId:randomUUID()};
  if(change==="charge")v.target.prospective={...projection,receipts:[{...first,providerChargeRef:"ch_foreign"}]};
  if(change==="currency")v.target.prospective={...projection,receipts:[{...first,currency:"USD"}]};
  if(change==="amount")v.target.prospective={...projection,receipts:[{...first,amountMinor:999}]};
  if(change==="fake-paid")v.target.prospective={...projection,actualCanonicalPaidMinor:1000};
  const actual=classifyControlledTargetRawFacts([v.target]);expect(v.review().rawPositiveFactIds.every(id=>actual.unresolvedFactIds.includes(id))).toBe(true);expect(v.target.canonicalPaidMinor).toBe(0);
 });
 it("retains an earlier real contradictory positive occurrence despite a complete later retained receipt proof",()=>{const v=retainedVector({contradictory:true}),first=v.target.history.facts.find(row=>row.actual.kind==="intent_read"&&row.actual.raw.amount_received===1001);if(!first)throw Error("Missing prepared genuine contradictory occurrence");expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(first.id);expect(v.target.history.facts).toContain(first);});
 it("never waives a genuine older unfinished physical caller",()=>{const v=retainedVector({unfinished:true}),actual=classifyControlledTargetRawFacts([v.target]);expect(actual.resolutions).toEqual([]);expect(v.target.history.unfinished).toHaveLength(1);});
});
describe("complete actual owner sets in signed multi-invoice facts",()=>{
 function mixed(retained=false){const v=retained?retainedVector():vector(),second=secondOwnedInvoice(v),original=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!original)throw Error("Missing prepared original bank invoice");const list=v.append("list_invoices",{providerSubscriptionRef:"sub_original",bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest},()=>({facts:[{kind:"invoice_list_read",raw:{data:[original.actual.raw,second.invoice],has_more:false}}],result:{observed:true}}));return{v,second,list};}
 it.each([false,true])("retains each exact distinct known invoice/creator/PI proof with no invented single owner; retained=%s",retained=>{
  const{v,second,list}=mixed(retained),fact=list.facts[0];if(!fact)throw Error("Missing prepared signed multi-invoice fact");const before=merchantTaxDigest(v.target.history),actual=classifyControlledTargetRawFacts([v.target,second.target]),resolved=actual.resolutions.find(row=>row.factId===fact.id);
  expect(actual.unresolvedFactIds).not.toContain(fact.id);expect(resolved).toMatchObject({collectionId:null,proofOperationId:null,proofCallId:null,canonicalRefundedMinor:null,disposition:retained?"retained_unapplied_cash":"canonical_cash"});
  if(!resolved||resolved.collectionId!==null)throw Error("Expected explicit actual multiple-owner proof");expect(resolved.collectionIds).toEqual([v.target.manifest.collectionId,second.target.manifest.collectionId].sort());expect(resolved.bankProofs).toHaveLength(2);expect(resolved.canonicalRefunds).toHaveLength(2);
  expect(merchantTaxDigest(v.target.history)).toBe(before);expect(v.target.canonicalPaidMinor).toBe(retained?0:1000);
 });
 it("a single owned invoice in a shared-resource list keeps its actual owner rather than every outer target",()=>{const{v,second}=mixed(),original=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!original)throw Error("Missing prepared original invoice");const list=v.append("list_invoices",{providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"invoice_list_read",raw:{data:[original.actual.raw],has_more:false}}],result:{observed:true}})),fact=list.facts[0];if(!fact)throw Error("Missing prepared signed fact");expect(classifyControlledTargetRawFacts([v.target,second.target]).resolutions.find(row=>row.factId===fact.id)?.collectionId).toBe(v.target.manifest.collectionId);});
 it.each(["unknown","duplicate","ambiguous","missing-proof"] as const)("keeps %s mixed atoms as debt instead of using equal values or a partial owner list",change=>{
  const{v,second}=mixed(),original=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!original)throw Error("Missing prepared original bank invoice");
  const data=[original.actual.raw,change==="unknown"?{...second.invoice,id:"in_unknown"}:second.invoice];if(change==="duplicate")data.push(second.invoice);
  const list=v.append("list_invoices",{providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"invoice_list_read",raw:{data,has_more:false}}],result:{observed:true}})),fact=list.facts[0];if(!fact)throw Error("Missing prepared signed mixed fact");
  const targets=[v.target,second.target];if(change==="ambiguous")targets.push({...second.target,manifest:{...second.target.manifest,collectionId:randomUUID()}});
  if(change==="missing-proof")v.target.history.verifications=v.target.history.verifications.filter(row=>row.operationId!==second.current.operation.id);
  const actual=classifyControlledTargetRawFacts(targets);expect(actual.unresolvedFactIds).toContain(fact.id);expect(actual.resolutions.some(row=>row.factId===fact.id)).toBe(false);expect(v.target.history.facts).toContain(fact);
 });
});
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

/** Full returned list + independent reads use real Ed25519 proofs above; the
 * canonical projection remains mock-only. No DB/service authority is created. */
function withBootstrapInventory(options:{unknown?:boolean;foreignCustomer?:boolean;historicalPositive?:boolean;missingOriginal?:boolean;incomplete?:boolean}={}){
 const v=vector({bootstrapZero:!options.missingOriginal}),invoice={...v.preparationInvoice,...(options.unknown?{id:"in_unknown_zero"}:{}),...(options.foreignCustomer?{customer:"cus_foreign"}:{})};
 const actual=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!actual)throw Error("Missing prepared target invoice");
 const list=v.append("list_invoices",{providerSubscriptionRef:"sub_original",bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest},()=>({facts:[{kind:"invoice_list_read",raw:{data:[options.historicalPositive?{...invoice,total:1,subtotal:1,amount_due:1,amount_paid:1}:invoice,actual.actual.raw],has_more:false}}],result:{complete:true,providerSubscriptionRef:"sub_original",providerInvoiceRefs:[String(invoice.id),"in_original"],actualInvoices:[invoice,actual.actual.raw]}}));
 const original=v.target.history.verifications.find(row=>row.operationId===v.current.operation.id);if(!original)throw Error("Missing prepared returned original read");
 v.append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:v.current.facts.map(row=>row.actual),result:original.actualResult}));
 v.append("read_invoice",{providerInvoiceRef:String(invoice.id)},()=>({facts:[{kind:"invoice_read",raw:invoice},{kind:"invoice_payments_read",raw:{data:[],has_more:false}},{kind:"invoice_lines_read",raw:{data:[],has_more:false}}],result:{providerInvoiceRef:invoice.id,providerSubscriptionRef:"sub_original",providerCustomerRef:options.foreignCustomer?"cus_foreign":"cus_original",currency:"CAD",status:"paid",totalMinor:0,paidMinor:0,remainingMinor:0,autoAdvance:false,completePayments:!options.incomplete,completeLines:true,actualInvoice:invoice,actualCash:[],actualPayments:[],actualIntents:[],actualLines:[],actualPrices:[],suppliesPaidAuthority:false,financiallyQuiesced:false}}));
 v.target.canonicalCount=12;const fact=list.facts[0];if(!fact)throw Error("Missing prepared list fact");return{v,fact};
}
describe("separate genuine original zero-preparation evidence in mixed raw lists",()=>{
 it("binds original bootstrap and actual fresh inventory without inventing another canonical owner",()=>{const{v,fact}=withBootstrapInventory(),before=merchantTaxDigest(v.target.history),actual=classifyControlledTargetRawFacts([v.target]),resolution=actual.resolutions.find(row=>row.factId===fact.id);
  expect(actual.unresolvedFactIds).not.toContain(fact.id);expect(resolution).toMatchObject({collectionId:v.target.manifest.collectionId,disposition:"canonical_cash",receiptIds:[v.target.cash[0]?.receiptId],preparationProofs:[{kind:"original_bootstrap_zero",resourceId:v.target.resource.id,providerInvoiceRef:"in_bootstrap"}]});
  expect(resolution?.bankProofs).toHaveLength(1);expect(v.target.cash).toHaveLength(1);expect(merchantTaxDigest(v.target.history)).toBe(before);expect(JSON.stringify(resolution?.preparationProofs)).not.toMatch(/paymentId|canonicalInvoiceId|amountMinor|allowed|principalSafe/);
 });
 it.each(["unknown","foreignCustomer","historicalPositive","missingOriginal","incomplete"] as const)("keeps %s zero-looking/contradictory list atoms as actual debt",change=>{const{v,fact}=withBootstrapInventory({[change]:true});expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);expect(v.target.history.facts).toContain(fact);});
 it("refuses preparation adoption when the real canonical bound is absent",()=>{const{v,fact}=withBootstrapInventory();delete v.target.canonicalCount;expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
 it("retains an actual unfinished physical caller rather than borrowing the fresh zero read",()=>{const{v,fact}=withBootstrapInventory();v.append("read_invoice",{providerInvoiceRef:"in_bootstrap"},()=>({facts:[],result:{}}),true);expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
});

/** Two genuine signed returned cohorts on ONE immutable original invoice;
 * canonical owner rows remain explicitly mock projections for this PURE test. */
function cumulativePaidVector(){
 const v=vector({partial:true}),prior=v.target.history.verifications.find(row=>row.operationId===v.current.operation.id),first=v.target.cash[0];
 if(!prior||!first)throw Error("Missing original actual partial cohort");
 const oldCash=v.current.facts.find(row=>row.actual.kind==="cash_observed"),oldPayment=v.current.facts.find(row=>row.actual.kind==="invoice_payments_read");
 if(!oldCash||!oldPayment||!Array.isArray(oldPayment.actual.raw.data))throw Error("Missing actual original payment/cash facts");
 const originalPayment=z.array(z.record(z.string(),z.unknown())).parse(oldPayment.actual.raw.data)[0];if(!originalPayment)throw Error("Missing original exact payment row");
 const intent={...v.intent,id:"pi_later",amount:500,amount_received:500,latest_charge:"ch_later"},payment={...originalPayment,id:"inpay_later",amount_requested:500,amount_paid:500,payment:{type:"payment_intent",payment_intent:"pi_later"}};
 const originalCash=z.record(z.string(),z.unknown()).parse(oldCash.actual.raw.cash),cash={...originalCash,providerPaymentIntentRef:"pi_later",providerChargeRef:"ch_later",amountMinor:500};
 const actualInvoice=v.invoice(1000),facts:MerchantControlledObservation[]=[{kind:"invoice_read",raw:actualInvoice},{kind:"invoice_payments_read",raw:{data:[originalPayment,payment],has_more:false}},
  {kind:"intent_read",raw:v.intent},{kind:"intent_read",raw:intent},{kind:"cash_observed",raw:{...oldCash.actual.raw,invoice:actualInvoice}},{kind:"cash_observed",raw:{cash,invoice:actualInvoice,intent,invoicePayment:payment}},
  ...v.current.facts.filter(row=>["invoice_lines_read","price_read"].includes(row.actual.kind)).map(row=>row.actual)];
 const result={...prior.actualResult,status:"paid",paidMinor:1000,remainingMinor:0,actualInvoice,actualPayments:[originalPayment,payment],actualIntents:[v.intent,intent],actualCash:[originalCash,cash]};
 const current=v.append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts,result})),originFact=current.facts.find(row=>row.actual.kind==="cash_observed"&&z.record(z.string(),z.unknown()).parse(row.actual.raw.cash).providerPaymentIntentRef==="pi_later");
 if(!originFact)throw Error("Missing genuinely signed later positive occurrence");const receiptId=randomUUID();
 v.target.cash.push({...first,receiptId,paymentId:randomUUID(),providerIntentRef:"pi_later",providerChargeRef:"ch_later",amountMinor:500});
 v.target.history.chargeOrigins.push({receiptId,resourceId:v.target.resource.id,operationId:current.operation.id,callId:current.call.id,factId:originFact.id,originalEvidenceDigest:merchantTaxDigest({resource:v.target.resource,operation:current.operation,call:current.call,fact:originFact,cash}),createdAt:new Date()});v.target.history.count++;
 v.target.canonicalPaidMinor=1000;v.target.canonicalCount=12;
 return{v,current,result,facts,prior,first};
}
describe("exact historical returned cohorts across cumulative partial cash",()=>{
 it("retains the genuine earlier500 and later1000 invoice facts with exact original receipt owners",()=>{const{v,first}=cumulativePaidVector(),before=merchantTaxDigest(v.target.history),actual=classifyControlledTargetRawFacts([v.target]),oldInvoice=v.current.facts.find(row=>row.actual.kind==="invoice_read");
  if(!oldInvoice)throw Error("Missing original partial invoice fact");expect(actual.unresolvedFactIds).toEqual([]);expect(actual.resolutions.find(row=>row.factId===oldInvoice.id)?.historicalPaidProofs).toEqual([{collectionId:v.target.manifest.collectionId,operationId:v.current.operation.id,callId:v.current.call.id,resultDigest:merchantTaxDigest(v.target.history.verifications.find(row=>row.operationId===v.current.operation.id)?.actualResult),receiptIds:[first.receiptId]}]);
  expect(actual.resolutions.find(row=>row.factId===oldInvoice.id)?.receiptIds).toEqual([first.receiptId]);expect(v.target.canonicalPaidMinor).toBe(1000);expect(v.target.cash.map(row=>row.amountMinor)).toEqual([500,500]);expect(merchantTaxDigest(v.target.history)).toBe(before);
 });
 it("refuses a smaller invented historical balance rather than using <= current paid",()=>{const{v,result,facts}=cumulativePaidVector(),bad=v.append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[{kind:"invoice_read",raw:{...v.invoice(500),amount_paid:499,amount_remaining:501}}],result:{retainedBeforeFailure:true}}));v.append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts,result}));const fact=bad.facts[0];if(!fact)throw Error("Missing actual signed contradiction");expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
 it("does not backfill a missing original normalized returned cohort from a newer full read",()=>{const{v}=cumulativePaidVector(),old=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!old)throw Error("Missing original partial occurrence");v.target.history.verifications=v.target.history.verifications.filter(row=>row.operationId!==v.current.operation.id);expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(old.id);});
 it("keeps old partial money unknown when an actual owner disappears despite equal final cash",()=>{const{v}=cumulativePaidVector(),old=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!old)throw Error("Missing original positive occurrence");v.target.cash=v.target.cash.filter(row=>row.providerIntentRef!=="pi_original");expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(old.id);});
 it("never releases a genuinely unfinished old caller with the later complete bank cohort",()=>{const{v}=cumulativePaidVector();v.append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[],result:{}}),true);expect(classifyControlledTargetRawFacts([v.target]).resolutions).toEqual([]);});
 it("requires the complete source bound instead of ignoring old original cash inventory",()=>{const{v}=cumulativePaidVector(),old=v.current.facts.find(row=>row.actual.kind==="invoice_read");if(!old)throw Error("Missing original partial occurrence");v.target.canonicalCount=5000;expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(old.id);});
});

/** Genuine signed list→independent partial GET→next item writer→CURRENT GET.
 * Only the canonical projections are mocked; original calls/facts/finishes
 * retain their actual Ed25519 purposes and immutable request/body digests. */
function nonpayableSubsetVector(change?:"price"|"creator"|"incomplete"|"foreignCustomer"|"inventedAmount"){
 const v=vector({paid:false,nonpayableTax:true}),tax=v.target.components.find(row=>row.kind==="merchant_declared_tax_collection"),taxManifest=v.target.manifest.components.find(row=>row.kind==="merchant_declared_tax_collection");if(!tax||!taxManifest)throw Error("Declare the complete mock canonical target before signing its original creator.");
 const invoice=v.invoice(0,1000),listed=change==="inventedAmount"?{...invoice,total:999,subtotal:999,amount_due:999,amount_remaining:999}:invoice;
 const list=v.append("list_invoices",{bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest,providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"invoice_list_read",raw:{data:[listed],has_more:false}}],result:{complete:true,providerInvoiceRefs:["in_original"],actualInvoices:[listed],providerSubscriptionRef:"sub_original"}}));
 const line=structuredClone(v.line);if(change==="creator"){const metadata=z.record(z.string(),z.unknown()).parse(line.metadata);line.metadata={...metadata,freeholder_controlled_item_request_digest:"b".repeat(64)};}
 const price={id:"price_original",currency:"cad",product:"prod_original",unit_amount:change==="price"?999:1000};
 const oldInvoice=change==="foreignCustomer"?{...invoice,customer:"cus_foreign"}:invoice;
 const oldInventory={providerInvoiceRef:"in_original",providerSubscriptionRef:"sub_original",providerCustomerRef:change==="foreignCustomer"?"cus_foreign":"cus_original",currency:"CAD",status:"draft",totalMinor:1000,paidMinor:0,remainingMinor:1000,autoAdvance:false,completePayments:true,completeLines:true,actualInvoice:oldInvoice,actualPayments:[],actualIntents:[],actualCash:[],actualLines:[line],actualPrices:[price],suppliesPaidAuthority:false,financiallyQuiesced:false};
 const old=v.append("read_invoice",{providerInvoiceRef:"in_original",providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"invoice_read",raw:oldInvoice},{kind:"invoice_payments_read",raw:{data:[],has_more:false}},{kind:"invoice_lines_read",raw:{data:[line],has_more:change==="incomplete"}},{kind:"price_read",raw:price}],result:oldInventory}));
 const creator=v.append("add_invoice_component",{bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",manifest:v.target.manifest,calendar:v.calendar,
  invoiceOrigin:{kind:"created_draft",creatorOperationId:v.creator.operation.id,creatorRequestDigest:v.creator.operation.requestDigest},lineBindings:v.target.itemReceipts.map(row=>({componentId:row.componentId,providerInvoiceLineRef:row.providerInvoiceLineRef,providerInvoiceItemRef:row.providerInvoiceItemRef,providerPriceRef:row.providerPriceRef})),componentId:tax.id},operation=>({facts:[{kind:"controlled_item_created",raw:{id:"ii_tax",invoice:"in_original",customer:"cus_original",amount:200,currency:"cad",metadata:{freeholder_controlled_collection_id:v.target.manifest.collectionId,freeholder_controlled_component_id:tax.id,freeholder_controlled_component_digest:tax.provenanceDigest,freeholder_canonical_target_digest:v.target.manifest.canonicalTargetDigest,freeholder_controlled_item_operation_id:operation.id,freeholder_controlled_item_request_digest:operation.requestDigest}}}],result:{providerInvoiceRef:"in_original",componentId:tax.id,providerInvoiceItemRef:"ii_tax",providerPriceRef:"price_tax",requiresIndependentRead:true}}));
 const created=creator.facts.find(row=>row.actual.kind==="controlled_item_created");if(!created)throw Error("Retain actual signed tax-item creation.");
 const taxLine={id:"il_tax",amount:200,currency:"cad",quantity:1,period:{start:Date.parse(start)/1000,end:Date.parse(end)/1000},parent:{type:"invoice_item_details",invoice_item_details:{invoice_item:"ii_tax"}},pricing:{price_details:{price:"price_tax",product:"prod_tax"}},metadata:created.actual.raw.metadata,discount_amounts:[],taxes:[]};
 const currentInvoice=v.invoice(0,1200),currentPrices=[{id:"price_original",currency:"cad",product:"prod_original",unit_amount:1000},{id:"price_tax",currency:"cad",product:"prod_tax",unit_amount:200}],currentLines=[v.line,taxLine];
 const current=v.append("read_invoice",{providerInvoiceRef:"in_original",providerSubscriptionRef:"sub_original"},()=>({facts:[{kind:"invoice_read",raw:currentInvoice},{kind:"invoice_payments_read",raw:{data:[],has_more:false}},{kind:"invoice_lines_read",raw:{data:currentLines,has_more:false}},...currentPrices.map(raw=>({kind:"price_read" as const,raw}))],result:{...oldInventory,providerCustomerRef:"cus_original",totalMinor:1200,remainingMinor:1200,actualInvoice:currentInvoice,actualLines:currentLines,actualPrices:currentPrices}}));
 const lines=current.facts.find(row=>row.actual.kind==="invoice_lines_read");if(!lines)throw Error("Retain the independent complete current tax line read.");
 v.target.itemReceipts.push({componentId:tax.id,resourceId:v.target.resource.id,originKind:"invoice_item",creatorOperationId:creator.operation.id,providerInvoiceItemRef:"ii_tax",providerInvoiceLineRef:"il_tax",providerPriceRef:"price_tax",operationId:current.operation.id,callId:current.call.id,factId:lines.id,originalEvidenceDigest:sha,createdAt:new Date()});
 v.target.canonicalCount=14;const fact=list.facts[0];if(!fact)throw Error("Retain the actual signed old list occurrence.");return{v,list,old,creator,current,fact};
}
describe("exact nonpayable historical list construction cohort",()=>{
 it("proves an old original NET subset through its actual independent GET before tax creation, retaining a separate current full read",()=>{
  const{v,list,old,creator,current,fact}=nonpayableSubsetVector(),before=merchantTaxDigest(v.target.history),actual=classifyControlledTargetRawFacts([v.target]),resolution=actual.resolutions.find(row=>row.factId===fact.id);
  expect(actual.unresolvedFactIds).not.toContain(fact.id);expect(resolution).toMatchObject({disposition:"owned_nonautomatic_obligation",receiptIds:[],nonpayableSubsetProofs:[{kind:"historical_nonpayable_subset",collectionId:v.target.manifest.collectionId,listOperationId:list.operation.id,listCallId:list.call.id,readOperationId:old.operation.id,readCallId:old.call.id,nextMutationOperationId:creator.operation.id,lineIds:["il_original"]}],bankProofs:[{collectionId:v.target.manifest.collectionId,operationId:current.operation.id,callId:current.call.id}]});
  expect(v.target.canonicalPaidMinor).toBe(0);expect(v.target.cash).toEqual([]);expect(merchantTaxDigest(v.target.history)).toBe(before);
 });
 it.each(["price","creator","incomplete","foreignCustomer","inventedAmount"] as const)("retains the original list as review after a genuinely signed %s contradiction",change=>{const{v,fact}=nonpayableSubsetVector(change);expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);expect(v.target.history.facts).toContain(fact);});
 it("does not borrow the pre-list read or a post-mutation current read when the exact intervening returned cohort is missing",()=>{const{v,old,fact}=nonpayableSubsetVector();v.target.history.verifications=v.target.history.verifications.filter(row=>row.operationId!==old.operation.id);expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
 it("still requires the complete current physical read independently of the historical zero-payment cohort",()=>{const{v,current,fact}=nonpayableSubsetVector();v.target.history.verifications=v.target.history.verifications.filter(row=>row.operationId!==current.operation.id);expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
 it("keeps a genuine unfinished actual caller as debt even when both bank snapshots look owned",()=>{const{v,fact}=nonpayableSubsetVector();v.append("read_invoice",{providerInvoiceRef:"in_original"},()=>({facts:[],result:{}}),true);expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
 it("requires the full source budget instead of omitting historical physical evidence",()=>{const{v,fact}=nonpayableSubsetVector();v.target.canonicalCount=5000;expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(fact.id);});
});

/** Chronological signed bank vector: original NET→tax draft, actual open
 * preflight, pay ACK, complete positive GET, then independent fresh manifest.
 * Only canonical/receipt projections are mock PURE inputs; no DB/ServiceContext
 * or bank authority is supplied. The genuine native uses the actual SDK stream. */
function payCohortVector(change?:"missingAnchor"|"missingAck"|"duplicateAck"|"incompleteBefore"|"incompleteAfter"|"duplicateLine"|"foreignInvoice"|"foreignCreator"|"wrongPrice"|"foreignCash"|"outsideAnchor"|"unfinished",partial=false,paginated=false){
 const{v,current}=nonpayableSubsetVector(),old=v.target.history.verifications.find(row=>row.operationId===current.operation.id);
 if(!old)throw Error("Retain the actual signed full original unpaid draft vector.");
 const oldInventory=z.record(z.string(),z.unknown()).parse(old.actualResult),lines=z.array(z.record(z.string(),z.unknown())).parse(oldInventory.actualLines),prices=z.array(z.record(z.string(),z.unknown())).parse(oldInventory.actualPrices);
 const open={...v.invoice(0,1200),status:"open"},amount=partial?500:1200,paidInvoice=v.invoice(amount,1200);
 const payload={bootstrapOperationId:v.calendar.bootstrapOperationId,bootstrapRequestDigest:v.calendar.bootstrapRequestDigest,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",manifest:v.target.manifest,calendar:v.calendar,
  invoiceOrigin:{kind:"created_draft",creatorOperationId:v.creator.operation.id,creatorRequestDigest:v.creator.operation.requestDigest},lineBindings:v.target.itemReceipts.map(row=>({componentId:row.componentId,providerInvoiceLineRef:row.providerInvoiceLineRef,providerInvoiceItemRef:row.providerInvoiceItemRef,providerPriceRef:row.providerPriceRef}))};
 v.append("finalize_invoice",payload,()=>({facts:[{kind:"controlled_invoice_finalized",raw:open}],result:{providerInvoiceRef:"in_original",requiresIndependentRead:true,suppliesPaidAuthority:false}}));
 const intent={id:"pi_pay_cohort",customer:"cus_original",amount:1200,amount_received:amount,amount_capturable:0,currency:"cad",status:"succeeded",latest_charge:"ch_pay_cohort",transfer_data:null,on_behalf_of:null};
 const payment={id:"inpay_pay_cohort",invoice:"in_original",payment:{type:"payment_intent",payment_intent:"pi_pay_cohort"},status:"paid",amount_requested:1200,amount_paid:amount};
 const cash={provider:"stripe",subscriptionId:v.target.resource.subscriptionId,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:intent.id,providerChargeRef:"ch_pay_cohort",providerCustomerRef:"cus_original",
  providerPlatformAccountId:v.target.resource.originalScope.providerPlatformAccountId,providerAccountId:v.target.resource.originalScope.providerAccountId,amountMinor:amount,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true};
 const bankFacts:MerchantControlledObservation[]=[{kind:"invoice_read",raw:paidInvoice},{kind:"invoice_payments_read",raw:{data:[payment],has_more:false}},{kind:"intent_read",raw:intent},{kind:"cash_observed",raw:{cash,invoice:paidInvoice,intent,invoicePayment:payment}},
  {kind:"invoice_lines_read",raw:{data:lines,has_more:false}},...prices.map(raw=>({kind:"price_read" as const,raw}))];
 const pay=v.append("pay_invoice",payload,()=>{
  const beforeLines=structuredClone(lines),beforePrices=structuredClone(prices);
  if(change==="foreignCreator"){const line=beforeLines[0];if(!line)throw Error("Require the original NET line.");line.metadata={...z.record(z.string(),z.unknown()).parse(line.metadata),freeholder_controlled_item_request_digest:"b".repeat(64)};}
  if(change==="wrongPrice"){const price=beforePrices[0];if(!price)throw Error("Require original price.");price.unit_amount=999;}
  const first:MerchantControlledObservation[]=[];
  if(change==="outsideAnchor")first.push({kind:"invoice_lines_read",raw:{data:beforeLines,has_more:false}});
  if(change!=="missingAnchor")first.push({kind:"invoice_read",raw:change==="foreignInvoice"?{...open,id:"in_foreign"}:open});
  first.push({kind:"invoice_payments_read",raw:{data:[],has_more:change==="incompleteBefore"}});
  if(paginated){first.push({kind:"invoice_lines_read",raw:{data:beforeLines.slice(0,1),has_more:true}},...beforePrices.slice(0,1).map(raw=>({kind:"price_read" as const,raw})),
    {kind:"invoice_lines_read",raw:{data:beforeLines.slice(1),has_more:false}},...beforePrices.slice(1).map(raw=>({kind:"price_read" as const,raw})));}
  else first.push({kind:"invoice_lines_read",raw:{data:change==="duplicateLine"?[...beforeLines,beforeLines[0]]:beforeLines,has_more:false}},...beforePrices.map(raw=>({kind:"price_read" as const,raw})));
  if(change!=="missingAck")first.push({kind:"controlled_invoice_paid",raw:paidInvoice});
  if(change==="duplicateAck")first.push({kind:"controlled_invoice_paid",raw:paidInvoice});
  const after=structuredClone(bankFacts);
  if(change==="incompleteAfter"){const page=after.find(row=>row.kind==="invoice_lines_read");if(!page)throw Error("Keep complete post-pay lines.");page.raw.has_more=true;}
  if(change==="foreignCash"){const fact=after.find(row=>row.kind==="cash_observed");if(!fact)throw Error("Keep actual positive cash.");fact.raw.cash={...cash,providerPlatformAccountId:"acct_foreign"};}
  return{facts:[...first,...after],result:{providerInvoiceRef:"in_original",requiresIndependentRead:true,suppliesPaidAuthority:false}};
 },change==="unfinished");
 const originFact=pay.facts.find(row=>row.actual.kind==="cash_observed"),receiptId=randomUUID();if(!originFact)throw Error("Retain the original pay occurrence.");
 v.target.history.chargeOrigins.push({receiptId,resourceId:v.target.resource.id,operationId:pay.operation.id,callId:pay.call.id,factId:originFact.id,
  originalEvidenceDigest:merchantTaxDigest({resource:v.target.resource,operation:pay.operation,call:pay.call,fact:originFact,cash:z.record(z.string(),z.unknown()).parse(originFact.actual.raw.cash)}),createdAt:new Date()});
 const inventory={...oldInventory,status:paidInvoice.status,totalMinor:1200,paidMinor:amount,remainingMinor:1200-amount,actualInvoice:paidInvoice,actualPayments:[payment],actualIntents:[intent],actualCash:[cash],actualLines:lines,actualPrices:prices};
 const result={providerInvoiceRef:"in_original",manifestDigest:merchantTaxDigest(v.target.manifest),customerFinancialDigest:sha,exactManifest:true,suppliesPaidAuthority:false,inventory};
 const full=v.append("read_manifest",payload,()=>({facts:bankFacts,result}));
 v.target.proofs.push({id:randomUUID(),collectionId:v.target.manifest.collectionId,operationId:full.operation.id,callId:full.call.id,resultDigest:merchantTaxDigest(result),canonicalTargetDigest:v.target.manifest.canonicalTargetDigest,customerFinancialDigest:sha,createdAt:new Date()});
 v.target.prospective={purpose:"controlled_cash_prospective_read.v1",collectionId:v.target.manifest.collectionId,resourceId:v.target.resource.id,subscriptionId:v.target.resource.subscriptionId,invoiceId:v.target.manifest.canonicalInvoiceId,
  acceptedQuoteDigest:v.target.manifest.acceptedQuoteDigest,canonicalTargetDigest:v.target.manifest.canonicalTargetDigest,manifestOperationId:full.operation.id,manifestCallId:full.call.id,manifestResultDigest:merchantTaxDigest(result),manifestDigest:merchantTaxDigest(v.target.manifest),
  actualCanonicalPaidMinor:0,actualBankPaidMinor:amount,actualBankRemainingMinor:1200-amount,bankProofRevision:sha,parentPgRevision:sha,revision:sha,
  receipts:[{kind:"retained_unapplied",receiptId,collectionId:v.target.manifest.collectionId,resourceId:v.target.resource.id,subscriptionId:v.target.resource.subscriptionId,canonicalInvoiceId:v.target.manifest.canonicalInvoiceId,
   providerInvoiceRef:"in_original",providerIntentRef:intent.id,providerChargeRef:"ch_pay_cohort",amountMinor:amount,currency:"CAD",originOperationId:pay.operation.id,originCallId:pay.call.id,originFactId:originFact.id,
   inspectionId:randomUUID(),bankObservationId:randomUUID(),finishCallerId:randomUUID(),immutableBankRevision:sha,namespaceRevision:sha}]};
 return{v,pay,full,receiptId,pages:pay.facts.filter(row=>["invoice_lines_read","invoice_payments_read"].includes(row.actual.kind))};
}
describe("original pay caller with two honest complete inventory cohorts",()=>{
 it.each([false,true])("retains both actual same-caller page passes with partial=%s and separate current manifest, never inventing canonical payment",partial=>{
  const{v,pay,pages,receiptId}=payCohortVector(undefined,partial),before=merchantTaxDigest(v.target.history),actual=classifyControlledTargetRawFacts([v.target]);
  for(const page of pages){expect(actual.unresolvedFactIds).not.toContain(page.id);const resolution=actual.resolutions.find(row=>row.factId===page.id);
   expect(resolution?.inventoryCohortProofs).toHaveLength(1);const cohort=resolution?.inventoryCohortProofs?.[0];
   expect(cohort).toMatchObject({kind:"original_pay_inventory_cohort",operationId:pay.operation.id,callId:pay.call.id,payFactId:pay.facts.find(row=>row.actual.kind==="controlled_invoice_paid")?.id});
   expect(typeof cohort?.invoiceFactId).toBe("string");}
  expect(actual.resolutions.flatMap(row=>row.inventoryCohortProofs??[]).some(row=>row.phase==="after_pay"&&row.receiptIds.includes(receiptId))).toBe(true);
  expect(v.target.canonicalPaidMinor).toBe(0);expect(v.target.cash).toEqual([]);expect(merchantTaxDigest(v.target.history)).toBe(before);
 });
 it("retains all actual pagination facts within the before-pay pass without treating duplicate cross-pass line IDs as one occurrence",()=>{
  const{v,pay,pages}=payCohortVector(undefined,false,true),actual=classifyControlledTargetRawFacts([v.target]);
  for(const page of pages)expect(actual.unresolvedFactIds).not.toContain(page.id);
  const before=actual.resolutions.flatMap(row=>row.inventoryCohortProofs??[]).find(row=>row.phase==="before_pay");
  expect(before?.linePageFactIds).toEqual(pay.facts.filter(row=>row.actual.kind==="invoice_lines_read").slice(0,2).map(row=>row.id));
 });
 it.each(["missingAnchor","missingAck","duplicateAck","incompleteBefore","incompleteAfter","duplicateLine","foreignInvoice","foreignCreator","wrongPrice","foreignCash","outsideAnchor","unfinished"] as const)("retains genuinely signed %s as debt despite the independent fresh current proof",change=>{
  const{v,pages}=payCohortVector(change),actual=classifyControlledTargetRawFacts([v.target]);
  const nonempty=pages.filter(row=>Array.isArray(row.actual.raw.data)&&row.actual.raw.data.length>0);
  expect(nonempty.length).toBeGreaterThan(0);expect(nonempty.some(row=>actual.unresolvedFactIds.includes(row.id))).toBe(true);
  for(const row of nonempty)expect(v.target.history.facts).toContain(row);
 });
 it("requires the separate complete current proof and full source budget in addition to the two original pass facts",()=>{
  const{v,pages,full}=payCohortVector();v.target.proofs=[];
  expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(pages[1]?.id);
  v.target.proofs.push({id:randomUUID(),collectionId:v.target.manifest.collectionId,operationId:full.operation.id,callId:full.call.id,resultDigest:merchantTaxDigest(v.target.history.verifications.find(row=>row.operationId===full.operation.id)?.actualResult),canonicalTargetDigest:v.target.manifest.canonicalTargetDigest,customerFinancialDigest:sha,createdAt:new Date()});
  v.target.canonicalCount=5000;expect(classifyControlledTargetRawFacts([v.target]).unresolvedFactIds).toContain(pages[1]?.id);
 });
});
