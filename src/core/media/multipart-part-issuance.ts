// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Each attempt has a NEW actual local caller and immutable nonce. A minted
// URL remains authority after local FIN, client loss or expiry observations.
import {createHash} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {actorString,type Actor,type ServiceContext} from "@/core/service";
import {mediaMultipartOperations} from "./multipart-schema";
import {withOriginalPartDisposition,markOriginalPartReturned} from "./multipart-part-disposition";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";
import {mediaWriterRuntimeId} from "./physical-caller-runtime";
import {admitOriginalMultipartCaller,originalMultipartCaller,retainOriginalMediaCallerReturn} from "./provider-callers";
import {lockMultipartUpload,originalMultipart} from "./multipart-operations";
import {assertDurableMultipartPartIssuance} from "./multipart-part-authority";
import {observeTransferRequest,TransferRequestNotAttemptedError,withTransferRequestScope} from "./transfer-requests";
import {transferConflict,transferDigest} from "./transfer-proof";
import {allowMediaReceiptWrites} from "./write-ledger";
import {requireTransferCapability} from "./transfer-authority";
import type {OriginalMultipartPartIssue} from "./multipart-part-issue-types";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function claimOriginalPartIssuance(ctx:ServiceContext,uploadId:string,partNumber:number){
 await assertDurableMultipartPartIssuance(ctx.tx);
 const{resource,upload}=await lockMultipartUpload(ctx.tx,uploadId);
 const creation=await ctx.tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),eq(mediaMultipartOperations.kind,"create"))).limit(2).for("update"),parent=creation[0];
 const[proof]=parent?await ctx.tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_part_body_context(${parent.id}::uuid) as proven`):[];
 const body=parent?.partBodies?.parts.find(part=>part.partNumber===partNumber);
 const[birth]=await ctx.tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_checksum_birth(${resource.id}::uuid) as proven`);
 if(birth?.proven!==true||creation.length!==1||!parent?.partBodies||proof?.proven!==true||!body||!resource.providerUploadId)transferConflict("Select and verify the same complete original file before requesting upload links.");
 const previous=await ctx.tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.resourceId,resource.id),eq(mediaMultipartOperations.kind,"sign"))).limit(50001).for("update");
 if(previous.length>50000)transferConflict("The complete original issuer history exceeds this bounded review.");
 const stillPending=new Set<string>();
 for(const row of previous.filter(row=>["started","unknown"].includes(row.state))){
  const[withheldProof]=await ctx.tx.execute<{withheld:boolean}>(sql`select freeholder_media_multipart_withheld_issue(${row.id}::uuid) as withheld`);
  if(withheldProof?.withheld===true)await ctx.tx.update(mediaMultipartOperations).set({state:"withheld",updatedAt:new Date()}).where(eq(mediaMultipartOperations.id,row.id));
  else stillPending.add(row.id);
 }
 if(previous.some(row=>row.partIssue?.partNumber===partNumber&&stillPending.has(row.id)))transferConflict("A previous upload link still needs its original recovery evidence before another can be issued.");
 const expiresAt=new Date(Math.min(upload.expiresAt.getTime(),Date.now()+300000)).toISOString();
 const partIssue:OriginalMultipartPartIssue={format:"original-multipart-part-issue/v1",bodyManifestId:parent.partBodies.id,bodyManifestDigest:transferDigest(parent.partBodies),partNumber,sha256:body.sha256,bytes:body.bytes,expiresAt};
 const[operation]=await ctx.tx.insert(mediaMultipartOperations).values({resourceId:resource.id,kind:"sign",state:"started",providerUploadId:resource.providerUploadId,partIssue,writerRuntimeId:mediaWriterRuntimeId,actor:actorString(ctx.actor)}).returning();
 await admitOriginalMultipartCaller(ctx.tx,operation!.id,"multipart_sign",ctx.actor);
 return{operationId:operation!.id,partNumber};
}
async function settlePartIssuance(operationId:string,state:"accepted"|"unknown"|"not_applied"|"withheld"){
 await db().transaction(async tx=>{
  await requireTransferCapability(tx);await allowMediaReceiptWrites(tx);
  const[operation]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,operationId)).limit(1).for("update");if(!operation||operation.kind!=="sign")transferConflict();
  // No provider acceptance timestamp or resource closure is ever set here.
  await tx.update(mediaMultipartOperations).set({state,updatedAt:new Date()}).where(eq(mediaMultipartOperations.id,operationId));
 });
}
export async function finishUnattemptedPartIssuance(operationId:string){
 const caller=originalMultipartCaller(operationId);
 if(!(await retainOriginalMediaCallerReturn(caller.id,caller.token,{notAttempted:true})).settled)transferConflict();
 await settlePartIssuance(operationId,"not_applied");
}
export async function issueOriginalMultipartPart(uploadId:string,operationId:string,actor:Actor){
 const caller=originalMultipartCaller(operationId);
 return withOriginalPartDisposition(caller,async()=>{
 let attempted=false;
 try{
  const captured=await originalMultipart(uploadId),[operation]=await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,operationId)).limit(1);
  if(!operation||operation.resourceId!==captured.resource.id||operation.kind!=="sign"||!operation.partIssue||!operation.providerUploadId||operation.providerUploadId!==captured.resource.providerUploadId||!captured.store.directMultipart)transferConflict();
  const issue=operation.partIssue;attempted=true;
  const result=await withTransferRequestScope({callId:caller.id,token:caller.token,runtimeIdentity:caller.runtimeIdentity,actor},()=>captured.store.directMultipart!.signPart(captured.resource.key,operation.providerUploadId!,issue.partNumber,undefined,{request:observeTransferRequest,sha256:issue.sha256,bytes:issue.bytes,expiresAt:issue.expiresAt}));
  if(!result.headers||!result.expiresAt||!result.capabilityDigest||!result.proof||result.proof.urlDigest!==hash(result.url)||result.proof.headersDigest!==transferDigest(result.headers)||result.proof.partNumber!==issue.partNumber||result.proof.sha256!==issue.sha256||result.proof.bytes!==issue.bytes||result.proof.expiresAt!==result.expiresAt||result.capabilityDigest!==transferDigest(result.proof))transferConflict("Keep the original upload link attempt for review; its actual signer result is incomplete.");
  if(!(await retainOriginalMediaCallerReturn(caller.id,caller.token,{capabilityDigest:result.capabilityDigest},actor)).settled)transferConflict();
  await settlePartIssuance(operationId,"accepted");
  markOriginalPartReturned(caller.id,caller.token);
  return{partNumber:issue.partNumber,url:result.url,method:result.method,headers:result.headers,expiresAt:new Date(result.expiresAt)};
 }catch(error){
  let notAttempted=!attempted||error instanceof TransferRequestNotAttemptedError;
  // Authentication and the actual ledger, not this catch or elapsed time,
  // decide whether dispatch was unattempted. This also handles an admission
  // fence/expired intent refusing BEFORE the local SDK signer is invoked.
  try{const retained=await retainOriginalMediaCallerReturn(caller.id,caller.token,{notAttempted:true});notAttempted=retained.settled;}catch{/* No authenticated unattempted proof: retain the original failure/debt. */}
  let withheld=false;
  if(!notAttempted){
   // The actual adapter mints locally and never sends this URL. Only this
   // still-owning catch may retain WITHHELD before throwing without a result.
   // An earlier success/FAILED return is immutable and cannot be reclassified.
   try{
    const physical=await db().select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,caller.id));
    if(physical.length===1){const actual=await db().select().from(mediaStorageTransferRequestObservations).where(eq(mediaStorageTransferRequestObservations.requestId,physical[0]!.id)),capabilities=actual.filter(row=>row.facts.stage==="capability");
     if(capabilities.length===1&&capabilities[0]!.facts.detailDigest)withheld=(await retainOriginalMediaCallerReturn(caller.id,caller.token,{withheldCapabilityDigest:capabilities[0]!.facts.detailDigest})).settled;
    }
   }catch{/* Missing/changed facts or any previous first result remain debt. */}
   if(!withheld)await retainOriginalMediaCallerReturn(caller.id,caller.token,{failed:true}).catch(()=>{});
  }
  await settlePartIssuance(operationId,notAttempted?"not_applied":withheld?"withheld":"unknown").catch(()=>{});throw error;
 }
 });
}
