// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {currentStorageCallerRuntimeSchema} from "./physical-caller-runtime";
// C1.12/C11.08: existing original erasure authority retires every physical copy.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray,or,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {dataRequests,dataRequestArtifacts} from "@/core/privacy/schema";
import {erasureArtifactIsIntact} from "@/core/privacy/service";
import {defineOrchestratedService} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferErasureMembers,mediaStorageTransferReceipts} from "./transfer-schema";
import {assertTransferCallDrain,assertTransferOwners,lockedTransfer,transferSchemaAvailable} from "./transfer-authority";
import {admitTransferCall,retainTransferFailure,retainTransferReturn,transferRuntimeIdentity,type ActualTransferReturn} from "./transfer-callers";
import {configuredTransferStores} from "./transfer-storage";
import {objectKeyDigest} from "./write-ledger";
import {pendingObjectIsOwned,registerPendingObjectOwner} from "./object-ledger";
import {releaseTransferQuota} from "./transfer-quota";
import {transferConflict,transferTargetKey,verifiedTransferBytes,transferDigest} from "./transfer-proof";
import type {StorageTransferRevision} from "./transfer-schema";
import {TransferRequestNotAttemptedError,withTransferRequestScope} from "./transfer-requests";
import {checkStorageTransferJob} from "./transfer-job-scope";
import type {AccountedTransferStore,TransferInventoryConfiguration,TransferInventoryPage} from "../../../scripts/media-transfer.mjs";
import {originalTransferPhysicalRevision} from "./transfer-original-revision";
import {captureProviderInventory,providerInventoryProgress,appendProviderInventoryPage,finishProviderInventory,requireCompletePhysicalRetirementInventory} from "./transfer-inventory";
import {mediaStorageProviderInventories} from "./transfer-inventory-schema";
const SYSTEM={kind:"system"}as const;
registerPendingObjectOwner("transfer/",async(key,_now,tx)=>{
 const executor=tx??db();
 if(tx?!await transferSchemaAvailable(tx):!(await db().execute<{present:boolean}>(sql`select to_regclass('media_storage_transfer_objects') is not null as present`))[0]?.present)return false;
 const[object]=await executor.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.targetKeyDigest,objectKeyDigest(key))).limit(1);
 if(!object)return false;
 const original=await executor.select({key:mediaObjects.key}).from(mediaObjects).where(eq(mediaObjects.key,object.key)).limit(1);
 const active=await executor.select({id:mediaStorageTransferCalls.id}).from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.objectId,object.id),inArray(mediaStorageTransferCalls.state,["admitted","unknown"]))).limit(1);
 return original.length>0||active.length>0;
});
async function erasureWork(tx:Parameters<typeof lockedTransfer>[0],id:string,objectId:string){
 const work=await lockedTransfer(tx,id),stored=work.objects.find(row=>row.id===objectId);if(!stored)transferConflict();
 let object=stored;
 if(stored.redactedAt){
  const reads=await tx.select().from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.objectId,stored.id),eq(mediaStorageTransferCalls.kind,"recovery_read"),eq(mediaStorageTransferCalls.namespace,work.plan.sourceNamespace),eq(mediaStorageTransferCalls.state,"returned"))).orderBy(asc(mediaStorageTransferCalls.createdAt),asc(mediaStorageTransferCalls.id));
  const source=reads.filter(row=>objectKeyDigest(row.physicalKey)===stored.keyDigest&&row.returnedAt&&(row.resultAbsent||row.resultSha256===stored.sha256&&row.resultBytes===stored.bytes)).at(-1);
  if(!source)transferConflict("Fresh original-source key proof is required to finish this minimized physical lineage.");
  object={...stored,key:source.physicalKey,targetKey:transferTargetKey(work.plan.id,stored.keyDigest)};
 }
 await assertTransferOwners(tx,[object],true);await assertTransferCallDrain(tx,[object.id]);
 const original=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,object.key)).limit(1);
 if(original[0]?.state==="attached"||await pendingObjectIsOwned(object.key,new Date(),tx))transferConflict("Retire the original owning reference before erasing its copied physical bytes.");
 const sourceRevision=await originalTransferPhysicalRevision(tx,object,"source"),targetRevision=await originalTransferPhysicalRevision(tx,object,"target");
 return{plan:work.plan,object,sourceRevision,targetRevision};
}
type ErasureWork=Awaited<ReturnType<typeof erasureWork>>;
const readWork=defineMediaService({name:"media.captureTransferErasure",summary:"Capture exact original erasure lineage after its owning reference retires.",kind:"query",permission:"system",external:false,input:z.object({id:z.uuid(),objectId:z.uuid()}),output:z.custom<ErasureWork>(),handler:async(input,ctx)=>erasureWork(ctx.tx,input.id,input.objectId)});
const admission=z.object({planId:z.uuid(),objectId:z.uuid(),kind:z.enum(["privacy_read","privacy_delete","privacy_absence","privacy_source_read","privacy_source_delete","privacy_source_absence","source_erasure_inventory","target_erasure_inventory"]),token:z.string().min(36),runtimeIdentity:currentStorageCallerRuntimeSchema,expectedRevision:z.object({kind:z.enum(["etag","generation"]),namespace:z.string(),key:z.string(),value:z.string(),versionId:z.string().optional()}).optional()});
const admit=defineMediaService({name:"media.admitTransferErasureCall",summary:"Commit an original transfer erasure caller before private provider I/O.",kind:"mutation",permission:"system",external:false,input:admission,output:z.object({id:z.uuid()}),auditInputFields:["planId","objectId","kind"],handler:async(input,ctx)=>{const work=await erasureWork(ctx.tx,input.planId,input.objectId),source=input.kind.startsWith("privacy_source_")||input.kind==="source_erasure_inventory";
 if(input.kind==="privacy_delete"||input.kind==="privacy_source_delete"||input.kind==="privacy_read"||input.kind==="privacy_source_read"||input.kind==="privacy_absence"||input.kind==="privacy_source_absence"){
  const original=source?work.sourceRevision:work.targetRevision;
  if(!original||transferDigest(input.expectedRevision)!==transferDigest(original))transferConflict("The actual original provider result, not an equal current key or bytes, authorizes this physical call.");
 }
 return admitTransferCall(ctx.tx,{...input,physicalKey:source?work.object.key:work.object.targetKey},ctx.actor);}});
const finish=defineMediaService({name:"media.finishTransferErasure",summary:"Retire original receipt lineage only after both physical copies and callers are gone.",kind:"mutation",permission:"system",external:false,input:z.object({id:z.uuid(),objectId:z.uuid(),sourceAbsence:z.uuid(),targetAbsence:z.uuid().nullable(),sourceInventory:z.uuid(),targetInventory:z.uuid().nullable()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],handler:async(input,ctx)=>{
 const{plan,object,targetRevision}=await erasureWork(ctx.tx,input.id,input.objectId);
 const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id)).orderBy(asc(mediaStorageTransferCalls.createdAt));
 for(const[callId,kind,namespace,key]of[[input.sourceAbsence,"privacy_source_absence",plan.sourceNamespace,object.key],[input.targetAbsence,"privacy_absence",plan.targetNamespace,object.targetKey]]as const){
  if(callId===null){if(kind!=="privacy_absence"||targetRevision||input.targetInventory)transferConflict("Missing target proof cannot hide an original target writer.");continue;}
  const proof=calls.find(row=>row.id===callId);
  if(!proof||proof.kind!==kind||proof.state!=="returned"||!proof.returnedAt||!proof.resultAbsent||proof.namespace!==namespace||proof.physicalKey!==key)transferConflict("Both exact original physical resources need finished absence receipts.");
 }
 await requireCompletePhysicalRetirementInventory(ctx.tx,input.sourceInventory,object.id,"source",input.sourceAbsence);
 if(input.targetAbsence){if(!input.targetInventory)transferConflict();await requireCompletePhysicalRetirementInventory(ctx.tx,input.targetInventory,object.id,"target",input.targetAbsence);}
 const members=await ctx.tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id));
 const physical=[...new Set([...members.map(row=>row.receiptId),...calls.flatMap(row=>row.physicalReceiptId?[row.physicalReceiptId]:[])])],now=new Date();
 // First retire target/delete witnesses; the original retirement guard then
 // sees every copy absent before permitting original PUT minimization.
 const originals=new Set(members.map(row=>row.receiptId));
 const copies=physical.filter(id=>!originals.has(id));
 if(copies.length){
  await ctx.tx.update(mediaObjectWrites).set({state:"accepted",deletedAt:now,updatedAt:now}).where(and(inArray(mediaObjectWrites.id,copies),eq(mediaObjectWrites.operation,"delete")));
  await ctx.tx.update(mediaObjectWrites).set({deletedAt:now,updatedAt:now}).where(and(inArray(mediaObjectWrites.id,copies),eq(mediaObjectWrites.operation,"put")));
 }
 if(members.length)await ctx.tx.update(mediaObjectWrites).set({deletedAt:now,updatedAt:now}).where(inArray(mediaObjectWrites.id,members.map(row=>row.receiptId)));
 await ctx.tx.delete(mediaObjects).where(and(inArray(mediaObjects.key,[object.key,object.targetKey]),eq(mediaObjects.state,"pending")));
 await releaseTransferQuota(ctx.tx,plan.sourceNamespace,object.key);await releaseTransferQuota(ctx.tx,plan.targetNamespace,object.targetKey);
 ctx.setSubject("media_storage_transfer",plan.id);return{ok:true as const};
}});
const beginErasureInventory=defineMediaService({name:"media.captureProviderTransferErasureInventory",summary:"Capture immutable physical-version inventory under original erasure authority.",kind:"mutation",permission:"system",external:false,input:z.object({planId:z.uuid(),objectId:z.uuid(),side:z.enum(["source","target"]),anchorCallId:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof captureProviderInventory>>>(),auditInputFields:["planId","objectId","side","anchorCallId"],handler:async(input,ctx)=>{await erasureWork(ctx.tx,input.planId,input.objectId);return captureProviderInventory(ctx.tx,{...input,purpose:"erasure"},ctx.actor);}});
const readErasureInventory=defineMediaService({name:"media.readProviderTransferErasureInventory",summary:"Read only the original erasure provider page chain.",kind:"query",permission:"system",external:false,input:z.object({id:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof providerInventoryProgress>>>(),handler:async(input,ctx)=>{const[header]=await ctx.tx.select().from(mediaStorageProviderInventories).where(eq(mediaStorageProviderInventories.id,input.id)).limit(1);if(!header||header.purpose!=="erasure"||!header.objectId)transferConflict();await erasureWork(ctx.tx,header.planId,header.objectId);return providerInventoryProgress(ctx.tx,input.id,ctx.actor);}});
const appendErasureInventory=defineMediaService({name:"media.appendProviderTransferErasureInventory",summary:"Append an actual original provider page after its erasure caller returns.",kind:"mutation",permission:"system",external:false,input:z.object({inventoryId:z.uuid(),callId:z.uuid(),pass:z.union([z.literal(0),z.literal(1)]),kind:z.enum(["configuration","objects","versions","sessions","retained"]),cursor:z.record(z.string(),z.string()).nullable(),page:z.custom<TransferInventoryPage>().optional(),configuration:z.custom<TransferInventoryConfiguration>().optional()}),output:z.object({ok:z.literal(true)}),auditInputFields:["inventoryId","callId","pass","kind"],handler:async(input,ctx)=>{const[header]=await ctx.tx.select().from(mediaStorageProviderInventories).where(eq(mediaStorageProviderInventories.id,input.inventoryId)).limit(1);if(!header||header.purpose!=="erasure"||!header.objectId)transferConflict();await erasureWork(ctx.tx,header.planId,header.objectId);return appendProviderInventoryPage(ctx.tx,input,ctx.actor);}});
const finishErasureInventory=defineMediaService({name:"media.finishProviderTransferErasureInventory",summary:"Require complete immutable original version/session absence before erasure acknowledgement.",kind:"mutation",permission:"system",external:false,input:z.object({id:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof finishProviderInventory>>>(),auditInputFields:["id"],handler:async(input,ctx)=>{const[header]=await ctx.tx.select().from(mediaStorageProviderInventories).where(eq(mediaStorageProviderInventories.id,input.id)).limit(1);if(!header||header.purpose!=="erasure"||!header.objectId)transferConflict();await erasureWork(ctx.tx,header.planId,header.objectId);return finishProviderInventory(ctx.tx,input.id,ctx.actor);}});
export const eraseStorageTransferLineage=defineOrchestratedService({name:"media.eraseStorageTransferLineage",summary:"Finish original erasure across every admitted transfer copy without changing its first capture.",kind:"mutation",permission:"system",external:false,input:z.object({id:z.uuid(),objectId:z.uuid()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],handler:async(input,actor)=>{
 const work=await readWork.call(input,actor),{source,target}=await configuredTransferStores();
 if(source.binding.namespace!==work.plan.sourceNamespace||target.binding.namespace!==work.plan.targetNamespace)transferConflict("Restore both exact original private resources before completing erasure.");
 async function physical<T>(kind:z.infer<typeof admission>["kind"],operation:()=>Promise<T>,outcome:(value:T)=>ActualTransferReturn,expectedRevision?:StorageTransferRevision){
  await checkStorageTransferJob();
  const token=randomUUID()+randomUUID(),runtimeIdentity=await transferRuntimeIdentity(),call=await admit.call({planId:input.id,objectId:input.objectId,kind,token,runtimeIdentity,expectedRevision},actor);
  try{await checkStorageTransferJob();}catch(error){await retainTransferReturn(call.id,token,{notAttempted:true});throw error;}
  let accepted=false;
  try{const value=await withTransferRequestScope({callId:call.id,token,runtimeIdentity},operation),result=outcome(value);accepted=result.accepted===true;await retainTransferReturn(call.id,token,result);return{id:call.id,value};}catch(error){if(error instanceof TransferRequestNotAttemptedError&&error.logicalCallId===call.id){await retainTransferReturn(call.id,token,{notAttempted:true});throw error;}await retainTransferFailure(call.id,token,accepted).catch(()=>{});throw error;}
 }
 async function inventory(side:"source"|"target",store:AccountedTransferStore,anchorCallId:string){
  const header=await beginErasureInventory.call({planId:input.id,objectId:input.objectId,side,anchorCallId},actor);
  if(header.state==="complete")return header.id;if(header.state!=="capturing")transferConflict("Original physical versions or sessions remain; preserve their inventory for recovery.");
  let captured=await readErasureInventory.call({id:header.id},actor);
  const kind=side==="source"?"source_erasure_inventory":"target_erasure_inventory";
  for(const pass of [0,1]as const){
   if(!captured.pages.some(row=>row.pass===pass&&row.kind==="configuration")){const actual=await physical(kind,()=>store.inventoryConfiguration(),value=>({configurationDigest:transferDigest(value)}));await appendErasureInventory.call({inventoryId:header.id,callId:actual.id,pass,kind:"configuration",cursor:null,configuration:actual.value},actor);captured=await readErasureInventory.call({id:header.id},actor);}
   for(const inventoryKind of store.binding.kind==="s3"?["objects","versions","sessions"]as const:["objects","versions","retained"]as const){
    const prior=captured.pages.filter(row=>row.pass===pass&&row.kind===inventoryKind),last=prior.at(-1);if(last&&last.nextCursor===null)continue;let cursor=last?.nextCursor??null;
    for(let page=prior.length;;page++){if(page>=200)transferConflict("The complete original physical inventory exceeds the bounded limit; no subset proves erasure.");const actual=await physical(kind,()=>store.inventoryPage(inventoryKind,cursor),value=>({inventoryDigest:transferDigest(value),inventoryCount:value.entries.length}));await appendErasureInventory.call({inventoryId:header.id,callId:actual.id,pass,kind:inventoryKind,cursor,page:actual.value},actor);cursor=actual.value.next;if(cursor===null)break;}
    captured=await readErasureInventory.call({id:header.id},actor);
   }
  }
  const complete=await finishErasureInventory.call({id:header.id},actor);if(complete.state!=="complete")transferConflict("Original physical versions or sessions still prevent erasure.");return complete.id;
 }
 let sourceAbsence:string|undefined,targetAbsence:string|null=null,sourceInventory:string|undefined,targetInventory:string|null=null;
 for(const[side,store,key,readKind,deleteKind,absenceKind,revision]of[["target",target,work.object.targetKey,"privacy_read","privacy_delete","privacy_absence",work.targetRevision],["source",source,work.object.key,"privacy_source_read","privacy_source_delete","privacy_source_absence",work.sourceRevision]]as const){
  if(!revision){if(side==="target")continue;transferConflict("The actual original source provider revision is missing.");}
  const original=await physical(readKind,()=>store.readVersioned(key,revision),result=>result?{accepted:true,revision:result.revision,bytes:result.body.byteLength,sha256:createHash("sha256").update(result.body).digest("hex")}:{absent:true},revision);
  if(original.value){if(transferDigest(original.value.revision)!==transferDigest(revision))transferConflict("The read returned another generation; it cannot be adopted for erasure.");verifiedTransferBytes(original.value.body,work.object);await physical(deleteKind,()=>store.deleteVersioned(key,revision),()=>({accepted:true}),revision);}
  const absence=await physical(absenceKind,()=>store.readVersioned(key,revision),result=>result?{accepted:true,revision:result.revision,bytes:result.body.byteLength,sha256:createHash("sha256").update(result.body).digest("hex")}:{absent:true},revision);
  if(absence.value)transferConflict("An original physical copy remains after conditional erasure.");const proof=await inventory(side,store,absence.id);
  if(side==="source"){sourceAbsence=absence.id;sourceInventory=proof;}else{targetAbsence=absence.id;targetInventory=proof;}
 }
 if(!sourceAbsence||!sourceInventory)transferConflict();
 return finish.call({...input,targetAbsence,sourceAbsence,sourceInventory,targetInventory},actor);
}});
export async function deleteTransferredLineage(key:string):Promise<boolean|undefined>{
 const available=await db().transaction(transferSchemaAvailable);if(!available)return undefined;
 const rows=await db().select().from(mediaStorageTransferObjects).where(or(eq(mediaStorageTransferObjects.keyDigest,objectKeyDigest(key)),eq(mediaStorageTransferObjects.targetKeyDigest,objectKeyDigest(key)))).limit(2);
 if(!rows.length)return undefined;if(rows.length!==1)transferConflict("Conflicting original physical transfer lineage requires recovery.");
 const[plan]=await db().select().from(mediaStorageTransferPlans).where(eq(mediaStorageTransferPlans.id,rows[0]!.planId)).limit(1);
 if(plan&&["planned","copying","unknown","verified","blocked"].includes(plan.state)){
  const scopes=await db().select({request:dataRequests,artifact:dataRequestArtifacts}).from(mediaStorageTransferErasureMembers).innerJoin(dataRequests,eq(dataRequests.id,mediaStorageTransferErasureMembers.requestId)).innerJoin(dataRequestArtifacts,eq(dataRequestArtifacts.dataRequestId,dataRequests.id)).where(eq(mediaStorageTransferErasureMembers.objectId,rows[0]!.id));
  const schema=z.object({format:z.literal("freeholder.erasure-receipt"),outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),pendingJobs:z.array(z.string()).optional()}))});
  const authorized=scopes.some(scope=>{const parsed=schema.safeParse(scope.artifact.body);return scope.request.kind==="erasure"&&scope.request.verifiedAt&&erasureArtifactIsIntact(scope.artifact)&&parsed.success&&parsed.data.outcomes.some(outcome=>outcome.scope==="media.storageTransfers"&&outcome.outcome==="pending"&&outcome.pendingJobs?.length);});
  if(!authorized)return false; // The active transfer itself owns these copies.
 }
 await eraseStorageTransferLineage.call({id:rows[0]!.planId,objectId:rows[0]!.id},SYSTEM);return true;
}
export default [eraseStorageTransferLineage,readWork,admit,finish,beginErasureInventory,readErasureInventory,appendErasureInventory,finishErasureInventory];
