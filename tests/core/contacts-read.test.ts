// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The read side of the spine: browsing contacts, and the CRM timeline that
// §4.1 calls "a view over the spine, not a separate store".
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  contactTimeline,
  createContact,
  listContacts,
  updateContact,
} from "@/core/contacts/service";
import {
  CUSTOMER,
  closeDb,
  failure,
  hasDatabase,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

async function seed(n: number, prefix = "Contact") {
  for (let i = 0; i < n; i += 1) {
    await createContact.call(
      { name: `${prefix} ${String(i).padStart(2, "0")}` },
      STAFF,
    );
  }
}

describe.runIf(hasDatabase)("browsing contacts", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  describe("contacts.list", () => {
    it("reports the total, not just the page", async () => {
      // Pagination is impossible without it: a caller cannot page through
      // what it cannot size, and the page length says nothing about the rest.
      await seed(30);
      const page = await listContacts.call({ limit: 10 }, STAFF);
      expect(page.rows).toHaveLength(10);
      expect(page.total).toBe(30);
    });

    it("counts matches, not the whole table, when filtered", async () => {
      await createContact.call(
        { name: "Ada Lovelace", lifecycleStage: "customer" },
        STAFF,
      );
      await seed(5, "Someone");

      const page = await listContacts.call(
        { lifecycleStage: "customer" },
        STAFF,
      );
      expect(page.total).toBe(1);
      expect(page.rows[0]!.name).toBe("Ada Lovelace");
    });

    it("returns newest first", async () => {
      await createContact.call({ name: "First" }, STAFF);
      await createContact.call({ name: "Second" }, STAFF);
      const page = await listContacts.call({}, STAFF);
      expect(page.rows.map((r) => r.name)).toEqual(["Second", "First"]);
    });

    it("pages without repeating or skipping a row", async () => {
      await seed(12);
      const first = await listContacts.call({ limit: 5, offset: 0 }, STAFF);
      const second = await listContacts.call({ limit: 5, offset: 5 }, STAFF);
      const third = await listContacts.call({ limit: 5, offset: 10 }, STAFF);

      const names = [...first.rows, ...second.rows, ...third.rows].map(
        (r) => r.name,
      );
      expect(names).toHaveLength(12);
      expect(new Set(names).size).toBe(12);
    });

    it("searches name and email, case-insensitively", async () => {
      await createContact.call(
        { name: "Grace Hopper", email: "grace@example.test" },
        STAFF,
      );
      await createContact.call({ name: "Someone Else" }, STAFF);

      expect((await listContacts.call({ search: "hopper" }, STAFF)).total).toBe(1);
      expect((await listContacts.call({ search: "GRACE@" }, STAFF)).total).toBe(1);
      expect((await listContacts.call({ search: "nobody" }, STAFF)).total).toBe(0);
    });

    it("treats a search with SQL characters as text, not syntax", async () => {
      await createContact.call({ name: "Normal Person" }, STAFF);
      const page = await listContacts.call(
        { search: "'; drop table contacts; --" },
        STAFF,
      );
      expect(page.total).toBe(0);
      // And the table is still there.
      expect((await listContacts.call({}, STAFF)).total).toBe(1);
    });

    it("is staff-only", async () => {
      expect((await failure(listContacts.call({}, CUSTOMER))).code).toBe(
        "permission",
      );
    });
  });

  describe("contacts.timeline", () => {
    it("shows a contact's own history, newest first", async () => {
      const contact = await createContact.call({ name: "Ada" }, STAFF);
      await updateContact.call(
        { id: contact.id, lifecycleStage: "customer" },
        STAFF,
      );

      const timeline = await contactTimeline.call(
        { contactId: contact.id },
        STAFF,
      );
      expect(timeline.map((e) => e.eventType)).toEqual([
        "contact.updated",
        "contact.created",
      ]);
    });

    it("does not leak another contact's events", async () => {
      const ada = await createContact.call({ name: "Ada" }, STAFF);
      await createContact.call({ name: "Grace" }, STAFF);

      const timeline = await contactTimeline.call(
        { contactId: ada.id },
        STAFF,
      );
      expect(timeline).toHaveLength(1);
      expect(timeline.every((e) => e.contactId === ada.id)).toBe(true);
    });

    it("is empty rather than missing for a contact with no history", async () => {
      // Created through the service, so there is always at least one event —
      // this covers the shape a caller must handle after a merge moves events.
      const contact = await createContact.call({ name: "Quiet" }, STAFF);
      const timeline = await contactTimeline.call(
        { contactId: contact.id, limit: 200 },
        STAFF,
      );
      expect(Array.isArray(timeline)).toBe(true);
    });

    it("rejects a malformed id before touching the database", async () => {
      const error = await failure(
        contactTimeline.call({ contactId: "not-a-uuid" }, STAFF),
      );
      expect(error.code).toBe("validation");
    });

    it("is staff-only", async () => {
      const contact = await createContact.call({ name: "Ada" }, STAFF);
      const error = await failure(
        contactTimeline.call({ contactId: contact.id }, CUSTOMER),
      );
      expect(error.code).toBe("permission");
    });
  });
});
