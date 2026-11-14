// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: metadata only, after the exact real first erasure proof.
import {and,eq,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {originalMediaScopeMembers} from "./original-erasure-scope";
import {readOriginalUploadEvidence} from "./original-upload-evidence";
import {mediaUploads,mediaObjects} from "./schema";
import {mediaObjectWrites} from "./write-schema";
import {lockTransferInventory} from "./transfer-authority";
import {allowMediaReceiptWrites,lockObjectDigest} from "./write-ledger";
import {minimizeOriginalProviderReservation} from "./original-provider-minimization";

/** Does not call a provider, clear another reservation, infer FIN or release
 * quota by key. A surviving legacy FK is read-only evidence in this leaf;
 * its nullable canonical birth is never filled or silently replaced. */
export async function minimizeOriginalUpload(tx:Tx,requestId:string,uploadId:string):Promise<boolean>{
 await lockTransferInventory(tx);
 const first=await originalMediaScopeMembers(tx,requestId,"media.multipartOperations");if(first.birthDebt)return false;
 const original=await readOriginalUploadEvidence(tx,first.membership,uploadId);
 if(original.state!=="proven"||original.basis!=="new_birth"||original.upload.strategy!=="proxy")return false;
 await lockObjectDigest(tx,original.keyDigest);
 const[ready]=await tx.execute<{ready:boolean}>(sql`select freeholder_media_upload_original_erasure_ready(${uploadId}::uuid,${requestId}::uuid) as ready`);if(ready?.ready!==true)return false;
 // SQL validates every actually linked pointer against the immutable first
 // scope and its own retirement/unwritten proof. Derivatives keep distinct
 // reservation UUIDs; sharing an upload FK never merges their generations.
 const pointers=await tx.select().from(mediaObjects).where(eq(mediaObjects.uploadId,uploadId)).for("update");
 const reservations=[...new Set([original.reservationId,...pointers.flatMap(row=>row.reservationId?[row.reservationId]:[])])];
 for(const reservationId of reservations){
  const receipts=await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(eq(mediaObjectWrites.originalReservationId,reservationId));
  if(receipts.length&&!await minimizeOriginalProviderReservation(tx,reservationId))return false;
 }
 await allowMediaReceiptWrites(tx);
 await tx.update(mediaUploads).set({storageKey:`retained:${original.keyDigest}`,filename:"[erased]",uploadedBy:"erased",ownerContactId:null,providerUploadId:null,provenance:{},mediaMetadata:{},failureReason:null,state:original.upload.state==="complete"?"complete":"aborted",completedAt:sql`coalesce(${mediaUploads.completedAt},transaction_timestamp())`,updatedAt:new Date()}).where(eq(mediaUploads.id,uploadId));
 for(const pointer of pointers)if(pointer.reservationId)await tx.delete(mediaObjects).where(and(eq(mediaObjects.reservationId,pointer.reservationId),eq(mediaObjects.uploadId,uploadId),eq(mediaObjects.state,"pending"),sql`${mediaObjects.assetId} is null`));
 return true;
}
