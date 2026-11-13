// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual original quota tokens carry authority; current equal keys do not.
import {and,eq,inArray,isNotNull,or,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {db} from "@/core/db";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferRequests as requests,mediaStorageTransferRequestObservations as facts} from "./transfer-request-schema";
import {storageQuotaObjects,storageQuotaState} from "./storage-quota-schema";
import {requireTransferCapability} from "./transfer-authority";
import {objectKeyDigest} from "./write-ledger";
import {transferConflict} from "./transfer-proof";
type Caller=typeof calls.$inferSelect;
/** No admission can spend capacity while an original reserved caller's bytes
 * lost their matching charge. The current reserve's uncommitted new token is
 * excluded only while its own row/token are being inserted in this same TX. */
export async function assertOriginalQuotaCoverage(tx:Tx,namespace:string,newToken:string):Promise<void>{
 const debt=await tx.execute<{id:string}>(sql`select caller.id from media_storage_transfer_calls caller join media_object_writes original on original.id=coalesce(caller.physical_receipt_id,caller.object_receipt_id) where caller.namespace=${namespace} and caller.quota_token is not null and caller.quota_token<>${newToken}::uuid and original.deleted_at is null and (exists(select 1 from media_storage_transfer_requests request join media_storage_transfer_request_observations observation on observation.request_id=request.id where request.call_id=caller.id and observation.facts->>'stage'='metadata' and observation.facts->'revision' is not null and original.provider_revision_digest is not null and freeholder_media_transfer_fact_digest(observation.facts->'revision')<>original.provider_revision_digest) or not exists(select 1 from storage_quota_objects quota where quota.namespace=caller.namespace and (quota.pending_token=caller.quota_token or quota.last_settled_token=caller.quota_token) and quota.bytes>=original.bytes and encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(quota.object_key,'UTF8')),'hex')=original.key_digest)) limit 1`);
 if(debt.length)transferConflict("An exact original quota reservation or late physical charge remains unresolved. Reconcile that original token before admitting more bytes in this namespace.");
}
/** Export only token-bound proof metadata, never raw shared quota locators. */
export async function originalQuotaProof(tx:Tx,originalCallers:readonly Caller[]){
 const captured=originalCallers.filter(row=>row.quotaToken),tokens=captured.flatMap(row=>row.quotaToken?[row.quotaToken]:[]);if(!tokens.length)return[];
 const parents=[...new Set(captured.flatMap(row=>row.physicalReceiptId?[row.physicalReceiptId]:row.objectReceiptId?[row.objectReceiptId]:[]))],originals=parents.length?await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,parents)):[];
 const rows=await tx.select().from(storageQuotaObjects).where(or(inArray(storageQuotaObjects.pendingToken,tokens),inArray(storageQuotaObjects.lastSettledToken,tokens)));
 return captured.map(caller=>{
  const parent=originals.find(row=>row.id===(caller.physicalReceiptId??caller.objectReceiptId));if(!parent||parent.namespace!==caller.namespace)transferConflict("Restore the exact original quota resource receipt before exporting its token proof.");
  const matching=rows.filter(row=>row.namespace===caller.namespace&&(row.pendingToken===caller.quotaToken||row.lastSettledToken===caller.quotaToken)),exact=matching.filter(row=>objectKeyDigest(row.objectKey)===parent.keyDigest);
  return{callId:caller.id,originalToken:caller.quotaToken,namespace:caller.namespace,conflicting:matching.length!==exact.length,missingCharge:!parent.deletedAt&&!exact.length,charges:exact.map(row=>({keyDigest:parent.keyDigest,bytes:row.bytes,pendingToken:row.pendingToken,settledToken:row.lastSettledToken}))};
 });
}
export async function originalQuotaLocatorPending(tx:Tx,originalCallers:readonly Caller[]):Promise<boolean>{
 const proof=await originalQuotaProof(tx,originalCallers);return proof.some(row=>row.conflicting||row.missingCharge||row.charges.length>0);
}
export function originalQuotaChargeDecision(token:string,bytes:number,current:{bytes:number;pendingToken:string|null;lastSettledToken:string|null}|undefined,reopened:boolean):"conflict"|"insert"|"restore"|"retain"{
 if(!Number.isSafeInteger(bytes)||bytes<0||current&&(!Number.isSafeInteger(current.bytes)||current.bytes<0))return"conflict";
 if(!current)return"insert";
 if(current.pendingToken!==token&&(current.pendingToken!==null||current.lastSettledToken!==token))return"conflict";
 return current.bytes<bytes||reopened&&current.pendingToken!==token?"restore":"retain";
}
/** Actual positive facts/physical finish have ALREADY committed. A conflicting
 * current charge is retained and freezes namespace admission; it never causes
 * those original physical facts to roll back or rebind another token. */
export async function reconcileActualOriginalQuota(receiptId:string):Promise<boolean>{
 return db().transaction(async tx=>{
  await requireTransferCapability(tx);await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
  const[parent]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,receiptId)).limit(1).for("update");if(!parent||parent.bytes===null)return true;
  const originals=await tx.select().from(calls).where(and(or(eq(calls.physicalReceiptId,receiptId),eq(calls.objectReceiptId,receiptId)),inArray(calls.kind,["ordinary_put","target_put"]),isNotNull(calls.quotaToken))).for("update");
  for(const caller of originals){
   if(!caller.quotaToken||!caller.observedAcceptedAt||parent.deletedAt)continue;
   let key=!parent.key.startsWith("retained:")&&objectKeyDigest(parent.key)===parent.keyDigest?parent.key:undefined;
   if(!key){const actual=await tx.select({fact:facts.facts}).from(requests).innerJoin(facts,eq(facts.requestId,requests.id)).where(eq(requests.callId,caller.id));key=actual.map(row=>row.fact.revision).find(revision=>revision?.namespace===caller.namespace&&objectKeyDigest(revision.key)===parent.keyDigest)?.key;}
   if(!key)return false;
   const[state]=await tx.select().from(storageQuotaState).where(eq(storageQuotaState.namespace,caller.namespace)).limit(1).for("update");if(!state)return false;
   const[charge]=await tx.select().from(storageQuotaObjects).where(and(eq(storageQuotaObjects.namespace,caller.namespace),eq(storageQuotaObjects.objectKey,key))).limit(1).for("update");
   const decision=originalQuotaChargeDecision(caller.quotaToken,parent.bytes,charge,caller.state==="unknown"||Boolean(caller.stoppedAt));if(decision==="conflict")return false;
   if(decision==="insert"){await tx.insert(storageQuotaObjects).values({namespace:caller.namespace,objectKey:key,bytes:parent.bytes,pendingToken:caller.quotaToken});}
   else if(decision==="restore"&&charge)await tx.update(storageQuotaObjects).set({bytes:Math.max(charge.bytes,parent.bytes),pendingToken:caller.quotaToken}).where(and(eq(storageQuotaObjects.namespace,caller.namespace),eq(storageQuotaObjects.objectKey,key)));
  }
  return true;
 });
}
