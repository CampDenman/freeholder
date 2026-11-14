// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual pre-dispatch reads use the NEW CREATE's original server-held scope.
// No provider call is inside a transaction and an old caller is never resumed.
import {and,eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {mediaStorageTransferCalls} from "./transfer-schema";
import {mediaStorageTransferRequests,mediaStorageTransferRequestObservations} from "./transfer-request-schema";
import {originalMultipartCaller} from "./provider-callers";
import {configuredOriginalRequestStore} from "./transfer-storage";
import {withTransferRequestScope} from "./transfer-requests";
import {lockObjectDigest} from "./write-ledger";
import {lockTransferInventory} from "./transfer-authority";
import {assertOriginalNamespaceMutation} from "./original-namespace-fence";
import {transferConflict,transferDigest} from "./transfer-proof";
import type {StorageBinding} from "@/adapters/storage/types";
import {appendMultipartCreateBaseline,finishMultipartCreateBaseline,multipartBaselineResultDigest,nextMultipartBaselinePage,type MultipartCreateBaselinePage} from "./multipart-create-baseline-proof";

export async function captureMultipartCreateBaseline(operationId:string,binding:StorageBinding):Promise<void>{
 const caller=originalMultipartCaller(operationId),store=await configuredOriginalRequestStore(binding);
 await withTransferRequestScope({callId:caller.id,token:caller.token,runtimeIdentity:caller.runtimeIdentity},async()=>{
  let cursor:Record<string,string>|null=null;
  for(let bounded=0;bounded<=8000;bounded++){
   const[operation]=await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,operationId)).limit(1);
   if(!operation?.createBaseline||operation.kind!=="create"||operation.createBaseline.callId!==caller.id)transferConflict("This original CREATE has no immutable first baseline; retain its legacy recovery debt.");
   const baseline=operation.createBaseline,next=nextMultipartBaselinePage(baseline);
   if(baseline.state!=="capturing")transferConflict("The original baseline cannot be replayed or replaced by a current scan.");
   if(!next){
    await db().transaction(async tx=>{
     await lockTransferInventory(tx);await lockObjectDigest(tx,baseline.keyDigest);
     const[current]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,operationId)).limit(1).for("update");
     if(!current?.createBaseline||transferDigest(current.createBaseline)!==transferDigest(baseline))transferConflict();
     await tx.update(mediaMultipartOperations).set({createBaseline:finishMultipartCreateBaseline(baseline),updatedAt:new Date()}).where(eq(mediaMultipartOperations.id,operationId));
    });return;
   }
   if(next.cursorDigest!==transferDigest(cursor))transferConflict("An earlier partial scan cannot be resumed from a reconstructed current cursor.");
   // The configured account is resolved above, never from a public host/key.
   const result=next.kind==="configuration"?await store.inventoryConfiguration():await store.inventoryPage(next.kind,cursor),digest=multipartBaselineResultDigest(result);
   await db().transaction(async tx=>{
    await lockTransferInventory(tx);await lockObjectDigest(tx,baseline.keyDigest);
    const[current]=await tx.select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id,operationId)).limit(1).for("update");
    const[resource]=current?await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.id,current.resourceId)).limit(1).for("update"):[];
    const[actual]=await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id,caller.id)).limit(1).for("update");
    if(!current?.createBaseline||transferDigest(current.createBaseline)!==transferDigest(baseline)||!resource||resource.namespace!==binding.namespace||resource.keyDigest!==baseline.keyDigest||!actual||actual.state!=="admitted"||actual.multipartOperationId!==operationId||actual.callerTokenDigest!==transferDigest(caller.token))transferConflict();
    await assertOriginalNamespaceMutation(tx,binding.namespace);
    const physical=await tx.select({request:mediaStorageTransferRequests,fact:mediaStorageTransferRequestObservations}).from(mediaStorageTransferRequests).innerJoin(mediaStorageTransferRequestObservations,eq(mediaStorageTransferRequestObservations.requestId,mediaStorageTransferRequests.id)).where(and(eq(mediaStorageTransferRequests.callId,caller.id),eq(mediaStorageTransferRequests.state,"returned")));
    const matches=physical.filter(({request,fact})=>request.descriptor.kind===(next.kind==="configuration"?"bucket.metadata":`inventory.${next.kind}`)&&transferDigest(request.descriptor.cursor??null)===next.cursorDigest&&request.descriptor.binding.namespace===binding.namespace&&fact.facts.stage===(next.kind==="configuration"?"configuration":"inventory")&&fact.facts.detailDigest===digest&&!baseline.pages.some(page=>page.requestId===request.id));
    if(matches.length!==1||!physical.some(({request,fact})=>request.id===matches[0]?.request.id&&fact.facts.stage==="inventory_raw"&&fact.facts.detailDigest))transferConflict("The complete actual original provider page and its physical finish must be retained before baseline application.");
    const page:MultipartCreateBaselinePage={...next,requestId:matches[0]!.request.id,resultDigest:digest,count:"entries"in result?result.entries.length:0,nextCursorDigest:"entries"in result&&result.next?transferDigest(result.next):null,...("versioning"in result?{configuration:result}:{})};
    // The SQL guard independently hashes the exact parsed provider result,
    // matches its actual finished request observation, and checks that none
    // of its entries names this key. Only result/cursor digests and count are persisted;
    // unrelated private provider keys are not copied into this subject's row.
    await tx.execute(sql`select set_config('freeholder.media_multipart_baseline_result_v1',${JSON.stringify(result)},true)`);
    await tx.update(mediaMultipartOperations).set({createBaseline:appendMultipartCreateBaseline(baseline,page,resource.key,result),updatedAt:new Date()}).where(eq(mediaMultipartOperations.id,operationId));
   });
   cursor="entries"in result?result.next:null;
  }
  transferConflict("The complete original multipart baseline exceeds its bounded inventory; retain it for recovery.");
 });
}
