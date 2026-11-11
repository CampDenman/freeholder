// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: explicit mail-to-spine ownership; no address-only second customer list.
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { ServiceError, type Tx } from "@/core/service";
import { mailRecordSubjects } from "./schema";

export type MailRecordKind = "delivery" | "event" | "suppression";
export async function bindMailRecord(tx: Tx, kind: MailRecordKind, recordId: string, source: { email?: string; at?: Date; contactId?: string; parent?: { kind: MailRecordKind; id: string } }): Promise<void> {
  await lockContactIdentityForRead(tx);
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
    const rows = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.email, source.email.trim().toLowerCase()), lte(contacts.createdAt, source.at ?? new Date()))).limit(1);
    ids = rows.map(row => row.id);
  } else ids = [];
  if (ids.length) await tx.insert(mailRecordSubjects).values([...new Set(ids)].map(contactId => ({ kind, recordId, contactId }))).onConflictDoNothing();
}

const pointer = z.object({ id: z.uuid(), kind: z.enum(["delivery", "event", "suppression"]), recordId: z.uuid(), contactId: z.uuid().nullable(), createdAt: z.coerce.date() });
async function capture(tx: Tx, ids: string[]) {
  const rows = await tx.select().from(mailRecordSubjects).where(inArray(mailRecordSubjects.contactId, ids)).orderBy(asc(mailRecordSubjects.id)).limit(5_001).for("update");
  return rows.length > 5_000 ? { state: [], undoable: false, blocker: "Mail ownership exceeds the bounded merge-undo snapshot; its complete ownership is still repointed." } : { state: rows, undoable: true };
}
registerContactReference({
  table: "mail_record_subjects",
  captureForUndo: (tx, duplicateId, survivingId) => capture(tx, [duplicateId, survivingId]),
  repoint: async (tx, duplicateId, survivingId) => {
    await tx.execute(sql`insert into ${mailRecordSubjects}(kind,record_id,contact_id,created_at)
      select kind,record_id,${survivingId}::uuid,created_at from ${mailRecordSubjects} where contact_id=${duplicateId}::uuid
      on conflict(kind,record_id,contact_id) do nothing`);
    await tx.delete(mailRecordSubjects).where(eq(mailRecordSubjects.contactId, duplicateId));
  },
  restoreAfterUndo: async (tx, beforeValue, afterValue, duplicateId, survivingId) => {
    const before = pointer.array().parse(beforeValue), after = pointer.array().parse(afterValue);
    const current = await capture(tx, [duplicateId, survivingId]);
    if (!current.undoable || JSON.stringify(current.state) !== JSON.stringify(after)) throw new ServiceError("conflict", "Mail ownership changed after the merge. Keep the merge or review those records before undoing it.");
    await tx.delete(mailRecordSubjects).where(inArray(mailRecordSubjects.contactId, [duplicateId, survivingId]));
    if (before.length) await tx.insert(mailRecordSubjects).values(before);
  },
});
