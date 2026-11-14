// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: copy/erasure authority is an actual original provider result.
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import type { StoredObjectRevision } from "@/adapters/storage/types";
import { mediaObjectWrites } from "./write-schema";
import { mediaStorageTransferCalls, mediaStorageTransferReceipts, type StorageTransferRevision } from "./transfer-schema";
import { transferConflict, transferDigest } from "./transfer-proof";

export function originalCapturedSourceRevision(captured:readonly {originalSnapshot:Record<string,unknown>;originalSnapshotDigest:string}[],key:string):StorageTransferRevision{
 const originals=captured.map(row=>{if(transferDigest(row.originalSnapshot)!==row.originalSnapshotDigest)transferConflict("Restore the intact original source receipt capture.");return row.originalSnapshot;}).filter(row=>row.operation==="put"&&row.state==="accepted"&&!row.deletedAt);
 const revisions=originals.map(row=>row.providerRevision as StoredObjectRevision|undefined);
 if(!revisions.length||revisions.some((revision,index)=>{
  const row=originals[index]!;return !revision||revision.key!==key||revision.key!==row.key||revision.namespace!==row.namespace||!row.writerRuntimeId||!row.writerFinishedAt||!["single-put-v1","nonresumable-put-v1","multipart-receipts-v1"].includes(String(row.writerProtocol))||row.providerRevisionDigest!==transferDigest(revision)||transferDigest(revision)!==transferDigest(revisions[0]);
 }))transferConflict("The original source provider generation/caller result is missing. A later same-key read cannot backfill it.");
 return revisions[0]!;
}
export async function originalTransferPhysicalRevision(tx: Tx, object: { id: string; key: string; targetKey: string; targetReceiptId: string | null }, side: "source" | "target"): Promise<StorageTransferRevision | null> {
  if (side === "target") {
    const callers = await tx.select().from(mediaStorageTransferCalls).where(and(eq(mediaStorageTransferCalls.objectId, object.id), eq(mediaStorageTransferCalls.kind, "target_put")));
    if (!callers.length) {
      if (object.targetReceiptId) transferConflict("Restore the original target admission; a current key cannot supply missing lineage.");
      return null; // No original target writer was admitted. Foreign bytes stay foreign.
    }
    const [receipt] = object.targetReceiptId ? await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, object.targetReceiptId)).limit(1) : [];
    if (!receipt || !callers.some(row => row.physicalReceiptId === receipt.id) || !receipt.writerRuntimeId || !receipt.providerRevision || !receipt.providerRevisionDigest || receipt.providerRevisionDigest !== transferDigest(receipt.providerRevision)) transferConflict("Recover the actual original target PUT result before touching any target generation.");
    if(!receipt.writerFinishedAt||!receipt.observedAcceptedAt){
      const caller=callers.find(row=>row.physicalReceiptId===receipt.id);if(!caller)transferConflict();
      const[authority]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_transfer_applied_put_review(${caller.id}::uuid) as proven`);if(authority?.proven!==true)transferConflict("Retain actual finishes/ACK or the exact affirmative original target review before physical cleanup.");
    }
    if (receipt.providerRevision.key !== object.targetKey) transferConflict();
    return receipt.providerRevision;
  }
  const captured = await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId, object.id));
  return originalCapturedSourceRevision(captured,object.key);
}

/** Reservation birth is independent of provider revision. A later pointer
 * with an equal key cannot replace a missing immutable original identity. */
export async function originalTransferReservation(tx:Tx,object:{id:string;targetReceiptId:string|null},side:"source"|"target"):Promise<string>{
 if(side==="target"){
  const[row]=object.targetReceiptId?await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,object.targetReceiptId)).limit(1):[];
  if(!row?.originalReservationId)transferConflict("The original target reservation birth is missing; a current pointer cannot backfill it.");return row.originalReservationId;
 }
 const members=await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId,object.id));
 const live=members.filter(member=>{if(transferDigest(member.originalSnapshot)!==member.originalSnapshotDigest)transferConflict("Restore the intact original reservation capture.");return member.originalSnapshot.operation==="put"&&member.originalSnapshot.state==="accepted"&&!member.originalSnapshot.deletedAt;});
 const identities=live.map(member=>member.originalSnapshot.originalReservationId);
 if(!identities.length||identities.some(id=>typeof id!=="string"||id!==identities[0]))transferConflict("Original source reservation birth is absent or conflicting; later equal-key state cannot supply it.");
 return String(identities[0]);
}
