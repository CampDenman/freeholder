// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owning services may publish only their own reserved original physical result.
import {and,eq,isNull} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {lockTransferInventory} from "./transfer-authority";
import {transferConflict} from "./transfer-proof";
export async function requireManagedOriginalObject(tx:Tx,input:{key:string;bytes:number;reservationId:string|null;sha256?:string;actor?:string}){
 await lockTransferInventory(tx);
 const[pointer]=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,input.key)).limit(1).for("update");
 if(!input.reservationId||!pointer?.reservationId||pointer.reservationId!==input.reservationId)transferConflict("Restore the original file reservation before publishing its stored bytes.");
 const rows=await tx.select().from(mediaObjectWrites).where(and(eq(mediaObjectWrites.originalReservationId,pointer.reservationId),eq(mediaObjectWrites.operation,"put"),isNull(mediaObjectWrites.deletedAt))).limit(2);
 const receipt=rows[0];if(rows.length!==1||!receipt||receipt.key!==input.key||receipt.bytes!==input.bytes||input.sha256&&receipt.sha256!==input.sha256||input.actor&&receipt.actor!==input.actor||receipt.contactId!==pointer.ownerContactId)transferConflict("The original stored file has missing or conflicting byte/owner evidence. Recover that original upload before publishing it.");
 const{originalInventoryLifecycle}=await import("./original-provider-inventory");
 const original=await originalInventoryLifecycle.captureFinishedPut(tx,receipt.id);
 if(original.receipt.state!=="accepted"||!original.receipt.providerRevision)transferConflict("The original physical upload is not yet proven ready.");
 return original.receipt;
}

