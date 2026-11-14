// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: this proves only genuinely idle, never-exposed session removal.
import type {TransferInventoryConfiguration,TransferInventoryEntry,TransferRequestObservation} from "../../../scripts/media-transfer.mjs";
import type {OriginalQuiescentCaller,OriginalQuiescentRequest} from "./original-caller-quiescence";
import {providerInventoryDigest} from "./transfer-inventory-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
export function requireIdleOriginalAbortReturn(input:{caller:OriginalQuiescentCaller;requests:readonly OriginalQuiescentRequest[];facts:readonly{requestId:string;facts:TransferRequestObservation}[];namespace:string;key:string;uploadId:string;writerFinishedAt:Date|null;providerAcceptedAt:Date|null}){
 const{caller,requests}=input,request=requests[0];
 if(!caller.returnedAt||!input.writerFinishedAt||caller.returnedAt.getTime()!==input.writerFinishedAt.getTime()||!input.providerAcceptedAt||caller.namespace!==input.namespace||requests.length!==1||!request||request.callId!==caller.id||request.descriptorDigest!==transferDigest(request.descriptor)||transferDigest(request.runtimeIdentity)!==transferDigest(caller.runtimeIdentity)||request.descriptor.kind!=="multipart.abort"||request.descriptor.binding.namespace!==input.namespace||request.descriptor.key!==input.key||request.descriptor.uploadId!==input.uploadId||!request.returnedAt||request.returnedAt>caller.returnedAt||!input.facts.some(row=>row.requestId===request.id&&row.facts.stage==="accepted"&&row.facts.status!==null&&row.facts.status>=200&&row.facts.status<300&&row.facts.uploadId===input.uploadId))transferConflict("Retire only the exact genuinely acknowledged idle original session after its real ABORT caller and physical finish. Unknown/failed ABORT remains recovery debt.");
 return request;
}
export function requireIdleOriginalMultipartAbsence(input:{key:string;first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}):void{
 if(providerInventoryDigest(input.first.configuration,input.first.entries)!==providerInventoryDigest(input.confirmed.configuration,input.confirmed.entries)||input.first.entries.some(row=>row.key===input.key)||input.confirmed.entries.some(row=>row.key===input.key))transferConflict("Retained objects, versions, soft-deleted bytes or sessions preserve the original idle upload. Complete agreeing provider inventories must prove every original physical resource absent.");
}
