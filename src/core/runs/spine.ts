// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a contact merge and an erasure mean for a run (MASTER.md §4.1, C9.02).
//
// `runs.contact_id` arrived with the automation runtime: a run is often about
// somebody, and the guardrails in C9.03 need to know who before they can check
// consent or quiet hours. A `contact_id` column carries obligations, and this
// file is where `core/runs` meets them rather than leaving them to whichever
// module happened to start the run.
//
// The merge-completeness gate is what made this file exist rather than a good
// intention: it failed the moment the column landed without a repoint, which
// is the whole argument for having a gate that reflects over the schema.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { runs } from "./schema";

registerContactReference({
  table: "runs",
  // No collision to resolve: a run belongs to one contact and nothing here is
  // unique per contact, so a merge is a plain repoint. Both people's runs
  // survive and both remain readable, which is right — each really happened.
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(runs).set({ contactId: survivingId }).where(eq(runs.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx.update(runs).set({ contactId: duplicateId }).where(eq(runs.id, each.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.runs",
  tables: ["runs"],
  exportData: async (tx, contactId) => ({
    runs: await tx
      .select({
        id: runs.id,
        subjectKind: runs.subjectKind,
        subjectId: runs.subjectId,
        status: runs.status,
        stopReason: runs.stopReason,
        startedAt: runs.startedAt,
        endedAt: runs.endedAt,
      })
      .from(runs)
      .where(eq(runs.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // The run survives with its person removed, exactly as an attribution
    // touch does. That an automation ran on the 4th is the business's own
    // record — it explains a note, a task, an email somebody received — while
    // *whose* run it was belongs to the person. Deleting the row would leave
    // the effects with nothing that explains them.
    const cleared = await tx
      .update(runs)
      .set({ contactId: null })
      .where(eq(runs.contactId, contactId))
      .returning({ id: runs.id });
    return { affected: cleared.length };
  },
});
