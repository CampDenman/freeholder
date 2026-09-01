// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Visit → lead → quote/booking/cart → invoice → paid (MASTER.md §4.7, C9.07).
//
// The test worth reading first is the one about a visitor who identifies
// afterwards: the funnel counts *people*, and a person who was a stranger on
// Monday and a customer on Friday must be one row in both bands rather than
// two in one.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { analyticsEvents } from "@/modules/analytics/schema";
import { funnel, funnelDefinitions } from "@/modules/analytics/service";
import { resolveContact } from "@/core/contacts/service";
import { invoices } from "@/modules/invoicing/schema";
import { quotes } from "@/modules/quotes/schema";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const now = () => new Date();
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

async function person(name: string) {
  const { contact } = await resolveContact.call(
    { email: `${name}@example.test`, name },
    OWNER,
  );
  return contact;
}

/** One pageview, by a visitor who may or may not be known yet. */
async function visited(anonId: string, contactId: string | null, at = now()) {
  await db().insert(analyticsEvents).values({
    anonId,
    sessionId: `session-${anonId}`,
    contactId,
    name: "pageview",
    path: "/",
    at,
  });
}

function band(result: Awaited<ReturnType<typeof funnel.call>>, key: string) {
  return result.bands.find((each) => each.band === key);
}

describe.runIf(hasDatabase)("the funnel", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("counts a stranger and a customer as one person each", async () => {
    const known = await person("known");
    await visited("anon-1", null);
    await visited("anon-1", null);
    await visited("anon-2", known.id);

    const result = await funnel.call({ days: 30 }, OWNER);
    // Two visitors, not three pageviews.
    expect(band(result, "visit")!.people).toBe(2);
  });

  it("counts a visitor who identifies later as the person they turned out to be", async () => {
    // `analytics.identify` backfills the contact id across everything that
    // visitor did before. Without that the same human would be two rows here:
    // a stranger and a customer, and every conversion rate would be wrong.
    const later = await person("later");
    await visited("anon-3", null, ago(2));
    await db()
      .update(analyticsEvents)
      .set({ contactId: later.id });

    const result = await funnel.call({ days: 30 }, OWNER);
    expect(band(result, "visit")!.people).toBe(1);
  });

  it("does not count bots as people", async () => {
    await db().insert(analyticsEvents).values({
      anonId: "crawler",
      sessionId: "s",
      name: "pageview",
      path: "/",
      visitorKind: "bot",
    });
    await visited("anon-4", null);

    const result = await funnel.call({ days: 30 }, OWNER);
    expect(band(result, "visit")!.people).toBe(1);
  });

  it("reports how many of a band were also in the one before it", async () => {
    // The honest caveat made checkable. These are period counts, so somebody
    // can reach a later band without appearing in an earlier one — a walk-in
    // who never saw the website. `fromPrevious` is how an owner tells the
    // difference between people moving along and two adjacent populations.
    const visitor = await person("visitor");
    const walkIn = await person("walkin");
    await visited("anon-5", visitor.id);

    await db().insert(quotes).values([
      {
        contactId: visitor.id,
        reference: "Q-1",
        title: "Something",
        currency: "CAD",
        status: "sent",
        sentAt: now(),
      },
      {
        contactId: walkIn.id,
        reference: "Q-2",
        title: "Something else",
        currency: "CAD",
        status: "sent",
        sentAt: now(),
      },
    ]);

    const result = await funnel.call({ days: 30 }, OWNER);
    const interest = band(result, "interest")!;
    expect(interest.people).toBe(2);
    // Both were quoted; only one of them ever visited.
    expect(interest.previousBand).toBe("lead");
    expect(interest.fromPrevious).toBe(2);

    const visits = band(result, "visit")!;
    expect(visits.people).toBe(1);
  });

  it("counts each person once across the stages of a band", async () => {
    // Somebody who was quoted *and* booked is one person in the interest band
    // and two rows beneath it. A band that added its stages up would double
    // count the customers who engage most.
    const busy = await person("busy");
    await db().insert(quotes).values({
      contactId: busy.id,
      reference: "Q-3",
      title: "A quote",
      currency: "CAD",
      status: "sent",
      sentAt: now(),
    });
    await db().insert(invoices).values({
      contactId: busy.id,
      number: "INV-1",
      sequenceKey: "default",
      idempotencyKey: "test-invoice-1",
      requestHash: "a".repeat(64),
      currency: "CAD",
      status: "sent",
      issuedAt: now(),
    });

    const result = await funnel.call({ days: 30 }, OWNER);
    expect(band(result, "interest")!.people).toBe(1);
    expect(band(result, "committed")!.people).toBe(1);
  });

  it("keeps a refund out of the conversion chain", async () => {
    // A refund is what happens after the funnel. If it were a sixth step, the
    // band before it would be its denominator and a business would appear to
    // "convert" customers into refunds.
    const result = await funnel.call({ days: 30 }, OWNER);
    const returned = result.bands.find((each) => each.band === "returned");
    if (returned) expect(returned.previousBand).not.toBe("returned");
    const order = result.bands.map((each) => each.band);
    expect(order.indexOf("returned")).toBe(order.length - 1);
  });

  it("respects the window", async () => {
    await visited("anon-old", null, ago(100));
    await visited("anon-new", null, ago(1));

    expect(band(await funnel.call({ days: 7 }, OWNER), "visit")!.people).toBe(1);
    expect(band(await funnel.call({ days: 365 }, OWNER), "visit")!.people).toBe(2);
  });

  it("says what every number is made of", async () => {
    // C9.07's inspectable definitions. A stage that appears in the funnel and
    // not here would be a number with no explanation attached.
    const definitions = await funnelDefinitions.call({}, OWNER);
    const result = await funnel.call({ days: 30 }, OWNER);

    const explained = new Set(definitions.stages.map((each) => each.key));
    for (const each of result.bands.flatMap((one) => one.stages)) {
      expect(explained.has(each.key)).toBe(true);
    }
    // Every stage names the module answerable for it, so a number an owner
    // disputes has somewhere to go.
    expect(definitions.stages.every((each) => each.module.length > 0)).toBe(true);
    expect(definitions.attribution.map((each) => each.model)).toEqual([
      "first_touch",
      "last_touch",
    ]);
  });
});
