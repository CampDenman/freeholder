// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: queue a bounded immutable step, never an uncertain mutation retry.
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {enqueueJob,type JobExecutionContext} from "@/core/jobs";
import {actorString} from "@/core/service";
import {mediaStorageTransferJobs} from "./transfer-schema";
import {defineMediaService} from "./guarded-service";
import {lockedTransfer} from "./transfer-authority";
import {advanceStorageTransfer} from "./transfer-service";
import {transferConflict,transferDigest} from "./transfer-proof";
import {withStorageTransferJob} from "./transfer-job-scope";
export const TRANSFER_STEP_JOB="core.advanceMediaStorageTransfer";
const payload=z.object({id:z.uuid(),originalJobId:z.uuid(),requestKey:z.uuid(),manifestDigest:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(["copy","adopt","retire"]),objectId:z.uuid().nullable()});
export const queueStorageTransferStep=defineMediaService({name:"media.queueStorageTransferStep",summary:"Queue one exact already-authorized original transfer phase with no automatic physical retries.",kind:"mutation",permission:"scoped",writeClass:"destructive",input:z.object({id:z.uuid(),requestKey:z.uuid(),action:z.enum(["copy","adopt","retire"])}),output:z.object({id:z.uuid(),jobId:z.uuid()}),auditInputFields:["id","requestKey","action"],handler:async(input,ctx)=>{
 const{plan,objects}=await lockedTransfer(ctx.tx,input.id);
 const[prior]=await ctx.tx.select().from(mediaStorageTransferJobs).where(eq(mediaStorageTransferJobs.requestKey,input.requestKey)).limit(1);
 if(prior){if(prior.planId!==plan.id||prior.action!==input.action||prior.manifestDigest!==plan.manifestDigest)transferConflict("The first queued transfer request has different original scope.");ctx.setSubject("media_storage_transfer",plan.id);return{id:plan.id,jobId:prior.jobId};}
 const object=input.action==="adopt"?undefined:objects.find(row=>input.action==="copy"?["planned","copying"].includes(row.state):["adopted","cleanup_pending"].includes(row.state));
 if(input.action!=="adopt"&&!object)transferConflict("No original object remains for this queued transfer phase.");
 const originalJobId=randomUUID(),data={id:plan.id,originalJobId,requestKey:input.requestKey,manifestDigest:plan.manifestDigest,action:input.action,objectId:object?.id??null},job=await enqueueJob(ctx.tx,TRANSFER_STEP_JOB,data,{id:originalJobId,idempotencyKey:`storage-transfer-step:${input.requestKey}`});
 await ctx.tx.insert(mediaStorageTransferJobs).values({jobId:job.id,requestKey:input.requestKey,planId:plan.id,objectId:object?.id??null,action:input.action,manifestDigest:plan.manifestDigest,payloadDigest:transferDigest(data),createdBy:actorString(ctx.actor)});
 ctx.setSubject("media_storage_transfer",plan.id);return{id:plan.id,jobId:job.id};
}});
export async function executeQueuedStorageTransfer(data:Record<string,unknown>,context:JobExecutionContext){
 const input=payload.parse(data);if(context.id!==input.originalJobId||context.name!==TRANSFER_STEP_JOB)transferConflict("The original transfer job identity does not match its admitted worker.");
 await context.throwIfCancelled();
 await db().transaction(async tx=>{
  const{plan,objects}=await lockedTransfer(tx,input.id),[admitted]=await tx.select().from(mediaStorageTransferJobs).where(eq(mediaStorageTransferJobs.jobId,input.originalJobId)).limit(1);
  if(!admitted||admitted.planId!==input.id||admitted.objectId!==input.objectId||admitted.action!==input.action||admitted.requestKey!==input.requestKey||admitted.manifestDigest!==input.manifestDigest||admitted.payloadDigest!==transferDigest(input))transferConflict("The queued payload has no matching original business-service admission.");
  const rows=await tx.execute(sql`select job.id from pgboss.job job join job_idempotency_keys identity on identity.job_id=job.id and identity.job_name=job.name where job.id=${input.originalJobId}::uuid and job.name=${TRANSFER_STEP_JOB} and job.state='active' and job.data=${JSON.stringify(input)}::jsonb and identity.idempotency_key=${`storage-transfer-step:${input.requestKey}`} and exists(select 1 from audit_log audit where audit.action='media.queueStorageTransferStep' and audit.subject_type='media_storage_transfer' and audit.subject_id=${input.id})`);
  if(rows.length!==1||plan.manifestDigest!==input.manifestDigest||input.objectId&&!objects.some(row=>row.id===input.objectId))transferConflict("The immutable original queued transfer scope cannot be reconstructed from current work.");
 });
 return withStorageTransferJob(context,()=>advanceStorageTransfer.call({id:input.id,action:input.action,objectId:input.objectId??undefined},{kind:"system"}));
}
