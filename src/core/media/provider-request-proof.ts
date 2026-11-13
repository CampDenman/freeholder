// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: a new request's original provider tag can prove its result;
// equal current key/hash alone cannot replace missing original admission.
import type { OriginalProviderRequestProof, TransferRequestDescriptor, TransferRevision } from "../../../scripts/media-transfer.mjs";
import { checkedTransferRevision, transferConflict, transferDigest } from "./transfer-proof";
export interface OriginalProviderWriteAdmission {
 id:string;tokenDigest:string;descriptor:TransferRequestDescriptor;descriptorDigest:string;
}
export interface ActualOriginalProviderObject {
 key:string;namespace:string;sha256:string;bytes:number;revision:TransferRevision;requestProof?:OriginalProviderRequestProof;
}
export function requireOriginalProviderRequestResult(original:OriginalProviderWriteAdmission,actual:ActualOriginalProviderObject):TransferRevision{
 if(transferDigest(original.descriptor)!==original.descriptorDigest)transferConflict("Restore the intact original physical request descriptor.");
 const descriptor=original.descriptor;
 if(descriptor.kind!=="object.put"||!descriptor.createOnly||!descriptor.key||!descriptor.sha256||descriptor.bytes===undefined||!actual.requestProof||actual.requestProof.id!==original.id||actual.requestProof.tokenDigest!==original.tokenDigest||actual.namespace!==descriptor.binding.namespace||actual.key!==descriptor.key||actual.sha256!==descriptor.sha256||actual.bytes!==descriptor.bytes)transferConflict("The actual provider object does not prove this exact original admitted write. Keep it pending without rebinding a current generation.");
 return checkedTransferRevision(actual.revision,descriptor.binding,descriptor.key);
}
