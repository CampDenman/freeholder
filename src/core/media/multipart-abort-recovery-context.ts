// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fresh genuine human verification; no original caller or DELETE is resumed.
import {and,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {lockTransferInventory} from "./transfer-authority";
import {capture,type MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import {lockedIdleOriginalMultipart} from "./multipart-idle-retirement-context";
import {mediaMultipartOperations as operations} from "./multipart-schema";
import {mediaStorageTransferCalls as calls,mediaStorageWriterDrains as drains} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {requireLocallyClosedOriginalMultipartAbort} from "./multipart-abort-recovery-proof";
import {retainedKnownCreateReview} from "./multipart-known-create-review";
import {transferConflict,transferDigest} from "./transfer-proof";
export async function captureIdleMultipartAbortRecovery(tx:Tx,input:MultipartRecoveryConfirmation){
 await lockTransferInventory(tx);const base=await capture(tx,input);if(input.action!=="cleanup"||!base.operation||base.operation.kind!=="abort"||!["started","unknown","accepted"].includes(base.operation.state))transferConflict("Choose verification-only cleanup of the exact original idle-session ABORT. It cannot be replayed or replaced.");
 const current=await lockedIdleOriginalMultipart(tx,base.resource.id,base.operation.id),operation=current.operation;if(!operation||current.resource.retiredAt)transferConflict("Keep the exact unresolved original ABORT; an existing retirement cannot be rebound to a new review.");
 const original=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,operation.id),eq(calls.kind,"multipart_abort"))).limit(2).for("update"),caller=original[0];if(original.length!==1||!caller||!["admitted","unknown","returned"].includes(caller.state)||caller.namespace!==current.resource.namespace||caller.physicalKey!==current.resource.key||caller.runtimeId!==operation.writerRuntimeId||caller.stopReceiptId)transferConflict();
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[],[stop]=input.stopDrainId?await tx.select().from(drains).where(eq(drains.id,input.stopDrainId)).limit(1):[];
 const closed=requireLocallyClosedOriginalMultipartAbort({caller,requests:physical,namespace:current.resource.namespace,key:current.resource.key,uploadId:current.resource.providerUploadId!,writerFinishedAt:operation.writerFinishedAt,stop:stop??null}),[proven]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_abort_local_closed(${operation.id}::uuid,${closed.stop?.id??null}::uuid) as proven`);if(proven?.proven!==true)transferConflict("Every original creator must independently close before verification-only monotonic session removal.");
 const[creation]=await tx.select().from(operations).where(and(eq(operations.resourceId,current.resource.id),eq(operations.kind,"create"))).limit(1),[creator]=creation?await tx.select().from(calls).where(and(eq(calls.multipartOperationId,creation.id),eq(calls.kind,"multipart_create"))).limit(1):[];if(!creation||!creator)transferConflict();
 const births=await tx.select().from(requests).where(eq(requests.callId,creator.id)),birth=births.find(row=>row.descriptor.kind==="multipart.create");if(!birth)transferConflict();const review=creator.state==="stopped"?await retainedKnownCreateReview(tx,creation.id):undefined;
 const issuers=await tx.select().from(operations).where(and(eq(operations.resourceId,current.resource.id),eq(operations.kind,"sign"))).limit(50001);if(issuers.length>50000)transferConflict();
 return{...base,...current,kind:"abort"as const,operation,caller,physical,facts,creation,creator,creationProof:{...birth,observedUploadId:current.resource.providerUploadId!,...(review?{review}:{})},binding:{kind:"s3"as const,namespace:current.resource.namespace,location:current.resource.storageLocation},expectedRevision:undefined,issuers,stop:closed.stop,witness:transferDigest({resource:current.resource,operation,caller,physical,issuers,stop:closed.stop})};
}
