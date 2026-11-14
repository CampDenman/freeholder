// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fresh human shared phases only. Provider I/O never occurs in a transaction;
// actual first ACK/FIN/results of the unknown original are never replaced.
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {actorString,type Actor} from "@/core/service";
import type {AccountedTransferStore,TransferInventoryPage} from "../../../scripts/media-transfer.mjs";
import {defineMediaService} from "./guarded-service";
import {confirmation,human,type MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import {captureAppliedMultipartContext} from "./multipart-applied-recovery-context";
import {captureAppliedMultipartInventory,lockedAppliedMultipartInventory,appliedMultipartInventoryProgress,appendAppliedMultipartInventoryPage,finishAppliedMultipartInventory,type MultipartRecoveryInventoryPage} from "./multipart-applied-recovery-inventory";
import {mediaStorageTransferCalls as calls,mediaStorageTransferReviews as reviews,type StorageTransferRevision} from "./transfer-schema";
import {mediaStorageTransferRequests as requests} from "./transfer-request-schema";
import {mediaMultipartOperations as operations,mediaMultipartResources as resources} from "./multipart-schema";
import {mediaUploads} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {admitOriginalMediaCaller,retainOriginalMediaCallerReturn,type OriginalMediaCallerReturn} from "./provider-callers";
import {actualStorageCallerRuntimeIdentity,currentStorageCallerRuntimeSchema} from "./physical-caller-runtime";
import {configuredOriginalRequestStore} from "./transfer-storage";
import {withTransferRequestScope} from "./transfer-requests";
import {transferConflict,transferDigest} from "./transfer-proof";
import {captureMediaErasureCohort,originalMediaErasureRequests,reconcileMediaErasureCohorts} from "./erasure-cohorts";
const digest=z.string().regex(/^[a-f0-9]{64}$/),bound=confirmation.extend({originalWitness:digest}),runtime={token:z.string().min(36),runtimeIdentity:currentStorageCallerRuntimeSchema};
const claim=defineMediaService({name:"media.captureOriginalMultipartCompleteRecovery",summary:"Capture an exact unknown tracked CREATE or COMPLETE without retrying its original request.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:confirmation,output:z.custom<Awaited<ReturnType<typeof captureAppliedMultipartContext>>>(),auditInputFields:["resourceId","operationId","action","stopDrainId"],handler:async(input,ctx)=>{human(ctx.actor);return captureAppliedMultipartContext(ctx.tx,input);}});
const admitRead=defineMediaService({name:"media.admitOriginalMultipartCompleteRead",summary:"Admit a fresh exact known-session inspection or original part-bound file read without restarting a writer.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:bound.extend({...runtime,metadataCallId:z.uuid().optional()}),output:z.object({id:z.uuid()}),auditInputFields:["resourceId","operationId","metadataCallId"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await captureAppliedMultipartContext(ctx.tx,input);if(original.witness!==input.originalWitness)transferConflict();
 let revision:StorageTransferRevision|undefined=original.expectedRevision;
 if(original.kind==="create"&&input.metadataCallId)transferConflict("Known CREATE recovery inspects only its actual originally acknowledged session.");
 if(input.metadataCallId){
  const[metadata]=await ctx.tx.select().from(calls).where(eq(calls.id,input.metadataCallId)).limit(1);
  if(!metadata||original.expectedRevision&&transferDigest(metadata.resultRevision)!==transferDigest(original.expectedRevision)||metadata.multipartOperationId!==original.operation.id||metadata.kind!=="multipart_recovery_inspect"||metadata.namespace!==original.binding.namespace||metadata.physicalKey!==original.key||metadata.state!=="returned"||!metadata.returnedAt||!metadata.resultRevision||metadata.resultAbsent||metadata.resultBytes!==original.resource.expectedBytes||metadata.resultRequestProof?.id!==original.creationProof.id||metadata.resultRequestProof.tokenDigest!==original.creationProof.tokenDigest)transferConflict("The actual fresh original metadata must name the exact CREATE nonce and expected file before its pinned read.");
  const physical=await ctx.tx.select().from(requests).where(eq(requests.callId,metadata.id));if(physical.length!==1||physical[0]?.descriptor.kind!=="object.metadata"||physical[0].state!=="returned"||!physical[0].returnedAt)transferConflict();revision=metadata.resultRevision;
 }
 return admitOriginalMediaCaller(ctx.tx,{kind:"multipart_recovery_inspect",multipartOperationId:original.operation.id,token:input.token,runtimeIdentity:input.runtimeIdentity,...(revision?{expectedRevision:revision}:{})},ctx.actor);
}});
const beginInventory=defineMediaService({name:"media.captureOriginalMultipartRecoveryInventory",summary:"Capture a first immutable multipart inventory after actual exact-session or complete original-byte proof.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:bound.extend({proofCallId:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof captureAppliedMultipartInventory>>>(),auditInputFields:["resourceId","operationId","proofCallId"],handler:async(input,ctx)=>{human(ctx.actor);return captureAppliedMultipartInventory(ctx.tx,input);}});
const progress=defineMediaService({name:"media.readOriginalMultipartRecoveryInventory",summary:"Read the exact unchanged original multipart provider page chain.",kind:"query",permission:"scoped",agentCallable:false,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:bound.extend({inventoryId:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof appliedMultipartInventoryProgress>>>(),handler:async(input,ctx)=>{human(ctx.actor);return appliedMultipartInventoryProgress(ctx.tx,input);}});
const admitPage=defineMediaService({name:"media.admitOriginalMultipartInventoryPage",summary:"Admit one actual original multipart configuration/page request without another writer.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:bound.extend({inventoryId:z.uuid(),...runtime}),output:z.object({id:z.uuid()}),auditInputFields:["resourceId","operationId","inventoryId"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await lockedAppliedMultipartInventory(ctx.tx,input);if(original.inventory.state!=="capturing")transferConflict();return admitOriginalMediaCaller(ctx.tx,{kind:"multipart_retirement_inventory",multipartOperationId:original.operation.id,token:input.token,runtimeIdentity:input.runtimeIdentity},ctx.actor);
}});
const appendPage=defineMediaService({name:"media.appendOriginalMultipartInventoryPage",summary:"Append an exact returned original multipart provider page and observed membership.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:z.custom<z.infer<typeof bound>&MultipartRecoveryInventoryPage>(),output:z.object({ok:z.literal(true)}),auditInputFields:["resourceId","operationId","inventoryId","callId","pass","kind"],handler:async(input,ctx)=>{human(ctx.actor);return appendAppliedMultipartInventoryPage(ctx.tx,input);}});
const finishInventory=defineMediaService({name:"media.finishOriginalMultipartRecoveryInventory",summary:"Verify both complete original provider passes without calling them remote authority consumption.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:bound.extend({inventoryId:z.uuid()}),output:z.object({id:z.uuid()}),auditInputFields:["resourceId","operationId","inventoryId"],handler:async(input,ctx)=>{human(ctx.actor);return{id:(await finishAppliedMultipartInventory(ctx.tx,input)).id};}});
const apply=defineMediaService({name:"media.applyOriginalMultipartCompleteReview",summary:"Append affirmative original session or object proof without inventing a missing original ACK or FIN.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileMultipartOperation",input:bound.extend({inventoryId:z.uuid()}),output:z.object({ok:z.literal(true),needsCleanup:z.literal(true)}),auditInputFields:["resourceId","operationId","inventoryId","stopDrainId"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await lockedAppliedMultipartInventory(ctx.tx,input);
 if(original.kind==="create"){
  const{resource,operation,caller,inventory,proof}=original;
  if(inventory.state!=="complete"||!inventory.completedAt)transferConflict("Retain both complete original known-session provider inventories before applied review.");
  const evidenceDigest=transferDigest({originalWitness:original.witness,inventoryId:inventory.id,readCallId:proof.id,stopDrainId:original.stop?.id??null,providerFinalReference:input.providerFinalReference,providerEvidence:input.providerEvidence,reviewedBy:actorString(ctx.actor)}),reviewId=randomUUID(),now=new Date();
  await ctx.tx.insert(reviews).values({id:reviewId,multipartOperationId:operation.id,inventoryId:inventory.id,callId:caller.id,originalCallWitness:transferDigest(caller),readCallId:proof.id,outcome:"applied",providerEvidenceDigest:evidenceDigest,stopDrainId:original.stop?.id,permitsRetry:false,reviewedBy:actorString(ctx.actor)});
  for(const request of original.physical)if(["admitted","unknown"].includes(request.state))await ctx.tx.update(requests).set({state:"stopped",stopReceiptId:reviewId}).where(eq(requests.id,request.id));
  await ctx.tx.update(calls).set({state:"stopped",stoppedAt:caller.stoppedAt??now,stopReceiptId:reviewId,updatedAt:now}).where(eq(calls.id,caller.id));
  await ctx.tx.update(operations).set({state:"accepted",verifiedAt:now,reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(operations.id,operation.id));
  await ctx.tx.update(resources).set({state:"open",reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(resources.id,resource.id));
  await ctx.tx.update(mediaUploads).set({state:"uploading",updatedAt:now}).where(eq(mediaUploads.id,resource.uploadId));
  ctx.setSubject("media_multipart_resource",resource.id);return{ok:true as const,needsCleanup:true as const};
 }
 const{resource,operation,caller,inventory,proof,actual}=original;
 if(inventory.state!=="complete"||!inventory.completedAt||input.sha256&&input.sha256!==actual.sha256||input.bytes!==undefined&&input.bytes!==actual.bytes||resource.objectReceiptId)transferConflict("Retain the unchanged complete original proof before recording an applied unknown COMPLETE.");
 const evidenceDigest=transferDigest({originalWitness:original.witness,inventoryId:inventory.id,readCallId:proof.id,stopDrainId:original.stop?.id??null,providerFinalReference:input.providerFinalReference,providerEvidence:input.providerEvidence,reviewedBy:actorString(ctx.actor)}),reviewId=randomUUID(),receiptId=randomUUID(),now=new Date();
 await ctx.tx.insert(reviews).values({id:reviewId,multipartOperationId:operation.id,inventoryId:inventory.id,callId:caller.id,originalCallWitness:transferDigest(caller),readCallId:proof.id,outcome:"applied",providerEvidenceDigest:evidenceDigest,stopDrainId:original.stop?.id,permitsRetry:false,reviewedBy:actorString(ctx.actor)});
 for(const request of original.physical)if(["admitted","unknown"].includes(request.state))await ctx.tx.update(requests).set({state:"stopped",stopReceiptId:reviewId}).where(eq(requests.id,request.id));
 await ctx.tx.update(calls).set({state:"stopped",stoppedAt:caller.stoppedAt??now,stopReceiptId:reviewId,updatedAt:now}).where(eq(calls.id,caller.id));
 await ctx.tx.update(operations).set({state:"accepted",verifiedAt:now,reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(operations.id,operation.id));
 // Writer identity/FIN/ACK remain the ORIGINAL values, including NULL. The
 // fresh read is evidence of bytes, not a replacement original write result.
 await ctx.tx.insert(mediaObjectWrites).values({id:receiptId,originalReservationId:resource.originalReservationId,operation:"put",key:original.key,keyDigest:resource.keyDigest,namespace:original.binding.namespace,storageKind:"s3",storageLocation:resource.storageLocation,sha256:actual.sha256,bytes:actual.bytes,contentType:resource.contentType,actor:operation.actor,contactId:resource.contactId,state:"accepted",writerRuntimeId:operation.writerRuntimeId,writerFinishedAt:operation.writerFinishedAt,observedAcceptedAt:operation.providerAcceptedAt,writerProtocol:"multipart-receipts-v1",providerRevision:actual.revision,providerRevisionDigest:transferDigest(actual.revision),reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest});
 for(const request of await originalMediaErasureRequests(ctx.tx,[],[resource.id]))await captureMediaErasureCohort(ctx.tx,request.requestId,request.scope as "media.storageOperations"|"media.multipartOperations",[receiptId]);
 await ctx.tx.update(resources).set({state:"completed",objectReceiptId:receiptId,completedAt:resource.completedAt??now,reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(resources.id,resource.id));
 ctx.setSubject("media_multipart_resource",resource.id);return{ok:true as const,needsCleanup:true as const};
}});
async function originalRead<T>(input:z.infer<typeof bound>,actor:Actor,work:(store:AccountedTransferStore)=>Promise<T>,result:(value:T)=>OriginalMediaCallerReturn,store:AccountedTransferStore,metadataCallId?:string){
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity(),read=await admitRead.call({...input,token,runtimeIdentity,metadataCallId},actor);
 try{const value=await withTransferRequestScope({callId:read.id,token,runtimeIdentity},()=>work(store));if(!(await retainOriginalMediaCallerReturn(read.id,token,result(value))).settled)transferConflict();return{id:read.id,value};}
 catch(error){await retainOriginalMediaCallerReturn(read.id,token,{failed:true}).catch(()=>{});throw error;}
 finally{await reconcileMediaErasureCohorts({multipartResourceId:input.resourceId}).catch(()=>{});}
}
async function pageRequest<T>(input:z.infer<typeof bound>&{inventoryId:string},actor:Actor,work:()=>Promise<T>,result:(value:T)=>OriginalMediaCallerReturn):Promise<{id:string;value:T}>{
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity(),call=await admitPage.call({...input,token,runtimeIdentity},actor);
 try{const value=await withTransferRequestScope({callId:call.id,token,runtimeIdentity},work);if(!(await retainOriginalMediaCallerReturn(call.id,token,result(value))).settled)transferConflict();return{id:call.id,value};}
 catch(error){await retainOriginalMediaCallerReturn(call.id,token,{failed:true}).catch(()=>{});throw error;}
 finally{await reconcileMediaErasureCohorts({multipartResourceId:input.resourceId}).catch(()=>{});}
}
async function collectInventory(input:z.infer<typeof bound>&{inventoryId:string},store:AccountedTransferStore,actor:Actor){
 let captured=await progress.call(input,actor);if(captured.inventory.state!=="capturing")transferConflict();
 for(const pass of [0,1]as const){
  const config=await pageRequest(input,actor,()=>store.inventoryConfiguration(),value=>({configurationDigest:transferDigest(value)}));await appendPage.call({...input,callId:config.id,pass,kind:"configuration",cursor:null,configuration:config.value},actor);
  for(const kind of ["objects","versions","sessions"]as const){let cursor:Record<string,string>|null=null;
   for(let count=0;;count++){if(count>=200)transferConflict("The complete original provider inventory exceeds its bounded recovery; no subset may be adopted.");const requestCursor:Record<string,string>|null=cursor;const actual:{id:string;value:TransferInventoryPage}=await pageRequest<TransferInventoryPage>(input,actor,():Promise<TransferInventoryPage>=>store.inventoryPage(kind,requestCursor),(value:TransferInventoryPage)=>({inventoryDigest:transferDigest(value),inventoryCount:value.entries.length}));await appendPage.call({...input,callId:actual.id,pass,kind,cursor:requestCursor,page:actual.value},actor);cursor=actual.value.next;if(cursor===null)break;}
  }
  captured=await progress.call(input,actor);if(captured.inventory.state!=="capturing")transferConflict();
 }
 await finishInventory.call(input,actor);
}
export async function recoverExactOriginalMultipartComplete(input:MultipartRecoveryConfirmation,actor:Actor){
 human(actor);const original=await claim.call(input,actor),boundInput={...input,originalWitness:original.witness},store=await configuredOriginalRequestStore(original.binding);
 if(original.kind==="complete"&&(!store.metadataVersioned||!store.readDigestVersioned)||original.kind==="create"&&!store.inspectMultipart)transferConflict("Restore the original private provider's exact known-session or complete part-bound read support before recovery.");
 try{
  if(original.kind==="create"){
   const inspected=await originalRead(boundInput,actor,s=>s.inspectMultipart!(original.key,original.resource.providerUploadId!),value=>({inspectionDigest:transferDigest(value)}),store);
   if(inspected.value.state!=="open"||inspected.value.parts.length)transferConflict("Keep the original known session for review. Absent, populated or foreign session evidence cannot reopen it.");
   const header=await beginInventory.call({...boundInput,proofCallId:inspected.id},actor);await collectInventory({...boundInput,inventoryId:header.id},store,actor);return apply.call({...boundInput,inventoryId:header.id},actor);
  }
  const metadata=await originalRead(boundInput,actor,s=>s.metadataVersioned!(original.key,original.expectedRevision),value=>value?{inspectionDigest:transferDigest(value),revision:value.revision,bytes:value.bytes,...(value.requestProof?{requestProof:value.requestProof}:{})}:{absent:true},store);
  if(!metadata.value)transferConflict("Current absence cannot prove the unknown original COMPLETE unapplied or its delegated links consumed.");
  const pinnedRevision=metadata.value.revision;
  const read=await originalRead(boundInput,actor,s=>s.readDigestVersioned!(original.key,pinnedRevision,original.resource.expectedBytes,original.operation.parts),value=>value?{revision:value.revision,sha256:value.sha256,bytes:value.bytes,...(value.requestProof?{requestProof:value.requestProof}:{})}:{absent:true},store,metadata.id);
  if(!read.value)transferConflict("The exact original version disappeared during recovery; retain all original receipts.");
  // This phase also independently validates the actual whole original body,
  // part certificate and CREATE nonce before admitting any inventory header.
  const header=await beginInventory.call({...boundInput,proofCallId:read.id},actor);await collectInventory({...boundInput,inventoryId:header.id},store,actor);return apply.call({...boundInput,inventoryId:header.id},actor);
 }finally{await reconcileMediaErasureCohorts({multipartResourceId:input.resourceId}).catch(()=>{});}
}
export default[claim,admitRead,beginInventory,progress,admitPage,appendPage,finishInventory,apply];
