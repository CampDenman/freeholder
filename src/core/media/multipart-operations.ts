// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {admitOriginalMediaCaller,admitOriginalMultipartCaller,originalMultipartCaller,retainOriginalMediaCallerReturn,withOriginalMultipartInvocation} from "./provider-callers";
import {observeTransferRequest,withTransferRequestScope,TransferRequestNotAttemptedError} from "./transfer-requests";
import {assertPhysicalStorageAbsence} from "./physical-absence";
import {requireDurableMediaRetirementProof} from "./retirement-authority";
// C1.12/C11.08: commit original intent, call its provider, then record facts.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray,isNull,sql} from "drizzle-orm";
import {boundStorage} from "@/adapters/storage";
import type {StorageTransferRevision} from "./transfer-schema";
import type {MultipartPart,StorageBinding} from "@/adapters/storage/types";
import {db} from "@/core/db";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {actorString,ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {mediaObjects,mediaUploads} from "./schema";
import {actualStorageCallerRuntimeIdentity,mediaWriterRuntimeId} from "./physical-caller-runtime";
import {transferDigest} from "./transfer-proof";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {allowMediaReceiptWrites,lockObjectDigest,objectKeyDigest,storageOperationsHeld} from "./write-ledger";
import {captureMediaErasureCohort,originalMediaErasureRequests} from "./erasure-cohorts";
import {assertOriginalUploadWritable} from "./upload-ownership";
import {newMultipartCreateBaseline} from "./multipart-create-baseline-proof";
import {captureMultipartCreateBaseline} from "./multipart-create-baseline";
import {configuredOriginalRequestStore} from "./transfer-storage";
import {requireOriginalMultipartCompletedBody,type OriginalMultipartCreateProof} from "./multipart-completed-proof";
import {mediaStorageTransferCalls} from "./transfer-schema";
import {originalMultipartCompleteManifest} from "./multipart-complete-manifest";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";

type Resource=typeof mediaMultipartResources.$inferSelect;
type Upload=typeof mediaUploads.$inferSelect;
export type BoundMultipart=Awaited<ReturnType<typeof boundStorage>>&{resource:Resource};
const uncertain=["started","unknown"]as const;
const partsHash=(parts:MultipartPart[])=>createHash("sha256").update(JSON.stringify(parts)).digest("hex");
function conflict(message="This original multipart operation needs recovery before another physical call."):never{throw new ServiceError("conflict",message);}

/** Caller has already authorized this logical reservation in the same TX. */
export async function reserveMultipart(ctx:ServiceContext,upload:Upload,binding:StorageBinding):Promise<string>{
 await lockContactIdentityForRead(ctx.tx);await lockObjectDigest(ctx.tx,objectKeyDigest(upload.storageKey));await allowMediaReceiptWrites(ctx.tx);
 await assertOriginalUploadWritable(ctx.tx,upload.ownerContactId,upload.uploadedBy);
 const[pointer]=await ctx.tx.select().from(mediaObjects).where(eq(mediaObjects.key,upload.storageKey)).limit(1).for("update");
 if(!pointer?.reservationId||pointer.uploadId!==upload.id)conflict("The exact new multipart reservation has no original birth witness.");
 const[resource]=await ctx.tx.insert(mediaMultipartResources).values({originalReservationId:pointer.reservationId,uploadId:upload.id,key:upload.storageKey,keyDigest:objectKeyDigest(upload.storageKey),namespace:binding.namespace,storageKind:binding.kind,storageLocation:{...binding.location},contentType:upload.declaredMime,expectedBytes:upload.expectedBytes,actor:actorString(ctx.actor),contactId:upload.ownerContactId,state:"creating"}).returning();
 const[operation]=await ctx.tx.insert(mediaMultipartOperations).values({resourceId:resource!.id,kind:"create",state:"started",writerRuntimeId:mediaWriterRuntimeId,actor:actorString(ctx.actor)}).returning();
 const caller=await admitOriginalMultipartCaller(ctx.tx,operation!.id,"multipart_create",ctx.actor);
 await ctx.tx.update(mediaMultipartOperations).set({createBaseline:newMultipartCreateBaseline({callId:caller.id,namespace:binding.namespace,keyDigest:resource!.keyDigest})}).where(eq(mediaMultipartOperations.id,operation!.id));
 return operation!.id;
}

export async function multipartResource(uploadId:string):Promise<Resource>{
 const[resource]=await db().select().from(mediaMultipartResources).where(eq(mediaMultipartResources.uploadId,uploadId)).limit(1);
 if(!resource)conflict("The original multipart resource is unavailable. Restore its exact receipt.");
 return resource;
}
export async function originalMultipart(uploadId:string):Promise<BoundMultipart>{
 const resource=await multipartResource(uploadId),captured=await boundStorage();
 if(!resource.namespace||resource.namespace!==captured.binding.namespace||!captured.store.directMultipart)conflict("Restore this multipart upload's exact original private storage resource.");
 if(resource.redactedAt){
  const restored=await db().select({key:mediaObjects.key}).from(mediaObjects).where(eq(mediaObjects.uploadId,uploadId));
  const original=restored.find(row=>objectKeyDigest(row.key)===resource.keyDigest);
  if(!original)conflict("Restore the original object key from verified provider evidence before cleaning up this minimized resource.");
  return{...captured,resource:{...resource,key:original.key}};
 }
 return{...captured,resource};
}
/** A fresh read has its own caller. It cannot resume the original CREATE or
 * make a completed session's absent response stand in for object lineage. */
async function inspectOriginalMultipart(captured:BoundMultipart,operationId:string){
 if(!captured.store.directMultipart?.inspect||!captured.resource.providerUploadId)conflict("The exact original session cannot be inspected.");
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity();
 const caller=await db().transaction(async tx=>{await lockContactIdentityForRead(tx);return admitOriginalMediaCaller(tx,{kind:"multipart_recovery_inspect",multipartOperationId:operationId,token,runtimeIdentity},{kind:"system"});});
 try{
  const result=await withTransferRequestScope({callId:caller.id,token,runtimeIdentity},()=>captured.store.directMultipart!.inspect!(captured.resource.key,captured.resource.providerUploadId!,{request:observeTransferRequest}));
  if(!(await retainOriginalMediaCallerReturn(caller.id,token,{inspectionDigest:transferDigest(result)})).settled)conflict();
  return result;
 }catch(error){await retainOriginalMediaCallerReturn(caller.id,token,{failed:true}).catch(()=>{});throw error;}
}
export async function originalMultipartParts(uploadId:string):Promise<MultipartPart[]>{
 const captured=await originalMultipart(uploadId);
 const operations=await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.resourceId,captured.resource.id)).orderBy(asc(mediaMultipartOperations.createdAt),asc(mediaMultipartOperations.id));
 const original=operations.filter(row=>row.state!=="not_applied").at(-1);if(!original)conflict();
 const inspection=await inspectOriginalMultipart(captured,original.id);
 if(inspection.state==="open")return inspection.parts;
 conflict("The exact original session is absent. Current object existence cannot prove this original completion; retain its caller and request receipts for recovery.");
}

async function lockedOperation(tx:Tx,id:string,allowMinimized=false){
 const[identity]=await tx.select({digest:mediaMultipartResources.keyDigest}).from(mediaMultipartOperations).innerJoin(mediaMultipartResources,eq(mediaMultipartResources.id,mediaMultipartOperations.resourceId)).where(eq(mediaMultipartOperations.id,id)).limit(1);
 if(!identity)conflict("The original multipart call receipt is missing.");
 await lockObjectDigest(tx,identity.digest);await allowMediaReceiptWrites(tx);
 const[operation]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,id)).limit(1).for("update");
 const[resource]=await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.id,operation!.resourceId)).limit(1).for("update");
 if(!operation||!resource||(resource.redactedAt&&!allowMinimized))conflict();
 return{operation,resource};
}
async function notAttempted(id:string):Promise<void>{
 await db().transaction(async tx=>{
  await lockContactIdentityForRead(tx);const{operation,resource}=await lockedOperation(tx,id),now=new Date();
  if(operation.state!=="started"||operation.providerAcceptedAt)return;
  await tx.update(mediaMultipartOperations).set({state:"not_applied",verifiedAt:now,updatedAt:now}).where(eq(mediaMultipartOperations.id,id));
  await tx.update(mediaMultipartResources).set({state:operation.kind==="create"?"aborted":"open",...(operation.kind==="create"?{retiredAt:now}:{}),updatedAt:now}).where(eq(mediaMultipartResources.id,resource.id));
  await tx.update(mediaUploads).set({state:operation.kind==="complete"?"uploading":"aborted",updatedAt:now}).where(eq(mediaUploads.id,resource.uploadId));
  if(operation.kind==="create")await tx.delete(mediaObjects).where(and(eq(mediaObjects.key,resource.key),eq(mediaObjects.state,"pending")));
 });
}
/** A later rejection cannot erase an earlier positive provider fact. */
export async function observeMultipart(id:string,options:{accepted?:boolean;uploadId?:string;verified?:boolean;unknown?:boolean;finished?:boolean;originalKey?:string}):Promise<void>{
 await db().transaction(async tx=>{
  await lockContactIdentityForRead(tx);const{operation,resource}=await lockedOperation(tx,id,Boolean(options.accepted)),now=new Date();
  if(resource.redactedAt&&operation.providerAcceptedAt&&operation.state==="accepted"&&resource.retiredAt&&options.accepted)return;
  if(options.uploadId&&resource.providerUploadId&&resource.providerUploadId!==options.uploadId)conflict("The provider named a different original multipart upload.");
  const late=Boolean(resource.redactedAt&&operation.createdAt<=resource.redactedAt&&options.accepted);
  const accepted=options.accepted||Boolean(operation.providerAcceptedAt)||operation.state==="accepted";
  await tx.update(mediaMultipartOperations).set({state:options.unknown||late?"unknown":accepted||options.verified?"accepted":"unknown",...(options.accepted&&!operation.providerAcceptedAt?{providerAcceptedAt:now}:{}),...(options.verified?{verifiedAt:now}:{}),...(options.finished&&operation.writerRuntimeId?{writerFinishedAt:operation.writerFinishedAt??now}:{}),...(options.uploadId?{observedProviderUploadId:options.uploadId}:{}),updatedAt:now}).where(eq(mediaMultipartOperations.id,id));
  const state=options.unknown||late?"unknown":operation.kind==="create"&&accepted?"open":operation.kind==="complete"&&accepted?"completing":operation.kind==="abort"&&accepted?"aborting":resource.state;
  await tx.update(mediaMultipartResources).set({state,...(late?{retiredAt:null}:{}),...(options.uploadId?{providerUploadId:options.uploadId}:{}),...(operation.kind==="abort"&&options.accepted?{abortAcknowledgedAt:resource.abortAcknowledgedAt??now}:{}),updatedAt:now}).where(eq(mediaMultipartResources.id,resource.id));
  if(late&&options.originalKey){if(objectKeyDigest(options.originalKey)!==resource.keyDigest)conflict("The late provider fact names a different original object key.");if(resource.originalReservationId)await tx.insert(mediaObjects).values({reservationId:resource.originalReservationId,key:options.originalKey,uploadId:resource.uploadId,role:"staged",state:"pending",contentType:resource.contentType,bytes:resource.expectedBytes}).onConflictDoNothing();}
  if(options.uploadId)await tx.update(mediaUploads).set({providerUploadId:options.uploadId,updatedAt:now}).where(eq(mediaUploads.id,resource.uploadId));
 });
 await(await import("./erasure-cohorts")).reconcileMediaErasureCohorts({multipartOperationId:id}).catch(()=>{});
}

export async function createOriginalMultipart(uploadId:string,operationId:string):Promise<void>{
 const caller=originalMultipartCaller(operationId);
 let captured:BoundMultipart;
 try{captured=await originalMultipart(uploadId);}catch(error){await retainOriginalMediaCallerReturn(caller.id,caller.token,{notAttempted:true});await notAttempted(operationId);throw error;}
 let acknowledged=false,observedId:string|undefined;
 try{
  await captureMultipartCreateBaseline(operationId,captured.binding);
  const result=await withTransferRequestScope({callId:caller.id,token:caller.token,runtimeIdentity:caller.runtimeIdentity},()=>captured.store.directMultipart!.create(captured.resource.key,captured.resource.contentType,{request:observeTransferRequest,onAccepted:async result=>{acknowledged=true;observedId=result?.uploadId;if(!observedId)conflict();await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:true,uploadId:observedId});}}));
  acknowledged=true;observedId=result.uploadId;
  if(!(await retainOriginalMediaCallerReturn(caller.id,caller.token,{accepted:true,providerUploadId:observedId})).settled)conflict();
  await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:true,uploadId:observedId,finished:true});
 }catch(error){await retainOriginalMediaCallerReturn(caller.id,caller.token,error instanceof TransferRequestNotAttemptedError?{notAttempted:true}:{failed:true}).catch(()=>{});await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:acknowledged,uploadId:observedId,unknown:true,finished:true}).catch(()=>{});throw error;}
}

/** Use the common contact → object → resource → upload lock ordering. */
export async function lockMultipartUpload(tx:Tx,uploadId:string,allowMinimized=false):Promise<{resource:Resource;upload:Upload}>{
 await lockContactIdentityForRead(tx);
 const[identity]=await tx.select({digest:mediaMultipartResources.keyDigest}).from(mediaMultipartResources).where(eq(mediaMultipartResources.uploadId,uploadId)).limit(1);
 if(!identity)conflict("This legacy multipart upload needs its original resource confirmed first.");
 await lockObjectDigest(tx,identity.digest);await allowMediaReceiptWrites(tx);
 const[resource]=await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.uploadId,uploadId)).limit(1).for("update");
 const[upload]=await tx.select().from(mediaUploads).where(eq(mediaUploads.id,uploadId)).limit(1).for("update");
 if(!resource||!upload||(resource.redactedAt&&!allowMinimized)||!resource.namespace||!resource.providerUploadId)conflict();
 return{resource,upload};
}
export async function claimMultipartComplete(ctx:ServiceContext,uploadId:string,parts:MultipartPart[]):Promise<{operationId:string;recoverOnly:boolean}>{
 const{resource,upload}=await lockMultipartUpload(ctx.tx,uploadId);await assertOriginalUploadWritable(ctx.tx,upload.ownerContactId,upload.uploadedBy);
 if(upload.expiresAt<=new Date())conflict("The original upload reservation expired before completion admission.");
 if(["aborted","expired","failed"].includes(upload.state)||["unverified","creating","aborting","aborted"].includes(resource.state))conflict();
 const operations=await ctx.tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.resourceId,resource.id)).orderBy(asc(mediaMultipartOperations.createdAt),asc(mediaMultipartOperations.id)).for("update");
 if(operations.some(row=>row.kind!=="complete"&&uncertain.includes(row.state as typeof uncertain[number])))conflict();
 const prior=operations.filter(row=>row.kind==="complete"&&row.state!=="not_applied").at(-1);
 if(prior){if(partsHash(prior.parts.map(({partNumber,etag})=>({partNumber,etag})))!==partsHash(parts.map(({partNumber,etag})=>({partNumber,etag}))))conflict("The original completion used a different exact part manifest.");return{operationId:prior.id,recoverOnly:true};}
 if(resource.state!=="open")conflict();
 const creation=operations.filter(row=>row.kind==="create");if(creation.length!==1||!creation[0]?.partBodies)conflict("Keep this original upload for review. Its original file declaration is unavailable.");
 const manifest=originalMultipartCompleteManifest(parts,creation[0].partBodies),digest=partsHash(manifest);
 const[ready]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_media_multipart_complete_intent_ready(${resource.id}::uuid) as ready`);if(ready?.ready!==true)conflict("Keep the original upload for review. Every upload-link attempt needs its exact original return evidence before completion.");
 const[operation]=await ctx.tx.insert(mediaMultipartOperations).values({resourceId:resource.id,kind:"complete",state:"started",writerRuntimeId:mediaWriterRuntimeId,providerUploadId:resource.providerUploadId,parts:manifest,partsDigest:digest,actor:actorString(ctx.actor)}).returning();
 await ctx.tx.update(mediaMultipartResources).set({state:"completing",updatedAt:new Date()}).where(eq(mediaMultipartResources.id,resource.id));
 await ctx.tx.update(mediaUploads).set({state:"processing",updatedAt:new Date()}).where(eq(mediaUploads.id,upload.id));
 await admitOriginalMultipartCaller(ctx.tx,operation!.id,"multipart_complete",ctx.actor);
 return{operationId:operation!.id,recoverOnly:false};
}
async function originalMultipartCreateProof(resource:Resource):Promise<OriginalMultipartCreateProof>{
 const creators=await db().select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),eq(mediaMultipartOperations.kind,"create"))).limit(2),creator=creators[0];
 const callers=creator?await db().select().from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.multipartOperationId,creator.id),eq(mediaStorageTransferCalls.kind,"multipart_create"))).limit(2):[],caller=callers[0];
 if(creators.length!==1||!creator?.createBaseline||creator.createBaseline.state!=="complete"||!creator.writerFinishedAt||creator.state!=="accepted"||callers.length!==1||!caller||caller.state!=="returned"||!caller.returnedAt||!caller.observedAcceptedAt||creator.createBaseline.callId!==caller.id)conflict("Keep the original upload for review. Its original session creation evidence is incomplete.");
 const physical=await db().select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,caller.id)),requests=physical.filter(row=>row.descriptor.kind==="multipart.create"),request=requests[0];
 if(requests.length!==1||!request||request.state!=="returned"||!request.returnedAt||request.descriptor.binding.namespace!==resource.namespace||request.descriptor.key!==resource.key)conflict();
 const facts=await db().select().from(mediaStorageTransferRequestObservations).where(eq(mediaStorageTransferRequestObservations.requestId,request.id));
 if(!resource.providerUploadId||!facts.some(row=>row.facts.stage==="response_body"&&row.facts.detailDigest)||!facts.some(row=>row.facts.stage==="session"&&row.facts.uploadId===resource.providerUploadId))conflict();
 return{...request,observedUploadId:resource.providerUploadId};
}
export async function completeOriginalMultipart(uploadId:string,operationId:string,recoverOnly:boolean):Promise<BoundMultipart>{
 let captured:BoundMultipart;
 try{captured=await originalMultipart(uploadId);}catch(error){if(!recoverOnly){const caller=originalMultipartCaller(operationId);await retainOriginalMediaCallerReturn(caller.id,caller.token,{notAttempted:true});await notAttempted(operationId);}throw error;}
 const[operation]=await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,operationId)).limit(1);
 if(!operation||operation.resourceId!==captured.resource.id||operation.kind!=="complete"||operation.providerUploadId!==captured.resource.providerUploadId)conflict();
 const caller=recoverOnly?null:originalMultipartCaller(operationId);
 let acknowledged=Boolean(operation.providerAcceptedAt);
 try{
  if(recoverOnly){
   requireDurableMediaRetirementProof();
   conflict("The earlier original completion needs exact caller/request recovery; it cannot be retried or adopted from a current-key HEAD.");
  }else{
   if(!caller)conflict();
   const creation=await originalMultipartCreateProof(captured.resource),store=await configuredOriginalRequestStore(captured.binding);
   if(!store.readDigestVersioned)conflict("Keep this upload for review. Its original storage cannot verify the complete stored file.");
   let revision:StorageTransferRevision|undefined;
   const actual=await withTransferRequestScope({callId:caller.id,token:caller.token,runtimeIdentity:caller.runtimeIdentity},async()=>{
    if(!captured.store.directMultipart?.inspect)conflict("The original provider cannot verify every declared upload part.");
    const inspection=await captured.store.directMultipart.inspect(captured.resource.key,operation.providerUploadId!,{request:observeTransferRequest,expectedParts:operation.parts});
    if(inspection.state!=="open")conflict("The original upload session is unavailable. Keep its receipts for recovery.");
    await captured.store.directMultipart.complete(captured.resource.key,operation.providerUploadId!,operation.parts,{request:observeTransferRequest,onAccepted:async result=>{acknowledged=true;revision=result?.revision;await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:true});}});
    if(!revision)conflict();
    const bytes=await store.readDigestVersioned!(captured.resource.key,revision,captured.resource.expectedBytes);if(!bytes)conflict("The original completed upload is unavailable. Keep its original receipt for review.");
    requireOriginalMultipartCompletedBody(creation,{...bytes,key:captured.resource.key,namespace:captured.binding.namespace},{uploadId:operation.providerUploadId!,namespace:captured.binding.namespace,key:captured.resource.key,revision,maxBytes:captured.resource.expectedBytes});
    return bytes;
   });
   if(!(await retainOriginalMediaCallerReturn(caller.id,caller.token,{accepted:true,providerUploadId:operation.providerUploadId!,revision:actual.revision,sha256:actual.sha256,bytes:actual.bytes,requestProof:actual.requestProof})).settled)conflict();
   acknowledged=true;await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:true,finished:true});
  }
  return captured;
 }catch(error){if(caller)await retainOriginalMediaCallerReturn(caller.id,caller.token,error instanceof TransferRequestNotAttemptedError?{notAttempted:true}:{failed:true}).catch(()=>{});await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:acknowledged,unknown:true,finished:true}).catch(()=>{});throw error;}
}

/** The COMPLETE intent already committed before I/O; this is its object fact. */
export async function adoptCompletedMultipart(uploadId:string,operationId:string,sha256:string|null,bytes:number,requireExpected=true):Promise<void>{
 await db().transaction(async tx=>{
  await lockContactIdentityForRead(tx);const{operation,resource}=await lockedOperation(tx,operationId);
  const[upload]=await tx.select().from(mediaUploads).where(eq(mediaUploads.id,uploadId)).limit(1).for("update");
  if(!upload||operation.kind!=="complete"||resource.uploadId!==uploadId||!Number.isSafeInteger(bytes)||bytes<0||(requireExpected&&bytes!==resource.expectedBytes))conflict();
  const[proof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_completed_result(${operation.id}::uuid) as proven`);
  const[actual]=await tx.select().from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.multipartOperationId,operation.id),eq(mediaStorageTransferCalls.kind,"multipart_complete"))).limit(1);
  if(proof?.proven!==true||!actual?.resultRevision||!actual.resultSha256||actual.resultBytes!==bytes||sha256!==null&&actual.resultSha256!==sha256)conflict("The original stored file changed during validation. Keep its exact upload receipt for review.");
  const actualSha256=actual.resultSha256;
  // Preserve an already-admitted physical fact even if its owner was erased
  // while the provider worked. This is no permission to publish or write more.
  const existing=resource.objectReceiptId?(await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,resource.objectReceiptId)).limit(1))[0]:null;
  if(existing&&(existing.deletedAt||existing.redactedAt||existing.sha256!==actualSha256||existing.bytes!==bytes||existing.namespace!==resource.namespace||existing.providerRevisionDigest!==transferDigest(actual.resultRevision)))conflict("The original completed object changed.");
  const id=existing?.id??randomUUID(),now=new Date();
  if(!existing)await tx.insert(mediaObjectWrites).values({id,originalReservationId:resource.originalReservationId,operation:"put",key:resource.key,keyDigest:resource.keyDigest,namespace:resource.namespace,storageKind:resource.storageKind,storageLocation:resource.storageLocation,sha256:actualSha256,bytes,contentType:resource.contentType,actor:operation.actor,contactId:resource.contactId,state:"accepted",observedAcceptedAt:operation.providerAcceptedAt,writerRuntimeId:operation.writerRuntimeId,writerFinishedAt:operation.writerFinishedAt,writerProtocol:"multipart-receipts-v1",providerRevision:actual.resultRevision,providerRevisionDigest:transferDigest(actual.resultRevision)});
  // This receipt is an actual descendant of the already captured original
  // session, never a new owner/current-key inference after erasure capture.
  for(const request of await originalMediaErasureRequests(tx,[],[resource.id]))await captureMediaErasureCohort(tx,request.requestId,request.scope as "media.storageOperations"|"media.multipartOperations",[id]);
  await tx.update(mediaMultipartOperations).set({state:"accepted",verifiedAt:now,updatedAt:now}).where(eq(mediaMultipartOperations.id,operation.id));
  // Complete object identity is not proof that issued/replayed/in-flight part
  // authorities were consumed. Only the separate genuine terminal protocol
  // may retire the session; its current pending state must remain truthful.
  await tx.update(mediaMultipartResources).set({state:"completed",completedAt:resource.completedAt??now,objectReceiptId:id,updatedAt:now}).where(eq(mediaMultipartResources.id,resource.id));
 });
}

export async function claimMultipartAbort(ctx:Pick<ServiceContext,"tx"|"actor">,uploadId:string,allowMinimized=false):Promise<{operationId:string;terminal:boolean}>{
 const{resource,upload}=await lockMultipartUpload(ctx.tx,uploadId,allowMinimized);
 if(upload.state==="complete")return{operationId:resource.id,terminal:true};
 if(["completing","completed","aborting"].includes(resource.state))conflict("Finish or recover the original active operation before aborting this upload.");
 if(await storageOperationsHeld(ctx.tx,[resource.contactId]))conflict("A named hold preserves this original multipart resource.");
 const outstanding=await ctx.tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),inArray(mediaMultipartOperations.state,uncertain))).limit(1);
 if(outstanding.length)conflict();
 requireDurableMediaRetirementProof();
 if(resource.state==="aborted"&&resource.retiredAt)return{operationId:resource.id,terminal:true};
 const[operation]=await ctx.tx.insert(mediaMultipartOperations).values({resourceId:resource.id,kind:"abort",state:"started",writerRuntimeId:mediaWriterRuntimeId,providerUploadId:resource.providerUploadId,actor:actorString(ctx.actor)}).returning();
 await ctx.tx.update(mediaMultipartResources).set({state:"aborting",updatedAt:new Date()}).where(eq(mediaMultipartResources.id,resource.id));
 await ctx.tx.update(mediaUploads).set({state:"aborted",completedAt:new Date(),updatedAt:new Date()}).where(eq(mediaUploads.id,uploadId));
 await admitOriginalMultipartCaller(ctx.tx,operation!.id,"multipart_abort",ctx.actor);
 return{operationId:operation!.id,terminal:false};
}
export async function abortOriginalMultipart(uploadId:string,operationId:string):Promise<void>{
 requireDurableMediaRetirementProof();
 const caller=originalMultipartCaller(operationId);
 let captured:BoundMultipart;
 try{captured=await originalMultipart(uploadId);}catch(error){await retainOriginalMediaCallerReturn(caller.id,caller.token,{notAttempted:true});await notAttempted(operationId);throw error;}
 let acknowledged=false;
 try{
  await withTransferRequestScope({callId:caller.id,token:caller.token,runtimeIdentity:caller.runtimeIdentity},()=>captured.store.directMultipart!.abort(captured.resource.key,captured.resource.providerUploadId!,{request:observeTransferRequest,onAccepted:async()=>{acknowledged=true;await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:true});}}));
  if(!(await retainOriginalMediaCallerReturn(caller.id,caller.token,{accepted:true,providerUploadId:captured.resource.providerUploadId!})).settled)conflict();
  acknowledged=true;await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:true,finished:true});
  if(!captured.store.directMultipart!.inspect)conflict("The original provider cannot verify multipart retirement.");
  const inspection=await captured.store.directMultipart!.inspect(captured.resource.key,captured.resource.providerUploadId!);
  if(inspection.state!=="absent")conflict("The original multipart resource remains open after its abort acknowledgement; keep this receipt for recovery.");
  // An ABORT acknowledgement says nothing about a separately completed object.
  await assertPhysicalStorageAbsence(captured.store,captured.resource.key);
  await db().transaction(async tx=>{
   await lockContactIdentityForRead(tx);const{resource,operation}=await lockedOperation(tx,operationId,true),now=new Date();
   if(operation.kind!=="abort"||resource.uploadId!==uploadId)conflict();
   await tx.update(mediaMultipartOperations).set({state:"accepted",verifiedAt:now,updatedAt:now}).where(eq(mediaMultipartOperations.id,operation.id));
   await tx.update(mediaMultipartResources).set({state:"aborted",retiredAt:now,updatedAt:now}).where(eq(mediaMultipartResources.id,resource.id));
   const unsettled=await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(and(eq(mediaObjectWrites.keyDigest,resource.keyDigest),isNull(mediaObjectWrites.deletedAt))).limit(1);
   if(!unsettled.length)await tx.delete(mediaObjects).where(and(eq(mediaObjects.key,captured.resource.key),eq(mediaObjects.state,"pending")));
  });
 }catch(error){await retainOriginalMediaCallerReturn(caller.id,caller.token,error instanceof TransferRequestNotAttemptedError?{notAttempted:true}:{failed:true}).catch(()=>{});await observeMultipart(operationId,{originalKey:captured.resource.key,accepted:acknowledged,unknown:true,finished:true}).catch(()=>{});throw error;}
}
/** Existing expiry/erasure authority may retire a known, idle original upload. */
export async function retireKnownMultipart(uploadId:string):Promise<boolean>{
 return withOriginalMultipartInvocation(async()=>{try{
  const captured=await originalMultipart(uploadId);
  requireDurableMediaRetirementProof();
  if(captured.resource.retiredAt)return true;
  if(captured.resource.state!=="open")return false;
  const claim=await db().transaction(async tx=>claimMultipartAbort({tx,actor:{kind:"system"}},uploadId,Boolean(captured.resource.redactedAt)));
  if(claim.terminal)return true;
  await abortOriginalMultipart(uploadId,claim.operationId);return true;
 }catch{return false;}});
}
