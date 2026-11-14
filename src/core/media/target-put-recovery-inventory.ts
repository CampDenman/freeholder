// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reuse the exact receipt-parent inventory ledger for an original target PUT.
// Provider I/O runs only in the genuine public human review orchestrator.
import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {AccountedTransferStore} from "../../../scripts/media-transfer.mjs";
import {hasModuleAccess,type Actor} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {originalInventoryLifecycle,lockedOriginalRecoveryInventory,originalRecoveryInventoryProgress,appendOriginalRecoveryInventoryPage,finishOriginalRecoveryInventory,type OriginalInventoryPageResult} from "./original-provider-inventory";
import {admitOriginalMediaCaller,retainOriginalMediaCallerReturn,type OriginalMediaCallerReturn} from "./provider-callers";
import {actualStorageCallerRuntimeIdentity,currentStorageCallerRuntimeSchema} from "./physical-caller-runtime";
import {withTransferRequestScope} from "./transfer-requests";
import {transferConflict,transferDigest} from "./transfer-proof";
function human(actor:Actor){if(actor.kind!=="user"||actor.keyScopes||!hasModuleAccess(actor,"media","manage"))transferConflict("Sign in again as a person with permission to review the original storage operation.");}
const captureInput=z.object({receiptId:z.uuid(),callId:z.uuid(),proofCallId:z.uuid(),expectedWitness:z.string().regex(/^[a-f0-9]{64}$/),stopDrainId:z.uuid().optional()});
const begin=defineMediaService({name:"media.captureTargetPutReviewInventory",summary:"Capture the exact original target physical admission and actual nonce-bound read before complete inventory.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:captureInput,output:z.object({id:z.uuid()}),auditInputFields:["receiptId","callId","proofCallId","stopDrainId"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await originalInventoryLifecycle.captureTransferPut(ctx.tx,input.receiptId,input.callId,input.stopDrainId);if(!original.transferContext||original.witness!==input.expectedWitness)transferConflict("The original target caller changed before its first recovery inventory.");
 const header=await originalInventoryLifecycle.capture(ctx.tx,{receiptId:input.receiptId,originalCallId:input.callId,proofCallId:input.proofCallId,stopDrainId:input.stopDrainId,transferCallId:input.callId},"recovery");return{id:header.id};
}});
const progress=defineMediaService({name:"media.readTargetPutReviewInventory",summary:"Read the unchanged complete target recovery page chain.",kind:"query",permission:"scoped",agentCallable:false,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:z.object({id:z.uuid()}),output:z.custom<Awaited<ReturnType<typeof originalRecoveryInventoryProgress>>>(),handler:async(input,ctx)=>{human(ctx.actor);const original=await lockedOriginalRecoveryInventory(ctx.tx,input.id,ctx.actor);if(!original.transferContext)transferConflict();return originalRecoveryInventoryProgress(ctx.tx,input.id,ctx.actor);}});
const admit=defineMediaService({name:"media.admitTargetPutReviewInventoryRequest",summary:"Commit one new actual provider metadata/page caller in the exact original target receipt.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:z.object({id:z.uuid(),token:z.string().min(36),runtimeIdentity:currentStorageCallerRuntimeSchema}),output:z.object({id:z.uuid()}),auditInputFields:["id"],handler:async(input,ctx)=>{
 human(ctx.actor);const original=await lockedOriginalRecoveryInventory(ctx.tx,input.id,ctx.actor);if(!original.transferContext||original.inventory.state!=="capturing")transferConflict();return admitOriginalMediaCaller(ctx.tx,{kind:"ordinary_retirement_inventory",objectReceiptId:original.receipt.id,token:input.token,runtimeIdentity:input.runtimeIdentity},ctx.actor);
}});
const append=defineMediaService({name:"media.appendTargetPutReviewInventoryPage",summary:"Append one authentic finished page without replacing its original receipt or cursor.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:z.custom<OriginalInventoryPageResult>(),output:z.object({ok:z.literal(true)}),auditInputFields:["inventoryId","callId","pass","kind"],handler:async(input,ctx)=>{human(ctx.actor);const original=await lockedOriginalRecoveryInventory(ctx.tx,input.inventoryId,ctx.actor);if(!original.transferContext)transferConflict();return appendOriginalRecoveryInventoryPage(ctx.tx,input,ctx.actor);}});
const finish=defineMediaService({name:"media.finishTargetPutReviewInventory",summary:"Require original nonce/full bytes and both complete target version/session passes before positive review.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reviewStorageTransferCall",input:z.object({id:z.uuid()}),output:z.object({id:z.uuid()}),auditInputFields:["id"],handler:async(input,ctx)=>{human(ctx.actor);const original=await lockedOriginalRecoveryInventory(ctx.tx,input.id,ctx.actor);if(!original.transferContext)transferConflict();return{id:(await finishOriginalRecoveryInventory(ctx.tx,input.id,ctx.actor)).id};}});
async function physical<T>(id:string,actor:Actor,operation:()=>Promise<T>,outcome:(value:T)=>OriginalMediaCallerReturn){
 const token=randomUUID()+randomUUID(),runtimeIdentity=await actualStorageCallerRuntimeIdentity(),call=await admit.call({id,token,runtimeIdentity},actor);
 try{const value=await withTransferRequestScope({callId:call.id,token,runtimeIdentity},operation);if(!(await retainOriginalMediaCallerReturn(call.id,token,outcome(value))).settled)transferConflict();return{id:call.id,value};}
 catch(error){await retainOriginalMediaCallerReturn(call.id,token,{failed:true}).catch(()=>{});throw error;}
}
export async function collectTargetPutRecoveryInventory(input:z.infer<typeof captureInput>,store:AccountedTransferStore,actor:Actor){
 const header=await begin.call(input,actor);let captured=await progress.call(header,actor);if(captured.inventory.state==="complete")return header.id;if(captured.inventory.state!=="capturing")transferConflict();
 if(store.binding.namespace!==captured.inventory.namespace||transferDigest(store.binding)!==transferDigest(captured.inventory.binding))transferConflict("Restore the exact original private target provider before reviewing it.");
 for(const pass of [0,1]as const){
  if(!captured.pages.some(row=>row.pass===pass&&row.kind==="configuration")){const actual=await physical(header.id,actor,()=>store.inventoryConfiguration(),value=>({configurationDigest:transferDigest(value)}));await append.call({inventoryId:header.id,callId:actual.id,pass,kind:"configuration",cursor:null,configuration:actual.value},actor);captured=await progress.call(header,actor);}
  for(const kind of store.binding.kind==="s3"?["objects","versions","sessions"]as const:["objects","versions","retained"]as const){
   const prior=captured.pages.filter(row=>row.pass===pass&&row.kind===kind),last=prior.at(-1);if(last&&last.nextCursor===null)continue;let cursor=last?.nextCursor??null;
   for(let page=prior.length;;page++){if(page>=200)transferConflict("The complete target recovery inventory exceeds this bounded proof. Retain its first capture; no subset may settle it.");const actual=await physical(header.id,actor,()=>store.inventoryPage(kind,cursor),value=>({inventoryDigest:transferDigest(value),inventoryCount:value.entries.length}));await append.call({inventoryId:header.id,callId:actual.id,pass,kind,cursor,page:actual.value},actor);cursor=actual.value.next;if(cursor===null)break;}
   captured=await progress.call(header,actor);
  }
 }
 await finish.call(header,actor);return header.id;
}
export default[begin,progress,admit,append,finish];
