// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C1.08/C11.08: reservation erasure never outruns original provider work.
import {randomUUID} from "node:crypto";
import {and,asc,eq,inArray,isNull,or,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {lockContactIdentity} from "@/core/contacts/identity-lock";
import {enqueueJob} from "@/core/jobs";
import {completeErasureJob,registerContactPrivacySource} from "@/core/privacy/service";
import {dataRequestArtifacts,dataRequests} from "@/core/privacy/schema";
import type {Tx} from "@/core/service";
import {mediaObjects,mediaUploads,mediaCaptureChunks,mediaCaptureItems,mediaCaptureSessions} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {allowMediaReceiptWrites,deleteWithReceipt,MEDIA_WRITES_SCOPE,objectKeyDigest,storageOperationsHeld} from "./write-ledger";
import {minimizeMediaStorageOperations} from "./write-privacy";
import {retireKnownMultipart} from "./multipart-operations";
import {captureMediaErasureCohort,objectCohortIds,mediaCohortPending} from "./erasure-cohorts";

export const MULTIPART_PRIVACY_SCOPE="media.multipartOperations";
export const MULTIPART_ERASURE_JOB="core.eraseMediaMultipartOperations";
const payload=z.object({requestId:z.uuid(),originalJobId:z.uuid(),resourceIds:z.array(z.uuid()).max(500),uploadIds:z.array(z.uuid()).max(500),keyDigests:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(500)});
const receipt=z.object({format:z.literal("freeholder.erasure-receipt"),outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),pendingJobs:z.array(z.uuid()).optional()}))});
async function retireOwnedCapturePointers(tx:Tx,keys:string[],knownActors:Set<string>):Promise<void>{
 const owned=keys.filter(key=>key.startsWith("capture/"));if(!owned.length)return;
 await tx.delete(mediaCaptureChunks).where(inArray(mediaCaptureChunks.storageKey,owned));
 await tx.delete(mediaCaptureItems).where(and(inArray(mediaCaptureItems.stagedKey,owned),isNull(mediaCaptureItems.assetId)));
 await tx.update(mediaCaptureSessions).set({stagedKey:null,stagedBytes:null,stagedMime:null,stagedFilename:null,caption:null,updatedAt:new Date()}).where(and(inArray(mediaCaptureSessions.stagedKey,owned),isNull(mediaCaptureSessions.assetId)));
 const ids=[...new Set(owned.flatMap(key=>{const id=key.split("/")[1];return z.uuid().safeParse(id).success?[id!]:[];}))];
 for(const id of ids){
  const chunks=await tx.select({id:mediaCaptureChunks.id}).from(mediaCaptureChunks).where(eq(mediaCaptureChunks.sessionId,id)).limit(1),items=await tx.select({id:mediaCaptureItems.id}).from(mediaCaptureItems).where(eq(mediaCaptureItems.sessionId,id)).limit(1);
  if(!chunks.length&&!items.length){
   const [session]=await tx.select().from(mediaCaptureSessions).where(eq(mediaCaptureSessions.id,id)).limit(1);
   const own=session&&knownActors.has(session.createdBy);
   await tx.update(mediaCaptureSessions).set({status:"discarded",token:null,...(own?{createdBy:"erased",targetType:null,targetId:null,caption:null,displaySurface:null,permissionGrantedAt:null}:{}),completedAt:new Date(),updatedAt:new Date()}).where(and(eq(mediaCaptureSessions.id,id),isNull(mediaCaptureSessions.assetId),isNull(mediaCaptureSessions.stagedKey)));
  }
 }
}

async function minimizeOwned(tx:Tx,contactId:string):Promise<void>{
 await allowMediaReceiptWrites(tx);
 if(await storageOperationsHeld(tx,[contactId]))return;
 const resources=await tx.select().from(mediaMultipartResources).where(and(eq(mediaMultipartResources.contactId,contactId),isNull(mediaMultipartResources.redactedAt))).orderBy(asc(mediaMultipartResources.id)).for("update");
 for(const resource of resources){
  if(!resource.retiredAt||!["completed","aborted"].includes(resource.state))continue;
  const unknown=await tx.select({id:mediaMultipartOperations.id}).from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),inArray(mediaMultipartOperations.state,["started","unknown"]))).limit(1);
  if(unknown.length)continue;
  const writes=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,resource.keyDigest));
  if(writes.some(row=>!row.deletedAt||["unverified","started","unknown"].includes(row.state)))continue;
  await minimizeMediaStorageOperations(tx,writes.map(row=>row.id));
  await tx.update(mediaMultipartResources).set({key:`retained:${resource.keyDigest}`,actor:"erased",contactId:null,storageLocation:{},reviewedBy:null,redactedAt:new Date(),updatedAt:new Date()}).where(eq(mediaMultipartResources.id,resource.id));
  await tx.update(mediaMultipartOperations).set({actor:"erased",parts:[],reviewedBy:null,updatedAt:new Date()}).where(eq(mediaMultipartOperations.resourceId,resource.id));
 }
 const objects=await tx.select().from(mediaObjects).where(eq(mediaObjects.ownerContactId,contactId)).orderBy(asc(mediaObjects.key)).for("update");
 for(const object of objects){
  const digest=objectKeyDigest(object.key),writes=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,digest));
  const active=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(and(eq(mediaMultipartResources.keyDigest,digest),isNull(mediaMultipartResources.retiredAt))).limit(1);
  if(active.length||object.state==="attached"||writes.some(row=>!row.deletedAt||["unverified","started","unknown"].includes(row.state)))continue;
  await minimizeMediaStorageOperations(tx,writes.map(row=>row.id));
  // No physical writer was admitted for an unwritten reservation. Removing
  // it is a permanent admission refusal for a request still scanning bytes.
  await tx.delete(mediaObjects).where(eq(mediaObjects.key,object.key));
 }
 const uploads=await tx.select().from(mediaUploads).where(eq(mediaUploads.ownerContactId,contactId)).orderBy(asc(mediaUploads.id)).for("update");
 for(const upload of uploads){
  const writes=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,objectKeyDigest(upload.storageKey)));
  const multipart=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(and(eq(mediaMultipartResources.uploadId,upload.id),isNull(mediaMultipartResources.redactedAt))).limit(1);
  if(multipart.length||writes.some(row=>!row.deletedAt||["unverified","started","unknown"].includes(row.state)))continue;
  await minimizeMediaStorageOperations(tx,writes.map(row=>row.id));
  await tx.update(mediaUploads).set({filename:"[erased]",uploadedBy:"erased",ownerContactId:null,storageKey:`retained:${objectKeyDigest(upload.storageKey)}`,provenance:{},mediaMetadata:{},failureReason:null,state:upload.state==="complete"?"complete":"aborted",completedAt:upload.completedAt??new Date(),updatedAt:new Date()}).where(eq(mediaUploads.id,upload.id));
 }
}
async function personalRows(tx:Tx,contactId:string){
 const resources=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(and(eq(mediaMultipartResources.contactId,contactId),isNull(mediaMultipartResources.redactedAt))).orderBy(asc(mediaMultipartResources.id));
 const uploads=await tx.select({id:mediaUploads.id}).from(mediaUploads).where(eq(mediaUploads.ownerContactId,contactId)).orderBy(asc(mediaUploads.id));
 const objects=await tx.select({key:mediaObjects.key}).from(mediaObjects).where(eq(mediaObjects.ownerContactId,contactId)).orderBy(asc(mediaObjects.key));
 return{resourceIds:resources.map(row=>row.id),uploadIds:uploads.map(row=>row.id),keyDigests:objects.map(row=>objectKeyDigest(row.key))};
}
registerContactPrivacySource({
 scope:MULTIPART_PRIVACY_SCOPE,tables:["media_uploads","media_objects","media_multipart_resources","media_multipart_operations"],retentionScopes:[MEDIA_WRITES_SCOPE,"members"],eraseOrder:19,
 exportData:async(tx,contactId)=>({reservations:await tx.select().from(mediaUploads).where(eq(mediaUploads.ownerContactId,contactId)),objects:await tx.select().from(mediaObjects).where(eq(mediaObjects.ownerContactId,contactId)),resources:await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.contactId,contactId)),operations:await tx.select({operation:mediaMultipartOperations}).from(mediaMultipartOperations).innerJoin(mediaMultipartResources,eq(mediaMultipartResources.id,mediaMultipartOperations.resourceId)).where(eq(mediaMultipartResources.contactId,contactId))}),
 erase:async(tx,contactId,context)=>{
  const before=await personalRows(tx,contactId);if(!before.resourceIds.length&&!before.uploadIds.length&&!before.keyDigests.length)return{affected:0};
  const attached=await tx.select({id:mediaObjects.assetId}).from(mediaObjects).where(and(eq(mediaObjects.ownerContactId,contactId),sql`${mediaObjects.assetId} is not null`)).limit(1);
  if(attached.length){if(!context.service)throw new Error("Attached media erasure requires its real parent service context.");const{retireOwnedAssetsForErasure}=await import("./service");await context.service.callAsSystem(retireOwnedAssetsForErasure,{contactId,requestId:context.requestId});}
  const objects=await tx.select({key:mediaObjects.key,uploadId:mediaObjects.uploadId}).from(mediaObjects).where(eq(mediaObjects.ownerContactId,contactId));
  const physical=await tx.select({id:mediaObjectWrites.id,key:mediaObjectWrites.key,actor:mediaObjectWrites.actor}).from(mediaObjectWrites).where(or(eq(mediaObjectWrites.contactId,contactId),objects.length?inArray(mediaObjectWrites.keyDigest,objects.map(row=>objectKeyDigest(row.key))):undefined));
  await captureMediaErasureCohort(tx,context.requestId,MULTIPART_PRIVACY_SCOPE,physical.map(row=>row.id),before.resourceIds);
  // Raw capture claims reserve and write under one immutable caller identity.
  // A later executor of a logical media upload supplies no ownership proof.
  const rawKeys=new Set(objects.filter(row=>!row.uploadId&&row.key.startsWith("capture/")).map(row=>row.key));
  const knownActors=new Set(physical.filter(row=>rawKeys.has(row.key)&&/^user:[a-f0-9-]{36}$/i.test(row.actor)).map(row=>row.actor));
  await retireOwnedCapturePointers(tx,objects.map(row=>row.key),knownActors);
  await allowMediaReceiptWrites(tx);
  await tx.update(mediaUploads).set({state:"aborted",completedAt:new Date(),updatedAt:new Date()}).where(and(eq(mediaUploads.ownerContactId,contactId),inArray(mediaUploads.state,["created","uploading","uploaded","processing"])));
  await minimizeOwned(tx,contactId);
  const pending=await personalRows(tx,contactId),pendingJobs:string[]=[];
  const total=Math.max(pending.resourceIds.length,pending.uploadIds.length,pending.keyDigests.length);
  for(let offset=0;offset<total;offset+=500){const originalJobId=randomUUID(),job=await enqueueJob(tx,MULTIPART_ERASURE_JOB,{requestId:context.requestId,originalJobId,resourceIds:pending.resourceIds.slice(offset,offset+500),uploadIds:pending.uploadIds.slice(offset,offset+500),keyDigests:pending.keyDigests.slice(offset,offset+500)},{id:originalJobId,idempotencyKey:`multipart-erasure:${context.requestId}:${offset}`});pendingJobs.push(job.id);}
  return{affected:before.resourceIds.length+before.uploadIds.length+before.keyDigests.length,pendingJobs};
 },
});

export async function eraseMultipartOperations(data:Record<string,unknown>):Promise<{erased:number}>{
 const input=payload.parse(data);
 const captured=await db().transaction(async tx=>{
  await lockContactIdentity(tx);
  const[request]=await tx.select().from(dataRequests).where(eq(dataRequests.id,input.requestId)).limit(1),[artifact]=await tx.select({body:dataRequestArtifacts.body}).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,input.requestId)).limit(1);
  const original=receipt.safeParse(artifact?.body),outcome=original.success?original.data.outcomes.find(row=>row.scope===MULTIPART_PRIVACY_SCOPE):null;
  if(!request||!original.success||!outcome)throw new Error("The original upload erasure receipt is missing. Restore its exact backup.");
  if(outcome.outcome!=="pending"||!outcome.pendingJobs?.includes(input.originalJobId))return null;
  const resources=input.resourceIds.length?await tx.select().from(mediaMultipartResources).where(inArray(mediaMultipartResources.id,input.resourceIds)):[];
  if(resources.length!==input.resourceIds.length)throw new Error("An original multipart resource is missing; restore its exact receipt before acknowledging erasure.");
  const uploads=input.uploadIds.length?await tx.select().from(mediaUploads).where(inArray(mediaUploads.id,input.uploadIds)):[];
  const objects=await tx.select().from(mediaObjects).where(or(eq(mediaObjects.ownerContactId,request.contactId),input.uploadIds.length?inArray(mediaObjects.uploadId,input.uploadIds):undefined));
  const keys=[...new Set([...resources.filter(row=>!row.redactedAt).map(row=>row.key),...uploads.filter(row=>row.ownerContactId).map(row=>row.storageKey),...objects.filter(row=>input.keyDigests.includes(objectKeyDigest(row.key))).map(row=>row.key)])];
  return{contactId:request.contactId,keys,resources};
 });
 if(!captured)return{erased:0};
 // Unknown multipart calls are never replayed merely to satisfy an erasure.
 // Human recovery first establishes their exact original physical outcome.
 for(const resource of captured.resources)if(!resource.retiredAt&&resource.state==="open")await retireKnownMultipart(resource.uploadId);
 for(const key of captured.keys)await deleteWithReceipt(key);
 const pending=await db().transaction(async tx=>{await lockContactIdentity(tx);await minimizeOwned(tx,captured.contactId);const cohortIds=await objectCohortIds(tx,input.requestId,MULTIPART_PRIVACY_SCOPE);await minimizeMediaStorageOperations(tx,cohortIds);const rows=await personalRows(tx,captured.contactId);return rows.resourceIds.length+rows.uploadIds.length+rows.keyDigests.length+Number(await mediaCohortPending(tx,input.requestId,MULTIPART_PRIVACY_SCOPE));});
 if(pending)throw new Error("Original upload ownership, a named hold or unresolved provider work keeps this erasure pending.");
 await completeErasureJob.call({requestId:input.requestId,scope:MULTIPART_PRIVACY_SCOPE,jobId:input.originalJobId},{kind:"system"});
 return{erased:captured.keys.length};
}
