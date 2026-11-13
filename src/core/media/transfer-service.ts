// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: one shared transfer lifecycle for UI, HTTP and MCP.
import {createHash,randomUUID} from "node:crypto";
import {asc,eq,inArray} from "drizzle-orm";
import {z} from "zod";
import {copyManifestObjects,type AccountedTransferStore,type VersionedTransferStore} from "../../../scripts/media-transfer.mjs";
import {defineOrchestratedService,hasModuleAccess,ServiceError,type Actor} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferReviews,type StorageTransferRevision,STORAGE_TRANSFER_CALL_KINDS} from "./transfer-schema";
import {assertTransferCallDrain,assertTransferOriginalMembership,assertTransferOwners,claimOriginalTransfer,lockedTransfer,requireTransferCapability} from "./transfer-authority";
import {admitTransferCall,retainTransferFailure,retainTransferReturn,transferRuntimeIdentity,type ActualTransferReturn} from "./transfer-callers";
import {configuredTransferStores} from "./transfer-storage";
import {requireFinishedTransferRead,transferConflict,transferDigest,verifiedTransferBytes} from "./transfer-proof";
import {transferBindingSchema} from "./transfer-witness";

import {TransferRequestNotAttemptedError,withTransferRequestScope} from "./transfer-requests";
import {checkStorageTransferJob} from "./transfer-job-scope";
import {transferCallApplied,transferCallRetryPermitted} from "./transfer-reviewed-call";
import {settleTransferQuota,releaseTransferQuota} from "./transfer-quota";
import {mediaStorageProviderInventories} from "./transfer-inventory-schema";
import {captureProviderInventory,providerInventoryProgress,appendProviderInventoryPage,finishProviderInventory,requireOriginalProviderBaseline,requireCompletePhysicalRetirementInventory} from "./transfer-inventory";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const revision=z.object({kind:z.enum(["etag","generation"]),key:z.string(),namespace:digest,value:z.string(),versionId:z.string().optional()});
const planInput=z.object({requestKey:z.uuid(),drainId:z.uuid().optional(),confirmation:z.literal("COPY ADOPT AND RETIRE ORIGINAL STORAGE")});
const progressSchema=z.object({id:z.uuid(),state:z.string(),objects:z.number().int().nonnegative(),verified:z.number().int().nonnegative(),retired:z.number().int().nonnegative(),pendingRecovery:z.boolean()});
function human(actor:Actor):void{if(actor.kind!=="user"||actor.keyScopes||!hasModuleAccess(actor,"media","manage"))throw new ServiceError("permission","Sign in as a person with permission to authorize a storage transfer.");}
function progress(plan:typeof mediaStorageTransferPlans.$inferSelect,objects:readonly (typeof mediaStorageTransferObjects.$inferSelect)[],calls:readonly {state:string}[]=[],inventories:readonly {state:string}[]=[]){return{id:plan.id,state:plan.state,objects:objects.length,verified:objects.filter(row=>["verified","adopted","cleanup_pending","complete"].includes(row.state)).length,retired:objects.filter(row=>row.state==="complete").length,pendingRecovery:inventories.some(row=>row.state!=="complete")||plan.state==="unknown"||plan.state==="blocked"||calls.some(row=>row.state==="unknown")||objects.some(row=>["unknown","blocked"].includes(row.state))};}
const capturePlan=defineMediaService({
 name:"media.captureStorageTransfer",summary:"Capture the complete immutable original storage transfer membership.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.planStorageTransfer",
 input:planInput.extend({id:z.uuid(),source:transferBindingSchema,target:transferBindingSchema}),output:z.object({id:z.uuid()}),auditInputFields:["id","requestKey"],
 handler:async(input,ctx)=>{human(ctx.actor);const plan=await claimOriginalTransfer(ctx.tx,input,ctx.actor);ctx.setSubject("media_storage_transfer",plan.id);return{id:plan.id};},
});
export const planStorageTransfer=defineOrchestratedService({
 name:"media.planStorageTransfer",summary:"Authorize a complete verified transfer to the explicitly configured private destination.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,writeClass:"destructive",input:planInput,output:z.object({id:z.uuid()}),auditInputFields:["requestKey","drainId"],
 handler:async(input,actor)=>{human(actor);const{source,target}=await configuredTransferStores();return capturePlan.call({...input,id:randomUUID(),source:source.binding,target:target.binding},actor);},
});
async function readWork(tx:Parameters<typeof lockedTransfer>[0],id:string){const work=await lockedTransfer(tx,id);const calls=work.objects.length?await tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,work.objects.map(row=>row.id))).orderBy(asc(mediaStorageTransferCalls.createdAt),asc(mediaStorageTransferCalls.id)):[];const reviews=work.objects.length?await tx.select().from(mediaStorageTransferReviews).where(inArray(mediaStorageTransferReviews.objectId,work.objects.map(row=>row.id))):[];const inventories=await tx.select().from(mediaStorageProviderInventories).where(eq(mediaStorageProviderInventories.planId,id));return{...work,calls,reviews,inventories};}
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
  const sourceRevision=requireFinishedTransferRead(source,plan.originalSource,object.key,object);
  await requireOriginalProviderBaseline(ctx.tx,plan.id,object.id,sourceRevision);
  const targetRevision=requireFinishedTransferRead(target,plan.originalTarget,object.targetKey,object);
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
const verifyOriginalProviderRead=defineMediaService({name:"media.verifyOriginalProviderTransferRead",summary:"Refuse a changed original provider generation before any target copy is admitted.",kind:"query",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid(),objectId:z.uuid(),sourceReadId:z.uuid()}),output:z.object({ok:z.literal(true)}),handler:async(input,ctx)=>{
 const{plan,objects}=await lockedTransfer(ctx.tx,input.id),object=objects.find(row=>row.id===input.objectId);if(!object)transferConflict();await assertTransferOwners(ctx.tx,objects);await assertTransferCallDrain(ctx.tx,objects.map(row=>row.id));
 const[call]=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,input.sourceReadId)).limit(1);if(!call||call.objectId!==object.id||call.kind!=="source_read")transferConflict();
 const actual=requireFinishedTransferRead(call,plan.originalSource,object.key,object);await requireOriginalProviderBaseline(ctx.tx,plan.id,object.id,actual);return{ok:true as const};
}});
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
   await requireOriginalProviderBaseline(ctx.tx,plan.id,object.id,original);
   if(transferDigest(original)!==transferDigest(object.sourceRevision)||transferDigest(target)!==transferDigest(object.targetRevision))transferConflict();
  }
  const now=new Date();await ctx.tx.update(mediaStorageTransferObjects).set({state:"adopted",updatedAt:now}).where(eq(mediaStorageTransferObjects.planId,plan.id));
  await ctx.tx.update(mediaStorageTransferPlans).set({state:"adopted",adoptedAt:now,updatedAt:now}).where(eq(mediaStorageTransferPlans.id,plan.id));
  ctx.setSubject("media_storage_transfer",plan.id);return progress({...plan,state:"adopted",adoptedAt:now},objects.map(row=>({...row,state:"adopted" as const})));
 },
});
const finishRetirement=defineMediaService({
 name:"media.finishStorageTransferRetirement",summary:"Retain exact conditional source retirement while the original lineage still owns its target copy.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid(),objectId:z.uuid(),deleteId:z.uuid(),absenceId:z.uuid(),targetCurrentId:z.uuid(),inventoryId:z.uuid()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],
 handler:async(input,ctx)=>{
  const{plan,objects}=await lockedTransfer(ctx.tx,input.id),object=objects.find(row=>row.id===input.objectId);if(!object||!plan.adoptedAt||!object.sourceDeleteReceiptId)transferConflict();
  await assertTransferOwners(ctx.tx,[object]);await assertTransferCallDrain(ctx.tx,[object.id]);
  const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id));
  const target=requireFinishedTransferRead(calls.find(row=>row.id===input.targetCurrentId&&row.kind==="target_current"),plan.originalTarget,object.targetKey,object);
  const deletion=calls.find(row=>row.id===input.deleteId&&row.kind==="source_delete"),absence=calls.find(row=>row.id===input.absenceId&&row.kind==="source_absence");
  const reviews=await ctx.tx.select().from(mediaStorageTransferReviews).where(eq(mediaStorageTransferReviews.objectId,object.id));
  if(transferDigest(target)!==transferDigest(object.targetRevision)||!deletion||!transferCallApplied(deletion,reviews)||transferDigest(deletion.expectedRevision)!==transferDigest(object.sourceRevision)||absence?.state!=="returned"||!absence.returnedAt||!absence.resultAbsent||absence.namespace!==plan.sourceNamespace||absence.physicalKey!==object.key)transferConflict();
  await requireCompletePhysicalRetirementInventory(ctx.tx,input.inventoryId,object.id,"source",deletion.id);
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
 try{const value=await withTransferRequestScope({callId:call.id,token,runtimeIdentity},operation);const result=outcome(value);accepted=result.accepted===true;await retainTransferReturn(call.id,token,result);return{id:call.id,value};}
 catch(error){if(error instanceof TransferRequestNotAttemptedError&&error.logicalCallId===call.id){await retainTransferReturn(call.id,token,{notAttempted:true});throw error;}await retainTransferFailure(call.id,token,accepted).catch(()=>{});throw error;}
}
const inventoryCaptureInput=z.object({planId:z.uuid(),side:z.enum(["source","target"]),purpose:z.enum(["baseline","retirement"]),objectId:z.uuid().optional(),anchorCallId:z.uuid().optional()});
const beginInventory=defineMediaService({name:"media.captureProviderTransferInventory",summary:"Capture the immutable complete original provider inventory before physical work.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:inventoryCaptureInput,output:z.custom<Awaited<ReturnType<typeof captureProviderInventory>>>(),auditInputFields:["planId","side","purpose"],handler:async(input,ctx)=>captureProviderInventory(ctx.tx,input,ctx.actor)});
const readInventory=defineMediaService({name:"media.readProviderTransferInventory",summary:"Read the unchanged original provider page chain for bounded resumption.",kind:"query",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof providerInventoryProgress>>>(),handler:async(input,ctx)=>providerInventoryProgress(ctx.tx,input.id,ctx.actor)});
const inventoryEntry=z.object({kind:z.enum(["object","version","delete_marker","session","retained"]),key:z.string().min(1).max(2048),bytes:z.number().int().nonnegative().safe(),revision:revision.optional(),versionId:z.string().max(4096).optional(),sessionId:z.string().max(4096).optional(),current:z.boolean()});
const inventoryPageInput=z.object({inventoryId:z.uuid(),callId:z.uuid(),pass:z.union([z.literal(0),z.literal(1)]),kind:z.enum(["configuration","objects","versions","sessions","retained"]),cursor:z.record(z.string(),z.string()).nullable(),page:z.object({entries:z.array(inventoryEntry).max(250),next:z.record(z.string(),z.string()).nullable()}).optional(),configuration:z.object({versioning:z.enum(["disabled","Enabled","Suspended"]),softDeleteSeconds:z.number().int().nonnegative().safe(),retentionSeconds:z.number().int().nonnegative().safe()}).optional()});
const applyInventoryPage=defineMediaService({name:"media.appendProviderTransferInventoryPage",summary:"Append one actual original returned provider page without replacing earlier evidence.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:inventoryPageInput,output:z.object({ok:z.literal(true)}),auditInputFields:["inventoryId","callId","pass","kind"],handler:async(input,ctx)=>appendProviderInventoryPage(ctx.tx,input,ctx.actor)});
const finishInventory=defineMediaService({name:"media.finishProviderTransferInventory",summary:"Verify two complete original inventories without adopting unknown physical resources.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"media.advanceStorageTransfer",input:z.object({id:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof finishProviderInventory>>>(),auditInputFields:["id"],handler:async(input,ctx)=>finishProviderInventory(ctx.tx,input.id,ctx.actor)});
async function ensureProviderInventory(work:Work,side:"source"|"target",store:AccountedTransferStore,actor:Actor,purpose:"baseline"|"retirement"="baseline",objectId?:string,anchorCallId?:string):Promise<string>{
 const header=await beginInventory.call({planId:work.plan.id,side,purpose,objectId,anchorCallId},actor);
 if(header.state==="complete")return header.id;
 if(header.state!=="capturing")transferConflict("The original provider inventory is blocked; retain its intact pages for recovery.");
 const representative=objectId??work.objects[0]!.id,kind=purpose==="retirement"?"source_retirement_inventory":side==="source"?"source_inventory":"target_inventory";
 let captured=await readInventory.call({id:header.id},actor);
 for(const pass of [0,1]as const){
  if(!captured.pages.some(row=>row.pass===pass&&row.kind==="configuration")){
   const actual=await physical({planId:work.plan.id,objectId:representative,kind},actor,()=>store.inventoryConfiguration(),value=>({configurationDigest:transferDigest(value)}));
   await applyInventoryPage.call({inventoryId:header.id,callId:actual.id,pass,kind:"configuration",cursor:null,configuration:actual.value},actor);
   captured=await readInventory.call({id:header.id},actor);
  }
  for(const inventoryKind of store.binding.kind==="s3"?["objects","versions","sessions"]as const:["objects","versions","retained"]as const){
   const prior=captured.pages.filter(row=>row.pass===pass&&row.kind===inventoryKind),last=prior.at(-1);
   if(last&&last.nextCursor===null)continue;
   let cursor=last?.nextCursor??null;
   for(let page=prior.length;;page++){
    if(page>=200)transferConflict("The complete original provider inventory exceeds the bounded page limit. No subset can be adopted.");
    const actual=await physical({planId:work.plan.id,objectId:representative,kind},actor,()=>store.inventoryPage(inventoryKind,cursor),value=>({inventoryDigest:transferDigest(value),inventoryCount:value.entries.length}));
    await applyInventoryPage.call({inventoryId:header.id,callId:actual.id,pass,kind:inventoryKind,cursor,page:actual.value},actor);
    cursor=actual.value.next;if(cursor===null)break;
   }
   captured=await readInventory.call({id:header.id},actor);
  }
 }
 const complete=await finishInventory.call({id:header.id},actor);
 if(complete.state!=="complete")transferConflict("Original provider versions, sessions, provenance or capacity remain unresolved. Keep the first inventory for recovery.");
 return complete.id;
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
  if(!object)return progress(work.plan,work.objects,work.calls,work.inventories);
  if(input.action==="copy"){
   await ensureProviderInventory(work,"source",source,actor);
   await ensureProviderInventory(work,"target",target,actor);
   const latest=work.calls.filter(row=>row.objectId===object.id&&row.kind==="target_put").at(-1),prior=transferCallApplied(latest,work.reviews)?latest:undefined;
   if(latest&&!prior&&!transferCallRetryPermitted(latest,work.reviews))transferConflict("Reconcile the actual original target caller; it will not be retried automatically.");
   let sourceReadId:string|undefined,putPerformed=false;
   await copyManifestObjects({manifest:{format:"freeholder-media-manifest/v1",objects:[{key:object.key,bytes:object.bytes,contentType:object.contentType,checksumSha256:object.sha256}]},source:{get:async()=>{const read=await readPhysical(work,object,source,"source_read",actor);sourceReadId=read.id;if(!read.value)transferConflict("The original source bytes are absent.");verifiedTransferBytes(read.value.body,object);await verifyOriginalProviderRead.call({id:input.id,objectId:object.id,sourceReadId:read.id},actor);return read.value.body;},put:async()=>transferConflict()},target:{get:async()=>{const read=await readPhysical(work,object,target,"target_probe",actor);if(read.value&&!prior&&!putPerformed)transferConflict("The destination key is already occupied; it will not be adopted or overwritten.");return read.value?.body;},put:async(_key,body,type)=>{await physical({planId:input.id,objectId:object.id,kind:"target_put"},actor,()=>target.put(object.targetKey,body,type),()=>({accepted:true}));putPerformed=true;}}});
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
   const inventoryId=await ensureProviderInventory(work,"source",source,actor,"retirement",object.id,deleted.id);
   await finishRetirement.call({id:input.id,objectId:object.id,deleteId:deleted.id,absenceId:absent.id,targetCurrentId:current.id,inventoryId},actor);
  }
  const after=await captureWork.call({id:input.id},actor);return progress(after.plan,after.objects,after.calls,after.inventories);
 },
});
export const storageTransferStatus=defineMediaService({name:"media.storageTransferStatus",summary:"Read the bounded progress of an original storage transfer.",kind:"query",permission:"scoped",input:z.object({id:z.uuid()}),output:progressSchema,handler:async(input,ctx)=>{await requireTransferCapability(ctx.tx);const{plan,objects,calls,inventories}=await readWork(ctx.tx,input.id);return progress(plan,objects,calls,inventories);}});
export const listStorageTransfers=defineMediaService({name:"media.listStorageTransfers",summary:"List bounded original storage transfer progress without private physical caller material.",kind:"query",permission:"scoped",agentCallable:false,input:z.object({limit:z.number().int().min(1).max(25).default(10)}),output:z.object({rows:z.array(progressSchema)}),handler:async(input,ctx)=>{
 human(ctx.actor);await requireTransferCapability(ctx.tx);const plans=await ctx.tx.select().from(mediaStorageTransferPlans).orderBy(asc(mediaStorageTransferPlans.createdAt),asc(mediaStorageTransferPlans.id)).limit(input.limit),rows=[];
 for(const plan of plans){const objects=await ctx.tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.planId,plan.id)),calls=objects.length?await ctx.tx.select({state:mediaStorageTransferCalls.state}).from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,objects.map(row=>row.id))):[];const inventories=await ctx.tx.select({state:mediaStorageProviderInventories.state}).from(mediaStorageProviderInventories).where(eq(mediaStorageProviderInventories.planId,plan.id));rows.push(progress(plan,objects,calls,inventories));}
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
export default [planStorageTransfer,capturePlan,advanceStorageTransfer,captureWork,captureCall,applyCopy,adoptPlan,finishRetirement,storageTransferStatus,listStorageTransfers,storageTransferConfiguration,cancelStorageTransfer,beginInventory,readInventory,applyInventoryPage,finishInventory,verifyOriginalProviderRead];
