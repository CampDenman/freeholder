// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Complete original recovery pages reuse the immutable provider inventory
// ledger, without fabricating a transfer object or adopting a current cohort.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {TransferInventoryConfiguration,TransferInventoryPage} from "../../../scripts/media-transfer.mjs";
import type {Actor,Tx} from "@/core/service";
import {hasModuleAccess,ServiceError} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls as calls,mediaStorageWriterDrains as drains,mediaStorageTransferReviews as reviews} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {mediaStorageProviderInventories as inventories,mediaStorageProviderInventoryPages as pages,mediaStorageProviderInventoryEntries as entries} from "./transfer-inventory-schema";
import {lockTransferInventory} from "./transfer-authority";
import {transferConflict,transferDigest} from "./transfer-proof";
import {checkedTransferBinding} from "./transfer-witness";
import {objectKeyDigest} from "./write-ledger";
import {requireQuiescentOriginalPut,requireStoppedPutRecoveryProof} from "./original-caller-quiescence";
import {requireFinishedOriginalPut,requireOriginalPutRecoveryProof} from "./original-request-recovery-proof";
import {requireOriginalProviderRequestResult} from "./provider-request-proof";
import {inventoryResourceDigest,physicalInventoryBytes,providerInventoryDigest} from "./transfer-inventory-proof";
import {readProviderInventoryPass} from "./transfer-inventory";
import {requireOriginalAbsenceRead,requireOriginalPutRetirementProof,requireOriginalPhysicalAbsenceProof} from "./original-retirement-proof";
import {requireAppliedOriginalPutReview} from "./original-applied-review-proof";
import {transferRequestsDrained} from "./transfer-requests";
type Inventory=typeof inventories.$inferSelect;
function human(actor:Actor){if(actor.kind!=="user"||actor.keyScopes||!hasModuleAccess(actor,"media","manage"))transferConflict("Original recovery inventory requires a freshly verified person with media management access.");}
const wireDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function captureFinishedOriginalPutInternal(tx:Tx,receiptId:string,options:{stopDrainId?:string;expectedWitness?:string;allowAppliedReview?:boolean}={}){
 await lockTransferInventory(tx);
 const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,receiptId)).limit(1).for("update");
 const originalCallers=await tx.select().from(calls).where(and(eq(calls.objectReceiptId,receiptId),eq(calls.kind,"ordinary_put"))).limit(2).for("update");
 const caller=originalCallers[0];
 if(originalCallers.length!==1||!receipt?.originalReservationId||receipt.redactedAt||receipt.deletedAt||!receipt.namespace||receipt.operation!=="put"||!caller||caller.objectId||caller.multipartOperationId||caller.namespace!==receipt.namespace||caller.physicalKey!==receipt.key||caller.runtimeId!==receipt.writerRuntimeId)transferConflict("Restore the exact intact original ordinary caller and its actual finish; no historical writer birth may be backfilled.");
 const physical=await tx.select().from(requests).where(eq(requests.callId,caller.id)).orderBy(asc(requests.createdAt),asc(requests.id));
 let executorStop:typeof drains.$inferSelect|null=null;
 let appliedReview:typeof reviews.$inferSelect|null=null;
 let write:ReturnType<typeof requireFinishedOriginalPut>|undefined;
 if(options.allowAppliedReview&&caller.state==="stopped"&&caller.stopReceiptId&&receipt.state==="accepted"){
  const authority=await tx.execute<{proven:boolean}>(sql`select freeholder_media_original_applied_review(${caller.id}::uuid) as proven`);
  if(authority[0]?.proven!==true)transferConflict("The immutable affirmative original applied review is incomplete; preserve its original finish fields and recovery debt.");
  const[review]=await tx.select().from(reviews).where(eq(reviews.id,caller.stopReceiptId)).limit(1);
  if(!review?.inventoryId)transferConflict();
  const[header]=await tx.select().from(inventories).where(eq(inventories.id,review.inventoryId)).limit(1);
  const[proof]=await tx.select().from(calls).where(eq(calls.id,review.readCallId)).limit(1);
  if(!header||!proof?.resultRevision||!proof.resultSha256||proof.resultBytes===null||!proof.resultRequestProof)transferConflict("Retain the original complete positive read and inventory before physical retirement.");
  if(review.stopDrainId){const[stop]=await tx.select().from(drains).where(eq(drains.id,review.stopDrainId)).limit(1);if(!stop)transferConflict();executorStop=stop;}
  const actual={key:receipt.key,namespace:receipt.namespace,sha256:proof.resultSha256,bytes:proof.resultBytes,revision:proof.resultRevision,requestProof:proof.resultRequestProof};
  const first=await readProviderInventoryPass(tx,header,0),confirmed=await readProviderInventoryPass(tx,header,1);
  write=requireAppliedOriginalPutReview({receiptId,caller,requests:physical,stop:executorStop,review,proofCallId:proof.id,inventory:header,actual,first,confirmed});
  if(!receipt.providerRevisionDigest||transferDigest(actual.revision)!==receipt.providerRevisionDigest)transferConflict("The reviewed original revision cannot be rebound to a current generation.");
  appliedReview=review;
 }else if(receipt.writerFinishedAt&&caller.returnedAt&&physical.every(row=>row.returnedAt))write=requireFinishedOriginalPut(caller,physical);
 else{
  if(!options.stopDrainId&&!options.expectedWitness)transferConflict("Restore the exact intact original ordinary caller and its actual finish; no historical writer birth may be backfilled.");
  let stopIds:string[]=[];
  if(options.stopDrainId)stopIds=[options.stopDrainId];
  else if(options.expectedWitness){
   const candidates=await tx.select({id:drains.id}).from(drains).where(and(eq(drains.namespace,receipt.namespace),inArray(drains.state,["verified","released"]))).limit(1001);
   if(candidates.length>1000)transferConflict("The exact original executor evidence exceeds this bounded review.");stopIds=candidates.map(row=>row.id);
  }
  for(const stopId of stopIds){
   const[candidate]=await tx.select().from(drains).where(eq(drains.id,stopId)).limit(1);if(!candidate)continue;
   try{
    const proof=requireQuiescentOriginalPut(caller,physical,candidate);
    if(proof.mode!=="independent_stop")transferConflict("The original parent finish is inconsistent; no stop can invent it.");
    const candidateWitness=transferDigest({receipt,caller,requests:physical,executorStop:candidate});
    if(options.expectedWitness&&candidateWitness!==options.expectedWitness)continue;
    executorStop=candidate;write=proof.write;break;
   }catch(error){if(!(error instanceof ServiceError)||error.code!=="conflict")throw error;}
  }
  if(!write||!executorStop)transferConflict("The original caller has neither actual finishes nor its exact independently verified executor stop. Never backfill an earlier writer birth or finish.");
 }
 const binding=checkedTransferBinding(write.descriptor.binding);
 if(binding.namespace!==receipt.namespace||transferDigest(binding.location)!==transferDigest(receipt.storageLocation)||binding.kind!==receipt.storageKind||write.descriptor.key!==receipt.key||write.descriptor.sha256!==receipt.sha256||write.descriptor.bytes!==receipt.bytes)transferConflict("The immutable original admission names another physical resource or payload.");
 return{receipt,caller,requests:physical,binding,write,executorStop,appliedReview,witness:transferDigest(appliedReview?{receipt,caller,requests:physical,executorStop,appliedReview}:executorStop?{receipt,caller,requests:physical,executorStop}:{receipt,caller,requests:physical})};
}
async function originalContext(tx:Tx,receiptId:string,originalCallId:string,proofCallId:string,purpose:"recovery"|"retirement",options:{stopDrainId?:string;expectedWitness?:string}={}){
 const original=await captureFinishedOriginalPutInternal(tx,receiptId,{...options,allowAppliedReview:true}),{receipt,caller,write,binding}=original;
 if(caller.id!==originalCallId)transferConflict("Recovery cannot rebind another original caller.");
 const[proof]=await tx.select().from(calls).where(eq(calls.id,proofCallId)).limit(1);
 if(!proof||proof.objectReceiptId!==receipt.id||proof.kind!=="ordinary_recovery_read"||proof.namespace!==receipt.namespace||proof.physicalKey!==receipt.key||proof.state!=="returned"||!proof.returnedAt||!await transferRequestsDrained(tx,[proof.id]))transferConflict("A fresh actual original-provider read must finish before its inventory is captured.");
 if(purpose==="retirement"){
  if(original.executorStop&&!original.appliedReview)transferConflict("A stop alone cannot authorize retirement; retain the exact completed affirmative applied review first.");
  if(!receipt.providerRevision||!receipt.providerRevisionDigest||transferDigest(receipt.providerRevision)!==receipt.providerRevisionDigest)transferConflict("The original revision must be retained before physical retirement.");
  const absenceRequests=await tx.select().from(requests).where(eq(requests.callId,proof.id));
  const absenceFacts=absenceRequests.length?await tx.select().from(observations).where(inArray(observations.requestId,absenceRequests.map(row=>row.id))):[];
  const absenceRequestIds=absenceFacts.filter(row=>row.facts.stage==="absence").map(row=>row.requestId);
  requireOriginalAbsenceRead({key:receipt.key,namespace:binding.namespace,revision:receipt.providerRevision,absence:proof,requests:absenceRequests,absenceRequestIds});
  return{...original,proof,actual:null,absenceRequests,absenceRequestIds};
 }
 if(proof.resultAbsent||!proof.resultRevision||!proof.resultSha256||proof.resultBytes===null||!proof.resultRequestProof)transferConflict("A fresh actual full-byte original-provider read must finish before its recovery inventory is captured.");
 const actual={key:receipt.key,namespace:binding.namespace,sha256:proof.resultSha256,bytes:proof.resultBytes,revision:proof.resultRevision,requestProof:proof.resultRequestProof};
 requireOriginalProviderRequestResult(write,actual);
 return{...original,proof,actual,absenceRequests:[],absenceRequestIds:[]};
}
async function lockedOriginalInventoryInternal(tx:Tx,id:string){
 const[identity]=await tx.select().from(inventories).where(eq(inventories.id,id)).limit(1);
 if(!identity||identity.planId||!identity.objectReceiptId||identity.multipartOperationId||!identity.anchorCallId||!identity.proofCallId||!["recovery","retirement"].includes(identity.purpose)||identity.side!=="source")transferConflict("This page belongs to another immutable original inventory context.");
 const original=await originalContext(tx,identity.objectReceiptId,identity.anchorCallId,identity.proofCallId,identity.purpose==="retirement"?"retirement":"recovery",{expectedWitness:identity.originalWitness??undefined});
 const[inventory]=await tx.select().from(inventories).where(eq(inventories.id,id)).limit(1).for("update");
 if(!inventory||inventory.originalWitness!==original.witness||transferDigest(inventory.binding)!==transferDigest(original.binding))transferConflict("The exact original caller evidence changed after first inventory capture; retain that first proof and reload recovery.");
 return{...original,inventory};
}
async function captureOriginalInventoryInternal(tx:Tx,input:{receiptId:string;originalCallId:string;proofCallId:string;stopDrainId?:string},purpose:"recovery"|"retirement"){
 const original=await originalContext(tx,input.receiptId,input.originalCallId,input.proofCallId,purpose,{stopDrainId:input.stopDrainId});
 const[prior]=await tx.select().from(inventories).where(and(eq(inventories.anchorCallId,input.originalCallId),eq(inventories.proofCallId,input.proofCallId),eq(inventories.purpose,purpose))).limit(1);
 if(prior){if(prior.originalWitness!==original.witness||prior.objectReceiptId!==input.receiptId)transferConflict();return prior;}
 const[header]=await tx.insert(inventories).values({id:randomUUID(),planId:null,objectReceiptId:input.receiptId,anchorCallId:input.originalCallId,proofCallId:input.proofCallId,originalWitness:original.witness,side:"source",purpose,binding:original.binding,namespace:original.binding.namespace}).returning();return header!;
}
async function originalInventoryProgressInternal(tx:Tx,id:string){const{inventory}=await lockedOriginalInventoryInternal(tx,id);return{inventory,pages:await tx.select().from(pages).where(eq(pages.inventoryId,id)).orderBy(asc(pages.pass),asc(pages.createdAt),asc(pages.id))};}
export interface OriginalInventoryPageResult{inventoryId:string;callId:string;pass:0|1;kind:"configuration"|"objects"|"versions"|"sessions"|"retained";cursor:Record<string,string>|null;configuration?:TransferInventoryConfiguration;page?:TransferInventoryPage}
async function appendOriginalInventoryPageInternal(tx:Tx,input:OriginalInventoryPageResult){
 const{inventory,receipt}=await lockedOriginalInventoryInternal(tx,input.inventoryId),[caller]=await tx.select().from(calls).where(eq(calls.id,input.callId)).limit(1);
 const expectedKind=inventory.binding.kind==="s3"?["configuration","objects","versions","sessions"]:["configuration","objects","versions","retained"];
 if(inventory.state!=="capturing"||!expectedKind.includes(input.kind)||input.pass!==0&&input.pass!==1||(input.kind==="configuration"?!(input.configuration&&!input.page&&input.cursor===null):!(input.page&&!input.configuration&&input.page.entries.length<=250)))transferConflict("Append one bounded original configuration/page result.");
 const result=input.kind==="configuration"?{configurationDigest:transferDigest(input.configuration)}:{inventoryDigest:transferDigest(input.page),inventoryCount:input.page!.entries.length};
 if(!caller||caller.objectReceiptId!==receipt.id||caller.objectId||caller.multipartOperationId||caller.kind!=="ordinary_retirement_inventory"||caller.namespace!==inventory.namespace||caller.physicalKey!==receipt.key||caller.state!=="returned"||!caller.returnedAt||caller.resultDigest!==transferDigest(result)||!await transferRequestsDrained(tx,[caller.id]))transferConflict("This original inventory page has no exact actual finished caller/result.");
 const physical=await tx.select({request:requests,fact:observations}).from(requests).innerJoin(observations,eq(observations.requestId,requests.id)).where(and(eq(requests.callId,caller.id),eq(requests.state,"returned")));
 if(!physical.some(row=>row.request.descriptor.kind===(input.kind==="configuration"?"bucket.metadata":`inventory.${input.kind}`)&&transferDigest(row.request.descriptor.binding)===transferDigest(inventory.binding)&&transferDigest(row.request.descriptor.cursor??null)===transferDigest(input.cursor)&&row.fact.facts.stage===(input.configuration?"configuration":"inventory")&&row.fact.facts.detailDigest===wireDigest(input.configuration??input.page)))transferConflict("The page differs from its exact original physical provider observation.");
 const chain=await tx.select().from(pages).where(and(eq(pages.inventoryId,inventory.id),eq(pages.pass,input.pass),eq(pages.kind,input.kind))).orderBy(asc(pages.createdAt),asc(pages.id));
 if(input.kind==="configuration"?chain.length>0:chain.length?chain.at(-1)!.nextCursor===null||transferDigest(chain.at(-1)!.nextCursor)!==transferDigest(input.cursor):input.cursor!==null)transferConflict("The first original provider page/cursor chain cannot be replaced.");
 const[page]=await tx.insert(pages).values({inventoryId:inventory.id,callId:caller.id,pass:input.pass,kind:input.kind,cursor:input.cursor,cursorDigest:transferDigest(input.cursor),nextCursor:input.page?.next??null,pageDigest:transferDigest(input.configuration??input.page),membershipDigest:transferDigest(input.page?.entries.map(entry=>transferDigest(entry))??[]),entryCount:input.page?.entries.length??0,configuration:input.configuration}).returning();
 if(input.page?.entries.length)await tx.insert(entries).values(input.page.entries.map((entry,ordinal)=>({inventoryId:inventory.id,pageId:page!.id,ordinal,pass:input.pass,entry,entryDigest:transferDigest(entry),keyDigest:objectKeyDigest(entry.key),resourceDigest:inventoryResourceDigest(entry),attribution:"unattributed"as const})));
 return{ok:true as const};
}
async function finishOriginalInventoryInternal(tx:Tx,id:string):Promise<Inventory>{
 const original=await lockedOriginalInventoryInternal(tx,id),{inventory}=original;if(inventory.state!=="capturing")return inventory;
 const first=await readProviderInventoryPass(tx,inventory,0),confirmed=await readProviderInventoryPass(tx,inventory,1),firstDigest=providerInventoryDigest(first.configuration,first.entries),confirmedDigest=providerInventoryDigest(confirmed.configuration,confirmed.entries);
 if(inventory.purpose==="retirement"){
  if(!original.receipt.providerRevision)transferConflict();
  const proof={caller:original.caller,requests:original.requests,key:original.receipt.key,namespace:original.binding.namespace,revision:original.receipt.providerRevision,absence:original.proof,absenceRequests:original.absenceRequests,absenceRequestIds:original.absenceRequestIds,first,confirmed};
  if(original.appliedReview)requireOriginalPhysicalAbsenceProof(original.write,proof);
  else requireOriginalPutRetirementProof(proof);
 }else{
  if(!original.actual)transferConflict();
  if(original.executorStop)requireStoppedPutRecoveryProof({caller:original.caller,requests:original.requests,stop:original.executorStop,actual:original.actual,first,confirmed});
  else requireOriginalPutRecoveryProof({caller:original.caller,requests:original.requests,actual:original.actual,first,confirmed});
 }
 const[saved]=await tx.update(inventories).set({state:"complete",firstDigest,confirmedDigest,configuration:first.configuration,entryCount:first.entries.length,totalBytes:physicalInventoryBytes(first.configuration,first.entries),completedAt:new Date(),updatedAt:new Date()}).where(eq(inventories.id,id)).returning();return saved!;
}

// Internal shared lifecycle infrastructure. These are not services or transport
// inputs: the owning cleanup/recovery lifecycle supplies its real authority.
export const originalInventoryLifecycle={captureFinishedPut:(tx:Tx,id:string)=>captureFinishedOriginalPutInternal(tx,id,{allowAppliedReview:true}),capture:captureOriginalInventoryInternal,locked:lockedOriginalInventoryInternal,progress:originalInventoryProgressInternal,append:appendOriginalInventoryPageInternal,finish:finishOriginalInventoryInternal};
// Existing freshly verified human recovery surface keeps every original gate.
export async function captureFinishedOriginalPut(tx:Tx,receiptId:string,actor:Actor){human(actor);return captureFinishedOriginalPutInternal(tx,receiptId);}
export async function captureRecoverableOriginalPut(tx:Tx,receiptId:string,actor:Actor,stopDrainId?:string){human(actor);return captureFinishedOriginalPutInternal(tx,receiptId,{stopDrainId});}
export async function lockedOriginalRecoveryInventory(tx:Tx,id:string,actor:Actor){human(actor);const result=await lockedOriginalInventoryInternal(tx,id);if(result.inventory.purpose!=="recovery"||!result.actual)transferConflict();return{...result,actual:result.actual};}
export async function captureOriginalRecoveryInventory(tx:Tx,input:{receiptId:string;originalCallId:string;proofCallId:string;stopDrainId?:string},actor:Actor){human(actor);return captureOriginalInventoryInternal(tx,input,"recovery");}
export async function originalRecoveryInventoryProgress(tx:Tx,id:string,actor:Actor){await lockedOriginalRecoveryInventory(tx,id,actor);return originalInventoryProgressInternal(tx,id);}
export async function appendOriginalRecoveryInventoryPage(tx:Tx,input:OriginalInventoryPageResult,actor:Actor){await lockedOriginalRecoveryInventory(tx,input.inventoryId,actor);return appendOriginalInventoryPageInternal(tx,input);}
export async function finishOriginalRecoveryInventory(tx:Tx,id:string,actor:Actor):Promise<Inventory>{await lockedOriginalRecoveryInventory(tx,id,actor);return finishOriginalInventoryInternal(tx,id);}
