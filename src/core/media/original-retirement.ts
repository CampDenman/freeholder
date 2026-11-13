// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Internal cleanup lifecycle. Provider I/O is outside transactions and always
// belongs to a newly admitted, server-held caller in the ORIGINAL resource.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray,or,sql} from "drizzle-orm";
import type {AccountedTransferStore,TransferRequestDescriptor} from "../../../scripts/media-transfer.mjs";
import {db} from "@/core/db";
import type {StorageBinding} from "@/adapters/storage/types";
import type {Tx} from "@/core/service";
import {mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartResources} from "./multipart-schema";
import {mediaStorageTransferRequestObservations,mediaStorageTransferRequests} from "./transfer-request-schema";
import {mediaStorageProviderInventories} from "./transfer-inventory-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferObjects as copies,mediaStorageTransferReceipts as members} from "./transfer-schema";
import {allowMediaReceiptWrites,lockObjectDigest,objectKeyDigest,storageOperationsHeld} from "./write-ledger";
import {lockTransferInventory} from "./transfer-authority";
import {pendingObjectIsOwned} from "./object-ledger";
import {originalInventoryLifecycle as inventory} from "./original-provider-inventory";
import {admitOriginalMediaCaller,retainOriginalMediaCallerReturn,type OriginalMediaCallerReturn} from "./provider-callers";
import {actualStorageCallerRuntimeIdentity,mediaWriterRuntimeId} from "./physical-caller-runtime";
import {transferConflict,transferDigest} from "./transfer-proof";
import {TransferRequestNotAttemptedError,transferRequestsDrained,withTransferRequestScope} from "./transfer-requests";
import {configuredOriginalRequestStore} from "./transfer-storage";
import {requireOriginalProviderRequestResult} from "./provider-request-proof";
import {captureMediaErasureCohort,originalMediaErasureRequests,reconcileMediaErasureCohorts} from "./erasure-cohorts";
import {releaseRetiredOriginalQuota} from "./original-recovery-quota";
import {originalDeleteContinuation,type EarlierOriginalDelete} from "./original-delete-continuation";
const SYSTEM={kind:"system"}as const;
type Claim={originalId:string;deleteId:string;originalCallId:string;key:string;reservationId:string};
async function earlierDeletes(tx:Tx,history:readonly(typeof mediaObjectWrites.$inferSelect)[],exceptId?:string){
 const result:Array<EarlierOriginalDelete&{objectReceiptId:string|null}>=[];
 for(const deletion of history.filter(row=>row.operation==="delete"&&row.id!==exceptId)){
  const actual=await tx.select().from(calls).where(and(eq(calls.objectReceiptId,deletion.id),eq(calls.kind,"ordinary_delete"))).limit(2);
  const call=actual[0];if(actual.length!==1||!call||!deletion.writerFinishedAt)transferConflict("Keep the exact prior caller finish; no later invocation can invent it.");
  const physical=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,call.id));
  const facts=physical.length?await tx.select().from(mediaStorageTransferRequestObservations).where(inArray(mediaStorageTransferRequestObservations.requestId,physical.map(row=>row.id))):[];
  result.push({...call,requests:physical,facts:facts.map(row=>({requestId:row.requestId,stage:row.facts.stage}))});
 }
 return result;
}
async function locked(tx:Tx,claim:Claim){
 const original=await inventory.captureFinishedPut(tx,claim.originalId),{receipt,caller}=original;
 if(receipt.originalReservationId!==claim.reservationId||receipt.key!==claim.key||caller.id!==claim.originalCallId||receipt.state!=="accepted"||!receipt.providerRevision||transferDigest(receipt.providerRevision)!==receipt.providerRevisionDigest)transferConflict("Only the intact accepted original generation with its actual provider revision can be retired.");
 const history=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,receipt.keyDigest)).orderBy(asc(mediaObjectWrites.id)).limit(1001).for("update");
 if(history.length>1000||history.some(row=>row.originalReservationId!==claim.reservationId||row.namespace!==receipt.namespace||row.redactedAt||row.id!==claim.originalId&&row.operation!=="delete")||!history.some(row=>row.id===claim.deleteId&&row.operation==="delete"))transferConflict("Conflicting or legacy original history remains debt; equal keys do not authorize another generation.");
 const prior=await earlierDeletes(tx,history,claim.deleteId);
 originalDeleteContinuation(prior);
 const pointer=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,receipt.key)).limit(1);
 if(pointer[0]&&(pointer[0].reservationId!==claim.reservationId||pointer[0].state==="attached")||await pendingObjectIsOwned(receipt.key,new Date(),tx)||await storageOperationsHeld(tx,history.map(row=>row.contactId)))transferConflict("A live owner or named hold preserves this original resource and its receipt.");
 if((await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(or(eq(mediaMultipartResources.originalReservationId,claim.reservationId),eq(mediaMultipartResources.keyDigest,receipt.keyDigest))).limit(1)).length)transferConflict("Original multipart session retirement needs its own complete protocol.");
 const transferred=await tx.select({id:members.receiptId}).from(members).where(inArray(members.receiptId,history.map(row=>row.id))).limit(1);
 const physicalCopies=await tx.select({id:copies.id}).from(copies).where(or(eq(copies.keyDigest,receipt.keyDigest),eq(copies.targetKeyDigest,receipt.keyDigest))).limit(1);
 if(transferred.length||physicalCopies.length)transferConflict("Retire every original transfer copy through the shared lineage protocol first.");
 return original;
}
/** Recheck at the actual conditional DELETE admission, under the same fence as
 * hold/identity writers. A prior logical admission alone grants no deletion. */
export async function assertOrdinaryRetirementRequest(tx:Tx,call:typeof calls.$inferSelect,descriptor:TransferRequestDescriptor):Promise<void>{
 if(call.kind!=="ordinary_delete"||descriptor.kind!=="object.delete"||!call.objectReceiptId)transferConflict();
 const[deletion]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.objectReceiptId)).limit(1);
 if(!deletion?.originalReservationId)transferConflict();
 const puts=await tx.select().from(mediaObjectWrites).where(and(eq(mediaObjectWrites.originalReservationId,deletion.originalReservationId),eq(mediaObjectWrites.operation,"put"))).limit(2);
 const put=puts[0];if(puts.length!==1||!put)transferConflict();
 const originals=await tx.select().from(calls).where(and(eq(calls.objectReceiptId,put.id),eq(calls.kind,"ordinary_put"))).limit(2);
 if(originals.length!==1||!originals[0])transferConflict();
 const original=await locked(tx,{originalId:put.id,deleteId:deletion.id,originalCallId:originals[0].id,key:put.key,reservationId:deletion.originalReservationId});
 if(transferDigest(call.expectedRevision)!==original.receipt.providerRevisionDigest||transferDigest(descriptor.expectedRevision)!==original.receipt.providerRevisionDigest)transferConflict("Conditional retirement cannot select a current replacement generation.");
 const candidates=await tx.select().from(mediaStorageProviderInventories).where(and(eq(mediaStorageProviderInventories.objectReceiptId,put.id),eq(mediaStorageProviderInventories.anchorCallId,original.caller.id),eq(mediaStorageProviderInventories.purpose,"recovery"),eq(mediaStorageProviderInventories.state,"complete"))).orderBy(asc(mediaStorageProviderInventories.createdAt)).limit(1001);
 if(candidates.length>1000)transferConflict("The bounded complete original proof history needs recovery.");
 let verified=false;
 for(const candidate of candidates){
  if(candidate.createdAt<deletion.createdAt)continue;
  const proof=await inventory.locked(tx,candidate.id);
  if(proof.actual&&proof.proof.createdAt>=deletion.createdAt&&transferDigest(proof.actual.revision)===original.receipt.providerRevisionDigest){verified=true;break;}
 }
 if(!verified)transferConflict("Fresh nonce-bound original bytes and both complete original version/session inventories must precede the actual DELETE request.");
 if((await tx.select({id:mediaStorageTransferRequests.id}).from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,call.id)).limit(1)).length)transferConflict("An actual original conditional DELETE admission cannot be repeated or hidden behind a new physical nonce.");
 const family=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.originalReservationId,deletion.originalReservationId));
 if(originalDeleteContinuation(await earlierDeletes(tx,family,deletion.id))!=="new_caller")transferConflict("An acknowledged original physical DELETE permits fresh verification only.");
}
async function capture(key:string,expectedBinding?:StorageBinding){
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity();
 return db().transaction(async tx=>{
  await lockTransferInventory(tx);await lockObjectDigest(tx,objectKeyDigest(key));await allowMediaReceiptWrites(tx);
  const history=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest,objectKeyDigest(key))).orderBy(asc(mediaObjectWrites.id)).limit(1001).for("update");
  const puts=history.filter(row=>row.operation==="put"),receipt=puts[0];
  if(puts.length!==1||!receipt?.originalReservationId||history.length>1000)transferConflict("Restore exact original caller/birth evidence; legacy or multiple physical generations remain pending.");
  if(history.every(row=>row.deletedAt)){
   const proof=await tx.execute<{retired:boolean}>(sql`select freeholder_media_original_reservation_retired(${receipt.originalReservationId}::uuid) as retired`);
   if(proof[0]?.retired!==true)transferConflict("The previous retirement has no complete physical proof.");return{done:true as const};
  }
  const original=await inventory.captureFinishedPut(tx,receipt.id);
  if(expectedBinding&&transferDigest(expectedBinding)!==transferDigest(original.binding))transferConflict("The captured cleanup resource differs from the exact original private provider binding.");
  if(receipt.state!=="accepted"||!receipt.providerRevision||transferDigest(receipt.providerRevision)!==receipt.providerRevisionDigest||original.caller.state!=="returned"||!await transferRequestsDrained(tx,[original.caller.id]))transferConflict("Recover the original finished PUT and its exact first revision before retiring it.");
  const prior=await earlierDeletes(tx,history),continuation=originalDeleteContinuation(prior);
  if(continuation==="verification_only"){
   const actual=prior.find(row=>row.observedAcceptedAt);const deletion=history.find(row=>row.id===actual?.objectReceiptId);
   if(!actual||!deletion)transferConflict("The exact acknowledged original retirement receipt is missing.");
   const claim={originalId:receipt.id,deleteId:deletion.id,originalCallId:original.caller.id,key,reservationId:receipt.originalReservationId};await locked(tx,claim);
   return{done:false as const,claim,original,deleteCall:null};
  }
  const id=randomUUID();
  await tx.insert(mediaObjectWrites).values({id,originalReservationId:receipt.originalReservationId,operation:"delete",key,keyDigest:receipt.keyDigest,namespace:receipt.namespace,storageKind:receipt.storageKind,storageLocation:receipt.storageLocation,sha256:receipt.sha256,bytes:receipt.bytes,contentType:receipt.contentType,actor:"system:media-cleanup",contactId:receipt.contactId,state:"started",writerRuntimeId:mediaWriterRuntimeId});
  const claim={originalId:receipt.id,deleteId:id,originalCallId:original.caller.id,key,reservationId:receipt.originalReservationId};await locked(tx,claim);
  const call=await admitOriginalMediaCaller(tx,{kind:"ordinary_delete",objectReceiptId:id,token,runtimeIdentity,expectedRevision:receipt.providerRevision},SYSTEM);
  for(const request of await originalMediaErasureRequests(tx,[receipt.id]))await captureMediaErasureCohort(tx,request.requestId,request.scope as "media.storageOperations"|"media.multipartOperations",[id]);
  return{done:false as const,claim,original,deleteCall:{id:call.id,token,runtimeIdentity}};
 });
}
async function physical<T>(claim:Claim,kind:"ordinary_recovery_read"|"ordinary_retirement_inventory",operation:()=>Promise<T>,outcome:(value:T)=>OriginalMediaCallerReturn){
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity();
 const call=await db().transaction(async tx=>{const original=await locked(tx,claim);return admitOriginalMediaCaller(tx,{kind,objectReceiptId:claim.originalId,token,runtimeIdentity,...(kind==="ordinary_recovery_read"?{expectedRevision:original.receipt.providerRevision!}:{})},SYSTEM);});
 let returned=false;
 try{const value=await withTransferRequestScope({callId:call.id,token,runtimeIdentity},operation),retained=await retainOriginalMediaCallerReturn(call.id,token,outcome(value));returned=true;if(!retained.settled)transferConflict("The fresh original request still needs its actual finish proof.");return{id:call.id,value};}
 catch(error){if(!returned)await retainOriginalMediaCallerReturn(call.id,token,{failed:true}).catch(()=>{});throw error;}
}
async function completeInventory(claim:Claim,store:AccountedTransferStore,proofCallId:string,purpose:"recovery"|"retirement"){
 const header=await db().transaction(async tx=>{await locked(tx,claim);return inventory.capture(tx,{receiptId:claim.originalId,originalCallId:claim.originalCallId,proofCallId},purpose);});
 for(const pass of [0,1]as const){
  const configuration=await physical(claim,"ordinary_retirement_inventory",()=>store.inventoryConfiguration(),value=>({configurationDigest:transferDigest(value)}));
  await db().transaction(async tx=>{await locked(tx,claim);return inventory.append(tx,{inventoryId:header.id,callId:configuration.id,pass,kind:"configuration",cursor:null,configuration:configuration.value});});
  for(const kind of store.binding.kind==="s3"?["objects","versions","sessions"]as const:["objects","versions","retained"]as const){
   let cursor:Record<string,string>|null=null;
   for(let page=0;;page++){
    if(page>=200)transferConflict("No truncated physical inventory can prove original retirement.");
    const actual=await physical(claim,"ordinary_retirement_inventory",()=>store.inventoryPage(kind,cursor),value=>({inventoryDigest:transferDigest(value),inventoryCount:value.entries.length}));
    await db().transaction(async tx=>{await locked(tx,claim);return inventory.append(tx,{inventoryId:header.id,callId:actual.id,pass,kind,cursor,page:actual.value});});
    cursor=actual.value.next;if(cursor===null)break;
   }
  }
 }
 return db().transaction(async tx=>{await locked(tx,claim);return inventory.finish(tx,header.id);});
}
/** Real existing cleanup callers reach this through deleteWithReceipt. A
 * returned DELETE may be verified again, but its physical dispatch is never
 * replayed. Unknown originating/retirement callers stay recovery debt. */
export async function retireOriginalMediaObject(key:string,expectedBinding?:StorageBinding):Promise<boolean>{
 if(await pendingObjectIsOwned(key))return false;
 const captured=await capture(key,expectedBinding);if(captured.done)return true;
 const{claim,original,deleteCall}=captured,revision=original.receipt.providerRevision!;
 let deleteReturned=deleteCall===null,deleteAttempted=false;
 try{
  const store=await configuredOriginalRequestStore(original.binding);
  const read=()=>physical(claim,"ordinary_recovery_read",()=>store.readVersioned(key,revision),value=>value?{accepted:true,revision:value.revision,sha256:createHash("sha256").update(value.body).digest("hex"),bytes:value.body.byteLength,requestProof:value.requestProof}:{absent:true});
  if(deleteCall){
   const before=await read();
   if(before.value){
    requireOriginalProviderRequestResult(original.write,{key,namespace:store.binding.namespace,sha256:createHash("sha256").update(before.value.body).digest("hex"),bytes:before.value.body.byteLength,revision:before.value.revision,requestProof:before.value.requestProof});
    await completeInventory(claim,store,before.id,"recovery");
    deleteAttempted=true;
    await withTransferRequestScope({callId:deleteCall.id,token:deleteCall.token,runtimeIdentity:deleteCall.runtimeIdentity},()=>store.deleteVersioned(key,revision));
    const retained=await retainOriginalMediaCallerReturn(deleteCall.id,deleteCall.token,{accepted:true});deleteReturned=true;
    if(!retained.settled)transferConflict("The actual conditional deletion needs exact recovery before retirement.");
   }else{
    await retainOriginalMediaCallerReturn(deleteCall.id,deleteCall.token,{notAttempted:true});deleteReturned=true;
   }
  }
  const absence=await read();if(absence.value)transferConflict("The original pinned physical object remains. Do not replay its earlier DELETE.");
  const complete=await completeInventory(claim,store,absence.id,"retirement");
  await db().transaction(async tx=>{
   const current=await locked(tx,claim);
   const proof=await tx.execute<{proven:boolean}>(sql`select freeholder_media_ordinary_retirement_proven(${claim.reservationId}::uuid) as proven`);if(proof[0]?.proven!==true||complete.state!=="complete")transferConflict("The complete original physical retirement proof is not intact.");
   await releaseRetiredOriginalQuota(tx,current.caller,current.receipt.bytes!);
   const now=new Date(),deletions=await tx.select().from(mediaObjectWrites).where(and(eq(mediaObjectWrites.originalReservationId,claim.reservationId),eq(mediaObjectWrites.operation,"delete")));
   for(const deletion of deletions)await tx.update(mediaObjectWrites).set({state:deletion.observedAcceptedAt?"accepted":"confirmed_absent",deletedAt:now,evidenceDigest:deletion.evidenceDigest??transferDigest({originalWitness:current.witness,absenceCallId:absence.id,inventoryId:complete.id}),updatedAt:now}).where(eq(mediaObjectWrites.id,deletion.id));
   await tx.update(mediaObjectWrites).set({deletedAt:now,updatedAt:now}).where(eq(mediaObjectWrites.id,claim.originalId));
   await tx.delete(mediaObjects).where(and(eq(mediaObjects.reservationId,claim.reservationId),eq(mediaObjects.state,"pending")));
  });
  await reconcileMediaErasureCohorts({objectReceiptId:claim.originalId});return true;
 }catch(error){
  if(deleteCall&&!deleteReturned)await retainOriginalMediaCallerReturn(deleteCall.id,deleteCall.token,deleteAttempted&&!(error instanceof TransferRequestNotAttemptedError&&error.logicalCallId===deleteCall.id)?{failed:true}:{notAttempted:true}).catch(()=>{});
  // Actual request facts/first return remain committed even if applying the
  // later inventory, hold or quota phase fails. Never erase them to retry I/O.
  throw error;
 }
}
