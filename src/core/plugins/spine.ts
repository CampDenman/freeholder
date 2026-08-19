// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared merge + privacy wiring for a plugin table that hangs off contact_id.
import { eq, inArray } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { ServiceError, type Tx } from "@/core/service";

type ContactTable = PgTable & {
  id: AnyPgColumn;
  contactId: AnyPgColumn;
};

export function attachPluginContactColumn(options: {
  table: string;
  schema: ContactTable;
  label: string;
  scope: string;
}): void {
  const { schema, table, label, scope } = options;
  registerContactReference({
    table,
    repoint: (tx, duplicateId, survivingId) =>
      tx
        .update(schema)
        .set({ contactId: survivingId })
        .where(eq(schema.contactId, duplicateId)),
    captureForUndo: async (tx, duplicateId, survivingId) => ({
      state: await tx
        .select({ id: schema.id, contactId: schema.contactId })
        .from(schema)
        .where(inArray(schema.contactId, [duplicateId, survivingId])),
      undoable: true,
    }),
    restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
      const pointer = z.array(
        z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
      );
      const before = pointer.parse(beforeState);
      const after = pointer.parse(afterState);
      const current = after.length
        ? await tx
            .select({ id: schema.id, contactId: schema.contactId })
            .from(schema)
            .where(inArray(schema.id, after.map((row) => row.id)))
        : [];
      const byId = new Map(current.map((row) => [String(row.id), row.contactId]));
      if (
        current.length !== after.length ||
        after.some((row) => byId.get(row.id) !== row.contactId)
      ) {
        throw new ServiceError(
          "conflict",
          `${label} changed after this merge. Leave the merge in place or restore that record first.`,
        );
      }
      const moved = before.filter((row) => row.contactId === duplicateId);
      if (moved.length) {
        await tx
          .update(schema)
          .set({ contactId: duplicateId })
          .where(inArray(schema.id, moved.map((row) => row.id)));
      }
    },
  });

  registerContactPrivacySource({
    scope,
    tables: [table],
    exportData: (tx: Tx, contactId: string) =>
      tx.select().from(schema).where(eq(schema.contactId, contactId)),
    erase: async (tx: Tx, contactId: string) => {
      const rows = await tx
        .delete(schema)
        .where(eq(schema.contactId, contactId))
        .returning({ id: schema.id });
      return { affected: rows.length };
    },
  });
}
