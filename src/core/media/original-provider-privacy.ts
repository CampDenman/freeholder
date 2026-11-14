// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scope follows immutable original parent FKs, never equal current keys or a
// global inventory page's coincidentally matching owner/contact information.
import {and,asc,eq,inArray,isNull,or,sql} from "drizzle-orm";
import {originalQuotaProof,originalQuotaLocatorPending} from "./original-quota-evidence";
import {dataRequests} from "@/core/privacy/schema";
import {mediaErasureCohorts} from "./erasure-schema";
import type {Tx} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferReviews as reviews} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as facts} from "./transfer-request-schema";
import {mediaStorageProviderInventories as inventories,mediaStorageProviderInventoryPages as pages,mediaStorageProviderInventoryEntries as entries} from "./transfer-inventory-schema";
import {transferConflict,transferDigest} from "./transfer-proof";
export const ORIGINAL_PROVIDER_EVIDENCE_TABLES=["media_storage_transfer_calls","media_storage_transfer_reviews","media_storage_transfer_requests","media_storage_transfer_request_observations","media_storage_provider_inventories","media_storage_provider_inventory_pages","media_storage_provider_inventory_entries","storage_quota_objects"]as const;
export interface OriginalProviderParents{receiptIds:readonly string[];resourceIds?:readonly string[]}
async function available(tx:Tx){const result=await tx.execute<{available:boolean}>(sql`select exists(select 1 from pg_attribute where attrelid=to_regclass('media_storage_transfer_calls') and attname='object_receipt_id' and not attisdropped) as available`);return result[0]?.available===true;}
async function evidence(tx:Tx,parent:OriginalProviderParents){
 if(!await available(tx))return null;
 const receiptIds=[...new Set(parent.receiptIds)],resourceIds=[...new Set(parent.resourceIds??[])];if(!receiptIds.length&&!resourceIds.length)return null;
 const originals=receiptIds.length?await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,receiptIds)):[];
 if(originals.length!==receiptIds.length)transferConflict("Restore the exact original privacy receipt membership.");
 const resources=resourceIds.length?await tx.select().from(mediaMultipartResources).where(inArray(mediaMultipartResources.id,resourceIds)):[];
 if(resources.length!==resourceIds.length)transferConflict("Restore the exact original multipart privacy membership.");
 const operations=resourceIds.length?await tx.select().from(mediaMultipartOperations).where(inArray(mediaMultipartOperations.resourceId,resourceIds)):[],operationIds=operations.map(row=>row.id);
 const callers=await tx.select().from(calls).where(and(isNull(calls.objectId),or(receiptIds.length?inArray(calls.objectReceiptId,receiptIds):undefined,operationIds.length?inArray(calls.multipartOperationId,operationIds):undefined))).orderBy(asc(calls.id)).limit(50001);
 if(callers.length>50000)transferConflict("The complete original provider caller privacy proof exceeds this bounded capture. No subset may be acknowledged.");
 const callIds=callers.map(row=>row.id),physical=callIds.length?await tx.select().from(requests).where(inArray(requests.callId,callIds)).orderBy(asc(requests.id)).limit(50001):[];
 if(physical.length>50000)transferConflict("The complete original physical request privacy proof exceeds this bounded capture.");
 const requestIds=physical.map(row=>row.id),observed=requestIds.length?await tx.select().from(facts).where(inArray(facts.requestId,requestIds)).orderBy(asc(facts.id)).limit(50001):[];
 if(observed.length>50000)transferConflict("The complete original provider observation privacy proof exceeds this bounded capture.");
 const headers=await tx.select().from(inventories).where(and(isNull(inventories.planId),or(receiptIds.length?inArray(inventories.objectReceiptId,receiptIds):undefined,operationIds.length?inArray(inventories.multipartOperationId,operationIds):undefined))).orderBy(asc(inventories.id)).limit(50001);
 if(headers.length>50000)transferConflict("The complete original provider inventory privacy proof exceeds this bounded capture.");
 const headerIds=headers.map(row=>row.id),pageProofs=headerIds.length?await tx.select().from(pages).where(inArray(pages.inventoryId,headerIds)).orderBy(asc(pages.id)).limit(50001):[];
 if(pageProofs.length>50000)transferConflict("The complete original provider page privacy proof exceeds this bounded capture.");
 const reviewRows=callIds.length?await tx.select().from(reviews).where(and(isNull(reviews.objectId),inArray(reviews.callId,callIds))).orderBy(asc(reviews.id)).limit(50001):[];
 if(reviewRows.length>50000)transferConflict("The complete original provider review privacy proof exceeds this bounded capture.");
 return{originals,resources,operations,callers,physical,observed,headers,pageProofs,reviews:reviewRows};
}
export async function originalProviderParentsForContact(tx:Tx,contactId:string):Promise<OriginalProviderParents>{
 const originals=await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(eq(mediaObjectWrites.contactId,contactId)),resources=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(eq(mediaMultipartResources.contactId,contactId));
 const captured=await tx.select({receiptId:mediaErasureCohorts.objectReceiptId,resourceId:mediaErasureCohorts.multipartResourceId}).from(mediaErasureCohorts).innerJoin(dataRequests,eq(dataRequests.id,mediaErasureCohorts.requestId)).where(eq(dataRequests.contactId,contactId));
 return{receiptIds:[...new Set([...originals.map(row=>row.id),...captured.flatMap(row=>row.receiptId?[row.receiptId]:[])])],resourceIds:[...new Set([...resources.map(row=>row.id),...captured.flatMap(row=>row.resourceId?[row.resourceId]:[])])]};
}
export function scopeOriginalProviderResources<T extends {inventoryId:string;keyDigest:string}>(observed:readonly T[],headers:readonly {id:string;originalKeyDigest:string|undefined}[]):T[]{
 const originalKeys=new Map(headers.map(row=>[row.id,row.originalKeyDigest]));
 return observed.filter(row=>originalKeys.get(row.inventoryId)===row.keyDigest);
}
export function originalObservationVersion(input:{calls:readonly {id:string;returnedAt:Date|null}[];requests:readonly {id:string;returnedAt:Date|null;observationCount:number}[];facts:readonly {id:string;requestId:string;ordinal:number;digest:string}[]}):string{
 const ordered=<T extends {id:string}>(rows:readonly T[])=>[...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return transferDigest({calls:ordered(input.calls),requests:ordered(input.requests),facts:ordered(input.facts)});
}
/** Digest-only projection of exact observed resources. A global inventory does
 * not grant this subject ownership of its other keys/versions/session IDs. */
export async function exportOriginalProviderEvidence(tx:Tx,parent:OriginalProviderParents){
 const captured=await evidence(tx,parent);if(!captured)return{callers:[],requests:[],observations:[],inventories:[],pages:[],resources:[],reviews:[],quota:[]};
 const keyDigests=new Set([...captured.originals.map(row=>row.keyDigest),...captured.resources.map(row=>row.keyDigest)]),headerIds=captured.headers.map(row=>row.id);
 const observedResources=headerIds.length?await tx.select({id:entries.id,inventoryId:entries.inventoryId,pageId:entries.pageId,ordinal:entries.ordinal,pass:entries.pass,keyDigest:entries.keyDigest,resourceDigest:entries.resourceDigest,entryDigest:entries.entryDigest,attribution:entries.attribution,createdAt:entries.createdAt}).from(entries).where(and(inArray(entries.inventoryId,headerIds),inArray(entries.keyDigest,[...keyDigests]))).orderBy(asc(entries.id)).limit(50001):[];
 if(observedResources.length>50000)transferConflict("The complete exact original resource export exceeds this bounded proof.");
 const originalHeaderKeys=captured.headers.map(header=>{const operation=captured.operations.find(row=>row.id===header.multipartOperationId);const digest=header.objectReceiptId?captured.originals.find(row=>row.id===header.objectReceiptId)?.keyDigest:operation?captured.resources.find(row=>row.id===operation.resourceId)?.keyDigest:undefined;return{id:header.id,originalKeyDigest:digest};});
 const scopedResources=scopeOriginalProviderResources(observedResources,originalHeaderKeys);
 return{
  callers:captured.callers.map(row=>({id:row.id,objectReceiptId:row.objectReceiptId,multipartOperationId:row.multipartOperationId,kind:row.kind,namespace:row.namespace,state:row.state,requestDigest:row.requestDigest,resultDigest:row.resultDigest,returnedAt:row.returnedAt,observedAcceptedAt:row.observedAcceptedAt,createdAt:row.createdAt})),
  requests:captured.physical.map(row=>({id:row.id,callId:row.callId,keyDigest:row.keyDigest,state:row.state,descriptorDigest:row.descriptorDigest,returnedAt:row.returnedAt,observationCount:row.observationCount,createdAt:row.createdAt})),
  observations:captured.observed.map(row=>({id:row.id,requestId:row.requestId,ordinal:row.ordinal,stage:row.facts.stage,status:row.facts.status,factsDigest:row.factsDigest,bytes:row.bytes,createdAt:row.createdAt})),
  inventories:captured.headers.map(row=>({id:row.id,objectReceiptId:row.objectReceiptId,multipartOperationId:row.multipartOperationId,anchorCallId:row.anchorCallId,proofCallId:row.proofCallId,originalWitness:row.originalWitness,state:row.state,purpose:row.purpose,firstDigest:row.firstDigest,confirmedDigest:row.confirmedDigest,createdAt:row.createdAt})),
  pages:captured.pageProofs.map(row=>({id:row.id,inventoryId:row.inventoryId,callId:row.callId,pass:row.pass,kind:row.kind,pageDigest:row.pageDigest,membershipDigest:row.membershipDigest,createdAt:row.createdAt})),resources:scopedResources,
  quota:await originalQuotaProof(tx,captured.callers),
  reviews:captured.reviews.map(row=>({id:row.id,callId:row.callId,readCallId:row.readCallId,inventoryId:row.inventoryId,originalCallWitness:row.originalCallWitness,outcome:row.outcome,providerEvidenceDigest:row.providerEvidenceDigest,retirementProof:row.retirementProof,createdAt:row.createdAt})),
 };
}
/** Until exact physical retirement/minimization is implemented, retained raw
 * locator/fact rows remain explicit debt even if their parent is minimized.
 * These checks do not equate returned reads with original writer quiescence. */
export async function originalProviderEvidencePending(tx:Tx,parent:OriginalProviderParents):Promise<boolean>{
 const rows=await evidence(tx,parent);if(rows&&await originalQuotaLocatorPending(tx,rows.callers))return true;return Boolean(rows&&(rows.callers.some(row=>!row.redactedAt||row.expectedRevision||row.resultRevision||["admitted","unknown"].includes(row.state))||rows.physical.some(row=>!row.redactedAt||["admitted","unknown"].includes(row.state))||rows.observed.some(row=>!row.redactedAt)||rows.headers.some(row=>!row.redactedAt)||rows.pageProofs.some(row=>!row.redactedAt&&(row.cursor!==null||row.nextCursor!==null))));
}
/** New actual immutable observations change the reopen evidence version even
 * when the first positive ACK timestamp was already recorded long ago. */
export async function originalProviderEvidenceVersion(tx:Tx,parent:OriginalProviderParents):Promise<string|null>{
 const rows=await evidence(tx,parent);if(!rows||!rows.callers.length&&!rows.physical.length&&!rows.observed.length)return null;return originalObservationVersion({calls:rows.callers.map(row=>({id:row.id,returnedAt:row.returnedAt})),requests:rows.physical.map(row=>({id:row.id,returnedAt:row.returnedAt,observationCount:row.observationCount})),facts:rows.observed.map(row=>({id:row.id,requestId:row.requestId,ordinal:row.ordinal,digest:row.factsDigest}))});
}
