// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {currentStorageCallerRuntimeSchema,originalLinuxCallerIdentity} from "./physical-caller-runtime";
// C1.12/C11.08: fresh human evidence appends; actual return facts never change.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray} from "drizzle-orm";
import {z} from "zod";
import {actorString,defineOrchestratedService,hasModuleAccess,ServiceError,type Actor,type Tx} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferReviews,mediaStorageWriterDrains} from "./transfer-schema";
import {assertTransferOwners,lockedTransfer,requireTransferCapability} from "./transfer-authority";
import {configuredTransferStores} from "./transfer-storage";
import {withTransferRequestScope} from "./transfer-requests";
import {retainTransferFailure,retainTransferReturn,transferRuntimeId,transferRuntimeIdentity} from "./transfer-callers";
import {checkedTransferRevision,transferConflict,transferDigest,transferTargetKey,verifiedTransferBytes} from "./transfer-proof";
import targetInventoryServices,{collectTargetPutRecoveryInventory} from "./target-put-recovery-inventory";
import {originalInventoryLifecycle,lockedOriginalRecoveryInventory} from "./original-provider-inventory";
import {requireOriginalProviderRequestResult} from "./provider-request-proof";
import {mediaStorageTransferRequests as physicalRequests} from "./transfer-request-schema";
import {settleRecoveredOriginalQuota} from "./original-recovery-quota";
import {releaseTransferQuota} from "./transfer-quota";
import {objectKeyDigest} from "./write-ledger";
import {reconcileMediaErasureCohorts} from "./erasure-cohorts";
const inputSchema=z.object({callId:z.uuid(),expectedWitness:z.string().regex(/^[a-f0-9]{64}$/),stopDrainId:z.uuid().optional(),originalKey:z.string().min(1).max(2048).optional(),originalSourceKey:z.string().min(1).max(2048).optional(),outcome:z.enum(["applied","not_applied","retired"]),retryOriginal:z.boolean().default(false),providerFinalReference:z.string().trim().min(8).max(300),providerEvidence:z.string().trim().min(20).max(2000),confirmation:z.literal("ORIGINAL CALLER AND PROVIDER OUTCOME CONFIRMED")});
function human(actor:Actor){if(actor.kind!=="user"||actor.keyScopes||!hasModuleAccess(actor,"media","manage"))throw new ServiceError("permission","Sign in as a person with permission to review original storage callers.");}
async function originalReview(tx:Tx,input:z.infer<typeof inputSchema>){
 await requireTransferCapability(tx);
 const[identity]=await tx.select({planId:mediaStorageTransferObjects.planId}).from(mediaStorageTransferCalls).innerJoin(mediaStorageTransferObjects,eq(mediaStorageTransferObjects.id,mediaStorageTransferCalls.objectId)).where(eq(mediaStorageTransferCalls.id,input.callId)).limit(1);if(!identity)transferConflict();
 const work=await lockedTransfer(tx,identity.planId),[call]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,input.callId)).limit(1).for("update");
 if(!call||!["admitted","unknown"].includes(call.state)||transferDigest(call)!==input.expectedWitness)transferConflict("The exact original caller changed. Reload its current receipt before review.");
 const object=work.objects.find(row=>row.id===call.objectId);if(!object)transferConflict();
 let stopDrainId:string|null=null,targetWrite:Awaited<ReturnType<typeof originalInventoryLifecycle.captureTransferPut>>|null=null;
 if(call.kind==="target_put"){
  if(input.outcome!=="applied"||input.retryOriginal)transferConflict("An unresolved original target PUT needs affirmative original nonce, full-byte and complete provider inventory proof. Absence alone cannot permit another write.");
  if(!call.physicalReceiptId)transferConflict();
  targetWrite=await originalInventoryLifecycle.captureTransferPut(tx,call.physicalReceiptId,call.id,input.stopDrainId);stopDrainId=targetWrite.executorStop?.id??null;
 }else if(!call.returnedAt){
  const[drain]=input.stopDrainId?await tx.select().from(mediaStorageWriterDrains).where(eq(mediaStorageWriterDrains.id,input.stopDrainId)).limit(1):[];
  const snapshot=z.object({format:z.literal("freeholder.media-writer-drain/v1"),boot:z.string(),processes:z.array(z.object({pid:z.number().int(),startTicks:z.string()}))}).safeParse(drain?.originalProcesses);
  const originalKernel=originalLinuxCallerIdentity(call.runtimeIdentity);
  if(!originalKernel||!drain||drain.state!=="verified"||!drain.verifiedAt||!drain.stopProofDigest||!snapshot.success||snapshot.data.boot!==originalKernel.boot||!snapshot.data.processes.some(row=>row.pid===originalKernel.pid&&row.startTicks===originalKernel.startTicks))transferConflict("The actual original caller has not returned and its exact process has not been proven stopped.");
  stopDrainId=drain.id;
 }
 if(input.retryOriginal){if(input.outcome!=="not_applied")transferConflict();await assertTransferOwners(tx,[object]);}
 const target=call.namespace===work.plan.targetNamespace;
 if(!target&&call.namespace!==work.plan.sourceNamespace)transferConflict();
 const keyDigest=target?object.targetKeyDigest:object.keyDigest;
 const key=input.originalKey??(call.physicalKey.startsWith("retained:")?(target?transferTargetKey(work.plan.id,object.keyDigest):undefined):call.physicalKey);
 if(!key||objectKeyDigest(key)!==keyDigest)transferConflict("Restore the exact original physical key matching its immutable digest.");
 if(call.observedAcceptedAt&&input.outcome==="not_applied"&&["target_put","source_delete","privacy_delete","privacy_source_delete"].includes(call.kind))transferConflict("A positive original provider acknowledgement cannot be marked unapplied.");
 return{plan:work.plan,object,call,key,stopDrainId,target,targetWrite};
}
type Review=Awaited<ReturnType<typeof originalReview>>;
const capture=defineMediaService({name:"media.captureTransferReview",summary:"Capture an unchanged original caller and its actual return or stopped-process proof.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:inputSchema,output:z.custom<Review>(),auditInputFields:["callId","outcome","retryOriginal"],handler:async(input,ctx)=>{human(ctx.actor);return originalReview(ctx.tx,input);}});
const admitRead=defineMediaService({name:"media.admitTransferReviewRead",summary:"Commit one exact original-provider recovery read without retrying the unresolved write.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:inputSchema.extend({token:z.string().min(36),runtimeIdentity:currentStorageCallerRuntimeSchema,resource:z.enum(["caller","original_source"]).default("caller")}),output:z.object({id:z.uuid()}),auditInputFields:["callId","outcome"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await originalReview(ctx.tx,input),id=randomUUID(),key=input.resource==="original_source"?input.originalSourceKey:original.key,namespace=input.resource==="original_source"?original.plan.sourceNamespace:original.call.namespace;
 if(!key||input.resource==="original_source"&&objectKeyDigest(key)!==original.object.keyDigest)transferConflict("The supplied original source key does not match its immutable digest.");
 const expectedRevision=(input.resource==="original_source"?original.object.sourceRevision:original.targetWrite?.receipt.providerRevision??original.call.expectedRevision)??undefined;
 await ctx.tx.insert(mediaStorageTransferCalls).values({id,objectId:original.object.id,kind:"recovery_read",namespace,physicalKey:key,requestDigest:transferDigest({originalCallId:original.call.id,originalCallWitness:input.expectedWitness,key,namespace}),callerTokenDigest:transferDigest(input.token),runtimeId:transferRuntimeId,runtimeIdentity:input.runtimeIdentity,...(expectedRevision?{expectedRevision}:{})});
 return{id};
}});
const apply=defineMediaService({name:"media.applyTransferReview",summary:"Append fresh human provider proof without replacing the original physical outcome.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:inputSchema.extend({readCallId:z.uuid(),inventoryId:z.uuid().optional()}),output:z.object({ok:z.literal(true),reviewId:z.uuid()}),auditInputFields:["callId","outcome","retryOriginal"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await originalReview(ctx.tx,input),[read]=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,input.readCallId)).limit(1);
 if(!read||read.objectId!==original.object.id||read.kind!=="recovery_read"||read.state!=="returned"||!read.returnedAt||read.namespace!==original.call.namespace||read.physicalKey!==original.key)transferConflict("The exact original-provider recovery read has not actually finished.");
 if(original.targetWrite){
  if(!input.inventoryId)transferConflict("Retain the complete first original target recovery inventory before positive review.");
  const proven=await lockedOriginalRecoveryInventory(ctx.tx,input.inventoryId,ctx.actor);
  if(proven.inventory.state!=="complete"||!proven.transferContext||proven.transferContext.objectId!==original.object.id||proven.caller.id!==original.call.id||proven.receipt.id!==original.call.physicalReceiptId||proven.proof.id!==read.id||proven.witness!==original.targetWrite.witness)transferConflict("The exact original target read, physical admission or first inventory changed before review.");
  const revision=requireOriginalProviderRequestResult(proven.write,proven.actual),revisionDigest=transferDigest(revision);
  if(proven.receipt.providerRevisionDigest&&proven.receipt.providerRevisionDigest!==revisionDigest)transferConflict("The original target provider generation cannot be replaced by a current revision.");
  await settleRecoveredOriginalQuota(ctx.tx,original.call,proven.actual.bytes);
  const id=randomUUID(),now=new Date(),evidenceDigest=transferDigest({providerFinalReference:input.providerFinalReference,providerEvidence:input.providerEvidence,outcome:"applied",originalCallId:original.call.id,originalCallWitness:input.expectedWitness,physicalWitness:proven.witness,readCallId:read.id,inventoryId:proven.inventory.id,stopDrainId:original.stopDrainId,reviewedBy:actorString(ctx.actor)});
  await ctx.tx.insert(mediaStorageTransferReviews).values({id,objectId:original.object.id,inventoryId:proven.inventory.id,callId:original.call.id,originalCallWitness:input.expectedWitness,readCallId:read.id,outcome:"applied",providerEvidenceDigest:evidenceDigest,stopDrainId:original.stopDrainId,permitsRetry:false,reviewedBy:actorString(ctx.actor)});
  for(const request of proven.requests)if(["admitted","unknown"].includes(request.state))await ctx.tx.update(physicalRequests).set({state:"stopped",stopReceiptId:id}).where(eq(physicalRequests.id,request.id));
  await ctx.tx.update(mediaStorageTransferCalls).set({state:"stopped",stoppedAt:original.call.stoppedAt??now,stopReceiptId:id,updatedAt:now}).where(eq(mediaStorageTransferCalls.id,original.call.id));
  await ctx.tx.update(mediaObjectWrites).set({state:"accepted",providerRevision:revision,providerRevisionDigest:revisionDigest,reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(mediaObjectWrites.id,proven.receipt.id));
  ctx.setSubject("media_storage_transfer",original.plan.id);return{ok:true as const,reviewId:id};
 }
 const deletion=["source_delete","privacy_delete","privacy_source_delete"].includes(original.call.kind),absent=input.outcome==="retired"||deletion&&input.outcome==="applied"||!deletion&&input.outcome==="not_applied";
 if(absent?!read.resultAbsent:read.resultAbsent||read.resultSha256!==original.object.sha256||read.resultBytes!==original.object.bytes)transferConflict("The actual full-byte/absence proof disagrees with this original provider outcome.");
 if(!absent)checkedTransferRevision(read.resultRevision,original.target?original.plan.originalTarget:original.plan.originalSource,original.key);
 const id=randomUUID(),evidenceDigest=transferDigest({providerFinalReference:input.providerFinalReference,providerEvidence:input.providerEvidence,outcome:input.outcome,originalCallId:original.call.id,originalCallWitness:input.expectedWitness,readCallId:read.id,stopDrainId:original.stopDrainId,reviewedBy:actorString(ctx.actor)}),now=new Date();
 await ctx.tx.insert(mediaStorageTransferReviews).values({id,objectId:original.object.id,callId:original.call.id,originalCallWitness:input.expectedWitness,readCallId:read.id,outcome:input.outcome,providerEvidenceDigest:evidenceDigest,stopDrainId:original.stopDrainId,permitsRetry:input.retryOriginal,reviewedBy:actorString(ctx.actor)});
 await ctx.tx.update(mediaStorageTransferCalls).set({state:"stopped",stoppedAt:now,stopReceiptId:id,updatedAt:now}).where(eq(mediaStorageTransferCalls.id,original.call.id));
 if(original.call.physicalReceiptId){
  await ctx.tx.update(mediaObjectWrites).set({state:absent?(original.call.observedAcceptedAt?"accepted":"confirmed_absent"):"accepted",...(absent?{deletedAt:now}:{}),reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(mediaObjectWrites.id,original.call.physicalReceiptId));
 }
 if(absent&&original.call.kind==="target_put"){
  await releaseTransferQuota(ctx.tx,original.plan.targetNamespace,original.key);
  await ctx.tx.update(mediaStorageTransferObjects).set({state:input.retryOriginal?"planned":"blocked",updatedAt:now}).where(eq(mediaStorageTransferObjects.id,original.object.id));
  await ctx.tx.update(mediaStorageTransferPlans).set({state:input.retryOriginal?"copying":"blocked",updatedAt:now}).where(eq(mediaStorageTransferPlans.id,original.plan.id));
 }
 ctx.setSubject("media_storage_transfer",original.plan.id);return{ok:true as const,reviewId:id};
}});
export const reviewStorageTransferCall=defineOrchestratedService({name:"media.reviewStorageTransferCall",summary:"Review an exact original caller using actual stopped/returned proof and fresh provider bytes.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,writeClass:"destructive",input:inputSchema,output:z.object({ok:z.literal(true),reviewId:z.uuid()}),auditInputFields:["callId","outcome","retryOriginal"],handler:async(input,actor)=>{
 human(actor);const original=await capture.call(input,actor),{source,target}=await configuredTransferStores(),store=original.target?target:source;
 if(store.binding.namespace!==original.call.namespace)transferConflict("Restore the exact original provider resource before reviewing this caller.");
 const token=randomUUID()+randomUUID(),runtimeIdentity=await transferRuntimeIdentity(),read=await admitRead.call({...input,token,runtimeIdentity},actor);let accepted=false;
 try{const result=await withTransferRequestScope({callId:read.id,token,runtimeIdentity},()=>store.readVersioned(original.key,original.targetWrite?.receipt.providerRevision??original.call.expectedRevision??undefined));accepted=Boolean(result);await retainTransferReturn(read.id,token,result?{accepted:true,revision:result.revision,...(result.requestProof?{requestProof:result.requestProof}:{}),sha256:createHash("sha256").update(result.body).digest("hex"),bytes:result.body.byteLength}:{absent:true});if(result)verifiedTransferBytes(result.body,original.object);if(result&&original.targetWrite)requireOriginalProviderRequestResult(original.targetWrite.write,{key:original.key,namespace:store.binding.namespace,revision:result.revision,sha256:createHash("sha256").update(result.body).digest("hex"),bytes:result.body.byteLength,requestProof:result.requestProof});}
 catch(error){await retainTransferFailure(read.id,token,accepted).catch(()=>{});throw error;}
 if(input.originalSourceKey){
  if(objectKeyDigest(input.originalSourceKey)!==original.object.keyDigest)transferConflict("Restore the exact original source key.");
  const sourceToken=randomUUID()+randomUUID(),sourceRead=await admitRead.call({...input,token:sourceToken,runtimeIdentity,resource:"original_source"},actor);let sourceAccepted=false;
  try{const originalSource=await withTransferRequestScope({callId:sourceRead.id,token:sourceToken,runtimeIdentity},()=>source.readVersioned(input.originalSourceKey!,original.object.sourceRevision??undefined));sourceAccepted=Boolean(originalSource);await retainTransferReturn(sourceRead.id,sourceToken,originalSource?{accepted:true,revision:originalSource.revision,...(originalSource.requestProof?{requestProof:originalSource.requestProof}:{}),sha256:createHash("sha256").update(originalSource.body).digest("hex"),bytes:originalSource.body.byteLength}:{absent:true});if(originalSource)verifiedTransferBytes(originalSource.body,original.object);}
  catch(error){await retainTransferFailure(sourceRead.id,sourceToken,sourceAccepted).catch(()=>{});throw error;}
 }
 const inventoryId=original.targetWrite?await collectTargetPutRecoveryInventory({receiptId:original.targetWrite.receipt.id,callId:original.call.id,proofCallId:read.id,expectedWitness:original.targetWrite.witness,stopDrainId:original.stopDrainId??undefined},store,actor):undefined;
 const result=await apply.call({...input,readCallId:read.id,inventoryId},actor);
 if(original.call.physicalReceiptId)await reconcileMediaErasureCohorts({objectReceiptId:original.call.physicalReceiptId}).catch(()=>{});
 return result;
}});
export const listStorageTransferRecovery=defineMediaService({name:"media.listStorageTransferRecovery",summary:"Inspect exact unresolved original transfer callers for fresh human recovery.",kind:"query",permission:"scoped",agentCallable:false,input:z.object({id:z.uuid()}),output:z.object({rows:z.array(z.object({id:z.uuid(),kind:z.string(),namespace:z.string(),key:z.string(),witness:z.string(),returned:z.boolean(),needsStop:z.boolean(),acknowledged:z.boolean()}))}),handler:async(input,ctx)=>{
 human(ctx.actor);const{objects}=await lockedTransfer(ctx.tx,input.id),calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(and(inArray(mediaStorageTransferCalls.objectId,objects.map(row=>row.id)),inArray(mediaStorageTransferCalls.state,["admitted","unknown"]))).orderBy(asc(mediaStorageTransferCalls.createdAt),asc(mediaStorageTransferCalls.id)).limit(101);
 if(calls.length>100)transferConflict("The original recovery inventory exceeds this bounded review.");
 const actual=calls.length?await ctx.tx.select({callId:physicalRequests.callId,returnedAt:physicalRequests.returnedAt}).from(physicalRequests).where(inArray(physicalRequests.callId,calls.map(row=>row.id))).limit(10001):[];if(actual.length>10000)transferConflict("The complete original physical caller inventory exceeds this bounded review; no subset can assert finish.");
 const targetIds=calls.flatMap(row=>row.kind==="target_put"&&row.physicalReceiptId?[row.physicalReceiptId]:[]),writers=targetIds.length?await ctx.tx.select({id:mediaObjectWrites.id,writerFinishedAt:mediaObjectWrites.writerFinishedAt}).from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,targetIds)):[];
 return{rows:calls.map(call=>({id:call.id,kind:call.kind,namespace:call.namespace,key:call.physicalKey,witness:transferDigest(call),returned:call.returnedAt!==null,needsStop:!call.returnedAt||call.kind==="target_put"&&(actual.some(row=>row.callId===call.id&&!row.returnedAt)||!writers.find(row=>row.id===call.physicalReceiptId)?.writerFinishedAt),acknowledged:call.observedAcceptedAt!==null}))};
}});
export default [reviewStorageTransferCall,listStorageTransferRecovery,capture,admitRead,apply,...targetInventoryServices];
