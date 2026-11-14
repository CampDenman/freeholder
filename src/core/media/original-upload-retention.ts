// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Thirty-day upload metadata retention is not physical byte erasure.
import {and,asc,eq,inArray,lt,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaUploads} from "./schema";
import {originalUploadMetadataIsEmpty} from "./original-erasure-proof";
import {lockTransferInventory} from "./transfer-authority";
import {allowMediaReceiptWrites,lockObjectDigest,objectKeyDigest} from "./write-ledger";

/** Only redundant intake PII is reduced here. Keep the exact immutable UUID,
 * original owner, asset/FK and necessary private locator for live custody and
 * later first privacy capture. No DELETE/remote terminal/erasure ACK occurs. */
export async function reduceTerminalUploadMetadata(tx:Tx,asOf:Date):Promise<number>{
 await lockTransferInventory(tx);
 const cutoff=new Date(asOf.getTime()-30*24*60*60*1000),rows=await tx.select().from(mediaUploads).where(and(inArray(mediaUploads.state,["complete","failed","aborted","expired"]),lt(mediaUploads.updatedAt,cutoff))).orderBy(asc(mediaUploads.id)).limit(100).for("update");
 let reduced=0;
 for(const upload of rows){
  if(upload.filename==="[expired upload]"&&originalUploadMetadataIsEmpty(upload.provenance)&&originalUploadMetadataIsEmpty(upload.mediaMetadata)&&upload.failureReason===null)continue;
  if(!upload.originalReservationId||upload.storageKey.startsWith("retained:"))continue;
  await lockObjectDigest(tx,objectKeyDigest(upload.storageKey));
  // The SQL predicate uses the actual database clock. A future asOf used to
  // scan cannot manufacture age or any physical caller/custody proof.
  const[proof]=await tx.execute<{ready:boolean}>(sql`select freeholder_media_upload_terminal_custody(${upload.id}::uuid) as ready`);if(proof?.ready!==true)continue;
  await allowMediaReceiptWrites(tx);
  await tx.update(mediaUploads).set({filename:"[expired upload]",provenance:{},mediaMetadata:{},failureReason:null,updatedAt:new Date()}).where(eq(mediaUploads.id,upload.id));reduced+=1;
 }
 return reduced;
}
