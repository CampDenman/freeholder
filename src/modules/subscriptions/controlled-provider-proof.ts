// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual new controlled callers never borrow legacy phase or later-reader proof.
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { verifiedProviderReadProof } from "./provider-read-signatures";
import { subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts,subscriptionControlledFinishes,subscriptionControlledStops,subscriptionControlledVerifications,subscriptionControlledChargeOrigins,subscriptionControlledClosures } from "./controlled-provider-schema";
export const CONTROLLED_CALL_PURPOSE="subscription_controlled_provider_caller.v1";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const controlledCaller=z.object({id:z.uuid(),pid:z.number().int().positive(),host:z.string().min(1).max(500),startedAt:z.iso.datetime(),bootId:z.string().nullable(),pidNamespace:z.string().nullable(),startTicks:z.string().nullable()}).strict();
type Operation=typeof subscriptionControlledOperations.$inferSelect;
type Call=typeof subscriptionControlledCalls.$inferSelect;
type Finish=typeof subscriptionControlledFinishes.$inferSelect;
type Stop=typeof subscriptionControlledStops.$inferSelect;
export function originalControlledCall(operation:Operation,call:Call){
 const proof=verifiedProviderReadProof(call.admission,"admission"),p=proof?.payload,birth=controlledCaller.safeParse(p?.caller);
 return proof&&p?.purpose===CONTROLLED_CALL_PURPOSE&&p.operationId===operation.id&&p.callId===call.id&&call.operationId===operation.id
  &&p.resourceId===operation.resourceId&&p.requestDigest===operation.requestDigest&&merchantTaxDigest(operation.originalRequest)===operation.requestDigest
  &&p.kind===operation.kind&&sha.safeParse(p.completionDigest).success&&p.admittedSourceRevision===operation.previousEvidenceRevision
  &&birth.success&&birth.data.id===p.callerId&&merchantTaxDigest(call.admission)===call.admissionDigest?proof:null;
}
export function finishedControlledCall(operation:Operation,call:Call,finish:Finish|null){
 if(!finish)return false;
 const original=originalControlledCall(operation,call),proof=verifiedProviderReadProof(finish.proof,"finish"),p=proof?.payload;
 return !!original&&!!proof&&finish.callId===call.id&&proof.publicKey===original.publicKey&&p?.purpose===CONTROLLED_CALL_PURPOSE&&p.callId===call.id
  &&p.operationId===operation.id&&p.resourceId===operation.resourceId&&p.requestDigest===operation.requestDigest&&p.admissionDigest===call.admissionDigest
  &&p.callerId===original.payload.callerId&&p.completionDigest===original.payload.completionDigest&&["returned","threw"].includes(String(p.outcome))
  &&p.outcome===finish.actualResult.outcome&&p.factsDigest===merchantTaxDigest(finish.actualResult)&&finish.proofDigest===merchantTaxDigest(finish.proof);
}
export function stoppedControlledCall(operation:Operation,call:Call,stop:Stop|null){
 if(!stop)return false;
 const original=originalControlledCall(operation,call),proof=verifiedProviderReadProof(stop.proof,"stop_review"),p=proof?.payload;
 return !!original&&!!proof&&stop.callId===call.id&&p?.purpose===CONTROLLED_CALL_PURPOSE&&p.callId===call.id&&p.operationId===operation.id&&p.resourceId===operation.resourceId
  &&p.requestDigest===operation.requestDigest&&p.admissionDigest===call.admissionDigest&&p.callerId===original.payload.callerId
  &&merchantTaxDigest(p.originalAdmission)===merchantTaxDigest(call.admission)&&typeof p.reviewedBy==="string"&&/^user:[a-f0-9-]{36}$/.test(p.reviewedBy)
  &&["original_process_absent","unobservable_host_review"].includes(String(p.mechanicalCheck))&&sha.safeParse(p.hostingEvidenceDigest).success&&sha.safeParse(p.currentEvidenceRevision).success
  &&stop.proofDigest===merchantTaxDigest(stop.proof);
}
/** A complete actual inventory is read before admitting another caller. No
 * latest-row projection can release an older unresolved original invocation. */
export async function controlledProviderJournal(tx:Tx,resourceId:string){
 const operations=await tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.resourceId,resourceId)).orderBy(subscriptionControlledOperations.ordinal).limit(5001);
 const ids=operations.map(row=>row.id);
 const calls=ids.length?await tx.select().from(subscriptionControlledCalls).where(inArray(subscriptionControlledCalls.operationId,ids)).orderBy(subscriptionControlledCalls.id).limit(5001):[];
 const callIds=calls.map(row=>row.id);
 const facts=callIds.length?await tx.select().from(subscriptionControlledFacts).where(inArray(subscriptionControlledFacts.callId,callIds)).orderBy(subscriptionControlledFacts.callId,subscriptionControlledFacts.ordinal).limit(5001):[];
 const finishes=callIds.length?await tx.select().from(subscriptionControlledFinishes).where(inArray(subscriptionControlledFinishes.callId,callIds)).orderBy(subscriptionControlledFinishes.callId).limit(5001):[];
 const stops=callIds.length?await tx.select().from(subscriptionControlledStops).where(inArray(subscriptionControlledStops.callId,callIds)).orderBy(subscriptionControlledStops.callId).limit(5001):[];
 const verifications=ids.length?await tx.select().from(subscriptionControlledVerifications).where(inArray(subscriptionControlledVerifications.operationId,ids)).orderBy(subscriptionControlledVerifications.operationId).limit(5001):[];
 verifications.sort((left,right)=>(operations.find(row=>row.id===left.operationId)?.ordinal??0)-(operations.find(row=>row.id===right.operationId)?.ordinal??0));
 const chargeOrigins=await tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.resourceId,resourceId)).orderBy(subscriptionControlledChargeOrigins.receiptId).limit(5001);
 const closures=await tx.select().from(subscriptionControlledClosures).where(eq(subscriptionControlledClosures.resourceId,resourceId)).limit(2);
 const count=1+closures.length+chargeOrigins.length+operations.length+calls.length+facts.length+finishes.length+stops.length+verifications.length;
 if(count>5000)throw new ServiceError("conflict","Restore the complete bounded original controlled caller/fact inventory; truncated history cannot authorize another operation.");
 if(operations.some((operation,index)=>operation.resourceId!==resourceId||operation.ordinal!==index+1||merchantTaxDigest(operation.originalRequest)!==operation.requestDigest)
  ||new Set(calls.map(row=>row.operationId)).size!==calls.length)throw new ServiceError("conflict","Restore every original contiguous operation and its single actual physical invocation.");
 for(const fact of facts){const siblings=facts.filter(row=>row.callId===fact.callId);
  if(fact.actualDigest!==merchantTaxDigest(fact.actual)||siblings.some((row,index)=>row.ordinal!==index+1))throw new ServiceError("conflict","Preserve the complete ordered original raw occurrences without replacement or truncation.");
 }
 for(const call of calls){const operation=operations.find(row=>row.id===call.operationId),finish=finishes.find(row=>row.callId===call.id)??null,stop=stops.find(row=>row.callId===call.id)??null;
  if(!operation||!originalControlledCall(operation,call)||finish&&!finishedControlledCall(operation,call,finish)||stop&&!stoppedControlledCall(operation,call,stop)||finish&&stop)
   throw new ServiceError("conflict","Restore authentic original controlled request/admission/actual finish or independent stop; never reconstruct or supersede it.");
 }
 for(const verification of verifications){const operation=operations.find(row=>row.id===verification.operationId),call=calls.find(row=>row.id===verification.callId),finish=finishes.find(row=>row.callId===verification.callId);
  if(!operation||!call||call.operationId!==operation.id||!finish||!finishedControlledCall(operation,call,finish)||finish.actualResult.outcome!=="returned"
   ||merchantTaxDigest(finish.actualResult.result)!==verification.actualResultDigest||merchantTaxDigest(verification.actualResult)!==verification.actualResultDigest)
   throw new ServiceError("conflict","A verified result must remain the exact actual original returned SDK value and signed caller.");
 }
 for(const origin of chargeOrigins){const operation=operations.find(row=>row.id===origin.operationId),call=calls.find(row=>row.id===origin.callId),fact=facts.find(row=>row.id===origin.factId);
  if(!operation||!call||!fact||origin.resourceId!==resourceId||call.operationId!==operation.id||fact.callId!==call.id||fact.actual.kind!=="cash_observed")
   throw new ServiceError("conflict","Preserve the exact canonical receipt's actual original resource, operation, caller and positive bank fact.");
 }
 if(closures.some(row=>row.proofDigest!==merchantTaxDigest(row.proof)))throw new ServiceError("conflict","Preserve the exact original financial closure receipt.");
 const unfinished=calls.filter(call=>!finishes.some(row=>row.callId===call.id)&&!stops.some(row=>row.callId===call.id)).map(row=>row.id);
 return {operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures,unfinished,count,revision:merchantTaxDigest({operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures})};
}
export async function assertControlledCallersQuiesced(tx:Tx,resourceId:string){
 const history=await controlledProviderJournal(tx,resourceId);
 if(history.unfinished.length)throw new ServiceError("conflict","The actual original controlled provider caller remains unfinished. Its genuine finish or independent actual runtime stop must precede a new caller.");
 return history;
}
/** Exact physical SQL fingerprints stay private. Full accounting of these
 * families must be composed with the original resource/profile/cash graph. */
export const controlledProviderSqlHash=(row:unknown)=>sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
