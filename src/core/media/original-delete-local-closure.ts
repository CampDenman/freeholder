// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// This proves only LOCAL closure for one immutable conditional removal. A
// remote response/ACK is never inferred. Retirement needs permanent creator
// fencing, all prior creator closure and fresh complete physical absence too.
import type {TransferRequestDescriptor} from "../../../scripts/media-transfer.mjs";
import type {StorageCallerRuntimeIdentity} from "./physical-caller-runtime";
import {requireOriginalExecutorStop,type OriginalExecutorStop} from "./original-caller-quiescence";
import {transferConflict,transferDigest} from "./transfer-proof";
export interface ConditionalDeleteClosure{
 id:string;runtimeId:string;runtimeIdentity:StorageCallerRuntimeIdentity;namespace:string;physicalKey:string;createdAt:Date;returnedAt:Date|null;writerFinishedAt:Date|null;expectedRevision:TransferRequestDescriptor["expectedRevision"]|null;
 requests:readonly{id:string;callId:string;descriptor:TransferRequestDescriptor;descriptorDigest:string;tokenDigest:string;runtimeIdentity:StorageCallerRuntimeIdentity;createdAt:Date;returnedAt:Date|null}[];
 executorStop:OriginalExecutorStop|null;
}
export function requireLocallyClosedConditionalDelete(input:ConditionalDeleteClosure){
 const request=input.requests[0],revision=input.expectedRevision;
 if(input.requests.length!==1||!request||!revision||revision.namespace!==input.namespace||revision.key!==input.physicalKey||!input.runtimeId||!input.runtimeIdentity||!("kind"in input.runtimeIdentity)||input.runtimeIdentity.instance!==input.runtimeId||request.callId!==input.id||request.descriptor.kind!=="object.delete"||request.descriptor.key!==input.physicalKey||request.descriptor.binding.namespace!==input.namespace||transferDigest(request.descriptor.expectedRevision)!==transferDigest(revision)||request.descriptorDigest!==transferDigest(request.descriptor)||transferDigest(request.runtimeIdentity)!==transferDigest(input.runtimeIdentity))transferConflict("Keep the one exact original conditional DELETE, namespace, revision and runtime; no retry or remote finish is inferred.");
 if(input.returnedAt&&Number.isFinite(input.returnedAt.getTime())&&input.writerFinishedAt&&Number.isFinite(input.writerFinishedAt.getTime())&&request.returnedAt&&Number.isFinite(request.returnedAt.getTime()))return{mode:"actual_local_finish"as const,stopDrainId:null,stopProofDigest:null};
 requireOriginalExecutorStop(input,input.requests,input.executorStop);
 if(request.createdAt>input.executorStop.createdAt)transferConflict("The original conditional DELETE must predate its independently captured executor fence.");
 return{mode:"independent_local_stop"as const,stopDrainId:input.executorStop.id,stopProofDigest:input.executorStop.stopProofDigest};
}
