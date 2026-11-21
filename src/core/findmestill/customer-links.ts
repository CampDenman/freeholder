// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { ServiceError, type Tx } from "@/core/service";
import { findMeStillContactId } from "./discovery";
import { findMeStillCustomerLinks } from "./schema";

const linkRows = z.array(z.object({ identity: findMeStillContactId, contactId: z.uuid() }));
const table = "findmestill_customer_links";
const linkedPair = (tx: Tx, duplicateId: string, survivingId: string) =>
  tx.select().from(findMeStillCustomerLinks)
    .where(inArray(findMeStillCustomerLinks.contactId, [duplicateId, survivingId]))
    .orderBy(asc(findMeStillCustomerLinks.identity));

registerContactReference({
  table,
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await linkedPair(tx, duplicateId, survivingId), undoable: true,
  }),
  repoint: (tx, duplicateId, survivingId) => tx.update(findMeStillCustomerLinks)
    .set({ contactId: survivingId }).where(eq(findMeStillCustomerLinks.contactId, duplicateId)),
  restoreAfterUndo: async (tx, before, after, duplicateId, survivingId) => {
    const current = await linkedPair(tx, duplicateId, survivingId);
    const expected = linkRows.parse(after);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new ServiceError("conflict", "A FindMeStill customer link changed after this merge.");
    }
    for (const row of linkRows.parse(before)) {
      if (row.contactId === duplicateId) {
        await tx.update(findMeStillCustomerLinks).set({ contactId: duplicateId })
          .where(eq(findMeStillCustomerLinks.identity, row.identity));
      }
    }
  },
});

registerContactPrivacySource({
  scope: "contact.findmestill",
  tables: [table],
  exportData: (tx, contactId) => tx.select({ identity: findMeStillCustomerLinks.identity })
    .from(findMeStillCustomerLinks).where(eq(findMeStillCustomerLinks.contactId, contactId)),
  erase: async (tx, contactId) => {
    const rows = await tx.delete(findMeStillCustomerLinks).where(eq(findMeStillCustomerLinks.contactId, contactId))
      .returning({ identity: findMeStillCustomerLinks.identity });
    return { affected: rows.length };
  },
});
