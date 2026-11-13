// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: complete first capture, exact physical lineage and schema gate.
import {and,asc,eq,inArray,isNull,sql} from "drizzle-orm";
import type {StorageBinding} from "@/adapters/storage/types";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {actorString,type Actor,type Tx} from "@/core/service";
import {mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartResources} from "./multipart-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferReceipts,mediaStorageTransferSubjects,mediaStorageWriterDrains} from "./transfer-schema";
import {allowMediaReceiptWrites,lockObjectDigest,objectKeyDigest,storageOperationsHeld} from "./write-ledger";
import {originalTransferObject,transferInventoryDigest} from "./transfer-witness";
import {assertOriginalUploadWritable} from "./upload-ownership";
import {requireCompleteTransferInventory,requireNoOutstandingTransferCalls,transferConflict,transferDigest,transferTargetKey} from "./transfer-proof";

export async function transferSchemaAvailable(tx:Tx):Promise<boolean>{
 const rows=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_capability_v1()') is not null and to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);
 return rows[0]?.present===true;
}
export async function requireTransferCapability(tx:Tx):Promise<void>{
 if(!await transferSchemaAvailable(tx))transferConflict("Verified storage transfer is unavailable until its complete guarded migration is applied.");
 const rows=await tx.execute<{capability:string}>(sql`select freeholder_media_transfer_capability_v1() as capability`);
 if(rows[0]?.capability!=="verified-original-transfer-v1")transferConflict();
 const requestCapability=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_request_capability_v1()') is not null as present`);
 if(requestCapability[0]?.present!==true)transferConflict("Apply the complete original request/inventory capability before storage transfer I/O.");
 const verifiedRequestCapability=await tx.execute<{capability:string}>(sql`select freeholder_media_transfer_request_capability_v1() as capability`);
 if(verifiedRequestCapability[0]?.capability!=="verified-original-request-inventory-v1")transferConflict("The exact original request/inventory capability is unavailable.");
 await tx.execute(sql`select set_config('freeholder.media_transfer_v1','1',true)`);
 await allowMediaReceiptWrites(tx);
}
export async function lockTransferInventory(tx:Tx):Promise<void>{
 await lockContactIdentityForRead(tx);
 await requireTransferCapability(tx);
 await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
}
export async function originalTransferInventory(tx:Tx,source:StorageBinding){
 const reservations=await tx.select().from(mediaObjects).orderBy(asc(mediaObjects.key)).limit(10_001);
 const live=await tx.select().from(mediaObjectWrites).where(isNull(mediaObjectWrites.deletedAt)).orderBy(asc(mediaObjectWrites.id)).limit(10_001);
 if(reservations.length>10_000||live.length>10_000)transferConflict("The complete storage inventory exceeds this bounded transfer. No subset may be adopted.");
 if(live.some(row=>row.namespace!==source.namespace||row.redactedAt||row.state!=="accepted"||row.operation!=="put"))transferConflict("Every original namespace and physical caller must be recovered before a complete transfer.");
 const keys=[...new Set([...reservations.map(row=>row.key),...live.map(row=>row.key)])].sort((a,b)=>objectKeyDigest(a)<objectKeyDigest(b)?-1:1);
 if(!keys.length)transferConflict("There are no proven original objects to transfer.");
 for(const key of keys)await lockObjectDigest(tx,objectKeyDigest(key));
 const multipart=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(isNull(mediaMultipartResources.retiredAt)).limit(1);
 if(multipart.length)transferConflict("Finish or recover every original multipart caller before transferring storage.");
 const objects=[];
 let receiptBudget=100_000;
 for(const key of keys){
  const history=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,objectKeyDigest(key))).orderBy(asc(mediaObjectWrites.id)).limit(receiptBudget+1);
  if(history.length>receiptBudget)transferConflict("The complete original receipt inventory exceeds the bounded transfer.");
  receiptBudget-=history.length;
  const object=originalTransferObject(source,key,history);
  if(await storageOperationsHeld(tx,history.map(row=>row.contactId)))transferConflict("A named hold preserves an original object or its copies.");
  for(const id of object.contactIds)await assertOriginalUploadWritable(tx,id,null);
  objects.push(object);
 }
 return objects;
}
export async function claimOriginalTransfer(tx:Tx,input:{id:string;requestKey:string;drainId?:string;source:StorageBinding;target:StorageBinding},actor:Actor){
 await lockTransferInventory(tx);
 const[prior]=await tx.select().from(mediaStorageTransferPlans).where(eq(mediaStorageTransferPlans.requestKey,input.requestKey)).limit(1).for("update");
 if(prior){
  if(prior.sourceDrainId!==(input.drainId??null)||transferDigest(prior.originalSource)!==transferDigest(input.source)||transferDigest(prior.originalTarget)!==transferDigest(input.target))transferConflict("The immutable first transfer claim has different original resources.");
  return prior;
 }
 const[drain]=input.drainId?await tx.select().from(mediaStorageWriterDrains).where(eq(mediaStorageWriterDrains.id,input.drainId)).limit(1).for("update"):[];
 if(input.drainId&&(!drain||drain.state!=="verified"||drain.namespace!==input.source.namespace||!drain.stopProofDigest||!drain.verifiedAt))transferConflict("The original writer processes need an actual verified stop witness before transfer.");
 const active=await tx.select({id:mediaStorageTransferPlans.id}).from(mediaStorageTransferPlans).where(inArray(mediaStorageTransferPlans.state,["planned","copying","unknown","verified","adopted","cleanup_pending","blocked"])).limit(1);
 if(active.length)transferConflict("Finish the existing original transfer before claiming another inventory.");
 const inventory=await originalTransferInventory(tx,input.source),manifestDigest=transferInventoryDigest(input.source,input.target,inventory);
 const births=await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,inventory.flatMap(row=>row.receipts.map(receipt=>receipt.id)))).orderBy(asc(mediaObjectWrites.id));
 if(births.some(row=>row.writerRuntimeId&&!row.writerFinishedAt))transferConflict("A known tracked original caller still lacks its actual finish; another legacy process receipt cannot stand in for it.");
 if(!drain&&births.some(row=>!row.writerRuntimeId||!row.writerFinishedAt))transferConflict("Historical or untracked writers require their exact executor stop witness; new fully tracked cohorts do not require Linux.");
 const sourceStopEvidenceDigest=drain?.stopProofDigest??transferDigest(births.map(row=>({id:row.id,runtimeId:row.writerRuntimeId,finishedAt:row.writerFinishedAt})));
 const totalBytes=inventory.reduce((sum,row)=>sum+BigInt(row.bytes),0n);
 if(totalBytes>BigInt(Number.MAX_SAFE_INTEGER))transferConflict("The complete original inventory exceeds exact byte accounting limits.");
 const[plan]=await tx.insert(mediaStorageTransferPlans).values({id:input.id,requestKey:input.requestKey,sourceDrainId:drain?.id,originalSource:input.source,originalTarget:input.target,sourceNamespace:input.source.namespace,targetNamespace:input.target.namespace,sourceStopEvidenceDigest,inventoryCount:inventory.length,inventoryBytes:Number(totalBytes),manifestDigest,state:"planned",createdBy:actorString(actor)}).returning();
 for(const item of inventory){
  const targetKey=transferTargetKey(plan!.id,item.keyDigest);
  const[object]=await tx.insert(mediaStorageTransferObjects).values({planId:plan!.id,key:item.key,keyDigest:item.keyDigest,targetKey,targetKeyDigest:objectKeyDigest(targetKey),sha256:item.sha256,bytes:item.bytes,contentType:item.contentType,originalReceiptSetDigest:item.receiptSetDigest,state:"planned"}).returning();
  const originalRows=await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,item.receipts.map(row=>row.id)));
  await tx.insert(mediaStorageTransferReceipts).values(item.receipts.map(row=>{const snapshot=originalRows.find(original=>original.id===row.id);if(!snapshot)transferConflict();return{objectId:object!.id,receiptId:row.id,originalWitnessDigest:row.witnessDigest,originalSnapshot:{...snapshot},originalSnapshotDigest:transferDigest(snapshot)};}));
  if(item.contactIds.length)await tx.insert(mediaStorageTransferSubjects).values(item.contactIds.map(contactId=>({objectId:object!.id,contactId})));
 }
 return plan!;
}
export async function lockedTransfer(tx:Tx,id:string){
 await lockTransferInventory(tx);
 const[plan]=await tx.select().from(mediaStorageTransferPlans).where(eq(mediaStorageTransferPlans.id,id)).limit(1).for("update");
 if(!plan)transferConflict("The immutable original transfer plan is unavailable. Restore its exact backup.");
 const objects=await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.planId,id)).orderBy(asc(mediaStorageTransferObjects.keyDigest)).for("update");
 if(objects.length!==plan.inventoryCount)transferConflict("The original transfer membership is incomplete.");
 for(const object of objects)await lockObjectDigest(tx,object.keyDigest);
 return{plan,objects};
}
export async function assertTransferOwners(tx:Tx,objects:readonly {id:string}[],allowErasure=false):Promise<void>{
 const subjects=objects.length?await tx.select().from(mediaStorageTransferSubjects).where(inArray(mediaStorageTransferSubjects.objectId,objects.map(row=>row.id))):[];
 if(await storageOperationsHeld(tx,subjects.length?subjects.map(row=>row.contactId):[null]))transferConflict("A named hold preserves the original transfer and every copy.");
 if(!allowErasure)for(const subject of subjects){if(!subject.contactId)transferConflict("The original transfer subject was already minimized.");await assertOriginalUploadWritable(tx,subject.contactId,null);}
}
export async function assertTransferOriginalMembership(tx:Tx,plan:typeof mediaStorageTransferPlans.$inferSelect,objects:readonly (typeof mediaStorageTransferObjects.$inferSelect)[]):Promise<void>{
 const all=await tx.select({key:mediaObjects.key}).from(mediaObjects).orderBy(asc(mediaObjects.key)).limit(20_001);
 const live=await tx.select({key:mediaObjectWrites.key}).from(mediaObjectWrites).where(and(eq(mediaObjectWrites.namespace,plan.sourceNamespace),isNull(mediaObjectWrites.deletedAt))).orderBy(asc(mediaObjectWrites.key)).limit(20_001);
 const targets=new Set(objects.map(row=>row.targetKey));
 requireCompleteTransferInventory(objects.map(row=>row.key),[...new Set([...all.map(row=>row.key),...live.map(row=>row.key)].filter(key=>!targets.has(key)))]);
 for(const object of objects){
  const membership=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id)).orderBy(asc(mediaStorageTransferReceipts.receiptId));
  const history=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,object.keyDigest)).orderBy(asc(mediaObjectWrites.id));
  if(history.length!==membership.length||history.some(row=>!membership.some(member=>member.receiptId===row.id)))transferConflict("The complete original receipt membership changed after capture.");
  const subjects=await tx.select().from(mediaStorageTransferSubjects).where(eq(mediaStorageTransferSubjects.objectId,object.id));
  for(const row of history){
   const member=membership.find(value=>value.receiptId===row.id)!;
   if(transferDigest(member.originalSnapshot)!==member.originalSnapshotDigest)transferConflict("Restore the intact original transfer receipt snapshot.");
   const immutable=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=="contactId"));
   if(transferDigest(immutable({...row}))!==transferDigest(immutable(member.originalSnapshot))||
    (member.originalSnapshot.contactId===null?row.contactId!==null:!row.contactId||!subjects.some(subject=>subject.contactId===row.contactId)))transferConflict("An original physical fact changed after capture; current ownership alone cannot replace it.");
  }
 }
}
export async function assertTransferCallDrain(tx:Tx,ids:string[]):Promise<void>{
 const calls=ids.length?await tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,ids)):[];
 requireNoOutstandingTransferCalls(calls);
 if(!await(await import("./transfer-requests")).transferRequestsDrained(tx,calls.map(row=>row.id)))transferConflict("An original physical provider subrequest remains unresolved.");
}
