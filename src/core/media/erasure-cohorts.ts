// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C1.08: late physical facts reopen their original erasure, not a new owner.
import {originalMediaScope,originalMediaDescendant,originalMediaScopePending} from "./original-erasure-scope";
import {originalProviderEvidencePending,originalProviderEvidenceVersion} from "./original-provider-privacy";
import {and,asc,eq,inArray,or,isNotNull,isNull,gt} from "drizzle-orm";
import {db} from "@/core/db";
import {dataRequests} from "@/core/privacy/schema";
import {getService,type Tx} from "@/core/service";
import {mediaErasureCohorts} from "./erasure-schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {allowMediaReceiptWrites} from "./write-ledger";
export async function captureMediaErasureCohort(tx:Tx,requestId:string,scope:"media.storageOperations"|"media.multipartOperations",ids:string[],resourceIds:string[]=[]):Promise<void>{
 await allowMediaReceiptWrites(tx);
 const first=await originalMediaScope(tx,requestId,scope);
 for(const receiptId of ids)if(!await originalMediaDescendant(tx,first.membership,{receiptId}))throw new Error("A current generation cannot expand the immutable original media erasure capture.");
 for(const resourceId of resourceIds)if(!await originalMediaDescendant(tx,first.membership,{resourceId}))throw new Error("A new multipart session cannot expand the immutable original media erasure capture.");
 if(ids.length)await tx.insert(mediaErasureCohorts).values(ids.map(objectReceiptId=>({requestId,scope,objectReceiptId}))).onConflictDoNothing();
 if(resourceIds.length)await tx.insert(mediaErasureCohorts).values(resourceIds.map(multipartResourceId=>({requestId,scope,multipartResourceId}))).onConflictDoNothing();
}
/** Witness transactions have already committed; a failed reopen cannot erase facts. */
let periodicCursor:string|undefined;
export async function reconcileMediaErasureCohorts(target?:{objectReceiptId?:string;multipartResourceId?:string;multipartOperationId?:string}):Promise<void>{
 let resourceId=target?.multipartResourceId;
 if(target?.multipartOperationId)resourceId=(await db().select({id:mediaMultipartOperations.resourceId}).from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,target.multipartOperationId)).limit(1))[0]?.id;
 const selection=target?or(target.objectReceiptId?eq(mediaErasureCohorts.objectReceiptId,target.objectReceiptId):undefined,resourceId?eq(mediaErasureCohorts.multipartResourceId,resourceId):undefined):periodicCursor?gt(mediaErasureCohorts.id,periodicCursor):undefined;
 if(target&&!selection)return;
 const cohorts=(await db().select({cohort:mediaErasureCohorts}).from(mediaErasureCohorts)
  .leftJoin(mediaObjectWrites,eq(mediaObjectWrites.id,mediaErasureCohorts.objectReceiptId))
  .leftJoin(mediaMultipartResources,eq(mediaMultipartResources.id,mediaErasureCohorts.multipartResourceId))
  .innerJoin(dataRequests,eq(dataRequests.id,mediaErasureCohorts.requestId))
  .where(and(selection,or(and(isNotNull(mediaObjectWrites.redactedAt),eq(mediaObjectWrites.state,"unknown")),and(isNotNull(mediaMultipartResources.redactedAt),eq(mediaMultipartResources.state,"unknown")),and(inArray(dataRequests.status,["completed","partially_completed"]),or(and(isNotNull(mediaObjectWrites.id),isNull(mediaObjectWrites.redactedAt)),and(isNotNull(mediaMultipartResources.id),isNull(mediaMultipartResources.redactedAt)))))))
  .orderBy(asc(mediaErasureCohorts.id)).limit(500)).map(row=>row.cohort);
 const groups=new Map<string,typeof cohorts>();
 for(const row of cohorts){const key=`${row.requestId}:${row.scope}`,group=groups.get(key)??[];group.push(row);groups.set(key,group);}
 for(const rows of groups.values()){
  const ids=rows.flatMap(row=>row.objectReceiptId?[row.objectReceiptId]:[]),resourceIds=rows.flatMap(row=>row.multipartResourceId?[row.multipartResourceId]:[]);
  const writes=ids.length?await db().select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,ids)):[];
  const related=await db().select({resource:mediaMultipartResources}).from(mediaErasureCohorts).innerJoin(mediaMultipartResources,eq(mediaMultipartResources.id,mediaErasureCohorts.multipartResourceId)).where(and(eq(mediaErasureCohorts.requestId,rows[0]!.requestId),eq(mediaErasureCohorts.scope,rows[0]!.scope),or(resourceIds.length?inArray(mediaMultipartResources.id,resourceIds):undefined,writes.length?inArray(mediaMultipartResources.keyDigest,writes.map(row=>row.keyDigest)):undefined))).limit(500);
  const resources=related.map(row=>row.resource);resourceIds.push(...resources.filter(row=>!resourceIds.includes(row.id)).map(row=>row.id));
  const operations=resourceIds.length?await db().select({id:mediaMultipartOperations.id,resourceId:mediaMultipartOperations.resourceId,createdAt:mediaMultipartOperations.createdAt,providerAcceptedAt:mediaMultipartOperations.providerAcceptedAt}).from(mediaMultipartOperations).where(inArray(mediaMultipartOperations.resourceId,resourceIds)):[];
  const helper=getService("privacy.reopenErasureJob");if(!helper)throw new Error("The original erasure repair service is unavailable.");
  // A source-evidence version changes only with a new observation, never a
  // worker's clock. Chunked cohorts keep the original bounded job contracts.
  const originalOperations=operations.filter(operation=>{const resource=resources.find(row=>row.id===operation.resourceId);return !resource?.redactedAt||operation.createdAt<=resource.redactedAt;});
  const version=[...writes.map(row=>`${row.id}:${row.observedAcceptedAt?.toISOString()??""}`),...originalOperations.map(row=>`${row.id}:${row.providerAcceptedAt?.toISOString()??""}`)].sort().join("|");
  const {createHash}=await import("node:crypto");const providerVersion=await db().transaction(tx=>originalProviderEvidenceVersion(tx,{receiptIds:ids,resourceIds}));const hash=createHash("sha256").update(version);if(providerVersion)hash.update(providerVersion);const evidence=hash.digest("hex");
  const sample=rows[0]!;
  const total=Math.max(ids.length,resourceIds.length);
  for(let offset=0;offset<total;offset+=500){
   const selectedResources=resources.filter(row=>resourceIds.slice(offset,offset+500).includes(row.id));
   const jobData=sample.scope==="media.storageOperations"?{ids:ids.slice(offset,offset+500)}:{resourceIds:resourceIds.slice(offset,offset+500),uploadIds:selectedResources.map(row=>row.uploadId),keyDigests:[...new Set([...selectedResources.map(row=>row.keyDigest),...writes.slice(offset,offset+500).map(row=>row.keyDigest)])]};
   await helper.call({requestId:sample.requestId,scope:sample.scope,jobName:sample.scope==="media.storageOperations"?"core.eraseMediaStorageOperations":"core.eraseMediaMultipartOperations",jobData,idempotencyKey:`media-late:${evidence}:${offset}`},{kind:"system"});
  }
 }
 // The cursor is only a fairness hint; all authority and unfinished facts
 // remain in SQL, so a restart merely revisits a safe idempotent batch.
 if(!target)periodicCursor=cohorts.length===500?cohorts.at(-1)!.id:undefined;
}
export async function originalMediaErasureRequests(tx:Tx,ids:string[],resourceIds:string[]=[]){
 if(!ids.length&&!resourceIds.length)return[];
 return tx.select().from(mediaErasureCohorts).where(or(ids.length?inArray(mediaErasureCohorts.objectReceiptId,ids):undefined,resourceIds.length?inArray(mediaErasureCohorts.multipartResourceId,resourceIds):undefined));
}
export async function objectCohortIds(tx:Tx,requestId:string,scope:string){return(await tx.select({id:mediaErasureCohorts.objectReceiptId}).from(mediaErasureCohorts).where(and(eq(mediaErasureCohorts.requestId,requestId),eq(mediaErasureCohorts.scope,scope)))).flatMap(row=>row.id?[row.id]:[]);}
export async function mediaCohortPending(tx:Tx,requestId:string,scope:string):Promise<boolean>{
 if(scope!=="media.storageOperations"&&scope!=="media.multipartOperations")throw new Error("Unknown original media scope.");
 const[request]=await tx.select().from(dataRequests).where(eq(dataRequests.id,requestId)).limit(1);if(!request)throw new Error("Original media erasure request missing.");
 if(await originalMediaScopePending(tx,requestId,scope,request.contactId))return true;
 const pending=await tx.select({id:mediaErasureCohorts.id}).from(mediaErasureCohorts)
  .leftJoin(mediaObjectWrites,eq(mediaObjectWrites.id,mediaErasureCohorts.objectReceiptId))
  .leftJoin(mediaMultipartResources,eq(mediaMultipartResources.id,mediaErasureCohorts.multipartResourceId))
  .where(and(eq(mediaErasureCohorts.requestId,requestId),eq(mediaErasureCohorts.scope,scope),or(and(isNotNull(mediaObjectWrites.id),or(isNull(mediaObjectWrites.redactedAt),inArray(mediaObjectWrites.state,["unverified","started","unknown"]))),and(isNotNull(mediaMultipartResources.id),or(isNull(mediaMultipartResources.redactedAt),isNull(mediaMultipartResources.retiredAt),inArray(mediaMultipartResources.state,["unverified","creating","open","completing","aborting","unknown"])))))).limit(1);
 if(pending.length)return true;
 const original=await tx.select().from(mediaErasureCohorts).where(and(eq(mediaErasureCohorts.requestId,requestId),eq(mediaErasureCohorts.scope,scope)));
 return originalProviderEvidencePending(tx,{receiptIds:original.flatMap(row=>row.objectReceiptId?[row.objectReceiptId]:[]),resourceIds:original.flatMap(row=>row.multipartResourceId?[row.multipartResourceId]:[])});
}
