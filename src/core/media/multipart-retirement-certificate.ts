// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: a new system certificate of actual original retirement.
// This never fills an old review/FIN or authorizes raw evidence minimization.
import {and,eq,isNotNull,sql} from "drizzle-orm";
import {z} from "zod";
import type {Tx} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {lockTransferInventory} from "./transfer-authority";
import {mediaStorageTransferReviews as reviews} from "./transfer-schema";
import {requireOriginalMultipartRetirementProof,type OriginalMultipartRetirementProof} from "./multipart-retirement-certificate-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const originalMultipartRetirementAdmission=z.object({resourceId:z.uuid(),uploadId:z.uuid(),keyDigest:digest,operationId:z.uuid(),inventoryId:z.uuid(),proofDigest:digest}).strict();
export type OriginalMultipartRetirementAdmission=z.infer<typeof originalMultipartRetirementAdmission>;
async function currentProof(tx:Tx,operationId:string,inventoryId:string):Promise<OriginalMultipartRetirementProof>{
 await lockTransferInventory(tx);
 const[row]=await tx.execute<{proof:unknown}>(sql`select freeholder_media_multipart_retirement_payload(${operationId}::uuid,${inventoryId}::uuid) as proof`);
 if(!row?.proof)transferConflict("Preserve the original upload evidence until its complete retirement proof can be verified.");
 return requireOriginalMultipartRetirementProof(row.proof);
}
/** Call only after retiring the exact original resource in this transaction. */
export async function captureOriginalMultipartRetirementAdmission(tx:Tx,resourceId:string,uploadId:string,keyDigest:string,operationId:string,inventoryId:string):Promise<OriginalMultipartRetirementAdmission>{
 const proof=await currentProof(tx,operationId,inventoryId);
 if(proof.resource.id!==resourceId||proof.resource.uploadId!==uploadId||proof.resource.keyDigest!==keyDigest||proof.retirement.operationId!==operationId||proof.retirement.inventoryId!==inventoryId)transferConflict();
 return{resourceId,uploadId,keyDigest,operationId,inventoryId,proofDigest:transferDigest(proof)};
}
export const sealOriginalMultipartRetirement=defineMediaService({
 name:"media.sealOriginalMultipartRetirement",summary:"Seal independently derived original idle-upload retirement evidence without changing its first receipts.",kind:"mutation",permission:"system",external:false,agentCallable:false,
 input:originalMultipartRetirementAdmission,output:z.object({id:z.uuid(),proofDigest:digest}),auditInputFields:["resourceId","uploadId","operationId","inventoryId","proofDigest"],
 handler:async(input,ctx)=>{
  const proof=await currentProof(ctx.tx,input.operationId,input.inventoryId),proofDigest=transferDigest(proof);
  // Revalidate the entire frontier BEFORE dedup. A new hold, caller or fact is
  // debt even when the old historical certificate is still immutable/intact.
  if(proof.resource.id!==input.resourceId||proof.resource.uploadId!==input.uploadId||proof.resource.keyDigest!==input.keyDigest||proofDigest!==input.proofDigest)transferConflict("The original retirement evidence changed. Preserve its first certificate and review the new evidence.");
  const[existing]=await ctx.tx.select().from(reviews).where(and(eq(reviews.multipartOperationId,input.operationId),eq(reviews.providerEvidenceDigest,proofDigest),isNotNull(reviews.retirementProof))).limit(1);
  if(existing){const[current]=await ctx.tx.execute<{current_proof:boolean}>(sql`select freeholder_media_multipart_retirement_certificate_current(${existing.id}::uuid) as current_proof`);if(current?.current_proof!==true||transferDigest(existing.retirementProof)!==proofDigest)transferConflict();ctx.setSubject("media_multipart_resource",input.resourceId);return{id:existing.id,proofDigest};}
  const caller=proof.callers.find(row=>row.id===proof.retirement.callerId);if(!caller)transferConflict();
  await ctx.tx.execute(sql`select set_config('freeholder.media_retirement_certificate_v1','derived-idle-retirement-v1',true)`);
  const[created]=await ctx.tx.insert(reviews).values({multipartOperationId:input.operationId,inventoryId:input.inventoryId,callId:proof.retirement.callerId,readCallId:proof.retirement.readCallId,outcome:"retired",permitsRetry:false,stopDrainId:proof.retirement.stopDrainId,originalCallWitness:transferDigest(caller),providerEvidenceDigest:proofDigest,reviewedBy:"system:media-retirement",retirementProof:proof}).returning({id:reviews.id});
  if(!created)transferConflict();ctx.setSubject("media_multipart_resource",input.resourceId);return{id:created.id,proofDigest};
 },
});
