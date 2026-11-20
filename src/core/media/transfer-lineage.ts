// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: moving bytes is never proof of erasing the original lineage.
import {and,eq,inArray,isNull,or} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls,mediaStorageTransferObjects,mediaStorageTransferReceipts} from "./transfer-schema";
import {originalQuotaLocatorPending} from "./original-quota-evidence";
import {transferSchemaAvailable} from "./transfer-authority";
export async function transferLineagePending(tx:Tx,originalReceiptId:string):Promise<boolean>{
 if(!await transferSchemaAvailable(tx))return false;
 const memberships=await tx.select({id:mediaStorageTransferObjects.id,targetReceiptId:mediaStorageTransferObjects.targetReceiptId}).from(mediaStorageTransferObjects)
  .leftJoin(mediaStorageTransferReceipts,eq(mediaStorageTransferReceipts.objectId,mediaStorageTransferObjects.id))
  .where(or(eq(mediaStorageTransferReceipts.receiptId,originalReceiptId),eq(mediaStorageTransferObjects.targetReceiptId,originalReceiptId)));
 if(!memberships.length)return false;
 const ids=[...new Set(memberships.map(row=>row.id))];
 const calls=await tx.select().from(mediaStorageTransferCalls).where(inArray(mediaStorageTransferCalls.objectId,ids));
 if(calls.some(row=>["admitted","unknown"].includes(row.state))||await originalQuotaLocatorPending(tx,calls))return true;
 const targetCalls=calls.filter(row=>row.kind==="target_put");
 if(memberships.some(member=>member.targetReceiptId&&!targetCalls.some(call=>call.objectId===member.id&&call.physicalReceiptId===member.targetReceiptId)))return true;
 const targets=[...new Set(targetCalls.flatMap(row=>row.physicalReceiptId?[row.physicalReceiptId]:[]))];
 if(targetCalls.some(row=>!row.physicalReceiptId))return true;
 if(!targets.length)return false; // An unadmitted equal-key target stays foreign.
 return Boolean((await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(and(inArray(mediaObjectWrites.id,targets),or(isNull(mediaObjectWrites.deletedAt),inArray(mediaObjectWrites.state,["unverified","started","unknown"])))).limit(1)).length);
}
