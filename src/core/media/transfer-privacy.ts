// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: first privacy membership is immutable, including empty capture.
import {randomUUID} from "node:crypto";
import {and,asc,eq,inArray,isNull,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {lockContactIdentity} from "@/core/contacts/identity-lock";
import {enqueueJob,type JobExecutionContext} from "@/core/jobs";
import {completeErasureJob,erasureArtifactIsIntact,registerContactPrivacySource} from "@/core/privacy/service";
import {dataRequestArtifacts,dataRequests} from "@/core/privacy/schema";
import {defineService,getService,type Tx} from "@/core/service";
import {registerRetentionSource} from "@/core/retention/registry";
import {registerStorageObservationReconciler,reconcileCommittedStorageObservation} from "./observation-hooks";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferErasureMembers,mediaStorageTransferErasureScopes,mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageTransferReceipts,mediaStorageTransferReviews,mediaStorageTransferSubjects} from "./transfer-schema";
import {lockTransferInventory,requireTransferCapability} from "./transfer-authority";
import {storageOperationsHeld,objectKeyDigest} from "./write-ledger";
import {eraseStorageTransferLineage} from "./transfer-erasure";
import {transferConflict,transferDigest} from "./transfer-proof";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";
import {mediaStorageProviderInventories,mediaStorageProviderInventoryPages,mediaStorageProviderInventoryEntries} from "./transfer-inventory-schema";
import {originalQuotaProof,originalQuotaLocatorPending} from "./original-quota-evidence";
import {transferRequestsDrained} from "./transfer-requests";
export const TRANSFER_PRIVACY_SCOPE="media.storageTransfers";
export const TRANSFER_ERASURE_JOB="core.eraseMediaStorageTransfer";
const SYSTEM={kind:"system"}as const;
const payload=z.object({requestId:z.uuid(),originalJobId:z.uuid(),objectIds:z.array(z.uuid()).max(100)});
const receipt=z.object({format:z.literal("freeholder.erasure-receipt"),outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),pendingJobs:z.array(z.uuid()).optional()}))});
async function owned(tx:Tx,contactId:string){return tx.select({object:mediaStorageTransferObjects,plan:mediaStorageTransferPlans}).from(mediaStorageTransferSubjects).innerJoin(mediaStorageTransferObjects,eq(mediaStorageTransferObjects.id,mediaStorageTransferSubjects.objectId)).innerJoin(mediaStorageTransferPlans,eq(mediaStorageTransferPlans.id,mediaStorageTransferObjects.planId)).where(eq(mediaStorageTransferSubjects.contactId,contactId)).orderBy(asc(mediaStorageTransferObjects.id)).limit(10001);}
async function capture(tx:Tx,requestId:string,contactId:string){
 await lockTransferInventory(tx);const[prior]=await tx.select().from(mediaStorageTransferErasureScopes).where(eq(mediaStorageTransferErasureScopes.requestId,requestId)).limit(1).for("update");
 if(prior){if(!prior.complete)transferConflict("Restore the incomplete original transfer erasure capture.");return prior;}
 const rows=await owned(tx,contactId);if(rows.length>10000)transferConflict("The original transfer erasure membership exceeds the bounded capture.");
 const members=[...new Map(rows.map(row=>[row.object.id,{id:row.object.id,manifest:row.plan.manifestDigest}])).values()],captureDigest=transferDigest(members);
 await tx.insert(mediaStorageTransferErasureScopes).values({requestId,objectCount:members.length,captureDigest,complete:false});
 if(members.length)await tx.insert(mediaStorageTransferErasureMembers).values(members.map(row=>({requestId,objectId:row.id,originalPlanDigest:row.manifest})));
 await tx.update(mediaStorageTransferErasureScopes).set({complete:true}).where(eq(mediaStorageTransferErasureScopes.requestId,requestId));
 return{requestId,objectCount:members.length,captureDigest,complete:true};
}
async function members(tx:Tx,requestId:string){
 const[scope]=await tx.select().from(mediaStorageTransferErasureScopes).where(eq(mediaStorageTransferErasureScopes.requestId,requestId)).limit(1);
 const rows=await tx.select({member:mediaStorageTransferErasureMembers,plan:mediaStorageTransferPlans}).from(mediaStorageTransferErasureMembers).innerJoin(mediaStorageTransferObjects,eq(mediaStorageTransferObjects.id,mediaStorageTransferErasureMembers.objectId)).innerJoin(mediaStorageTransferPlans,eq(mediaStorageTransferPlans.id,mediaStorageTransferObjects.planId)).where(eq(mediaStorageTransferErasureMembers.requestId,requestId)).orderBy(asc(mediaStorageTransferErasureMembers.objectId));
 if(!scope?.complete||scope.objectCount!==rows.length||rows.some(row=>row.member.originalPlanDigest!==row.plan.manifestDigest)||scope.captureDigest!==transferDigest(rows.map(row=>({id:row.member.objectId,manifest:row.member.originalPlanDigest}))))transferConflict("Restore the exact original transfer erasure capture; current objects cannot fill missing membership.");
 return rows.map(row=>row.member.objectId);
}
export async function minimizeTransferredObjects(tx:Tx,ids:string[]):Promise<number>{
 await lockTransferInventory(tx);let minimized=0;
 for(const id of ids){
  const[object]=await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.id,id)).limit(1).for("update");if(!object)transferConflict();
  const subjects=await tx.select().from(mediaStorageTransferSubjects).where(eq(mediaStorageTransferSubjects.objectId,id));
  if(await storageOperationsHeld(tx,subjects.map(row=>row.contactId)))continue;
  const calls=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,id));
  if(calls.some(row=>["admitted","unknown"].includes(row.state))||!await transferRequestsDrained(tx,calls.map(row=>row.id))||await originalQuotaLocatorPending(tx,calls))continue;
  const membership=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,id));
  const physicalIds=[...new Set([...membership.map(row=>row.receiptId),...calls.flatMap(row=>row.physicalReceiptId?[row.physicalReceiptId]:[])])];
  const writes=physicalIds.length?await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,physicalIds)):[];
  if(!writes.length||writes.some(row=>!row.deletedAt||!["accepted","confirmed_absent"].includes(row.state)))continue;
  const complete=await tx.execute<{retired:boolean}>(sql`select freeholder_media_transfer_object_retired(${object.id}::uuid) as retired`);
  if(complete[0]?.retired!==true)continue;
  const now=new Date();
  // This exact captured lineage has both complete physical inventory proofs.
  // Ordinary legacy minimization remains independently blocked.
  for(const write of writes)await tx.update(mediaObjectWrites).set({key:`retained:${write.keyDigest}`,actor:"erased",contactId:null,storageLocation:{},providerRevision:null,reviewedBy:null,redactedAt:write.redactedAt??now,updatedAt:now}).where(eq(mediaObjectWrites.id,write.id));
  const physicalRequests=calls.length?await tx.select().from(mediaStorageTransferRequests).where(inArray(mediaStorageTransferRequests.callId,calls.map(row=>row.id))):[];
  for(const request of physicalRequests){
   if(!request.redactedAt){const original=request.descriptor;await tx.update(mediaStorageTransferRequests).set({descriptor:{kind:original.kind,binding:{kind:original.binding.kind,namespace:original.binding.namespace,location:{}},...(request.keyDigest?{key:`retained:${request.keyDigest}`}:{})},redactedAt:now}).where(eq(mediaStorageTransferRequests.id,request.id));}
   const facts=await tx.select().from(mediaStorageTransferRequestObservations).where(eq(mediaStorageTransferRequestObservations.requestId,request.id));
   for(const fact of facts)if(!fact.redactedAt)await tx.update(mediaStorageTransferRequestObservations).set({facts:{stage:fact.facts.stage,status:fact.facts.status},redactedAt:now}).where(eq(mediaStorageTransferRequestObservations.id,fact.id));
  }
  const providerHeaders=await tx.select().from(mediaStorageProviderInventories).where(eq(mediaStorageProviderInventories.planId,object.planId));
  for(const header of providerHeaders){
   const digest=header.side==="source"?object.keyDigest:object.targetKeyDigest;
   const capturedEntries=await tx.select().from(mediaStorageProviderInventoryEntries).where(and(eq(mediaStorageProviderInventoryEntries.inventoryId,header.id),eq(mediaStorageProviderInventoryEntries.keyDigest,digest)));
   for(const entry of capturedEntries)if(!entry.redactedAt)await tx.update(mediaStorageProviderInventoryEntries).set({entry:{kind:entry.entry.kind,key:`retained:${entry.keyDigest}`,bytes:entry.entry.bytes,current:entry.entry.current},redactedAt:now}).where(eq(mediaStorageProviderInventoryEntries.id,entry.id));
   const capturedPages=await tx.select().from(mediaStorageProviderInventoryPages).where(eq(mediaStorageProviderInventoryPages.inventoryId,header.id));
   for(const page of capturedPages)if(!page.redactedAt&&[page.cursor,page.nextCursor].some(cursor=>cursor?.key&&objectKeyDigest(cursor.key)===digest))await tx.update(mediaStorageProviderInventoryPages).set({cursor:null,nextCursor:null,redactedAt:now}).where(eq(mediaStorageProviderInventoryPages.id,page.id));
  }
  await tx.update(mediaStorageTransferReceipts).set({originalSnapshot:{}}).where(eq(mediaStorageTransferReceipts.objectId,id));
  await tx.update(mediaStorageTransferSubjects).set({contactId:null,redactedAt:now}).where(and(eq(mediaStorageTransferSubjects.objectId,id),isNull(mediaStorageTransferSubjects.redactedAt)));
  const[originalPlan]=await tx.select().from(mediaStorageTransferPlans).where(eq(mediaStorageTransferPlans.id,object.planId)).limit(1);if(!originalPlan)transferConflict();
  for(const call of calls)if(!call.redactedAt||call.resultRevision||call.expectedRevision)await tx.update(mediaStorageTransferCalls).set({physicalKey:`retained:${call.namespace===originalPlan.sourceNamespace?object.keyDigest:object.targetKeyDigest}`,expectedRevision:null,resultRevision:null,redactedAt:call.redactedAt??now,updatedAt:now}).where(eq(mediaStorageTransferCalls.id,call.id));
  if(!object.redactedAt){
   await tx.update(mediaStorageTransferObjects).set({key:`retained:${object.keyDigest}`,targetKey:`retained:${object.targetKeyDigest}`,sourceRevision:null,targetRevision:null,state:"cancelled",redactedAt:now,updatedAt:now}).where(eq(mediaStorageTransferObjects.id,id));
  }
  const remaining=await tx.select({id:mediaStorageTransferObjects.id}).from(mediaStorageTransferObjects).where(and(eq(mediaStorageTransferObjects.planId,object.planId),isNull(mediaStorageTransferObjects.redactedAt))).limit(1);
  if(!remaining.length){const[plan]=await tx.select().from(mediaStorageTransferPlans).where(eq(mediaStorageTransferPlans.id,object.planId)).limit(1);if(plan&&!plan.redactedAt)await tx.update(mediaStorageTransferPlans).set({originalSource:{kind:plan.originalSource.kind,namespace:plan.sourceNamespace,location:{}},originalTarget:{kind:plan.originalTarget.kind,namespace:plan.targetNamespace,location:{}},createdBy:"erased",state:"cancelled",redactedAt:now,updatedAt:now}).where(eq(mediaStorageTransferPlans.id,plan.id));}
  minimized++;
 }
 return minimized;
}
registerContactPrivacySource({scope:TRANSFER_PRIVACY_SCOPE,tables:["media_storage_transfer_plans","media_storage_transfer_objects","media_storage_transfer_receipts","media_storage_transfer_subjects","media_storage_transfer_calls","media_storage_transfer_reviews","media_storage_transfer_erasure_scopes","media_storage_transfer_erasure_members","media_storage_writer_drains","media_storage_transfer_jobs","media_storage_transfer_requests","media_storage_transfer_request_observations","media_storage_provider_inventories","media_storage_provider_inventory_pages","media_storage_provider_inventory_entries","storage_quota_objects"],retentionScopes:["members","media.storageOperations","media.multipartOperations"],requiresLogin:true,eraseOrder:19,
 captureRetention:async(tx,contactId,context)=>{if(context.isNew)await capture(tx,context.requestId,contactId);},
 exportData:async(tx,contactId)=>{await requireTransferCapability(tx);const rows=await owned(tx,contactId),ids=[...new Set(rows.map(row=>row.object.id))];
  const callers=ids.length?await tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,ids)):[],requests=callers.length?await tx.select().from(mediaStorageTransferRequests).where(inArray(mediaStorageTransferRequests.callId,callers.map(row=>row.id))):[];
  const planIds=[...new Set(rows.map(row=>row.plan.id))];
  const headers=planIds.length?await tx.select({id:mediaStorageProviderInventories.id,planId:mediaStorageProviderInventories.planId,side:mediaStorageProviderInventories.side,purpose:mediaStorageProviderInventories.purpose,state:mediaStorageProviderInventories.state,firstDigest:mediaStorageProviderInventories.firstDigest,confirmedDigest:mediaStorageProviderInventories.confirmedDigest}).from(mediaStorageProviderInventories).where(inArray(mediaStorageProviderInventories.planId,planIds)):[];
  const resources=headers.length&&ids.length?await tx.select().from(mediaStorageProviderInventoryEntries).where(and(inArray(mediaStorageProviderInventoryEntries.inventoryId,headers.map(row=>row.id)),inArray(mediaStorageProviderInventoryEntries.originalObjectId,ids))):[];
  const pageIds=[...new Set(resources.map(row=>row.pageId))],pageProofs=pageIds.length?await tx.select({id:mediaStorageProviderInventoryPages.id,inventoryId:mediaStorageProviderInventoryPages.inventoryId,callId:mediaStorageProviderInventoryPages.callId,pass:mediaStorageProviderInventoryPages.pass,kind:mediaStorageProviderInventoryPages.kind,pageDigest:mediaStorageProviderInventoryPages.pageDigest,membershipDigest:mediaStorageProviderInventoryPages.membershipDigest}).from(mediaStorageProviderInventoryPages).where(inArray(mediaStorageProviderInventoryPages.id,pageIds)):[];
  return{quota:await originalQuotaProof(tx,callers),physicalRequests:requests.map(row=>({id:row.id,callId:row.callId,keyDigest:row.keyDigest,state:row.state,returnedAt:row.returnedAt,descriptorDigest:row.descriptorDigest})),physicalObservations:requests.length?await tx.select({id:mediaStorageTransferRequestObservations.id,requestId:mediaStorageTransferRequestObservations.requestId,ordinal:mediaStorageTransferRequestObservations.ordinal,factsDigest:mediaStorageTransferRequestObservations.factsDigest,bytes:mediaStorageTransferRequestObservations.bytes,createdAt:mediaStorageTransferRequestObservations.createdAt}).from(mediaStorageTransferRequestObservations).where(inArray(mediaStorageTransferRequestObservations.requestId,requests.map(row=>row.id))):[],providerInventory:headers,providerPages:pageProofs,providerResources:resources,objects:rows.map(row=>row.object),plans:[...new Map(rows.map(row=>[row.plan.id,row.plan])).values()],receipts:ids.length?await tx.select().from(mediaStorageTransferReceipts).where(inArray(mediaStorageTransferReceipts.objectId,ids)):[],callers:ids.length?await tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,ids)):[],reviews:ids.length?await tx.select().from(mediaStorageTransferReviews).where(inArray(mediaStorageTransferReviews.objectId,ids)):[]};},
 erase:async(tx,contactId,context)=>{
  const scope=await capture(tx,context.requestId,contactId),ids=await members(tx,context.requestId);await minimizeTransferredObjects(tx,ids);
  const pending=ids.length?await tx.select({id:mediaStorageTransferObjects.id}).from(mediaStorageTransferObjects).where(and(inArray(mediaStorageTransferObjects.id,ids),isNull(mediaStorageTransferObjects.redactedAt))).orderBy(asc(mediaStorageTransferObjects.id)):[];
  const current=await owned(tx,contactId),foreign=current.some(row=>!ids.includes(row.object.id));
  const pendingJobs:string[]=[];
  for(let offset=0;offset<Math.max(pending.length,foreign?1:0);offset+=100){const originalJobId=randomUUID(),job=await enqueueJob(tx,TRANSFER_ERASURE_JOB,{requestId:context.requestId,originalJobId,objectIds:pending.slice(offset,offset+100).map(row=>row.id)},{id:originalJobId,idempotencyKey:`transfer-erasure:${context.requestId}:${offset}`});pendingJobs.push(job.id);}
  return{affected:scope.objectCount,pendingJobs};
 },
});
export async function eraseMediaStorageTransfer(data:Record<string,unknown>,context:JobExecutionContext):Promise<{erased:number}>{
 const input=payload.parse(data);if(context.id!==input.originalJobId||context.name!==TRANSFER_ERASURE_JOB)transferConflict("The actual worker does not own this original erasure job.");
 const captured=await db().transaction(async tx=>{
  const originalJob=await tx.execute(sql`select id from pgboss.job where id=${input.originalJobId}::uuid and name=${TRANSFER_ERASURE_JOB} and data=${JSON.stringify(input)}::jsonb`);if(originalJob.length!==1)transferConflict("Restore the exact original queued transfer erasure payload.");
  await lockContactIdentity(tx);await requireTransferCapability(tx);
  const[request]=await tx.select().from(dataRequests).where(eq(dataRequests.id,input.requestId)).limit(1),[artifact]=await tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,input.requestId)).limit(1),parsed=receipt.safeParse(artifact?.body);
  if(!request||!artifact||!erasureArtifactIsIntact(artifact)||!parsed.success)transferConflict("Restore the intact original transfer erasure receipt.");
  const outcome=parsed.data.outcomes.find(row=>row.scope===TRANSFER_PRIVACY_SCOPE);if(outcome?.outcome!=="pending"||!outcome.pendingJobs?.includes(input.originalJobId))return null;
  const ids=await members(tx,input.requestId);if(input.objectIds.some(id=>!ids.includes(id)))transferConflict("The queued transfer erasure contains a foreign original object.");
  const current=await owned(tx,request.contactId);if(current.some(row=>!ids.includes(row.object.id)))transferConflict("A later original generation is outside this immutable erasure scope. Start a newly verified request after review.");
  return input.objectIds.length?await tx.select().from(mediaStorageTransferObjects).where(inArray(mediaStorageTransferObjects.id,input.objectIds)):[];
 });
 if(!captured)return{erased:0};
 for(const object of captured){await eraseStorageTransferLineage.call({id:object.planId,objectId:object.id},SYSTEM);}
 const erased=await db().transaction(async tx=>{await lockContactIdentity(tx);const count=await minimizeTransferredObjects(tx,input.objectIds);const pending=input.objectIds.length?await tx.select({id:mediaStorageTransferObjects.id}).from(mediaStorageTransferObjects).where(and(inArray(mediaStorageTransferObjects.id,input.objectIds),isNull(mediaStorageTransferObjects.redactedAt))).limit(1):[];if(pending.length)transferConflict("Original callers, physical copies or a named hold keep transfer erasure pending.");return count;});
 await completeErasureJob.call({requestId:input.requestId,scope:TRANSFER_PRIVACY_SCOPE,jobId:input.originalJobId},SYSTEM);return{erased};
}
export const reconcileStorageTransferErasure=defineService({name:"media.reconcileStorageTransferErasure",summary:"Reopen original transfer erasure debt from exact immutable members after physical facts commit.",kind:"mutation",permission:"system",external:false,input:z.object({receiptId:z.uuid().optional(),after:z.uuid().optional()}),output:z.object({reopened:z.number().int().nonnegative(),next:z.uuid().nullable()}),handler:async(input,ctx)=>{
 await lockContactIdentity(ctx.tx);await lockTransferInventory(ctx.tx);const original=input.receiptId?await ctx.tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.receiptId,input.receiptId)):[];
 const observed=input.receiptId?await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.physicalReceiptId,input.receiptId)):[];
 const ids=[...new Set([...original.map(row=>row.objectId),...observed.map(row=>row.objectId)])];
 const scopes=await ctx.tx.execute<{request_id:string}>(sql`select distinct scope.request_id from media_storage_transfer_erasure_scopes scope join media_storage_transfer_erasure_members member on member.request_id=scope.request_id join data_requests request on request.id=scope.request_id where scope.complete and request.kind='erasure' and request.verified_at is not null and request.status in ('completed','partially_completed','in_progress') and (${input.after??null}::uuid is null or scope.request_id>${input.after??null}::uuid) ${input.receiptId?sql`and member.object_id in (${ids.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`):sql`null::uuid`})`:sql``} order by scope.request_id limit 100`);
 let reopened=0;
 for(const scope of scopes){const objectIds=await members(ctx.tx,scope.request_id),objects=objectIds.length?await ctx.tx.select().from(mediaStorageTransferObjects).where(inArray(mediaStorageTransferObjects.id,objectIds)):[];let pending=false;const evidence:unknown[]=[];
  for(const object of objects){const calls=await ctx.tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.objectId,object.id)),writes=await ctx.tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.keyDigest,[object.keyDigest,object.targetKeyDigest]));evidence.push({objectId:object.id,calls:calls.map(row=>({id:row.id,state:row.state,observedAcceptedAt:row.observedAcceptedAt,resultDigest:row.resultDigest,stopReceiptId:row.stopReceiptId})),writes:writes.map(row=>({id:row.id,state:row.state,observedAcceptedAt:row.observedAcceptedAt,deletedAt:row.deletedAt}))});if(calls.some(row=>["admitted","unknown"].includes(row.state))||writes.some(row=>!row.deletedAt||!["accepted","confirmed_absent"].includes(row.state)))pending=true;}
  if(!pending)continue;
  const helper=getService("privacy.reopenErasureJob");if(!helper)transferConflict();
  for(let offset=0;offset<objectIds.length;offset+=100){await ctx.callAsSystem(helper,{requestId:scope.request_id,scope:TRANSFER_PRIVACY_SCOPE,jobName:TRANSFER_ERASURE_JOB,jobData:{objectIds:objectIds.slice(offset,offset+100)},idempotencyKey:`transfer-late:${transferDigest(evidence)}:${offset}`});reopened++;}
 }
 return{reopened,next:scopes.length===100?scopes.at(-1)!.request_id:null};
}});
registerStorageObservationReconciler(TRANSFER_PRIVACY_SCOPE,async receiptId=>{
 await reconcileStorageTransferErasure.call({receiptId},SYSTEM);
 const original=await db().select({receiptId:mediaStorageTransferReceipts.receiptId}).from(mediaStorageTransferCalls).innerJoin(mediaStorageTransferReceipts,eq(mediaStorageTransferReceipts.objectId,mediaStorageTransferCalls.objectId)).where(eq(mediaStorageTransferCalls.physicalReceiptId,receiptId));
 for(const member of original)await reconcileCommittedStorageObservation(member.receiptId);
 if(original.length){const imports=getService("imports.reconcileOriginalSourceErasure");if(imports)await imports.call({},SYSTEM);}
});
registerRetentionSource({kind:"mediaStorageTransfers",tables:["media_storage_transfer_objects","media_storage_transfer_calls","media_storage_transfer_subjects","media_storage_transfer_requests","media_storage_transfer_request_observations","media_storage_provider_inventories","media_storage_provider_inventory_pages","media_storage_provider_inventory_entries"],privacyScope:TRANSFER_PRIVACY_SCOPE,purge:async args=>db().transaction(async tx=>{await lockContactIdentity(tx);await requireTransferCapability(tx);const rows=await tx.select({id:mediaStorageTransferObjects.id}).from(mediaStorageTransferObjects).where(and(isNull(mediaStorageTransferObjects.redactedAt),sql`${mediaStorageTransferObjects.createdAt}<${args.cutoff.toISOString()}::timestamptz`,args.exceptContactIds.length?sql`not exists(select 1 from media_storage_transfer_subjects subject where subject.object_id=${mediaStorageTransferObjects.id} and (subject.contact_id is null or subject.contact_id in (${sql.join(args.exceptContactIds.map(id=>sql`${id}::uuid`),sql`,`)})))`:undefined)).orderBy(asc(mediaStorageTransferObjects.id)).limit(100);return minimizeTransferredObjects(tx,rows.map(row=>row.id));})});
