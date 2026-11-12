// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29: shared merge/undo and privacy own the source receipt, without bodies.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { contactPrivacyIdentity } from "@/core/privacy/contact-identity";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { ServiceError, type Tx } from "@/core/service";
import { markReaderOwnershipWriter, readerOwnershipKey } from "./reader-ownership-key";
import { readerOwnershipMergeWitnesses, readerOwnershipReceipts } from "./reader-ownership-schema";

const snapshot = z.object({ witnessId: z.uuid(), phase: z.enum(["captured", "applied"]) });
const captures = new WeakMap<object, Map<string, z.infer<typeof snapshot>>>();
registerContactReference({
  table: "import_reader_ownership_receipts",
  repoint: async (tx, duplicateId, survivingId) => {
    await markReaderOwnershipWriter(tx);
    await tx.update(readerOwnershipReceipts).set({ contactId: survivingId, updatedAt: new Date() }).where(eq(readerOwnershipReceipts.contactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    await markReaderOwnershipWriter(tx);
    const pair = JSON.stringify([duplicateId, survivingId]);
    let transaction = captures.get(tx);
    if (!transaction) { transaction = new Map(); captures.set(tx, transaction); }
    const previous = transaction.get(pair);
    if (!previous) {
      const witnessId = randomUUID();
      await tx.insert(readerOwnershipMergeWitnesses).values({ id: witnessId, duplicateSubjectId: duplicateId, survivingSubjectId: survivingId, phase: "captured" });
      await tx.execute(sql`insert into import_reader_merge_items(witness_id,receipt_id,before_contact_id,before_state)
        select ${witnessId}::uuid,id,contact_id,state from import_reader_ownership_receipts where contact_id in (${duplicateId}::uuid,${survivingId}::uuid)`);
      const state = { witnessId, phase: "captured" as const };
      transaction.set(pair, state);
      return { state, undoable: true };
    }
    await tx.execute(sql`update import_reader_merge_items item set after_contact_id=receipt.contact_id,after_state=receipt.state
      from import_reader_ownership_receipts receipt where item.witness_id=${previous.witnessId}::uuid and item.receipt_id=receipt.id`);
    await tx.update(readerOwnershipMergeWitnesses).set({ phase: "applied" }).where(eq(readerOwnershipMergeWitnesses.id, previous.witnessId));
    const state = { witnessId: previous.witnessId, phase: "applied" as const };
    transaction.set(pair, state);
    return { state, undoable: true };
  },
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId, survivingId) => {
    await markReaderOwnershipWriter(tx);
    const before = snapshot.parse(beforeState), after = snapshot.parse(afterState);
    if (before.witnessId !== after.witnessId || before.phase !== "captured" || after.phase !== "applied") throw new ServiceError("conflict", "The original reader merge witness is unavailable.");
    const [witness] = await tx.select().from(readerOwnershipMergeWitnesses).where(eq(readerOwnershipMergeWitnesses.id, before.witnessId)).limit(1);
    if (!witness || witness.phase !== "applied" || witness.duplicateSubjectId !== duplicateId || witness.survivingSubjectId !== survivingId) throw new ServiceError("conflict", "The original reader merge witness no longer matches this operation.");
    const [check] = await tx.execute<{ changed: boolean }>(sql`select
      exists(select 1 from import_reader_merge_items item left join import_reader_ownership_receipts receipt on receipt.id=item.receipt_id
        where item.witness_id=${before.witnessId}::uuid and (receipt.id is null or receipt.contact_id is distinct from item.after_contact_id or receipt.state is distinct from item.after_state))
      or exists(select 1 from import_reader_ownership_receipts receipt where receipt.contact_id in (${duplicateId}::uuid,${survivingId}::uuid)
        and not exists(select 1 from import_reader_merge_items item where item.witness_id=${before.witnessId}::uuid and item.receipt_id=receipt.id)) as changed`);
    if (check?.changed !== false) throw new ServiceError("conflict", "Reader ownership changed after this merge. Review those source identities before undoing it.");
    await tx.execute(sql`update import_reader_ownership_receipts receipt set contact_id=item.before_contact_id,state=item.before_state,updated_at=clock_timestamp()
      from import_reader_merge_items item where item.witness_id=${before.witnessId}::uuid and item.receipt_id=receipt.id`);
  },
});

async function ownedIds(tx: Tx, contactId: string) { return (await contactPrivacyIdentity(tx, contactId)).contactIds; }
async function retireReaderSources(tx: Tx, contactId: string, requestId: string) {
  const [present] = await tx.select({ id: readerOwnershipReceipts.id }).from(readerOwnershipReceipts).limit(1);
  if (!present) return { affected: 0 };
  const identity = await contactPrivacyIdentity(tx, contactId), key = await readerOwnershipKey(tx);
  const addresses = identity.emails.map(address => key.digest("address", address));
  const rows = await tx.update(readerOwnershipReceipts).set({ state: "erased", retirementRequestId: sql`coalesce(${readerOwnershipReceipts.retirementRequestId},${requestId}::uuid)`, updatedAt: new Date() }).where(or(
    inArray(readerOwnershipReceipts.contactId, identity.contactIds),
    // An originally unknown owner remains unknown. The privacy request
    // retires that source by its recorded address, without inventing an owner
    // or rebinding an already-proved different person after address reuse.
    addresses.length ? and(isNull(readerOwnershipReceipts.contactId), inArray(readerOwnershipReceipts.state, ["unbound", "review"]), inArray(readerOwnershipReceipts.addressDigest, addresses)) : sql`false`,
  )).returning({ id: readerOwnershipReceipts.id });
  return { affected: rows.length };
}
registerContactPrivacySource({
  scope: "imports.readerOwnership",
  tables: ["import_reader_ownership_receipts", "import_reader_merge_witnesses", "import_reader_merge_items"],
  retentionScopes: ["cms.readerComments", "imports.readerSources"], eraseOrder: 11,
  retain: async (tx, contactId, context) => {
    // A hold preserves every original witness field. Its privacy fence still
    // prevents a later source from using the held record as fresh authority.
    await retireReaderSources(tx, contactId, context.requestId);
  },
  exportData: async (tx, contactId) => {
    const ids = await ownedIds(tx, contactId);
    return tx.select({ id: readerOwnershipReceipts.id, sourceDigest: readerOwnershipReceipts.sourceDigest, addressDigest: readerOwnershipReceipts.addressDigest, state: readerOwnershipReceipts.state, retirementRequestId: readerOwnershipReceipts.retirementRequestId, createdAt: readerOwnershipReceipts.createdAt }).from(readerOwnershipReceipts).leftJoin(dataRequests, eq(dataRequests.id, readerOwnershipReceipts.retirementRequestId)).where(or(inArray(readerOwnershipReceipts.contactId, ids), inArray(dataRequests.contactId, ids)));
  },
  erase: (tx, contactId, context) => retireReaderSources(tx, contactId, context.requestId),
});
