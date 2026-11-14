// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual whole pinned bytes must retain the ORIGINAL CREATE
// nonce. A same-key later object, HEAD/ETag or browser callback is insufficient.
import type {OriginalProviderRequestProof,TransferRequestDescriptor,TransferRevision} from "../../../scripts/media-transfer.mjs";
import {requireReviewedOriginalCreate,type KnownOriginalCreateReview} from "./multipart-known-create-proof";
import {checkedTransferRevision,transferConflict,transferDigest} from "./transfer-proof";
export interface OriginalMultipartCreateProof {
 id:string;callId?:string;review?:KnownOriginalCreateReview;tokenDigest:string;descriptor:TransferRequestDescriptor;descriptorDigest:string;
 returnedAt:Date|null;state:string;observedUploadId:string;
}
export interface ActualMultipartCompletedBody {
 key:string;namespace:string;revision:TransferRevision;sha256:string;bytes:number;
 requestProof?:OriginalProviderRequestProof;
}
export function requireOriginalMultipartCompletedBody(create:OriginalMultipartCreateProof,actual:ActualMultipartCompletedBody,expected:{uploadId:string;namespace:string;key:string;revision:TransferRevision;maxBytes:number}):TransferRevision {
 if(create.review)requireReviewedOriginalCreate(create.review,create);
 if((create.state!=="returned"||!create.returnedAt)&&!create.review||transferDigest(create.descriptor)!==create.descriptorDigest||create.descriptor.kind!=="multipart.create"||create.descriptor.key!==expected.key||create.descriptor.binding.namespace!==expected.namespace||create.observedUploadId!==expected.uploadId||!actual.requestProof||actual.requestProof.id!==create.id||actual.requestProof.tokenDigest!==create.tokenDigest||actual.key!==expected.key||actual.namespace!==expected.namespace||!(/^[a-f0-9]{64}$/.test(actual.sha256))||!Number.isSafeInteger(actual.bytes)||actual.bytes<0||!Number.isSafeInteger(expected.maxBytes)||expected.maxBytes<0||actual.bytes>expected.maxBytes||transferDigest(actual.revision)!==transferDigest(expected.revision))transferConflict("Keep the original completed upload for review. Its complete stored bytes must match the original upload session.");
 return checkedTransferRevision(actual.revision,create.descriptor.binding,expected.key);
}
