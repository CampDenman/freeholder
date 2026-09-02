// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer portal's rooms (MASTER.md §43 C8.11).
//
// The rule under test is the one clause of C8.11 that decides everything:
// the rooms read "using the same services as admin". So these tests create
// records through the ordinary owner-facing services and then check that the
// customer sees exactly those, through the portal, without any module having
// grown a second read path.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { myRecords } from "@/core/portal/service";
import { portalSections } from "@/core/portal/sections";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

/** A signed-in customer: a user row joined to a contact, as the portal needs. */
async function signedInCustomer(email = "rae@example.test") {
  const { contact } = await resolveContact.call({ email, name: "Rae" }, OWNER);
  await db().insert(users).values({ id: CUSTOMER.userId, email, role: "customer" });
  await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
  return { contact, actor: CUSTOMER };
}

/** A second customer, for the test that one may not see another's records. */
async function otherCustomer(email = "sam@example.test") {
  const { contact } = await resolveContact.call({ email, name: "Sam" }, OWNER);
  return contact;
}

describe.runIf(hasDatabase)("the customer portal's rooms", () => {
  // Boot wires every installed module and takes seconds, and it grows with
  // each one. Charged here rather than to the first test, which otherwise
  // fails on an unrelated thirty-second timeout the moment a module is added.
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("is filled by the modules, not by a list in the portal", async () => {
    // Nothing in core names quotes, invoices or bookings. A room exists
    // because a module claimed it at import time, which is why C9.13's
    // subscriptions will appear without the portal changing.
    const keys = portalSections().map((s) => s.key);
    expect(keys).toContain("quotes");
    expect(keys).toContain("invoices");
    expect(keys).toContain("bookings");
    expect(keys).toContain("orders");
    expect(keys).toContain("messages");
    expect(keys).toContain("subscriptions");
    // Ordered for a person rather than alphabetically: money before messages.
    expect(keys.indexOf("quotes")).toBeLessThan(keys.indexOf("messages"));
  });

  it("shows a customer the quote the owner sent them", async () => {
    const { contact, actor } = await signedInCustomer();
    const { createQuote } = await import("@/modules/quotes/service");
    await createQuote.call(
      {
        contactId: contact.id,
        title: "Two days on the coast",
        currency: "CAD",
        lines: [{ description: "Coverage", quantity: 1, unitAmount: "1200.00" }],
      },
      OWNER,
    );

    const rooms = await myRecords.call({ section: "quotes" }, actor);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.count).toBe(1);
    expect(rooms[0]!.records[0]!.title).toBe("Two days on the coast");
  });

  it("shows one customer nothing of another's", async () => {
    // The contact is resolved from the session and there is no parameter to
    // point at somebody else — the shape that cannot be misused, rather than
    // the shape that checks whether it was.
    const mine = await signedInCustomer("rae@example.test");
    const theirs = { contact: await otherCustomer("sam@example.test") };
    const { createQuote } = await import("@/modules/quotes/service");
    await createQuote.call(
      {
        contactId: theirs.contact.id,
        title: "Somebody else's job",
        currency: "CAD",
        lines: [{ description: "Coverage", quantity: 1, unitAmount: "900.00" }],
      },
      OWNER,
    );

    const rooms = await myRecords.call({ section: "quotes" }, mine.actor);
    expect(rooms[0]!.records).toHaveLength(0);
  });

  it("refuses anybody who is not signed in", async () => {
    const error = await failure(myRecords.call({}, { kind: "anonymous" }));
    expect(["permission", "unauthorized", "forbidden"]).toContain(error.code);
  });

  it("tells a staff account plainly that this is not their portal", async () => {
    // A staff user holds no contact row. Saying so beats rendering empty
    // rooms that look broken.
    const error = await failure(myRecords.call({}, OWNER));
    expect(error.code).toBe("not_found");
  });

  it("returns every room when asked for no section in particular", async () => {
    const { actor } = await signedInCustomer();
    const rooms = await myRecords.call({}, actor);
    expect(rooms.length).toBe(portalSections().length);
    // A customer with no history has rooms, all empty — which is what lets
    // the home page and the nav hide them rather than guess.
    expect(rooms.every((room) => room.count === 0)).toBe(true);
  });

  it("shows a customer the membership they are on, with a way in", async () => {
    const { contact, actor } = await signedInCustomer();
    const { subscribe, savePlan } = await import("@/modules/subscriptions/service");
    const { products, productVariants, priceLists, priceListEntries } = await import(
      "@/modules/catalog/schema"
    );
    const [product] = await db()
      .insert(products)
      .values({
        name: "Studio membership",
        slug: "studio-membership",
        kind: "digital",
        status: "active",
        publishedAt: new Date(),
      })
      .returning();
    const [variant] = await db()
      .insert(productVariants)
      .values({
        productId: product!.id,
        combinationKey: "default",
        sku: "mem-1",
        isDefault: true,
      })
      .returning();
    const [list] = await db()
      .insert(priceLists)
      .values({ name: "CAD", currency: "CAD", active: true })
      .returning();
    await db().insert(priceListEntries).values({
      priceListId: list!.id,
      variantId: variant!.id,
      amountMinor: 2_500,
    });
    const plan = await savePlan.call(
      {
        productId: product!.id,
        name: "Monthly",
        interval: "month",
        status: "active",
      },
      OWNER,
    );
    const started = await subscribe.call({ contactId: contact.id, planId: plan.id }, OWNER);

    const rooms = await myRecords.call({ section: "subscriptions" }, actor);
    expect(rooms[0]?.failed).toBe(false);
    expect(rooms[0]?.records).toHaveLength(1);
    expect(rooms[0]?.records[0]?.id).toBe(started.subscription.id);
    expect(rooms[0]?.records[0]?.href).toBe(
      `/portal/subscriptions/${started.subscription.id}`,
    );
  });

  it("says nothing at all for a section nobody registered", async () => {
    const { actor } = await signedInCustomer();
    // Deliberately not a module name. This used to ask for "subscriptions",
    // which was true until C9.13 registered that room and turned the example
    // into a real one — so the name is now something no module will ever
    // claim, and the test keeps meaning what it was written to mean.
    const rooms = await myRecords.call({ section: "no-such-room" }, actor);
    // Not an error: the honest answer is that there is no such room rather
    // than that something went wrong.
    expect(rooms).toEqual([]);
  });
});

/**
 * The contract-layer change C8.11 needed, tested where it lives.
 *
 * `selfService` is the only thing in the permission model that lets a
 * customer past a `scoped` service, so these are about the boundary rather
 * than about the portal: they call the owner's service directly, as a
 * customer, the way an HTTP request would.
 */
describe.runIf(hasDatabase)("self-service permission", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("lets a customer run the owner's query about themselves", async () => {
    const { contact, actor } = await signedInCustomer();
    const { listQuotes, createQuote } = await import("@/modules/quotes/service");
    await createQuote.call(
      { contactId: contact.id, title: "Mine", currency: "CAD" },
      OWNER,
    );
    // The same service the owner calls, with the same filter.
    const rows = await listQuotes.call({ contactId: contact.id }, actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Mine");
  });

  it("refuses a customer asking about somebody else", async () => {
    const { actor } = await signedInCustomer();
    const other = await otherCustomer("sam@example.test");
    const { listQuotes } = await import("@/modules/quotes/service");
    const error = await failure(listQuotes.call({ contactId: other.id }, actor));
    expect(error.code).toBe("permission");
  });

  it("refuses a customer who names no contact at all", async () => {
    // The one that matters most. `contactId` is optional on these services
    // and an absent filter means everybody, so treating a missing field as
    // harmless would hand a customer the whole table.
    const { actor } = await signedInCustomer();
    const { listQuotes } = await import("@/modules/quotes/service");
    const error = await failure(listQuotes.call({}, actor));
    expect(error.code).toBe("permission");
  });

  it("does not open anything a service did not opt into", async () => {
    // `quotes.get` is scoped and has no selfService, so it stays shut even
    // for the customer the quote is about. Opting in is per service.
    const { contact, actor } = await signedInCustomer();
    const { createQuote, getQuote } = await import("@/modules/quotes/service");
    const quote = await createQuote.call(
      { contactId: contact.id, title: "Mine", currency: "CAD" },
      OWNER,
    );
    const error = await failure(getQuote.call({ id: quote.id }, actor));
    expect(error.code).toBe("permission");
  });

  it("leaves the owner's own access exactly as it was", async () => {
    const { contact } = await signedInCustomer();
    const { listQuotes, createQuote } = await import("@/modules/quotes/service");
    await createQuote.call(
      { contactId: contact.id, title: "Mine", currency: "CAD" },
      OWNER,
    );
    // Staff still read across contacts, with no filter, as before.
    const all = await listQuotes.call({}, OWNER);
    expect(all).toHaveLength(1);
  });
});
