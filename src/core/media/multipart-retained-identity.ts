// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: historical first identity is not current physical authority.
import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod";
import type {Tx} from "@/core/service";
import type {TransferRequestDescriptor,TransferRequestObservation} from "../../../scripts/media-transfer.mjs";
import {originalMultipartRetirementProof} from "./multipart-retirement-certificate-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
export const retainedOriginalMultipartIdentity=z.object({
 format:z.literal("freeholder.original-multipart-first-identity/v1"),
 resource:originalMultipartRetirementProof.shape.resource.omit({retiredAtEpoch:true}),
 creation:originalMultipartRetirementProof.shape.creation,
 retirement:originalMultipartRetirementProof.shape.retirement.omit({readCallId:true,inventoryId:true}),
 operations:z.array(originalMultipartRetirementProof.shape.operations.element).length(2),
 callers:z.array(originalMultipartRetirementProof.shape.callers.element).length(2),
 requests:z.array(originalMultipartRetirementProof.shape.requests.element.omit({observationCount:true,factMembershipDigest:true})).length(2),
}).strict();
export type RetainedOriginalMultipartIdentity=z.infer<typeof retainedOriginalMultipartIdentity>;
export type RetainedOriginalMultipartIdentityRead={state:"absent"|"unavailable"|"conflicting"}|{state:"proven";identity:RetainedOriginalMultipartIdentity};
/** All present certificates must be intact and agree through actual original
 * FKs. No newest timestamp/current row or caller-supplied JSON supplies birth. */
export async function readRetainedOriginalMultipartIdentity(tx:Tx,resourceId:string):Promise<RetainedOriginalMultipartIdentityRead>{
 const[available]=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_multipart_first_identity(uuid)') is not null as present`);if(available?.present!==true)return{state:"unavailable"};
 const[row]=await tx.execute<{identity:unknown;present:boolean}>(sql`select freeholder_media_multipart_first_identity(${resourceId}::uuid) as identity,exists(select 1 from media_storage_transfer_reviews review join media_multipart_operations operation on operation.id=review.multipart_operation_id where operation.resource_id=${resourceId}::uuid and review.retirement_proof is not null) as present`);
 if(!row?.present)return{state:"absent"};const parsed=retainedOriginalMultipartIdentity.safeParse(row.identity);return parsed.success?{state:"proven",identity:parsed.data}:{state:"conflicting"};
}
/** Used before a fresh authorized recovery READ. A matching value is only an
 * ephemeral candidate; callers must not write it into canonical raw fields. */
export function requireRetainedMultipartCandidate(identity:RetainedOriginalMultipartIdentity,input:{namespace:string;key:string;uploadId:string;binding?:unknown}):void{
 if(input.namespace!==identity.resource.namespace||createHash("sha256").update("freeholder:media-object-key:v1\0").update(input.key).digest("hex")!==identity.resource.keyDigest||transferDigest(input.uploadId)!==identity.resource.uploadIdDigest||input.binding!==undefined&&transferDigest(input.binding)!==identity.resource.bindingDigest)transferConflict("Those storage details do not match the original upload. Keep its saved evidence for review.");
}
export function retainedMultipartSessionDecision(input:{identity:RetainedOriginalMultipartIdentity;callId:string;requestId:string;descriptor:TransferRequestDescriptor;descriptorDigest:string;tokenDigest:string;runtimeIdentity:unknown;fact:TransferRequestObservation;canonicalUploadId:string|null;observedUploadId:string|null}):"same"|"conflicting"{
 const{identity,fact}=input,request=identity.requests.find(row=>row.id===input.requestId&&row.callId===input.callId),caller=identity.callers.find(row=>row.id===input.callId);
 if(!request||!caller||request.descriptorDigest!==input.descriptorDigest||request.tokenDigest!==input.tokenDigest||request.runtimeDigest!==transferDigest(input.runtimeIdentity)||input.descriptor.binding.namespace!==identity.resource.namespace||!["multipart.create","multipart.abort"].includes(input.descriptor.kind)||!['accepted','session'].includes(fact.stage)||typeof fact.uploadId!=="string"||!fact.uploadId||fact.uploadId.length>4096||/[\u0000-\u001f]/.test(fact.uploadId)||fact.status===null||!Number.isInteger(fact.status)||fact.status<200||fact.status>=300)return"conflicting";
 if(input.descriptor.kind==="multipart.create"&&(request.id!==identity.creation.requestId||caller.id!==identity.creation.callerId)||input.descriptor.kind==="multipart.abort"&&(request.id!==identity.retirement.requestId||caller.id!==identity.retirement.callerId))return"conflicting";
 const key=input.descriptor.key;
 if(!key||key!==`retained:${identity.resource.keyDigest}`&&createHash("sha256").update("freeholder:media-object-key:v1\0").update(key).digest("hex")!==identity.resource.keyDigest||input.descriptor.uploadId!==undefined&&transferDigest(input.descriptor.uploadId)!==identity.resource.uploadIdDigest)return"conflicting";
 if(fact.revision&&(fact.revision.namespace!==identity.resource.namespace||createHash("sha256").update("freeholder:media-object-key:v1\0").update(fact.revision.key).digest("hex")!==identity.resource.keyDigest))return"conflicting";
 const expected=identity.resource.uploadIdDigest;
 return transferDigest(fact.uploadId)!==expected||input.canonicalUploadId!==null&&transferDigest(input.canonicalUploadId)!==expected||input.observedUploadId!==null&&transferDigest(input.observedUploadId)!==expected?"conflicting":"same";
}
