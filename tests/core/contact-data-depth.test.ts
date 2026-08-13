// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Complete Contact-spine data depth (MASTER.md C1.06).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createCustomField,
  listCustomFields,
  updateCustomField,
} from "@/core/contacts/custom-fields";
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  updateOrganization,
} from "@/core/contacts/organizations";
import {
  createRelationship,
  deleteRelationship,
  listRelationships,
  updateRelationship,
} from "@/core/contacts/relationships";
import {
  createContact,
  listContactTags,
  listContacts,
  mergeContacts,
  resolveContact,
  updateContact,
} from "@/core/contacts/service";
import {
  contactRelationships,
  contacts,
  timelineEvents,
} from "@/core/contacts/schema";
import { db } from "@/core/db";
import {
  OWNER,
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

describe.runIf(hasDatabase)("organization and custom-field data", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("defines typed fields and validates contact values without losing archived data", async () => {
    const size = await createCustomField.call(
      {
        entity: "contact",
        key: "shoe_size",
        label: "Shoe size",
        kind: "number",
      },
      STAFF,
    );
    const contact = await createContact.call(
      { name: "Ada", customFields: { shoe_size: 7.5 } },
      STAFF,
    );
    expect(contact.customFields).toEqual({ shoe_size: 7.5 });

    expect(
      (await failure(
        createContact.call(
          { name: "Wrong", customFields: { shoe_size: "large" } },
          STAFF,
        ),
      )).code,
    ).toBe("validation");
    expect(
      (await failure(
        createContact.call(
          { name: "Typo", customFields: { shoes_size: 8 } },
          STAFF,
        ),
      )).code,
    ).toBe("validation");

    await updateCustomField.call({ id: size.id, active: false }, STAFF);
    expect(
      (await failure(
        updateContact.call(
          { id: contact.id, customFields: { shoe_size: 8 } },
          STAFF,
        ),
      )).code,
    ).toBe("validation");
    expect((await db().select().from(contacts))[0]?.customFields).toEqual({
      shoe_size: 7.5,
    });
    expect(await listCustomFields.call({ entity: "contact" }, VIEWER)).toHaveLength(0);
    expect(
      await listCustomFields.call(
        { entity: "contact", includeInactive: true },
        VIEWER,
      ),
    ).toHaveLength(1);
  });

  it("will not remove a choice that stored records still use", async () => {
    const field = await createCustomField.call(
      {
        entity: "contact",
        key: "tier",
        label: "Tier",
        kind: "select",
        options: ["standard", "vip"],
      },
      STAFF,
    );
    await createContact.call(
      { name: "Grace", customFields: { tier: "vip" } },
      STAFF,
    );
    const error = await failure(
      updateCustomField.call({ id: field.id, options: ["standard"] }, STAFF),
    );
    expect(error.code).toBe("conflict");
    await expect(
      updateCustomField.call(
        { id: field.id, options: ["standard", "vip", "wholesale"] },
        STAFF,
      ),
    ).resolves.toMatchObject({ options: ["standard", "vip", "wholesale"] });
  });

  it("creates, searches, updates, counts, and safely deletes organizations", async () => {
    await createCustomField.call(
      {
        entity: "organization",
        key: "sector",
        label: "Sector",
        kind: "select",
        options: ["education", "technology"],
      },
      STAFF,
    );
    const organization = await createOrganization.call(
      {
        name: "Analytical Engines",
        domain: "ANALYTICAL.EXAMPLE",
        customFields: { sector: "technology" },
      },
      STAFF,
    );
    expect(organization.domain).toBe("analytical.example");
    const contact = await createContact.call(
      { name: "Ada", orgId: organization.id },
      STAFF,
    );
    const listed = await listOrganizations.call({ search: "analytical" }, VIEWER);
    expect(listed).toMatchObject({ total: 1 });
    expect(listed.rows[0]).toMatchObject({ memberCount: 1 });

    await expect(
      updateOrganization.call(
        { id: organization.id, name: "Analytical Engine Society" },
        STAFF,
      ),
    ).resolves.toMatchObject({ name: "Analytical Engine Society" });
    expect(
      (await failure(
        createOrganization.call(
          { name: "Duplicate", domain: "analytical.example" },
          STAFF,
        ),
      )).code,
    ).toBe("conflict");
    expect((await failure(deleteOrganization.call({ id: organization.id }, STAFF))).code)
      .toBe("conflict");

    await updateContact.call({ id: contact.id, orgId: null }, STAFF);
    await expect(deleteOrganization.call({ id: organization.id }, STAFF)).resolves.toEqual({
      ok: true,
    });
  });

  it("requires manage authority for definitions and organization changes", async () => {
    expect(
      (await failure(
        createCustomField.call(
          { entity: "contact", key: "x", label: "X", kind: "text" },
          VIEWER,
        ),
      )).code,
    ).toBe("permission");
    expect(
      (await failure(createOrganization.call({ name: "No" }, VIEWER))).code,
    ).toBe("permission");
  });
});

describe.runIf(hasDatabase)("contact metadata and lifecycle", () => {
  beforeEach(truncateSpine);

  it("canonicalizes tags and supports indexed tag filtering and discovery", async () => {
    await createContact.call(
      { name: "Ada", tags: [" VIP ", "vip", "High Value"] },
      STAFF,
    );
    await createContact.call({ name: "Grace", tags: ["newsletter"] }, STAFF);
    expect(await listContactTags.call({}, VIEWER)).toEqual([
      "high value",
      "newsletter",
      "vip",
    ]);
    const vip = await listContacts.call({ tag: "VIP" }, VIEWER);
    expect(vip.rows.map((row) => row.name)).toEqual(["Ada"]);
  });

  it("validates and clears locale, time zone, and country independently", async () => {
    const contact = await createContact.call(
      {
        name: "International",
        preferredLocale: "fr-ca",
        timezone: "America/Vancouver",
        country: "ca",
      },
      STAFF,
    );
    expect(contact).toMatchObject({
      preferredLocale: "fr-CA",
      timezone: "America/Vancouver",
      country: "CA",
    });
    expect(
      (await failure(
        updateContact.call({ id: contact.id, timezone: "Moon/Sea" }, STAFF),
      )).code,
    ).toBe("validation");
    const cleared = await updateContact.call(
      {
        id: contact.id,
        preferredLocale: null,
        timezone: null,
        country: null,
      },
      STAFF,
    );
    expect(cleared).toMatchObject({
      preferredLocale: null,
      timezone: null,
      country: null,
    });
  });

  it("records explicit lifecycle transitions for owner and automated changes", async () => {
    const contact = await createContact.call(
      { name: "Buyer", email: "buyer-depth@example.test" },
      STAFF,
    );
    await updateContact.call({ id: contact.id, lifecycleStage: "prospect" }, STAFF);
    await resolveContact.call(
      { email: "buyer-depth@example.test", lifecycleStage: "customer" },
      STAFF,
    );
    const events = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.contactId, contact.id));
    expect(events.filter((event) => event.eventType === "contact.lifecycleChanged"))
      .toHaveLength(2);
    expect(events.map((event) => event.payload)).toContainEqual({
      from: "lead",
      to: "prospect",
    });
  });
});

describe.runIf(hasDatabase)("contact relationships", () => {
  beforeEach(truncateSpine);

  it("canonicalizes peer edges, rejects self/duplicates, and projects both directions", async () => {
    const a = await createContact.call({ name: "Ada" }, STAFF);
    const b = await createContact.call({ name: "Grace" }, STAFF);
    const partner = await createRelationship.call(
      { fromContactId: b.id, toContactId: a.id, kind: "partner" },
      STAFF,
    );
    expect(partner.fromContactId < partner.toContactId).toBe(true);
    expect(
      (await failure(
        createRelationship.call(
          { fromContactId: a.id, toContactId: b.id, kind: "partner" },
          STAFF,
        ),
      )).code,
    ).toBe("conflict");
    expect(
      (await failure(
        createRelationship.call(
          { fromContactId: a.id, toContactId: a.id, kind: "household" },
          STAFF,
        ),
      )).code,
    ).toBe("validation");
    expect((await listRelationships.call({ contactId: a.id }, VIEWER))[0])
      .toMatchObject({ direction: "peer", otherContact: { name: "Grace" } });
    expect((await listRelationships.call({ contactId: b.id }, VIEWER))[0])
      .toMatchObject({ direction: "peer", otherContact: { name: "Ada" } });
    expect(
      (await failure(
        updateRelationship.call(
          { id: partner.id, kind: "employer" },
          STAFF,
        ),
      )).code,
    ).toBe("validation");
    await updateRelationship.call(
      {
        id: partner.id,
        fromContactId: b.id,
        toContactId: a.id,
        kind: "employer",
      },
      STAFF,
    );
    expect((await listRelationships.call({ contactId: b.id }, VIEWER))[0])
      .toMatchObject({ direction: "outgoing", otherContact: { name: "Ada" } });
    expect((await listRelationships.call({ contactId: a.id }, VIEWER))[0])
      .toMatchObject({ direction: "incoming", otherContact: { name: "Grace" } });
  });

  it("audits relationship updates/removal on both contact timelines", async () => {
    const referred = await createContact.call({ name: "Referred" }, STAFF);
    const referrer = await createContact.call({ name: "Referrer" }, STAFF);
    const relationship = await createRelationship.call(
      {
        fromContactId: referred.id,
        toContactId: referrer.id,
        kind: "referred_by",
      },
      STAFF,
    );
    await updateRelationship.call(
      { id: relationship.id, since: "2024-02-29", notes: "Met at camp" },
      STAFF,
    );
    await deleteRelationship.call({ id: relationship.id }, STAFF);
    const events = await db().select().from(timelineEvents);
    for (const id of [referred.id, referrer.id]) {
      expect(
        events
          .filter((event) => event.contactId === id)
          .map((event) => event.eventType),
      ).toEqual(
        expect.arrayContaining([
          "contact.relationshipAdded",
          "contact.relationshipUpdated",
          "contact.relationshipRemoved",
        ]),
      );
    }
    expect(await db().select().from(contactRelationships)).toHaveLength(0);
  });

  it("merges duplicate edges, keeps the earliest date and notes, and drops self-edges", async () => {
    const survivor = await createContact.call({ name: "Survivor" }, STAFF);
    const duplicate = await createContact.call({ name: "Duplicate" }, STAFF);
    const other = await createContact.call({ name: "Other" }, STAFF);
    await createRelationship.call(
      {
        fromContactId: survivor.id,
        toContactId: other.id,
        kind: "referred_by",
        since: "2020-01-01",
        notes: "Survivor note",
      },
      STAFF,
    );
    await createRelationship.call(
      {
        fromContactId: duplicate.id,
        toContactId: other.id,
        kind: "referred_by",
        since: "2019-01-01",
        notes: "Duplicate note",
      },
      STAFF,
    );
    await createRelationship.call(
      {
        fromContactId: survivor.id,
        toContactId: duplicate.id,
        kind: "partner",
      },
      STAFF,
    );
    await mergeContacts.call(
      { survivingId: survivor.id, duplicateId: duplicate.id },
      OWNER,
    );
    const rows = await db().select().from(contactRelationships);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fromContactId: survivor.id,
      toContactId: other.id,
      since: "2019-01-01",
    });
    expect(rows[0]?.notes).toContain("Survivor note");
    expect(rows[0]?.notes).toContain("Duplicate note");
  });
});

describe("the contact-data-depth migration", () => {
  it("is additive and indexes every new query path", () => {
    const migration = readFileSync("db/migrations/0022_contact-data-depth.sql", "utf8");
    expect(migration).toContain('CREATE TABLE "contact_relationships"');
    expect(migration).toContain('CREATE TABLE "custom_field_definitions"');
    expect(migration).toContain('CREATE INDEX "contacts_tags_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX "organizations_domain_idx"');
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(migration).toContain('CREATE INDEX "contacts_name_search_idx"');
    expect(migration).toContain('CREATE INDEX "organizations_name_search_idx"');
    expect(migration).not.toMatch(/\bDROP\b/i);
  });
});
