// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original actual SDK caller owns its nonce, raw observations and real finish.
import { createHash,randomBytes,randomUUID } from "node:crypto";
import type { MerchantControlledObservation } from "@/adapters/payments";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,ServiceError,type Actor,type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { retainProviderCharge } from "./provider-charge-receipts";
import { controlledCashEvidence } from "./controlled-provider-cash-origin";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts,subscriptionControlledFinishes,subscriptionControlledStops } from "./controlled-provider-schema";
import { controlledProviderJournal,CONTROLLED_CALL_PURPOSE,originalControlledCall,finishedControlledCall } from "./controlled-provider-proof";
import { controlledFinancialReadiness,controlledWorkNeedsParentReadiness } from "./controlled-provider-readiness";
import { requireControlledProviderSchema } from "./controlled-provider-source";
import { signProviderReadProof } from "./provider-read-signatures";
const digest=(nonce:string)=>createHash("sha256").update(nonce).digest("hex");
type Actual=MerchantControlledObservation;
type Held={operationId:string;nonce:string;invoked:boolean;completed:boolean;actualResult?:Record<string,unknown>;facts:Map<number,{id:string;actual:Actual}>};
const slot=Symbol.for("freeholder.controlled-provider.original-callers.v1");
const runtime=globalThis as typeof globalThis&{[slot]?:Map<string,Held>};
const held=runtime[slot]??=new Map<string,Held>();
async function original(ctx:ServiceContext,operationId:string){
 await lockContactIdentityForRead(ctx.tx);await requireControlledProviderSchema(ctx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledOperations.resourceId}).from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,operationId)).limit(1);
 if(!reference)throw new ServiceError("not_found","There is no such actual original controlled operation.");
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
 const[operation]=await ctx.tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,operationId)).limit(1).for("update");
 if(!resource||!operation||operation.resourceId!==resource.id||merchantTaxDigest(operation.originalRequest)!==operation.requestDigest
  ||operation.originalRequest.scopeDigest!==merchantTaxDigest(resource.originalScope))throw new ServiceError("conflict","Restore the actual original controlled resource, request and immutable original scope before another observation.");
 return{resource,operation};
}
const holder=z.object({callId:z.uuid(),nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
async function actualHolder(ctx:ServiceContext,input:z.infer<typeof holder>){
 const local=held.get(input.callId);if(!local||!local.invoked||local.nonce!==input.nonce)throw new ServiceError("permission","Only the actual original controlled SDK holder has this caller's nonce and observed facts.");
 const source=await original(ctx,local.operationId);
 const[call]=await ctx.tx.select().from(subscriptionControlledCalls).where(eq(subscriptionControlledCalls.id,input.callId)).limit(1);
 const proof=call?originalControlledCall(source.operation,call):null;
 const[stop]=await ctx.tx.select().from(subscriptionControlledStops).where(eq(subscriptionControlledStops.callId,input.callId)).limit(1);
 if(!call||!proof||stop||proof.payload.callerId!==merchantPhysicalCaller().id||proof.payload.completionDigest!==digest(input.nonce))throw new ServiceError("permission","A stopped or substituted original controlled caller cannot submit a late callback or invented finish.");
 return{...source,local,call,proof};
}
export const claimControlledProviderCall=defineService({name:"subscriptions.claimControlledProviderCall",summary:"Admit this exact current immutable operation's actual physical caller; an old queued body cannot claim or stop a successor.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({operationId:z.uuid()}),
 output:z.object({callId:z.uuid(),nonce:z.string(),operationId:z.uuid()}),handler:async(input,ctx)=>{
  const source=await original(ctx,input.operationId),history=await controlledProviderJournal(ctx.tx,source.resource.id);
  const last=history.operations[history.operations.length-1];
  if(history.count>4996)throw new ServiceError("conflict","Retain capacity for the actual original caller, raw result and distinct finish before admitting another bounded bank invocation.");
  if(history.closures.length||!last||last.id!==source.operation.id||history.unfinished.length||history.calls.some(call=>call.operationId===source.operation.id))throw new ServiceError("conflict","Recover every actual original caller and its bank result first. A stale operation or previously admitted physical invocation cannot be dispatched again.");
  const before={operations:history.operations.filter(row=>row.id!==source.operation.id),calls:history.calls,facts:history.facts,finishes:history.finishes,stops:history.stops,verifications:history.verifications,chargeOrigins:history.chargeOrigins,closures:history.closures};
  if(merchantTaxDigest(before)!==source.operation.previousEvidenceRevision)throw new ServiceError("conflict","The exact original money/caller observation revision changed before admission. Review its actual current source.");
  if(controlledWorkNeedsParentReadiness(source.operation.kind)){
   const parent=await controlledFinancialReadiness(ctx,source.resource.subscriptionId,source.operation.id);
   if(parent.revision!==source.operation.originalRequest.parentFinancialRevision)throw new ServiceError("conflict","The original parent financial namespace or complete witness changed before physical admission. Retain the old intent and review its actual current source.");
  }
  const[allowed]=await ctx.tx.execute<{allowed:boolean}>(sql`select freeholder_controlled_operation_admissible(${source.operation.id}::uuid) as allowed`);
  if(allowed?.allowed!==true)throw new ServiceError("conflict","This actual original controlled operation lacks its required current consent, deadline, cash disposition or prior bank proof.");
  const callId=randomUUID(),nonce=randomBytes(32).toString("base64url"),caller=merchantPhysicalCaller();
  const admission=signProviderReadProof("admission",{purpose:CONTROLLED_CALL_PURPOSE,callId,operationId:source.operation.id,resourceId:source.resource.id,kind:source.operation.kind,
   requestDigest:source.operation.requestDigest,callerId:caller.id,caller,completionDigest:digest(nonce),admittedSourceRevision:merchantTaxDigest(before)});
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledCalls).values({id:callId,operationId:source.operation.id,admission,admissionDigest:merchantTaxDigest(admission)});
  return{callId,nonce,operationId:source.operation.id};
 }});
export const retainControlledProviderFact=defineService({name:"subscriptions.retainControlledProviderFact",summary:"Retain the original actual SDK observation before interpretation or auxiliary failures, under its independent stop fence.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:holder.extend({ordinal:z.number().int().min(1).max(5000)}),output:z.object({retained:z.literal(true)}),
 handler:async(input,ctx)=>{
  const source=await actualHolder(ctx,input),actual=source.local.facts.get(input.ordinal);
  if(!actual||Buffer.byteLength(JSON.stringify(actual.actual))>256000)throw new ServiceError("conflict","Retain this actual original observation's complete bounded evidence; a replacement caller cannot invent or truncate it.");
  const[prior]=await ctx.tx.select().from(subscriptionControlledFacts).where(eq(subscriptionControlledFacts.id,actual.id)).limit(1);
  if(prior){if(prior.callId!==source.call.id||prior.ordinal!==input.ordinal||prior.actualDigest!==merchantTaxDigest(actual.actual))throw new ServiceError("conflict","Preserve the exact first original observed occurrence.");return{retained:true as const};}
  const inventory=await controlledProviderJournal(ctx.tx,source.resource.id);
  if(inventory.count>=5000)throw new ServiceError("conflict","The complete original controlled history reached its bounded evidence capacity; new facts cannot be silently truncated.");
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledFacts).values({id:actual.id,callId:source.call.id,ordinal:input.ordinal,
   actual:actual.actual,actualDigest:merchantTaxDigest(actual.actual)});
  return{retained:true as const};
 }});
export const retainControlledProviderCashFact=defineService({name:"subscriptions.retainControlledProviderCashFact",summary:"First-capture actual controlled principal through the shared canonical receipt after its signed/raw original occurrence committed independently.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:holder.extend({ordinal:z.number().int().min(1).max(5000)}),output:z.object({receiptId:z.uuid()}),
 handler:async(input,ctx)=>{
  const source=await actualHolder(ctx,input),local=source.local.facts.get(input.ordinal);
  if(!local||local.actual.kind!=="cash_observed")throw new ServiceError("permission","Only the actual original SDK's retained positive occurrence can request this canonical receipt.");
  const[fact]=await ctx.tx.select().from(subscriptionControlledFacts).where(eq(subscriptionControlledFacts.id,local.id)).limit(1);
  if(!fact||fact.callId!==source.call.id||fact.ordinal!==input.ordinal||fact.actualDigest!==merchantTaxDigest(local.actual))throw new ServiceError("conflict","Commit the exact authentic raw occurrence before canonical first capture.");
  const cash=controlledCashEvidence.parse(local.actual.raw.cash);
  const retained=await ctx.callAsSystem(retainProviderCharge,{...cash,controlledOrigin:{resourceId:source.resource.id,callId:source.call.id,factId:fact.id}});
  if(!retained.receiptId||!retained.matchesOriginalMoney)throw new ServiceError("conflict","Actual controlled money remains retained for review; a conflicting canonical receipt cannot be overwritten or adopted.");
  return{receiptId:retained.receiptId};
 }});
export const finishControlledProviderCall=defineService({name:"subscriptions.finishControlledProviderCall",summary:"Retain only this actual original SDK invocation's returned/thrown result; runtime stop and bank outcome stay separate.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:holder,output:z.object({finished:z.literal(true)}),handler:async(input,ctx)=>{
  const source=await actualHolder(ctx,input);
  if(!source.local.completed||!source.local.actualResult)throw new ServiceError("permission","The actual physical SDK call has not completed in its original process.");
  for(const[ordinal,actual]of source.local.facts){const[stored]=await ctx.tx.select().from(subscriptionControlledFacts).where(eq(subscriptionControlledFacts.id,actual.id)).limit(1);
   if(!stored||stored.callId!==source.call.id||stored.ordinal!==ordinal||stored.actualDigest!==merchantTaxDigest(actual.actual))throw new ServiceError("conflict","Retain every genuine original observation before signing the actual caller finish.");}
  const[existing]=await ctx.tx.select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,source.call.id)).limit(1);
  if(existing){if(!finishedControlledCall(source.operation,source.call,existing)||merchantTaxDigest(existing.actualResult)!==merchantTaxDigest(source.local.actualResult))throw new ServiceError("conflict","Preserve the first genuine original caller result; a cached finish cannot rewrite it.");return{finished:true as const};}
  const proof=signProviderReadProof("finish",{purpose:CONTROLLED_CALL_PURPOSE,callId:source.call.id,operationId:source.operation.id,resourceId:source.resource.id,requestDigest:source.operation.requestDigest,
   admissionDigest:source.call.admissionDigest,callerId:source.proof.payload.callerId,completionDigest:source.proof.payload.completionDigest,
   outcome:source.local.actualResult.outcome,factsDigest:merchantTaxDigest(source.local.actualResult)});
  if(proof.publicKey!==source.proof.publicKey)throw new ServiceError("permission","A replacement process cannot sign this original caller's finish.");
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledFinishes).values({callId:source.call.id,proof,proofDigest:merchantTaxDigest(proof),actualResult:source.local.actualResult}).onConflictDoNothing();
  const[saved]=await ctx.tx.select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,source.call.id)).limit(1);
  if(!saved||!finishedControlledCall(source.operation,source.call,saved))throw new ServiceError("conflict","Restore the exact first actual signed original caller result.");
  return{finished:true as const};
 }});
export async function flushControlledProviderFinishes(operationId:string){
 for(const[callId,local]of held)if(local.operationId===operationId&&local.completed){
  for(const ordinal of local.facts.keys())await retainControlledProviderFact.call({callId,nonce:local.nonce,ordinal},{kind:"system"});
  await finishControlledProviderCall.call({callId,nonce:local.nonce},{kind:"system"});held.delete(callId);
 }
}
/** The operation planner supplies a frozen typed request. It cannot run any
 * bank work until its exact original admission and current causal guard pass. */
export async function withControlledProviderCall<T>(operationId:string,actor:Actor,work:(observe:(actual:Actual)=>Promise<void>)=>Promise<T>):Promise<T>{
 await flushControlledProviderFinishes(operationId);
 const system={kind:"system",request:actor.request} as const,claim=await claimControlledProviderCall.call({operationId},system);
 const local:Held={operationId,nonce:claim.nonce,invoked:true,completed:false,facts:new Map()};held.set(claim.callId,local);
 const observe=async(actual:Actual)=>{const ordinal=local.facts.size+1;local.facts.set(ordinal,{id:randomUUID(),actual:JSON.parse(JSON.stringify(actual))});
  await retainControlledProviderFact.call({callId:claim.callId,nonce:claim.nonce,ordinal},system);
  // A separate committed transaction deliberately follows the raw occurrence.
  // Bridge/domain refusal cannot roll that authentic positive fact back.
  if(actual.kind==="cash_observed")await retainControlledProviderCashFact.call({callId:claim.callId,nonce:claim.nonce,ordinal},system);};
 let result:T|undefined;
 try{result=await work(observe);local.completed=true;local.actualResult={outcome:"returned",result:JSON.parse(JSON.stringify(result??null))};return result;}
 finally{
  if(!local.completed){local.completed=true;local.actualResult={outcome:"threw"};}
  // Preserve real SDK completion independently of the caller's later domain
  // application. Failed commits remain in this actual holder's replay cache.
  for(const ordinal of local.facts.keys())await retainControlledProviderFact.call({callId:claim.callId,nonce:claim.nonce,ordinal},system);
  await finishControlledProviderCall.call({callId:claim.callId,nonce:claim.nonce},system);held.delete(claim.callId);
 }
}
export default[claimControlledProviderCall,retainControlledProviderFact,retainControlledProviderCashFact,finishControlledProviderCall];
