// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact frozen service-owned requests, original SDK I/O outside transactions.
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { defineOrchestratedService,ServiceError,type Actor } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { controlledOperationRequest,planControlledProviderOperation,controlledPreparationState } from "./controlled-provider-plan";
import { retainControlledProviderResource,assertControlledProviderPreparationReady } from "./controlled-provider-source";
import { withControlledProviderCall } from "./controlled-provider-runtime";
import { retainControlledProviderVerification } from "./controlled-provider-verification";
import { createMerchantPhaseProduct } from "./provider-phase-products";
const original=z.object({bootstrapOperationId:z.uuid(),bootstrapRequestDigest:z.string().regex(/^[a-f0-9]{64}$/),providerSubscriptionRef:z.string().regex(/^sub_[A-Za-z0-9_]+$/).max(200)});
const product=z.object({name:z.string().min(1).max(500),component:z.literal("merchant_declared_tax_collection")});
const productRead=product.extend({createdProductRef:z.string().regex(/^prod_[A-Za-z0-9_]+$/).max(200),originalProductOperationId:z.uuid(),originalProductRequestDigest:z.string().regex(/^[a-f0-9]{64}$/)});
export async function executeControlledOperation(operationId:string,caller:Actor){
 const system={kind:"system",request:caller.request} as const,source=await controlledOperationRequest.call({operationId},system);
 if(source.verifiedResult)return source.verifiedResult;
 const adapter=paymentAdapter("stripe"),{operation,scope}=source;
 const payload=z.record(z.string(),z.unknown()).parse(operation.originalRequest.payload),base={...scope,operationId:operation.id,requestDigest:operation.requestDigest,idempotencyKey:operation.idempotencyKey};
 const result=await withControlledProviderCall(operation.id,caller,async onObserved=>{
  switch(operation.kind){
   case"bootstrap":if(!adapter.createMerchantControlledBootstrap)break;return adapter.createMerchantControlledBootstrap({...base,onObserved});
   case"discover_bootstrap":if(!adapter.discoverMerchantControlledBootstrap)break;return adapter.discoverMerchantControlledBootstrap({...scope,...z.object({bootstrapOperationId:z.uuid(),bootstrapRequestDigest:z.string().regex(/^[a-f0-9]{64}$/)}).parse(payload),onObserved});
   case"read_bootstrap":if(!adapter.inspectMerchantControlledBootstrap)break;return adapter.inspectMerchantControlledBootstrap({...scope,...original.parse(payload),onObserved});
   case"pause_drafts":if(!adapter.pauseMerchantControlledBootstrap)break;return adapter.pauseMerchantControlledBootstrap({...base,...original.parse(payload),onObserved});
   case"read_calendar":if(!adapter.inspectMerchantControlledCalendar)break;return adapter.inspectMerchantControlledCalendar({...scope,...original.parse(payload),onObserved});
   case"cancel_calendar":if(!adapter.cancelMerchantControlledCalendar)break;return adapter.cancelMerchantControlledCalendar({...base,...original.parse(payload),onObserved});
   case"list_invoices":if(!adapter.listMerchantControlledInvoices)break;return adapter.listMerchantControlledInvoices({...scope,...original.parse(payload),onObserved});
   case"read_invoice":if(!adapter.inspectMerchantControlledInvoice)break;return adapter.inspectMerchantControlledInvoice({...scope,...original.extend({providerInvoiceRef:z.string().regex(/^in_[A-Za-z0-9_]+$/).max(200)}).parse(payload),onObserved});
   case"create_product":if(!adapter.createMerchantControlledTaxProduct)break;return adapter.createMerchantControlledTaxProduct({...base,...product.parse(payload),onObserved});
   case"read_product":if(!adapter.inspectMerchantControlledTaxProduct)break;return adapter.inspectMerchantControlledTaxProduct({...base,...productRead.parse(payload),onObserved});
  }
  throw new ServiceError("conflict","The exact admitted controlled provider operation is unsupported here; restore its real adapter rather than reconstructing or dispatching another request.");
 });
 const actual=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify(result)));
 const saved=await retainControlledProviderVerification.call({operationId},system);
 if(merchantTaxDigest(saved.result)!==merchantTaxDigest(actual))throw new ServiceError("conflict","Preserve the first actual returned bank result; a successor result cannot replace it.");
 return saved.result;
}
async function stage(resourceId:string,kind:"bootstrap"|"discover_bootstrap"|"read_bootstrap"|"pause_drafts"|"create_product"|"read_product"|"read_calendar"|"cancel_calendar"|"list_invoices",actor:Actor){
 const planned=await planControlledProviderOperation.call({resourceId,kind},{kind:"system",request:actor.request});return executeControlledOperation(planned.operationId,actor);
}
export const prepareControlledProviderCalendar=defineOrchestratedService({name:"subscriptions.prepareControlledProviderCalendar",summary:"Prepare only the accepted original zero-NET transport and prove draft collection pause; no positive phase, paid access or remote financial stop is implied.",
 kind:"mutation",permission:"scoped",writeClass:"money",input:z.object({subscriptionId:z.uuid()}),output:z.object({resourceId:z.uuid(),collectionPausedAsDraft:z.literal(true),positiveCollectionAdmissible:z.literal(false),fixedTaxRequiredBeforeCollection:z.literal(true)}),
 handler:async({subscriptionId},actor)=>{
  await assertControlledProviderPreparationReady.call({subscriptionId},{kind:"system",request:actor.request});
  await createMerchantPhaseProduct.call({subscriptionId},{kind:"system",request:actor.request});
  const resource=await retainControlledProviderResource.call({subscriptionId},{kind:"system",request:actor.request});
  const state=await controlledPreparationState.call({resourceId:resource.resourceId},{kind:"system",request:actor.request});
  if(state.closed)throw new ServiceError("conflict","The original zero transport is genuinely closed; it cannot be recreated or repurposed by preparation.");
  if(state.bootstrapAdmitted&&!state.pausedZeroVerified)throw new ServiceError("conflict","Recover the actual original creation and its current zero/pause proof first; preparation cannot replay an admitted POST.");
  if(!state.bootstrapAdmitted)await stage(resource.resourceId,"bootstrap",actor);
  let read=await stage(resource.resourceId,"read_bootstrap",actor);
  if(read.collectionPausedAsDraft!==true){await stage(resource.resourceId,"pause_drafts",actor);read=await stage(resource.resourceId,"read_bootstrap",actor);}
  const actual=z.object({collectionPausedAsDraft:z.literal(true),completeZeroRecurringItem:z.literal(true),fixedTaxRequiredBeforeCollection:z.literal(true),firstInvoiceFinancialState:z.literal("unverified")}).parse(read);
  // This prepares a collection transport only. Full original invoice/payment
  // enumeration, canonical dated tax/credit/fee and consent precede positive I/O.
  return{resourceId:resource.resourceId,collectionPausedAsDraft:actual.collectionPausedAsDraft,positiveCollectionAdmissible:false as const,fixedTaxRequiredBeforeCollection:actual.fixedTaxRequiredBeforeCollection};
 }});
export const recoverControlledProviderCalendar=defineOrchestratedService({name:"invoicing.recoverControlledProviderCalendar",summary:"Discover and verify the exact original stopped/finished zero-only bootstrap through new actual GETs, never replaying its POST or inventing its finish.",
 kind:"mutation",permission:"scoped",stepUp:true,writeClass:"money",input:z.object({resourceId:z.uuid()}),output:z.object({resourceId:z.uuid(),verified:z.boolean(),collectionPausedAsDraft:z.boolean()}),
 handler:async({resourceId},actor)=>{
  const discovered=await stage(resourceId,"discover_bootstrap",actor);
  const inventory=z.object({complete:z.literal(true),matches:z.array(z.object({providerSubscriptionRef:z.string(),providerInvoiceRef:z.string().nullable()})).max(5000)}).parse(discovered);
  if(inventory.matches.length!==1)throw new ServiceError("conflict","The original creation still has zero or multiple actual matching resources. Keep every original caller/fact; a new POST or amount match cannot resolve it.");
  let actual=await stage(resourceId,"read_bootstrap",actor);
  if(actual.collectionPausedAsDraft!==true){await stage(resourceId,"pause_drafts",actor);actual=await stage(resourceId,"read_bootstrap",actor);}
  return{resourceId,verified:actual.completeZeroRecurringItem===true,collectionPausedAsDraft:actual.collectionPausedAsDraft===true};
 }});
/** Cancellation is useful even when subscriptions are disabled or the old
 * agreement changed. The exact original resource still owns its real money. */
export const stopControlledProviderCalendar=defineOrchestratedService({name:"invoicing.stopControlledProviderCalendar",summary:"Cancel the exact actual original controlled calendar without proration or a new invoice, independently read cancellation and retain every current invoice/payment. Financial closure is a separate proof.",
 kind:"mutation",permission:"scoped",stepUp:true,writeClass:"money",input:z.object({resourceId:z.uuid()}),output:z.object({resourceId:z.uuid(),calendarCanceled:z.literal(true),invoiceCount:z.number().int().nonnegative(),financiallyQuiesced:z.literal(false)}),
 handler:async({resourceId},actor)=>{
  await stage(resourceId,"cancel_calendar",actor);
  const calendar=z.object({calendarCanceled:z.literal(true)}).parse(await stage(resourceId,"read_calendar",actor));
  const list=z.object({complete:z.literal(true),providerInvoiceRefs:z.array(z.string().regex(/^in_[A-Za-z0-9_]+$/)).max(5000)}).parse(await stage(resourceId,"list_invoices",actor));
  for(const providerInvoiceRef of list.providerInvoiceRefs){
   const planned=await planControlledProviderOperation.call({resourceId,kind:"read_invoice",providerInvoiceRef},{kind:"system",request:actor.request});
   await executeControlledOperation(planned.operationId,actor);
  }
  return{resourceId,calendarCanceled:calendar.calendarCanceled,invoiceCount:list.providerInvoiceRefs.length,financiallyQuiesced:false as const};
 }});
export default[prepareControlledProviderCalendar,recoverControlledProviderCalendar,stopControlledProviderCalendar];

export const recoverControlledProviderOperation=defineOrchestratedService({name:"invoicing.recoverControlledProviderOperation",summary:"Perform a new actual GET for an exact genuinely finished/stopped original controlled caller, retaining its original admission and outcome unchanged.",
 kind:"mutation",permission:"scoped",stepUp:true,writeClass:"money",input:z.object({operationId:z.uuid()}),output:z.object({observed:z.literal(true)}),handler:async({operationId},actor)=>{
  const source=await controlledOperationRequest.call({operationId},{kind:"system",request:actor.request}),{operation}=source;
  // The planner/claim rechecks the whole journal under the original locks.
  // No successful later operation can supersede a still-live earlier caller.
  if(operation.kind==="read_invoice"){
   const payload=original.extend({providerInvoiceRef:z.string().regex(/^in_[A-Za-z0-9_]+$/).max(200)}).parse(operation.originalRequest.payload);
   const planned=await planControlledProviderOperation.call({resourceId:operation.resourceId,kind:"read_invoice",providerInvoiceRef:payload.providerInvoiceRef},{kind:"system",request:actor.request});await executeControlledOperation(planned.operationId,actor);
  }else if(["read_calendar","cancel_calendar","list_invoices"].includes(operation.kind))await stage(operation.resourceId,"read_calendar",actor);
  else if(["bootstrap","discover_bootstrap","read_bootstrap","pause_drafts"].includes(operation.kind))await recoverControlledProviderCalendar.call({resourceId:operation.resourceId},actor);
  else throw new ServiceError("conflict","This exact original product/quote/collection operation still requires its dedicated authentic recovery path. Keep its caller, facts and money; no replacement POST or invented finish is allowed.");
  return{observed:true as const};
 }});
