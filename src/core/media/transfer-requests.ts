// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual server scopes journal every object-provider request.
import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {TransferRequestDescriptor,TransferRequestObservation,TransferRequestObserver} from "../../../scripts/media-transfer.mjs";
import {db} from "@/core/db";
import type {Tx} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferReceipts} from "./transfer-schema";
import {mediaObjects} from "./schema";
import {reconcileMediaErasureCohorts} from "./erasure-cohorts";
import {reconcileCommittedStorageObservation} from "./observation-hooks";
import {objectKeyDigest} from "./write-ledger";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";
import {requireTransferCapability} from "./transfer-authority";
import {transferConflict,transferDigest,transferTargetKey} from "./transfer-proof";
import {checkStorageTransferJob} from "./transfer-job-scope";
interface Scope {callId:string;token:string;runtimeIdentity:{boot:string;pid:number;startTicks:string};active:boolean;receiptIds:Set<string>}
const invocation=new AsyncLocalStorage<Scope>();
export class TransferRequestNotAttemptedError extends Error{constructor(readonly logicalCallId:string,cause:unknown){super("The original provider request was not attempted.",{cause});this.name="TransferRequestNotAttemptedError";}}
export async function withTransferRequestScope<T>(scope:Omit<Scope,"active"|"receiptIds">,operation:()=>Promise<T>):Promise<T>{const current={...scope,active:true,receiptIds:new Set<string>()};try{return await invocation.run(current,operation);}finally{current.active=false;}}
async function locked(tx:Tx,scope:Scope){
 await requireTransferCapability(tx);await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
 const[call]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,scope.callId)).limit(1).for("update");
 if(!call||call.callerTokenDigest!==transferDigest(scope.token) )transferConflict("The actual original provider request has no active server-held caller.");return call;
}
function mutation(descriptor:TransferRequestDescriptor){return descriptor.kind==="object.put"||descriptor.kind==="object.delete";}
async function admit(scope:Scope,descriptor:TransferRequestDescriptor,token:string){
 await checkStorageTransferJob();return db().transaction(async tx=>{
  const call=await locked(tx,scope);
  if(!scope.active||call.state!=="admitted"||descriptor.binding.namespace!==call.namespace||descriptor.key&&descriptor.key!==call.physicalKey)transferConflict("The physical request does not belong to its exact original logical caller.");
  const inventory=descriptor.kind.startsWith("inventory.")||descriptor.kind==="bucket.metadata";
  if(inventory&&!["source_inventory","target_inventory","source_retirement_inventory","target_erasure_inventory","source_erasure_inventory"].includes(call.kind))transferConflict();
  if(descriptor.expectedRevision&&descriptor.kind!=="object.body"&&(!call.expectedRevision||transferDigest(descriptor.expectedRevision)!==transferDigest(call.expectedRevision)))transferConflict("The pinned provider request differs from its exact admitted original revision.");
  if(descriptor.kind==="object.put"&&(call.kind!=="target_put"||!descriptor.createOnly||!descriptor.sha256||descriptor.bytes===undefined))transferConflict("An original target write requires its exact create-only caller.");
  if(descriptor.kind==="object.delete"&&(!["source_delete","privacy_delete","privacy_source_delete"].includes(call.kind)||!call.expectedRevision||transferDigest(descriptor.expectedRevision)!==transferDigest(call.expectedRevision)))transferConflict();
  if(descriptor.kind==="object.body"){
   if(!descriptor.expectedRevision)transferConflict();
   const previous=await tx.select({request:mediaStorageTransferRequests,observation:mediaStorageTransferRequestObservations}).from(mediaStorageTransferRequests).innerJoin(mediaStorageTransferRequestObservations,eq(mediaStorageTransferRequestObservations.requestId,mediaStorageTransferRequests.id)).where(and(eq(mediaStorageTransferRequests.callId,call.id),eq(mediaStorageTransferRequests.state,"returned"))).orderBy(asc(mediaStorageTransferRequests.createdAt));
   if(!previous.some(row=>row.request.descriptor.kind==="object.metadata"&&row.observation.facts.stage==="metadata"&&transferDigest(row.observation.facts.revision)===transferDigest(descriptor.expectedRevision)))transferConflict("The pinned body has no actual finished original metadata request.");
  }
  const id=randomUUID();await tx.insert(mediaStorageTransferRequests).values({id,callId:call.id,descriptor,keyDigest:descriptor.key?objectKeyDigest(descriptor.key):null,descriptorDigest:transferDigest(descriptor),tokenDigest:transferDigest(token),runtimeIdentity:scope.runtimeIdentity});return id;
 });
}
async function observe(scope:Scope,id:string,token:string,facts:TransferRequestObservation){
 let receiptId:string|null=null;
 await db().transaction(async tx=>{
  const call=await locked(tx,scope),[request]=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.id,id)).limit(1).for("update");
  if(!request||request.callId!==call.id||request.tokenDigest!==transferDigest(token)||request.observationCount>=16)transferConflict();
  if(facts.revision&&(facts.revision.namespace!==call.namespace||objectKeyDigest(facts.revision.key)!==request.keyDigest))transferConflict();
  const late=request.state!=="admitted"||call.state!=="admitted";
  if(late&&!["accepted","metadata","body","response"].includes(facts.stage))transferConflict("Only an actual late positive original provider fact can supersede a retired request.");
  const ordinal=request.observationCount+1;
  await tx.insert(mediaStorageTransferRequestObservations).values({requestId:id,ordinal,facts,factsDigest:transferDigest(facts),bytes:facts.bytes});
  await tx.update(mediaStorageTransferRequests).set({observationCount:ordinal,...(late?{state:"unknown" as const}:{})}).where(eq(mediaStorageTransferRequests.id,id));
  if(facts.stage==="metadata"&&facts.revision&&request.descriptor.kind==="object.put"&&call.physicalReceiptId){
   const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1).for("update");if(!receipt)transferConflict();
   const digest=transferDigest(facts.revision);if(receipt.providerRevisionDigest&&receipt.providerRevisionDigest!==digest)transferConflict("The original target PUT revision cannot be replaced by a later current generation.");
   await tx.update(mediaObjectWrites).set({providerRevision:facts.revision,providerRevisionDigest:digest,updatedAt:new Date()}).where(eq(mediaObjectWrites.id,receipt.id));
  }
  if(facts.stage==="accepted"&&mutation(request.descriptor)){
   const now=new Date();await tx.update(mediaStorageTransferCalls).set({...(call.observedAcceptedAt?{}:{observedAcceptedAt:now}),...(late?{state:"unknown" as const}:{}),updatedAt:now}).where(eq(mediaStorageTransferCalls.id,call.id));
   if(call.physicalReceiptId){
    const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1).for("update");if(!receipt)transferConflict();receiptId=receipt.id;
    await tx.update(mediaObjectWrites).set({state:"unknown",...(receipt.observedAcceptedAt?{}:{observedAcceptedAt:now}),...(late?{deletedAt:null}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,receipt.id));
    if(late&&request.descriptor.kind==="object.put"){
     const[object]=await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.id,call.objectId)).limit(1).for("update");if(!object)transferConflict();
     await tx.insert(mediaObjects).values({key:transferTargetKey(object.planId,object.keyDigest),role:"staged",state:"pending",bytes:object.bytes,contentType:object.contentType}).onConflictDoNothing();
     const originals=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id));
     if(originals.length)await tx.update(mediaObjectWrites).set({deletedAt:null,updatedAt:now}).where(inArray(mediaObjectWrites.id,originals.map(row=>row.receiptId)));
    }
   }
  }
 });
 if(receiptId)scope.receiptIds.add(receiptId);
}
async function finish(scope:Scope,id:string,token:string,failed:boolean){
 await db().transaction(async tx=>{const call=await locked(tx,scope);const[row]=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.id,id)).limit(1).for("update");if(!row||row.tokenDigest!==transferDigest(token))transferConflict();if(row.returnedAt)return;await tx.update(mediaStorageTransferRequests).set({state:row.state==="stopped"||row.state==="unknown"&&call.state!=="admitted"?"unknown":failed?(mutation(row.descriptor)?"unknown":"failed"):"returned",returnedAt:new Date()}).where(eq(mediaStorageTransferRequests.id,id));});
}
async function reconcileRetainedRequestFacts(scope:Scope):Promise<void>{
 const ids=[...scope.receiptIds];scope.receiptIds.clear();const failures:unknown[]=[];
 for(const id of ids){try{await reconcileMediaErasureCohorts({objectReceiptId:id});}catch(error){failures.push(error);}try{await reconcileCommittedStorageObservation(id);}catch(error){failures.push(error);}}
 if(failures.length)throw new AggregateError(failures,"The original provider facts and finish are retained; dependent erasure recovery remains pending.");
}
export const observeTransferRequest:TransferRequestObserver=async(descriptor,operation)=>{
 const scope=invocation.getStore();if(!scope?.active)transferConflict("Provider requests require their actual original server-held logical caller.");
 const token=randomUUID()+randomUUID(),id=await admit(scope,descriptor,token);
 try{await checkStorageTransferJob();}catch(error){await observe(scope,id,token,{stage:"not_attempted",status:null});await finish(scope,id,token,false);throw new TransferRequestNotAttemptedError(scope.callId,error);}
 try{const result=await operation(facts=>observe(scope,id,token,facts));await finish(scope,id,token,false);await reconcileRetainedRequestFacts(scope);return result;}
 catch(error){await finish(scope,id,token,true).catch(()=>{});try{await reconcileRetainedRequestFacts(scope);}catch(recovery){throw new AggregateError([error,recovery],"The actual original request needs recovery; its retained facts were not replaced.");}throw error;}
};
export async function transferRequestsDrained(tx:Tx,callIds:string[]):Promise<boolean>{
 if(!callIds.length)return true;const rows=await tx.select({id:mediaStorageTransferRequests.id}).from(mediaStorageTransferRequests).where(and(inArray(mediaStorageTransferRequests.callId,callIds),inArray(mediaStorageTransferRequests.state,["admitted","unknown"])) ).limit(1);return rows.length===0;
}
