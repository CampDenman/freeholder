// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact original COMPLETE/preflight/CREATE, never current scope adoption.
import {createHash} from "node:crypto";
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {StorageBinding} from "@/adapters/storage/types";
import {retainedKnownCreateReview} from "./multipart-known-create-review";
import {captureIdleMultipartAbortRecovery} from "./multipart-abort-recovery-context";
import {captureKnownCreateContext} from "./multipart-known-create-context";
import {capture,type MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import {mediaMultipartOperations} from "./multipart-schema";
import {mediaStorageTransferCalls as calls,mediaStorageWriterDrains as drains} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {originalMultipartCompleteManifest} from "./multipart-complete-manifest";
import {requireQuiescentOriginalMultipartComplete} from "./multipart-complete-recovery-proof";
import {lockTransferInventory} from "./transfer-authority";
import {checkedTransferRevision,transferConflict,transferDigest} from "./transfer-proof";
export async function captureAppliedMultipartContext(tx:Tx,input:MultipartRecoveryConfirmation){
 await lockTransferInventory(tx);const base=await capture(tx,input),{resource,operation}=base;
 if(operation?.kind==="abort")return captureIdleMultipartAbortRecovery(tx,input);
 if(operation?.kind==="create")return captureKnownCreateContext(tx,input);
 if(input.action!=="applied"||!operation||operation.kind!=="complete"||!["started","unknown"].includes(operation.state)||resource.redactedAt||!resource.originalReservationId||!resource.namespace||resource.storageKind!=="s3"||!resource.providerUploadId||operation.providerUploadId!==resource.providerUploadId||!operation.writerRuntimeId)transferConflict("Recover only the intact original tracked COMPLETE and original session. Legacy or minimized unknown provenance remains pending.");
 const creators=await tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),eq(mediaMultipartOperations.kind,"create"))).limit(2),creation=creators[0];
 const originals=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,operation.id),eq(calls.kind,"multipart_complete"))).limit(2).for("update"),caller=originals[0];
 if(creators.length!==1||!creation?.partBodies||!creation.createBaseline||creation.createBaseline.state!=="complete"||originals.length!==1||!caller||caller.namespace!==resource.namespace||caller.physicalKey!==resource.key||caller.runtimeId!==operation.writerRuntimeId||!["admitted","unknown","returned"].includes(caller.state))transferConflict("Retain the exact original CREATE/body declaration and unresolved COMPLETE caller before recovery.");
 const canonical=originalMultipartCompleteManifest(operation.parts,creation.partBodies),digest=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");if(digest!==operation.partsDigest||transferDigest(canonical)!==transferDigest(operation.parts))transferConflict("The original immutable COMPLETE manifest changed.");
 const[birthProof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_checksum_birth(${resource.id}::uuid) as proven`);if(birthProof?.proven!==true)transferConflict("The original checksum-enabled CREATE/session birth cannot be reconstructed from current configuration.");
 const creatorRows=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,creation.id),eq(calls.kind,"multipart_create"))).limit(2),creator=creatorRows[0];
 const births=creator?await tx.select().from(requests).where(eq(requests.callId,creator.id)):[],physicalBirths=births.filter(row=>row.descriptor.kind==="multipart.create"),birth=physicalBirths[0];
 if(creatorRows.length!==1||!creator||!creator.observedAcceptedAt||physicalBirths.length!==1||!birth||birth.descriptor.binding.namespace!==resource.namespace||birth.descriptor.key!==resource.key)transferConflict("The actual original CREATE and its physical return must remain intact.");
 const reviewedCreate=creator.state==="stopped"?await retainedKnownCreateReview(tx,creation.id):undefined;
 if((creator.state!=="returned"||!creator.returnedAt||creation.writerFinishedAt?.getTime()!==creator.returnedAt.getTime()||birth.state!=="returned"||!birth.returnedAt)&&!reviewedCreate)transferConflict("Preserve genuine original CREATE returns or its exact immutable known-session review; never invent a missing FIN.");
 const birthFacts=await tx.select().from(observations).where(eq(observations.requestId,birth.id));if(!birthFacts.some(row=>row.facts.stage==="response_body"&&row.facts.detailDigest)||!birthFacts.some(row=>row.facts.stage==="session"&&row.facts.uploadId===resource.providerUploadId))transferConflict();
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)).orderBy(asc(requests.createdAt),asc(requests.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[];
 const[stop]=input.stopDrainId?await tx.select().from(drains).where(eq(drains.id,input.stopDrainId)).limit(1):[];
 const quiescence=requireQuiescentOriginalMultipartComplete({caller,requests:physical,namespace:resource.namespace,key:resource.key,uploadId:resource.providerUploadId,parts:operation.parts,partsDigest:digest,writerFinishedAt:operation.writerFinishedAt,facts,stop:stop??null});
 const issuers=await tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),eq(mediaMultipartOperations.kind,"sign"))).limit(50001);
 if(issuers.length>50000)transferConflict("The complete original issuer inventory exceeds this bounded recovery.");
 for(const issue of issuers){const[proof]=await tx.execute<{proven:boolean}>(sql`select (${issue.state}='accepted' and freeholder_media_multipart_issue_result(${issue.id}::uuid)) or (${issue.state}='withheld' and freeholder_media_multipart_withheld_issue(${issue.id}::uuid)) or freeholder_media_multipart_unused_issue(${issue.id}::uuid) as proven`);if(proof?.proven!==true||issue.createdAt>operation.createdAt||!issue.writerFinishedAt||issue.writerFinishedAt>operation.createdAt)transferConflict("Every possible local signer must have its exact original first result and finish before the original COMPLETE. Unknown/late creators remain debt.");}
 const[finished]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_original_issuers_finished(${operation.id}::uuid) as proven`);if(finished?.proven!==true)transferConflict("Every original declared part needs its genuine pre-completion issuer result and finish.");
 const binding:StorageBinding={kind:"s3",namespace:resource.namespace,location:{...resource.storageLocation}},creationProof={...birth,observedUploadId:resource.providerUploadId,...(reviewedCreate?{review:reviewedCreate}:{})};
 const completionIds=new Set(physical.filter(row=>row.descriptor.kind==="multipart.complete").map(row=>row.id)),known=facts.filter(row=>completionIds.has(row.requestId)&&row.facts.stage==="metadata"&&row.facts.revision).map(row=>row.facts.revision!);
 if(caller.resultRevision)known.unshift(caller.resultRevision);
 const expectedRevision=known[0]?checkedTransferRevision(known[0],binding,base.key):undefined;
 if(expectedRevision&&known.some(revision=>transferDigest(revision)!==transferDigest(expectedRevision)))transferConflict("Conflicting actual original COMPLETE revisions remain recovery debt; a current generation cannot replace the first result.");
 return{...base,kind:"complete"as const,operation,caller,physical,facts,creation,creator,creationProof,binding,expectedRevision,issuers,stop:quiescence.stop,witness:transferDigest({resource,operation,caller,physical,creation,creator,birth,issuers,stop:quiescence.stop})};
}
