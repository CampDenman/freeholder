// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: one shared transfer lifecycle for UI, HTTP and MCP.
import {createHash,randomUUID} from "node:crypto";
import {asc,eq,inArray} from "drizzle-orm";
import {z} from "zod";
import {copyManifestObjects,type VersionedTransferStore} from "../../../scripts/media-transfer.mjs";
import {defineOrchestratedService,hasModuleAccess,ServiceError,type Actor} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferReviews,type StorageTransferRevision,STORAGE_TRANSFER_CALL_KINDS} from "./transfer-schema";
import {assertTransferCallDrain,assertTransferOriginalMembership,assertTransferOwners,claimOriginalTransfer,lockedTransfer,requireTransferCapability} from "./transfer-authority";
import {admitTransferCall,retainTransferFailure,retainTransferReturn,transferRuntimeIdentity,type ActualTransferReturn} from "./transfer-callers";
import {configuredTransferStores} from "./transfer-storage";
import {requireFinishedTransferRead,transferConflict,transferDigest,verifiedTransferBytes} from "./transfer-proof";
import {transferBindingSchema} from "./transfer-witness";

import {checkStorageTransferJob} from "./transfer-job-scope";
import {transferCallApplied,transferCallRetryPermitted} from "./transfer-reviewed-call";
import {settleTransferQuota,releaseTransferQuota} from "./transfer-quota";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const revision=z.object({kind:z.enum(["etag","generation"]),key:z.string(),namespace:digest,value:z.string()});
const planInput=z.object({requestKey:z.uuid(),drainId:z.uuid().optional(),confirmation:z.literal("COPY ADOPT AND RETIRE ORIGINAL STORAGE")});
const progressSchema=z.object({id:z.uuid(),state:z.string(),objects:z.number().int().nonnegative(),verified:z.number().int().nonnegative(),retired:z.number().int().nonnegative(),pendingRecovery:z.boolean()});
function human(actor:Actor):void{if(actor.kind!=="user"||actor.keyScopes||!hasModuleAccess(actor,"media","manage"))throw new ServiceError("permission","Sign in as a person with permission to authorize a storage transfer.");}
function progress(plan:typeof mediaStorageTransferPlans.$inferSelect,objects:readonly (typeof mediaStorageTransferObjects.$inferSelect)[],calls:readonly {state:string}[]=[]){return{id:plan.id,state:plan.state,objects:objects.length,verified:objects.filter(row=>["verified","adopted","cleanup_pending","complete"].includes(row.state)).length,retired:objects.filter(row=>row.state==="complete").length,pendingRecovery:plan.state==="unknown"||calls.some(row=>row.state==="unknown")||objects.some(row=>["unknown","blocked"].includes(row.state))};}
const capturePlan=defineMediaService({
 name:"media.captureStorageTransfer",summary:"Capture the complete immutable original storage transfer membership.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.planStorageTransfer",
 input:planInput.extend({id:z.uuid(),source:transferBindingSchema,target:transferBindingSchema}),output:z.object({id:z.uuid()}),auditInputFields:["id","requestKey"],
 handler:async(input,ctx)=>{human(ctx.actor);const plan=await claimOriginalTransfer(ctx.tx,input,ctx.actor);ctx.setSubject("media_storage_transfer",plan.id);return{id:plan.id};},
});
export const planStorageTransfer=defineOrchestratedService({
 name:"media.planStorageTransfer",summary:"Authorize a complete verified transfer to the explicitly configured private destination.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,writeClass:"destructive",input:planInput,output:z.object({id:z.uuid()}),auditInputFields:["requestKey","drainId"],
 handler:async(input,actor)=>{human(actor);const{source,target}=await configuredTransferStores();return capturePlan.call({...input,id:randomUUID(),source:source.binding,target:target.binding},actor);},
});
async function readWork(tx:Parameters<typeof lockedTransfer>[0],id:string){const work=await lockedTransfer(tx,id);const calls=work.objects.length?await tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,work.objects.map(row=>row.id))).orderBy(asc(mediaStorageTransferCalls.createdAt),asc(mediaStorageTransferCalls.id)):[];const reviews=work.objects.length?await tx.select().from(mediaStorageTransferReviews).where(inArray(mediaStorageTransferReviews.objectId,work.objects.map(row=>row.id))):[];return{...work,calls,reviews};}
type Work=Awaited<ReturnType<typeof readWork>>;
const captureWork=defineMediaService({
 name:"media.captureStorageTransferWork",summary:"Read the unchanged original plan before bounded physical transfer work.",kind:"query",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid()}),output:z.custom<Work>(),
 handler:async(input,ctx)=>readWork(ctx.tx,input.id),
});
const callInput=z.object({planId:z.uuid(),objectId:z.uuid(),kind:z.enum(STORAGE_TRANSFER_CALL_KINDS),token:z.string().min(36),runtimeIdentity:z.object({boot:z.string(),pid:z.number().int().positive(),startTicks:z.string()}),expectedRevision:revision.optional()});
const captureCall=defineMediaService({
 name:"media.admitStorageTransferCall",summary:"Commit one exact original physical caller before provider I/O.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:callInput,output:z.object({id:z.uuid(),requestDigest:digest,binding:transferBindingSchema,key:z.string(),receiptId:z.uuid().nullable()}),auditInputFields:["planId","objectId","kind"],
 handler:async(input,ctx)=>admitTransferCall(ctx.tx,input,ctx.actor),
});
const applyCopy=defineMediaService({
 name:"media.verifyStorageTransferCopy",summary:"Apply finished original source and target byte proofs without changing original receipts.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid(),objectId:z.uuid(),sourceReadId:z.uuid(),targetVerifyId:z.uuid()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],
 handler:async(input,ctx)=>{
  const{plan,objects}=await lockedTransfer(ctx.tx,input.id),object=objects.find(row=>row.id===input.objectId);if(!object)transferConflict();
  await assertTransferOwners(ctx.tx,objects);await assertTransferCallDrain(ctx.tx,objects.map(row=>row.id));await assertTransferOriginalMembership(ctx.tx,plan,objects);
  const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id));
  const source=calls.find(row=>row.id===input.sourceReadId&&row.kind==="source_read"),target=calls.find(row=>row.id===input.targetVerifyId&&row.kind==="target_verify");
  const sourceRevision=requireFinishedTransferRead(source,plan.originalSource,object.key,object),targetRevision=requireFinishedTransferRead(target,plan.originalTarget,object.targetKey,object);
  const put=calls.filter(row=>row.kind==="target_put").sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()).at(-1),reviews=await ctx.tx.select().from(mediaStorageTransferReviews).where(eq(mediaStorageTransferReviews.objectId,object.id));
  if(!put||!transferCallApplied(put,reviews)||!object.targetReceiptId)transferConflict("The target needs its exact actual finished create-only PUT receipt.");
  const[receipt]=await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,object.targetReceiptId)).limit(1);
  if(!receipt||receipt.state!=="accepted"||receipt.deletedAt||receipt.redactedAt||receipt.namespace!==plan.targetNamespace||receipt.sha256!==object.sha256||receipt.bytes!==object.bytes)transferConflict();
  await settleTransferQuota(ctx.tx,plan.targetNamespace,object.targetKey,put.id);
  await ctx.tx.update(mediaStorageTransferObjects).set({state:"verified",sourceRevision,targetRevision,sourceReadCallerId:source!.id,targetVerifyCallerId:target!.id,updatedAt:new Date()}).where(eq(mediaStorageTransferObjects.id,object.id));
  const verified=objects.every(row=>row.id===object.id||row.state==="verified");
  await ctx.tx.update(mediaStorageTransferPlans).set({state:verified?"verified":"copying",updatedAt:new Date()}).where(eq(mediaStorageTransferPlans.id,plan.id));
  ctx.setSubject("media_storage_transfer",plan.id);return{ok:true as const};
 },
});
const adoptPlan=defineMediaService({
 name:"media.adoptStorageTransfer",summary:"Atomically adopt every verified physical read key in the unchanged original plan.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid()}),output:progressSchema,auditInputFields:["id"],
 handler:async(input,ctx)=>{
  const{plan,objects}=await lockedTransfer(ctx.tx,input.id);
  if(plan.adoptedAt)return progress(plan,objects);
  if(plan.state!=="verified"||objects.some(row=>row.state!=="verified"))transferConflict("Verify the complete original inventory before adopting any physical key.");
  await assertTransferOwners(ctx.tx,objects);await assertTransferCallDrain(ctx.tx,objects.map(row=>row.id));await assertTransferOriginalMembership(ctx.tx,plan,objects);
  const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,objects.map(row=>row.id)));
  for(const object of objects){
   const original=requireFinishedTransferRead(calls.find(row=>row.id===object.sourceReadCallerId&&row.kind==="source_read"),plan.originalSource,object.key,object);
   const target=requireFinishedTransferRead(calls.find(row=>row.id===object.targetVerifyCallerId&&row.kind==="target_verify"),plan.originalTarget,object.targetKey,object);
   if(transferDigest(original)!==transferDigest(object.sourceRevision)||transferDigest(target)!==transferDigest(object.targetRevision))transferConflict();
  }
  const now=new Date();await ctx.tx.update(mediaStorageTransferObjects).set({state:"adopted",updatedAt:now}).where(eq(mediaStorageTransferObjects.planId,plan.id));
  await ctx.tx.update(mediaStorageTransferPlans).set({state:"adopted",adoptedAt:now,updatedAt:now}).where(eq(mediaStorageTransferPlans.id,plan.id));
  ctx.setSubject("media_storage_transfer",plan.id);return progress({...plan,state:"adopted",adoptedAt:now},objects.map(row=>({...row,state:"adopted" as const})));
 },
});
const finishRetirement=defineMediaService({
 name:"media.finishStorageTransferRetirement",summary:"Retain exact conditional source retirement while the original lineage still owns its target copy.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid(),objectId:z.uuid(),deleteId:z.uuid(),absenceId:z.uuid(),targetCurrentId:z.uuid()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],
 handler:async(input,ctx)=>{
  const{plan,objects}=await lockedTransfer(ctx.tx,input.id),object=objects.find(row=>row.id===input.objectId);if(!object||!plan.adoptedAt||!object.sourceDeleteReceiptId)transferConflict();
  await assertTransferOwners(ctx.tx,[object]);await assertTransferCallDrain(ctx.tx,[object.id]);
  const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id));
  const target=requireFinishedTransferRead(calls.find(row=>row.id===input.targetCurrentId&&row.kind==="target_current"),plan.originalTarget,object.targetKey,object);
  const deletion=calls.find(row=>row.id===input.deleteId&&row.kind==="source_delete"),absence=calls.find(row=>row.id===input.absenceId&&row.kind==="source_absence");
  const reviews=await ctx.tx.select().from(mediaStorageTransferReviews).where(eq(mediaStorageTransferReviews.objectId,object.id));
  if(transferDigest(target)!==transferDigest(object.targetRevision)||!deletion||!transferCallApplied(deletion,reviews)||transferDigest(deletion.expectedRevision)!==transferDigest(object.sourceRevision)||absence?.state!=="returned"||!absence.returnedAt||!absence.resultAbsent||absence.namespace!==plan.sourceNamespace||absence.physicalKey!==object.key)transferConflict();
  const now=new Date();await ctx.tx.update(mediaObjectWrites).set({state:"accepted",observedAcceptedAt:deletion.observedAcceptedAt,writerFinishedAt:deletion.returnedAt,deletedAt:now,updatedAt:now}).where(eq(mediaObjectWrites.id,object.sourceDeleteReceiptId));
  await releaseTransferQuota(ctx.tx,plan.sourceNamespace,object.key);
  // Do NOT set the original PUT deleted_at: its copied bytes still exist.
  // Existing erasure/restore guards continue to see that original live lineage.
  await ctx.tx.update(mediaStorageTransferObjects).set({state:"complete",updatedAt:now}).where(eq(mediaStorageTransferObjects.id,object.id));
  await ctx.tx.update(mediaStorageTransferPlans).set({state:objects.every(row=>row.id===object.id||row.state==="complete")?"complete":"cleanup_pending",updatedAt:now}).where(eq(mediaStorageTransferPlans.id,plan.id));
  ctx.setSubject("media_storage_transfer",plan.id);return{ok:true as const};
 },
});
async function physical<T>(input:{planId:string;objectId:string;kind:typeof STORAGE_TRANSFER_CALL_KINDS[number];expectedRevision?:StorageTransferRevision},actor:Actor,operation:()=>Promise<T>,outcome:(value:T)=>ActualTransferReturn){
 await checkStorageTransferJob();
 const token=randomUUID()+randomUUID(),runtimeIdentity=await transferRuntimeIdentity();
 const call=await captureCall.call({...input,token,runtimeIdentity},actor);
 try{await checkStorageTransferJob();}catch(error){await retainTransferReturn(call.id,token,{notAttempted:true});throw error;}
 let accepted=false;
 try{const value=await operation();const result=outcome(value);accepted=result.accepted===true;await retainTransferReturn(call.id,token,result);return{id:call.id,value};}
 catch(error){await retainTransferFailure(call.id,token,accepted).catch(()=>{});throw error;}
}
async function readPhysical(work:Work,object:Work["objects"][number],store:VersionedTransferStore,kind:"source_read"|"target_probe"|"target_verify"|"target_current"|"source_absence",actor:Actor){
 const key=["source_read","source_absence"].includes(kind)?object.key:object.targetKey;
 return physical({planId:work.plan.id,objectId:object.id,kind},actor,()=>store.readVersioned(key),result=>result?{accepted:true,revision:result.revision,sha256:transferDigestBytes(result.body),bytes:result.body.byteLength}:{absent:true});
}
function transferDigestBytes(body:Uint8Array):string {return createHash("sha256").update(body).digest("hex");}
export const advanceStorageTransfer=defineOrchestratedService({
 name:"media.advanceStorageTransfer",summary:"Advance one exact original copy or retirement, or atomically adopt a fully verified plan.",kind:"mutation",permission:"scoped",writeClass:"destructive",input:z.object({id:z.uuid(),action:z.enum(["copy","adopt","retire"]),objectId:z.uuid().optional()}),output:progressSchema,auditInputFields:["id","action"],
 handler:async(input,actor)=>{
  const work=await captureWork.call({id:input.id},actor);
  if(input.action==="adopt")return adoptPlan.call({id:input.id},actor);
  const{source,target}=await configuredTransferStores();
  if(transferDigest(source.binding)!==transferDigest(work.plan.originalSource)||transferDigest(target.binding)!==transferDigest(work.plan.originalTarget))transferConflict("Restore the exact original private source and target configurations.");
  const object=work.objects.find(row=>(!input.objectId||row.id===input.objectId)&&(input.action==="copy"?["planned","copying"].includes(row.state):["adopted","cleanup_pending"].includes(row.state)));
  if(!object)return progress(work.plan,work.objects,work.calls);
  if(input.action==="copy"){
   const latest=work.calls.filter(row=>row.objectId===object.id&&row.kind==="target_put").at(-1),prior=transferCallApplied(latest,work.reviews)?latest:undefined;
   if(latest&&!prior&&!transferCallRetryPermitted(latest,work.reviews))transferConflict("Reconcile the actual original target caller; it will not be retried automatically.");
   let sourceReadId:string|undefined,putPerformed=false;
   await copyManifestObjects({manifest:{format:"freeholder-media-manifest/v1",objects:[{key:object.key,bytes:object.bytes,contentType:object.contentType,checksumSha256:object.sha256}]},source:{get:async()=>{const read=await readPhysical(work,object,source,"source_read",actor);sourceReadId=read.id;if(!read.value)transferConflict("The original source bytes are absent.");verifiedTransferBytes(read.value.body,object);return read.value.body;},put:async()=>transferConflict()},target:{get:async()=>{const read=await readPhysical(work,object,target,"target_probe",actor);if(read.value&&!prior&&!putPerformed)transferConflict("The destination key is already occupied; it will not be adopted or overwritten.");return read.value?.body;},put:async(_key,body,type)=>{await physical({planId:input.id,objectId:object.id,kind:"target_put"},actor,()=>target.put(object.targetKey,body,type),()=>({accepted:true}));putPerformed=true;}}});
   const verified=await readPhysical(work,object,target,"target_verify",actor);if(!verified.value||!sourceReadId)transferConflict();verifiedTransferBytes(verified.value.body,object);
   await applyCopy.call({id:input.id,objectId:object.id,sourceReadId,targetVerifyId:verified.id},actor);
  }else{
   if(!work.plan.adoptedAt||!object.sourceRevision||!object.targetRevision)transferConflict();
   const current=await readPhysical(work,object,target,"target_current",actor);if(!current.value)transferConflict();verifiedTransferBytes(current.value.body,object);
   if(transferDigest(current.value.revision)!==transferDigest(object.targetRevision))transferConflict("The adopted target generation changed; source retirement was refused.");
   const latestDelete=work.calls.filter(row=>row.objectId===object.id&&row.kind==="source_delete").at(-1),priorDelete=transferCallApplied(latestDelete,work.reviews)?latestDelete:undefined;
   if(latestDelete&&!priorDelete&&!transferCallRetryPermitted(latestDelete,work.reviews))transferConflict("The actual source DELETE needs original caller recovery; it will not be sent again automatically.");
   const deleted=priorDelete?{id:priorDelete.id}:await physical({planId:input.id,objectId:object.id,kind:"source_delete",expectedRevision:object.sourceRevision},actor,()=>source.deleteVersioned(object.key,object.sourceRevision!),()=>({accepted:true}));
   const absent=await readPhysical(work,object,source,"source_absence",actor);if(absent.value)transferConflict("The original source remains present after conditional retirement.");
   await finishRetirement.call({id:input.id,objectId:object.id,deleteId:deleted.id,absenceId:absent.id,targetCurrentId:current.id},actor);
  }
  const after=await captureWork.call({id:input.id},actor);return progress(after.plan,after.objects,after.calls);
 },
});
export const storageTransferStatus=defineMediaService({name:"media.storageTransferStatus",summary:"Read the bounded progress of an original storage transfer.",kind:"query",permission:"scoped",input:z.object({id:z.uuid()}),output:progressSchema,handler:async(input,ctx)=>{await requireTransferCapability(ctx.tx);const{plan,objects,calls}=await readWork(ctx.tx,input.id);return progress(plan,objects,calls);}});
export const listStorageTransfers=defineMediaService({name:"media.listStorageTransfers",summary:"List bounded original storage transfer progress without private physical caller material.",kind:"query",permission:"scoped",agentCallable:false,input:z.object({limit:z.number().int().min(1).max(25).default(10)}),output:z.object({rows:z.array(progressSchema)}),handler:async(input,ctx)=>{
 human(ctx.actor);await requireTransferCapability(ctx.tx);const plans=await ctx.tx.select().from(mediaStorageTransferPlans).orderBy(asc(mediaStorageTransferPlans.createdAt),asc(mediaStorageTransferPlans.id)).limit(input.limit),rows=[];
 for(const plan of plans){const objects=await ctx.tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.planId,plan.id)),calls=objects.length?await ctx.tx.select({state:mediaStorageTransferCalls.state}).from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,objects.map(row=>row.id))):[];rows.push(progress(plan,objects,calls));}
 return{rows};
}});
export const storageTransferConfiguration=defineOrchestratedService({name:"media.storageTransferConfiguration",summary:"Inspect the explicitly configured private original transfer resources without credentials.",kind:"query",permission:"scoped",agentCallable:false,input:z.object({}),output:z.object({source:transferBindingSchema,target:transferBindingSchema}),handler:async(_input,actor)=>{human(actor);const{source,target}=await configuredTransferStores();return{source:source.binding,target:target.binding};}});
export const cancelStorageTransfer=defineMediaService({name:"media.cancelStorageTransfer",summary:"Cancel an unadopted original plan only after all of its target copies and callers are retired.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,writeClass:"destructive",input:z.object({id:z.uuid(),confirmation:z.literal("CANCEL ORIGINAL TRANSFER WITHOUT DELETING SOURCE")}),output:progressSchema,auditInputFields:["id"],handler:async(input,ctx)=>{
 human(ctx.actor);const{plan,objects}=await lockedTransfer(ctx.tx,input.id);if(plan.adoptedAt)transferConflict("An adopted physical lineage cannot be cancelled or rebound.");
 await assertTransferCallDrain(ctx.tx,objects.map(row=>row.id));
 const copies=await ctx.tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.keyDigest,objects.map(row=>row.targetKeyDigest)));
 if(copies.some(row=>!row.deletedAt||!["accepted","confirmed_absent"].includes(row.state)))transferConflict("Retire every copied target with original proof before cancelling this plan. No source file was deleted.");
 const now=new Date();await ctx.tx.update(mediaStorageTransferPlans).set({state:"cancelled",updatedAt:now}).where(eq(mediaStorageTransferPlans.id,plan.id));
 await ctx.tx.update(mediaStorageTransferObjects).set({state:"cancelled",updatedAt:now}).where(eq(mediaStorageTransferObjects.planId,plan.id));
 ctx.setSubject("media_storage_transfer",plan.id);return progress({...plan,state:"cancelled"},objects.map(row=>({...row,state:"cancelled" as const})));
}});
export default [planStorageTransfer,capturePlan,advanceStorageTransfer,captureWork,captureCall,applyCopy,adoptPlan,finishRetirement,storageTransferStatus,listStorageTransfers,storageTransferConfiguration,cancelStorageTransfer];
