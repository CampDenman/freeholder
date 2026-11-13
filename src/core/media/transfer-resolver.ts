// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: logical references remain original; only verified keys redirect.
import {and,eq,isNotNull,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {currentServiceTransaction} from "@/core/plugins/context";
import type {StorageAdapter} from "@/adapters/storage/types";
import {mediaStorageTransferObjects,mediaStorageTransferPlans} from "./transfer-schema";
import {mediaObjectWrites} from "./write-schema";
import {transferSchemaAvailable} from "./transfer-authority";
import {objectKeyDigest} from "./write-ledger";
import {transferConflict} from "./transfer-proof";
import {configuredPhysicalStorage} from "./transfer-storage";

export async function adoptedPhysicalObject(key:string){
 const tx=currentServiceTransaction();
 // to_regprocedure is safe before the unapplied capability. Never infer
 // absence from a failed query or from missing transfer rows in a newer schema.
 if(tx){if(!await transferSchemaAvailable(tx))return null;}
 else{const available=await db().execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_transfer_capability_v1()') is not null as present`);if(available[0]?.present!==true)return null;}
 const executor=tx??db();
 const rows=await executor.select({object:mediaStorageTransferObjects,plan:mediaStorageTransferPlans,receipt:mediaObjectWrites}).from(mediaStorageTransferObjects)
  .innerJoin(mediaStorageTransferPlans,eq(mediaStorageTransferPlans.id,mediaStorageTransferObjects.planId))
  .innerJoin(mediaObjectWrites,eq(mediaObjectWrites.id,mediaStorageTransferObjects.targetReceiptId))
  .where(and(eq(mediaStorageTransferObjects.keyDigest,objectKeyDigest(key)),isNotNull(mediaStorageTransferPlans.adoptedAt))).limit(2);
 if(!rows.length)return null;
 if(rows.length!==1)transferConflict("The original object has conflicting physical adoption receipts.");
 const{object,plan,receipt}=rows[0]!;
 if(object.key!==key||!["adopted","cleanup_pending","complete"].includes(object.state)||!object.targetRevision||receipt.state!=="accepted"||receipt.deletedAt||receipt.redactedAt||receipt.namespace!==plan.targetNamespace||receipt.sha256!==object.sha256||receipt.bytes!==object.bytes||receipt.key!==object.targetKey)transferConflict("The adopted original physical copy needs recovery before it can be read.");
 return{binding:plan.originalTarget,key:object.targetKey,receipt:{sha256:object.sha256,bytes:object.bytes}};
}
/** Read-only facade covers all existing logical-key consumers, including
 * gallery packages, social images and signed URLs. Write methods are untouched.
 */
export function withAdoptedStorageReads(original:StorageAdapter):StorageAdapter{
 if(original.id==="local")return original;
 const resolve=async(key:string)=>{const adopted=await adoptedPhysicalObject(key);return adopted?{store:await configuredPhysicalStorage(adopted.binding),key:adopted.key}:null;};
 return{...original,
  async get(key){const target=await resolve(key);return target?target.store.get(target.key):original.get(key);},
  async head(key){const target=await resolve(key),result=target?await target.store.head(target.key):await original.head(key);return result?{...result,key}:undefined;},
  async stream(key){const target=await resolve(key);return target?target.store.stream(target.key):original.stream(key);},
  async readRange(key,start,end){const target=await resolve(key);return target?target.store.readRange(target.key,start,end):original.readRange(key,start,end);},
  async url(key,options){const adopted=await adoptedPhysicalObject(key);if(!adopted)return original.url(key,options);if(adopted.binding.kind==="replit")return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;const target=await configuredPhysicalStorage(adopted.binding);return target.url(adopted.key,options);},
 };
}
