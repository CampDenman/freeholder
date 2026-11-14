// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Genuine original multipart recovery reuses complete immutable inventory rows;
// it never fabricates an ordinary receipt or a transfer object/plan.
import {randomUUID,createHash} from "node:crypto";
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {TransferInventoryConfiguration,TransferInventoryPage} from "../../../scripts/media-transfer.mjs";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as observations} from "./transfer-request-schema";
import {mediaStorageProviderInventories as inventories,mediaStorageProviderInventoryPages as pages,mediaStorageProviderInventoryEntries as entries} from "./transfer-inventory-schema";
import {captureAppliedMultipartContext} from "./multipart-applied-recovery-context";
import type {MultipartRecoveryConfirmation} from "./multipart-recovery-context";
import {requireOriginalMultipartCompletedBody} from "./multipart-completed-proof";
import {requireKnownOriginalEmptySession} from "./multipart-known-create-proof";
import {requireAppliedOriginalMultipartObject} from "./multipart-complete-recovery-proof";
import {inventoryResourceDigest,physicalInventoryBytes,providerInventoryDigest} from "./transfer-inventory-proof";
import {readProviderInventoryPass} from "./transfer-inventory";
import {objectKeyDigest} from "./write-ledger";
import {transferRequestsDrained} from "./transfer-requests";
import {transferConflict,transferDigest} from "./transfer-proof";
type RecoveryInput=MultipartRecoveryConfirmation&{originalWitness:string};
const wireDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function appliedMultipartReadProof(tx:Tx,input:RecoveryInput,proofCallId:string){
 const original=await captureAppliedMultipartContext(tx,input);if(original.witness!==input.originalWitness)transferConflict("The immutable original COMPLETE evidence changed before recovery.");
 const[proof]=await tx.select().from(calls).where(eq(calls.id,proofCallId)).limit(1);
 if(!proof||proof.multipartOperationId!==original.operation.id||proof.objectId||proof.objectReceiptId||proof.kind!=="multipart_recovery_inspect"||proof.namespace!==original.resource.namespace||proof.physicalKey!==original.key||proof.state!=="returned"||!proof.returnedAt||!await transferRequestsDrained(tx,[proof.id]))transferConflict("The genuine fresh original-provider full read must finish before its first inventory.");
 const physical=await tx.select().from(requests).where(eq(requests.callId,proof.id)),facts=physical.length?await tx.select().from(observations).where(inArray(observations.requestId,physical.map(row=>row.id))):[];
 if(original.kind==="create"){
  if(proof.resultDigest!==transferDigest({inspectionDigest:transferDigest({state:"open",parts:[]})})||proof.resultRevision||proof.resultSha256||proof.resultBytes!==null||proof.resultRequestProof||proof.resultAbsent||physical.length!==1||physical[0]?.descriptor.kind!=="multipart.inspect"||physical[0].descriptor.uploadId!==original.resource.providerUploadId||physical[0].descriptor.cursor!=null||!facts.some(row=>row.facts.stage==="response_body"&&row.facts.detailDigest)||!facts.some(row=>row.facts.stage==="inventory"&&row.facts.count===0&&row.facts.uploadId===original.resource.providerUploadId))transferConflict("The exact originally acknowledged session needs a genuine complete empty part inspection; singleton key or current absence is insufficient.");
  return{...original,proof,actual:null};
 }
 if(!proof.resultRevision||!proof.resultSha256||proof.resultBytes===null||!proof.resultRequestProof||proof.resultAbsent)transferConflict("Retain the exact actual complete original nonce-bound file read.");
 const bodies=facts.filter(row=>row.facts.stage==="body"&&row.facts.partsDigest===original.operation.partsDigest&&row.facts.sha256===proof.resultSha256&&row.facts.bytes===proof.resultBytes);
 if(physical.length!==1||physical[0]?.descriptor.kind!=="object.read"||physical[0].descriptor.partsDigest!==original.operation.partsDigest||bodies.length!==1||bodies[0]!.requestId!==physical[0].id)transferConflict("Retain the exact actual complete part-bound body read, never a current-key/HEAD-only result.");
 const actual={key:original.key,namespace:original.binding.namespace,sha256:proof.resultSha256,bytes:proof.resultBytes,revision:proof.resultRevision,requestProof:proof.resultRequestProof,partsDigest:bodies[0]!.facts.partsDigest};
 if(original.expectedRevision&&transferDigest(actual.revision)!==transferDigest(original.expectedRevision))transferConflict("The first actual original COMPLETE revision cannot be rebound to a current generation.");
 if(actual.bytes!==original.resource.expectedBytes)transferConflict("The actual recovered file has a different original byte budget.");
 requireOriginalMultipartCompletedBody(original.creationProof,actual,{uploadId:original.resource.providerUploadId!,namespace:original.binding.namespace,key:original.key,revision:actual.revision,maxBytes:original.resource.expectedBytes});
 return{...original,proof,actual};
}
export async function captureAppliedMultipartInventory(tx:Tx,input:RecoveryInput&{proofCallId:string}){
 const original=await appliedMultipartReadProof(tx,input,input.proofCallId);
 const[prior]=await tx.select().from(inventories).where(and(eq(inventories.anchorCallId,original.caller.id),eq(inventories.proofCallId,original.proof.id),eq(inventories.purpose,"recovery"))).limit(1).for("update");
 if(prior){if(prior.multipartOperationId!==original.operation.id||prior.originalWitness!==original.witness)transferConflict();return prior;}
 const[header]=await tx.insert(inventories).values({id:randomUUID(),multipartOperationId:original.operation.id,anchorCallId:original.caller.id,proofCallId:original.proof.id,originalWitness:original.witness,side:"source",purpose:"recovery",binding:original.binding,namespace:original.binding.namespace}).returning();return header!;
}
export async function lockedAppliedMultipartInventory(tx:Tx,input:RecoveryInput&{inventoryId:string}){
 const[identity]=await tx.select().from(inventories).where(eq(inventories.id,input.inventoryId)).limit(1);
 if(!identity?.multipartOperationId||!identity.proofCallId||identity.planId||identity.objectReceiptId||identity.side!=="source"||identity.purpose!=="recovery")transferConflict("Restore the exact original multipart recovery inventory header.");
 const original=await appliedMultipartReadProof(tx,input,identity.proofCallId);
 const[header]=await tx.select().from(inventories).where(eq(inventories.id,input.inventoryId)).limit(1).for("update");if(!header||header.proofCallId!==identity.proofCallId)transferConflict();
 if(header.multipartOperationId!==original.operation.id||header.anchorCallId!==original.caller.id||header.originalWitness!==original.witness||header.namespace!==original.binding.namespace||transferDigest(header.binding)!==transferDigest(original.binding))transferConflict("The first original multipart inventory cannot be rebound or refilled from current state.");
 return{...original,inventory:header};
}
export async function appliedMultipartInventoryProgress(tx:Tx,input:RecoveryInput&{inventoryId:string}){
 const original=await lockedAppliedMultipartInventory(tx,input);return{inventory:original.inventory,pages:await tx.select().from(pages).where(eq(pages.inventoryId,original.inventory.id)).orderBy(asc(pages.pass),asc(pages.createdAt),asc(pages.id))};
}
export interface MultipartRecoveryInventoryPage{inventoryId:string;callId:string;pass:0|1;kind:"configuration"|"objects"|"versions"|"sessions";cursor:Record<string,string>|null;configuration?:TransferInventoryConfiguration;page?:TransferInventoryPage}
export async function appendAppliedMultipartInventoryPage(tx:Tx,input:RecoveryInput&MultipartRecoveryInventoryPage){
 const original=await lockedAppliedMultipartInventory(tx,input),header=original.inventory;
 if(header.state!=="capturing"||input.pass!==0&&input.pass!==1||!["configuration","objects","versions","sessions"].includes(input.kind)||(input.kind==="configuration"?!(input.configuration&&!input.page&&input.cursor===null):!(input.page&&!input.configuration&&input.page.entries.length<=250)))transferConflict("Append one actual bounded original multipart provider page.");
 const result=input.configuration?{configurationDigest:transferDigest(input.configuration)}:{inventoryDigest:transferDigest(input.page),inventoryCount:input.page!.entries.length},[caller]=await tx.select().from(calls).where(eq(calls.id,input.callId)).limit(1);
 if(!caller||caller.multipartOperationId!==original.operation.id||caller.objectId||caller.objectReceiptId||caller.kind!=="multipart_retirement_inventory"||caller.namespace!==header.namespace||caller.physicalKey!==original.key||caller.state!=="returned"||!caller.returnedAt||caller.resultDigest!==transferDigest(result)||!await transferRequestsDrained(tx,[caller.id]))transferConflict("Every original multipart page needs its own authentic actually finished caller/result.");
 const physical=await tx.select({request:requests,fact:observations}).from(requests).innerJoin(observations,eq(observations.requestId,requests.id)).where(and(eq(requests.callId,caller.id),eq(requests.state,"returned")));
 if(!physical.some(({request,fact})=>request.descriptor.kind===(input.configuration?"bucket.metadata":`inventory.${input.kind}`)&&transferDigest(request.descriptor.binding)===transferDigest(header.binding)&&transferDigest(request.descriptor.cursor??null)===transferDigest(input.cursor)&&fact.facts.stage===(input.configuration?"configuration":"inventory")&&fact.facts.detailDigest===wireDigest(input.configuration??input.page))||!physical.some(({fact})=>fact.facts.stage==="inventory_raw"&&fact.facts.detailDigest))transferConflict("Retain the exact full original provider response/page/cursor before appending its inventory.");
 const chain=await tx.select().from(pages).where(and(eq(pages.inventoryId,header.id),eq(pages.pass,input.pass),eq(pages.kind,input.kind))).orderBy(asc(pages.createdAt),asc(pages.id));
 if(input.configuration?chain.length>0:chain.length?chain.at(-1)!.nextCursor===null||transferDigest(chain.at(-1)!.nextCursor)!==transferDigest(input.cursor):input.cursor!==null)transferConflict("The original complete provider page chain cannot be replaced.");
 await tx.execute(sql`select set_config('freeholder.media_multipart_recovery_page_v1',${JSON.stringify(input.configuration??input.page)},true)`);
 const[saved]=await tx.insert(pages).values({inventoryId:header.id,callId:caller.id,pass:input.pass,kind:input.kind,cursor:input.cursor,cursorDigest:transferDigest(input.cursor),nextCursor:input.page?.next??null,pageDigest:transferDigest(input.configuration??input.page),membershipDigest:transferDigest(input.page?.entries.map(entry=>transferDigest(entry))??[]),entryCount:input.page?.entries.length??0,configuration:input.configuration}).returning();
 if(input.page?.entries.length)await tx.insert(entries).values(input.page.entries.map((entry,ordinal)=>({inventoryId:header.id,pageId:saved!.id,ordinal,pass:input.pass,entry,entryDigest:transferDigest(entry),keyDigest:objectKeyDigest(entry.key),resourceDigest:inventoryResourceDigest(entry),attribution:"unattributed"as const})));
 return{ok:true as const};
}
export async function finishAppliedMultipartInventory(tx:Tx,input:RecoveryInput&{inventoryId:string}){
 const original=await lockedAppliedMultipartInventory(tx,input),header=original.inventory;if(header.state!=="capturing")return header;
 const first=await readProviderInventoryPass(tx,header,0),confirmed=await readProviderInventoryPass(tx,header,1);
 if(original.kind==="create")requireKnownOriginalEmptySession({key:original.key,uploadId:original.resource.providerUploadId!,first,confirmed});
 else requireAppliedOriginalMultipartObject({creation:original.creationProof,actual:original.actual,parts:original.operation.parts,expectedRevision:original.expectedRevision,uploadId:original.resource.providerUploadId!,namespace:original.binding.namespace,key:original.key,bytes:original.resource.expectedBytes,first,confirmed});
 const firstDigest=providerInventoryDigest(first.configuration,first.entries),confirmedDigest=providerInventoryDigest(confirmed.configuration,confirmed.entries),[saved]=await tx.update(inventories).set({state:"complete",firstDigest,confirmedDigest,configuration:first.configuration,entryCount:first.entries.length,totalBytes:physicalInventoryBytes(first.configuration,first.entries),completedAt:new Date(),updatedAt:new Date()}).where(eq(inventories.id,header.id)).returning();return saved!;
}
