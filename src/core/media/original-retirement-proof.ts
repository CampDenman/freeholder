// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// An empty current key is not an original caller finish or a version inventory.
import type {TransferInventoryConfiguration,TransferInventoryEntry,TransferRevision} from "../../../scripts/media-transfer.mjs";
import type {OriginalPhysicalRequest,ReturnedOriginalCaller} from "./original-request-recovery-proof";
import type {OriginalProviderWriteAdmission} from "./provider-request-proof";
import {requireFinishedOriginalPut} from "./original-request-recovery-proof";
import {originalResourceAbsent,providerInventoryDigest} from "./transfer-inventory-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
export interface OriginalAbsenceRead extends ReturnedOriginalCaller{
 kind:string;namespace:string;physicalKey:string;state:string;resultAbsent:Date|null;expectedRevision:TransferRevision|null;
}
export interface OriginalAbsenceRequest extends OriginalPhysicalRequest{
 state:string;
}
export function requireOriginalAbsenceRead(input:{key:string;namespace:string;revision:TransferRevision;absence:OriginalAbsenceRead;requests:readonly OriginalAbsenceRequest[];absenceRequestIds:readonly string[]}){
 const{absence,requests,revision}=input;
 if(absence.kind!=="ordinary_recovery_read"||absence.namespace!==input.namespace||absence.physicalKey!==input.key||absence.state!=="returned"||!absence.returnedAt||!absence.resultAbsent||!absence.expectedRevision||transferDigest(absence.expectedRevision)!==transferDigest(revision)||!requests.length)transferConflict("Retirement requires a fresh finished read pinned to the exact original provider revision.");
 if(requests.some(row=>row.callId!==absence.id||row.state!=="returned"||!row.returnedAt||transferDigest(row.runtimeIdentity)!==transferDigest(absence.runtimeIdentity)||row.descriptorDigest!==transferDigest(row.descriptor)||row.descriptor.binding.namespace!==input.namespace||row.descriptor.key!==input.key||!["object.metadata","object.read","object.body"].includes(row.descriptor.kind)||!row.descriptor.expectedRevision||transferDigest(row.descriptor.expectedRevision)!==transferDigest(revision))||!requests.some(row=>input.absenceRequestIds.includes(row.id)))transferConflict("All actual pinned absence subrequests and an authentic provider absence fact must finish; an assertion or current HEAD alone cannot retire bytes.");
}
export function requireOriginalPutRetirementProof(input:{caller:ReturnedOriginalCaller;requests:readonly OriginalPhysicalRequest[];key:string;namespace:string;revision:TransferRevision;absence:OriginalAbsenceRead;absenceRequests:readonly OriginalAbsenceRequest[];absenceRequestIds:readonly string[];first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}){
 const write=requireFinishedOriginalPut(input.caller,input.requests);
 return requireOriginalPhysicalAbsenceProof(write,input);
}
/** Internal lifecycle consumer supplies either the strict actual-finish write
 * above or the independently revalidated guarded affirmative applied review.
 * This checks fresh physical absence only; it never establishes quiescence. */
export function requireOriginalPhysicalAbsenceProof(write:OriginalProviderWriteAdmission,input:{key:string;namespace:string;revision:TransferRevision;absence:OriginalAbsenceRead;absenceRequests:readonly OriginalAbsenceRequest[];absenceRequestIds:readonly string[];first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}){
 if(write.descriptor.key!==input.key||write.descriptor.binding.namespace!==input.namespace||input.revision.key!==input.key||input.revision.namespace!==input.namespace)transferConflict("Retirement cannot adopt another original key, namespace or generation.");
 requireOriginalAbsenceRead({...input,requests:input.absenceRequests});
 if(providerInventoryDigest(input.first.configuration,input.first.entries)!==providerInventoryDigest(input.confirmed.configuration,input.confirmed.entries))transferConflict("Both complete retirement version/session inventories must agree.");
 if(!originalResourceAbsent(input.first.entries,input.key))transferConflict("Original physical versions, retained bytes, delete markers or sessions remain; current logical absence cannot complete retirement.");
 return input.revision;
}
