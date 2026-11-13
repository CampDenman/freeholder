// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First membership is immutable. Late actual descendants follow original
// reservation/caller lineage; current contact+equal key never adds a member.
import {z} from "zod";
import {and,asc,eq,inArray,isNotNull,ne,or} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {erasureArtifactIsIntact} from "@/core/privacy/service";
import {dataRequestArtifacts,dataRequests} from "@/core/privacy/schema";
import {mediaObjects,mediaUploads} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartResources} from "./multipart-schema";
import {mediaErasureCohorts,mediaOriginalErasureScopes,type OriginalMediaErasureMembership} from "./erasure-schema";
import {lockTransferInventory} from "./transfer-authority";
import {transferConflict,transferDigest} from "./transfer-proof";
import {firstOriginalMediaMembership,intactOriginalMediaMembership,originalMediaBirthDebt,originalMediaReservationCaptured} from "./original-erasure-proof";
import {mediaStorageTransferCalls,mediaStorageTransferReceipts} from "./transfer-schema";
export type OriginalMediaScope="media.storageOperations"|"media.multipartOperations";
const unique=(ids:string[])=>[...new Set(ids)];
async function priorAuthority(tx:Tx,requestId:string,contactId:string,scope:OriginalMediaScope){
 const priorRequests=await tx.select().from(dataRequests).where(and(eq(dataRequests.contactId,contactId),eq(dataRequests.kind,"erasure"),isNotNull(dataRequests.verifiedAt),ne(dataRequests.id,requestId))).orderBy(asc(dataRequests.id)).limit(10001);
 if(priorRequests.length>10000)transferConflict("The complete original request ancestry exceeds this bounded proof. No subset can replace the first media capture.");
 const ids=priorRequests.map(row=>row.id),headers=ids.length?await tx.select().from(mediaOriginalErasureScopes).where(and(inArray(mediaOriginalErasureScopes.requestId,ids),eq(mediaOriginalErasureScopes.scope,scope))):[],cohorts=ids.length?await tx.select().from(mediaErasureCohorts).where(and(inArray(mediaErasureCohorts.requestId,ids),eq(mediaErasureCohorts.scope,scope))):[],artifacts=ids.length?await tx.select().from(dataRequestArtifacts).where(inArray(dataRequestArtifacts.dataRequestId,ids)):[];
 const artifactIds:string[]=[],receiptIds:string[]=[],resourceIds:string[]=[],uploadIds:string[]=[],reservationIds:string[]=[],legacyScopes:OriginalMediaErasureMembership["legacyScopes"]=[];
 for(const request of priorRequests){
  const header=headers.find(row=>row.requestId===request.id),members=cohorts.filter(row=>row.requestId===request.id),artifact=artifacts.find(row=>row.dataRequestId===request.id);
  if(header){if(!header.complete)transferConflict("Restore the incomplete original prior media capture.");const first=intactOriginalMediaMembership(header.membership,header.captureDigest);receiptIds.push(...first.receipts.map(row=>row.id));resourceIds.push(...first.resources.map(row=>row.id));uploadIds.push(...first.uploads.map(row=>row.id));reservationIds.push(...first.reservations.map(row=>row.id));legacyScopes.push(...first.legacyScopes);}
  if(artifact&&!erasureArtifactIsIntact(artifact))transferConflict("Restore the intact original prior erasure receipt before using its captured media membership.");
  const parsed= z.object({outcomes:z.array(z.object({scope:z.string()}))}).safeParse(artifact?.body),known=parsed.success&&parsed.data.outcomes.some(outcome=>outcome.scope===scope);
  if(artifact&&(header||members.length||known))artifactIds.push(artifact.id);
  if(!header&&(members.length||known))legacyScopes.push({requestId:request.id,scope,artifactDigest:artifact?.sha256??null});
  // Exact old captured IDs remain evidence, with missing legacy first-capture
  // completeness represented as debt. No lookup by a restored current key.
  receiptIds.push(...members.flatMap(row=>row.objectReceiptId?[row.objectReceiptId]:[]));resourceIds.push(...members.flatMap(row=>row.multipartResourceId?[row.multipartResourceId]:[]));
 }
 const seen=new Map<string,OriginalMediaErasureMembership["legacyScopes"][number]>();for(const row of legacyScopes){const key=`${row.requestId}:${row.scope}`,previous=seen.get(key);if(previous&&previous.artifactDigest!==row.artifactDigest)transferConflict("The original legacy scope receipts conflict.");seen.set(key,row);}
 return{receiptIds:unique(receiptIds),resourceIds:unique(resourceIds),uploadIds:unique(uploadIds),reservationIds:unique(reservationIds),legacyScopes:[...seen.values()],artifactIds:unique(artifactIds)};
}
export async function captureFirstOriginalMediaScope(tx:Tx,requestId:string,contactId:string,scope:OriginalMediaScope){
 await lockTransferInventory(tx);
 const[request]=await tx.select().from(dataRequests).where(eq(dataRequests.id,requestId)).limit(1);
 if(!request||request.kind!=="erasure"||request.contactId!==contactId)transferConflict("The original media capture needs its actual owning erasure request.");
 const[prior]=await tx.select().from(mediaOriginalErasureScopes).where(and(eq(mediaOriginalErasureScopes.requestId,requestId),eq(mediaOriginalErasureScopes.scope,scope))).limit(1).for("update");
 if(prior){if(!prior.complete)transferConflict("Restore the incomplete first original media scope; current rows cannot fill it.");return{header:prior,membership:intactOriginalMediaMembership(prior.membership,prior.captureDigest)};}
 const oldMembers=await tx.select({id:mediaErasureCohorts.id}).from(mediaErasureCohorts).where(and(eq(mediaErasureCohorts.requestId,requestId),eq(mediaErasureCohorts.scope,scope))).limit(1),[oldArtifact]=await tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,requestId)).limit(1);
 if(oldMembers.length||oldArtifact)transferConflict("This earlier request has no complete first media scope. Keep its original evidence and use a separately verified new request; do not backfill an old empty/nonempty capture.");
 const authority=await priorAuthority(tx,requestId,contactId,scope);
 const receipts=await tx.select().from(mediaObjectWrites).where(or(eq(mediaObjectWrites.contactId,contactId),authority.receiptIds.length?inArray(mediaObjectWrites.id,authority.receiptIds):undefined)).orderBy(asc(mediaObjectWrites.id)).limit(10001);
 if(authority.receiptIds.some(id=>!receipts.some(row=>row.id===id)))transferConflict("An exact prior original media receipt is missing.");
 const receiptIds=receipts.map(row=>row.id),resources=scope==="media.multipartOperations"||authority.resourceIds.length||receiptIds.length?await tx.select().from(mediaMultipartResources).where(or(scope==="media.multipartOperations"?eq(mediaMultipartResources.contactId,contactId):undefined,authority.resourceIds.length?inArray(mediaMultipartResources.id,authority.resourceIds):undefined,receiptIds.length?inArray(mediaMultipartResources.objectReceiptId,receiptIds):undefined)).orderBy(asc(mediaMultipartResources.id)).limit(10001):[];
 const uploads=scope==="media.multipartOperations"?await tx.select().from(mediaUploads).where(or(eq(mediaUploads.ownerContactId,contactId),authority.uploadIds.length?inArray(mediaUploads.id,authority.uploadIds):undefined)).orderBy(asc(mediaUploads.id)).limit(10001):[];
 const reservations=scope==="media.multipartOperations"?await tx.select().from(mediaObjects).where(or(eq(mediaObjects.ownerContactId,contactId),authority.reservationIds.length?inArray(mediaObjects.reservationId,authority.reservationIds):undefined)).orderBy(asc(mediaObjects.key)).limit(10001):[];
 if(resources.length>10000||receipts.length>10000||uploads.length>10000||reservations.length>10000)transferConflict("The complete original media scope exceeds its bounded capture. No subset may be acknowledged.");
 if(authority.resourceIds.some(id=>!resources.some(row=>row.id===id)))transferConflict("Restore the exact original multipart/upload scope membership.");
 const membership=firstOriginalMediaMembership({receipts,resources,uploads,reservations,legacyScopes:authority.legacyScopes}),captureDigest=transferDigest(membership);
 const[header]=await tx.insert(mediaOriginalErasureScopes).values({requestId,scope,membership,captureDigest,complete:false}).returning();
 if(receipts.length)await tx.insert(mediaErasureCohorts).values(receipts.map(row=>({requestId,scope,objectReceiptId:row.id}))).onConflictDoNothing();
 if(resources.length)await tx.insert(mediaErasureCohorts).values(resources.map(row=>({requestId,scope,multipartResourceId:row.id}))).onConflictDoNothing();
 const[completed]=await tx.update(mediaOriginalErasureScopes).set({complete:true}).where(and(eq(mediaOriginalErasureScopes.requestId,requestId),eq(mediaOriginalErasureScopes.scope,scope))).returning();if(!header||!completed)transferConflict();return{header:completed,membership};
}
export async function originalMediaScope(tx:Tx,requestId:string,scope:OriginalMediaScope){
 const[header]=await tx.select().from(mediaOriginalErasureScopes).where(and(eq(mediaOriginalErasureScopes.requestId,requestId),eq(mediaOriginalErasureScopes.scope,scope))).limit(1);
 if(!header?.complete)transferConflict("Restore the complete original media membership before any worker/provider action.");return{header,membership:intactOriginalMediaMembership(header.membership,header.captureDigest)};
}
export async function originalMediaDescendant(tx:Tx,first:OriginalMediaErasureMembership,input:{receiptId?:string;resourceId?:string}):Promise<boolean>{
 if(input.resourceId){return first.resources.some(row=>row.id===input.resourceId);}
 if(!input.receiptId)return false;const pending=[input.receiptId],visited=new Set<string>();
 while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);if(visited.size>10000)transferConflict("The complete original copy ancestry exceeds this bounded proof.");
  if(first.receipts.some(row=>row.id===id))return true;
  const[row]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,id)).limit(1);if(!row)continue;if(row.originalReservationId&&originalMediaReservationCaptured(first,row.originalReservationId))return true;
  const targetCalls=await tx.select({objectId:mediaStorageTransferCalls.objectId}).from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.physicalReceiptId,id),eq(mediaStorageTransferCalls.kind,"target_put"))),objectIds=targetCalls.flatMap(call=>call.objectId?[call.objectId]:[]);if(!objectIds.length)continue;
  const members=await tx.select().from(mediaStorageTransferReceipts).where(inArray(mediaStorageTransferReceipts.objectId,objectIds));for(const member of members){if(transferDigest(member.originalSnapshot)!==member.originalSnapshotDigest)transferConflict("Restore the immutable original copy lineage capture.");pending.push(member.receiptId);}
 }
 return false;
}
export async function originalMediaScopeMembers(tx:Tx,requestId:string,scope:OriginalMediaScope){
 const first=await originalMediaScope(tx,requestId,scope),cohorts=await tx.select().from(mediaErasureCohorts).where(and(eq(mediaErasureCohorts.requestId,requestId),eq(mediaErasureCohorts.scope,scope))).orderBy(asc(mediaErasureCohorts.id));
 for(const row of cohorts)if(!await originalMediaDescendant(tx,first.membership,{receiptId:row.objectReceiptId??undefined,resourceId:row.multipartResourceId??undefined}))transferConflict("An uncaptured current generation cannot be attached to the first original erasure scope.");
 return{...first,receiptIds:unique([...first.membership.receipts.map(row=>row.id),...cohorts.flatMap(row=>row.objectReceiptId?[row.objectReceiptId]:[])]),resourceIds:unique([...first.membership.resources.map(row=>row.id),...cohorts.flatMap(row=>row.multipartResourceId?[row.multipartResourceId]:[])]),birthDebt:originalMediaBirthDebt(first.membership)};
}
export async function retainedOriginalMediaArtifacts(tx:Tx,contactId:string,requestId:string,scope:OriginalMediaScope){return(await priorAuthority(tx,requestId,contactId,scope)).artifactIds;}

export async function originalMediaScopeForeign(tx:Tx,requestId:string,scope:OriginalMediaScope,contactId:string):Promise<boolean>{
 const first=await originalMediaScopeMembers(tx,requestId,scope),receipts=await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(eq(mediaObjectWrites.contactId,contactId));
 if(receipts.some(row=>!first.receiptIds.includes(row.id)))return true;
 if(scope==="media.storageOperations")return false;
 const resources=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(eq(mediaMultipartResources.contactId,contactId)),uploads=await tx.select({id:mediaUploads.id}).from(mediaUploads).where(eq(mediaUploads.ownerContactId,contactId)),pointers=await tx.select({id:mediaObjects.reservationId}).from(mediaObjects).where(eq(mediaObjects.ownerContactId,contactId));
 return resources.some(row=>!first.resourceIds.includes(row.id))||uploads.some(row=>!first.membership.uploads.some(original=>original.id===row.id))||pointers.some(row=>!row.id||!originalMediaReservationCaptured(first.membership,row.id));
}
export async function originalMediaScopePending(tx:Tx,requestId:string,scope:OriginalMediaScope,contactId:string):Promise<boolean>{
 const first=await originalMediaScopeMembers(tx,requestId,scope);if(first.birthDebt||await originalMediaScopeForeign(tx,requestId,scope,contactId))return true;
 const receipts=first.receiptIds.length?await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,first.receiptIds)):[],resources=first.resourceIds.length?await tx.select().from(mediaMultipartResources).where(inArray(mediaMultipartResources.id,first.resourceIds)):[];
 if(receipts.length!==first.receiptIds.length||resources.length!==first.resourceIds.length)transferConflict("Restore missing original physical receipts before acknowledging their immutable scope.");
 if(receipts.some(row=>!row.redactedAt||!row.deletedAt||["unverified","started","unknown"].includes(row.state))||resources.some(row=>!row.redactedAt||!row.retiredAt||row.providerUploadId!==null||!["completed","aborted"].includes(row.state)))return true;
 if(scope==="media.multipartOperations"){
  const ids=first.membership.uploads.map(row=>row.id),uploads=ids.length?await tx.select().from(mediaUploads).where(inArray(mediaUploads.id,ids)):[],reservationIds=unique([...first.membership.reservations.map(row=>row.id),...first.membership.receipts.flatMap(row=>row.reservationId?[row.reservationId]:[]),...first.membership.resources.flatMap(row=>row.reservationId?[row.reservationId]:[])]);
  const pointers=reservationIds.length?await tx.select({id:mediaObjects.reservationId}).from(mediaObjects).where(inArray(mediaObjects.reservationId,reservationIds)).limit(1):[];
  if(pointers.length||uploads.some(row=>row.ownerContactId!==null||row.uploadedBy!=="erased"||row.filename!=="[erased]"))return true;
 }
 return(await import("./original-provider-privacy")).originalProviderEvidencePending(tx,{receiptIds:first.receiptIds,resourceIds:first.resourceIds});
}
