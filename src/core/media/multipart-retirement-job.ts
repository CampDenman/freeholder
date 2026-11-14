// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: only the actual retirement TX can queue its fixed safe proof.
import {sql} from "drizzle-orm";
import {enqueueJob,type JobExecutionContext} from "@/core/jobs";
import {actualWorkerExecution,requireActualWorkerExecution} from "@/core/jobs/execution-scope";
import type {Tx} from "@/core/service";
import {originalMultipartRetirementAdmission,originalMultipartRetirementJobKey,ORIGINAL_MULTIPART_RETIREMENT_JOB,type OriginalMultipartRetirementAdmission} from "./multipart-retirement-admission";
import {transferConflict} from "./transfer-proof";
/** No service call, new connection or provider operation is opened here.
 * Retirement and this transaction-aware queue/claim commit together. */
export async function queueOriginalMultipartRetirement(tx:Tx,value:OriginalMultipartRetirementAdmission):Promise<void>{
 const input=originalMultipartRetirementAdmission.parse(value);
 const[birth]=await tx.execute<{proven:boolean}>(sql`select exists(select 1 from media_multipart_resources resource join media_multipart_operations operation on operation.resource_id=resource.id where resource.id=${input.resourceId}::uuid and resource.upload_id=${input.uploadId}::uuid and resource.key_digest=${input.keyDigest} and operation.id=${input.operationId}::uuid and resource.state='aborted' and resource.retired_at=transaction_timestamp() and freeholder_media_transfer_fact_digest(freeholder_media_multipart_retirement_payload(operation.id,${input.inventoryId}::uuid))=${input.proofDigest}) as proven`);
 if(birth?.proven!==true)transferConflict("Only the transaction that actually retires this exact original upload may queue its unchanged proof.");
 await enqueueJob(tx,ORIGINAL_MULTIPART_RETIREMENT_JOB,input,{idempotencyKey:originalMultipartRetirementJobKey(input)});
 await assertOriginalMultipartRetirementJob(tx,input);
}
/** A supplied queue payload is not business authority. The actual resource's
 * original retirement timestamp, exact claim/hash, name and whole immutable
 * safe admission must all match, in addition to the service's full raw proof.
 * The flat strict string-only payload uses the queue's canonical JSON digest. */
export async function assertOriginalMultipartRetirementJob(tx:Tx,input:OriginalMultipartRetirementAdmission):Promise<void>{
 const worker=actualWorkerExecution(),ownedWorker=worker?.name===ORIGINAL_MULTIPART_RETIREMENT_JOB;
 if(worker&&ownedWorker)await requireActualWorkerExecution(worker);
 const rows=await tx.execute<{id:string}>(sql`select job.id from pgboss.job job join job_idempotency_keys identity on identity.job_id=job.id and identity.job_name=job.name join media_multipart_resources resource on resource.id=${input.resourceId}::uuid where job.name=${ORIGINAL_MULTIPART_RETIREMENT_JOB} and job.data=${JSON.stringify(input)}::jsonb and identity.idempotency_key=${originalMultipartRetirementJobKey(input)} and identity.payload_hash=encode(sha256(convert_to(freeholder_source_receipt_canonical(job.data),'UTF8')),'hex') and identity.created_at=job.created_on and resource.retired_at=job.created_on and resource.upload_id=${input.uploadId}::uuid and resource.key_digest=${input.keyDigest} and job.state in ('created','retry','active','completed') and (${!ownedWorker} or job.id=${worker?.id??null}::uuid and job.state='active')`);
 if(rows.length!==1)transferConflict("Restore the exact original retirement job and claim; a supplied or later queued payload cannot replace its first admission.");
}
export async function executeOriginalMultipartRetirementJob(data:Record<string,unknown>,context:JobExecutionContext):Promise<{id:string;proofDigest:string}>{
 const input=originalMultipartRetirementAdmission.parse(data);
 await requireActualWorkerExecution(context);
 if(context.name!==ORIGINAL_MULTIPART_RETIREMENT_JOB)transferConflict("The original retirement job belongs to another worker.");
 // .call is outside a TX. The shared service opens its own ordinary short TX,
 // rechecks raw proof/holds and this exact active job BEFORE dedup, then audits.
 const{sealOriginalMultipartRetirement}=await import("./multipart-retirement-certificate");
 return sealOriginalMultipartRetirement.call(input,{kind:"system"});
}
