// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C10.32/C11.08: quota belongs to actual immutable physical admissions.
import {and,eq,inArray,or,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls as calls,mediaStorageTransferObjects as objects,mediaStorageTransferPlans as plans,mediaStorageTransferReceipts as members} from "./transfer-schema";
import {storageQuotaObjects,storageQuotaState} from "./storage-quota-schema";
import {objectKeyDigest} from "./write-ledger";
import {transferConflict,transferDigest} from "./transfer-proof";
import {lockTransferInventory} from "./transfer-authority";
import {originalCapturedSourceRevision} from "./transfer-original-revision";
export type TransferQuotaSide="source"|"target";
export interface TransferQuotaRole{objectId:string;side:TransferQuotaSide;callId?:string}
export type TransferQuotaCharge=typeof storageQuotaObjects.$inferSelect;
/** Current rows are selected by actual immutable caller/receipt membership;
 * neither an equal raw key nor the caller's input object supplies authority. */
export async function transferQuotaOriginal(tx:Tx,role:TransferQuotaRole){
 await lockTransferInventory(tx);
 const[object]=await tx.select().from(objects).where(eq(objects.id,role.objectId)).limit(1).for("update");
 const[plan]=object?await tx.select().from(plans).where(eq(plans.id,object.planId)).limit(1).for("update"):[];
 if(!object||!plan)transferConflict("Restore the exact original transfer before changing its capacity.");
 const binding=role.side==="source"?plan.originalSource:plan.originalTarget,keyDigest=role.side==="source"?object.keyDigest:object.targetKeyDigest;
 let receiptIds:string[],physicalKey:string;
 if(role.side==="source"){
  const captured=await tx.select().from(members).where(eq(members.objectId,object.id));
  const originals=captured.filter(row=>{if(transferDigest(row.originalSnapshot)!==row.originalSnapshotDigest)transferConflict("Restore the intact first source receipt before quota recovery.");return row.originalSnapshot.operation==="put"&&row.originalSnapshot.state==="accepted"&&!row.originalSnapshot.deletedAt;});
  const key=originals[0]?.originalSnapshot.key;if(typeof key!=="string"||objectKeyDigest(key)!==keyDigest)transferConflict("The actual captured source key is unavailable; no current key can replace it.");
  const revision=originalCapturedSourceRevision(captured,key);
  if(revision.namespace!==binding.namespace||object.sourceRevision&&transferDigest(revision)!==transferDigest(object.sourceRevision))transferConflict("Source quota belongs to its exact captured provider generation.");
  physicalKey=key;receiptIds=originals.map(row=>row.receiptId);
 }else{
  if(!object.targetReceiptId){
   const callers=await tx.select({id:calls.id}).from(calls).where(and(eq(calls.objectId,object.id),eq(calls.kind,"target_put"))).limit(1);
   if(callers.length)transferConflict("Restore the actual target admission instead of adopting a current charge.");
   // A genuine never-admitted target has no quota ownership. The caller still
   // checks for a foreign charge; absence grants no remote writer closure.
   return{object,plan,binding,keyDigest,physicalKey:object.targetKey,caller:null,receipt:null};
  }
  physicalKey=object.targetKey;receiptIds=[object.targetReceiptId];
 }
 const receipts=receiptIds.length?await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,receiptIds)):[];
 if(receipts.length!==receiptIds.length)transferConflict("Restore every captured original quota receipt.");
 const actual=receiptIds.length?await tx.select().from(calls).where(and(or(inArray(calls.physicalReceiptId,receiptIds),inArray(calls.objectReceiptId,receiptIds)),inArray(calls.kind,["ordinary_put","target_put"]))).for("update"):[];
 const matching=actual.filter(caller=>{const receipt=receipts.find(row=>row.id===(caller.physicalReceiptId??caller.objectReceiptId));return receipt&&caller.runtimeId===receipt.writerRuntimeId&&caller.namespace===binding.namespace&&receipt.namespace===binding.namespace&&receipt.keyDigest===keyDigest&&receipt.sha256===object.sha256&&receipt.bytes===object.bytes&&(role.side==="source"||caller.kind==="target_put"&&caller.objectId===object.id)&&(!role.callId||caller.id===role.callId);});
 if(matching.length!==1||actual.some(caller=>!matching.some(row=>row.id===caller.id)))transferConflict("The original quota caller is absent or ambiguous; no latest/current generation may be selected.");
 const caller=matching[0]!,receipt=receipts.find(row=>row.id===(caller.physicalReceiptId??caller.objectReceiptId));if(!receipt||!receipt.originalReservationId)transferConflict("Keep the actual original reservation before changing quota.");
 return{object,plan,binding,keyDigest,physicalKey,caller,receipt};
}
export async function transferQuotaCharge(tx:Tx,original:Awaited<ReturnType<typeof transferQuotaOriginal>>):Promise<TransferQuotaCharge|undefined>{
 await tx.select().from(storageQuotaState).where(eq(storageQuotaState.namespace,original.binding.namespace)).for("update");
 const rows=await tx.select().from(storageQuotaObjects).where(and(eq(storageQuotaObjects.namespace,original.binding.namespace),sql`encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(${storageQuotaObjects.objectKey},'UTF8')),'hex')=${original.keyDigest}`)).for("update");
 if(rows.length>1)transferConflict("Conflicting original quota locators need recovery.");
 const row=rows[0],token=original.caller?.quotaToken;
 if(!token){if(row)transferConflict("An admission without a quota token cannot adopt an equal-key charge.");return undefined;}
 if(!row||row.pendingToken!==token&&row.lastSettledToken!==token)transferConflict("Restore the exact original quota token; another current generation cannot replace it.");
 return row;
}
/** Pure accounting decision only; actual SQL physical-role proof must be
 * independently checked before this can authorize any UPDATE or dedup. */
export function transferQuotaReleaseDecision(token:string,bytes:number,row:Pick<TransferQuotaCharge,"bytes"|"pendingToken"|"lastSettledToken">,closedPriorTokens:readonly string[]):"release"|"already_released"{
 if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.pendingToken!==null&&row.pendingToken!==token||row.pendingToken===null&&row.lastSettledToken!==token||row.lastSettledToken!==null&&row.lastSettledToken!==token&&!closedPriorTokens.includes(row.lastSettledToken)||row.bytes!==0&&row.bytes<bytes)transferConflict("The actual original token/byte bound changed before physical-role retirement.");
 return row.bytes===0&&row.pendingToken===null&&row.lastSettledToken===token?"already_released":"release";
}
export async function proveTransferQuotaRelease(tx:Tx,original:Awaited<ReturnType<typeof transferQuotaOriginal>>,side:TransferQuotaSide,row:TransferQuotaCharge):Promise<string[]>{
 const token=original.caller?.quotaToken;if(!token)transferConflict();
 const tokens=[...new Set([token,...[row.pendingToken,row.lastSettledToken].filter((value):value is string=>value!==null)])],closed:string[]=[];
 for(const retained of tokens){
  const owners=await tx.select({id:calls.id}).from(calls).where(and(eq(calls.namespace,original.binding.namespace),eq(calls.quotaToken,retained))).limit(2);
  if(owners.length!==1)transferConflict("A retained quota token has no unique original physical caller.");
  const[proof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_transfer_quota_release_proven(${original.object.id}::uuid,${owners[0]!.id}::uuid,${retained}::uuid,${side}) as proven`);
  if(proof?.proven!==true)transferConflict("Keep this exact original quota charge until current physical-role retirement is proven.");closed.push(retained);
 }
 return closed;
}
/** A genuine not-attempted prior target may retry its SAME original logical
 * object. The OLD row's token identifies that object; a matching key alone
 * cannot choose it. New caller/token insertion still commits in the caller TX. */
export async function retirePriorTransferQuota(tx:Tx,namespace:string,key:string,bytes:number,token:string):Promise<string>{
 const owners=await tx.select().from(calls).where(and(eq(calls.namespace,namespace),eq(calls.quotaToken,token))).limit(2);
 const owner=owners[0];if(owners.length!==1||!owner?.objectId||owner.kind!=="target_put")transferConflict("An occupied quota key needs its exact original target admission.");
 const original=await transferQuotaOriginal(tx,{objectId:owner.objectId,side:"target",callId:owner.id});
 if(original.binding.namespace!==namespace||original.keyDigest!==objectKeyDigest(key)||original.object.bytes!==bytes)transferConflict("A retry cannot adopt another physical quota generation.");
 const row=await transferQuotaCharge(tx,original);if(!row)transferConflict();
 const closed=await proveTransferQuotaRelease(tx,original,"target",row);
 if(transferQuotaReleaseDecision(token,bytes,row,closed)==="release"){
  const changed=await tx.execute(sql`update storage_quota_objects set bytes=0,pending_token=null,last_settled_token=${token}::uuid where namespace=${namespace} and object_key=${row.objectKey} and bytes=${row.bytes} and pending_token is not distinct from ${row.pendingToken}::uuid and last_settled_token is not distinct from ${row.lastSettledToken}::uuid returning object_key`);
  if(changed.length!==1)transferConflict("The actual prior quota token changed before its same-original retry.");
 }
 return token;
}
