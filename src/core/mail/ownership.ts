// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: explicit mail-to-spine ownership; no address-only second customer list.
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { ServiceError, type Tx } from "@/core/service";
import { mailDeliveries, mailProviderEvents, mailRecordSubjects, mailSuppressions } from "./schema";
import { mailReceipts } from "./receipts";

export type MailRecordKind = "delivery" | "event" | "suppression";
export async function lockMailRecord(tx: Tx, kind: MailRecordKind, recordId: string) {
  if (kind === "delivery") { const [row] = await tx.select().from(mailDeliveries).where(eq(mailDeliveries.id, recordId)).limit(1).for("update"); return row ? { email: row.recipient, redactedAt: row.redactedAt } : null; }
  if (kind === "event") { const [row] = await tx.select().from(mailProviderEvents).where(eq(mailProviderEvents.id, recordId)).limit(1).for("update"); return row ? { email: row.recipient, redactedAt: row.redactedAt } : null; }
  const [row] = await tx.select().from(mailSuppressions).where(eq(mailSuppressions.id, recordId)).limit(1).for("update"); return row ? { email: row.email, redactedAt: row.redactedAt } : null;
}
export async function bindMailRecord(tx: Tx, kind: MailRecordKind, recordId: string, source: { email?: string; contactId?: string; parent?: { kind: MailRecordKind; id: string } }): Promise<void> {
  await lockContactIdentityForRead(tx);
  if (!await lockMailRecord(tx, kind, recordId)) throw new ServiceError("not_found", "That mail record is not here.");
  let ids: string[];
  if (source.parent) {
    const prior = await tx.select({ contactId: mailRecordSubjects.contactId }).from(mailRecordSubjects).where(and(eq(mailRecordSubjects.kind, source.parent.kind), eq(mailRecordSubjects.recordId, source.parent.id)));
    // An old unbound delivery is not evidence that today's address owner
    // owned that historical mail. Its uncertain ownership stays explicit.
    ids = prior.flatMap(row => row.contactId ? [row.contactId] : []);
  } else if (source.contactId) {
    const [row] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, source.contactId)).limit(1);
    ids = row ? [row.id] : [];
  } else if (source.email) {
    // This path is for a newly staged delivery. Historical/provider facts
    // require their immutable parent, never a creation-date/address guess.
    if (kind !== "delivery") throw new ServiceError("conflict", "Historical mail ownership requires its original delivery or verified review.");
    const rows = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, source.email.trim().toLowerCase())).limit(1);
    ids = rows.map(row => row.id);
  } else ids = [];
  const existing = await tx.select({ contactId: mailRecordSubjects.contactId }).from(mailRecordSubjects).where(and(eq(mailRecordSubjects.kind, kind), eq(mailRecordSubjects.recordId, recordId)));
  const present = new Set(existing.map(row => row.contactId));
  const added = [...new Set(ids)].filter(id => !present.has(id));
  if (added.length) await tx.insert(mailRecordSubjects).values(added.map(contactId => ({ kind, recordId, contactId })));
}

const pointer = z.object({ id: z.uuid(), kind: z.enum(["delivery", "event", "suppression"]), recordId: z.uuid(), contactId: z.uuid().nullable(), basis: z.enum(["automatic", "owner_review"]), evidenceDigest: z.string().nullable(), verifiedBy: z.uuid().nullable(), createdAt: z.coerce.date() });
async function capture(tx: Tx, ids: string[]) {
  const rows = await tx.select().from(mailRecordSubjects).where(inArray(mailRecordSubjects.contactId, ids)).orderBy(asc(mailRecordSubjects.id)).limit(5_001).for("update");
  return rows.length > 5_000 ? { state: [], undoable: false, blocker: "Mail ownership exceeds the bounded merge-undo snapshot; its complete ownership is still repointed." } : { state: rows, undoable: true };
}
registerContactReference({
  table: "mail_record_subjects",
  captureForUndo: (tx, duplicateId, survivingId) => capture(tx, [duplicateId, survivingId]),
  repoint: async (tx, duplicateId, survivingId) => {
    await mailReceipts(tx);
    await tx.update(mailRecordSubjects).set({ contactId: survivingId }).where(eq(mailRecordSubjects.contactId, duplicateId));
  },
  restoreAfterUndo: async (tx, beforeValue, afterValue, duplicateId, survivingId) => {
    await mailReceipts(tx);
    const before = pointer.array().parse(beforeValue), after = pointer.array().parse(afterValue);
    const current = await capture(tx, [duplicateId, survivingId]);
    if (!current.undoable || JSON.stringify(current.state) !== JSON.stringify(after)) throw new ServiceError("conflict", "Mail ownership changed after the merge. Keep the merge or review those records before undoing it.");
    await tx.delete(mailRecordSubjects).where(inArray(mailRecordSubjects.contactId, [duplicateId, survivingId]));
    if (before.length) await tx.insert(mailRecordSubjects).values(before);
  },
});
