// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: immutable mail ownership, with truthful pending erasure receipts.
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { enqueueJob } from "@/core/jobs";
import { contactPrivacyIdentity } from "@/core/privacy/contact-identity";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { completeErasureJob, registerContactPrivacySource } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import type { Tx } from "@/core/service";
import { mailDeliveries, mailDispatches, mailLegacyResolutions, mailProviderEvents, mailRecordSubjects, mailSuppressions } from "./schema";
import { MAIL_RECORDS_SCOPE, minimizeMailRecordsInTransaction, type MailRecordRef } from "./record-retention";
import { publicMailDelivery, publicMailSuppression } from "./service";
import { sealMailReceipts } from "./receipts";
import { lockMailRecord } from "./ownership";

export const MAIL_RECORD_ERASURE_JOB = "core.eraseMailRecords";
const refSchema = z.object({ kind: z.enum(["delivery", "event", "suppression"]), id: z.uuid(), requiresReview: z.boolean() });
const erasurePayload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), refs: z.array(refSchema).min(1).max(500) });
const receiptSchema = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() })) });
type CapturedRef = z.infer<typeof refSchema>;
async function fenceLegacyWriters(tx: Tx): Promise<void> {
  await lockContactIdentity(tx);
  // Even zero/minimization-pending captures must exclude an old writer
  // appending personal data after the immutable erasure snapshot.
  await sealMailReceipts(tx);
}
async function readChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) result.push(...await read(ids.slice(offset, offset + 500)));
  return result;
}

async function capture(tx: Tx, contactId: string, includeMinimized = false): Promise<CapturedRef[]> {
  const identity = await contactPrivacyIdentity(tx, contactId), refs: CapturedRef[] = [];
  for (const kind of ["delivery", "event", "suppression"] as const) {
    const table = kind === "delivery" ? mailDeliveries : kind === "event" ? mailProviderEvents : mailSuppressions;
    const address = kind === "suppression" ? mailSuppressions.email : kind === "event" ? mailProviderEvents.recipient : mailDeliveries.recipient;
    const owned = sql<boolean>`exists(select 1 from ${mailRecordSubjects} where kind=${kind} and record_id=${table.id} and ${inArray(mailRecordSubjects.contactId, identity.contactIds)})`;
    const unknown = identity.emails.length ? sql<boolean>`not exists(select 1 from ${mailRecordSubjects} where kind=${kind} and record_id=${table.id} and contact_id is not null) and ${inArray(address, identity.emails)}` : sql<boolean>`false`;
    let after: string | undefined;
    for (;;) {
      // Keep outer qualifications in computed SQL; bounded keyset reads must
      // not truncate a large subject's export or forget pending erasure work.
      const rows = await tx.execute<{ id: string; owned: boolean }>(sql`select ${table.id} as id,${owned} as owned from ${table} where ${and(includeMinimized ? undefined : isNull(table.redactedAt), or(owned, unknown), after ? gt(table.id, after) : undefined)} order by ${table.id} limit 500`);
      refs.push(...rows.map(row => ({ kind, id: row.id, requiresReview: !row.owned })));
      if (rows.length < 500) break;
      after = rows.at(-1)!.id;
    }
  }
  return refs;
}
async function resolvedRefs(tx: Tx, refs: CapturedRef[], contactId: string): Promise<{ ready: MailRecordRef[]; awaitingReview: CapturedRef[] }> {
  const identity = await contactPrivacyIdentity(tx, contactId), ready: MailRecordRef[] = [], awaitingReview: CapturedRef[] = [];
  for (const ref of refs) {
    const record = await lockMailRecord(tx, ref.kind, ref.id);
    if (!record) throw new Error("The original captured mail record is missing. Restore its exact backup before acknowledging erasure.");
    // Another authorized retention run can finish the personal-field work;
    // recognizing that fact does not assign historical ownership to anyone.
    if (record.redactedAt) { ready.push(ref); continue; }
    if (ref.requiresReview) {
      const reviewed = await tx.select({ contactId: mailRecordSubjects.contactId }).from(mailRecordSubjects).where(and(eq(mailRecordSubjects.kind, ref.kind), eq(mailRecordSubjects.recordId, ref.id), eq(mailRecordSubjects.basis, "owner_review")));
      if (!reviewed.length || reviewed.some(row => !row.contactId)) { awaitingReview.push(ref); continue; }
      if (!reviewed.some(row => identity.contactIds.includes(row.contactId!))) continue;
      if (reviewed.some(row => !identity.contactIds.includes(row.contactId!))) { awaitingReview.push(ref); continue; }
    }
    // An explicit review identifying another person is evidence to leave that
    // person's record alone. Today's address match is never such evidence.
    if (ref.kind === "suppression") {
      const [current] = await tx.select({ sourceEventId: mailSuppressions.sourceEventId }).from(mailSuppressions).where(eq(mailSuppressions.id, ref.id)).limit(1);
      if (current?.sourceEventId) {
        const owners = await tx.select({ contactId: mailRecordSubjects.contactId }).from(mailRecordSubjects).where(and(eq(mailRecordSubjects.kind, "event"), eq(mailRecordSubjects.recordId, current.sourceEventId)));
        if (!owners.length || owners.some(row => !row.contactId)) { awaitingReview.push(ref); continue; }
        if (!owners.some(row => identity.contactIds.includes(row.contactId!))) continue;
        if (owners.some(row => !identity.contactIds.includes(row.contactId!))) { awaitingReview.push(ref); continue; }
      }
    }
    ready.push(ref);
  }
  return { ready, awaitingReview };
}

registerContactPrivacySource({
  scope: MAIL_RECORDS_SCOPE,
  tables: ["mail_deliveries", "mail_provider_events", "mail_suppressions", "mail_record_subjects", "mail_dispatch_requests", "mail_dispatches", "mail_legacy_resolutions"],
  eraseOrder: 20,
  retain: tx => fenceLegacyWriters(tx),
  exportData: async (tx, contactId) => {
    const refs = await capture(tx, contactId, true), owned = refs.filter(ref => !ref.requiresReview);
    const ids = (kind: MailRecordRef["kind"]) => owned.filter(ref => ref.kind === kind).map(ref => ref.id);
    const ownEvents = new Set(ids("event"));
    return {
      deliveries: await readChunks(ids("delivery"), async chunk => (await tx.select().from(mailDeliveries).where(inArray(mailDeliveries.id, chunk))).map(row => row.redactedAt ? { id: row.id, status: row.status, provider: row.provider, purpose: row.purpose, redactedAt: row.redactedAt } : publicMailDelivery(row))),
      physicalDispatches: await readChunks(ids("delivery"), async chunk => (await tx.select({ id: mailDispatches.id, deliveryId: mailDispatches.deliveryId, attempt: mailDispatches.attempt, state: mailDispatches.state, providerRef: mailDispatches.providerRef, replyProviderRef: mailDispatches.replyProviderRef, resolutionSource: mailDispatches.resolutionSource, createdAt: mailDispatches.createdAt, finishedAt: mailDispatches.finishedAt, redactedAt: mailDispatches.redactedAt }).from(mailDispatches).where(inArray(mailDispatches.deliveryId, chunk))).map(row => row.redactedAt ? { id: row.id, deliveryId: row.deliveryId, attempt: row.attempt, state: row.state, resolutionSource: row.resolutionSource, createdAt: row.createdAt, finishedAt: row.finishedAt, redactedAt: row.redactedAt } : row)),
      legacyResolutions: await readChunks(ids("delivery"), async chunk => (await tx.select({ deliveryId: mailLegacyResolutions.deliveryId, outcome: mailLegacyResolutions.outcome, providerRef: mailLegacyResolutions.providerRef, createdAt: mailLegacyResolutions.createdAt, redactedAt: mailLegacyResolutions.redactedAt }).from(mailLegacyResolutions).where(inArray(mailLegacyResolutions.deliveryId, chunk))).map(row => row.redactedAt ? { deliveryId: row.deliveryId, outcome: row.outcome, createdAt: row.createdAt, redactedAt: row.redactedAt } : row)),
      events: await readChunks(ids("event"), async chunk => (await tx.select({ id: mailProviderEvents.id, provider: mailProviderEvents.provider, recipient: mailProviderEvents.recipient, eventType: mailProviderEvents.eventType, detail: mailProviderEvents.detail, occurredAt: mailProviderEvents.occurredAt, redactedAt: mailProviderEvents.redactedAt }).from(mailProviderEvents).where(inArray(mailProviderEvents.id, chunk))).map(row => row.redactedAt ? { id: row.id, provider: row.provider, eventType: row.eventType, occurredAt: row.occurredAt, redactedAt: row.redactedAt } : row)),
      suppressions: await readChunks(ids("suppression"), async chunk => (await tx.select().from(mailSuppressions).where(inArray(mailSuppressions.id, chunk))).map(row => row.sourceEventId && !ownEvents.has(row.sourceEventId)
        ? { id: row.id, status: "retained", redactedAt: row.redactedAt }
        : row.redactedAt ? { id: row.id, active: row.active, reason: row.reason, provider: row.provider, releasedAt: row.releasedAt, redactedAt: row.redactedAt } : publicMailSuppression(row))),
      ownershipReviewRequired: refs.filter(ref => ref.requiresReview).length,
    };
  },
  erase: async (tx, contactId, context) => {
    await fenceLegacyWriters(tx);
    const refs = await capture(tx, contactId);
    if (!refs.length) return { affected: 0 };
    const scoped = await resolvedRefs(tx, refs, contactId);
    const result = await minimizeMailRecordsInTransaction(tx, scoped.ready, { cancelUnsent: true });
    const pending = refs.filter(ref => scoped.awaitingReview.some(row => row.kind === ref.kind && row.id === ref.id) || result.pending.some(row => row.kind === ref.kind && row.id === ref.id));
    const pendingJobs: string[] = [];
    for (let offset = 0; offset < pending.length; offset += 500) {
      const originalJobId = randomUUID();
      const job = await enqueueJob(tx, MAIL_RECORD_ERASURE_JOB, { requestId: context.requestId, originalJobId, refs: pending.slice(offset, offset + 500) }, { id: originalJobId, idempotencyKey: `mail-record-erasure:${context.requestId}:${offset}` });
      pendingJobs.push(job.id);
    }
    return { affected: refs.length, pendingJobs };
  },
});

export async function eraseMailRecords(data: Record<string, unknown>): Promise<{ redacted: number }> {
  const input = erasurePayload.parse(data);
  const result = await db().transaction(async tx => {
    const [request] = await tx.select({ contactId: dataRequests.contactId }).from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1);
    if (!request) throw new Error("The original mail erasure request is unavailable.");
    const [artifact] = await tx.select({ body: dataRequestArtifacts.body }).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).limit(1);
    const receipt = receiptSchema.safeParse(artifact?.body);
    if (!receipt.success) throw new Error("The original mail erasure receipt is unavailable. Restore its exact backup before retrying.");
    const outcome = receipt.data.outcomes.find(row => row.scope === MAIL_RECORDS_SCOPE);
    if (!outcome) throw new Error("The original mail erasure scope is unavailable.");
    if (outcome.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return { redacted: 0, pending: [] as MailRecordRef[], reviewPending: false, alreadyHandled: true };
    await fenceLegacyWriters(tx);
    const scoped = await resolvedRefs(tx, input.refs, request.contactId), refs = scoped.ready;
    const result = { ...await minimizeMailRecordsInTransaction(tx, refs, { cancelUnsent: true }), reviewPending: scoped.awaitingReview.length > 0, alreadyHandled: false };
    const deliveries = refs.filter(ref => ref.kind === "delivery").map(ref => ref.id);
    if (deliveries.length) {
      // The delivery lock/minimized marker makes later callbacks minimal at
      // insertion. Cover callbacks which arrived after the original snapshot
      // but before that lock, without broadening to unrelated future sends.
      const events = await tx.select({ id: mailProviderEvents.id }).from(mailProviderEvents).where(and(inArray(mailProviderEvents.deliveryId, deliveries), isNull(mailProviderEvents.redactedAt)));
      const allEventIds = await tx.select({ id: mailProviderEvents.id }).from(mailProviderEvents).where(inArray(mailProviderEvents.deliveryId, deliveries));
      const suppressions = allEventIds.length ? await tx.select({ id: mailSuppressions.id }).from(mailSuppressions).where(and(inArray(mailSuppressions.sourceEventId, allEventIds.map(row => row.id)), isNull(mailSuppressions.redactedAt))) : [];
      const children = await minimizeMailRecordsInTransaction(tx, [...events.map(row => ({ kind: "event" as const, id: row.id })), ...suppressions.map(row => ({ kind: "suppression" as const, id: row.id }))], { cancelUnsent: true });
      result.redacted += children.redacted;
      result.pending.push(...children.pending);
    }
    return result;
  });
  if (result.alreadyHandled) return { redacted: 0 };
  if (result.reviewPending) throw new Error("Historical mail ownership or its current fact needs verified review before erasure can complete.");
  if (result.pending.length) throw new Error("Unresolved mail delivery or a named hold keeps this erasure receipt pending.");
  await completeErasureJob.call({ requestId: input.requestId, scope: MAIL_RECORDS_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return { redacted: result.redacted };
}
