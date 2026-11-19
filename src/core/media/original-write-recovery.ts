// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual fresh-human phases. An original request is resolved through its own
// retained finish, fresh nonce-bound bytes and two complete provider passes.
import {createHash,randomUUID} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {z} from "zod";
import {actorString,type Actor} from "@/core/service";
import type {AccountedTransferStore} from "../../../scripts/media-transfer.mjs";
import {defineMediaService} from "./guarded-service";
import {storageRecoveryConfirmation,type StorageRecoveryConfirmation} from "./storage-recovery-contract";
import {mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferReviews as reviews} from "./transfer-schema";
import {captureRecoverableOriginalPut,captureOriginalRecoveryInventory,originalRecoveryInventoryProgress,appendOriginalRecoveryInventoryPage,finishOriginalRecoveryInventory,lockedOriginalAbsenceInventory,lockedOriginalRecoveryInventory,lockedOriginalReviewInventory,type OriginalInventoryPageResult} from "./original-provider-inventory";
import {configuredOriginalRequestStore} from "./transfer-storage";
import {originalPutRevisionForAbsence,originalPutRevisionForRecovery,transferConflict,transferDigest} from "./transfer-proof";
import {requireOriginalProviderRequestResult} from "./provider-request-proof";
import {admitOriginalMediaCaller,retainOriginalMediaCallerReturn,type OriginalMediaCallerReturn} from "./provider-callers";
import {actualStorageCallerRuntimeIdentity,currentStorageCallerRuntimeSchema} from "./physical-caller-runtime";
import {mediaStorageTransferRequests as requests} from "./transfer-request-schema";
import {withTransferRequestScope} from "./transfer-requests";
import {releaseRetiredOriginalQuota,settleRecoveredOriginalQuota} from "./original-recovery-quota";
import {reconcileMediaErasureCohorts} from "./erasure-cohorts";
const digest=z.string().regex(/^[a-f0-9]{64}$/),runtime=z.object({token:z.string().min(36),runtimeIdentity:currentStorageCallerRuntimeSchema});
const claim=defineMediaService({name:"media.captureOriginalPutRecovery",summary:"Capture exact actual finishes or an independently verified stopped original PUT without inventing birth or return.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:storageRecoveryConfirmation,output:z.custom<Awaited<ReturnType<typeof captureRecoverableOriginalPut>>>(),auditInputFields:["id","outcome","stopDrainId"],handler:async(input,ctx)=>{
 const original=await captureRecoverableOriginalPut(ctx.tx,input.id,ctx.actor,input.stopDrainId),row=original.receipt;
 if(!["started","unknown"].includes(row.state)||row.updatedAt.toISOString()!==input.expectedUpdatedAt||row.namespace!==input.originalNamespace||input.originalKey&&input.originalKey!==row.key||input.sha256&&input.sha256!==row.sha256||input.bytes!==undefined&&input.bytes!==row.bytes||input.outcome==="not_applied"&&row.observedAcceptedAt)transferConflict("The exact original PUT evidence changed, names different bytes, or already has a positive acknowledgement. Reload its receipt.");
 ctx.setSubject("media_storage_operation",row.id);return original;
}});
const admitRead=defineMediaService({name:"media.admitOriginalPutRecoveryRead",summary:"Admit a fresh original-provider read without restarting the failed original PUT.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:storageRecoveryConfirmation.extend({expectedWitness:digest,...runtime.shape}),output:z.object({id:z.uuid()}),auditInputFields:["id","outcome","stopDrainId"],handler:async(input,ctx)=>{
 const original=await captureRecoverableOriginalPut(ctx.tx,input.id,ctx.actor,input.stopDrainId);if(original.witness!==input.expectedWitness||original.receipt.updatedAt.toISOString()!==input.expectedUpdatedAt)transferConflict("The original writer changed before this new read admission.");
 return admitOriginalMediaCaller(ctx.tx,{kind:"ordinary_recovery_read",objectReceiptId:input.id,token:input.token,runtimeIdentity:input.runtimeIdentity,expectedRevision:originalPutRevisionForRecovery(original.receipt,original.binding)??undefined},ctx.actor);
}});
const beginInventory=defineMediaService({name:"media.captureOriginalPutRecoveryInventory",summary:"Capture the first immutable original inventory after the actual nonce-bound full-byte read.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:z.object({receiptId:z.uuid(),originalCallId:z.uuid(),proofCallId:z.uuid(),stopDrainId:z.uuid().optional(),outcome:z.enum(["applied","not_applied"]).default("applied")}),output:z.custom<Awaited<ReturnType<typeof captureOriginalRecoveryInventory>>>(),auditInputFields:["receiptId","originalCallId","proofCallId","stopDrainId"],handler:async(input,ctx)=>captureOriginalRecoveryInventory(ctx.tx,input,ctx.actor,input.outcome==="not_applied"?"retirement":"recovery")});
const progress=defineMediaService({name:"media.readOriginalPutRecoveryInventory",summary:"Read the unchanged original provider page chain.",kind:"query",permission:"scoped",agentCallable:false,external:false,orchestratedBy:"media.reconcileStorageOperation",input:z.object({id:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof originalRecoveryInventoryProgress>>>(),handler:async(input,ctx)=>originalRecoveryInventoryProgress(ctx.tx,input.id,ctx.actor)});
const admitPage=defineMediaService({name:"media.admitOriginalPutInventoryRequest",summary:"Admit exactly one actual provider configuration/page request for this original inventory.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:z.object({id:z.uuid(),...runtime.shape}),output:z.object({id:z.uuid()}),auditInputFields:["id"],handler:async(input,ctx)=>{
 const original=await lockedOriginalReviewInventory(ctx.tx,input.id,ctx.actor);if(original.inventory.state!=="capturing")transferConflict();return admitOriginalMediaCaller(ctx.tx,{kind:"ordinary_retirement_inventory",objectReceiptId:original.receipt.id,token:input.token,runtimeIdentity:input.runtimeIdentity},ctx.actor);
}});
const appendPage=defineMediaService({name:"media.appendOriginalPutInventoryPage",summary:"Append the exact actual original provider page and immutable membership.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:z.custom<OriginalInventoryPageResult>(),output:z.object({ok:z.literal(true)}),auditInputFields:["inventoryId","callId","pass","kind"],handler:async(input,ctx)=>appendOriginalRecoveryInventoryPage(ctx.tx,input,ctx.actor)});
const finishInventory=defineMediaService({name:"media.finishOriginalPutRecoveryInventory",summary:"Verify both complete original version/session passes and exact original result provenance.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:z.object({id:z.uuid()}),output:z.object({id:z.uuid()}),auditInputFields:["id"],handler:async(input,ctx)=>({id:(await finishOriginalRecoveryInventory(ctx.tx,input.id,ctx.actor)).id})});
const apply=defineMediaService({name:"media.applyOriginalPutRecovery",summary:"Settle only the exact original PUT and quota token without changing its first physical result.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:storageRecoveryConfirmation.extend({inventoryId:z.uuid(),expectedWitness:digest}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","outcome","inventoryId","stopDrainId"],handler:async(input,ctx)=>{
 const absent=input.outcome==="not_applied",original=await (absent?lockedOriginalAbsenceInventory:lockedOriginalRecoveryInventory)(ctx.tx,input.inventoryId,ctx.actor),{receipt,caller,inventory,actual}=original;
 if(receipt.id!==input.id||inventory.state!=="complete"||original.witness!==input.expectedWitness||receipt.updatedAt.toISOString()!==input.expectedUpdatedAt||receipt.namespace!==input.originalNamespace||!receipt.sha256||receipt.bytes===null||absent!==(inventory.purpose==="retirement"))transferConflict("The complete original recovery proof changed before settlement.");
 const revision=actual?requireOriginalProviderRequestResult(original.write,actual):null,revisionDigest=revision?transferDigest(revision):null;
 if(!absent){
  if(!actual||!revision||!revisionDigest)transferConflict("The applied original full-byte result is missing.");
  if(receipt.providerRevisionDigest&&receipt.providerRevisionDigest!==revisionDigest)transferConflict("A later generation cannot replace the first actual original provider revision.");
  await settleRecoveredOriginalQuota(ctx.tx,caller,actual.bytes);
 }else{
  if(actual||receipt.observedAcceptedAt||!original.proof.resultAbsent||transferDigest(original.proof.expectedRevision)!==transferDigest(originalPutRevisionForAbsence(receipt,original.binding)))transferConflict("Original PUT absence requires no positive ACK and a fresh pinned physical absence.");
  await releaseRetiredOriginalQuota(ctx.tx,caller,receipt.bytes);
 }
 const evidenceDigest=transferDigest({originalWitness:input.expectedWitness,inventoryId:inventory.id,proofCallId:original.proof.id,providerFinalReference:input.providerFinalReference,providerEvidence:input.providerEvidence,outcome:input.outcome,reviewedBy:actorString(ctx.actor)}),now=new Date();
 // A review never creates an actual physical return/finish. Every original
 // admission, first result/return and observation stays intact.
 const reviewId=randomUUID();
 await ctx.tx.insert(reviews).values({id:reviewId,objectId:null,objectReceiptId:receipt.id,inventoryId:inventory.id,callId:caller.id,originalCallWitness:transferDigest(caller),readCallId:original.proof.id,outcome:absent?"not_applied":"applied",providerEvidenceDigest:evidenceDigest,stopDrainId:original.executorStop?.id,reviewedBy:actorString(ctx.actor)});
 for(const physical of original.requests)if(["admitted","unknown"].includes(physical.state))await ctx.tx.update(requests).set({state:"stopped",stopReceiptId:reviewId}).where(eq(requests.id,physical.id));
 await ctx.tx.update(calls).set({state:"stopped",stoppedAt:caller.stoppedAt??now,stopReceiptId:reviewId,updatedAt:now}).where(eq(calls.id,caller.id));
 await ctx.tx.update(mediaObjectWrites).set({state:absent?"confirmed_absent":"accepted",...(revision&&revisionDigest?{providerRevision:revision,providerRevisionDigest:revisionDigest}:{}),reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,...(absent?{deletedAt:now}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,receipt.id));
 if(absent)await ctx.tx.delete(mediaObjects).where(and(eq(mediaObjects.reservationId,receipt.originalReservationId!),eq(mediaObjects.key,receipt.key),eq(mediaObjects.state,"pending")));
 ctx.setSubject("media_storage_operation",receipt.id);return{ok:true as const};
}});
async function physicalInventory<T>(inventoryId:string,actor:Actor,operation:()=>Promise<T>,outcome:(value:T)=>OriginalMediaCallerReturn){
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity(),call=await admitPage.call({id:inventoryId,token,runtimeIdentity},actor);
 try{const value=await withTransferRequestScope({callId:call.id,token,runtimeIdentity},operation);if(!(await retainOriginalMediaCallerReturn(call.id,token,outcome(value))).settled)transferConflict();return{id:call.id,value};}
 catch(error){await retainOriginalMediaCallerReturn(call.id,token,{failed:true}).catch(()=>{});throw error;}
}
async function ensureOriginalInventory(id:string,store:AccountedTransferStore,actor:Actor){
 let captured=await progress.call({id},actor);if(captured.inventory.state==="complete")return id;if(captured.inventory.state!=="capturing")transferConflict();
 for(const pass of [0,1]as const){
  if(!captured.pages.some(row=>row.pass===pass&&row.kind==="configuration")){const actual=await physicalInventory(id,actor,()=>store.inventoryConfiguration(),value=>({configurationDigest:transferDigest(value)}));await appendPage.call({inventoryId:id,callId:actual.id,pass,kind:"configuration",cursor:null,configuration:actual.value},actor);captured=await progress.call({id},actor);}
  // Only ask for versions where versions exist. Migration 0109 applies the same
  // rule to the SQL completeness guards, and transfer-inventory.ts to the
  // verifier; all three MUST agree, because a listing skipped here but demanded
  // there reads as "the original provider inventory is still truncated".
  //
  // Positive evidence only: the listing is requested because the configuration
  // page captured just above for THIS pass says the bucket keeps versions,
  // never because the answer was missing. A suspended bucket still holds the
  // versions it took while enabled, so it counts.
  const retains=captured.pages.some(row=>row.pass===pass&&row.kind==="configuration"
   &&["Enabled","Suspended"].includes(row.configuration?.versioning??""));
  const kinds=store.binding.kind==="s3"
   ?(retains?["objects","versions","sessions"]as const:["objects","sessions"]as const)
   :(retains?["objects","versions","retained"]as const:["objects","retained"]as const);
  for(const kind of kinds){
   const prior=captured.pages.filter(row=>row.pass===pass&&row.kind===kind),last=prior.at(-1);if(last&&last.nextCursor===null)continue;let cursor=last?.nextCursor??null;
   for(let page=prior.length;;page++){if(page>=200)transferConflict("The complete original inventory exceeds this bounded page proof. No subset can be settled.");const actual=await physicalInventory(id,actor,()=>store.inventoryPage(kind,cursor),value=>({inventoryDigest:transferDigest(value),inventoryCount:value.entries.length}));await appendPage.call({inventoryId:id,callId:actual.id,pass,kind,cursor,page:actual.value},actor);cursor=actual.value.next;if(cursor===null)break;}
   captured=await progress.call({id},actor);
  }
 }
 await finishInventory.call({id},actor);return id;
}
export async function recoverExactOriginalPut(input:StorageRecoveryConfirmation,actor:Actor):Promise<{ok:true}>{
 const original=await claim.call(input,actor),store=await configuredOriginalRequestStore(original.binding),token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity(),read=await admitRead.call({...input,expectedWitness:original.witness,token,runtimeIdentity},actor);
 try{
  const result=await withTransferRequestScope({callId:read.id,token,runtimeIdentity},()=>store.readVersioned(original.receipt.key,originalPutRevisionForRecovery(original.receipt,original.binding)??undefined));
  if(!result){
   await retainOriginalMediaCallerReturn(read.id,token,{absent:true});if(input.outcome==="applied")transferConflict("The current object is absent; this does not prove the original ambiguous PUT was never applied.");
  }else{
   const actual={key:original.receipt.key,namespace:store.binding.namespace,sha256:createHash("sha256").update(result.body).digest("hex"),bytes:result.body.byteLength,revision:result.revision,requestProof:result.requestProof};
   await retainOriginalMediaCallerReturn(read.id,token,{accepted:true,...actual});requireOriginalProviderRequestResult(original.write,actual);if(input.outcome==="not_applied")transferConflict("The original pinned bytes are still present; retain the PUT for applied recovery or managed removal.");
  }
 }catch(error){await retainOriginalMediaCallerReturn(read.id,token,{failed:true}).catch(()=>{});throw error;}
 const header=await beginInventory.call({receiptId:original.receipt.id,originalCallId:original.caller.id,proofCallId:read.id,stopDrainId:input.stopDrainId,outcome:input.outcome},actor),inventoryId=await ensureOriginalInventory(header.id,store,actor),result=await apply.call({...input,inventoryId,expectedWitness:original.witness},actor);
 await reconcileMediaErasureCohorts({objectReceiptId:input.id}).catch(()=>{});return result;
}
export default[claim,admitRead,beginInventory,progress,admitPage,appendPage,finishInventory,apply];
