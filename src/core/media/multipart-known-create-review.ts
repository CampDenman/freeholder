// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Read genuine immutable review evidence; never turn its NULLs into returns.
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaMultipartOperations as operations,mediaMultipartResources as resources} from "./multipart-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferReviews as reviews,mediaStorageWriterDrains as drains} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {mediaStorageProviderInventories as inventories} from "./transfer-inventory-schema";
import {readProviderInventoryPass} from "./transfer-inventory";
import {requireReviewedOriginalCreate,type KnownOriginalCreateReview} from "./multipart-known-create-proof";
import {transferConflict} from "./transfer-proof";
export async function retainedKnownCreateReview(tx:Tx,operationId:string):Promise<KnownOriginalCreateReview|undefined>{
 const[proven]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_known_create_review(${operationId}::uuid) as proven`);if(proven?.proven!==true)return;
 const[operation]=await tx.select().from(operations).where(eq(operations.id,operationId)).limit(1),[resource]=operation?await tx.select().from(resources).where(eq(resources.id,operation.resourceId)).limit(1):[],[caller]=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,operationId),eq(calls.kind,"multipart_create"))).limit(1),[record]=caller?.stopReceiptId?await tx.select().from(reviews).where(eq(reviews.id,caller.stopReceiptId)).limit(1):[];
 if(!operation?.createBaseline||!resource?.namespace||!resource.providerUploadId||!caller||!record?.inventoryId)transferConflict("Restore the complete immutable original known-CREATE review.");
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)).orderBy(asc(requests.createdAt),asc(requests.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[],create=physical.find(row=>row.descriptor.kind==="multipart.create"),[inspection]=await tx.select().from(calls).where(eq(calls.id,record.readCallId)).limit(1),[inventory]=await tx.select().from(inventories).where(eq(inventories.id,record.inventoryId)).limit(1),[stop]=record.stopDrainId?await tx.select().from(drains).where(eq(drains.id,record.stopDrainId)).limit(1):[];
 if(!create||!inspection||!inventory)transferConflict();
 const first=await readProviderInventoryPass(tx,inventory,0),confirmed=await readProviderInventoryPass(tx,inventory,1),proof:KnownOriginalCreateReview={record,operationId,sourceEvidenceDigest:operation.evidenceDigest,original:{caller,requests:physical,namespace:resource.namespace,key:resource.key,keyDigest:resource.keyDigest,uploadId:resource.providerUploadId,writerFinishedAt:operation.writerFinishedAt,baseline:operation.createBaseline,facts,stop:stop??null},inspection,inventory,first,confirmed};
 requireReviewedOriginalCreate(proof,{...create,observedUploadId:resource.providerUploadId});return proof;
}
