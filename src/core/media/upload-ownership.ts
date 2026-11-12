// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C1.08: original data ownership is independent of the current executor.
import {and,eq,inArray} from "drizzle-orm";
import {contacts} from "@/core/contacts/schema";
import {dataRequests} from "@/core/privacy/schema";
import {ServiceError,type Tx,type Actor} from "@/core/service";
import {sessions} from "@/core/auth/schema";
import {apiKeys} from "@/core/apikeys/schema";

/** Actual HTTP principals carry their session/key identity across awaits. */
export async function assertMediaActorLive(tx:Tx,actor:Actor):Promise<void>{
 if(actor.kind==="user"&&actor.sessionId){
  const[session]=await tx.select({userId:sessions.userId,expiresAt:sessions.expiresAt}).from(sessions).where(eq(sessions.id,actor.sessionId)).limit(1);
  if(!session||session.userId!==actor.userId||session.expiresAt<=new Date())throw new ServiceError("permission","Sign in again before starting new storage work.");
 }
 if((actor.kind==="user"||actor.kind==="agent")&&actor.keyId){
  const[key]=await tx.select().from(apiKeys).where(eq(apiKeys.id,actor.keyId)).limit(1);
  if(!key||key.revokedAt||(key.expiresAt&&key.expiresAt<=new Date())||(actor.kind==="user"&&key.actsAsUserId!==actor.userId))throw new ServiceError("permission","This connection no longer permits new storage work.");
 }
}

export async function originalUploadContact(tx:Tx,uploadedBy:string|null):Promise<string|null>{
 const userId=uploadedBy?.match(/^user:([0-9a-f-]{36})$/i)?.[1];
 if(!userId)return null;
 return(await tx.select({id:contacts.id}).from(contacts).where(eq(contacts.userId,userId)).limit(1))[0]?.id??null;
}
/** Called under the shared contact-identity admission lock, before new I/O. */
export async function assertOriginalUploadWritable(tx:Tx,contactId:string|null,uploadedBy:string|null):Promise<void>{
 if(!contactId)return; // No historical identity is invented for a bearer link.
 const[contact]=await tx.select({userId:contacts.userId}).from(contacts).where(eq(contacts.id,contactId)).limit(1);
 const originalUserId=uploadedBy?.match(/^user:([0-9a-f-]{36})$/i)?.[1];
 if(!contact || !contact.userId || (originalUserId&&contact.userId!==originalUserId))throw new ServiceError("conflict","The original upload owner's identity no longer permits new storage work.");
 const erased=await tx.select({id:dataRequests.id}).from(dataRequests).where(and(eq(dataRequests.contactId,contactId),eq(dataRequests.kind,"erasure"),inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1);
 if(erased.length)throw new ServiceError("conflict","The original upload owner's privacy request prevents new storage work.");
}
