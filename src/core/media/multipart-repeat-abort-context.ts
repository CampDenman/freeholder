// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fresh READ-only same-original review. First stop/ACK/FIN are immutable.
import {and,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import type {capture} from "./multipart-recovery-context";
import {lockedIdleOriginalMultipart} from "./multipart-idle-retirement-context";
import {mediaMultipartOperations as operations} from "./multipart-schema";
import {mediaStorageTransferCalls as calls,mediaStorageWriterDrains as drains} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {requireRetainedMultipartCandidate,type RetainedOriginalMultipartIdentity} from "./multipart-retained-identity";
import {requireLocallyClosedOriginalMultipartAbort} from "./multipart-abort-recovery-proof";
import {retainedKnownCreateReview} from "./multipart-known-create-review";
import {transferConflict} from "./transfer-proof";
export async function captureRepeatOriginalAbortContext(tx:Tx,input:MultipartRecoveryConfirmation,base:Awaited<ReturnType<typeof capture>>,identity:RetainedOriginalMultipartIdentity){
 const current=await lockedIdleOriginalMultipart(tx,base.resource.id,base.operation?.id),operation=current.operation;
 if(input.action!=="cleanup"||!operation||operation.id!==identity.retirement.operationId||current.resource.retiredAt||current.resource.redactedAt||!current.resource.namespace||!current.resource.providerUploadId)transferConflict("Keep this upload for review. Restore its exact original storage details before verifying it again.");
 requireRetainedMultipartCandidate(identity,{namespace:current.resource.namespace,key:current.resource.key,uploadId:current.resource.providerUploadId,binding:{kind:current.resource.storageKind,namespace:current.resource.namespace,location:current.resource.storageLocation}});
 if(input.originalKey&&input.originalKey!==current.resource.key||input.providerUploadId&&input.providerUploadId!==current.resource.providerUploadId||input.stopDrainId&&input.stopDrainId!==identity.retirement.stopDrainId)transferConflict("Keep the immutable first upload and stop identities. A later locator or stopped executor cannot replace them.");
 const original=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,operation.id),eq(calls.kind,"multipart_abort"))).limit(2).for("update"),caller=original[0];if(original.length!==1||!caller||caller.id!==identity.retirement.callerId)transferConflict();
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[],[stop]=identity.retirement.stopDrainId?await tx.select().from(drains).where(eq(drains.id,identity.retirement.stopDrainId)).limit(1):[];
 const closed=requireLocallyClosedOriginalMultipartAbort({caller,requests:physical,namespace:current.resource.namespace,key:current.resource.key,uploadId:current.resource.providerUploadId,writerFinishedAt:operation.writerFinishedAt,stop:stop??null}),[proof]=await tx.execute<{proven:boolean;witness:string|null}>(sql`select freeholder_media_multipart_repeat_abort_context(${operation.id}::uuid) as proven,freeholder_media_multipart_repeat_abort_witness(${operation.id}::uuid) as witness`);if(proof?.proven!==true||!proof.witness)transferConflict("The original upload evidence changed. Keep it for review before verifying storage again.");
 const[creation]=await tx.select().from(operations).where(eq(operations.id,identity.creation.operationId)).limit(1),[creator]=await tx.select().from(calls).where(eq(calls.id,identity.creation.callerId)).limit(1);if(!creation||!creator)transferConflict();const birth=(await tx.select().from(requests).where(eq(requests.id,identity.creation.requestId)).limit(1))[0];if(!birth)transferConflict();const review=creator.state==="stopped"?await retainedKnownCreateReview(tx,creation.id):undefined,issuers=await tx.select().from(operations).where(and(eq(operations.resourceId,current.resource.id),eq(operations.kind,"sign"))).limit(50001);if(issuers.length>50000)transferConflict();
 return{...base,...current,kind:"abort"as const,repeat:true as const,operation,caller,physical,facts,creation,creator,creationProof:{...birth,observedUploadId:current.resource.providerUploadId,...(review?{review}:{})},binding:{kind:"s3"as const,namespace:current.resource.namespace,location:current.resource.storageLocation},expectedRevision:undefined,issuers,stop:closed.stop,witness:proof.witness};
}
