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
    restoreAfterUndo: (tx, beforeState, afterState, duplicateId) =>
      restorePluginContactPointers(tx, schema, label, beforeState, afterState, duplicateId),
  });

  registerPluginContactPrivacy(schema, table, scope);
}

/**
 * Unique (parent, contact) rows — a membership, a join. Blind UPDATE contact_id
 * aborts the merge when both people already sit on the same parent; keep the
 * survivor's row and drop the duplicate's.
 */
export function attachPluginUniqueContactColumn(options: {
  table: string;
  schema: ContactTable;
  parent: AnyPgColumn;
  label: string;
  scope: string;
}): void {
  const { schema, table, parent, label, scope } = options;
  registerContactReference({
    table,
    repoint: async (tx, duplicateId, survivingId) => {
      const survivorRows = await tx
        .select({ parentId: parent })
        .from(schema)
        .where(eq(schema.contactId, survivingId));
      const taken = new Set(survivorRows.map((row) => String(row.parentId)));
      const duplicateRows = await tx
        .select({ id: schema.id, parentId: parent })
        .from(schema)
        .where(eq(schema.contactId, duplicateId));
      const drop = duplicateRows
        .filter((row) => taken.has(String(row.parentId)))
        .map((row) => String(row.id));
      const move = duplicateRows
        .filter((row) => !taken.has(String(row.parentId)))
        .map((row) => String(row.id));
      if (drop.length) {
        await tx.delete(schema).where(inArray(schema.id, drop));
      }
      if (move.length) {
        await tx
          .update(schema)
          .set({ contactId: survivingId })
          .where(inArray(schema.id, move));
      }
    },
    captureForUndo: async (tx, duplicateId, survivingId) => {
      const rows = await tx
        .select({ id: schema.id, parentId: parent, contactId: schema.contactId })
        .from(schema)
        .where(inArray(schema.contactId, [duplicateId, survivingId]));
      const survivorParents = new Set(
        rows
          .filter((row) => row.contactId === survivingId)
          .map((row) => String(row.parentId)),
      );
      const collisions = rows.some(
        (row) => row.contactId === duplicateId && survivorParents.has(String(row.parentId)),
      );
      return {
        state: rows.map((row) => ({ id: row.id, contactId: row.contactId })),
        undoable: !collisions,
        blocker: collisions
          ? `${label} for the same record cannot be split back out after a merge.`
          : undefined,
      };
    },
    restoreAfterUndo: (tx, beforeState, afterState, duplicateId) =>
      restorePluginContactPointers(tx, schema, label, beforeState, afterState, duplicateId),
  });

  registerPluginContactPrivacy(schema, table, scope);
}

function registerPluginContactPrivacy(schema: ContactTable, table: string, scope: string): void {
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

async function restorePluginContactPointers(
  tx: Tx,
  schema: ContactTable,
  label: string,
  beforeState: unknown,
  afterState: unknown,
  duplicateId: string,
): Promise<void> {
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
}
