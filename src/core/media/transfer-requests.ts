// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual server scopes journal every object-provider request.
import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import {and,asc,eq,inArray,sql} from "drizzle-orm";
import type {TransferRequestDescriptor,TransferRequestObservation,TransferRequestObserver} from "../../../scripts/media-transfer.mjs";
import {db} from "@/core/db";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {actorString,type Actor,type Tx} from "@/core/service";
import {projectOriginalMultipartSessionObservation,reconcileOriginalMultipartPositivePointer,originalSessionObservationDecision} from "./multipart-session-observation";
import {assertMediaActorLive} from "./upload-ownership";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferReceipts} from "./transfer-schema";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {mediaObjects} from "./schema";
import {reconcileMediaErasureCohorts} from "./erasure-cohorts";
import {reconcileCommittedStorageObservation} from "./observation-hooks";
import {objectKeyDigest} from "./write-ledger";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";
import {assertTransferNamespaceMutation} from "./transfer-namespace-control";
import {assertOriginalKeyCreator} from "./original-key-tombstone";
import {assertOriginalNamespaceMutation} from "./original-namespace-fence";
import {requireTransferCapability} from "./transfer-authority";
import {transferConflict,transferDigest,transferTargetKey} from "./transfer-proof";
import {checkStorageTransferJob} from "./transfer-job-scope";
import type {StorageCallerRuntimeIdentity} from "./physical-caller-runtime";
interface Scope {callId:string;token:string;runtimeIdentity:StorageCallerRuntimeIdentity;actor?:Actor;active:boolean;receiptIds:Set<string>;multipartOperationIds:Set<string>}
const invocation=new AsyncLocalStorage<Scope>();
export class TransferRequestNotAttemptedError extends Error{constructor(readonly logicalCallId:string,cause:unknown){super("The original provider request was not attempted.",{cause});this.name="TransferRequestNotAttemptedError";}}
export async function withTransferRequestScope<T>(scope:Omit<Scope,"active"|"receiptIds"|"multipartOperationIds">,operation:()=>Promise<T>):Promise<T>{const current={...scope,active:true,receiptIds:new Set<string>(),multipartOperationIds:new Set<string>()};try{return await invocation.run(current,operation);}finally{current.active=false;}}
/** Last application-adapter fence. Possessing a function or a generic writer
 * flag is insufficient: the real observer, live scope and committed original
 * token/role/key must all match before the adapter can dispatch anything. */
export async function requireActualStorageMutation(observer:unknown,key:string,kind:"object.put"|"multipart.create"|"multipart.complete"|"multipart.abort"|"multipart.sign"):Promise<void>{
 const scope=invocation.getStore();if(observer!==observeTransferRequest||!scope?.active)transferConflict("Start storage work through its shared upload or recovery service; no original caller is active.");
 await db().transaction(async tx=>{const caller=await locked(tx,scope),kinds=kind==="object.put"?["ordinary_put","target_put"]:[kind.replace(".","_")];if(!scope.active||caller.state!=="admitted"||caller.physicalKey!==key||!kinds.includes(caller.kind))transferConflict("The storage operation does not belong to its genuine original caller, role and file key.");});
}
async function locked(tx:Tx,scope:Scope){
 await requireTransferCapability(tx);await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
 const[call]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,scope.callId)).limit(1).for("update");
 if(!call||call.callerTokenDigest!==transferDigest(scope.token) )transferConflict("The actual original provider request has no active server-held caller.");return call;
}
function mutation(descriptor:TransferRequestDescriptor){return ["object.put","object.delete","multipart.create","multipart.complete","multipart.abort","multipart.sign"].includes(descriptor.kind);}
async function admit(scope:Scope,descriptor:TransferRequestDescriptor,token:string){
 await checkStorageTransferJob();return db().transaction(async tx=>{
  await lockContactIdentityForRead(tx);
  const call=await locked(tx,scope);
  if(call.kind==="multipart_sign"){if(!scope.actor)transferConflict("The actual local signer needs its owning server-resolved principal.");await assertMediaActorLive(tx,scope.actor);}
  if(!scope.active||call.state!=="admitted"||descriptor.binding.namespace!==call.namespace||descriptor.key&&descriptor.key!==call.physicalKey)transferConflict("The physical request does not belong to its exact original logical caller.");
  if(call.objectId===null&&mutation(descriptor))await assertOriginalNamespaceMutation(tx,call.namespace);
  if(call.objectId!==null&&mutation(descriptor))await assertTransferNamespaceMutation(tx,call.objectId,call.namespace,call.kind);
  if(["object.put","multipart.create","multipart.complete","multipart.sign"].includes(descriptor.kind))await assertOriginalKeyCreator(tx,{namespace:descriptor.binding.namespace,key:descriptor.key??"",role:descriptor.kind==="multipart.sign"?"multipart_part":descriptor.kind==="object.put"?(call.kind==="target_put"?"target_put":"ordinary_put"):descriptor.kind==="multipart.create"?"multipart_create":"multipart_complete"});
  const inventory=descriptor.kind.startsWith("inventory.")||descriptor.kind==="bucket.metadata";
  if(inventory&&!["source_inventory","target_inventory","source_retirement_inventory","target_erasure_inventory","source_erasure_inventory","ordinary_retirement_inventory","multipart_retirement_inventory","multipart_recovery_inspect","multipart_create"].includes(call.kind))transferConflict();
  if(inventory&&call.kind==="multipart_create"){
   const[parent]=call.multipartOperationId?await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1):[];
   const prior=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,call.id));
   if(!parent?.createBaseline||parent.createBaseline.state!=="capturing"||parent.createBaseline.callId!==call.id||prior.some(row=>mutation(row.descriptor)))transferConflict("Only the new original CREATE may collect its first pre-dispatch baseline; an old caller cannot scan and acquire another birth.");
  }
  if(descriptor.expectedRevision&&descriptor.kind!=="object.body"&&(!call.expectedRevision||transferDigest(descriptor.expectedRevision)!==transferDigest(call.expectedRevision))){
   const prior=["ordinary_put","multipart_complete"].includes(call.kind)?await tx.select({request:mediaStorageTransferRequests,fact:mediaStorageTransferRequestObservations}).from(mediaStorageTransferRequests).innerJoin(mediaStorageTransferRequestObservations,eq(mediaStorageTransferRequestObservations.requestId,mediaStorageTransferRequests.id)).where(and(eq(mediaStorageTransferRequests.callId,call.id),eq(mediaStorageTransferRequests.state,"returned"))):[];
   if(!["object.metadata","object.read"].includes(descriptor.kind)||!prior.some(row=>["object.put","multipart.complete"].includes(row.request.descriptor.kind)&&row.fact.facts.stage==="metadata"&&transferDigest(row.fact.facts.revision)===transferDigest(descriptor.expectedRevision)))transferConflict("The pinned provider request differs from its exact admitted original revision.");
  }
  if(descriptor.kind==="object.put"&&(!["target_put","ordinary_put"].includes(call.kind)||!descriptor.createOnly||!descriptor.sha256||descriptor.bytes===undefined))transferConflict("An original target write requires its exact create-only caller.");
  if(descriptor.kind==="object.put"){
   const[original]=call.physicalReceiptId?await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1):[];
   if(!original||original.sha256!==descriptor.sha256||original.bytes!==descriptor.bytes||original.namespace!==descriptor.binding.namespace||original.keyDigest!==objectKeyDigest(descriptor.key??""))transferConflict("The actual original write bytes differ from the immutable admitted payload.");
  }
  if(descriptor.kind.startsWith("multipart.")){
   const[parent]=call.multipartOperationId?await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1):[];
   const[resource]=parent?await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.id,parent.resourceId)).limit(1):[];
   if(!parent||!resource)transferConflict("An actual multipart request requires its original operation.");
   if(descriptor.kind==="multipart.create"&&(!parent.createBaseline||parent.createBaseline.state!=="complete"||parent.createBaseline.callId!==call.id||parent.createBaseline.namespace!==call.namespace||parent.createBaseline.keyDigest!==resource.keyDigest))transferConflict("The exact new original CREATE needs both complete pre-dispatch baseline passes.");
   if(descriptor.kind==="multipart.sign"){
    await(await import("./multipart-part-authority")).assertDurableMultipartPartIssuance(tx);
    const issue=parent.partIssue;if(parent.kind!=="sign"||!issue||descriptor.partNumber!==issue.partNumber||descriptor.bytes!==issue.bytes||descriptor.sha256!==issue.sha256||descriptor.expiresAt!==issue.expiresAt||Date.parse(issue.expiresAt)<=Date.now())transferConflict("The actual signature must match its exact original declared part and immutable issuance intent.");
    if(!scope.actor||parent.actor!==actorString(scope.actor))transferConflict("The original local issuer principal cannot be replaced after its admission.");
   }
   if(descriptor.kind==="multipart.complete"){const[proof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_multipart_verified_parts(${parent.id}::uuid) as proven`);if(proof?.proven!==true)transferConflict("Verify every original uploaded part before assembling this upload.");}
   if(descriptor.kind==="multipart.inspect"){
    if(call.kind==="multipart_complete"&&descriptor.partsDigest!==parent.partsDigest)transferConflict("The original completion may inspect only its immutable declared manifest.");
    if(!["multipart_recovery_inspect","multipart_create","multipart_complete","multipart_abort"].includes(call.kind)||!descriptor.uploadId||descriptor.uploadId!==(parent.providerUploadId??parent.observedProviderUploadId??resource.providerUploadId))transferConflict("Inspect only the original provider-acknowledged session.");
   }else if(call.kind!==descriptor.kind.replace(".","_")||descriptor.kind==="multipart.create"&&descriptor.contentType!==resource.contentType||descriptor.kind!=="multipart.create"&&(descriptor.uploadId!==parent.providerUploadId||descriptor.uploadId!==resource.providerUploadId)||descriptor.kind==="multipart.complete"&&(!descriptor.createOnly||descriptor.partsDigest!==parent.partsDigest))transferConflict("The actual multipart request differs from its immutable original session or manifest.");
  }
  if(descriptor.kind==="object.read"&&["multipart_complete","multipart_recovery_inspect"].includes(call.kind)){
   const[parent]=call.multipartOperationId?await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1):[];
   if(!parent||parent.kind!=="complete"||descriptor.partsDigest!==parent.partsDigest)transferConflict("The original completed file read must retain every original part boundary and checksum.");
  }
  if(descriptor.kind==="object.delete"&&(!["source_delete","privacy_delete","privacy_source_delete","ordinary_delete"].includes(call.kind)||!call.expectedRevision||transferDigest(descriptor.expectedRevision)!==transferDigest(call.expectedRevision)))transferConflict();
  if(descriptor.kind==="multipart.abort")await(await import("./multipart-idle-retirement-context")).assertIdleOriginalMultipartAbortRequest(tx,call,descriptor);
  if(descriptor.kind==="object.delete"&&call.kind==="ordinary_delete")await(await import("./original-retirement")).assertOrdinaryRetirementRequest(tx,call,descriptor);
  if(descriptor.kind==="object.body"){
   if(!descriptor.expectedRevision)transferConflict();
   const previous=await tx.select({request:mediaStorageTransferRequests,observation:mediaStorageTransferRequestObservations}).from(mediaStorageTransferRequests).innerJoin(mediaStorageTransferRequestObservations,eq(mediaStorageTransferRequestObservations.requestId,mediaStorageTransferRequests.id)).where(and(eq(mediaStorageTransferRequests.callId,call.id),eq(mediaStorageTransferRequests.state,"returned"))).orderBy(asc(mediaStorageTransferRequests.createdAt));
   if(!previous.some(row=>["object.metadata","object.put"].includes(row.request.descriptor.kind)&&row.observation.facts.stage==="metadata"&&transferDigest(row.observation.facts.revision)===transferDigest(descriptor.expectedRevision)))transferConflict("The pinned body has no actual finished original metadata request.");
  }
  const id=randomUUID();await tx.insert(mediaStorageTransferRequests).values({id,callId:call.id,descriptor,keyDigest:descriptor.key?objectKeyDigest(descriptor.key):null,descriptorDigest:transferDigest(descriptor),tokenDigest:transferDigest(token),runtimeIdentity:scope.runtimeIdentity});return id;
 });
}
async function observe(scope:Scope,id:string,token:string,facts:TransferRequestObservation){
 let receiptId:string|null=null;
 await db().transaction(async tx=>{
  const call=await locked(tx,scope),[request]=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.id,id)).limit(1).for("update");
  if(!request||request.callId!==call.id||request.tokenDigest!==transferDigest(token)||request.observationCount>=16)transferConflict();
  if(facts.revision&&(facts.revision.namespace!==call.namespace||objectKeyDigest(facts.revision.key)!==request.keyDigest))transferConflict();
  const late=request.state!=="admitted"||call.state!=="admitted";
  if(late&&!["accepted","metadata","body","response","session","response_body","capability"].includes(facts.stage))transferConflict("Only an actual late positive original provider fact can supersede a retired request.");
  if(request.descriptor.kind==="multipart.sign"){
   if(call.kind!=="multipart_sign"||!["capability","not_attempted"].includes(facts.stage)||facts.status!==null)transferConflict("Local signing cannot claim a provider acknowledgement or uploaded bytes.");
   if(facts.stage==="capability"){
    const proof=facts.capabilityProof;
    if(!proof||proof.format!=="original-multipart-part-capability/v1"||facts.requestProof?.id!==request.id||facts.requestProof.tokenDigest!==request.tokenDigest||proof.requestId!==request.id||proof.partNumber!==request.descriptor.partNumber||proof.sha256!==request.descriptor.sha256||proof.bytes!==request.descriptor.bytes||facts.sha256!==proof.sha256||facts.bytes!==proof.bytes||facts.expiresAt!==proof.expiresAt||!(/^[a-f0-9]{64}$/.test(proof.urlDigest))||!(/^[a-f0-9]{64}$/.test(proof.headersDigest))||facts.detailDigest!==transferDigest(proof)||!facts.uploadId||facts.uploadId!==request.descriptor.uploadId||proof.uploadIdDigest!==transferDigest(facts.uploadId)||!request.descriptor.expiresAt||!Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)>Date.parse(request.descriptor.expiresAt))transferConflict("Retain only the actual original local signer result for its exact declared body and deadline.");
    const[parent]=call.multipartOperationId?await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1):[];if(!parent)transferConflict();
    scope.multipartOperationIds.add(parent.id);
   }
  }else if(facts.stage==="capability")transferConflict("A local part capability belongs only to its original signer admission.");
  if(facts.stage==="parts_verified"){
   const[parent]=call.multipartOperationId?await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1):[];
   const pages=facts.partPageIds;
   if(late||call.kind!=="multipart_complete"||request.descriptor.kind!=="multipart.inspect"||!parent||parent.kind!=="complete"||facts.status!==200||facts.detailDigest!==parent.partsDigest||request.descriptor.partsDigest!==parent.partsDigest||facts.count!==parent.parts.length||!pages||pages.length<1||pages.length>11||pages.at(-1)!==request.id||new Set(pages).size!==pages.length)transferConflict("Part verification must retain the actual original complete page chain and declared manifest.");
   const prior=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.callId,call.id));
   if(prior.length!==pages.length||prior.some(row=>!pages.includes(row.id)||row.descriptor.kind!=="multipart.inspect"||row.descriptor.partsDigest!==parent.partsDigest||row.id!==request.id&&(row.state!=="returned"||!row.returnedAt)))transferConflict("The original upload-part verification has unresolved or unrelated physical reads.");
  }else if(facts.partPageIds)transferConflict("Original part-page identities belong only to the actual completed verification.");
  if(facts.partsDigest!==undefined&&(facts.stage!=="body"||request.descriptor.kind!=="object.read"||facts.partsDigest!==request.descriptor.partsDigest))transferConflict("Original file-part readback belongs only to its exact complete physical body request.");
  // Genuine old/partial body facts without this new certificate stay retained
  // as debt. Adoption independently requires exact complete part readback.
  if(facts.requestProof&&request.descriptor.kind==="object.put"&&(facts.requestProof.id!==request.id||facts.requestProof.tokenDigest!==request.tokenDigest))transferConflict("The actual original upload returned another request identity.");
  let positiveSession=false;
  if(facts.uploadId){
   positiveSession=Boolean(call.multipartOperationId&&["accepted","session"].includes(facts.stage));
   if(positiveSession)originalSessionObservationDecision({descriptor:request.descriptor,fact:facts,canonicalUploadId:null,observedUploadId:null});
   else if(typeof facts.uploadId!=="string"||!facts.uploadId||facts.uploadId.length>4096||/[\u0000-\u001f]/.test(facts.uploadId)||!request.descriptor.kind.startsWith("multipart.")||request.descriptor.kind!=="multipart.create"&&facts.uploadId!==request.descriptor.uploadId)transferConflict("The provider fact names a different original session.");
  }

  const ordinal=request.observationCount+1;
  await tx.insert(mediaStorageTransferRequestObservations).values({requestId:id,ordinal,facts,factsDigest:transferDigest(facts),bytes:facts.bytes});
  await tx.update(mediaStorageTransferRequests).set({observationCount:ordinal,...(late?{state:"unknown" as const}:{})}).where(eq(mediaStorageTransferRequests.id,id));
  if(positiveSession&&call.multipartOperationId){await projectOriginalMultipartSessionObservation(tx,{operationId:call.multipartOperationId,callId:call.id,requestId:id,fact:facts,late});scope.multipartOperationIds.add(call.multipartOperationId);}

  if(late&&facts.stage==="capability"&&call.multipartOperationId){
   // Retain the actual positive fact FIRST. A later contradictory mint cannot
   // be rejected merely because an earlier private disposition was closed.
   const[parent]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,call.multipartOperationId)).limit(1);if(!parent)transferConflict();
   await tx.update(mediaMultipartOperations).set({state:"unknown",updatedAt:new Date()}).where(eq(mediaMultipartOperations.id,parent.id));
   await tx.update(mediaMultipartResources).set({state:"unknown",retiredAt:null,updatedAt:new Date()}).where(eq(mediaMultipartResources.id,parent.resourceId));
  }
  if(facts.stage==="metadata"&&facts.revision&&request.descriptor.kind==="object.put"&&call.physicalReceiptId){
   const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1).for("update");if(!receipt)transferConflict();
   const digest=transferDigest(facts.revision),conflicting=Boolean(receipt.providerRevisionDigest&&receipt.providerRevisionDigest!==digest),now=new Date();
   // An actual conflicting positive fact is retained as debt. It cannot
   // replace the first provider result or be discarded with a local rollback.
   await tx.update(mediaObjectWrites).set({...(!conflicting?{providerRevision:facts.revision,providerRevisionDigest:digest}:{}),...(late||conflicting?{deletedAt:null,state:"unknown" as const}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,receipt.id));
   if(conflicting){await tx.update(mediaStorageTransferCalls).set({state:"unknown",updatedAt:now}).where(eq(mediaStorageTransferCalls.id,call.id));await tx.update(mediaStorageTransferRequests).set({state:"unknown"}).where(eq(mediaStorageTransferRequests.id,id));scope.receiptIds.add(receipt.id);}
   if(late&&!call.objectId&&call.objectReceiptId&&receipt.originalReservationId){await tx.insert(mediaObjects).values({reservationId:receipt.originalReservationId,key:facts.revision.key,role:"original",state:"pending",bytes:receipt.bytes??0,contentType:receipt.contentType}).onConflictDoNothing();scope.receiptIds.add(receipt.id);}
  }
  if(facts.stage==="accepted"&&mutation(request.descriptor)){
   const now=new Date();await tx.update(mediaStorageTransferCalls).set({...(call.observedAcceptedAt?{}:{observedAcceptedAt:now}),...(late?{state:"unknown" as const}:{}),updatedAt:now}).where(eq(mediaStorageTransferCalls.id,call.id));
   if(call.physicalReceiptId){
    const[receipt]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.physicalReceiptId)).limit(1).for("update");if(!receipt)transferConflict();receiptId=receipt.id;
    await tx.update(mediaObjectWrites).set({state:"unknown",...(receipt.observedAcceptedAt?{}:{observedAcceptedAt:now}),...(late?{deletedAt:null}:{}),updatedAt:now}).where(eq(mediaObjectWrites.id,receipt.id));
    if(late&&request.descriptor.kind==="object.put"){
     if(call.objectId){
      const[object]=await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.id,call.objectId)).limit(1).for("update");if(!object)transferConflict();
      if(receipt.originalReservationId)await tx.insert(mediaObjects).values({reservationId:receipt.originalReservationId,key:transferTargetKey(object.planId,object.keyDigest),role:"staged",state:"pending",bytes:object.bytes,contentType:object.contentType}).onConflictDoNothing();
      const originals=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id));
      if(originals.length)await tx.update(mediaObjectWrites).set({deletedAt:null,updatedAt:now}).where(inArray(mediaObjectWrites.id,originals.map(row=>row.receiptId)));
     }else if(call.objectReceiptId&&facts.revision&&receipt.originalReservationId){
      // An actual late original result restores only its physical pointer.
      // No owner/contact identity or unrelated generation is reconstructed.
      await tx.insert(mediaObjects).values({reservationId:receipt.originalReservationId,key:facts.revision.key,role:"original",state:"pending",bytes:receipt.bytes??0,contentType:receipt.contentType}).onConflictDoNothing();
     }
    }
   }
  }
 });
 if(receiptId)scope.receiptIds.add(receiptId);
}
async function finish(scope:Scope,id:string,token:string,failed:boolean){
 await db().transaction(async tx=>{const call=await locked(tx,scope);const[row]=await tx.select().from(mediaStorageTransferRequests).where(eq(mediaStorageTransferRequests.id,id)).limit(1).for("update");if(!row||row.tokenDigest!==transferDigest(token))transferConflict();if(row.returnedAt)return;await tx.update(mediaStorageTransferRequests).set({state:row.state==="stopped"||row.state==="unknown"&&call.state!=="admitted"?"unknown":failed?(mutation(row.descriptor)?"unknown":"failed"):"returned",returnedAt:new Date()}).where(eq(mediaStorageTransferRequests.id,id));});
}
async function reconcileRetainedRequestFacts(scope:Scope):Promise<void>{
 const ids=[...scope.receiptIds],multipartIds=[...scope.multipartOperationIds];scope.receiptIds.clear();scope.multipartOperationIds.clear();const failures:unknown[]=[];
 for(const id of multipartIds){try{if(!await reconcileOriginalMultipartPositivePointer(id))failures.push(new Error("The original positive session fact is retained; its conflicting or unavailable original pointer remains recovery debt."));}catch(error){failures.push(error);}try{await reconcileMediaErasureCohorts({multipartOperationId:id});}catch(error){failures.push(error);}}
 for(const id of ids){try{if(!await(await import("./original-quota-evidence")).reconcileActualOriginalQuota(id))failures.push(new Error("The actual original physical facts are retained; conflicting quota provenance freezes this namespace until exact recovery."));}catch(error){failures.push(error);}try{await reconcileMediaErasureCohorts({objectReceiptId:id});}catch(error){failures.push(error);}try{await reconcileCommittedStorageObservation(id);}catch(error){failures.push(error);}}
 if(failures.length)throw new AggregateError(failures,"The original provider facts and finish are retained; dependent erasure recovery remains pending.");
}
export const observeTransferRequest:TransferRequestObserver=async(descriptor,operation)=>{
 const scope=invocation.getStore();if(!scope?.active)transferConflict("Provider requests require their actual original server-held logical caller.");
 const token=randomUUID()+randomUUID(),id=await admit(scope,descriptor,token);
 try{await checkStorageTransferJob();}catch(error){await observe(scope,id,token,{stage:"not_attempted",status:null});await finish(scope,id,token,false);throw new TransferRequestNotAttemptedError(scope.callId,error);}
 try{const result=await operation(facts=>observe(scope,id,token,facts),{id,token});await finish(scope,id,token,false);await reconcileRetainedRequestFacts(scope);return result;}
 catch(error){await finish(scope,id,token,true).catch(()=>{});try{await reconcileRetainedRequestFacts(scope);}catch(recovery){throw new AggregateError([error,recovery],"The actual original request needs recovery; its retained facts were not replaced.");}throw error;}
};
export async function transferRequestsDrained(tx:Tx,callIds:string[]):Promise<boolean>{
 if(!callIds.length)return true;const rows=await tx.select({id:mediaStorageTransferRequests.id}).from(mediaStorageTransferRequests).where(and(inArray(mediaStorageTransferRequests.callId,callIds),inArray(mediaStorageTransferRequests.state,["admitted","unknown"])) ).limit(1);return rows.length===0;
}

/** Called inside the actual quota reservation transaction, before quota locks.
 * The provider has not been contacted. Rollback removes both this association
 * and capacity reservation; no current-key token is adopted during recovery.
 */
export async function bindOriginalMediaQuotaReservation(tx:Tx,input:{namespace:string;key:string;bytes:number;token:string}):Promise<void>{
 const scope=invocation.getStore();if(!scope?.active)transferConflict("Quota-backed physical writes require their actual original caller scope.");
 const call=await locked(tx,scope);
 if(call.kind!=="ordinary_put"||!call.objectReceiptId||call.namespace!==input.namespace||call.physicalKey!==input.key||call.state!=="admitted"||call.quotaToken&&call.quotaToken!==input.token)transferConflict("The quota reservation does not belong to this exact original physical admission.");
 const[parent]=await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,call.objectReceiptId)).limit(1);if(!parent||parent.bytes!==input.bytes)transferConflict("The original reserved byte count changed.");
 await tx.update(mediaStorageTransferCalls).set({quotaToken:input.token,updatedAt:new Date()}).where(eq(mediaStorageTransferCalls.id,call.id));
}
