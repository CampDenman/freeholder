// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product-wide search over live user-owned rows (C11.14). Does not close the
// item: undelete-every-row remains a named leftover.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
import { orders, orderItems, priceLists } from "@/modules/catalog/schema";
import { createDataRequest } from "@/core/privacy/service";
import { marketplaceChannels, marketplaceOrders } from "../../plugins/marketplace/schema";
import { createProduct, applyVariantMatrix, getProductVariants } from "@/modules/catalog/service";
import { createSupplier } from "@/modules/catalog/procurement";
import { issueContract } from "@/modules/contracts/service";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { createGiftRegistry } from "../../plugins/gift-registry/service";
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
      "Per-record restore includes note/task trash, media/product restoration, contact-merge undo and the ownership-drill instance restore; other entities still lack undelete.",
    );
    expect(master).toContain(
      "Remaining SEARCH_TABLE_OPT_OUTS cover operational rows, join tables and workflow records reached through their parent; these are not mixed into search.query.",
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

  it("finds suppliers and agreements without widening their read authority", async () => {
    const contactId = await person("supplier-contact@example.test", "Private contact name");
    const supplier = await createSupplier.call({ name: `${TOKEN} supplier %_`, currency: "CAD", contactId }, OWNER);
    const agreement = await issueContract.call({ contactId, subjectType: "contact", title: `${TOKEN} agreement %_`, body: "Private agreement body fixture" }, OWNER);
    const hits = await querySearch.call({ q: TOKEN }, OWNER);
    expect(hits.find(hit => hit.kind === "supplier")).toMatchObject({ id: supplier.id, href: `/admin/procurement#supplier-${supplier.id}`, snippet: null });
    expect(hits.find(hit => hit.kind === "agreement")).toMatchObject({ id: agreement.id, href: `/admin/agreements/${agreement.id}`, snippet: null });
    expect(JSON.stringify(hits)).not.toContain("Private contact name");
    expect(JSON.stringify(hits)).not.toContain("Private agreement body fixture");
    expect(JSON.stringify(hits)).not.toContain("signToken");
    const viewer: Actor = { ...STAFF, grants: [{ module: "search", access: "view" }, { module: "contracts", access: "view" }] };
    expect((await querySearch.call({ q: TOKEN }, viewer)).map(hit => hit.kind)).toEqual(["agreement"]);
    const key: Actor = { kind: "agent", keyName: "supplier-reader", scopes: ["search.query", "catalog.listSuppliers", "contracts.get"] };
    expect((await querySearch.call({ q: TOKEN }, key)).map(hit => hit.kind)).toEqual(["supplier"]);
    expect(await querySearch.call({ q: TOKEN }, { ...key, scopes: ["search.query", "catalog.createSupplier", "contracts.issue"] })).toEqual([]);
    expect((await querySearch.call({ q: "%_" }, OWNER)).map(hit => hit.kind).sort()).toEqual(["agreement", "supplier"]);
    expect(await querySearch.call({ q: "Private agreement body fixture" }, OWNER)).toEqual([]);
  });

  it("finds price lists, channel orders and privacy references with exact read authority", async () => {
    const contactId = await person("workflow-search@example.test", "Private workflow customer");
    const [price] = await db().insert(priceLists).values({ name: `${TOKEN} prices %_`, currency: "CAD", kind: "contract", contactId }).returning();
    const [channel] = await db().insert(marketplaceChannels).values({ name: "Search channel", provider: "shopify" }).returning();
    const [order] = await db().insert(marketplaceOrders).values({ channelId: channel!.id, contactId, invoiceId: randomUUID(), externalRef: `${TOKEN} order %_`, description: "Imported print", amountMinor: 100, currency: "CAD" }).returning();
    const request = await createDataRequest.call({ contactId, request: { kind: "access", note: "Sensitive privacy request fixture" } }, OWNER);
    const key: Actor = { kind: "agent", keyName: "workflow-reader", scopes: ["search.query", "catalog.listPriceLists", "marketplace.listOrders", "contacts.getDataRequest"] };
    const hits = await querySearch.call({ q: TOKEN }, key);
    expect(hits.find(hit => hit.kind === "priceList")).toMatchObject({ id: price!.id, href: `/admin/price-lists#price-list-${price!.id}`, snippet: null });
    expect(hits.find(hit => hit.kind === "marketplaceOrder")).toMatchObject({ id: order!.id, href: `/admin/marketplace#order-${order!.id}`, snippet: null });
    expect((await querySearch.call({ q: request.id }, key)).map(hit => hit.kind)).toEqual(["privacyRequest"]);
    expect(await querySearch.call({ q: "Sensitive privacy request fixture" }, OWNER)).toEqual([]);
    expect(JSON.stringify(hits)).not.toContain("Private workflow customer");
    expect((await querySearch.call({ q: "%_" }, key)).map(hit => hit.kind).sort()).toEqual(["marketplaceOrder", "priceList"]);
    const writeOnly: Actor = { ...key, scopes: ["search.query", "catalog.createPriceList", "marketplace.sync", "contacts.createDataRequest"] };
    expect(await querySearch.call({ q: TOKEN }, writeOnly)).toEqual([]);
    expect(await querySearch.call({ q: request.id }, writeOnly)).toEqual([]);
    const reader: Actor = { ...STAFF, grants: [{ module: "search", access: "view" }, { module: "marketplace", access: "view" }] };
    expect((await querySearch.call({ q: TOKEN }, reader)).map(hit => hit.kind)).toEqual(["marketplaceOrder"]);
    expect(await querySearch.call({ q: request.id }, reader)).toEqual([]);
  });

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

  it("finds orders, subscriptions and gifts through each record's read authority", async () => {
    const contactId = await person("extended-search@example.test", "Private buyer name");
    const product = await createProduct.call({ name: "Search fixture", slug: "search-fixture", kind: "service" }, OWNER);
    await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: product.id }, OWNER)).variants[0]!;
    const [order] = await db().insert(orders).values({ contactId, currency: "CAD", shippingAddress: { secret: "not-a-search-field" } }).returning();
    await db().insert(orderItems).values([1, 2].map(() => ({ orderId: order!.id, variantId: variant.id, quantity: 1,
      unitAmountMinor: 100, lineTotalMinor: 100, snapshot: { productName: "zxqvextended print", sku: "literal%sku" } })));
    const [plan] = await db().insert(plans).values({ productId: product.id, name: "zxqvextended membership", interval: "month" }).returning();
    const [subscription] = await db().insert(subscriptions).values({ contactId, planId: plan!.id, productVariantId: variant.id,
      currency: "CAD", billingMode: "manual", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) }).returning();
    const gift = await createGiftRegistry.call({ contactId, title: "zxqvextended gifts", slug: "zxqvextended-gifts" }, OWNER);
    const kinds = ["order", "subscription", "giftRegistry"];
    const hits = await querySearch.call({ q: "zxqvextended", kinds }, OWNER);
    expect(hits.map(hit => hit.kind).sort()).toEqual([...kinds].sort());
    expect(hits.find(hit => hit.kind === "order")!.href).toBe(`/admin/orders/${order!.id}`);
    expect(hits.find(hit => hit.kind === "subscription")!.href).toBe(`/admin/subscriptions/${subscription!.id}`);
    expect(hits.find(hit => hit.kind === "giftRegistry")!.href).toBe(`/admin/gifts?registry=${gift.id}`);
    const agent: Actor = { kind: "agent", keyName: "search-reader", scopes: ["search.query", "catalog.getOrder"] };
    expect((await querySearch.call({ q: "zxqvextended", kinds }, agent)).map(hit => hit.kind)).toEqual(["order"]);
    const denied: Actor = { ...agent, scopes: ["search.query", "catalog.createProduct", "subscriptions.createPlan", "giftRegistry.create"] };
    expect(await querySearch.call({ q: "zxqvextended", kinds }, denied)).toEqual([]);
    expect(await querySearch.call({ q: "Private buyer name", kinds }, agent)).toEqual([]);
    expect(await querySearch.call({ q: "not-a-search-field", kinds }, OWNER)).toEqual([]);
    expect(await querySearch.call({ q: "literal%sku", kinds: ["order"] }, agent)).toHaveLength(1);
    expect(await querySearch.call({ q: "literal_sku", kinds: ["order"] }, agent)).toHaveLength(0);
    const giftReader: Actor = { ...agent, scopes: ["search.query", "giftRegistry.list"] };
    expect((await querySearch.call({ q: "zxqvextended", kinds }, giftReader))[0]!.href).toBe("/gifts/zxqvextended-gifts");
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

  it("shows conversation hits to staff with crm even without a conversations grant", async () => {
    const crmStaff: Actor = {
      kind: "user",
      userId: STAFF.userId,
      role: "staff",
      grants: [
        { module: "search", access: "view" },
        { module: "conversations", access: "view" },
      ],
    };
    await recordMessage.call(
      {
        email: "crm@example.test",
        name: "Crm Lane",
        direction: "inbound",
        channel: "email",
        body: `Inbox ${TOKEN} thread`,
        subject: `${TOKEN} crm subject`,
      },
      OWNER,
    );
    const hits = await querySearch.call({ q: TOKEN, limit: 20 }, crmStaff);
    expect(hits.some((hit) => hit.kind === "conversation")).toBe(true);
    expect(hits.some((hit) => hit.kind === "contact")).toBe(false);
    expect(hits.some((hit) => hit.kind === "note")).toBe(false);
  });

  it("does not turn a write-only API scope into contact read access", async () => {
    await person("scope-private@example.test", "zxqvscope private contact");
    const agent: Actor = {
      kind: "agent", keyName: "write-only-search",
      scopes: ["search.query", "contacts.create"],
    };
    expect(await querySearch.call({ q: "zxqvscope" }, agent)).toEqual([]);
    const reader: Actor = { ...agent, scopes: ["search.query", "contacts.list"] };
    expect(await querySearch.call({ q: "zxqvscope" }, reader)).toHaveLength(1);
  });

  it("requires the actual note and conversation grants, not related contact/CRM grants", async () => {
    const contactId = await person("cross-family@example.test", "Cross family");
    await writeNote.call({ subjectType: "contact", subjectId: contactId,
      body: "zxqvgrant shared note", visibility: "shared" }, OWNER);
    await recordMessage.call({ email: "cross-family@example.test", name: "Cross family",
      direction: "inbound", channel: "email", body: "zxqvgrant conversation" }, OWNER);
    const wrongFamily: Actor = { ...STAFF, grants: [
      { module: "search", access: "view" }, { module: "contacts", access: "view" },
      { module: "crm", access: "view" },
    ] };
    expect(await querySearch.call({ q: "zxqvgrant" }, wrongFamily)).toEqual([]);
    const reader: Actor = { ...STAFF, grants: [
      { module: "search", access: "view" }, { module: "notes", access: "view" },
      { module: "conversations", access: "view" },
    ] };
    const hits = await querySearch.call({ q: "zxqvgrant" }, reader);
    expect(hits.map((hit) => hit.kind).sort()).toEqual(["conversation", "note"]);
  });

  it("binds every search source to a registered scoped read service", () => {
    for (const source of searchSources()) {
      const { def } = getService(source.readService);
      expect(def.kind, source.kind).toBe("query");
      expect(def.permission, source.kind).toBe("scoped");
    }
  });

  it("hides private notes from agents", async () => {
    const agent: Actor = {
      kind: "agent",
      keyName: "search-key",
      scopes: ["search.query", "notes.list"],
    };
    const id = await person("priv@example.test", "Priv Lane");
    await writeNote.call(
      {
        subjectType: "contact",
        subjectId: id,
        body: "private zxqvpriv only me",
        visibility: "private",
      },
      OWNER,
    );
    await writeNote.call(
      {
        subjectType: "contact",
        subjectId: id,
        body: "shared zxqvpriv for the team",
        visibility: "shared",
      },
      OWNER,
    );
    const hits = await querySearch.call({ q: "zxqvpriv" }, agent);
    const notes = hits.filter((hit) => hit.kind === "note");
    expect(notes.some((hit) => hit.snippet?.includes("shared zxqvpriv"))).toBe(true);
    expect(notes.some((hit) => hit.snippet?.includes("private zxqvpriv"))).toBe(false);
  });

  it("caps the concatenated result at limit", async () => {
    const id = await person("cap@example.test", "Cap Lane");
    await person("cap-one@example.test", "zxqvcap one");
    await person("cap-two@example.test", "zxqvcap two");
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: "zxqvcap note one" },
      OWNER,
    );
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: "zxqvcap note two" },
      OWNER,
    );
    const hits = await querySearch.call(
      { q: "zxqvcap", kinds: ["contact", "note"], limit: 2 },
      OWNER,
    );
    expect(hits).toHaveLength(2);
  });

  it("still returns a later kind when contacts would fill the limit", async () => {
    const id = await person("round@example.test", "zxqvround contact a");
    await person("round-b@example.test", "zxqvround contact b");
    await person("round-c@example.test", "zxqvround contact c");
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: "zxqvround note body" },
      OWNER,
    );
    const hits = await querySearch.call(
      { q: "zxqvround", kinds: ["contact", "note"], limit: 2 },
      OWNER,
    );
    expect(hits).toHaveLength(2);
    expect(hits.some((hit) => hit.kind === "contact")).toBe(true);
    expect(hits.some((hit) => hit.kind === "note")).toBe(true);
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

  it("treats %, _ and \\ as literals on notes and invoices", async () => {
    const id = await person("wild@example.test", "Wild Lane");
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: "note_hello_zxqvbody" },
      OWNER,
    );
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: "noteXhello_zxqvbody" },
      OWNER,
    );
    await writeNote.call(
      { subjectType: "contact", subjectId: id, body: "note\\hello_zxqvslash" },
      OWNER,
    );
    await createDraftInvoice.call(
      {
        contactId: id,
        currency: "CAD",
        idempotencyKey: "search-wild-under",
        memo: "fee_100_zxqvinv",
        lines: [
          {
            description: "Sitting",
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
    await createDraftInvoice.call(
      {
        contactId: id,
        currency: "CAD",
        idempotencyKey: "search-wild-x",
        memo: "feeX100_zxqvinv",
        lines: [
          {
            description: "Sitting",
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

    const under = await querySearch.call({ q: "note_hello_zxqvbody" }, OWNER);
    expect(under.some((hit) => hit.kind === "note" && hit.snippet?.includes("note_hello_zxqvbody"))).toBe(
      true,
    );
    expect(under.some((hit) => hit.snippet?.includes("noteXhello_zxqvbody"))).toBe(false);

    const percent = await querySearch.call({ q: "note%hello_zxqvbody" }, OWNER);
    expect(percent.some((hit) => hit.kind === "note")).toBe(false);

    const slash = await querySearch.call({ q: "note\\hello_zxqvslash" }, OWNER);
    expect(slash.some((hit) => hit.kind === "note" && hit.snippet?.includes("note\\hello_zxqvslash"))).toBe(
      true,
    );

    const invoiceUnder = await querySearch.call({ q: "fee_100_zxqvinv" }, OWNER);
    expect(invoiceUnder.some((hit) => hit.kind === "invoice" && hit.snippet === "fee_100_zxqvinv")).toBe(
      true,
    );
    expect(invoiceUnder.some((hit) => hit.snippet === "feeX100_zxqvinv")).toBe(false);

    const invoicePercent = await querySearch.call({ q: "fee%100_zxqvinv" }, OWNER);
    expect(invoicePercent.some((hit) => hit.kind === "invoice")).toBe(false);
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
