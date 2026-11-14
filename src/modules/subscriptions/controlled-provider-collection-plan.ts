// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// No arbitrary bank payload: actual accepted canonical rows select every next call.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { moduleSettings } from "@/core/settings/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledResources,subscriptionControlledOperations } from "./controlled-provider-schema";
import { subscriptionCommercialTerms,subscriptions } from "./schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { controlledCalendarSource } from "./controlled-provider-calendar-source";
import { controlledCollectionPayload,controlledCalendarPayload } from "./controlled-provider-adapter-contract";
import { controlledTargetFinancialAuthority } from "./controlled-provider-target-authority";
import { planControlledCashlessUpdate } from "./controlled-provider-cashless-plan";
import { requireControlledCollectionSchema } from "./controlled-provider-collection-schema-guard";
import { controlledUpdateReadback } from "./controlled-provider-update-readback";
import { controlledCollectionInventoryOwner,requireControlledCollectionOrchestrationSchema } from "./controlled-provider-collection-inventory-owner";
import { controlledCollectionReadiness } from "./controlled-provider-readiness";
const kind=z.enum(["update_calendar","create_draft","add_invoice_component","read_manifest","set_invoice_fee","finalize_invoice","pay_invoice"]);
export { requireControlledCollectionSchema } from "./controlled-provider-collection-schema-guard";
export const planControlledCollectionOperation=defineService({name:"subscriptions.planControlledCollectionOperation",summary:"Freeze one exact next original canonical target request from actual immutable accepted rows, retaining all older callers and source revisions before physical SDK admission.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({collectionId:z.uuid(),kind,componentId:z.uuid().optional()}).strict(),output:z.object({operationId:z.uuid()}),handler:async(input,ctx)=>{
  await lockContactIdentityForRead(ctx.tx);await requireControlledCollectionSchema(ctx);if(input.kind!=="read_manifest")await requireControlledCollectionOrchestrationSchema(ctx);
  const[reference]=await ctx.tx.select({resourceId:subscriptionControlledQuotes.resourceId,invoiceId:subscriptionControlledCollections.invoiceId}).from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);
  if(!reference)throw new ServiceError("not_found","There is no such accepted controlled canonical target.");
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
  const[heldResource]=await ctx.tx.select({id:subscriptionControlledResources.id,subscriptionId:subscriptionControlledResources.subscriptionId}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
  if(!heldResource)throw new ServiceError("conflict","Retain the exact original resource before target admission.");
  await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,heldResource.subscriptionId)).limit(1).for("update");
  if(reference.invoiceId===null){
   if(input.kind!=="update_calendar"||input.componentId)throw new ServiceError("conflict","An uncharged trial has no debit, bank draft, component or payment. Only its exact future-price update can be admitted before a real later paid period.");
   return planControlledCashlessUpdate(ctx,input.collectionId);
  }
  let source=await controlledCollectionState(ctx.tx,input.collectionId);
  // Canonical order follows the held resource and parent: original payments, target
  // invoice, then notes. Re-read after the actual parent locks are acquired.
  for(const id of [...new Set(source.canonical.funding.map(row=>row.sourcePaymentId))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${source.canonical.invoice.id}`}))`);
  for(const id of [...new Set(source.canonical.notes.map(row=>row.id))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit-note:${id}`}))`);
  source=await controlledCollectionState(ctx.tx,input.collectionId);
  const{history,collection,resource,parent,review,manifest}=source;
  const[enabled]=await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
  const observing=input.kind==="read_manifest";
  if(history.unfinished.length||history.closures.length||!observing&&(!source.canonical.currentCollectible||!enabled?.enabled||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status)
   ||collection.kind==="proration"&&new Date()>=source.quote.effectiveAt||source.canonical.invoice.paidMinor!==0||source.canonical.invoice.refundedMinor!==0))throw new ServiceError("conflict","Recover the exact stopped/expired/partially paid original target and every real caller before another collection; no gap is backdated or old money erased.");
  if(collection.kind==="period"&&["finalize_invoice","pay_invoice"].includes(input.kind)
   &&(Date.now()<Date.parse(review.calendar.proposedPeriodStart)||review.originalTrialEndsAt!==null&&Date.now()<Date.parse(review.originalTrialEndsAt)))
   throw new ServiceError("conflict","This actual accepted service period or preserved trial has not started. Keep the exact draft paused; do not finalize or bill the trial window early.");
  const money=await controlledTargetFinancialAuthority(ctx,collection.id,input.kind),parentReadiness=await controlledCollectionReadiness(ctx,parent.id);
  const target={providerProductRef:resource.originalScope.providerProductRef,principalMinor:review.quote.snapshot.periodAmountMinor,interval:review.quote.snapshot.interval,intervalCount:review.quote.snapshot.intervalCount};
  const calendar=controlledCalendarSource(history,resource.originalScope,source.terms,target,review.effectiveAt,observing?{observationOnly:true}:undefined).payload;
  if(!observing&&input.kind!=="update_calendar"){
   if(!controlledUpdateReadback(source))throw new ServiceError("conflict","Independently observe the exact original update epoch, price and calendar before another bank write; never invent its lost finish or replay its POST.");
   if(calendar.originalComponents[0]!.amountMinor!==target.principalMinor||calendar.originalComponents[0]!.providerProductRef!==target.providerProductRef
    ||!(calendar.originalPeriodStart===review.calendar.expectedProviderPeriodStart&&calendar.originalPeriodEnd===review.calendar.expectedProviderPeriodEnd
     ||collection.kind==="period"&&review.calendar.nativeForecasts.some(forecast=>!forecast.proration&&forecast.amountMinor===target.principalMinor&&forecast.periodStart===calendar.originalPeriodStart&&forecast.periodEnd===calendar.originalPeriodEnd))
    ||calendar.originalAnchor!==review.calendar.expectedProviderBillingAnchor||calendar.originalProviderTrialEnd!==review.calendar.expectedProviderTrialEndsAt)
    throw new ServiceError("conflict","The actual updated provider price/calendar/trial differs from explicit accepted effects. Keep collection paused and retain all real target obligations for fresh authentic review; never silently rebase or backdate access.");
  }
  let collectionInventory:{listOperationId:string;invoiceReadOperationIds:string[];revision:string;afterOrdinal:number}|undefined;
  if(input.kind!=="read_manifest"){
   const afterOrdinal=Math.max(0,...history.operations.filter(op=>history.calls.some(call=>call.operationId===op.id)&&["update_calendar","create_draft","add_invoice_component","set_invoice_fee","finalize_invoice","pay_invoice","cancel_calendar","pause_drafts"].includes(op.kind)).map(op=>op.ordinal)),inventory=await controlledCollectionInventoryOwner(ctx,source,afterOrdinal);
   if(inventory.unknown.length)throw new ServiceError("conflict","Bind or genuinely dispose every actual generated/original invoice before another target write; do not create a second draft by ignoring an unknown obligation.");
   collectionInventory={listOperationId:inventory.list.id,invoiceReadOperationIds:inventory.reads.map(row=>row.operation.id),revision:inventory.revision,afterOrdinal};
  }
  let payload:Record<string,unknown>;
  if(input.kind==="update_calendar"){
   if(history.operations.some(op=>history.calls.some(call=>call.operationId===op.id)&&op.kind==="update_calendar"&&op.originalRequest.payload&&typeof op.originalRequest.payload==="object"&&Reflect.get(op.originalRequest.payload,"collectionId")===collection.id))throw new ServiceError("conflict","Recover the actual original update's returned/stopped bank result; never dispatch its POST twice.");
   payload=controlledCalendarPayload.extend({acceptedQuoteDigest:z.string(),collectionId:z.uuid()}).parse({...calendar,acceptedQuoteDigest:collection.acceptedQuoteDigest,collectionId:collection.id});
  }else{
   const binding=source.binding,creator=binding?history.operations.find(op=>op.id===binding.creatorOperationId):null;
   const lineBindings=source.itemReceipts.map(item=>({componentId:item.componentId,providerInvoiceLineRef:item.providerInvoiceLineRef,providerInvoiceItemRef:item.providerInvoiceItemRef,providerPriceRef:item.providerPriceRef}));
   if(lineBindings.some(row=>!row.providerInvoiceLineRef))throw new ServiceError("conflict","Retain each exact original item's real independent invoice line before another component or final collection.");
   if(input.kind==="create_draft"){
    if(binding||history.operations.some(op=>history.calls.some(call=>call.operationId===op.id)&&op.kind==="create_draft"&&op.originalRequest.payload&&typeof op.originalRequest.payload==="object"&&Reflect.get(op.originalRequest.payload,"manifest")&&z.object({collectionId:z.uuid()}).parse(Reflect.get(op.originalRequest.payload,"manifest")).collectionId===collection.id))throw new ServiceError("conflict","Recover and bind the original actual draft or update-generated invoice; a lost creation ACK cannot justify another POST.");
    // Generated current-period drafts must first be discovered and bound by
    // original creator metadata. This planner never creates an extra invoice
    // merely because a prior update's physical result is still unknown.
    const updateReadback=controlledUpdateReadback(source);
    if(!updateReadback||!collectionInventory||updateReadback.providerInvoiceRef!==null&&!history.verifications.some(row=>collectionInventory!.invoiceReadOperationIds.includes(row.operationId)&&row.actualResult.providerInvoiceRef===updateReadback.providerInvoiceRef))throw new ServiceError("conflict","Independently discover/bind the actual original calendar update and its generated draft before choosing a separate exact target draft.");
   }else if(!binding||!creator)throw new ServiceError("conflict","Retain the exact actual original target draft binding and genuine creator before component, fee, finalize or pay admission.");
   const proof=source.proofs.at(-1),verified=proof?history.verifications.find(row=>row.operationId===proof.operationId):null;
   if(["finalize_invoice","pay_invoice"].includes(input.kind)&&(!proof||!verified||verified.actualResult.canonicalTargetDigest!==undefined&&verified.actualResult.canonicalTargetDigest!==source.canonical.digest))throw new ServiceError("conflict","Perform a new complete exact manifest/customer/fee read before finalization or payment.");
   if(input.kind==="add_invoice_component"&&(!input.componentId||!source.components.some(row=>row.id===input.componentId)||source.itemReceipts.some(row=>row.componentId===input.componentId)))throw new ServiceError("conflict","Only an actual missing immutable canonical component can acquire its one original bank item.");
   payload=controlledCollectionPayload.parse({bootstrapOperationId:calendar.bootstrapOperationId,bootstrapRequestDigest:calendar.bootstrapRequestDigest,providerSubscriptionRef:calendar.providerSubscriptionRef,
    manifest,calendar,invoiceOrigin:binding&&creator?{kind:binding.originKind,creatorOperationId:creator.id,creatorRequestDigest:creator.requestDigest,...(binding.originKind!=="created_draft"?{priceEpochCollectionId:z.uuid().parse(Reflect.get(z.record(z.string(),z.unknown()).parse(creator.originalRequest.payload),"collectionId")),priceEpochAcceptedQuoteDigest:z.string().regex(/^[a-f0-9]{64}$/).parse(Reflect.get(z.record(z.string(),z.unknown()).parse(creator.originalRequest.payload),"acceptedQuoteDigest"))}:{})}:{kind:"created_draft",creatorOperationId:null,creatorRequestDigest:null},lineBindings,
    ...(input.kind==="create_draft"?{mode:"create"}:{}),...(binding?{providerInvoiceRef:binding.providerInvoiceRef}:{}),...(input.componentId?{componentId:input.componentId}:{})});
  }
  if(history.count>=4995)throw new ServiceError("conflict","Retain bounded capacity for actual original admission/raw/finish and its independent verification before another bank call.");
  const[originalTerms]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,resource.termsId)).limit(1);
  if(!originalTerms)throw new ServiceError("conflict","Retain the original immutable resource acceptance before its next physical caller.");
  const id=randomUUID(),originalRequest=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify({scopeDigest:merchantTaxDigest(resource.originalScope),payload,requiredProtocol:"controlled_net_gross.v1",
   parentFinancialRevision:parentReadiness.revision,targetFinancialRevision:money.revision,...(collectionInventory?{collectionInventory}:{})})));
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledOperations).values({id,resourceId:resource.id,kind:input.kind,ordinal:(history.operations.at(-1)?.ordinal??0)+1,originalRequest,requestDigest:merchantTaxDigest(originalRequest),
   idempotencyKey:`controlled:${resource.id}:${input.kind}:${id}`,previousEvidenceRevision:history.revision,acceptedQuoteDigest:originalTerms.acceptedQuoteDigest});
  ctx.setSubject("subscription",parent.id);return{operationId:id};
 }});
