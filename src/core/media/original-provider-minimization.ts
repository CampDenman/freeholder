// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Raw locators minimize only after actual full original lineage retirement.
// Unattributed inventory observation locators are removed as stored metadata;
// their physical provider resources are neither adopted nor declared erased.
import {and,eq,inArray,or,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {storageQuotaObjects,storageQuotaState} from "./storage-quota-schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as facts} from "./transfer-request-schema";
import {mediaStorageProviderInventories as inventories,mediaStorageProviderInventoryPages as pages,mediaStorageProviderInventoryEntries as entries} from "./transfer-inventory-schema";
import {lockTransferInventory} from "./transfer-authority";
import {storageOperationsHeld} from "./write-ledger";
export async function minimizeOriginalProviderReservation(tx:Tx,reservationId:string|null):Promise<boolean>{
 if(!reservationId)return false;await lockTransferInventory(tx);
 const proof=await tx.execute<{retired:boolean}>(sql`select freeholder_media_original_reservation_retired(${reservationId}::uuid) as retired`);if(proof[0]?.retired!==true)return false;
 const originals=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.originalReservationId,reservationId)).for("update");
 if(!originals.length||await storageOperationsHeld(tx,originals.map(row=>row.contactId)))return false;
 const receiptIds=originals.map(row=>row.id),resources=await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.originalReservationId,reservationId)),operations=resources.length?await tx.select().from(mediaMultipartOperations).where(inArray(mediaMultipartOperations.resourceId,resources.map(row=>row.id))):[],operationIds=operations.map(row=>row.id);
 const family=await tx.select().from(calls).where(or(inArray(calls.objectReceiptId,receiptIds),inArray(calls.physicalReceiptId,receiptIds),operationIds.length?inArray(calls.multipartOperationId,operationIds):undefined)).for("update"),tokens=family.flatMap(row=>row.quotaToken?[row.quotaToken]:[]);
 // Equal-key unbound legacy inventory is debt, never deletion authority.
 for(const original of originals){
  if(!original.namespace)return false;await tx.select().from(storageQuotaState).where(eq(storageQuotaState.namespace,original.namespace)).for("update");
  const charges=await tx.select().from(storageQuotaObjects).where(and(eq(storageQuotaObjects.namespace,original.namespace),sql`encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(${storageQuotaObjects.objectKey},'UTF8')),'hex')=${original.keyDigest}`)).for("update");
  for(const charge of charges){
   if(!tokens.length||charge.pendingToken!==null&&!tokens.includes(charge.pendingToken)||charge.lastSettledToken!==null&&!tokens.includes(charge.lastSettledToken)||charge.pendingToken===null&&charge.lastSettledToken===null)return false;
   await tx.delete(storageQuotaObjects).where(and(eq(storageQuotaObjects.namespace,charge.namespace),eq(storageQuotaObjects.objectKey,charge.objectKey)));
  }
 }
 const generic=family.filter(row=>row.objectId===null),genericIds=generic.map(row=>row.id),physical=genericIds.length?await tx.select().from(requests).where(inArray(requests.callId,genericIds)):[],now=new Date();
 for(const request of physical){
  if(!request.redactedAt){const original=request.descriptor;await tx.update(requests).set({descriptor:{kind:original.kind,binding:{kind:original.binding.kind,namespace:original.binding.namespace,location:{}},...(request.keyDigest?{key:`retained:${request.keyDigest}`}:{})},redactedAt:now}).where(eq(requests.id,request.id));}
  const observed=await tx.select().from(facts).where(eq(facts.requestId,request.id));for(const fact of observed)if(!fact.redactedAt)await tx.update(facts).set({facts:{stage:fact.facts.stage,status:fact.facts.status},redactedAt:now}).where(eq(facts.id,fact.id));
 }
 const headers=await tx.select().from(inventories).where(and(sql`${inventories.planId} is null`,or(inArray(inventories.objectReceiptId,receiptIds),operationIds.length?inArray(inventories.multipartOperationId,operationIds):undefined))).for("update");
 for(const header of headers){
  const observed=await tx.select().from(entries).where(eq(entries.inventoryId,header.id));for(const entry of observed)if(!entry.redactedAt)await tx.update(entries).set({entry:{kind:entry.entry.kind,key:`retained:${entry.keyDigest}`,bytes:entry.entry.bytes,current:entry.entry.current},redactedAt:now}).where(eq(entries.id,entry.id));
  await tx.update(pages).set({cursor:null,nextCursor:null,redactedAt:now}).where(and(eq(pages.inventoryId,header.id),sql`${pages.redactedAt} is null`));
  if(!header.redactedAt)await tx.update(inventories).set({binding:{kind:header.binding.kind,namespace:header.namespace,location:{}},redactedAt:now,...(header.state==="capturing"?{state:"blocked"as const,blocker:header.blocker??"original_resource_retired"}:{}),updatedAt:now}).where(eq(inventories.id,header.id));
 }
 for(const caller of generic){
  const original=originals.find(row=>row.id===(caller.physicalReceiptId??caller.objectReceiptId)),operation=operations.find(row=>row.id===caller.multipartOperationId),resource=operation?resources.find(row=>row.id===operation.resourceId):undefined,keyDigest=original?.keyDigest??resource?.keyDigest;if(!keyDigest)return false;
  if(!caller.redactedAt||caller.expectedRevision||caller.resultRevision)await tx.update(calls).set({physicalKey:`retained:${keyDigest}`,expectedRevision:null,resultRevision:null,redactedAt:caller.redactedAt??now,updatedAt:now}).where(eq(calls.id,caller.id));
 }
 return true;
}
