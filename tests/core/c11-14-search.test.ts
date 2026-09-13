// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product-wide search over live user-owned rows (C11.14). Does not close the
// item: undelete-every-row and per-table TTL remain named leftovers.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import manifests from "@/modules";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { mergeContacts } from "@/core/contacts/service";
import { db } from "@/core/db";
import { writeNote } from "@/core/notes/service";
import { recordMessage } from "@/core/messaging/service";
import { createPage } from "@/modules/cms/service";
import { createDraftInvoice } from "@/modules/invoicing/invoice-service";
import { ready } from "@/core/runtime";
import { getService, listServices, type Actor } from "@/core/service";
import {
  SEARCH_TABLE_OPT_OUTS,
  querySearch,
  searchSources,
} from "@/core/search/service";
import { closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

const TOKEN = "zxqvsearchmix";

describe("C11.14 search leftovers", () => {
  it("keeps C11.14 open and names the leftovers this PR did not close", () => {
    const master = readFileSync("MASTER.md", "utf8");
    expect(master).toMatch(/- \[ \] \*\*C11\.14\*\*/);
    expect(readFileSync("src/core/search/service.ts", "utf8")).toContain(
      'name: "search.query"',
    );
    expect(master).toContain(
      "Per-record restore is contact-merge undo plus the ownership-drill instance restore; there is no undelete for every entity.",
    );
    expect(master).toContain(
      "Retention is privacy-rights + artifact TTL, not a per-table TTL for every user-owned store.",
    );
    expect(master).not.toMatch(/No product-wide search index:/);
  });
});

describe.runIf(hasDatabase)("search.query (C11.14)", { timeout: 90_000 }, () => {
  let tables: PgTable[] = [];

  beforeAll(async () => {
    await ready();
    const found: PgTable[] = [];
    for (const manifest of manifests) {
      if (!manifest.tables) continue;
      const owned: Record<string, unknown> = await manifest.tables();
      for (const value of Object.values(owned)) {
        if (is(value, PgTable)) found.push(value);
      }
    }
    tables = found;
  }, 60_000);

  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
        { id: STAFF.userId, email: "staff@example.test", role: "staff" },
      ])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function person(email: string, name: string) {
    const resolved = (await getService("contacts.resolve").call(
      { email, name, source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  function contactForeignKeys(): string[] {
    const contactsTable = getTableConfig(contacts).name;
    const found = new Set<string>();
    for (const table of tables) {
      const config = getTableConfig(table);
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        if (getTableConfig(reference.foreignTable).name !== contactsTable) continue;
        found.add(config.name);
      }
    }
    return [...found];
  }

  it("returns mixed kinds from one query", async () => {
    const id = await person("rae@example.test", `Rae ${TOKEN}`);
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: `Prefers ${TOKEN} mornings.` },
      OWNER,
    );
    await recordMessage.call(
      {
        email: "rae@example.test",
        name: `Rae ${TOKEN}`,
        direction: "inbound",
        channel: "email",
        body: `Are you free for ${TOKEN}?`,
        subject: `${TOKEN} visit`,
      },
      OWNER,
    );
    await createPage.call({ slug: `about-${TOKEN}`, title: `${TOKEN} studio page` }, OWNER);
    await createDraftInvoice.call(
      {
        contactId: id,
        currency: "CAD",
        idempotencyKey: `search-${TOKEN}`,
        memo: `${TOKEN} sitting fee`,
        lines: [
          {
            description: `${TOKEN} sitting`,
            quantityMicros: 1_000_000,
            unitAmountMinor: 10_000,
            discountMinor: 0,
            taxCategoryCode: "standard",
            requiresShipping: false,
            snapshot: {},
          },
        ],
        shippingMinor: 0,
        tax: {
          mode: "not_applicable",
          reason: "No collection obligation applies to this test transaction.",
        },
      },
      OWNER,
    );

    const hits = await querySearch.call({ q: TOKEN, limit: 20 }, OWNER);
    const kinds = new Set(hits.map((hit) => hit.kind));
    expect(kinds.has("contact")).toBe(true);
    expect(kinds.has("note") || kinds.has("conversation")).toBe(true);
    expect(
      kinds.has("invoice") || kinds.has("page") || kinds.has("media") || kinds.has("product"),
    ).toBe(true);
  });

  it("omits kinds the staff actor cannot access", async () => {
    const limited: Actor = {
      kind: "user",
      userId: STAFF.userId,
      role: "staff",
      grants: [
        { module: "search", access: "view" },
        { module: "cms", access: "view" },
      ],
    };
    await person("rae@example.test", `Rae ${TOKEN}`);
    await createPage.call({ slug: `staff-${TOKEN}`, title: `${TOKEN} staff page` }, OWNER);

    const hits = await querySearch.call({ q: TOKEN, limit: 20 }, limited);
    expect(hits.some((hit) => hit.kind === "page")).toBe(true);
    expect(hits.some((hit) => hit.kind === "contact")).toBe(false);
    expect(hits.some((hit) => hit.kind === "conversation")).toBe(false);
  });

  it("treats % and _ in the query as literals", async () => {
    await person("underscore@example.test", "hello_world_zxqv");
    await person("wildcard@example.test", "helloXworld_zxqv");

    const exact = await querySearch.call({ q: "hello_world_zxqv" }, OWNER);
    expect(exact.some((hit) => hit.kind === "contact" && hit.title === "hello_world_zxqv")).toBe(
      true,
    );
    expect(exact.some((hit) => hit.title === "helloXworld_zxqv")).toBe(false);

    const percent = await querySearch.call({ q: "hello%world_zxqv" }, OWNER);
    expect(percent.some((hit) => hit.kind === "contact")).toBe(false);
  });

  it("finds records after contacts.merge repoints contact_id", async () => {
    const surviving = await person("keep@example.test", "Keep Lane");
    const duplicate = await person("fold@example.test", "Fold Lane");
    await writeNote.call(
      {
        subjectType: "contact",
        subjectId: duplicate,
        body: "Folded note zxqvmerge",
      },
      OWNER,
    );
    await mergeContacts.call({ survivingId: surviving, duplicateId: duplicate }, OWNER);

    const hits = await querySearch.call({ q: "zxqvmerge" }, OWNER);
    const note = hits.find((hit) => hit.kind === "note");
    expect(note?.contactId).toBe(surviving);
  });

  it("accounts for every contact foreign key as a source or an opt-out", () => {
    const covered = new Set(searchSources().flatMap((source) => [...source.tables]));
    const missing = contactForeignKeys().filter(
      (table) => !covered.has(table) && !(table in SEARCH_TABLE_OPT_OUTS),
    );
    expect(missing, missing.join(", ")).toEqual([]);

    const stale = Object.keys(SEARCH_TABLE_OPT_OUTS).filter(
      (table) => !contactForeignKeys().includes(table) && !covered.has(table),
    );
    expect(stale, stale.join(", ")).toEqual([]);
  });

  it("refuses an empty query instead of scanning", async () => {
    const refused = await failure(querySearch.call({ q: "   " }, OWNER));
    expect(refused.code).toBe("validation");
  });

  it("is registered in listServices()", () => {
    expect(listServices().has("search.query")).toBe(true);
  });
});
