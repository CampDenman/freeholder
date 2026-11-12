// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: hold authority and original snapshots commit together.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { timelineEvents } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { privacyRetentionExceptions } from "@/core/privacy/schema";
import { addRetentionException, createDataRequest, registerContactPrivacySource } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("documented original retention snapshots", () => {
  const direct = "tests.retentionSnapshot", parent = "tests.retentionSnapshotParent", unrelated = "tests.retentionUnrelated";
  const eventType = "tests.retentionCaptured";
  let failScope: string | undefined;
  beforeAll(async () => {
    await ready();
    for (const scope of [direct, parent, unrelated]) {
      registerContactPrivacySource({
        scope, tables: [], retentionScopes: scope === parent ? [direct] : [], exportData: async () => [], erase: async () => ({ affected: 0 }),
        retain: async () => { throw new Error("Fulfillment-only retention must not run when documenting a hold."); },
        captureRetention: async (tx, contactId, context) => {
          // Visibility of the actual inserted hold and the timeline's rollback
          // behavior prove composition through the real parent transaction.
          const [hold] = await tx.select().from(privacyRetentionExceptions).where(eq(privacyRetentionExceptions.id, context.exceptionId));
          expect(hold).toMatchObject({ dataRequestId: context.requestId, scope: direct });
          await context.service.emitTimeline({ contactId, eventType, subjectType: "retentionException", subjectId: context.exceptionId,
            payload: { scope, requestId: context.requestId, isNew: context.isNew } });
          if (failScope === scope) throw new Error("Synthetic original snapshot failure");
        },
      });
    }
  }, 60_000);
  beforeEach(async () => { failScope = undefined; await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, email: "snapshot-owner@example.test", role: "owner" }); });
  afterAll(closeDb);
  async function pending() {
    const contact = await createContact.call({ name: "Original held subject", email: "snapshot-subject@example.test" }, OWNER);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    expect(request.status).toBe("submitted");
    return { contact, request, input: { dataRequestId: request.id, scope: direct, reason: "legal_obligation" as const, legalBasis: "Synthetic exact original evidence must be preserved." } };
  }
  const snapshots = () => db().select().from(timelineEvents).where(eq(timelineEvents.eventType, eventType)).orderBy(timelineEvents.id);

  it("captures direct and inherited original scopes before verification and distinguishes updates", async () => {
    const { contact, request, input } = await pending();
    const first = await addRetentionException.call(input, OWNER);
    const changed = await addRetentionException.call({ ...input, legalBasis: "Synthetic continuing original evidence obligation." }, OWNER);
    expect(changed.id).toBe(first.id);
    const rows = await snapshots();
    expect(rows).toHaveLength(4);
    for (const scope of [direct, parent]) {
      expect(rows.filter(row => (row.payload as { scope: string }).scope === scope).map(row => (row.payload as { isNew: boolean }).isNew).sort()).toEqual([false, true]);
    }
    expect(rows.every(row => row.actor === `user:${OWNER.userId}` && row.contactId === contact.id && row.subjectId === first.id && (row.payload as { requestId: string }).requestId === request.id)).toBe(true);
    expect(await db().select().from(privacyRetentionExceptions)).toHaveLength(1);
  });
  it("rolls back both a new hold and earlier snapshot effects if an inherited source fails", async () => {
    const { input } = await pending();
    failScope = parent;
    await expect(addRetentionException.call(input, OWNER)).rejects.toThrow("Synthetic original snapshot failure");
    expect(await db().select().from(privacyRetentionExceptions)).toHaveLength(0);
    expect(await snapshots()).toHaveLength(0);
    failScope = undefined;
    await addRetentionException.call(input, OWNER);
    expect((await snapshots()).every(row => (row.payload as { isNew: boolean }).isNew)).toBe(true);
  });
  it("keeps the prior hold and original snapshot intact when an update fails", async () => {
    const { input } = await pending();
    const first = await addRetentionException.call(input, OWNER);
    const before = await snapshots();
    failScope = parent;
    await expect(addRetentionException.call({ ...input, legalBasis: "Synthetic replacement that must roll back." }, OWNER)).rejects.toThrow("Synthetic original snapshot failure");
    expect((await db().select().from(privacyRetentionExceptions).where(eq(privacyRetentionExceptions.id, first.id)))[0]).toEqual(first);
    expect(await snapshots()).toEqual(before);
  });
});
