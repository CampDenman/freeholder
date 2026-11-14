// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: the idle no-object cohort has its OWN erasure proof. It cannot
// borrow the ordinary PUT/DELETE reducer, release quota or dispatch a DELETE.
import {and,eq,inArray,sql} from "drizzle-orm";
import type {JobExecutionContext} from "@/core/jobs";
import {requireActualWorkerExecution} from "@/core/jobs/execution-scope";
import type {Tx} from "@/core/service";
import {mediaUploads} from "./schema";
import {mediaMultipartOperations as operations,mediaMultipartResources as resources} from "./multipart-schema";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as facts} from "./transfer-request-schema";
import {mediaStorageProviderInventories as inventories,mediaStorageProviderInventoryPages as pages,mediaStorageProviderInventoryEntries as entries} from "./transfer-inventory-schema";
import {readOriginalMultipartCertificateCoverage} from "./multipart-certificate-coverage";
import {originalMediaScopeMembers} from "./original-erasure-scope";
import {allowMediaReceiptWrites,lockObjectDigest} from "./write-ledger";
import {lockTransferInventory} from "./transfer-authority";
import {transferConflict} from "./transfer-proof";

export interface OriginalMultipartErasureDelivery {
 requestId:string;originalJobId:string;resourceIds:string[];uploadIds:string[];keyDigests:string[];
}

/** Real installed worker + exact original active job. This helper opens no
 * transaction, service call or remote work; all reductions commit together. */
export async function assertIdleMultipartErasureDelivery(tx:Tx,input:OriginalMultipartErasureDelivery,context:JobExecutionContext):Promise<void>{
 await requireActualWorkerExecution(context);
 if(context.name!=="core.eraseMediaMultipartOperations"||context.id!==input.originalJobId)transferConflict("Only the original active upload-erasure worker may reduce its retained evidence.");
 const rows=await tx.execute<{id:string}>(sql`select job.id from pgboss.job job join job_idempotency_keys claim on claim.job_id=job.id and claim.job_name=job.name where job.id=${context.id}::uuid and job.name=${context.name} and job.state='active' and job.data=${JSON.stringify(input)}::jsonb and claim.payload_hash=encode(sha256(convert_to(freeholder_source_receipt_canonical(job.data),'UTF8')),'hex')`);
 if(rows.length!==1)transferConflict("Restore the exact original upload-erasure job, claim and immutable payload before continuing.");
}

/** False means honest pending evidence, never permission for fallback DELETE.
 * Caller must retain this resource in its idle-only route in either case. */
export async function minimizeIdleOriginalMultipart(tx:Tx,input:OriginalMultipartErasureDelivery,resourceId:string,context:JobExecutionContext):Promise<boolean>{
 await assertIdleMultipartErasureDelivery(tx,input,context);
 await lockTransferInventory(tx);
 const first=await originalMediaScopeMembers(tx,input.requestId,"media.multipartOperations");
 if(first.birthDebt||!input.resourceIds.includes(resourceId)||!first.resourceIds.includes(resourceId))return false;
 const[identity]=await tx.select({digest:resources.keyDigest}).from(resources).where(eq(resources.id,resourceId)).limit(1);if(!identity)return false;await lockObjectDigest(tx,identity.digest);
 const[resource]=await tx.select().from(resources).where(eq(resources.id,resourceId)).limit(1).for("update");if(!resource)return false;
 const certificate=await readOriginalMultipartCertificateCoverage(tx,resourceId);if(!certificate)return false;
 const[eligible]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_idle_minimizable(${resourceId}::uuid,${input.requestId}::uuid,${certificate.id}::uuid) as proven`);if(eligible?.proven!==true)return false;
 await allowMediaReceiptWrites(tx);
 const opIds=certificate.proof.operations.map(row=>row.id),callIds=certificate.proof.callers.map(row=>row.id),requestIds=certificate.proof.requests.map(row=>row.id),headerIds=certificate.proof.inventories.map(row=>row.id);
 const actualCalls=await tx.select().from(calls).where(inArray(calls.id,callIds));
 for(const caller of actualCalls)if(!caller.redactedAt||caller.expectedRevision||caller.resultRevision)await tx.update(calls).set({physicalKey:`retained:${resource.keyDigest}`,expectedRevision:null,resultRevision:null,redactedAt:caller.redactedAt??new Date(),updatedAt:new Date()}).where(eq(calls.id,caller.id));
 const physical=await tx.select().from(requests).where(inArray(requests.id,requestIds));
 for(const request of physical){
  if(!request.redactedAt)await tx.update(requests).set({descriptor:{kind:request.descriptor.kind,binding:{kind:request.descriptor.binding.kind,namespace:request.descriptor.binding.namespace,location:{}},...(request.keyDigest?{key:`retained:${request.keyDigest}`}:{})},redactedAt:new Date()}).where(eq(requests.id,request.id));
  const observed=await tx.select().from(facts).where(eq(facts.requestId,request.id));
  for(const fact of observed)if(!fact.redactedAt)await tx.update(facts).set({facts:{stage:fact.facts.stage,status:fact.facts.status},redactedAt:new Date()}).where(eq(facts.id,fact.id));
 }
 // Global inventory observations are metadata under this actual original
 // parent. Reduce ALL entry locators, including foreign observations, without
 // deleting/adopting a single foreign physical resource or quota charge.
 const observedEntries=await tx.select().from(entries).where(inArray(entries.inventoryId,headerIds));
 for(const entry of observedEntries)if(!entry.redactedAt)await tx.update(entries).set({entry:{kind:entry.entry.kind,key:`retained:${entry.keyDigest}`,bytes:entry.entry.bytes,current:entry.entry.current},redactedAt:new Date()}).where(eq(entries.id,entry.id));
 const capturedPages=await tx.select().from(pages).where(inArray(pages.inventoryId,headerIds));
 for(const page of capturedPages)if(!page.redactedAt)await tx.update(pages).set({cursor:null,nextCursor:null,configuration:null,redactedAt:new Date()}).where(eq(pages.id,page.id));
 const headers=await tx.select().from(inventories).where(inArray(inventories.id,headerIds));
 for(const header of headers)if(!header.redactedAt)await tx.update(inventories).set({binding:{kind:header.binding.kind,namespace:header.namespace,location:{}},configuration:null,blocker:null,redactedAt:new Date(),updatedAt:new Date()}).where(eq(inventories.id,header.id));
 await tx.update(operations).set({providerUploadId:null,observedProviderUploadId:null,actor:"erased",reviewedBy:null,parts:[],updatedAt:new Date()}).where(and(eq(operations.resourceId,resourceId),inArray(operations.id,opIds)));
 // First identity/ACK/FIN, body declarations, issue proof, baseline, all
 // counts/digests, reviews and certificate bodies are intentionally retained.
 await tx.update(resources).set({key:`retained:${resource.keyDigest}`,providerUploadId:null,actor:"erased",contactId:null,storageLocation:{},reviewedBy:null,redactedAt:resource.redactedAt??new Date(),updatedAt:new Date()}).where(eq(resources.id,resourceId));
 await tx.update(mediaUploads).set({filename:"[erased]",uploadedBy:"erased",ownerContactId:null,storageKey:`retained:${resource.keyDigest}`,providerUploadId:null,provenance:{},mediaMetadata:{},failureReason:null,state:"aborted",completedAt:sql`coalesce(${mediaUploads.completedAt},transaction_timestamp())`,updatedAt:new Date()}).where(eq(mediaUploads.id,resource.uploadId));
 const[after]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_certificate_coverage(${certificate.id}::uuid) as proven`);if(after?.proven!==true)transferConflict("The complete original upload evidence changed during reduction; preserve the whole transaction for recovery.");
 return true;
}
