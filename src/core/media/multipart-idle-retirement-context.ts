// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recheck real original authority at every claim, physical admission and apply.
import {and,eq,or,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {TransferRequestDescriptor} from "../../../scripts/media-transfer.mjs";
import {mediaMultipartOperations as operations,mediaMultipartResources as resources} from "./multipart-schema";
import {mediaUploads,mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import type {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferObjects as copies} from "./transfer-schema";
import {mediaStorageTransferRequests as requests} from "./transfer-request-schema";
import {storageQuotaObjects} from "./storage-quota-schema";
import {lockTransferInventory} from "./transfer-authority";
import {lockObjectDigest,storageOperationsHeld} from "./write-ledger";
import {assertOriginalNamespaceMutation} from "./original-namespace-fence";
import {pendingObjectIsOwned} from "./object-ledger";
import {transferConflict} from "./transfer-proof";
export async function lockedIdleOriginalMultipart(tx:Tx,resourceId:string,operationId?:string){
 await lockTransferInventory(tx);
 const[identity]=await tx.select({digest:resources.keyDigest}).from(resources).where(eq(resources.id,resourceId)).limit(1);if(!identity)transferConflict();await lockObjectDigest(tx,identity.digest);
 const[resource]=await tx.select().from(resources).where(eq(resources.id,resourceId)).limit(1).for("update"),[upload]=resource?await tx.select().from(mediaUploads).where(eq(mediaUploads.id,resource.uploadId)).limit(1).for("update"):[];
 if(!resource?.originalReservationId||!resource.namespace||resource.storageKind!=="s3"||resource.redactedAt||resource.objectReceiptId||!resource.providerUploadId||!upload||upload.storageKey!==resource.key||upload.providerUploadId!==resource.providerUploadId||upload.state==="complete"||!['open','aborting','aborted','unknown'].includes(resource.state)||await storageOperationsHeld(tx,[resource.contactId]))transferConflict("Retire only the intact original idle upload; a live asset, hold, unknown birth or different session preserves its bytes.");
 const[creation]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_idle_creation(${resource.id}::uuid) as proven`);if(creation?.proven!==true)transferConflict("Every original creator and unused or withheld local signer must have its genuine closure before idle session removal. Exposed or unknown upload links remain pending.");
 const pointers=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,resource.key)).limit(2);if(pointers.length!==1||pointers[0]?.reservationId!==resource.originalReservationId||pointers[0].uploadId!==resource.uploadId||pointers[0].state!=="pending")transferConflict("Keep the exact original pending reservation; equal keys do not authorize removing another generation.");
 if((await tx.select({id:resources.id}).from(resources).where(and(eq(resources.namespace,resource.namespace),eq(resources.keyDigest,resource.keyDigest))).limit(2)).length!==1||(await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,resource.keyDigest)).limit(1)).length||(await tx.select({id:copies.id}).from(copies).where(or(eq(copies.keyDigest,resource.keyDigest),eq(copies.targetKeyDigest,resource.keyDigest))).limit(1)).length)transferConflict("Another original generation or transfer copy shares this physical key; retain every original lineage for recovery.");
 // Existing multipart under a quota wrapper is deliberately proxy-only. A
 // current-key charge cannot be attributed to this uncharged session by guess.
 if((await tx.select({key:storageQuotaObjects.objectKey}).from(storageQuotaObjects).where(and(eq(storageQuotaObjects.namespace,resource.namespace),eq(storageQuotaObjects.objectKey,resource.key))).limit(1)).length)transferConflict("Restore the exact original multipart quota token before releasing a charged resource; an equal key is insufficient.");
 const[operation]=operationId?await tx.select().from(operations).where(and(eq(operations.id,operationId),eq(operations.resourceId,resource.id),eq(operations.kind,"abort"))).limit(1).for("update"):[];
 if(operationId&&(!operation||operation.providerUploadId!==resource.providerUploadId))transferConflict();
 const aborts=await tx.select({id:operations.id}).from(operations).where(and(eq(operations.resourceId,resource.id),eq(operations.kind,"abort"))).limit(2);if(operationId?aborts.length!==1||aborts[0]?.id!==operationId:aborts.length!==0)transferConflict("Keep the earlier original ABORT for recovery; no later invocation may replay or replace its physical request.");
 return{resource,upload,operation};
}
export async function assertIdleOriginalMultipartAbortRequest(tx:Tx,caller:typeof calls.$inferSelect,descriptor:TransferRequestDescriptor):Promise<void>{
 if(caller.kind!=="multipart_abort"||!caller.multipartOperationId||descriptor.kind!=="multipart.abort")transferConflict();const[operation]=await tx.select().from(operations).where(eq(operations.id,caller.multipartOperationId)).limit(1);if(!operation)transferConflict();
 const original=await lockedIdleOriginalMultipart(tx,operation.resourceId,operation.id);
 await assertOriginalNamespaceMutation(tx,original.resource.namespace!);
 if(operation.state!=="started"||caller.state!=="admitted"||caller.returnedAt||original.resource.state!=="aborting"||original.upload.state!=="aborted"||caller.namespace!==original.resource.namespace||caller.physicalKey!==original.resource.key||descriptor.key!==original.resource.key||descriptor.binding.namespace!==original.resource.namespace||descriptor.uploadId!==original.resource.providerUploadId||await pendingObjectIsOwned(original.resource.key,new Date(),tx)||(await tx.select({id:requests.id}).from(requests).where(eq(requests.callId,caller.id)).limit(1)).length)transferConflict("Only this actual new idle-session ABORT may dispatch once after its original upload is closed and every prior creator is genuinely quiescent.");
}
