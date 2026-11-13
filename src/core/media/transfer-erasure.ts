// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: existing original erasure authority retires every physical copy.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq,inArray,or,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {defineOrchestratedService} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferReceipts} from "./transfer-schema";
import {assertTransferCallDrain,assertTransferOwners,lockedTransfer,transferSchemaAvailable} from "./transfer-authority";
import {admitTransferCall,retainTransferFailure,retainTransferReturn,transferRuntimeIdentity,type ActualTransferReturn} from "./transfer-callers";
import {configuredTransferStores} from "./transfer-storage";
import {objectKeyDigest} from "./write-ledger";
import {pendingObjectIsOwned,registerPendingObjectOwner} from "./object-ledger";
import {releaseTransferQuota} from "./transfer-quota";
import {transferConflict,transferDigest,verifiedTransferBytes} from "./transfer-proof";
import type {StorageTransferRevision} from "./transfer-schema";
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
 const work=await lockedTransfer(tx,id),object=work.objects.find(row=>row.id===objectId);if(!object)transferConflict();
 await assertTransferOwners(tx,[object],true);await assertTransferCallDrain(tx,[object.id]);
 const original=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,object.key)).limit(1);
 if(original[0]?.state==="attached"||await pendingObjectIsOwned(object.key,new Date(),tx))transferConflict("Retire the original owning reference before erasing its copied physical bytes.");
 return{plan:work.plan,object};
}
type ErasureWork=Awaited<ReturnType<typeof erasureWork>>;
const readWork=defineMediaService({name:"media.captureTransferErasure",summary:"Capture exact original erasure lineage after its owning reference retires.",kind:"query",permission:"system",external:false,input:z.object({id:z.uuid(),objectId:z.uuid()}),output:z.custom<ErasureWork>(),handler:async(input,ctx)=>erasureWork(ctx.tx,input.id,input.objectId)});
const admission=z.object({planId:z.uuid(),objectId:z.uuid(),kind:z.enum(["privacy_read","privacy_delete","privacy_absence","privacy_source_read","privacy_source_delete","privacy_source_absence"]),token:z.string().min(36),runtimeIdentity:z.object({boot:z.string(),pid:z.number().int().positive(),startTicks:z.string()}),expectedRevision:z.object({kind:z.enum(["etag","generation"]),namespace:z.string(),key:z.string(),value:z.string()}).optional()});
const admit=defineMediaService({name:"media.admitTransferErasureCall",summary:"Commit an original transfer erasure caller before private provider I/O.",kind:"mutation",permission:"system",external:false,input:admission,output:z.object({id:z.uuid()}),auditInputFields:["planId","objectId","kind"],handler:async(input,ctx)=>{await erasureWork(ctx.tx,input.planId,input.objectId);return admitTransferCall(ctx.tx,input,ctx.actor);}});
const finish=defineMediaService({name:"media.finishTransferErasure",summary:"Retire original receipt lineage only after both physical copies and callers are gone.",kind:"mutation",permission:"system",external:false,input:z.object({id:z.uuid(),objectId:z.uuid(),sourceAbsence:z.uuid(),targetAbsence:z.uuid()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],handler:async(input,ctx)=>{
 const{plan,object}=await erasureWork(ctx.tx,input.id,input.objectId);
 const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id)).orderBy(asc(mediaStorageTransferCalls.createdAt));
 for(const[callId,kind,namespace,key]of[[input.sourceAbsence,"privacy_source_absence",plan.sourceNamespace,object.key],[input.targetAbsence,"privacy_absence",plan.targetNamespace,object.targetKey]]as const){
  const proof=calls.find(row=>row.id===callId);
  if(!proof||proof.kind!==kind||proof.state!=="returned"||!proof.returnedAt||!proof.resultAbsent||proof.namespace!==namespace||proof.physicalKey!==key)transferConflict("Both exact original physical resources need finished absence receipts.");
 }
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
export const eraseStorageTransferLineage=defineOrchestratedService({name:"media.eraseStorageTransferLineage",summary:"Finish original erasure across every admitted transfer copy without changing its first capture.",kind:"mutation",permission:"system",external:false,input:z.object({id:z.uuid(),objectId:z.uuid()}),output:z.object({ok:z.literal(true)}),auditInputFields:["id","objectId"],handler:async(input,actor)=>{
 const work=await readWork.call(input,actor),{source,target}=await configuredTransferStores();
 if(transferDigest(source.binding)!==transferDigest(work.plan.originalSource)||transferDigest(target.binding)!==transferDigest(work.plan.originalTarget))transferConflict("Restore both exact original private resources before completing erasure.");
 async function physical<T>(kind:z.infer<typeof admission>["kind"],operation:()=>Promise<T>,outcome:(value:T)=>ActualTransferReturn,expectedRevision?:StorageTransferRevision){
  const token=randomUUID()+randomUUID(),runtimeIdentity=await transferRuntimeIdentity(),call=await admit.call({planId:input.id,objectId:input.objectId,kind,token,runtimeIdentity,expectedRevision},actor);let accepted=false;
  try{const value=await operation(),result=outcome(value);accepted=result.accepted===true;await retainTransferReturn(call.id,token,result);return{id:call.id,value};}catch(error){await retainTransferFailure(call.id,token,accepted).catch(()=>{});throw error;}
 }
 const absences:string[]=[];
 for(const[store,key,readKind,deleteKind,absenceKind]of[[target,work.object.targetKey,"privacy_read","privacy_delete","privacy_absence"],[source,work.object.key,"privacy_source_read","privacy_source_delete","privacy_source_absence"]]as const){
  const original=await physical(readKind,()=>store.readVersioned(key),result=>result?{accepted:true,revision:result.revision,bytes:result.body.byteLength,sha256:createHash("sha256").update(result.body).digest("hex")}:{absent:true});
  if(original.value){verifiedTransferBytes(original.value.body,work.object);await physical(deleteKind,()=>store.deleteVersioned(key,original.value!.revision),()=>({accepted:true}),original.value.revision);}
  const absence=await physical(absenceKind,()=>store.readVersioned(key),result=>result?{accepted:true,revision:result.revision,bytes:result.body.byteLength,sha256:createHash("sha256").update(result.body).digest("hex")}:{absent:true});
  if(absence.value)transferConflict("An original transfer copy remains after conditional erasure.");absences.push(absence.id);
 }
 return finish.call({...input,targetAbsence:absences[0]!,sourceAbsence:absences[1]!},actor);
}});
export async function deleteTransferredLineage(key:string):Promise<boolean|undefined>{
 const available=await db().transaction(transferSchemaAvailable);if(!available)return undefined;
 const rows=await db().select().from(mediaStorageTransferObjects).where(or(eq(mediaStorageTransferObjects.keyDigest,objectKeyDigest(key)),eq(mediaStorageTransferObjects.targetKeyDigest,objectKeyDigest(key)))).limit(2);
 if(!rows.length)return undefined;if(rows.length!==1)transferConflict("Conflicting original physical transfer lineage requires recovery.");
 await eraseStorageTransferLineage.call({id:rows[0]!.planId,objectId:rows[0]!.id},SYSTEM);return true;
}
export default [eraseStorageTransferLineage,readWork,admit,finish];
