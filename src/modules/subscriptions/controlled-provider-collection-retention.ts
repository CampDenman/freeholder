// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Observed bank ownership is retained separately from its original creator.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService,ServiceError,type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptions } from "./schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes,subscriptionControlledInvoiceBindings,subscriptionControlledItemReceipts,subscriptionControlledInvoiceProofs } from "./controlled-provider-collection-schema";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { requireControlledCollectionSchema } from "./controlled-provider-collection-schema-guard";
import { assertControlledInvoiceOrigin,assertControlledComponentLine } from "./controlled-provider-collection-origin";
const reference=z.string().regex(/^in_[A-Za-z0-9_]{1,196}$/);
function refuse():never{throw new ServiceError("conflict","Retain the exact authentic original creator and observed invoice/item/read. A missing or mismatched bank fact cannot be replaced by an amount match, new POST, invented finish or reconstructed receipt.");}
type State=Awaited<ReturnType<typeof controlledCollectionState>>;
export async function lockControlledCollection(ctx:ServiceContext,collectionId:string){
 await lockContactIdentityForRead(ctx.tx);await requireControlledCollectionSchema(ctx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledQuotes.resourceId}).from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).where(eq(subscriptionControlledCollections.id,collectionId)).limit(1);
 if(!reference)throw new ServiceError("not_found","There is no such accepted canonical target.");
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
 if(!resource)refuse();await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1).for("update");
 const state=await controlledCollectionState(ctx.tx,collectionId);
 if(state.history.closures.length||state.history.count+state.canonical.count+state.components.length+state.itemReceipts.length+state.proofs.length+8>=5000)refuse();
 return state;
}
function observed(source:State,factId:string){
 const fact=source.history.facts.find(row=>row.id===factId),call=fact?source.history.calls.find(row=>row.id===fact.callId):null,operation=call?source.history.operations.find(row=>row.id===call.operationId):null;
 if(!fact||!call||!operation)refuse();return{operation,call,fact};
}
async function write(ctx:ServiceContext){await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true),set_config('freeholder.controlled_collection_v1','1',true)`);}
export const retainControlledInvoiceBinding=defineService({name:"subscriptions.retainControlledInvoiceBinding",summary:"Bind one actual accepted target to its authentic bank invoice and original physical creator without declaring its money safe or releasing an unfinished caller.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","factId","creatorOperationId"],
 input:z.object({collectionId:z.uuid(),factId:z.uuid(),creatorOperationId:z.uuid(),providerInvoiceRef:reference,originKind:z.enum(["created_draft","update_generated","calendar_generated"])}).strict(),output:z.object({collectionId:z.uuid(),providerInvoiceRef:reference}),handler:async(input,ctx)=>{
  const source=await lockControlledCollection(ctx,input.collectionId),actual=observed(source,input.factId),creator=source.history.operations.find(row=>row.id===input.creatorOperationId);
  if(!creator||!source.history.calls.some(row=>row.operationId===creator.id))refuse();
  const rows=actual.fact.actual.kind==="invoice_list_read"?actual.fact.actual.raw.data:[actual.fact.actual.raw];
  if(!["controlled_draft_created","invoice_read","invoice_list_read"].includes(actual.fact.actual.kind)||!Array.isArray(rows))refuse();
  const raw=z.array(z.record(z.string(),z.unknown())).parse(rows).find(row=>row.id===input.providerInvoiceRef);if(!raw)refuse();
  assertControlledInvoiceOrigin(source,input.originKind,creator,actual.operation,raw);
  const originalEvidenceDigest=merchantTaxDigest({collectionId:source.collection.id,creator,operation:actual.operation,call:actual.call,fact:actual.fact,providerInvoiceRef:input.providerInvoiceRef});
  if(source.binding){if(source.binding.originalEvidenceDigest!==originalEvidenceDigest||source.binding.originKind!==input.originKind)refuse();return{collectionId:source.collection.id,providerInvoiceRef:source.binding.providerInvoiceRef};}
  await write(ctx);await ctx.tx.insert(subscriptionControlledInvoiceBindings).values({collectionId:source.collection.id,resourceId:source.resource.id,originKind:input.originKind,creatorOperationId:creator.id,
   providerInvoiceRef:input.providerInvoiceRef,operationId:actual.operation.id,callId:actual.call.id,factId:actual.fact.id,originalEvidenceDigest});
  await controlledCollectionState(ctx.tx,source.collection.id);ctx.setSubject("subscription",source.parent.id);return{collectionId:source.collection.id,providerInvoiceRef:input.providerInvoiceRef};
 }});
export const retainControlledItemReceipt=defineService({name:"subscriptions.retainControlledItemReceipt",summary:"Retain one actual original canonical component's independently observed bank line, preserving real ii_/il_/price identities and separate creator and observer ancestry.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","componentId","factId","creatorOperationId"],
 input:z.object({collectionId:z.uuid(),componentId:z.uuid(),creatorOperationId:z.uuid(),factId:z.uuid(),providerInvoiceLineRef:z.string().regex(/^il_[A-Za-z0-9_]{1,196}$/)}).strict(),output:z.object({componentId:z.uuid()}),handler:async(input,ctx)=>{
  const source=await lockControlledCollection(ctx,input.collectionId),actual=observed(source,input.factId),creator=source.history.operations.find(row=>row.id===input.creatorOperationId),component=source.components.find(row=>row.id===input.componentId);
  if(!source.binding||!creator||!component||!source.history.calls.some(row=>row.operationId===creator.id)||actual.fact.actual.kind!=="invoice_lines_read"||!Array.isArray(actual.fact.actual.raw.data))refuse();
  const raw=z.array(z.record(z.string(),z.unknown())).parse(actual.fact.actual.raw.data).find(row=>row.id===input.providerInvoiceLineRef);if(!raw)refuse();
  const lineage=assertControlledComponentLine(source,component,creator,actual.operation,raw);
  const originalEvidenceDigest=merchantTaxDigest({componentId:component.id,creator,operation:actual.operation,call:actual.call,fact:actual.fact,providerInvoiceRef:source.binding.providerInvoiceRef,
   providerInvoiceItemRef:lineage.providerInvoiceItemRef,providerInvoiceLineRef:input.providerInvoiceLineRef,providerPriceRef:lineage.providerPriceRef});
  const prior=source.itemReceipts.find(row=>row.componentId===component.id);
  if(prior){if(prior.originalEvidenceDigest!==originalEvidenceDigest)refuse();return{componentId:component.id};}
  await write(ctx);await ctx.tx.insert(subscriptionControlledItemReceipts).values({componentId:component.id,resourceId:source.resource.id,...lineage,creatorOperationId:creator.id,
   providerInvoiceLineRef:input.providerInvoiceLineRef,operationId:actual.operation.id,callId:actual.call.id,factId:actual.fact.id,originalEvidenceDigest});
  await controlledCollectionState(ctx.tx,source.collection.id);ctx.setSubject("subscription",source.parent.id);return{componentId:component.id};
 }});
export const retainControlledInvoiceProof=defineService({name:"subscriptions.retainControlledInvoiceProof",summary:"Retain only the genuine returned complete manifest/customer read for this actual accepted target; its proof is never itself a payment or principal authority.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","operationId"],input:z.object({collectionId:z.uuid(),operationId:z.uuid()}).strict(),output:z.object({proofId:z.uuid()}),handler:async(input,ctx)=>{
  const source=await lockControlledCollection(ctx,input.collectionId),operation=source.history.operations.find(row=>row.id===input.operationId),verification=source.history.verifications.find(row=>row.operationId===input.operationId);
  if(!source.binding||!operation||operation.kind!=="read_manifest"||!verification||verification.actualResult.exactManifest!==true||verification.actualResult.suppliesPaidAuthority!==false
   ||verification.actualResult.providerInvoiceRef!==source.binding.providerInvoiceRef||verification.actualResult.manifestDigest!==merchantTaxDigest(source.manifest))refuse();
  const customerFinancialDigest=z.string().regex(/^[a-f0-9]{64}$/).parse(verification.actualResult.customerFinancialDigest);
  const prior=source.proofs.find(row=>row.operationId===operation.id);if(prior)return{proofId:prior.id};
  const id=randomUUID();await write(ctx);await ctx.tx.insert(subscriptionControlledInvoiceProofs).values({id,collectionId:source.collection.id,operationId:operation.id,callId:verification.callId,
   resultDigest:verification.actualResultDigest,canonicalTargetDigest:source.canonical.digest,customerFinancialDigest});
  await controlledCollectionState(ctx.tx,source.collection.id);ctx.setSubject("subscription",source.parent.id);return{proofId:id};
 }});
