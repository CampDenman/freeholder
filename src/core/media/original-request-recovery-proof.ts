// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// No current observation supplies an earlier caller's missing finish or birth.
import type {TransferInventoryConfiguration,TransferInventoryEntry} from "../../../scripts/media-transfer.mjs";
import type {StorageCallerRuntimeIdentity} from "./physical-caller-runtime";
import type {ActualOriginalProviderObject,OriginalProviderWriteAdmission} from "./provider-request-proof";
import {requireOriginalProviderRequestResult} from "./provider-request-proof";
import {classifySourceInventory,providerInventoryDigest} from "./transfer-inventory-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
export interface ReturnedOriginalCaller{
 id:string;runtimeIdentity:StorageCallerRuntimeIdentity;returnedAt:Date|null;
}
export interface OriginalPhysicalRequest extends OriginalProviderWriteAdmission{
 callId:string;runtimeIdentity:StorageCallerRuntimeIdentity;returnedAt:Date|null;
}
/** This first portable path requires retained actual finishes for every
 * original admission. Crash/stop review must provide its own independently
 * validated exact executor evidence; it cannot call this path with a timeout.
 */
export function requireFinishedOriginalPut(caller:ReturnedOriginalCaller,requests:readonly OriginalPhysicalRequest[]):OriginalPhysicalRequest{
 if(!caller.returnedAt||!Number.isFinite(caller.returnedAt.getTime())||!requests.length||requests.some(row=>row.callId!==caller.id||!row.returnedAt||!Number.isFinite(row.returnedAt.getTime())||transferDigest(row.runtimeIdentity)!==transferDigest(caller.runtimeIdentity)||row.descriptorDigest!==transferDigest(row.descriptor)))transferConflict("Every actual original caller and physical request must have its own retained finish. Empty inventory,404,elapsed time or a written assertion cannot stop them.");
 const writes=requests.filter(row=>row.descriptor.kind==="object.put");
 if(writes.length!==1||requests.some(row=>["object.delete","multipart.create","multipart.complete","multipart.abort"].includes(row.descriptor.kind)))transferConflict("The exact original ordinary write must have one immutable mutating request; unknown retries or other writers remain debt.");
 return writes[0]!;
}
export function requireOriginalPutRecoveryProof(input:{caller:ReturnedOriginalCaller;requests:readonly OriginalPhysicalRequest[];actual:ActualOriginalProviderObject;first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}){
 const original=requireFinishedOriginalPut(input.caller,input.requests),revision=requireOriginalProviderRequestResult(original,input.actual);
 if(providerInventoryDigest(input.first.configuration,input.first.entries)!==providerInventoryDigest(input.confirmed.configuration,input.confirmed.entries))transferConflict("Both complete original provider inventories must agree before recovering this original result.");
 // Foreign keys elsewhere in the namespace remain foreign. At this exact key,
 // retained versions/session debris cannot be silently attached or discarded.
 const entries=input.first.entries.filter(entry=>entry.key===input.actual.key);
 const classified=classifySourceInventory(input.first.configuration,entries,[{id:input.caller.id,key:input.actual.key,bytes:input.actual.bytes,originalRevision:revision}],input.actual.namespace);
 if(!classified.complete)transferConflict("The original key still has unknown retained versions, soft-deleted bytes, sessions or conflicting provenance. Keep the original request pending.");
 return revision;
}
