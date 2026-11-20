// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Authorized metadata-only declaration. No signer/provider/remote finish is
// invoked here; actual issuer and consumption receipts remain separate.
import {randomUUID} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import type {ServiceContext} from "@/core/service";
import {mediaMultipartOperations} from "./multipart-schema";
import {mediaStorageTransferCalls} from "./transfer-schema";
import {mediaStorageTransferRequests} from "./transfer-request-schema";
import {assertOriginalNamespaceMutation} from "./original-namespace-fence";
import {assertOriginalKeyCreator} from "./original-key-tombstone";
import {assertMediaActorLive,assertOriginalUploadWritable} from "./upload-ownership";
import {storageOperationsHeld} from "./write-ledger";
import {transferConflict,transferDigest} from "./transfer-proof";
import {exactMultipartPartBodies,ORIGINAL_MULTIPART_PART_BYTES,sameMultipartPartBodies,type OriginalMultipartPartBody,type OriginalMultipartPartBodies} from "./multipart-part-bodies-proof";
import {lockMultipartUpload} from "./multipart-operations";
export async function declareOriginalMultipartPartBodies(ctx:ServiceContext,uploadId:string,input:readonly OriginalMultipartPartBody[]){
 const{upload,resource}=await lockMultipartUpload(ctx.tx,uploadId);
 await assertMediaActorLive(ctx.tx,ctx.actor);await assertOriginalUploadWritable(ctx.tx,upload.ownerContactId,upload.uploadedBy);
 if(resource.state!=="open"||!["created","uploading"].includes(upload.state)||upload.expiresAt<=new Date()||!resource.namespace||!resource.providerUploadId||await storageOperationsHeld(ctx.tx,[resource.contactId]))transferConflict("Keep this upload for review. It no longer accepts new upload-part declarations.");
 await assertOriginalNamespaceMutation(ctx.tx,resource.namespace);await assertOriginalKeyCreator(ctx.tx,{namespace:resource.namespace,key:resource.key,role:"multipart_part"});
 const parts=exactMultipartPartBodies(input,resource.expectedBytes),creation=await ctx.tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),eq(mediaMultipartOperations.kind,"create"))).limit(2).for("update"),operation=creation[0];
 if(creation.length!==1||!operation)transferConflict();
 const[proof]=await ctx.tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_part_body_context(${operation.id}::uuid) as proven`);
 if(proof?.proven!==true)transferConflict("Keep the original upload for review. Its original session creation must be verified before declaring parts.");
 if(operation.partBodies){if(!sameMultipartPartBodies(operation.partBodies,parts))transferConflict("Select the same original file to resume this upload. Its part checksums are already fixed.");return operation.partBodies;}
 const[caller]=await ctx.tx.select().from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.multipartOperationId,operation.id),eq(mediaStorageTransferCalls.kind,"multipart_create"))).limit(1);
 const physical=caller?await ctx.tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,caller.id)):[],original=physical.filter(row=>row.descriptor.kind==="multipart.create"),request=original[0];
 if(!caller||original.length!==1||!request)transferConflict();
 const manifest:OriginalMultipartPartBodies={format:"original-multipart-part-bodies/v1",id:randomUUID(),originalCreateCallId:caller.id,originalCreateRequestId:request.id,uploadIdDigest:transferDigest(resource.providerUploadId),namespace:resource.namespace,keyDigest:resource.keyDigest,expectedBytes:resource.expectedBytes,partBytes:ORIGINAL_MULTIPART_PART_BYTES,parts};
 await ctx.tx.update(mediaMultipartOperations).set({partBodies:manifest,updatedAt:new Date()}).where(eq(mediaMultipartOperations.id,operation.id));
 return manifest;
}
