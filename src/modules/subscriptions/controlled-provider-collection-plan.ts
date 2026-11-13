// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// No arbitrary bank payload: actual accepted canonical rows select every next call.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,ServiceError,type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { moduleSettings } from "@/core/settings/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledResources,subscriptionControlledOperations } from "./controlled-provider-schema";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { controlledCalendarSource } from "./controlled-provider-calendar-source";
import { controlledCollectionPayload,controlledCalendarPayload } from "./controlled-provider-adapter-contract";
import { controlledTargetFinancialAuthority } from "./controlled-provider-target-authority";
import { controlledCollectionReadiness } from "./controlled-provider-readiness";
const kind=z.enum(["update_calendar","create_draft","add_invoice_component","read_manifest","set_invoice_fee","finalize_invoice","pay_invoice"]);
export async function requireControlledCollectionSchema(ctx:ServiceContext){
 const[ready]=await ctx.tx.execute<{ready:boolean}>(sql`select count(*)=12 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
  ((to_regclass('subscription_controlled_quotes'),'subscription_controlled_quotes_guard'),(to_regclass('subscription_controlled_quotes'),'subscription_controlled_quotes_complete'),
   (to_regclass('subscription_controlled_collections'),'subscription_controlled_collections_guard'),(to_regclass('subscription_controlled_collections'),'subscription_controlled_collections_complete'),
   (to_regclass('subscription_controlled_components'),'subscription_controlled_components_guard'),(to_regclass('subscription_controlled_components'),'subscription_controlled_components_complete'),
   (to_regclass('subscription_controlled_invoice_bindings'),'subscription_controlled_invoice_bindings_guard'),(to_regclass('subscription_controlled_invoice_bindings'),'subscription_controlled_invoice_bindings_complete'),
   (to_regclass('subscription_controlled_item_receipts'),'subscription_controlled_item_receipts_guard'),(to_regclass('subscription_controlled_item_receipts'),'subscription_controlled_item_receipts_complete'),
   (to_regclass('subscription_controlled_invoice_proofs'),'subscription_controlled_invoice_proofs_guard'),(to_regclass('subscription_controlled_invoice_proofs'),'subscription_controlled_invoice_proofs_complete'))`);
 if(!ready?.ready)throw new ServiceError("conflict","Install every guarded exact controlled quote/target/component/creator/item/read family before positive collection work.");
}
export const planControlledCollectionOperation=defineService({name:"subscriptions.planControlledCollectionOperation",summary:"Freeze one exact next original canonical target request from actual immutable accepted rows, retaining all older callers and source revisions before physical SDK admission.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({collectionId:z.uuid(),kind,componentId:z.uuid().optional()}).strict(),output:z.object({operationId:z.uuid()}),handler:async(input,ctx)=>{
  await lockContactIdentityForRead(ctx.tx);await requireControlledCollectionSchema(ctx);
  const[reference]=await ctx.tx.select({resourceId:subscriptionControlledQuotes.resourceId}).from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);
  if(!reference)throw new ServiceError("not_found","There is no such accepted controlled canonical target.");
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
  await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
  let source=await controlledCollectionState(ctx.tx,input.collectionId);
  // Canonical order follows the held resource: original payments, target
  // invoice, then notes. Re-read after the actual parent locks are acquired.
  for(const id of [...new Set(source.canonical.funding.map(row=>row.sourcePaymentId))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${source.canonical.invoice.id}`}))`);
  for(const id of [...new Set(source.canonical.notes.map(row=>row.id))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit-note:${id}`}))`);
  source=await controlledCollectionState(ctx.tx,input.collectionId);
  const{history,collection,resource,parent,review,manifest}=source;
  const[enabled]=await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
  if(!source.canonical.currentCollectible||!enabled?.enabled||history.unfinished.length||history.closures.length||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status)
   ||collection.kind==="proration"&&new Date()>=source.quote.effectiveAt||source.canonical.invoice.paidMinor!==0||source.canonical.invoice.refundedMinor!==0)throw new ServiceError("conflict","Recover the exact stopped/expired/partially paid original target and every real caller before another collection; no gap is backdated or old money erased.");
  const money=await controlledTargetFinancialAuthority(ctx,collection.id,input.kind),parentReadiness=await controlledCollectionReadiness(ctx,parent.id);
  const target={providerProductRef:resource.originalScope.providerProductRef,principalMinor:review.quote.snapshot.periodAmountMinor,interval:review.quote.snapshot.interval,intervalCount:review.quote.snapshot.intervalCount};
  const calendar=controlledCalendarSource(history,resource.originalScope,source.terms,target,review.effectiveAt).payload;
  if(input.kind!=="update_calendar"){
   if(calendar.originalComponents[0]!.amountMinor!==target.principalMinor||calendar.originalComponents[0]!.providerProductRef!==target.providerProductRef
    ||calendar.originalPeriodStart!==review.calendar.expectedProviderPeriodStart||calendar.originalPeriodEnd!==review.calendar.expectedProviderPeriodEnd
    ||calendar.originalAnchor!==review.calendar.expectedProviderBillingAnchor||calendar.originalProviderTrialEnd!==review.calendar.expectedProviderTrialEndsAt)
    throw new ServiceError("conflict","The actual updated provider price/calendar/trial differs from explicit accepted effects. Keep collection paused and retain all real target obligations for fresh authentic review; never silently rebase or backdate access.");
  }
  let payload:Record<string,unknown>;
  if(input.kind==="update_calendar"){
   if(history.operations.some(op=>op.kind==="update_calendar"&&op.originalRequest.payload&&typeof op.originalRequest.payload==="object"&&Reflect.get(op.originalRequest.payload,"collectionId")===collection.id))throw new ServiceError("conflict","Recover the actual original update's returned/stopped bank result; never dispatch its POST twice.");
   payload=controlledCalendarPayload.extend({acceptedQuoteDigest:z.string(),collectionId:z.uuid()}).parse({...calendar,acceptedQuoteDigest:collection.acceptedQuoteDigest,collectionId:collection.id});
  }else{
   const binding=source.binding,creator=binding?history.operations.find(op=>op.id===binding.creatorOperationId):null;
   const lineBindings=source.itemReceipts.map(item=>({componentId:item.componentId,providerInvoiceLineRef:item.providerInvoiceLineRef,providerInvoiceItemRef:item.providerInvoiceItemRef,providerPriceRef:item.providerPriceRef}));
   if(lineBindings.some(row=>!row.providerInvoiceLineRef))throw new ServiceError("conflict","Retain each exact original item's real independent invoice line before another component or final collection.");
   if(input.kind==="create_draft"){
    if(binding||history.operations.some(op=>op.kind==="create_draft"&&op.originalRequest.payload&&typeof op.originalRequest.payload==="object"&&Reflect.get(op.originalRequest.payload,"manifest")&&z.object({collectionId:z.uuid()}).parse(Reflect.get(op.originalRequest.payload,"manifest")).collectionId===collection.id))throw new ServiceError("conflict","Recover and bind the original actual draft or update-generated invoice; a lost creation ACK cannot justify another POST.");
    // Generated current-period drafts must first be discovered and bound by
    // original creator metadata. This planner never creates an extra invoice
    // merely because a prior update's physical result is still unknown.
    const update=history.operations.find(op=>op.kind==="update_calendar"&&op.originalRequest.payload&&typeof op.originalRequest.payload==="object"&&Reflect.get(op.originalRequest.payload,"collectionId")===collection.id);
    const updateResult=update?history.verifications.find(row=>row.operationId===update.id):null;
    if(!updateResult||updateResult.actualResult.providerInvoiceRef!==null)throw new ServiceError("conflict","Independently discover/bind the actual original calendar update and its generated draft before choosing a separate exact target draft.");
   }else if(!binding||!creator)throw new ServiceError("conflict","Retain the exact actual original target draft binding and genuine creator before component, fee, finalize or pay admission.");
   const proof=source.proofs.at(-1),verified=proof?history.verifications.find(row=>row.operationId===proof.operationId):null;
   if(["finalize_invoice","pay_invoice"].includes(input.kind)&&(!proof||!verified||verified.actualResult.canonicalTargetDigest!==undefined&&verified.actualResult.canonicalTargetDigest!==source.canonical.digest))throw new ServiceError("conflict","Perform a new complete exact manifest/customer/fee read before finalization or payment.");
   if(input.kind==="add_invoice_component"&&(!input.componentId||!source.components.some(row=>row.id===input.componentId)||source.itemReceipts.some(row=>row.componentId===input.componentId)))throw new ServiceError("conflict","Only an actual missing immutable canonical component can acquire its one original bank item.");
   payload=controlledCollectionPayload.parse({bootstrapOperationId:calendar.bootstrapOperationId,bootstrapRequestDigest:calendar.bootstrapRequestDigest,providerSubscriptionRef:calendar.providerSubscriptionRef,
    manifest,calendar,invoiceOrigin:binding&&creator?{kind:binding.originKind,creatorOperationId:creator.id,creatorRequestDigest:creator.requestDigest}:{kind:"created_draft",creatorOperationId:null,creatorRequestDigest:null},lineBindings,
    ...(input.kind==="create_draft"?{mode:"create"}:{}),...(binding?{providerInvoiceRef:binding.providerInvoiceRef}:{}),...(input.componentId?{componentId:input.componentId}:{})});
  }
  if(history.count>=4995)throw new ServiceError("conflict","Retain bounded capacity for actual original admission/raw/finish and its independent verification before another bank call.");
  const[originalTerms]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,resource.termsId)).limit(1);
  if(!originalTerms)throw new ServiceError("conflict","Retain the original immutable resource acceptance before its next physical caller.");
  const id=randomUUID(),originalRequest=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify({scopeDigest:merchantTaxDigest(resource.originalScope),payload,requiredProtocol:"controlled_net_gross.v1",
   parentFinancialRevision:parentReadiness.revision,targetFinancialRevision:money.revision})));
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledOperations).values({id,resourceId:resource.id,kind:input.kind,ordinal:(history.operations.at(-1)?.ordinal??0)+1,originalRequest,requestDigest:merchantTaxDigest(originalRequest),
   idempotencyKey:`controlled:${resource.id}:${input.kind}:${id}`,previousEvidenceRevision:history.revision,acceptedQuoteDigest:originalTerms.acceptedQuoteDigest});
  ctx.setSubject("subscription",parent.id);return{operationId:id};
 }});
