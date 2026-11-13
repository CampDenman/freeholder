// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: authority is exact physical lineage, never a current executor.
import { createHash } from "node:crypto";
import { ServiceError } from "@/core/service";
import type { StorageBinding } from "@/adapters/storage/types";
import type { StorageTransferRevision } from "./transfer-schema";

export function transferDigest(value:unknown):string {
 const canonical=(item:unknown):string=>{
  if(item instanceof Date)return JSON.stringify(item.toISOString());
  if(Array.isArray(item))return `[${item.map(canonical).join(",")}]`;
  if(item!==null&&typeof item==="object")return `{${Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>`${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
  return JSON.stringify(item)??"null";
 };
 return createHash("sha256").update("freeholder:verified-storage-transfer:v1\0").update(canonical(value)).digest("hex");
}
export function transferConflict(message="The original storage transfer needs recovery before another physical operation."):never {throw new ServiceError("conflict",message);}
export function checkedTransferRevision(revision:StorageTransferRevision|undefined|null,binding:StorageBinding,key:string):StorageTransferRevision {
 if(!revision||revision.namespace!==binding.namespace||revision.key!==key||
  (binding.kind==="s3"?revision.kind!=="etag"||!/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(revision.value):binding.kind!=="replit"||revision.kind!=="generation"||!/^[1-9][0-9]{0,19}$/.test(revision.value)))transferConflict("The provider revision does not identify the exact original resource and key.");
 return revision;
}
export function verifiedTransferBytes(body:Uint8Array,expected:{sha256:string;bytes:number}):void {
 if(!/^[a-f0-9]{64}$/.test(expected.sha256)||!Number.isSafeInteger(expected.bytes)||expected.bytes<0||body.byteLength!==expected.bytes||createHash("sha256").update(body).digest("hex")!==expected.sha256)transferConflict("The complete original object bytes do not match their immutable receipt.");
}
export interface TransferCallerProof {id:string;state:string;kind:string;namespace:string;physicalKey:string;returnedAt:Date|null;observedAcceptedAt:Date|null;resultRevision:StorageTransferRevision|null;resultSha256:string|null;resultBytes:number|null;resultAbsent:Date|null}
export function requireFinishedTransferRead(call:TransferCallerProof|undefined,binding:StorageBinding,key:string,expected:{sha256:string;bytes:number}):StorageTransferRevision {
 if(!call||call.state!=="returned"||!call.returnedAt||call.namespace!==binding.namespace||call.physicalKey!==key||call.resultAbsent||call.resultSha256!==expected.sha256||call.resultBytes!==expected.bytes)transferConflict("A fresh finished exact original byte read is required.");
 return checkedTransferRevision(call.resultRevision,binding,key);
}
/** An admitted or unknown caller blocks even when an operator's timeout expired. */
export function requireNoOutstandingTransferCalls(calls:readonly Pick<TransferCallerProof,"state"|"returnedAt">[]):void {
 if(calls.some(call=>!["returned","stopped"].includes(call.state)||(call.state==="returned"&&!call.returnedAt)))transferConflict("An admitted original caller has neither returned nor been proven stopped.");
}
/** Complete DB inventory comparison, never a caller's selected key subset. */
export function requireCompleteTransferInventory(expected:readonly string[],actual:readonly string[]):void {
 const sorted=(keys:readonly string[])=>[...keys].sort();
 if(new Set(expected).size!==expected.length||new Set(actual).size!==actual.length||JSON.stringify(sorted(expected))!==JSON.stringify(sorted(actual)))transferConflict("The complete original storage inventory changed; no keys were adopted or retired.");
}
export function transferTargetKey(planId:string,keyDigest:string):string {
 if(!/^[0-9a-f-]{36}$/.test(planId)||!/^[a-f0-9]{64}$/.test(keyDigest))transferConflict();
 return `transfer/${planId}/${keyDigest}`;
}
