// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {hasDurableOriginalMediaCallerProof} from "./retirement-authority";
// C1.12/C11.08: erasure cannot outrun unresolved original storage operations.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { enqueueJob } from "@/core/jobs";
import { completeErasureJob, registerContactPrivacySource } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import type { Tx } from "@/core/service";
import { allowMediaReceiptWrites, deleteWithReceipt, MEDIA_WRITES_SCOPE, storageOperationsHeld } from "./write-ledger";
import { mediaObjectWrites } from "./write-schema";
import {captureMediaErasureCohort,objectCohortIds} from "./erasure-cohorts";
import {mediaErasureCohorts} from "./erasure-schema";

export const MEDIA_WRITE_ERASURE_JOB = "core.eraseMediaStorageOperations";
const payload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), ids: z.array(z.uuid()).min(1).max(500) });
const receipt = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() })) });
export async function minimizeMediaStorageOperations(tx: Tx, ids: string[]): Promise<number> {
  await allowMediaReceiptWrites(tx);
  let affected = 0;
  const rows = await tx.select().from(mediaObjectWrites).where(and(inArray(mediaObjectWrites.id, ids), or(isNull(mediaObjectWrites.redactedAt),sql`${mediaObjectWrites.providerRevision} is not null`)))
    .orderBy(asc(mediaObjectWrites.id)).for("update");
  for (const row of rows) {
    if(!hasDurableOriginalMediaCallerProof())continue;
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
  scope: MEDIA_WRITES_SCOPE, tables: ["media_object_writes","media_erasure_cohorts"], retentionScopes: ["members","media.multipartOperations"], eraseOrder: 20,
  exportData: async (tx, contactId) => ({operations:await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.contactId, contactId)).orderBy(asc(mediaObjectWrites.id)),cohorts:await tx.select({cohort:mediaErasureCohorts}).from(mediaErasureCohorts).innerJoin(dataRequests,eq(dataRequests.id,mediaErasureCohorts.requestId)).where(eq(dataRequests.contactId,contactId))}),
  erase: async (tx, contactId, context) => {
    const rows = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(eq(mediaObjectWrites.contactId, contactId), isNull(mediaObjectWrites.redactedAt))).orderBy(asc(mediaObjectWrites.id));
    if (!rows.length) return { affected: 0 };
    const ids = rows.map(row => row.id);
    await captureMediaErasureCohort(tx,context.requestId,MEDIA_WRITES_SCOPE,ids);
    // No provider call is made while the parent erasure transaction is open.
    await minimizeMediaStorageOperations(tx, ids);
    const pending = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(inArray(mediaObjectWrites.id, ids), or(isNull(mediaObjectWrites.redactedAt),sql`${mediaObjectWrites.providerRevision} is not null`))).orderBy(asc(mediaObjectWrites.id));
    const pendingJobs: string[] = [];
    for (let offset = 0; offset < pending.length; offset += 500) {
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
    const [request] = await tx.select({ id: dataRequests.id }).from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1);
    const [artifact] = await tx.select({ body: dataRequestArtifacts.body }).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).limit(1);
    const original = receipt.safeParse(artifact?.body);
    if (!request || !original.success) throw new Error("The original media erasure receipt is unavailable. Restore its exact backup.");
    const outcome = original.data.outcomes.find(row => row.scope === MEDIA_WRITES_SCOPE);
    if (!outcome) throw new Error("The original media erasure scope is unavailable.");
    if (outcome.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return null;
    const originalRows = await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id, input.ids));
    if (originalRows.length !== input.ids.length) throw new Error("An original storage receipt is missing. Restore its exact backup before acknowledging erasure.");
    const cohortIds=await objectCohortIds(tx,input.requestId,MEDIA_WRITES_SCOPE);
    return tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.id,[...new Set([...input.ids,...cohortIds])]));
  });
  if (!captured) return { erased: 0 };
  const keys = [...new Set(captured.filter(row => !row.redactedAt && !row.deletedAt).map(row => row.key))];
  for (const key of keys) await deleteWithReceipt(key);
  const result = await db().transaction(async tx => {
    await lockContactIdentity(tx);
    // Include the DELETE receipts produced for these exact original keys.
    // They carry the same owner, so cleanup must not leave a fresh personal
    // copy immediately after minimizing the captured PUT receipts.
    const contacts = [...new Set(captured.flatMap(row => row.contactId ? [row.contactId] : []))];
    const cohortIds=await objectCohortIds(tx,input.requestId,MEDIA_WRITES_SCOPE);
    const related = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites).where(and(
      inArray(mediaObjectWrites.keyDigest, [...new Set(captured.map(row => row.keyDigest))]),
      or(inArray(mediaObjectWrites.id, [...input.ids,...cohortIds]), contacts.length ? inArray(mediaObjectWrites.contactId, contacts) : undefined)));
    const erased = await minimizeMediaStorageOperations(tx, related.map(row => row.id));
    const pending = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(inArray(mediaObjectWrites.id, related.map(row => row.id)),or(isNull(mediaObjectWrites.redactedAt),inArray(mediaObjectWrites.state,["unverified","started","unknown"])))).limit(1);
    return { erased, pending: pending.length > 0 };
  });
  if (result.pending) throw new Error("Original storage ownership, a named hold or unresolved provider work keeps this erasure pending.");
  await completeErasureJob.call({ requestId: input.requestId, scope: MEDIA_WRITES_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return { erased: result.erased };
}
