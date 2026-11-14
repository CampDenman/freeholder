// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: closed-original evidence is NOT a live CREATE/SIGN proof.
import {and,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import type {capture} from "./multipart-recovery-context";
import {mediaMultipartOperations as operations} from "./multipart-schema";
import {mediaStorageTransferCalls as calls,mediaStorageWriterDrains as drains} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {requireRetainedMultipartCandidate,type RetainedOriginalMultipartIdentity} from "./multipart-retained-identity";
import {configuredRetainedOriginalBinding} from "./transfer-storage";
import {storageOperationsHeld} from "./write-ledger";
import {transferConflict} from "./transfer-proof";

export interface ClosedOriginalMultipartEvidence {
 readonly kind:"closed-original-idle-multipart";
 readonly identity:RetainedOriginalMultipartIdentity;
}

/** The actual shared fresh-human phase already checked permissions, step-up,
 * original witness and key digest. These are ephemeral READ candidates. Old
 * canonical fields, NULL ACK/FIN, first stop and historical rows stay intact. */
export async function captureCompactOriginalAbortContext(tx:Tx,input:MultipartRecoveryConfirmation,base:Awaited<ReturnType<typeof capture>>,identity:RetainedOriginalMultipartIdentity){
 const{resource,operation}=base;
 if(input.action!=="cleanup"||!operation||operation.kind!=="abort"||operation.id!==identity.retirement.operationId||!resource.redactedAt||resource.providerUploadId!==null||resource.objectReceiptId||resource.key!==`retained:${identity.resource.keyDigest}`||resource.namespace!==identity.resource.namespace||resource.originalReservationId!==identity.resource.reservationId||resource.uploadId!==identity.resource.uploadId||resource.retiredAt||!input.originalKey||!input.providerUploadId||input.stopDrainId&&input.stopDrainId!==identity.retirement.stopDrainId||await storageOperationsHeld(tx,[resource.contactId]))transferConflict("Keep this original upload pending until its exact saved identity and current evidence can be reviewed.");
 const binding=configuredRetainedOriginalBinding(identity.resource.namespace,identity.resource.bindingDigest);
 requireRetainedMultipartCandidate(identity,{namespace:binding.namespace,key:base.key,uploadId:input.providerUploadId,binding});
 const[proof]=await tx.execute<{proven:boolean;witness:string|null}>(sql`select freeholder_media_multipart_repeat_abort_context(${operation.id}::uuid) as proven,freeholder_media_multipart_repeat_abort_witness(${operation.id}::uuid) as witness`);
 if(proof?.proven!==true||!proof.witness)transferConflict("New or conflicting original evidence needs review before storage can be read again.");
 const[caller]=await tx.select().from(calls).where(eq(calls.id,identity.retirement.callerId)).limit(1).for("update"),[creation]=await tx.select().from(operations).where(eq(operations.id,identity.creation.operationId)).limit(1),[creator]=await tx.select().from(calls).where(eq(calls.id,identity.creation.callerId)).limit(1),[birth]=await tx.select().from(requests).where(eq(requests.id,identity.creation.requestId)).limit(1);
 if(!caller||caller.multipartOperationId!==operation.id||!creation||creation.resourceId!==resource.id||!creator||creator.multipartOperationId!==creation.id||!birth||birth.callId!==creator.id)transferConflict();
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[],issuers=await tx.select().from(operations).where(and(eq(operations.resourceId,resource.id),eq(operations.kind,"sign"))).limit(50001),[stop]=identity.retirement.stopDrainId?await tx.select().from(drains).where(eq(drains.id,identity.retirement.stopDrainId)).limit(1):[];
 if(issuers.length>50000||identity.retirement.stopDrainId&&!stop)transferConflict();
 const closedCreation:ClosedOriginalMultipartEvidence={kind:"closed-original-idle-multipart",identity};
 return{...base,kind:"abort"as const,repeat:true as const,compact:true as const,sessionId:input.providerUploadId,operation,caller,physical,facts,creation,creator,creationProof:{...birth,observedUploadId:null},closedCreation,binding,expectedRevision:undefined,issuers,stop:stop??null,witness:proof.witness};
}
