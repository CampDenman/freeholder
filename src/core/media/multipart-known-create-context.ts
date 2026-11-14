// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A retained first ACK, not inventory cardinality, owns this original session.
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {StorageBinding} from "@/adapters/storage/types";
import {capture,type MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import {mediaStorageTransferCalls as calls,mediaStorageWriterDrains as drains} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {mediaMultipartOperations as operations} from "./multipart-schema";
import {lockTransferInventory} from "./transfer-authority";
import {requireKnownOriginalMultipartCreate} from "./multipart-known-create-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
export async function captureKnownCreateContext(tx:Tx,input:MultipartRecoveryConfirmation){
 await lockTransferInventory(tx);const base=await capture(tx,input),{resource,operation}=base;
 if(input.action!=="applied"||!operation||operation.kind!=="create"||!["started","unknown"].includes(operation.state)||!resource.originalReservationId||resource.redactedAt||resource.objectReceiptId||!resource.namespace||resource.storageKind!=="s3"||!resource.providerUploadId||!operation.providerAcceptedAt||operation.observedProviderUploadId!==resource.providerUploadId||!operation.writerRuntimeId||!operation.createBaseline)transferConflict("Keep the original CREATE pending. Its genuinely retained first provider acknowledgement/session identity is required; a current-key listing cannot supply it.");
 const original=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,operation.id),eq(calls.kind,"multipart_create"))).limit(2).for("update"),caller=original[0];
 if(original.length!==1||!caller||!["admitted","unknown","returned"].includes(caller.state)||caller.namespace!==resource.namespace||caller.physicalKey!==resource.key||caller.runtimeId!==operation.writerRuntimeId||!caller.observedAcceptedAt)transferConflict("Restore the exact known original CREATE caller and its first acknowledgement without resuming it.");
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)).orderBy(asc(requests.createdAt),asc(requests.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[],[stop]=input.stopDrainId?await tx.select().from(drains).where(eq(drains.id,input.stopDrainId)).limit(1):[];
 const quiescence=requireKnownOriginalMultipartCreate({caller,requests:physical,namespace:resource.namespace,key:resource.key,keyDigest:resource.keyDigest,uploadId:resource.providerUploadId,writerFinishedAt:operation.writerFinishedAt,baseline:operation.createBaseline,facts,stop:stop??null});
 const issuers=await tx.select().from(operations).where(and(eq(operations.resourceId,resource.id),eq(operations.kind,"sign"))).limit(50001);if(issuers.length>50000)transferConflict("The whole original issuer inventory exceeds this bounded known-session review.");
 for(const issue of issuers){const[proof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_unused_issue(${issue.id}::uuid) or (${issue.state}='withheld' and freeholder_media_multipart_withheld_issue(${issue.id}::uuid)) as proven`);if(proof?.proven!==true)transferConflict("An issued or unknown original browser link still needs genuine recovery; an empty current part list cannot close it.");}
 const binding:StorageBinding={kind:"s3",namespace:resource.namespace,location:{...resource.storageLocation}},creationProof={...quiescence.create,observedUploadId:resource.providerUploadId};
 return{...base,kind:"create"as const,operation,caller,physical,facts,creation:operation,creator:caller,creationProof,binding,expectedRevision:undefined,issuers,stop:quiescence.stop,witness:transferDigest({resource,operation,caller,physical,issuers,stop:quiescence.stop})};
}
