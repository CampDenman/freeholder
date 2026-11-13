// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: moving bytes is never proof of erasing the original lineage.
import {and,eq,inArray,isNull,or} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferReceipts} from "./transfer-schema";
import {transferSchemaAvailable} from "./transfer-authority";
export async function transferLineagePending(tx:Tx,originalReceiptId:string):Promise<boolean>{
 if(!await transferSchemaAvailable(tx))return false;
 const memberships=await tx.select({id:mediaStorageTransferObjects.id,targetDigest:mediaStorageTransferObjects.targetKeyDigest}).from(mediaStorageTransferObjects)
  .leftJoin(mediaStorageTransferReceipts,eq(mediaStorageTransferReceipts.objectId,mediaStorageTransferObjects.id))
  .where(or(eq(mediaStorageTransferReceipts.receiptId,originalReceiptId),eq(mediaStorageTransferObjects.targetReceiptId,originalReceiptId)));
 if(!memberships.length)return false;
 const ids=[...new Set(memberships.map(row=>row.id))],targets=[...new Set(memberships.map(row=>row.targetDigest))];
 const calls=await tx.select({id:mediaStorageTransferCalls.id}).from(mediaStorageTransferCalls).where(and(inArray(mediaStorageTransferCalls.objectId,ids),inArray(mediaStorageTransferCalls.state,["admitted","unknown"]))).limit(1);
 if(calls.length)return true;
 if(!targets.length)return false;
 return Boolean((await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(and(inArray(mediaObjectWrites.keyDigest,targets),or(isNull(mediaObjectWrites.deletedAt),inArray(mediaObjectWrites.state,["unverified","started","unknown"])))).limit(1)).length);
}
