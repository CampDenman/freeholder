// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a merge means for this module's tables.
//
// Core cannot import a module's schema (§11), so the two `contact_id` columns
// this module adds declare their own repoint here, and `merge-completeness`
// fails the build if they do not. Neither table has a uniqueness constraint
// involving the contact, so a merge is an unconditional repoint: two people
// turning out to be one person means one person who tracks both lists and was
// warned about both charges.
//
// The write surface (add, edit, archive a tracked subscription) and the
// in-tree dashboard and settings screens are deliberately NOT here yet — see
// the module README note in `manifest.ts`. This increment is the register, the
// look-ahead and the message.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { renewalAlerts, trackedSubscriptions } from "./schema";

registerContactReference({
  table: "tracked_subscriptions",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(trackedSubscriptions)
      .set({ contactId: survivingId })
      .where(eq(trackedSubscriptions.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: trackedSubscriptions.id, contactId: trackedSubscriptions.contactId })
      .from(trackedSubscriptions)
      .where(inArray(trackedSubscriptions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, before, after, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
      .parse(before)
      .filter((row) => row.contactId === duplicateId);
    void after;
    if (moved.length) {
      await tx
        .update(trackedSubscriptions)
        .set({ contactId: duplicateId })
        .where(inArray(trackedSubscriptions.id, moved.map((row) => row.id)));
    }
  },
});

registerContactReference({
  table: "renewal_alerts",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(renewalAlerts)
      .set({ contactId: survivingId })
      .where(eq(renewalAlerts.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: renewalAlerts.id, contactId: renewalAlerts.contactId })
      .from(renewalAlerts)
      .where(inArray(renewalAlerts.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, before, after, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
      .parse(before)
      .filter((row) => row.contactId === duplicateId);
    void after;
    if (moved.length) {
      await tx
        .update(renewalAlerts)
        .set({ contactId: duplicateId })
        .where(inArray(renewalAlerts.id, moved.map((row) => row.id)));
    }
  },
});

/**
 * Export and erasure for the two tables.
 *
 * Erasure here **deletes**, where `reviews` anonymises — and the contrast is
 * the point. A public rating survives its reviewer because the business's
 * rating is not the reviewer's personal data to withdraw. Nothing in this
 * module is like that. A list of what someone pays for, when, and how much is
 * personal data end to end; there is no aggregate anyone else is entitled to
 * and nothing left worth keeping once the person is gone. Anonymising a
 * subscription register would leave a de-identified record of one household's
 * spending, which is both useless to us and exactly the kind of residue
 * erasure is supposed to remove.
 *
 * (A "top tracked services" aggregate over a small register is not an
 * aggregate at all: at a handful of rows with a count of one each it is an
 * itemised list of one person's subscriptions. That is the failure this
 * decision avoids repeating at the storage layer.)
 */
registerContactPrivacySource({
  scope: "contact.renewalAlerts",
  tables: ["tracked_subscriptions", "renewal_alerts"],
  exportData: async (tx, contactId) => ({
    trackedSubscriptions: await tx
      .select()
      .from(trackedSubscriptions)
      .where(eq(trackedSubscriptions.contactId, contactId)),
    alerts: await tx
      .select()
      .from(renewalAlerts)
      .where(eq(renewalAlerts.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // Alerts first: they reference the subscriptions, and being explicit here
    // means the order does not depend on a cascade staying as it is today.
    const alerts = await tx
      .delete(renewalAlerts)
      .where(eq(renewalAlerts.contactId, contactId))
      .returning({ id: renewalAlerts.id });
    const tracked = await tx
      .delete(trackedSubscriptions)
      .where(eq(trackedSubscriptions.contactId, contactId))
      .returning({ id: trackedSubscriptions.id });
    return { affected: alerts.length + tracked.length };
  },
});

export { RENEWAL_CYCLES } from "./schema";

export default [];
