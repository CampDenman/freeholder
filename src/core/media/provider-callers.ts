// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: real ordinary/multipart admissions reuse the original ledger.
import {AsyncLocalStorage} from "node:async_hooks";
import type {OriginalProviderRequestProof} from "../../../scripts/media-transfer.mjs";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {db} from "@/core/db";
import type { Actor, Tx } from "@/core/service";
import { actorString } from "@/core/service";
import { mediaObjectWrites } from "./write-schema";
import { mediaMultipartOperations, mediaMultipartResources } from "./multipart-schema";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";
import { mediaStorageTransferCalls, type StorageTransferRevision } from "./transfer-schema";
import {assertOriginalKeyCreator} from "./original-key-tombstone";
import {assertOriginalNamespaceMutation} from "./original-namespace-fence";
import { requireTransferCapability } from "./transfer-authority";
import { lockObjectDigest } from "./write-ledger";
import { transferConflict, transferDigest } from "./transfer-proof";
import {requireOriginalPartWithheldAuthority} from "./multipart-part-disposition";
import {assertMediaActorLive} from "./upload-ownership";
import { actualStorageCallerRuntimeIdentity, mediaWriterRuntimeId, type CurrentStorageCallerRuntimeIdentity } from "./physical-caller-runtime";

export type OriginalMediaCallerKind="ordinary_put"|"ordinary_delete"|"multipart_create"|"multipart_complete"|"multipart_abort"|"multipart_sign";
export type OriginalMediaRecoveryKind="ordinary_recovery_read"|"multipart_recovery_inspect"|"ordinary_retirement_inventory"|"multipart_retirement_inventory";
export interface OriginalMediaCallerAdmission {
 kind:OriginalMediaCallerKind|OriginalMediaRecoveryKind;
 objectReceiptId?:string;
 multipartOperationId?:string;
 token:string;
 runtimeIdentity:CurrentStorageCallerRuntimeIdentity;
 expectedRevision?:StorageTransferRevision;
}

/** The owning real short service has authorized and locked its original
 * parent. Original mutating callers must be born in that same transaction.
 * A fresh recovery read is a new read caller, never a resumed old writer.
 */
export async function admitOriginalMediaCaller(tx:Tx,input:OriginalMediaCallerAdmission,actor:Actor){
 await requireTransferCapability(tx);
 if(Number(Boolean(input.objectReceiptId))+Number(Boolean(input.multipartOperationId))!==1||input.runtimeIdentity.instance!==mediaWriterRuntimeId||input.runtimeIdentity.pid!==process.pid||input.token.length<36)transferConflict("The new caller has no exact original server-held admission.");
 const recovery=["ordinary_recovery_read","multipart_recovery_inspect","ordinary_retirement_inventory","multipart_retirement_inventory"].includes(input.kind);
 let key:string,namespace:string,parentState:string,originalRuntime:string|null,physicalReceiptId:string|null=null;
 if(input.objectReceiptId){
  const[identity]=await tx.select({keyDigest:mediaObjectWrites.keyDigest}).from(mediaObjectWrites).where(eq(mediaObjectWrites.id,input.objectReceiptId)).limit(1);if(!identity)transferConflict("The immutable original object receipt is missing.");
  await lockObjectDigest(tx,identity.keyDigest);
  const[parent]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,input.objectReceiptId)).limit(1).for("update");if(!parent)transferConflict();
  if(!parent.originalReservationId||!parent.namespace||!input.kind.startsWith("ordinary_")||!recovery&&input.kind!==(parent.operation==="put"?"ordinary_put":"ordinary_delete"))transferConflict();
  key=parent.key;namespace=parent.namespace;parentState=parent.state;originalRuntime=parent.writerRuntimeId;
  if(!recovery){physicalReceiptId=parent.id;if(parent.actor!==actorString(actor)&&!(actor.kind==="system"&&input.kind==="ordinary_delete"&&parent.actor==="system:media-cleanup"))transferConflict("The actual original parent actor differs from this admission.");}
 }else{
  const[identity]=await tx.select({resourceId:mediaMultipartResources.id,keyDigest:mediaMultipartResources.keyDigest}).from(mediaMultipartOperations).innerJoin(mediaMultipartResources,eq(mediaMultipartResources.id,mediaMultipartOperations.resourceId)).where(eq(mediaMultipartOperations.id,input.multipartOperationId!)).limit(1);if(!identity)transferConflict("The immutable original multipart call is missing.");
  await lockObjectDigest(tx,identity.keyDigest);
  const[resource]=await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.id,identity.resourceId)).limit(1).for("update");if(!resource?.namespace||!resource.originalReservationId)transferConflict();
  const[parent]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,input.multipartOperationId!)).limit(1).for("update");if(!parent||parent.resourceId!==resource.id)transferConflict();
  if(!input.kind.startsWith("multipart_")||!recovery&&input.kind!==`multipart_${parent.kind}`)transferConflict();
  key=resource.key;namespace=resource.namespace;parentState=parent.state;originalRuntime=parent.writerRuntimeId;
  if(!recovery&&parent.actor!==actorString(actor))transferConflict("The actual original multipart actor differs from this admission.");
 }
 if(!recovery){
  await assertOriginalNamespaceMutation(tx,namespace);
  const exact=input.objectReceiptId?await tx.execute<{born:boolean}>(sql`select exists(select 1 from media_object_writes where id=${input.objectReceiptId}::uuid and created_at=transaction_timestamp()) as born`):await tx.execute<{born:boolean}>(sql`select exists(select 1 from media_multipart_operations where id=${input.multipartOperationId}::uuid and created_at=transaction_timestamp()) as born`);
  if(originalRuntime!==mediaWriterRuntimeId||parentState!=="started"||exact[0]?.born!==true)transferConflict("An earlier admission cannot acquire a new writer birth or token. Retain its original recovery debt.");
 }
 if(["ordinary_put","multipart_create","multipart_complete","multipart_sign"].includes(input.kind))await assertOriginalKeyCreator(tx,{namespace,key,role:input.kind==="multipart_sign"?"multipart_part":input.kind as "ordinary_put"|"multipart_create"|"multipart_complete"});
 const id=randomUUID(),requestDigest=transferDigest({id,kind:input.kind,objectReceiptId:input.objectReceiptId??null,multipartOperationId:input.multipartOperationId??null,key,namespace,runtimeIdentity:input.runtimeIdentity,expectedRevision:input.expectedRevision??null});
 await tx.insert(mediaStorageTransferCalls).values({id,objectId:null,objectReceiptId:input.objectReceiptId??null,multipartOperationId:input.multipartOperationId??null,kind:input.kind,namespace,physicalKey:key,requestDigest,callerTokenDigest:transferDigest(input.token),physicalReceiptId,runtimeId:mediaWriterRuntimeId,runtimeIdentity:input.runtimeIdentity,expectedRevision:input.expectedRevision});
 return{id,requestDigest,key,namespace};
}

interface MultipartInvocation{active:boolean;runtimeIdentity:CurrentStorageCallerRuntimeIdentity;callers:Map<string,{id:string;token:string;runtimeIdentity:CurrentStorageCallerRuntimeIdentity}>}
const multipartInvocation=new AsyncLocalStorage<MultipartInvocation>();
/** Process-local handoff only. Tokens never enter public/private service
 * schemas, audit inputs or a resumable persisted queue payload. */
export async function withOriginalMultipartInvocation<T>(operation:()=>Promise<T>):Promise<T>{
 const prior=multipartInvocation.getStore();if(prior?.active)return operation();
 const scope={active:true,runtimeIdentity:await actualStorageCallerRuntimeIdentity(),callers:new Map<string,{id:string;token:string;runtimeIdentity:CurrentStorageCallerRuntimeIdentity}>()};
 try{return await multipartInvocation.run(scope,operation);}finally{scope.active=false;}
}
export async function admitOriginalMultipartCaller(tx:Tx,operationId:string,kind:"multipart_create"|"multipart_complete"|"multipart_abort"|"multipart_sign",actor:Actor){
 const scope=multipartInvocation.getStore();if(!scope?.active||scope.callers.has(operationId))transferConflict("A new multipart caller needs its actual owning server invocation.");
 const token=randomUUID()+randomUUID(),runtimeIdentity=scope.runtimeIdentity;
 const call=await admitOriginalMediaCaller(tx,{kind,multipartOperationId:operationId,token,runtimeIdentity},actor);
 scope.callers.set(operationId,{id:call.id,token,runtimeIdentity});
 return call;
}
export function originalMultipartCaller(operationId:string){
 const scope=multipartInvocation.getStore(),call=scope?.callers.get(operationId);
 if(!scope?.active||!call)transferConflict("The original multipart writer cannot be restarted or acquire a new token. Use original-resource recovery.");
 return call;
}

export interface OriginalMediaCallerReturn {inventoryDigest?:string;inventoryCount?:number;configurationDigest?:string;inspectionDigest?:string;capabilityDigest?:string;withheldCapabilityDigest?:string;providerUploadId?:string;accepted?:boolean;failed?:true;notAttempted?:true;revision?:StorageTransferRevision;sha256?:string;bytes?:number;absent?:boolean;requestProof?:OriginalProviderRequestProof}
/** Actual server closure only: this is authenticated by its admission token,
 * never an owner-supplied final-outcome string. Outcome application remains a
 * separate shared phase; a returned caller can still have unknown write debt.
 */
export async function retainOriginalMediaCallerReturn(id:string,token:string,result:OriginalMediaCallerReturn,actor?:Actor):Promise<{settled:boolean}>{
 return db().transaction(async tx=>{
  await requireTransferCapability(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
  const[call]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,id)).limit(1).for("update");
  if(!call||call.objectId||call.runtimeId!==mediaWriterRuntimeId||call.callerTokenDigest!==transferDigest(token))transferConflict("The actual original ordinary/multipart caller cannot be authenticated.");
  const digest=transferDigest(result);
  if(call.resultDigest){if(call.resultDigest!==digest)transferConflict("The first actual original caller return cannot be replaced.");return{settled:call.state==="returned"};}
  const requests=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,id));
  const observations=requests.length?await tx.select().from(mediaStorageTransferRequestObservations).where(inArray(mediaStorageTransferRequestObservations.requestId,requests.map(row=>row.id))):[];
  if(call.kind==="multipart_sign"){
   if(result.withheldCapabilityDigest){
    requireOriginalPartWithheldAuthority(id,token);
    if(result.capabilityDigest||result.failed||result.notAttempted||requests.length!==1||requests.some(request=>!request.returnedAt||!["returned","failed"].includes(request.state))||observations.filter(row=>row.facts.stage==="capability"&&row.facts.detailDigest===result.withheldCapabilityDigest).length!==1)transferConflict("Withhold only this actual still-private minted link after its genuine original physical finish.");
   }
   if(result.capabilityDigest){
    if(!actor)transferConflict("The actual issued result needs its owning server-resolved principal.");await assertMediaActorLive(tx,actor);
    const[parent]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId!)).limit(1);if(!parent||parent.actor!==actorString(actor))transferConflict();
    const[eligible]=await tx.execute<{eligible:boolean}>(sql`select exists(select 1 from media_multipart_operations creation where creation.resource_id=${parent.resourceId}::uuid and creation.operation_kind='create' and freeholder_media_multipart_part_body_context(creation.id)) as eligible`);
    if(eligible?.eligible!==true)transferConflict("The original upload no longer permits new links. Keep it for review.");
   }
   if(result.accepted||result.providerUploadId||result.revision||result.requestProof||result.sha256!==undefined||result.bytes!==undefined||result.absent)transferConflict("An actual local signer finish cannot claim provider acceptance, received bytes or absence.");
   if(result.capabilityDigest&&!observations.some(row=>row.facts.stage==="capability"&&row.facts.detailDigest===result.capabilityDigest)||!result.capabilityDigest&&!result.withheldCapabilityDigest&&!result.failed&&!result.notAttempted)transferConflict("Retain the original actual capability result or explicit local failure; never invent its first result.");
  }else if(result.capabilityDigest||result.withheldCapabilityDigest)transferConflict("A local capability result belongs only to its original signer.");
  if(result.providerUploadId&&!observations.some(row=>row.facts.uploadId===result.providerUploadId&&["accepted","session"].includes(row.facts.stage)))transferConflict("The returned original session has no actual original provider observation.");
  if(result.requestProof&&!observations.some(row=>row.facts.stage==="metadata"&&transferDigest(row.facts.requestProof)===transferDigest(result.requestProof)&&transferDigest(row.facts.revision)===transferDigest(result.revision)))transferConflict("The actual returned original request proof has no matching physical metadata observation.");
  const write=["ordinary_put","ordinary_delete","multipart_create","multipart_complete","multipart_abort","multipart_sign"].includes(call.kind);
  const unresolved=requests.some(row=>["admitted","unknown"].includes(row.state));
  if(write&&result.accepted&&!observations.some(row=>row.facts.stage==="accepted")){
   const[parent]=call.objectReceiptId?await tx.select({kind:mediaObjectWrites.storageKind}).from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.objectReceiptId)).limit(1):[];
   if(parent?.kind!=="local")transferConflict("A genuine original provider acceptance fact is required before a successful write can be retained.");
  }
  if(result.notAttempted&&(observations.some(row=>row.facts.stage==="accepted")||requests.some(row=>!observations.some(fact=>fact.requestId===row.id&&fact.facts.stage==="not_attempted"))))transferConflict("An admitted original provider operation cannot be declared unattempted.");
  const now=new Date(),late=Boolean(call.stoppedAt)||call.state==="stopped";
  const settled=!late&&!unresolved&&!(write&&result.failed);
  await tx.update(mediaStorageTransferCalls).set({state:settled?"returned":"unknown",returnedAt:now,resultDigest:digest,resultRequestProof:result.requestProof??null,resultRevision:result.revision??null,resultSha256:result.sha256??null,resultBytes:result.bytes??null,resultAbsent:result.absent?now:null,...(result.accepted&&!call.observedAcceptedAt?{observedAcceptedAt:now}:{}),updatedAt:now}).where(eq(mediaStorageTransferCalls.id,id));
  if(call.objectReceiptId&&write){
   const[parent]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.objectReceiptId)).limit(1).for("update");if(!parent||parent.writerRuntimeId!==mediaWriterRuntimeId)transferConflict();
   // Finish is retained even after an ambiguous provider failure. It does not
   // turn the physical request outcome into absence or permit a retry.
   await tx.update(mediaObjectWrites).set({writerFinishedAt:parent.writerFinishedAt??now,...(result.accepted&&!parent.observedAcceptedAt?{observedAcceptedAt:now}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,parent.id));
  }
  if(call.multipartOperationId&&write){
   const[parent]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1).for("update");if(!parent||parent.writerRuntimeId!==mediaWriterRuntimeId)transferConflict();
   await tx.update(mediaMultipartOperations).set({writerFinishedAt:parent.writerFinishedAt??now,updatedAt:now}).where(eq(mediaMultipartOperations.id,parent.id));
  }
  return{settled};
 });
}
