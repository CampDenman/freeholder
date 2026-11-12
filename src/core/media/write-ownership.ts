// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: merge changes pointers, never original physical evidence.
import { createHash } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { ServiceError, type Tx } from "@/core/service";
import { allowMediaReceiptWrites } from "./write-ledger";
import { mediaObjectWrites } from "./write-schema";

const pointer = z.object({ id: z.uuid(), contactId: z.uuid().nullable(), witness: z.string().length(64) });
async function capture(tx: Tx, ids: string[]) {
  const rows = await tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.contactId, ids))
    .orderBy(asc(mediaObjectWrites.id)).limit(5_001).for("update");
  if (rows.length > 5_000) return { state: [], undoable: false, blocker: "Media operation ownership exceeds the bounded merge-undo witness." };
  return { state: rows.map(({ contactId, ...evidence }) => ({ id: evidence.id, contactId,
    witness: createHash("sha256").update(JSON.stringify(evidence)).digest("hex") })), undoable: true };
}
registerContactReference({
  table: "media_object_writes",
  captureForUndo: (tx, duplicateId, survivingId) => capture(tx, [duplicateId, survivingId]),
  repoint: async (tx, duplicateId, survivingId) => {
    await allowMediaReceiptWrites(tx);
    await tx.update(mediaObjectWrites).set({ contactId: survivingId }).where(eq(mediaObjectWrites.contactId, duplicateId));
  },
  restoreAfterUndo: async (tx, beforeValue, afterValue, duplicateId, survivingId) => {
    const before = pointer.array().parse(beforeValue), after = pointer.array().parse(afterValue);
    const current = await capture(tx, [duplicateId, survivingId]);
    if (!current.undoable || JSON.stringify(current.state) !== JSON.stringify(after)) throw new ServiceError("conflict", "Media operation evidence changed after the merge. Review it before undoing this merge.");
    await allowMediaReceiptWrites(tx);
    for (const row of before) await tx.update(mediaObjectWrites).set({ contactId: row.contactId }).where(eq(mediaObjectWrites.id, row.id));
  },
});
