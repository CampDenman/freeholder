// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual physical return commits independently of domain apply.
import {randomUUID} from "node:crypto";
import {and,eq,inArray,sql} from "drizzle-orm";
import {readFile} from "node:fs/promises";
import {db} from "@/core/db";
import type {Actor,Tx} from "@/core/service";
import {actorString} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaObjects} from "./schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferReceipts,mediaStorageTransferSubjects,mediaStorageTransferReviews,type StorageTransferRevision,type STORAGE_TRANSFER_CALL_KINDS} from "./transfer-schema";
import {assertTransferCallDrain,assertTransferOwners,lockedTransfer,requireTransferCapability} from "./transfer-authority";
import {requireFinishedTransferRead,transferConflict,transferDigest,transferTargetKey} from "./transfer-proof";
import {mediaWriterRuntimeId} from "./physical-caller-runtime";
import {objectKeyDigest} from "./write-ledger";
import {captureMediaErasureCohort,originalMediaErasureRequests,reconcileMediaErasureCohorts} from "./erasure-cohorts";
import {reconcileCommittedStorageObservation} from "./observation-hooks";

import {transferCallRetryPermitted} from "./transfer-reviewed-call";
import {reserveTransferQuota} from "./transfer-quota";

type Kind=typeof STORAGE_TRANSFER_CALL_KINDS[number];
export const transferRuntimeId=randomUUID();
export async function transferRuntimeIdentity(){
 const boot=(await readFile("/proc/sys/kernel/random/boot_id","utf8")).trim();
 const text=await readFile("/proc/self/stat","utf8"),end=text.lastIndexOf(") "),startTicks=text.slice(end+2).trim().split(/\s+/)[19];
 if(!startTicks||!/^\d+$/.test(startTicks))transferConflict("The actual storage caller process identity is unavailable.");
 return{boot,pid:process.pid,startTicks};
}
export interface TransferCallAdmission {planId:string;objectId:string;kind:Kind;token:string;runtimeIdentity:{boot:string;pid:number;startTicks:string};expectedRevision?:StorageTransferRevision;physicalKey?:string}
export async function admitTransferCall(tx:Tx,input:TransferCallAdmission,actor:Actor){
 const{plan,objects}=await lockedTransfer(tx,input.planId),object=objects.find(row=>row.id===input.objectId);
 if(!object)transferConflict();
 const id=randomUUID();let physicalReceiptId:string|undefined;
 const privacy=input.kind.startsWith("privacy_")||input.kind==="target_erasure_inventory"||input.kind==="source_erasure_inventory";
 await assertTransferOwners(tx,privacy||plan.adoptedAt?[object]:objects,privacy);
 await assertTransferCallDrain(tx,[object.id]);
 if(plan.state==="complete"&&!privacy)transferConflict("This original transfer is complete. No new physical work was admitted.");
 const target=["target_probe","target_put","target_verify","target_current","privacy_read","privacy_delete","privacy_absence","target_inventory","target_erasure_inventory"].includes(input.kind);
 const binding=target?plan.originalTarget:plan.originalSource;let key=target?object.targetKey:object.key;
 if(input.physicalKey){if(!privacy||objectKeyDigest(input.physicalKey)!==(target?object.targetKeyDigest:object.keyDigest))transferConflict("The private cleanup witness does not identify this exact original physical key.");key=input.physicalKey;}
 if(input.kind==="target_put"){
  if(!["planned","copying"].includes(plan.state)||!["planned","copying"].includes(object.state))transferConflict();
  const previous=await tx.select().from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.objectId,object.id),eq(mediaStorageTransferCalls.kind,"target_put")));
  const reviews=await tx.select().from(mediaStorageTransferReviews).where(eq(mediaStorageTransferReviews.objectId,object.id));
  if(previous.some(call=>!transferCallRetryPermitted(call,reviews))||(!previous.length&&object.targetReceiptId))transferConflict("The exact original target PUT was already admitted; reconcile it instead of sending another.");
  await reserveTransferQuota(tx,binding.namespace,key,object.bytes,id);
  const owners=await tx.select().from(mediaStorageTransferSubjects).where(eq(mediaStorageTransferSubjects.objectId,object.id));
  const[receipt]=await tx.insert(mediaObjectWrites).values({operation:"put",key,keyDigest:object.targetKeyDigest,namespace:binding.namespace,storageKind:binding.kind,storageLocation:binding.location,sha256:object.sha256,bytes:object.bytes,contentType:object.contentType,actor:actorString(actor),contactId:owners[0]?.contactId??null,state:"started",writerRuntimeId:mediaWriterRuntimeId,writerProtocol:binding.kind==="replit"?"nonresumable-put-v1":"single-put-v1"}).returning();
  physicalReceiptId=receipt!.id;
  const members=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id));
  for(const original of await originalMediaErasureRequests(tx,members.map(row=>row.receiptId)))await captureMediaErasureCohort(tx,original.requestId,original.scope as "media.storageOperations"|"media.multipartOperations",[receipt!.id]);
  await tx.insert(mediaObjects).values({key,role:"staged",state:"pending",bytes:object.bytes,contentType:object.contentType,ownerContactId:owners[0]?.contactId??null}).onConflictDoNothing();
  await tx.update(mediaStorageTransferObjects).set({targetReceiptId:receipt!.id,state:"copying",updatedAt:new Date()}).where(eq(mediaStorageTransferObjects.id,object.id));
 }
 if(input.kind==="source_delete"){
  if(!plan.adoptedAt||!["adopted","cleanup_pending"].includes(object.state)||!object.sourceRevision||transferDigest(input.expectedRevision)!==transferDigest(object.sourceRevision))transferConflict();
  const calls=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id));
  const reviews=await tx.select().from(mediaStorageTransferReviews).where(eq(mediaStorageTransferReviews.objectId,object.id));
  if(calls.some(row=>row.kind==="source_delete"&&!transferCallRetryPermitted(row,reviews)))transferConflict("The original source DELETE was already admitted; reconcile its exact receipt.");
  const current=calls.filter(row=>row.kind==="target_current").sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()).at(-1);
  const targetRevision=requireFinishedTransferRead(current,plan.originalTarget,object.targetKey,object);
  if(transferDigest(targetRevision)!==transferDigest(object.targetRevision))transferConflict();
  const owners=await tx.select().from(mediaStorageTransferSubjects).where(eq(mediaStorageTransferSubjects.objectId,object.id));
  const[receipt]=await tx.insert(mediaObjectWrites).values({operation:"delete",key,keyDigest:object.keyDigest,namespace:binding.namespace,storageKind:binding.kind,storageLocation:binding.location,sha256:object.sha256,bytes:object.bytes,contentType:object.contentType,actor:actorString(actor),contactId:owners[0]?.contactId??null,state:"started",writerRuntimeId:mediaWriterRuntimeId}).returning();
  physicalReceiptId=receipt!.id;
  await tx.update(mediaStorageTransferObjects).set({sourceDeleteReceiptId:receipt!.id,state:"cleanup_pending",updatedAt:new Date()}).where(eq(mediaStorageTransferObjects.id,object.id));
 }
 if(input.kind==="privacy_delete"||input.kind==="privacy_source_delete"){
  if(!input.expectedRevision)transferConflict();
  const owners=await tx.select().from(mediaStorageTransferSubjects).where(eq(mediaStorageTransferSubjects.objectId,object.id));
  const[receipt]=await tx.insert(mediaObjectWrites).values({operation:"delete",key,keyDigest:target?object.targetKeyDigest:object.keyDigest,namespace:binding.namespace,storageKind:binding.kind,storageLocation:binding.location,sha256:object.sha256,bytes:object.bytes,contentType:object.contentType,actor:actorString(actor),contactId:owners[0]?.contactId??null,state:"started",writerRuntimeId:mediaWriterRuntimeId}).returning();physicalReceiptId=receipt!.id;
 }
 const requestDigest=transferDigest({planId:plan.id,objectId:object.id,kind:input.kind,binding,key,expectedRevision:input.expectedRevision??null,sha256:object.sha256,bytes:object.bytes,runtimeIdentity:input.runtimeIdentity});
 await tx.insert(mediaStorageTransferCalls).values({id,objectId:object.id,kind:input.kind,namespace:binding.namespace,physicalKey:key,requestDigest,callerTokenDigest:transferDigest(input.token),physicalReceiptId,runtimeId:transferRuntimeId,runtimeIdentity:input.runtimeIdentity,expectedRevision:input.expectedRevision});
 return{id,requestDigest,binding,key,receiptId:object.targetReceiptId};
}
export interface ActualTransferReturn {inventoryDigest?:string;inventoryCount?:number;configurationDigest?:string;notAttempted?:true;accepted?:boolean;absent?:boolean;revision?:StorageTransferRevision;sha256?:string;bytes?:number}
/** Only the actual admitted server closure retains its unexported random token. */
export async function retainTransferReturn(id:string,token:string,result:ActualTransferReturn):Promise<void>{
 let receiptId:string|null=null;
 await db().transaction(async tx=>{
  await requireTransferCapability(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
  const[call]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,id)).limit(1).for("update");
  if(!call||call.callerTokenDigest!==transferDigest(token))transferConflict("The actual original caller receipt cannot be authenticated.");
  if(call.returnedAt&&call.resultDigest===transferDigest(result))return;
  if(call.resultDigest&&call.resultDigest!==transferDigest(result))transferConflict("A later physical fact cannot replace the original returned result; review its append-only observation.");
  if(call.state==="returned"){
   if(call.resultDigest!==transferDigest(result))transferConflict("A physical caller cannot return two different outcomes.");
   return;
  }
  const[object]=await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.id,call.objectId)).limit(1).for("update");
  if(!object)transferConflict();
  const now=new Date(),late=call.state==="stopped"||Boolean(call.stoppedAt)||Boolean(object.redactedAt);
  await tx.update(mediaStorageTransferCalls).set({state:late?"unknown":"returned",returnedAt:call.returnedAt??now,resultDigest:transferDigest(result),resultRevision:result.revision??null,resultSha256:result.sha256??null,resultBytes:result.bytes??null,resultAbsent:result.absent?now:null,...(result.accepted&&!call.observedAcceptedAt?{observedAcceptedAt:now}:{}),updatedAt:now}).where(eq(mediaStorageTransferCalls.id,id));
  if(["source_delete","privacy_delete","privacy_source_delete"].includes(call.kind)&&call.physicalReceiptId){
   receiptId=call.physicalReceiptId;
   const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1).for("update");if(!receipt)transferConflict();
   await tx.update(mediaObjectWrites).set({state:result.notAttempted?"confirmed_absent":"unknown",writerFinishedAt:receipt.writerFinishedAt??call.returnedAt??now,...(result.notAttempted?{deletedAt:now}:{}),...(result.accepted&&!receipt.observedAcceptedAt?{observedAcceptedAt:now}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,call.physicalReceiptId));
  }
  if(call.kind==="target_put"&&call.physicalReceiptId){
   receiptId=call.physicalReceiptId;
   const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,receiptId)).limit(1).for("update");
   if(!receipt)transferConflict();
   // A contradictory late positive fact revokes physical retirement; it never
   // reconstructs identity or replaces the original erasure membership.
   const resurrected=Boolean(result.accepted&&(late||receipt.redactedAt));
   await tx.update(mediaObjectWrites).set({state:resurrected?"unknown":result.notAttempted?"confirmed_absent":"accepted",...(result.notAttempted?{deletedAt:now}:{}),writerFinishedAt:receipt.writerFinishedAt??now,...(result.accepted&&!receipt.observedAcceptedAt?{observedAcceptedAt:now}:{}),...(resurrected?{deletedAt:null}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,receiptId));
   if(resurrected){
    const physicalKey=transferTargetKey(object.planId,object.keyDigest);
    await tx.insert(mediaObjects).values({key:physicalKey,role:"staged",state:"pending",bytes:object.bytes,contentType:object.contentType}).onConflictDoNothing();
    const members=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id));
    if(members.length)await tx.update(mediaObjectWrites).set({deletedAt:null,updatedAt:now}).where(inArray(mediaObjectWrites.id,members.map(row=>row.receiptId)));
   }
  }
 });
 if(receiptId){
  await reconcileMediaErasureCohorts({objectReceiptId:receiptId}).catch(()=>{});
  await reconcileCommittedStorageObservation(receiptId);
 }
}
export async function retainTransferFailure(id:string,token:string,accepted=false):Promise<void>{
 await db().transaction(async tx=>{
  await requireTransferCapability(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
  const[call]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,id)).limit(1).for("update");
  if(!call||call.callerTokenDigest!==transferDigest(token))transferConflict();
  if(call.state==="returned")return;
  const now=new Date();
  const write=["target_put","source_delete","privacy_delete","privacy_source_delete"].includes(call.kind),drained=await(await import("./transfer-requests")).transferRequestsDrained(tx,[call.id]);
  await tx.update(mediaStorageTransferCalls).set({state:write||!drained?"unknown":"returned",...(!write&&drained?{resultDigest:transferDigest({failed:true})}:{}),returnedAt:call.returnedAt??now,...(accepted&&!call.observedAcceptedAt?{observedAcceptedAt:now}:{}),updatedAt:now}).where(eq(mediaStorageTransferCalls.id,id));
  if(call.kind==="target_put"){
   if(call.physicalReceiptId){const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1);if(receipt)await tx.update(mediaObjectWrites).set({state:"unknown",writerFinishedAt:receipt.writerFinishedAt??now,...(accepted&&!receipt.observedAcceptedAt?{observedAcceptedAt:now}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,call.physicalReceiptId));}
  }
 });
}
