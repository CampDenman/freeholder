// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Original remote copies remain a privacy debt until their exact outcome settles.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { enqueueJob } from "@/core/jobs";
import { completeErasureJob, registerContactPrivacySource } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { registerRetentionSource } from "@/core/retention/registry";
import { ServiceError, type Tx } from "@/core/service";
import { formLeadCopies, formSubmissions } from "./schema";
import { effectiveLeadAttempt, leadCopyReceipts, retireLeadCopies } from "./lead-copy-state";
export const LEAD_ERASURE_JOB = "core.eraseFormLeadCopies";
export const LEAD_PRIVACY_SCOPE = "forms.leadCopies";

/** Read effective direct/inherited holds at the physical minimization boundary. */
export async function minimizeLeadCopies(tx: Tx, ids: string[], erase = false) {
  if (!ids.length) return [] as string[];
  await lockContactIdentityForRead(tx);
  await leadCopyReceipts(tx);
  const holds = await tx.select({ contactId: dataRequests.contactId }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(inArray(privacyRetentionExceptions.scope, [LEAD_PRIVACY_SCOPE, "forms.submissions", "privacy.records"]), sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`));
  const held = new Set(holds.map(row => row.contactId));
  const copies = await tx.select().from(formLeadCopies).where(inArray(formLeadCopies.id, ids)).orderBy(formLeadCopies.id).for("update");
  if (copies.length !== new Set(ids).size) throw new ServiceError("conflict", "Restore the missing original lead-copy witness before erasure can complete.");
  const pending: string[] = [];
  for (const copy of copies) {
    const [parent] = copy.submissionId ? await tx.select({ contactId: formSubmissions.contactId }).from(formSubmissions).where(eq(formSubmissions.id, copy.submissionId)) : [];
    const [request] = copy.erasureRequestId ? await tx.select({ contactId: dataRequests.contactId }).from(dataRequests).where(eq(dataRequests.id, copy.erasureRequestId)) : [];
    const owners = [parent?.contactId, request?.contactId].filter((id): id is string => Boolean(id));
    const unknown = copy.attempts.some(attempt => effectiveLeadAttempt(attempt) === "unknown");
    const copied = copy.attempts.some(attempt => effectiveLeadAttempt(attempt) === "copied");
    if ((held.size && !owners.length) || owners.some(id => held.has(id)) || unknown || (erase && copied && !copy.remoteErasedAt)) { pending.push(copy.id); continue; }
    await tx.update(formLeadCopies).set({ encryptedRequest: null, ...(erase ? { providerRef: null } : {}), updatedAt: new Date() }).where(eq(formLeadCopies.id, copy.id));
  }
  return pending;
}

registerContactPrivacySource({
  scope: LEAD_PRIVACY_SCOPE, retentionScopes: ["forms.submissions", "privacy.records"], tables: ["form_lead_copies"], eraseOrder: 15,
  exportData: async (tx, contactId) => {
    const copies = await tx.select({ copy: formLeadCopies }).from(formLeadCopies).innerJoin(formSubmissions, eq(formSubmissions.id, formLeadCopies.submissionId)).where(eq(formSubmissions.contactId, contactId));
    return copies.map(({ copy }) => ({ id: copy.id, submissionId: copy.submissionId, provider: copy.provider, originalBaseUrl: copy.originalBaseUrl, state: copy.state, retiredAt: copy.retiredAt, remoteErasedAt: copy.remoteErasedAt, attempts: copy.attempts.map(({ id, attempt, observed, humanOutcome, httpStatus }) => ({ id, attempt, observed, humanOutcome, httpStatus })) }));
  },
  erase: async (tx, contactId, context) => {
    const rows = await tx.select({ id: formSubmissions.id }).from(formSubmissions).where(eq(formSubmissions.contactId, contactId));
    const submissions = rows.map(row => row.id);
    await retireLeadCopies(tx, submissions, context.requestId);
    const copies = submissions.length ? await tx.select({ id: formLeadCopies.id }).from(formLeadCopies).where(inArray(formLeadCopies.submissionId, submissions)) : [];
    const pending = await minimizeLeadCopies(tx, copies.map(row => row.id), true);
    const pendingJobs: string[] = [];
    for (let offset = 0; offset < pending.length; offset += 100) {
      const originalJobId = randomUUID();
      const job = await enqueueJob(tx, LEAD_ERASURE_JOB, { requestId: context.requestId, originalJobId, ids: pending.slice(offset, offset + 100) }, { id: originalJobId, idempotencyKey: `lead-copy-erasure:${context.requestId}:${offset}` });
      pendingJobs.push(job.id);
    }
    return { affected: copies.length, pendingJobs };
  },
});
registerRetentionSource({
  kind: "formLeadPayloads", tables: ["form_lead_copies"], privacyScope: LEAD_PRIVACY_SCOPE,
  purge: async ({ cutoff }) => db().transaction(async tx => {
    const rows = await tx.select({ id: formLeadCopies.id }).from(formLeadCopies).where(and(isNotNull(formLeadCopies.encryptedRequest), inArray(formLeadCopies.state, ["copied", "not_copied", "cancelled"]), sql`${formLeadCopies.updatedAt}<${cutoff.toISOString()}::timestamptz`)).orderBy(formLeadCopies.id).limit(500);
    const pending = await minimizeLeadCopies(tx, rows.map(row => row.id));
    return rows.length - pending.length;
  }),
});
export async function eraseFormLeadCopies(data: Record<string, unknown>) {
  const input = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), ids: z.array(z.uuid()).min(1).max(100) }).parse(data);
  const result = await db().transaction(async tx => {
    const [artifact] = await tx.select({ body: dataRequestArtifacts.body }).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).limit(1);
    const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough().safeParse(artifact?.body);
    if (!receipt.success) throw new ServiceError("conflict", "Restore the exact original lead erasure receipt before retrying.");
    const outcome = receipt.data.outcomes.find(row => row.scope === LEAD_PRIVACY_SCOPE);
    if (!outcome) throw new ServiceError("conflict", "The original lead erasure scope is missing.");
    if (outcome.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return { pending: [], alreadyHandled: true };
    const [request] = await tx.select({ contactId: dataRequests.contactId }).from(dataRequests).where(eq(dataRequests.id, input.requestId));
    if (!request) throw new ServiceError("conflict", "The original erasure requester is missing.");
    const rows = await tx.select().from(formLeadCopies).where(inArray(formLeadCopies.id, input.ids));
    if (rows.length !== input.ids.length || rows.some(row => !row.erasureRequestId || !row.retiredAt)) throw new ServiceError("conflict", "The original lead erasure ownership is unavailable.");
    for (const row of rows) {
      const [original] = await tx.select({ contactId: dataRequests.contactId }).from(dataRequests).where(eq(dataRequests.id, row.erasureRequestId!));
      if (!original || original.contactId !== request.contactId) throw new ServiceError("conflict", "The original lead erasure belongs to another recorded requester.");
    }
    return { pending: await minimizeLeadCopies(tx, input.ids, true), alreadyHandled: false };
  });
  if (result.alreadyHandled) return { minimized: 0 };
  if (result.pending.length) throw new ServiceError("conflict", "Original provider outcome, provider erasure or a current named hold keeps this receipt pending.");
  await completeErasureJob.call({ requestId: input.requestId, scope: LEAD_PRIVACY_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return { minimized: input.ids.length };
}
