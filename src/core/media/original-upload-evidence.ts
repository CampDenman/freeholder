// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: logical upload identity follows actual immutable FKs/captures.
// Reading a surviving legacy FK never fills the historical nullable column.
import {and,eq,inArray} from "drizzle-orm";
import {z} from "zod";
import type {Tx} from "@/core/service";
import {contactPrivacyHistory} from "@/core/privacy/contact-identity";
import {erasureArtifactIsIntact} from "@/core/privacy/service";
import type {OriginalMediaErasureMembership} from "./erasure-schema";
import {mediaUploads,mediaObjects} from "./schema";
import {mediaMultipartResources} from "./multipart-schema";
import {mediaObjectWrites} from "./write-schema";
import {objectKeyDigest} from "./write-ledger";
import {transferDigest} from "./transfer-proof";

export interface RetainedUploadFirstIdentity{id:string;reservationId:string;keyDigest:string}
const oldReceipt=z.object({format:z.literal("freeholder.erasure-receipt"),requestId:z.uuid(),contactId:z.uuid(),generatedAt:z.string().datetime(),outcomes:z.array(z.object({scope:z.string()}))});
/** Existing ownership history supplies legitimate aliases. No email/current
 * contact equality or timestamp alone supplies a historical subject. Require
 * the whole recorded interval, including millisecond precision boundaries,
 * to contain only the currently owned identities. Mixed prior scopes are debt. */
export async function originalUploadPriorSubject(tx:Tx,ownedIds:string[],request:{id:string;createdAt:Date},header:{createdAt:Date},artifact:{body:unknown;sha256:string;createdAt:Date}|undefined,scope:string):Promise<"owned"|"mixed"|"foreign"|"unknown">{
 const parsed=oldReceipt.safeParse(artifact?.body);
 if(!parsed.success||!artifact||!erasureArtifactIsIntact(artifact)||parsed.data.requestId!==request.id||!parsed.data.outcomes.some(row=>row.scope===scope))return"unknown";
 const history=await contactPrivacyHistory(tx,ownedIds),at=BigInt(Date.parse(parsed.data.generatedAt))*1000n,end=at+999n;
 const start=[at,BigInt(request.createdAt.getTime())*1000n,BigInt(header.createdAt.getTime())*1000n,BigInt(artifact.createdAt.getTime())*1000n].reduce((a,b)=>a<b?a:b);
 const points=new Set([start.toString(),at.toString(),end.toString()]);
 for(const operation of history.operations)for(const point of[operation.mergedMicros,operation.undoneMicros])if(point!==null&&BigInt(point)>=start&&BigInt(point)<=end)points.add(point);
 const ownership=[...points].map(point=>history.at(parsed.data.contactId,point));
 return ownership.every(point=>point.onlySubject)?"owned":ownership.some(point=>point.containsSubject)?"mixed":"foreign";
}

export type OriginalUploadEvidence={state:"pending"}|{state:"proven";upload:typeof mediaUploads.$inferSelect;reservationId:string;keyDigest:string;basis:"new_birth"|"captured_resource"|"captured_pointer"};
export async function readOriginalUploadEvidence(tx:Tx,first:OriginalMediaErasureMembership,uploadId:string):Promise<OriginalUploadEvidence>{
 const member=first.uploads.find(row=>row.id===uploadId);if(!member)return{state:"pending"};
 const[upload]=await tx.select().from(mediaUploads).where(eq(mediaUploads.id,uploadId)).limit(1).for("update");if(!upload)return{state:"pending"};
 const candidates:Array<{reservationId:string;keyDigest:string;basis:"new_birth"|"captured_resource"|"captured_pointer"}>=[];
 if(upload.originalReservationId!==null){
  if(member.reservationId!==upload.originalReservationId||!member.keyDigest)return{state:"pending"};
  candidates.push({reservationId:upload.originalReservationId,keyDigest:member.keyDigest,basis:"new_birth"});
 }else{
  const resourceIds=first.resources.map(row=>row.id),resources=resourceIds.length?await tx.select().from(mediaMultipartResources).where(and(inArray(mediaMultipartResources.id,resourceIds),eq(mediaMultipartResources.uploadId,uploadId))):[];
  for(const resource of resources)if(resource.originalReservationId&&first.resources.some(row=>row.id===resource.id&&row.reservationId===resource.originalReservationId))candidates.push({reservationId:resource.originalReservationId,keyDigest:resource.keyDigest,basis:"captured_resource"});
  const pointers=await tx.select().from(mediaObjects).where(eq(mediaObjects.uploadId,uploadId));
  for(const pointer of pointers)if(pointer.reservationId&&(pointer.role==="original"||pointer.role==="staged")){const captured=first.reservations.find(row=>row.id===pointer.reservationId&&row.witness===transferDigest(pointer));if(captured)candidates.push({reservationId:pointer.reservationId,keyDigest:captured.keyDigest,basis:"captured_pointer"});}
 }
 if(!candidates.length||new Set(candidates.map(row=>`${row.reservationId}:${row.keyDigest}`)).size!==1)return{state:"pending"};
 const original=candidates[0]!;
 if(member.keyDigest&&member.keyDigest!==original.keyDigest||upload.storageKey!==`retained:${original.keyDigest}`&&objectKeyDigest(upload.storageKey)!==original.keyDigest)return{state:"pending"};
 const receipts=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.originalReservationId,original.reservationId));
 if(receipts.some(row=>row.keyDigest!==original.keyDigest))return{state:"pending"};
 return{state:"proven",upload,...original};
}
