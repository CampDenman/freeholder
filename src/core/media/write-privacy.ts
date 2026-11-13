// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {captureFirstOriginalMediaScope,originalMediaScopeMembers,originalMediaScopePending,originalMediaScopeForeign,retainedOriginalMediaArtifacts} from "./original-erasure-scope";
import {ORIGINAL_PROVIDER_EVIDENCE_TABLES,exportOriginalProviderEvidence,originalProviderParentsForContact,originalProviderEvidencePending} from "./original-provider-privacy";
import {minimizeOriginalProviderReservation} from "./original-provider-minimization";
// C1.12/C11.08: erasure cannot outrun unresolved original storage operations.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { enqueueJob } from "@/core/jobs";
import { completeErasureJob,erasureArtifactIsIntact, registerContactPrivacySource } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import type { Tx } from "@/core/service";
import { allowMediaReceiptWrites, deleteWithReceipt, MEDIA_WRITES_SCOPE, objectKeyDigest,storageOperationsHeld } from "./write-ledger";
import { mediaObjectWrites } from "./write-schema";
import {objectCohortIds} from "./erasure-cohorts";
import {mediaErasureCohorts,mediaOriginalErasureScopes} from "./erasure-schema";

export const MEDIA_WRITE_ERASURE_JOB = "core.eraseMediaStorageOperations";
const payload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), ids: z.array(z.uuid()).max(500) });
const receipt = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() })) });
export async function minimizeMediaStorageOperations(tx: Tx, ids: string[]): Promise<number> {
  await allowMediaReceiptWrites(tx);
  let affected = 0;
  const rows = await tx.select().from(mediaObjectWrites).where(and(inArray(mediaObjectWrites.id, ids), or(isNull(mediaObjectWrites.redactedAt),sql`${mediaObjectWrites.providerRevision} is not null`)))
    .orderBy(asc(mediaObjectWrites.id)).for("update");
  for (const row of rows) {
    if(!await minimizeOriginalProviderReservation(tx,row.originalReservationId))continue;
    if (await storageOperationsHeld(tx, [row.contactId])) continue;
    if(await(await import("./transfer-lineage")).transferLineagePending(tx,row.id))continue;
    if (!row.deletedAt || !["accepted", "confirmed_absent"].includes(row.state)) continue;
    const unresolved = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(eq(mediaObjectWrites.keyDigest, row.keyDigest), inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]))).limit(1);
    if (unresolved.length) continue;
    await tx.update(mediaObjectWrites).set({ key: `retained:${row.keyDigest}`, actor: "erased", contactId: null,
      storageLocation: {}, providerRevision:null,reviewedBy: null, redactedAt: row.redactedAt??new Date(), updatedAt: new Date() }).where(eq(mediaObjectWrites.id, row.id));
    affected += 1;
  }
  return affected;
}
registerContactPrivacySource({
  scope: MEDIA_WRITES_SCOPE, tables: ["media_object_writes","media_erasure_cohorts","media_original_erasure_scopes",...ORIGINAL_PROVIDER_EVIDENCE_TABLES], retentionScopes: ["members","media.multipartOperations"], eraseOrder: 20,
  captureRetention:async(tx,contactId,context)=>{if(context.isNew)await captureFirstOriginalMediaScope(tx,context.requestId,contactId,MEDIA_WRITES_SCOPE);},
  retainedErasureArtifacts:(tx,contactId,context)=>retainedOriginalMediaArtifacts(tx,contactId,context.requestId,MEDIA_WRITES_SCOPE),
  exportData: async (tx, contactId) => ({originalScopes:await tx.select({scope:mediaOriginalErasureScopes}).from(mediaOriginalErasureScopes).innerJoin(dataRequests,eq(dataRequests.id,mediaOriginalErasureScopes.requestId)).where(and(eq(dataRequests.contactId,contactId),eq(mediaOriginalErasureScopes.scope,MEDIA_WRITES_SCOPE))),providerEvidence:await exportOriginalProviderEvidence(tx,await originalProviderParentsForContact(tx,contactId)),operations:await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.contactId, contactId)).orderBy(asc(mediaObjectWrites.id)),cohorts:await tx.select({cohort:mediaErasureCohorts}).from(mediaErasureCohorts).innerJoin(dataRequests,eq(dataRequests.id,mediaErasureCohorts.requestId)).where(eq(dataRequests.contactId,contactId))}),
  erase: async (tx, contactId, context) => {
    const first=await captureFirstOriginalMediaScope(tx,context.requestId,contactId,MEDIA_WRITES_SCOPE),ids=first.membership.receipts.map(row=>row.id),rows=ids.length?await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,ids)):[];
    if(rows.length!==ids.length)throw new Error("An exact original media member is missing.");
    // No provider call is made while the parent erasure transaction is open.
    await minimizeMediaStorageOperations(tx, ids);
    const pending = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(inArray(mediaObjectWrites.id, ids), or(isNull(mediaObjectWrites.redactedAt),sql`${mediaObjectWrites.providerRevision} is not null`))).orderBy(asc(mediaObjectWrites.id));
    const pendingJobs: string[] = [];
    const blocked=await originalMediaScopePending(tx,context.requestId,MEDIA_WRITES_SCOPE,contactId);
    for (let offset = 0; offset < Math.max(pending.length,blocked?1:0); offset += 500) {
      const originalJobId = randomUUID();
      const job = await enqueueJob(tx, MEDIA_WRITE_ERASURE_JOB, { requestId: context.requestId, originalJobId, ids: pending.slice(offset, offset + 500).map(row => row.id) },
        { id: originalJobId, idempotencyKey: `media-operation-erasure:${context.requestId}:${offset}` });
      pendingJobs.push(job.id);
    }
    return { affected: rows.length, pendingJobs };
  },
});

export async function eraseMediaStorageOperations(data: Record<string, unknown>): Promise<{ erased: number }> {
  const input = payload.parse(data);
  const captured = await db().transaction(async tx => {
    await lockContactIdentity(tx);
    const [request] = await tx.select().from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1);
    const [artifact] = await tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).limit(1);
    const original = receipt.safeParse(artifact?.body);
    if (!request || !artifact||!erasureArtifactIsIntact(artifact)|| !original.success) throw new Error("The original media erasure receipt is unavailable. Restore its exact backup.");
    const outcome = original.data.outcomes.find(row => row.scope === MEDIA_WRITES_SCOPE);
    if (!outcome) throw new Error("The original media erasure scope is unavailable.");
    if (outcome.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return null;
    const queued=await tx.execute(sql`select id from pgboss.job where id=${input.originalJobId}::uuid and name=${MEDIA_WRITE_ERASURE_JOB} and data=${JSON.stringify(input)}::jsonb`);if(queued.length!==1)throw new Error("Restore the exact original queued media erasure payload.");
    const first=await originalMediaScopeMembers(tx,input.requestId,MEDIA_WRITES_SCOPE);if(first.birthDebt||input.ids.some(id=>!first.receiptIds.includes(id))||await originalMediaScopeForeign(tx,input.requestId,MEDIA_WRITES_SCOPE,request.contactId))throw new Error("Original media scope or birth proof is incomplete, or later data requires a separately verified request. Its first capture cannot be expanded.");
    const originalRows = await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id, input.ids));
    if (originalRows.length !== input.ids.length) throw new Error("An original storage receipt is missing. Restore its exact backup before acknowledging erasure.");
    const cohortIds=await objectCohortIds(tx,input.requestId,MEDIA_WRITES_SCOPE);
    return tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,[...new Set([...input.ids,...cohortIds])]));
  });
  if (!captured) return { erased: 0 };
  const keys = [...new Set(captured.filter(row => !row.redactedAt && !row.deletedAt).map(row => row.key))];
  await db().transaction(async tx=>{await lockContactIdentity(tx);const allowed=[...new Set([...input.ids,...await objectCohortIds(tx,input.requestId,MEDIA_WRITES_SCOPE)])];for(const key of keys){const foreign=await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(and(eq(mediaObjectWrites.keyDigest,objectKeyDigest(key)),notInArray(mediaObjectWrites.id,allowed))).limit(1);if(foreign.length)throw new Error("A different original receipt shares this key outside the captured erasure scope. Preserve both generations for recovery.");}});
  for (const key of keys) await deleteWithReceipt(key);
  const result = await db().transaction(async tx => {
    await lockContactIdentity(tx);
    // Exact late DELETE/copy descendants are attached to the original cohort
    // at their authentic admission. Current contacts/equal keys add no scope.
    const cohortIds=await objectCohortIds(tx,input.requestId,MEDIA_WRITES_SCOPE);
    const related = await tx.select({id:mediaObjectWrites.id}).from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,[...new Set([...input.ids,...cohortIds])]));
    const erased = await minimizeMediaStorageOperations(tx, related.map(row => row.id));
    const pending = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(inArray(mediaObjectWrites.id, related.map(row => row.id)),or(isNull(mediaObjectWrites.redactedAt),inArray(mediaObjectWrites.state,["unverified","started","unknown"])))).limit(1);
    const[request]=await tx.select().from(dataRequests).where(eq(dataRequests.id,input.requestId)).limit(1);if(!request)throw new Error("Original request missing.");return { erased, pending: pending.length > 0||await originalProviderEvidencePending(tx,{receiptIds:related.map(row=>row.id)})||await originalMediaScopePending(tx,input.requestId,MEDIA_WRITES_SCOPE,request.contactId) };
  });
  if (result.pending) throw new Error("Original storage ownership, a named hold or unresolved provider work keeps this erasure pending.");
  await completeErasureJob.call({ requestId: input.requestId, scope: MEDIA_WRITES_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return { erased: result.erased };
}
