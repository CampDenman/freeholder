// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Human-reviewed detection and conflict-safe merge undo (MASTER.md C1.07).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  dismissDuplicateCandidate,
  listContactMergeOperations,
  listDuplicateCandidates,
  mergeDuplicateCandidate,
  scanDuplicateCandidates,
} from "@/core/contacts/duplicates";
import {
  createContact,
  mergeContacts,
  undoContactMerge,
  updateContact,
} from "@/core/contacts/service";
import { createOrganization } from "@/core/contacts/organizations";
import {
  createRelationship,
  listRelationships,
} from "@/core/contacts/relationships";
import {
  contactMergeOperations,
  contacts,
  customerMagicLinks,
  mergeCandidates,
  timelineEvents,
} from "@/core/contacts/schema";
import { analyticsEvents } from "@/modules/analytics/schema";
import { forms, formSubmissions } from "@/modules/forms/schema";
// Loading the service modules registers their reversible contact references.
import "@/modules/analytics/service";
import "@/modules/forms/service";
import { db } from "@/core/db";
import {
  STAFF,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const VIEWER = {
  ...STAFF,
  grants: [{ module: "contacts", access: "view" as const }],
};

describe.runIf(hasDatabase)("contact duplicate review", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("surfaces scored reasons without ever merging automatically", async () => {
    const organization = await createOrganization.call(
      { name: "Camp Denman" },
      STAFF,
    );
    await createContact.call(
      {
        name: "Tony Aly",
        email: "tony.one@example.test",
        phone: "+1 (250) 555-0100",
        orgId: organization.id,
        country: "CA",
      },
      STAFF,
    );
    await createContact.call(
      {
        name: " tony   aly ",
        email: "tony.two@example.test",
        orgId: organization.id,
        country: "CA",
      },
      STAFF,
    );
    await createContact.call(
      { name: "Anthony", phone: "250-555-0100" },
      STAFF,
    );
    await createContact.call({ name: "Unrelated Person" }, STAFF);

    const result = await scanDuplicateCandidates.call({}, STAFF);
    expect(result.openCandidates).toBeGreaterThanOrEqual(2);
    expect(await db().select().from(contacts)).toHaveLength(4);

    const queue = await listDuplicateCandidates.call({}, VIEWER);
    const nameMatch = queue.rows.find(
      (row) => {
        const names = [row.contactAName, row.contactBName].map((name) =>
          name.trim().toLowerCase().replace(/\s+/g, " "),
        );
        return names.every((name) => name === "tony aly");
      },
    );
    expect(nameMatch).toBeDefined();
    expect(nameMatch?.score).toBe(65);
    expect(nameMatch?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "same_name", points: 45 }),
        expect.objectContaining({ code: "same_organization", points: 15 }),
        expect.objectContaining({ code: "same_country", points: 5 }),
      ]),
    );
    expect(
      queue.rows.some((row) =>
        (row.reasons as Array<{ code: string }>).some(
          (reason) => reason.code === "same_phone",
        ),
      ),
    ).toBe(true);
  });

  it("keeps a human dismissal closed across later scans", async () => {
    await createContact.call({ name: "Same Person" }, STAFF);
    await createContact.call({ name: "same person" }, STAFF);
    await scanDuplicateCandidates.call({}, STAFF);
    const [candidate] = (await listDuplicateCandidates.call({}, VIEWER)).rows;
    await dismissDuplicateCandidate.call({ id: candidate!.id }, STAFF);
    await scanDuplicateCandidates.call({}, STAFF);
    expect((await listDuplicateCandidates.call({}, VIEWER)).rows).toHaveLength(0);
    expect(
      (await listDuplicateCandidates.call({ status: "dismissed" }, VIEWER)).rows,
    ).toEqual([expect.objectContaining({ id: candidate!.id, status: "dismissed" })]);
  });

  it("merges from the queue and restores contacts plus every reversible reference", async () => {
    const survivor = await createContact.call(
      { name: "Grace Hopper", tags: ["speaker"] },
      STAFF,
    );
    const duplicate = await createContact.call(
      {
        name: "grace hopper",
        email: "grace@example.test",
        phone: "2505550199",
        tags: ["customer"],
      },
      STAFF,
    );
    const other = await createContact.call({ name: "Howard Aiken" }, STAFF);
    const [form] = await db()
      .insert(forms)
      .values({ slug: "duplicate-review", name: "Duplicate review" })
      .returning();
    const [submission] = await db()
      .insert(formSubmissions)
      .values({
        formId: form!.id,
        contactId: duplicate.id,
        data: { note: "belongs to duplicate" },
      })
      .returning();
    const [analytics] = await db()
      .insert(analyticsEvents)
      .values({
        anonId: "duplicate-anon",
        sessionId: "duplicate-session",
        contactId: duplicate.id,
        name: "page.viewed",
        path: "/duplicate",
      })
      .returning();
    const relationship = await createRelationship.call(
      {
        fromContactId: duplicate.id,
        toContactId: other.id,
        kind: "referred_by",
        notes: "Duplicate edge",
      },
      STAFF,
    );

    await scanDuplicateCandidates.call({}, STAFF);
    const [candidate] = (await listDuplicateCandidates.call({}, VIEWER)).rows;
    const merged = await mergeDuplicateCandidate.call(
      {
        candidateId: candidate!.id,
        survivingId: survivor.id,
        duplicateId: duplicate.id,
      },
      STAFF,
    );
    expect(await db().select().from(contacts)).toHaveLength(2);
    expect(merged).toMatchObject({
      id: survivor.id,
      email: "grace@example.test",
      tags: ["speaker", "customer"],
    });
    expect(
      (await db().select().from(formSubmissions).where(eq(formSubmissions.id, submission!.id)))[0]
        ?.contactId,
    ).toBe(survivor.id);
    expect(
      (await db().select().from(analyticsEvents).where(eq(analyticsEvents.id, analytics!.id)))[0]
        ?.contactId,
    ).toBe(survivor.id);

    const [operation] = await listContactMergeOperations.call({}, VIEWER);
    expect(operation).toMatchObject({
      id: merged.mergeOperationId,
      candidateId: candidate!.id,
      undoable: true,
      undoneAt: null,
    });
    await undoContactMerge.call({ operationId: operation!.id }, STAFF);

    expect(await db().select().from(contacts)).toHaveLength(3);
    expect(
      (await db().select().from(contacts).where(eq(contacts.id, survivor.id)))[0],
    ).toMatchObject({ name: "Grace Hopper", email: null, tags: ["speaker"] });
    expect(
      (await db().select().from(contacts).where(eq(contacts.id, duplicate.id)))[0],
    ).toMatchObject({
      name: "grace hopper",
      email: "grace@example.test",
      tags: ["customer"],
    });
    expect(
      (await db().select().from(formSubmissions).where(eq(formSubmissions.id, submission!.id)))[0]
        ?.contactId,
    ).toBe(duplicate.id);
    expect(
      (await db().select().from(analyticsEvents).where(eq(analyticsEvents.id, analytics!.id)))[0]
        ?.contactId,
    ).toBe(duplicate.id);
    expect((await listRelationships.call({ contactId: duplicate.id }, VIEWER))[0])
      .toMatchObject({ id: relationship.id, otherContact: { id: other.id } });
    expect(
      (await db().select().from(mergeCandidates).where(eq(mergeCandidates.id, candidate!.id)))[0],
    ).toMatchObject({
      contactAId: [survivor.id, duplicate.id].sort()[0],
      contactBId: [survivor.id, duplicate.id].sort()[1],
      status: "open",
    });
    expect(
      (await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id, operation!.id)))[0]
        ?.undoneAt,
    ).toBeInstanceOf(Date);
    expect(
      (await db().select().from(timelineEvents)).filter(
        (event) => event.eventType === "contact.mergeUndone",
      ),
    ).toHaveLength(2);
  });

  it("refuses undo after the survivor changes and preserves the merged state", async () => {
    const survivor = await createContact.call({ name: "Changed Later" }, STAFF);
    const duplicate = await createContact.call({ name: "changed later" }, STAFF);
    const merged = await mergeContacts.call(
      { survivingId: survivor.id, duplicateId: duplicate.id },
      STAFF,
    );
    await updateContact.call({ id: survivor.id, phone: "2505550111" }, STAFF);
    const error = await failure(
      undoContactMerge.call({ operationId: merged.mergeOperationId }, STAFF),
    );
    expect(error).toMatchObject({ code: "conflict" });
    expect(await db().select().from(contacts)).toHaveLength(1);
    expect((await db().select().from(contacts))[0]?.phone).toBe("2505550111");
  });

  it("marks a merge non-undoable when it invalidates a sign-in credential", async () => {
    const survivor = await createContact.call({ name: "Credential" }, STAFF);
    const duplicate = await createContact.call(
      { name: "credential", email: "credential@example.test" },
      STAFF,
    );
    await db().insert(customerMagicLinks).values({
      contactId: duplicate.id,
      email: "credential@example.test",
      tokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const merged = await mergeContacts.call(
      { survivingId: survivor.id, duplicateId: duplicate.id },
      STAFF,
    );
    const [operation] = await listContactMergeOperations.call({}, VIEWER);
    expect(operation).toMatchObject({ id: merged.mergeOperationId, undoable: false });
    expect(operation?.undoBlockers[0]).toMatch(/sign-in link/i);
    expect(
      (await failure(
        undoContactMerge.call({ operationId: merged.mergeOperationId }, STAFF),
      )).code,
    ).toBe("conflict");
  });

  it("keeps the normalized phone index expression valid on fresh PostgreSQL", async () => {
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        create temporary table duplicate_phone_index_probe (
          phone text
        ) on commit drop
      `);
      await tx.execute(sql`
        create index duplicate_phone_index_probe_idx
        on duplicate_phone_index_probe using btree ((case
          when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
            then substring(regexp_replace(phone, '[^0-9]', '', 'g') from 2)
          else regexp_replace(phone, '[^0-9]', '', 'g')
        end))
      `);
    });
  });

  it("requires manage authority for scan, dismiss, merge, and undo", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000099";
    expect((await failure(scanDuplicateCandidates.call({}, VIEWER))).code).toBe(
      "permission",
    );
    expect(
      (await failure(
        dismissDuplicateCandidate.call(
          { id: candidateId },
          VIEWER,
        ),
      )).code,
    ).toBe("permission");
    expect(
      (await failure(
        mergeDuplicateCandidate.call(
          {
            candidateId,
            survivingId: "00000000-0000-4000-8000-000000000100",
            duplicateId: "00000000-0000-4000-8000-000000000101",
          },
          VIEWER,
        ),
      )).code,
    ).toBe("permission");
    expect(
      (await failure(
        undoContactMerge.call({ operationId: candidateId }, VIEWER),
      )).code,
    ).toBe("permission");
  });
});

describe("the duplicate-review migration", () => {
  it("is additive and indexes queue, foreign-key, and blocking paths", () => {
    const migration = readFileSync(
      "db/migrations/0023_contact-duplicate-review.sql",
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "merge_candidates"');
    expect(migration).toContain('CREATE TABLE "contact_merge_operations"');
    expect(migration).toContain('CREATE INDEX "merge_candidates_a_idx"');
    expect(migration).toContain('CREATE INDEX "merge_candidates_b_idx"');
    expect(migration).toContain('CREATE INDEX "contacts_normalized_name_idx"');
    expect(migration).toContain(
      'CREATE INDEX "contacts_normalized_phone_idx" ON "contacts" USING btree ((case',
    );
    expect(migration).not.toMatch(/\bDROP\b/i);
  });
});
