// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {assertPhysicalStorageAbsence} from "./physical-absence";
import {requireDurableMediaRetirementProof} from "./retirement-authority";
// C1.12/C11.08: fresh human evidence resolves each original multipart outcome.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray,isNull,isNotNull,ne} from "drizzle-orm";
import {z} from "zod";
import {boundStorage} from "@/adapters/storage";
import {actorString,defineOrchestratedService,ServiceError} from "@/core/service";
import {defineMediaService as defineService} from "./guarded-service";
import {mediaUploads,mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartOperations,mediaMultipartResources,MULTIPART_STATES} from "./multipart-schema";
import {allowMediaReceiptWrites,deleteWithReceipt,storageOperationsHeld} from "./write-ledger";
import appliedRecoveryServices,{recoverExactOriginalMultipartComplete} from "./multipart-applied-recovery";
import {confirmation,capture,fingerprint,human} from "./multipart-recovery-context";
import {withOriginalMultipartInvocation} from "./provider-callers";
import {abortOriginalMultipart,claimMultipartAbort} from "./multipart-operations";
import {captureMediaErasureCohort,originalMediaErasureRequests,reconcileMediaErasureCohorts} from "./erasure-cohorts";

const digest=z.string().regex(/^[a-f0-9]{64}$/),date=z.date();
const resourceRow=z.object({id:z.uuid(),uploadId:z.uuid(),key:z.string(),namespace:digest.nullable(),providerUploadId:z.string().nullable(),state:z.enum(MULTIPART_STATES),expectedBytes:z.number(),contentType:z.string(),objectReceiptId:z.uuid().nullable(),retiredAt:date.nullable(),updatedAt:date});
const operationRow=z.object({id:z.uuid(),kind:z.enum(["create","complete","abort","sign"]),state:z.string(),providerAcceptedAt:date.nullable(),updatedAt:date});

const proof=z.object({state:z.enum(["open","absent","object"]),providerUploadId:z.string().nullable(),sha256:digest.optional(),bytes:z.number().int().nonnegative().optional()});

export const listMultipartOperations=defineService({
 name:"media.listMultipartOperations",summary:"Inspect original upload resources and unresolved multipart calls.",kind:"query",permission:"scoped",agentCallable:false,
 input:z.object({limit:z.number().int().min(1).max(100).default(25)}),output:z.object({rows:z.array(z.object({resource:resourceRow,operation:operationRow.nullable(),withheld:z.boolean(),witness:digest,sha256:digest.nullable(),bytes:z.number().nullable()}))}),
 handler:async(input,ctx)=>{
  human(ctx.actor);
  const resources=await ctx.tx.select().from(mediaMultipartResources).orderBy(asc(mediaMultipartResources.createdAt),asc(mediaMultipartResources.id)).limit(500);
  const rows=[];
  for(const resource of resources){
   const operations=await ctx.tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.resourceId,resource.id)).orderBy(asc(mediaMultipartOperations.createdAt),asc(mediaMultipartOperations.id));
   const uncertain=operations.filter(row=>["started","unknown"].includes(row.state)||row.kind==="sign"&&row.state==="accepted"&&!resource.retiredAt);
   const upload=(await ctx.tx.select({state:mediaUploads.state}).from(mediaUploads).where(eq(mediaUploads.id,resource.uploadId)).limit(1))[0];
   if(resource.redactedAt&&!uncertain.length&&resource.retiredAt)continue;
   if(!uncertain.length&&!['unverified','creating','completing','aborting','unknown'].includes(resource.state)&&!(upload&&upload.state!=="complete"&&(!resource.retiredAt||resource.objectReceiptId)))continue;
   const object=resource.objectReceiptId?(await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,resource.objectReceiptId)).limit(1))[0]:null;
   for(const operation of uncertain.length?uncertain:[null]){rows.push({resource,operation,withheld:operations.some(row=>row.state==="withheld"),witness:fingerprint(resource,operation),sha256:object?.sha256??null,bytes:object?.bytes??resource.expectedBytes});if(rows.length>=input.limit)return{rows};}
  }
  return{rows};
 },
});
const claimMultipartRecovery=defineService({
 name:"media.claimMultipartRecovery",summary:"Capture unchanged original upload evidence for human verification.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.reconcileMultipartOperation",agentCallable:false,stepUp:true,auditInputFields:["resourceId","action"],
 input:confirmation,output:z.object({resource:resourceRow,operation:operationRow.nullable()}),
 handler:async(input,ctx)=>{human(ctx.actor);const captured=await capture(ctx.tx,input);if(captured.operation?.kind==="sign")throw new ServiceError("conflict","Keep this upload for review. Its upload links require their original issuance and storage-consumption evidence; expiry or a browser response cannot complete recovery.");ctx.setSubject("media_multipart_resource",captured.resource.id);return captured;},
});
const applyMultipartRecovery=defineService({
 name:"media.applyMultipartRecovery",summary:"Record verified original multipart observations without rewriting intent.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.reconcileMultipartOperation",agentCallable:false,stepUp:true,auditInputFields:["resourceId","action"],
 input:confirmation.extend({proof,storageKind:z.enum(["s3","replit","local"]),storageLocation:z.record(z.string(),z.string())}),output:z.object({ok:z.literal(true),needsCleanup:z.boolean()}),
 handler:async(input,ctx)=>{
  human(ctx.actor);const{resource,operation,key}=await capture(ctx.tx,input);requireDurableMediaRetirementProof();await allowMediaReceiptWrites(ctx.tx);
  if(input.action!=="verify_original"&&!operation)throw new ServiceError("validation","Choose the exact original physical call before recording its outcome.");
  if(input.action==="verify_original"&&operation)throw new ServiceError("validation","Record this physical call's outcome explicitly.");
  if(input.action==="not_applied"&&input.proof.state==="object"){
   // One COMPLETE closes this original provider upload. A later refused peer
   // is a distinct physical call; the first call's object is not its ACK.
   const original=resource.objectReceiptId?(await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,resource.objectReceiptId)).limit(1))[0]:null;
   const independent=operation?.kind==="complete"?await ctx.tx.select({id:mediaMultipartOperations.id}).from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),ne(mediaMultipartOperations.id,operation.id),eq(mediaMultipartOperations.kind,"complete"),eq(mediaMultipartOperations.state,"accepted"),isNotNull(mediaMultipartOperations.providerAcceptedAt),isNotNull(mediaMultipartOperations.verifiedAt))).limit(1):[];
   if(!independent.length||!original||original.state!=="accepted"||original.deletedAt||original.namespace!==input.originalNamespace||original.sha256!==input.proof.sha256||original.bytes!==input.proof.bytes)throw new ServiceError("conflict","Current original-provider evidence does not establish that this operation was unapplied.");
  }
  if(input.action==="not_applied"&&operation?.kind==="create"&&input.proof.state!=="absent")throw new ServiceError("conflict","Current original-provider evidence does not establish that this operation was unapplied.");
  if(input.action==="applied"&&operation?.kind==="complete"&&input.proof.state!=="object")throw new ServiceError("conflict","The original completed object must be verified before recording completion.");
  const now=new Date(),evidenceDigest=createHash("sha256").update(JSON.stringify({...input,actor:actorString(ctx.actor)})).digest("hex");
  let objectReceiptId=resource.objectReceiptId;
  if(input.proof.state==="object"){
   if(!input.proof.sha256||input.proof.bytes===undefined)throw new ServiceError("conflict","The original object's verified bytes are missing.");
   const original=objectReceiptId?(await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,objectReceiptId)).limit(1))[0]:null;
   if(original&&(original.sha256!==input.proof.sha256||original.bytes!==input.proof.bytes||original.namespace!==input.originalNamespace))throw new ServiceError("conflict","The original accepted object has different bytes; do not replace its receipt.");
   if(!original||resource.redactedAt){const adoptedId=randomUUID();if(!original)objectReceiptId=adoptedId;await ctx.tx.insert(mediaObjectWrites).values({id:adoptedId,operation:"put",key,keyDigest:resource.keyDigest,namespace:input.originalNamespace,storageKind:input.storageKind,storageLocation:input.storageLocation,sha256:input.proof.sha256,bytes:input.proof.bytes,contentType:resource.contentType,actor:actorString(ctx.actor),contactId:resource.contactId,state:"accepted",reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest});
    for(const request of await originalMediaErasureRequests(ctx.tx,[],[resource.id]))await captureMediaErasureCohort(ctx.tx,request.requestId,request.scope as "media.storageOperations"|"media.multipartOperations",[adoptedId]);
   }
  }
  if(resource.redactedAt&&input.proof.state!=="absent")await ctx.tx.insert(mediaObjects).values({key,uploadId:resource.uploadId,role:"staged",state:"pending",bytes:input.proof.bytes??resource.expectedBytes,contentType:resource.contentType}).onConflictDoNothing();
  if(operation)await ctx.tx.update(mediaMultipartOperations).set({state:input.action==="not_applied"?"not_applied":"accepted",verifiedAt:now,reviewedAt:now,reviewedBy:resource.redactedAt?null:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(mediaMultipartOperations.id,operation.id));
  const outstanding=await ctx.tx.select({id:mediaMultipartOperations.id}).from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),inArray(mediaMultipartOperations.state,["started","unknown"]))).limit(1);
  const state=outstanding.length?"unknown":input.proof.state==="open"?"open":input.proof.state==="object"?"completed":"aborted";
  await ctx.tx.update(mediaMultipartResources).set({...(!resource.namespace?{namespace:input.originalNamespace,storageKind:input.storageKind,storageLocation:input.storageLocation}:{}),...(input.proof.providerUploadId?{providerUploadId:input.proof.providerUploadId}:{}),state,objectReceiptId,
   ...(!outstanding.length&&input.proof.state!=="open"?{retiredAt:resource.retiredAt??now}:{}),...(input.proof.state==="object"?{completedAt:resource.completedAt??now}:{}),reviewedAt:now,reviewedBy:resource.redactedAt?null:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(mediaMultipartResources.id,resource.id));
  if(input.proof.providerUploadId)await ctx.tx.update(mediaUploads).set({providerUploadId:input.proof.providerUploadId,updatedAt:now}).where(eq(mediaUploads.id,resource.uploadId));
  if(state==="aborted"){
   await ctx.tx.update(mediaUploads).set({state:"aborted",completedAt:now,updatedAt:now}).where(and(eq(mediaUploads.id,resource.uploadId),inArray(mediaUploads.state,["created","uploading","uploaded","processing"])));
   const remaining=await ctx.tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(and(eq(mediaObjectWrites.keyDigest,resource.keyDigest),isNull(mediaObjectWrites.deletedAt))).limit(1);
   const unresolved=await ctx.tx.select({id:mediaMultipartOperations.id}).from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),inArray(mediaMultipartOperations.state,["started","unknown"]))).limit(1);
   if(!remaining.length&&!unresolved.length)await ctx.tx.delete(mediaObjects).where(and(eq(mediaObjects.key,key),eq(mediaObjects.state,"pending")));
  }
  ctx.setSubject("media_multipart_resource",resource.id);return{ok:true as const,needsCleanup:state!=="aborted"||Boolean(objectReceiptId)};
 },
});
const claimMultipartCleanup=defineService({
 name:"media.claimMultipartCleanup",summary:"Authorize a new original multipart cleanup call after human recovery.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.reconcileMultipartOperation",agentCallable:false,stepUp:true,auditInputFields:["resourceId","action"],
 input:confirmation,output:z.object({operationId:z.uuid().nullable(),uploadId:z.uuid(),key:z.string()}),
 handler:async(input,ctx)=>{
  human(ctx.actor);const{resource,key}=await capture(ctx.tx,input);
  if(input.action!=="cleanup")throw new ServiceError("validation","Choose original-resource cleanup.");
  if(await storageOperationsHeld(ctx.tx,[resource.contactId]))throw new ServiceError("conflict","A named hold preserves this original upload.");
  const uncertain=await ctx.tx.select({id:mediaMultipartOperations.id}).from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),inArray(mediaMultipartOperations.state,["started","unknown"]))).limit(1);
  if(uncertain.length||!["open","completed","aborted"].includes(resource.state))throw new ServiceError("conflict","Resolve each original physical call before requesting cleanup.");
  const upload=(await ctx.tx.select().from(mediaUploads).where(eq(mediaUploads.id,resource.uploadId)).limit(1).for("update"))[0];
  if(upload?.state==="complete")throw new ServiceError("conflict","This upload is already published; use the asset's ordinary removal flow.");
  await allowMediaReceiptWrites(ctx.tx);
  const now=new Date(),evidenceDigest=createHash("sha256").update(JSON.stringify({...input,actor:actorString(ctx.actor)})).digest("hex");
  await ctx.tx.update(mediaMultipartResources).set({reviewedAt:now,reviewedBy:actorString(ctx.actor),evidenceDigest,updatedAt:now}).where(eq(mediaMultipartResources.id,resource.id));
  if(upload)await ctx.tx.update(mediaUploads).set({state:"aborted",completedAt:now,updatedAt:now}).where(eq(mediaUploads.id,upload.id));
  const claim=resource.state==="open"?await claimMultipartAbort(ctx,resource.uploadId,Boolean(resource.redactedAt)):null;
  ctx.setSubject("media_multipart_resource",resource.id);return{operationId:claim&&!claim.terminal?claim.operationId:null,uploadId:resource.uploadId,key};
 },
});
export const reconcileMultipartOperation=defineOrchestratedService({
 name:"media.reconcileMultipartOperation",summary:"Verify an original upload resource and record a fresh person's provider evidence.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,auditInputFields:["resourceId","action"],input:confirmation,output:z.object({ok:z.literal(true),needsCleanup:z.boolean()}),
 handler:async(input,actor)=>withOriginalMultipartInvocation(async()=>{
  const original=await claimMultipartRecovery.call(input,actor);
  if(input.action==="applied"&&["create","complete"].includes(original.operation?.kind??""))return recoverExactOriginalMultipartComplete(input,actor);
  requireDurableMediaRetirementProof();const captured=await boundStorage();
  const key=input.originalKey??original.resource.key;
  if(captured.binding.namespace!==input.originalNamespace||(original.resource.namespace&&original.resource.namespace!==captured.binding.namespace)||!captured.store.directMultipart?.inspect)throw new ServiceError("conflict","Restore the exact original private multipart resource before verification.");
  if(input.action==="cleanup"){
   const cleanup=await claimMultipartCleanup.call(input,actor);
   if(cleanup.operationId)await abortOriginalMultipart(cleanup.uploadId,cleanup.operationId);
   return{ok:true as const,needsCleanup:!await deleteWithReceipt(cleanup.key,captured)};
  }
  const multipart=captured.store.directMultipart;
  let providerUploadId=original.resource.providerUploadId??input.providerUploadId??null;
  if(!original.resource.providerUploadId){
   if(!multipart.listUploadsForKey)throw new ServiceError("conflict","This provider cannot establish the original multipart inventory.");
   const ids=await multipart.listUploadsForKey(key);
   if(ids.length>1||(providerUploadId&&ids.length===1&&ids[0]!==providerUploadId))throw new ServiceError("conflict","The exact original key has an ambiguous multipart inventory; retain all resources for review.");
   // An arbitrary ID returning NoSuchUpload cannot become immutable identity.
   // A complete empty inventory establishes current absence without guessing
   // the ID whose CREATE acknowledgement was lost.
   providerUploadId=ids[0]??null;
   if(providerUploadId&&ids.length&&!ids.includes(providerUploadId))throw new ServiceError("conflict","The supplied upload ID is not in the original multipart inventory.");
  }
  const inspected=providerUploadId?await multipart.inspect!(key,providerUploadId):{state:"absent" as const},head=await captured.store.head(key);
  let verified:z.infer<typeof proof>={state:inspected.state==="open"?"open":"absent",providerUploadId};
  if(head){
   if(inspected.state!=="absent")throw new ServiceError("conflict","The multipart resource and object both remain. Verify their original disposition before recovery.");
   if(!input.sha256||input.bytes===undefined||head.bytes!==input.bytes)throw new ServiceError("validation","Verify the exact original object's SHA-256 and byte count.");
   const stream=await captured.store.stream(key);if(!stream)throw new ServiceError("conflict","The original object is unavailable.");
   let bytes=0;const hash=createHash("sha256");for await(const chunk of stream){bytes+=chunk.byteLength;if(bytes>input.bytes)throw new ServiceError("conflict","The original object has different bytes.");hash.update(chunk);}
   if(bytes!==input.bytes||hash.digest("hex")!==input.sha256)throw new ServiceError("conflict","The original object does not match the verified content.");
   verified={state:"object",providerUploadId,sha256:input.sha256,bytes};
  }
  if(verified.state==="absent")await assertPhysicalStorageAbsence(captured.store,key);
  const result=await applyMultipartRecovery.call({...input,proof:verified,storageKind:captured.binding.kind,storageLocation:{...captured.binding.location}},actor);
  await reconcileMediaErasureCohorts({multipartResourceId:input.resourceId}).catch(()=>{});return result;
 }),
});
export default[listMultipartOperations,claimMultipartRecovery,applyMultipartRecovery,claimMultipartCleanup,reconcileMultipartOperation,...appliedRecoveryServices];
