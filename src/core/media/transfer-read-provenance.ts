// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Equal bytes/ETag are insufficient: the actual provider read must retain the
// nonce of its exact original create-only physical admission and lineage.
import {eq,sql} from "drizzle-orm";
import type {OriginalProviderRequestProof} from "../../../scripts/media-transfer.mjs";
import type {StorageBinding} from "@/adapters/storage/types";
import type {Tx} from "@/core/service";
import type {OriginalPhysicalRequest,ReturnedOriginalCaller} from "./original-request-recovery-proof";
import {requireFinishedOriginalPut} from "./original-request-recovery-proof";
import {requireOriginalProviderRequestResult} from "./provider-request-proof";
import {requireFinishedTransferRead,transferConflict,type TransferCallerProof} from "./transfer-proof";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {mediaStorageTransferRequests as requests} from "./transfer-request-schema";
export function requireExactTransferReadNonce(input:{writer:ReturnedOriginalCaller;requests:readonly OriginalPhysicalRequest[];read:TransferCallerProof&{resultRequestProof?:OriginalProviderRequestProof|null};binding:StorageBinding;key:string;expected:{sha256:string;bytes:number}}){
 const write=requireFinishedOriginalPut(input.writer,input.requests),revision=requireFinishedTransferRead(input.read,input.binding,input.key,input.expected);
 requireOriginalProviderRequestResult(write,{key:input.key,namespace:input.binding.namespace,revision,sha256:input.expected.sha256,bytes:input.expected.bytes,requestProof:input.read.resultRequestProof??undefined});
 return revision;
}
/** Internal shared-service assertion. SQL independently proves actual metadata
 * and body observations, immutable first membership and the physical finishes. */
export async function assertExactTransferRead(tx:Tx,read:typeof calls.$inferSelect,binding:StorageBinding,key:string,expected:{sha256:string;bytes:number}){
 const[authority]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_transfer_exact_read_nonce(${read.id}::uuid) as proven`);
 if(authority?.proven!==true||!read.resultRequestProof)transferConflict("The actual provider read does not prove the exact original physical admission. Preserve its first receipts for recovery.");
 const[request]=await tx.select().from(requests).where(eq(requests.id,read.resultRequestProof.id)).limit(1);if(!request)transferConflict();
 const[writer]=await tx.select().from(calls).where(eq(calls.id,request.callId)).limit(1);if(!writer)transferConflict();
 return requireExactTransferReadNonce({writer,requests:await tx.select().from(requests).where(eq(requests.callId,writer.id)),read,binding,key,expected});
}
