// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual structurally valid positive observations are evidence, not permission
// to replace first canonical session identity or erase a conflicting resource.
import {and,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {TransferRequestDescriptor,TransferRequestObservation} from "../../../scripts/media-transfer.mjs";
import {db} from "@/core/db";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {mediaMultipartOperations as operations,mediaMultipartResources as resources} from "./multipart-schema";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {mediaObjects} from "./schema";
import {requireTransferCapability} from "./transfer-authority";
import {objectKeyDigest} from "./write-ledger";
import {transferConflict,transferDigest} from "./transfer-proof";
import {readRetainedOriginalMultipartIdentity,retainedMultipartSessionDecision} from "./multipart-retained-identity";
export function originalSessionObservationDecision(input:{descriptor:TransferRequestDescriptor;fact:TransferRequestObservation;canonicalUploadId:string|null;observedUploadId:string|null}):"first"|"same"|"conflicting"{
 const{descriptor,fact}=input,id=fact.uploadId;
 if(!["accepted","session"].includes(fact.stage)||!descriptor.kind.startsWith("multipart.")||descriptor.kind==="multipart.sign"||typeof id!=="string"||!id||id.length>4096||/[\u0000-\u001f]/.test(id)||fact.status===null||!Number.isInteger(fact.status)||fact.status<200||fact.status>=300)transferConflict("Retain only a structurally valid actual positive multipart session observation.");
 if(fact.revision&&(fact.revision.namespace!==descriptor.binding.namespace||!descriptor.key||objectKeyDigest(fact.revision.key)!==objectKeyDigest(descriptor.key)))return"conflicting";
 if(descriptor.kind!=="multipart.create"&&descriptor.uploadId!==id||input.canonicalUploadId!==null&&input.canonicalUploadId!==id||input.observedUploadId!==null&&input.observedUploadId!==id)return"conflicting";
 return input.canonicalUploadId===null&&input.observedUploadId===null?"first":"same";
}
/** The real observer inserted the immutable fact first in this transaction.
 * This projection may mark debt, but never rebinds first identity/ACK/FIN.
 * Caller/token/physical admission are authenticated by the owning observer. */
export async function projectOriginalMultipartSessionObservation(tx:Tx,input:{operationId:string;callId:string;requestId:string;fact:TransferRequestObservation;late:boolean}):Promise<{conflicting:boolean;operationId:string}>{
 const[caller]=await tx.select().from(calls).where(eq(calls.id,input.callId)).limit(1).for("update"),[request]=await tx.select().from(requests).where(eq(requests.id,input.requestId)).limit(1).for("update"),[operation]=await tx.select().from(operations).where(eq(operations.id,input.operationId)).limit(1).for("update"),[resource]=operation?await tx.select().from(resources).where(eq(resources.id,operation.resourceId)).limit(1).for("update"):[];
 if(!caller||caller.multipartOperationId!==input.operationId||!request||request.callId!==caller.id||!operation||!resource||transferDigest(request.runtimeIdentity)!==transferDigest(caller.runtimeIdentity)||!request.redactedAt&&request.descriptorDigest!==transferDigest(request.descriptor)||request.descriptor.binding.namespace!==caller.namespace||caller.namespace!==resource.namespace)transferConflict("The actual original positive session must retain its original physical caller and namespace.");
 const[retained]=await tx.select({id:observations.id}).from(observations).where(and(eq(observations.requestId,request.id),eq(observations.factsDigest,transferDigest(input.fact)))).limit(1);if(!retained)transferConflict("Commit the exact original positive observation before projecting its session identity.");
 const identityRead=await readRetainedOriginalMultipartIdentity(tx,resource.id),sealed=identityRead.state==="proven",decision=identityRead.state==="proven"?retainedMultipartSessionDecision({identity:identityRead.identity,callId:caller.id,requestId:request.id,descriptor:request.descriptor,descriptorDigest:request.descriptorDigest,tokenDigest:request.tokenDigest,runtimeIdentity:request.runtimeIdentity,fact:input.fact,canonicalUploadId:resource.providerUploadId,observedUploadId:operation.observedProviderUploadId}):identityRead.state==="conflicting"||identityRead.state==="unavailable"||resource.redactedAt?"conflicting":originalSessionObservationDecision({descriptor:request.descriptor,fact:input.fact,canonicalUploadId:resource.providerUploadId,observedUploadId:operation.observedProviderUploadId}),conflicting=decision==="conflicting",pending=conflicting||input.late||sealed,now=new Date(),uploadId=input.fact.uploadId;if(!uploadId)transferConflict();
 // A sealed first value never becomes a new raw canonical identity or ACK.
 // The actual fact was inserted above; same/different identity both reopen
 // original debt, while unavailable/conflicting proof cannot discard it.
 await tx.update(operations).set({...(!conflicting&&!sealed?{observedProviderUploadId:uploadId,...(input.fact.stage==="accepted"&&!operation.providerAcceptedAt?{providerAcceptedAt:now}:{})}:{}),...(pending?{state:"unknown"as const}:{}),updatedAt:now}).where(eq(operations.id,operation.id));
 await tx.update(resources).set({...(!conflicting&&!sealed?{providerUploadId:uploadId}:{}),...(pending?{state:"unknown"as const,retiredAt:null}:{}),updatedAt:now}).where(eq(resources.id,resource.id));
 if(conflicting){await tx.update(calls).set({state:"unknown",updatedAt:now}).where(eq(calls.id,caller.id));await tx.update(requests).set({state:"unknown"}).where(eq(requests.id,request.id));}
 return{conflicting,operationId:operation.id};
}
/** Pointer recovery is deliberately AFTER the fact transaction commits. An
 * unavailable raw key, conflicting session, old capture or another pointer
 * cannot roll back actual positive evidence. It remains explicit debt. */
export async function reconcileOriginalMultipartPositivePointer(operationId:string):Promise<boolean>{return db().transaction(async tx=>{
 await lockContactIdentityForRead(tx);await requireTransferCapability(tx);await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);const[operation]=await tx.select().from(operations).where(eq(operations.id,operationId)).limit(1).for("update"),[resource]=operation?await tx.select().from(resources).where(eq(resources.id,operation.resourceId)).limit(1).for("update"):[];if(!operation||!resource)return false;
 if(resource.state!=="unknown")return true;const first=await readRetainedOriginalMultipartIdentity(tx,resource.id);if(first.state==="conflicting"||first.state==="unavailable")return false;if(!resource.originalReservationId||!resource.namespace||!resource.providerUploadId||first.state!=="proven"&&!operation.providerAcceptedAt)return false;if(first.state==="proven"&&(first.identity.resource.reservationId!==resource.originalReservationId||first.identity.resource.namespace!==resource.namespace||first.identity.resource.uploadIdDigest!==transferDigest(resource.providerUploadId)))return false;
 const original=await tx.select().from(calls).where(and(eq(calls.multipartOperationId,operation.id),inArray(calls.kind,["multipart_create","multipart_complete","multipart_abort"]))),ids=original.map(row=>row.id),physical=ids.length?await tx.select().from(requests).where(inArray(requests.callId,ids)):[],facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[];
 if(facts.some(row=>["accepted","session"].includes(row.facts.stage)&&row.facts.uploadId!==resource.providerUploadId))return false;
 const caller=original.find(row=>row.namespace===resource.namespace&&!row.physicalKey.startsWith("retained:")&&objectKeyDigest(row.physicalKey)===resource.keyDigest);if(!caller)return false;
 const[existing]=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,caller.physicalKey)).limit(1);if(existing)return existing.reservationId===resource.originalReservationId&&existing.uploadId===resource.uploadId;
 await tx.insert(mediaObjects).values({reservationId:resource.originalReservationId,key:caller.physicalKey,uploadId:resource.uploadId,role:"staged",state:"pending",contentType:resource.contentType,bytes:resource.expectedBytes});return true;
 });}
