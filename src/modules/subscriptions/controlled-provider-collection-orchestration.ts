// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual SDK sequence outside TX; canonical cash application/effects are separate.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineService,defineOrchestratedService,ServiceError,type Actor } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalSubscriptionInvoiceMetadata } from "@/adapters/payments/stripe-subscription-cash";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledPeriodInput,controlledProrationInput } from "./controlled-provider-collection-contract";
import { lockControlledCollection,retainControlledInvoiceBinding,retainControlledItemReceipt,retainControlledInvoiceProof } from "./controlled-provider-collection-retention";
import { controlledUpdateReadback } from "./controlled-provider-update-readback";
import { controlledCollectionInventoryOwner,requireControlledCollectionOrchestrationSchema } from "./controlled-provider-collection-inventory-owner";
import { readControlledCollectionInventory,refuseControlledCollectionInventory } from "./controlled-provider-collection-inventory";
import { planControlledCollectionOperation } from "./controlled-provider-collection-plan";
import { planControlledProviderOperation } from "./controlled-provider-plan";
import { executeControlledOperation } from "./controlled-provider-execution";
import { ownGrossProration } from "./proration-quote";
const input=z.object({collectionId:z.uuid()}).strict(),object=(value:unknown)=>z.record(z.string(),z.unknown()).parse(value);
const ref=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id"in value&&typeof value.id==="string"?value.id:null;
const operationCollection=(op:{originalRequest:Record<string,unknown>})=>{const payload=object(op.originalRequest.payload);return payload.collectionId??(payload.manifest?object(payload.manifest).collectionId:null);};
const stateResult=z.object({resourceId:z.uuid(),providerInvoiceRef:z.string().nullable(),componentIds:z.array(z.uuid()).max(250),missingComponentIds:z.array(z.uuid()).max(250),
 update:z.object({operationId:z.uuid(),admitted:z.boolean(),returned:z.boolean(),observedApplied:z.boolean()}).nullable(),draftCreate:z.object({operationId:z.uuid(),admitted:z.boolean(),returned:z.boolean()}).nullable(),
 admittedComponentIds:z.array(z.uuid()).max(250),finalizeAdmitted:z.boolean(),payAdmitted:z.boolean(),feeAdmitted:z.boolean(),periodStartsAt:z.iso.datetime().nullable(),
 bankStatus:z.enum(["draft","open","paid","void","uncollectible"]).nullable(),bankPaidMinor:z.number().int().nonnegative(),bankFeeMatches:z.boolean()});
export const controlledCollectionOrchestrationState=defineService({name:"subscriptions.controlledCollectionOrchestrationState",summary:"Read real owned collection progress for its private orchestrator, preserving actual admissions and all unknown outcomes without returning principal authority.",kind:"query",permission:"system",external:false,input,output:stateResult,handler:async({collectionId},ctx)=>{
 await requireControlledCollectionOrchestrationSchema(ctx);const source=await lockControlledCollection(ctx,collectionId),{history}=source;
 if(history.unfinished.length)refuseControlledCollectionInventory();
 const own=history.operations.filter(op=>operationCollection(op)===collectionId),attempt=(kind:string)=>{const op=own.find(op=>op.kind===kind&&history.calls.some(call=>call.operationId===op.id))??own.filter(op=>op.kind===kind).at(-1);return op?{operationId:op.id,admitted:history.calls.some(call=>call.operationId===op.id),returned:history.verifications.some(row=>row.operationId===op.id)}:null;};
 const lastRead=source.binding?history.operations.filter(op=>op.kind==="read_invoice"&&object(op.originalRequest.payload).providerInvoiceRef===source.binding!.providerInvoiceRef).at(-1):null;
 const bank=lastRead?history.verifications.find(row=>row.operationId===lastRead.id)?.actualResult:null;
 return{resourceId:source.resource.id,providerInvoiceRef:source.binding?.providerInvoiceRef??null,componentIds:source.components.map(row=>row.id),missingComponentIds:source.components.filter(row=>!source.itemReceipts.some(item=>item.componentId===row.id)).map(row=>row.id),
  update:attempt("update_calendar")?{...attempt("update_calendar")!,observedApplied:controlledUpdateReadback(source)!==null}:null,draftCreate:attempt("create_draft"),admittedComponentIds:own.filter(op=>op.kind==="add_invoice_component"&&history.calls.some(call=>call.operationId===op.id)).map(op=>z.uuid().parse(object(op.originalRequest.payload).componentId)),
  finalizeAdmitted:attempt("finalize_invoice")?.admitted??false,payAdmitted:attempt("pay_invoice")?.admitted??false,feeAdmitted:attempt("set_invoice_fee")?.admitted??false,
  periodStartsAt:source.collection.kind==="period"?source.review.calendar.proposedPeriodStart:null,bankStatus:bank?z.enum(["draft","open","paid","void","uncollectible"]).parse(bank.status):null,
  bankPaidMinor:bank?z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(bank.paidMinor):0,bankFeeMatches:bank?object(bank.actualInvoice).application_fee_amount===source.manifest.applicationFeeMinor:false};
}});
export const bindObservedControlledCollection=defineService({name:"subscriptions.bindObservedControlledCollection",summary:"Bind actual independent returned invoice and component facts to their exact original physical creators; no arbitrary bank identifiers or amounts are accepted.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId"],input,output:z.object({bound:z.boolean(),missingComponentIds:z.array(z.uuid()).max(250)}),handler:async({collectionId},ctx)=>{
 let source=await lockControlledCollection(ctx,collectionId),inventory=readControlledCollectionInventory(source);
 if(!source.binding){
  const candidates:Array<{row:typeof inventory.reads[number];creatorId:string;originKind:"created_draft"|"update_generated"}>=[];
  for(const row of inventory.reads){const raw=row.actual.actualInvoice,tag=originalSubscriptionInvoiceMetadata(raw),metadata=object(raw.metadata??{});
   const creator=source.history.operations.find(op=>source.history.calls.some(call=>call.operationId===op.id)&&operationCollection(op)===collectionId
    &&(op.kind==="create_draft"&&metadata.freeholder_controlled_creator_operation_id===op.id&&metadata.freeholder_controlled_collection_id===collectionId
     ||op.kind==="update_calendar"&&tag.freeholder_controlled_update_operation_id===op.id&&tag.freeholder_controlled_price_epoch_id===collectionId&&raw.billing_reason==="subscription_update"));
   if(creator)candidates.push({row,creatorId:creator.id,originKind:creator.kind==="create_draft"?"created_draft":"update_generated"});
  }
  if(candidates.length>1)refuseControlledCollectionInventory();
  const candidate=candidates[0];if(!candidate)return{bound:false,missingComponentIds:source.components.map(row=>row.id)};
  const fact=source.history.facts.find(fact=>fact.actual.kind==="invoice_read"&&source.history.calls.some(call=>call.id===fact.callId&&call.operationId===candidate.row.operation.id)&&merchantTaxDigest(fact.actual.raw)===merchantTaxDigest(candidate.row.actual.actualInvoice));
  if(!fact)refuseControlledCollectionInventory();
  await ctx.callAsSystem(retainControlledInvoiceBinding,{collectionId,factId:fact.id,creatorOperationId:candidate.creatorId,providerInvoiceRef:candidate.row.providerInvoiceRef,originKind:candidate.originKind});
  source=await lockControlledCollection(ctx,collectionId);inventory=readControlledCollectionInventory(source);
 }
 const bank=inventory.reads.find(row=>row.providerInvoiceRef===source.binding?.providerInvoiceRef);if(!bank)refuseControlledCollectionInventory();
 const creator=source.history.operations.find(op=>op.id===source.binding?.creatorOperationId);if(!creator)refuseControlledCollectionInventory();
 for(const component of source.components.filter(row=>!source.itemReceipts.some(item=>item.componentId===row.id))){
  const candidates=bank.actual.actualLines.filter(line=>{
   const metadata=object(line.metadata??{});if(metadata.freeholder_controlled_component_id===component.id)return true;
   const parent=object(line.parent??{}),subscription=object(parent.subscription_item_details??{});
   return component.kind==="net"&&object(component.provenance).canonicalComponent!=="setup"&&creator.kind==="update_calendar"
    &&parent.type==="subscription_item_details"&&subscription.proration===false&&line.amount===component.amountMinor
    &&object(line.period).start===component.periodStart.getTime()/1000&&object(line.period).end===component.periodEnd.getTime()/1000;
  });
  if(candidates.length>1)refuseControlledCollectionInventory();const line=candidates[0];if(!line)continue;
  const metadata=object(line.metadata??{}),creatorId=typeof metadata.freeholder_controlled_item_operation_id==="string"?metadata.freeholder_controlled_item_operation_id:creator.id;
  const fact=source.history.facts.find(fact=>fact.actual.kind==="invoice_lines_read"&&source.history.calls.some(call=>call.id===fact.callId&&call.operationId===bank.operation.id)
   &&Array.isArray(fact.actual.raw.data)&&fact.actual.raw.data.some(row=>ref(row)===line.id));
  if(!fact)refuseControlledCollectionInventory();await ctx.callAsSystem(retainControlledItemReceipt,{collectionId,componentId:component.id,creatorOperationId:creatorId,factId:fact.id,providerInvoiceLineRef:z.string().parse(line.id)});
 }
 source=await lockControlledCollection(ctx,collectionId);const owned=await controlledCollectionInventoryOwner(ctx,source);if(owned.unknown.length)refuseControlledCollectionInventory();
 return{bound:true,missingComponentIds:source.components.filter(row=>!source.itemReceipts.some(item=>item.componentId===row.id)).map(row=>row.id)};
}});
export const assertMyControlledCollectionAccess=defineService({name:"subscriptions.assertMyControlledCollectionAccess",summary:"Establish current buyer ownership before any actual controlled collection SDK call.",kind:"query",permission:"authenticated",external:false,input,output:z.literal(true),handler:async({collectionId},ctx)=>{
 const[reference]=await ctx.tx.select({kind:subscriptionControlledQuotes.kind,input:subscriptionControlledQuotes.input}).from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).where(eq(subscriptionControlledCollections.id,collectionId)).limit(1);
 if(!reference)throw new ServiceError("not_found","There is no such original accepted target.");const selected=reference.kind==="period"?controlledPeriodInput.parse(reference.input):controlledProrationInput.parse(reference.input);await ownGrossProration(ctx,selected.id);return true as const;
}});
const result=z.object({collectionId:z.uuid(),providerInvoiceRef:z.string().nullable(),state:z.enum(["prepared","money_retained","recovery_required"]),applied:z.literal(false),suppliesAccessAuthority:z.literal(false)});
async function collect({collectionId}:z.infer<typeof input>,actor:Actor){
 const system={kind:"system",request:actor.request} as const;
 const state=()=>controlledCollectionOrchestrationState.call({collectionId},system);
 const stage=async(kind:z.input<typeof planControlledCollectionOperation.def.input>["kind"],componentId?:string)=>{const op=await planControlledCollectionOperation.call({collectionId,kind,...(componentId?{componentId}:{})},system);await executeControlledOperation(op.operationId,actor);return op.operationId;};
 const read=async(resourceId:string,kind:"read_calendar"|"list_invoices"|"read_invoice",providerInvoiceRef?:string)=>{const op=await planControlledProviderOperation.call({resourceId,kind,...(providerInvoiceRef?{providerInvoiceRef}:{})},system);return executeControlledOperation(op.operationId,actor);};
 const inventory=async(resourceId:string)=>{const list=z.object({complete:z.literal(true),providerInvoiceRefs:z.array(z.string()).max(5000)}).parse(await read(resourceId,"list_invoices"));for(const ref of list.providerInvoiceRefs)await read(resourceId,"read_invoice",ref);};
 const outcome=(s:z.infer<typeof stateResult>,kind:z.infer<typeof result>["state"])=>({collectionId,providerInvoiceRef:s.providerInvoiceRef,state:kind,applied:false as const,suppliesAccessAuthority:false as const});
 let s=await state();await inventory(s.resourceId);
 if(!s.update?.admitted)await stage("update_calendar");
 // Even a thrown/stopped original update may have taken effect. Its new exact
 // GET proves current bank effects without changing that original outcome.
 await read(s.resourceId,"read_calendar");await inventory(s.resourceId);s=await state();
 if(!s.update?.observedApplied)return outcome(s,"recovery_required");
 if(!s.providerInvoiceRef){
  const bound=await bindObservedControlledCollection.call({collectionId},system);s=await state();
  if(!bound.bound){if(s.draftCreate?.admitted)return outcome(s,"recovery_required");await stage("create_draft");await inventory(s.resourceId);await bindObservedControlledCollection.call({collectionId},system);s=await state();}
 }
 if(!s.providerInvoiceRef)return outcome(s,"recovery_required");
 await bindObservedControlledCollection.call({collectionId},system);s=await state();
 if(s.bankPaidMinor>0)return outcome(s,"money_retained");
 for(const componentId of s.missingComponentIds){
  // An admitted lost item is recovered by genuine GET+metadata binding above.
  // A still missing original never causes a second physical item POST.
  if(s.admittedComponentIds.includes(componentId))return outcome(s,"recovery_required");
  await stage("add_invoice_component",componentId);await inventory(s.resourceId);await bindObservedControlledCollection.call({collectionId},system);s=await state();
 }
 if(s.missingComponentIds.length)return outcome(s,"recovery_required");
 if(!s.bankFeeMatches){if(s.feeAdmitted)return outcome(s,"recovery_required");await stage("set_invoice_fee");await inventory(s.resourceId);s=await state();}
 const manifest=await stage("read_manifest");await retainControlledInvoiceProof.call({collectionId,operationId:manifest},system);
 if(s.periodStartsAt&&Date.now()<Date.parse(s.periodStartsAt))return outcome(s,"prepared");
 if(s.bankStatus==="draft"){
  if(s.finalizeAdmitted)return outcome(s,"recovery_required");await stage("finalize_invoice");await inventory(s.resourceId);s=await state();
  const after=await stage("read_manifest");await retainControlledInvoiceProof.call({collectionId,operationId:after},system);
 }
 if(s.bankPaidMinor>0||s.bankStatus==="paid")return outcome(s,s.bankPaidMinor>0?"money_retained":"prepared");
 if(s.bankStatus!=="open"||s.payAdmitted)return outcome(s,"recovery_required");
 await stage("pay_invoice");await inventory(s.resourceId);s=await state();return outcome(s,s.bankPaidMinor>0?"money_retained":"recovery_required");
}
export const collectControlledCollection=defineOrchestratedService({name:"subscriptions.collectControlledCollection",summary:"Execute the exact accepted paused NET/gross target through genuine draft/component/fee/manifest/finalize/pay calls; retain actual cash independently, with canonical application and paid effects in separate proved transactions.",kind:"mutation",permission:"scoped",writeClass:"money",auditInputFields:["collectionId"],input,output:result,handler:collect});
export const collectMyControlledCollection=defineOrchestratedService({name:"subscriptions.collectMyControlledCollection",summary:"Collect only your own original accepted provider target through the same actual bank/audit spine, preserving prior access and every incomplete original outcome.",kind:"mutation",permission:"authenticated",writeClass:"money",auditInputFields:["collectionId"],input,output:result,handler:async(value,actor)=>{await assertMyControlledCollectionAccess.call(value,actor);return collect(value,actor);}});
