// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: this projection supplies evidence, never transfer authority.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { StorageBinding } from "@/adapters/storage/types";
import { ServiceError } from "@/core/service";
import { storageNamespace } from "./storage-quota";
import { objectKeyDigest } from "./write-ledger";
import type { mediaObjectWrites } from "./write-schema";
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const location=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("s3"),namespace:digest,location:z.object({endpoint:z.string().url(),bucket:z.string().min(1).max(1024)}).strict()}).strict(),
 z.object({kind:z.literal("replit"),namespace:digest,location:z.object({bucket:z.string().min(1).max(1024)}).strict()}).strict(),
]);
export function checkedTransferBinding(input:StorageBinding):StorageBinding{
 const binding=location.parse(input);
 const expected=binding.kind==="s3"?storageNamespace({id:"s3",endpoint:binding.location.endpoint,bucket:binding.location.bucket}):storageNamespace({id:"replit",bucket:binding.location.bucket});
 if(binding.namespace!==expected)throw new ServiceError("conflict","The captured storage resource does not match its original namespace.");
 if(binding.kind==="s3"){
  const url=new URL(binding.location.endpoint);
  if(url.username||url.password||url.search||url.hash||!["https:","http:"].includes(url.protocol))throw new ServiceError("validation","Use an explicit storage endpoint without credentials, query or fragment.");
 }
 return binding;
}
function canonical(value:unknown):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
 if(value!==null&&typeof value==="object")return`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
function witness(value:unknown):string{return createHash("sha256").update("freeholder:media-storage-transfer:v1\0").update(canonical(value)).digest("hex");}
type Receipt=typeof mediaObjectWrites.$inferSelect;
/** Callers must read the COMPLETE original key history under its real lock.
 * A subset supplied by an API caller is not evidence that no other intent exists.
 */
export function originalTransferObject(source:StorageBinding,key:string,history:readonly Receipt[]){
 const binding=checkedTransferBinding(source),keyDigest=objectKeyDigest(key);
 const unproven=()=>new ServiceError("conflict","Reconcile every original storage receipt before transferring this object.");
 if(!key||key.length>2048||/[\u0000-\u001f]/.test(key)||key.split("/").some(part=>part==="."||part==="..")||!history.length)throw unproven();
 if(new Set(history.map(row=>row.id)).size!==history.length)throw unproven();
 if(history.some(row=>row.key!==key||row.keyDigest!==keyDigest||row.redactedAt||["unverified","started","unknown"].includes(row.state)))throw unproven();
 const live=history.filter(row=>!row.deletedAt);
 if(!live.length||live.some(row=>row.operation!=="put"||row.state!=="accepted"||row.namespace!==binding.namespace||row.storageKind!==binding.kind||canonical(row.storageLocation)!==canonical(binding.location)))throw unproven();
 const original=live[0]!;
 if(!digest.safeParse(original.sha256).success||original.bytes===null||!Number.isSafeInteger(original.bytes)||original.bytes<0||!original.contentType||original.contentType.length>255)throw unproven();
 if(live.some(row=>row.sha256!==original.sha256||row.bytes!==original.bytes||row.contentType!==original.contentType))throw unproven();
 const receipts=[...history].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return{key,keyDigest,sha256:original.sha256!,bytes:original.bytes,contentType:original.contentType,
  receiptSetDigest:witness(receipts),receipts:receipts.map(row=>({id:row.id,witnessDigest:witness(row)})),
  contactIds:[...new Set(receipts.flatMap(row=>row.contactId?[row.contactId]:[]))].sort()};
}
export function transferInventoryDigest(source:StorageBinding,target:StorageBinding,objects:readonly ReturnType<typeof originalTransferObject>[]){
 const from=checkedTransferBinding(source),to=checkedTransferBinding(target);
 if(from.namespace===to.namespace)throw new ServiceError("validation","Choose a different verified target storage resource.");
 if(new Set(objects.map(object=>object.keyDigest)).size!==objects.length)throw new ServiceError("conflict","The original transfer inventory contains duplicate object keys.");
 return witness({source:from,target:to,objects:[...objects].sort((a,b)=>a.keyDigest<b.keyDigest?-1:a.keyDigest>b.keyDigest?1:0)});
}
