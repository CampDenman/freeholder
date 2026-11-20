// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Only a genuinely retained first original ACK owns its provider UploadId.
// A singleton key/session listing never supplies an unknown original birth.
import type {TransferInventoryConfiguration,TransferInventoryEntry,TransferRequestObservation} from "../../../scripts/media-transfer.mjs";
import {nextMultipartBaselinePage,type MultipartCreateBaseline} from "./multipart-create-baseline-proof";
import type {OriginalQuiescentCaller,OriginalQuiescentRequest,OriginalExecutorStop} from "./original-caller-quiescence";
import {requireOriginalExecutorStop} from "./original-caller-quiescence";
import {providerInventoryDigest} from "./transfer-inventory-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
export function requireKnownOriginalMultipartCreate(input:{caller:OriginalQuiescentCaller;requests:readonly OriginalQuiescentRequest[];namespace:string;key:string;keyDigest:string;uploadId:string;writerFinishedAt:Date|null;baseline:MultipartCreateBaseline;facts:readonly{requestId:string;facts:TransferRequestObservation}[];stop:OriginalExecutorStop|null}){
 const{caller,requests,baseline}=input;
 if(!input.uploadId||baseline.format!=="original-multipart-create-baseline/v1"||baseline.state!=="complete"||nextMultipartBaselinePage(baseline)!==null||baseline.pages.length<8||new Set(baseline.pages.map(page=>page.requestId)).size!==baseline.pages.length||baseline.callId!==caller.id||baseline.namespace!==input.namespace||baseline.keyDigest!==input.keyDigest||caller.namespace!==input.namespace||!Number.isFinite(caller.createdAt.getTime())||!requests.length||requests.some(row=>!Number.isFinite(row.createdAt.getTime())||row.callId!==caller.id||transferDigest(row.runtimeIdentity)!==transferDigest(caller.runtimeIdentity)||row.descriptorDigest!==transferDigest(row.descriptor)||row.descriptor.binding.namespace!==input.namespace||row.descriptor.key!==undefined&&row.descriptor.key!==input.key||!["bucket.metadata","inventory.objects","inventory.versions","inventory.sessions","multipart.create"].includes(row.descriptor.kind)))transferConflict("Keep the original CREATE pending. Its original baseline, caller and actual first session receipt are required.");
 const creates=requests.filter(row=>row.descriptor.kind==="multipart.create"),create=creates[0];
 if(creates.length!==1||!create||create.descriptor.key!==input.key||create.descriptor.checksumAlgorithm!=="SHA256"||create.descriptor.checksumType!=="COMPOSITE")transferConflict("Known-session recovery requires exactly one original checksum-enabled CREATE, never a new call or current-key attribution.");
 const positive=input.facts.filter(row=>row.requestId===create.id&&["accepted","session"].includes(row.facts.stage));
 if(!input.facts.some(row=>row.requestId===create.id&&row.facts.stage==="response_body"&&/^[a-f0-9]{64}$/.test(row.facts.detailDigest??""))||!positive.some(row=>row.facts.stage==="accepted"&&row.facts.uploadId===input.uploadId)||!positive.some(row=>row.facts.stage==="session"&&row.facts.uploadId===input.uploadId)||positive.some(row=>row.facts.uploadId!==input.uploadId))transferConflict("A current provider session cannot replace the exact genuinely retained first original CREATE acknowledgement.");
 if(baseline.pages.length!==requests.length-1||baseline.pages.some(page=>{const request=requests.find(row=>row.id===page.requestId);return!request||!request.returnedAt||request.returnedAt>create.createdAt||request.descriptor.kind!==(page.kind==="configuration"?"bucket.metadata":`inventory.${page.kind}`)||transferDigest(request.descriptor.cursor??null)!==page.cursorDigest;}))transferConflict("Both complete first baseline passes must physically finish before the original CREATE.");
 if(caller.returnedAt&&input.writerFinishedAt&&caller.returnedAt.getTime()===input.writerFinishedAt.getTime()&&requests.every(row=>row.returnedAt&&row.returnedAt<=caller.returnedAt!))return{create,mode:"actual_finish"as const,stop:null};
 requireOriginalExecutorStop(caller,requests,input.stop);if(create.createdAt>input.stop.createdAt)transferConflict("A later CREATE cannot borrow an earlier stopped original executor.");
 return{create,mode:"independent_stop"as const,stop:input.stop};
}
export function requireKnownOriginalEmptySession(input:{key:string;uploadId:string;first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}){
 if(providerInventoryDigest(input.first.configuration,input.first.entries)!==providerInventoryDigest(input.confirmed.configuration,input.confirmed.entries))transferConflict("Both complete original session inventories must agree before known CREATE review.");
 const original=input.first.entries.filter(row=>row.key===input.key);
 if(original.length!==1||original[0]?.kind!=="session"||original[0].sessionId!==input.uploadId)transferConflict("Only the exact originally acknowledged empty session may be recovered; object/version/foreign-session bytes remain debt.");
}

/** Immutable server-held review evidence, never a public boolean or a
 * replacement view that turns missing original returns into present ones. */
export interface KnownOriginalCreateReview {
 record:{id:string;multipartOperationId:string|null;callId:string;readCallId:string;inventoryId:string|null;outcome:string;permitsRetry:boolean;providerEvidenceDigest:string;stopDrainId:string|null};
 original:Parameters<typeof requireKnownOriginalMultipartCreate>[0]&{caller:OriginalQuiescentCaller&{stopReceiptId?:string|null}};
 operationId:string;sourceEvidenceDigest:string|null;
 inspection:{id:string;multipartOperationId:string|null;kind:string;state:string;returnedAt:Date|null;resultDigest:string|null};
 inventory:{id:string;multipartOperationId:string|null;anchorCallId:string|null;proofCallId:string|null;state:string;firstDigest:string|null;confirmedDigest:string|null;completedAt:Date|null};
 first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};
}
export function requireReviewedOriginalCreate(review:KnownOriginalCreateReview,physical:{id:string;callId?:string;state:string;returnedAt:Date|null;descriptorDigest:string;observedUploadId:string}){
 const closure=requireKnownOriginalMultipartCreate(review.original),record=review.record;
 if(!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id))||review.original.caller.stopReceiptId!==record.id||record.multipartOperationId!==review.operationId||record.callId!==review.original.caller.id||record.callId!==physical.callId||closure.create.id!==physical.id||closure.create.descriptorDigest!==physical.descriptorDigest||closure.create.returnedAt?.getTime()!==physical.returnedAt?.getTime()||review.original.uploadId!==physical.observedUploadId||!["returned","failed","stopped"].includes(physical.state)||record.outcome!=="applied"||record.permitsRetry||!(/^[a-f0-9]{64}$/.test(record.providerEvidenceDigest))||record.providerEvidenceDigest!==review.sourceEvidenceDigest||record.stopDrainId!==(closure.stop?.id??null)||record.readCallId!==review.inspection.id||review.inspection.multipartOperationId!==review.operationId||review.inspection.kind!=="multipart_recovery_inspect"||review.inspection.state!=="returned"||!review.inspection.returnedAt||review.inspection.resultDigest!==transferDigest({inspectionDigest:transferDigest({state:"open",parts:[]})})||record.inventoryId!==review.inventory.id||review.inventory.multipartOperationId!==review.operationId||review.inventory.anchorCallId!==record.callId||review.inventory.proofCallId!==record.readCallId||review.inventory.state!=="complete"||!review.inventory.completedAt||review.inventory.firstDigest!==providerInventoryDigest(review.first.configuration,review.first.entries)||review.inventory.confirmedDigest!==providerInventoryDigest(review.confirmed.configuration,review.confirmed.entries))transferConflict("Retain the exact immutable original known-CREATE review; no missing return, other caller or current session may substitute.");
 requireKnownOriginalEmptySession({key:review.original.key,uploadId:review.original.uploadId,first:review.first,confirmed:review.confirmed});
}
