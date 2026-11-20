// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A stopped source is eligible only through its immutable affirmative review.
// No historical birth/finish is backfilled and no old capture is augmented.
import {and,eq,or,sql} from "drizzle-orm";
import {z} from "zod";
import type {Tx} from "@/core/service";
import type {mediaObjectWrites} from "./write-schema";
import {mediaStorageTransferCalls as calls} from "./transfer-schema";
import {transferConflict,transferDigest} from "./transfer-proof";
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const capturedSourceReviewSchema=z.object({format:z.literal("freeholder.original-source-review/v1"),receiptId:z.uuid(),reservationId:z.uuid(),namespace:digest,keyDigest:digest,runtimeId:z.uuid(),callId:z.uuid(),reviewId:z.uuid(),reviewDigest:digest,inventoryId:z.uuid(),stopDrainId:z.uuid().nullable(),stopProofDigest:digest.nullable(),providerRevisionDigest:digest,sha256:digest,bytes:z.number().int().nonnegative().safe(),witness:digest}).strict();
export type CapturedSourceReview=z.infer<typeof capturedSourceReviewSchema>;
export function requireCapturedSourceReview(value:unknown,receipt:Record<string,unknown>):CapturedSourceReview{
 const parsed=capturedSourceReviewSchema.safeParse(value);if(!parsed.success)transferConflict("The first source capture lacks its exact affirmative original review. It cannot be filled from a later current receipt.");
 const{witness,...proof}=parsed.data;
 if(witness!==transferDigest(proof)||proof.receiptId!==receipt.id||proof.reservationId!==receipt.originalReservationId||proof.namespace!==receipt.namespace||proof.keyDigest!==receipt.keyDigest||proof.runtimeId!==receipt.writerRuntimeId||proof.reviewDigest!==receipt.evidenceDigest||proof.providerRevisionDigest!==receipt.providerRevisionDigest||proof.sha256!==receipt.sha256||proof.bytes!==receipt.bytes||!proof.stopDrainId||!proof.stopProofDigest)transferConflict("The immutable stopped-source review names another original receipt, payload or executor proof.");
 return parsed.data;
}
export async function captureSourceReview(tx:Tx,receipt:typeof mediaObjectWrites.$inferSelect):Promise<CapturedSourceReview|null>{
 if(!receipt.originalReservationId||!receipt.namespace||!receipt.writerRuntimeId||receipt.redactedAt||receipt.deletedAt||receipt.operation!=="put"||receipt.state!=="accepted")transferConflict("Restore the exact tracked original source birth; a later snapshot cannot invent it.");
 const candidates=await tx.select().from(calls).where(or(and(eq(calls.objectReceiptId,receipt.id),eq(calls.kind,"ordinary_put")),and(eq(calls.physicalReceiptId,receipt.id),eq(calls.kind,"target_put")))).limit(2);
 const caller=candidates[0];if(candidates.length!==1||!caller)transferConflict("The exact original source physical caller is missing or conflicting; multipart/legacy sources require their own complete original protocol.");
 const{originalInventoryLifecycle}=await import("./original-provider-inventory"),original=caller.kind==="target_put"?await originalInventoryLifecycle.captureTransferPut(tx,receipt.id,caller.id):await originalInventoryLifecycle.captureFinishedPut(tx,receipt.id);
 if(!original.appliedReview){if(caller.state!=="returned"||!caller.observedAcceptedAt||!receipt.writerFinishedAt||original.requests.some(row=>row.state!=="returned"))transferConflict("The source has neither complete actual finishes nor its exact affirmative applied review.");return null;}
 if(receipt.writerFinishedAt)return null; // Existing actual-finish capture ABI stays unchanged.
 const review=original.appliedReview,stop=original.executorStop;if(!stop||!review.inventoryId||!receipt.providerRevisionDigest||!receipt.sha256||receipt.bytes===null)transferConflict();
 const proof={format:"freeholder.original-source-review/v1"as const,receiptId:receipt.id,reservationId:receipt.originalReservationId,namespace:receipt.namespace,keyDigest:receipt.keyDigest,runtimeId:receipt.writerRuntimeId,callId:caller.id,reviewId:review.id,reviewDigest:review.providerEvidenceDigest,inventoryId:review.inventoryId,stopDrainId:stop.id,stopProofDigest:stop.stopProofDigest,providerRevisionDigest:receipt.providerRevisionDigest,sha256:receipt.sha256,bytes:receipt.bytes};
 return requireCapturedSourceReview({...proof,witness:transferDigest(proof)},{...receipt});
}
export async function assertCapturedSourceReview(tx:Tx,objectId:string,receiptId:string,snapshot:Record<string,unknown>):Promise<void>{
 if(snapshot.writerFinishedAt)return;
 requireCapturedSourceReview(snapshot.sourceReview,snapshot);
 const[proof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_transfer_source_review_matches(${objectId}::uuid,${receiptId}::uuid,${JSON.stringify(snapshot)}::jsonb) as proven`);if(proof?.proven!==true)transferConflict("The exact original source review changed after its first immutable capture.");
}
