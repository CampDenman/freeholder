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
import type { Tx } from "@/core/service";
import { mailDeliveries, mailProviderEvents, mailRecordSubjects, mailSuppressions } from "./schema";
import { MAIL_RECORDS_SCOPE, minimizeMailRecordsInTransaction, type MailRecordRef } from "./record-retention";
import { publicMailDelivery, publicMailSuppression } from "./service";
import { sealMailReceipts } from "./receipts";

export const MAIL_RECORD_ERASURE_JOB = "core.eraseMailRecords";
const refSchema = z.object({ kind: z.enum(["delivery", "event", "suppression"]), id: z.uuid(), requiresReview: z.boolean() });
const erasurePayload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), refs: z.array(refSchema).min(1).max(500) });
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
async function resolvedRefs(tx: Tx, refs: CapturedRef[], contactId: string): Promise<MailRecordRef[]> {
  const identity = await contactPrivacyIdentity(tx, contactId), result: MailRecordRef[] = [];
  for (const ref of refs) {
    if (!ref.requiresReview) { result.push(ref); continue; }
    const reviewed = await tx.select({ contactId: mailRecordSubjects.contactId }).from(mailRecordSubjects).where(and(eq(mailRecordSubjects.kind, ref.kind), eq(mailRecordSubjects.recordId, ref.id), eq(mailRecordSubjects.basis, "owner_review")));
    if (!reviewed.length || reviewed.some(row => !row.contactId)) throw new Error("Historical mail ownership requires the owner's verified review before erasure can complete.");
    if (reviewed.some(row => identity.contactIds.includes(row.contactId!))) result.push(ref);
    // An explicit review identifying another person is evidence to leave that
    // person's record alone. Today's address match is never such evidence.
  }
  return result;
}

registerContactPrivacySource({
  scope: MAIL_RECORDS_SCOPE,
  tables: ["mail_deliveries", "mail_provider_events", "mail_suppressions", "mail_record_subjects"],
  eraseOrder: 20,
  retain: tx => fenceLegacyWriters(tx),
  exportData: async (tx, contactId) => {
    const refs = await capture(tx, contactId, true), owned = refs.filter(ref => !ref.requiresReview);
    const ids = (kind: MailRecordRef["kind"]) => owned.filter(ref => ref.kind === kind).map(ref => ref.id);
    return {
      deliveries: await readChunks(ids("delivery"), async chunk => (await tx.select().from(mailDeliveries).where(inArray(mailDeliveries.id, chunk))).map(row => row.redactedAt ? { id: row.id, status: row.status, provider: row.provider, purpose: row.purpose, redactedAt: row.redactedAt } : publicMailDelivery(row))),
      events: await readChunks(ids("event"), async chunk => (await tx.select({ id: mailProviderEvents.id, provider: mailProviderEvents.provider, recipient: mailProviderEvents.recipient, eventType: mailProviderEvents.eventType, detail: mailProviderEvents.detail, occurredAt: mailProviderEvents.occurredAt, redactedAt: mailProviderEvents.redactedAt }).from(mailProviderEvents).where(inArray(mailProviderEvents.id, chunk))).map(row => row.redactedAt ? { id: row.id, provider: row.provider, eventType: row.eventType, occurredAt: row.occurredAt, redactedAt: row.redactedAt } : row)),
      suppressions: await readChunks(ids("suppression"), async chunk => (await tx.select().from(mailSuppressions).where(inArray(mailSuppressions.id, chunk))).map(row => row.redactedAt ? { id: row.id, active: row.active, reason: row.reason, provider: row.provider, releasedAt: row.releasedAt, redactedAt: row.redactedAt } : publicMailSuppression(row))),
      ownershipReviewRequired: refs.filter(ref => ref.requiresReview).length,
    };
  },
  erase: async (tx, contactId, context) => {
    await fenceLegacyWriters(tx);
    const refs = await capture(tx, contactId);
    if (!refs.length) return { affected: 0 };
    const known = refs.filter(ref => !ref.requiresReview);
    const result = await minimizeMailRecordsInTransaction(tx, known, { cancelUnsent: true });
    const pending = refs.filter(ref => ref.requiresReview || result.pending.some(row => row.kind === ref.kind && row.id === ref.id));
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
    const { dataRequests } = await import("@/core/privacy/schema");
    const [request] = await tx.select({ contactId: dataRequests.contactId }).from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1);
    if (!request) throw new Error("The original mail erasure request is unavailable.");
    const refs = await resolvedRefs(tx, input.refs, request.contactId);
    const result = await minimizeMailRecordsInTransaction(tx, refs, { cancelUnsent: true });
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
  if (result.pending.length) throw new Error("Unresolved mail delivery or a named hold keeps this erasure receipt pending.");
  await completeErasureJob.call({ requestId: input.requestId, scope: MAIL_RECORDS_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return { redacted: result.redacted };
}
