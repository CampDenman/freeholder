// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Loyalty (MASTER.md §4.13, C9.11).
//
// One test per rule §4.13 states. The listener is driven the way the bus
// drives it — a spine row, then the topic and its payload — rather than by
// calling an internal function, because the thing worth proving is that
// loyalty earns from the contact's history without commerce knowing it
// exists, and a test that reached past the spine would prove the opposite.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { loyaltyAccounts, pointsLedger } from "@/modules/loyalty/schema";
import {
  adjustPoints,
  enrol,
  liability,
  onSpineEvent,
  pointsFor,
  programs,
  saveEarnRule,
  saveProgram,
  statementFor,
} from "@/modules/loyalty/service";
import { runPointsExpiry } from "@/modules/loyalty/jobs";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function customer(email = "rae@example.test") {
  // `contacts.resolve` answers with what it did as well as with the row —
  // automated paths call it rather than `contacts.create` (§4.1).
  const { contact } = await resolveContact.call({ email, name: "Rae" }, OWNER);
  return contact;
}

/** A programme that is on and enrols anybody who transacts. */
async function activeProgram(overrides: Record<string, unknown> = {}) {
  return saveProgram.call(
    {
      name: "Stars",
      pointsLabel: "stars",
      status: "active",
      earnCurrency: "CAD",
      redemptionValueCents: 2,
      enrolment: "automatic",
      ...overrides,
    },
    OWNER,
  );
}

/**
 * Write the spine row an emitting mutation would have written, then hand the
 * bus event to the listener exactly as the outbox would.
 */
async function spineEvent(opts: {
  contactId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
  topic: string;
  busPayload: Record<string, unknown>;
}) {
  await db().insert(timelineEvents).values({
    contactId: opts.contactId,
    actor: "system",
    eventType: opts.eventType,
    subjectType: opts.subjectType,
    subjectId: opts.subjectId,
    payload: opts.payload ?? {},
  });
  await onSpineEvent(opts.busPayload, opts.topic);
}

const ORDER = "11111111-1111-4111-8111-111111111111";

async function orderPaid(contactId: string, totalMinor: number, orderId = ORDER) {
  await spineEvent({
    contactId,
    eventType: "order.paid",
    subjectType: "order",
    subjectId: orderId,
    payload: { totalMinor, currency: "CAD" },
    topic: "catalog.orderPaid",
    busPayload: { orderId },
  });
}

async function ledgerFor(contactId: string) {
  const [account] = await db()
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.contactId, contactId));
  if (!account) return [];
  return db().select().from(pointsLedger).where(eq(pointsLedger.accountId, account.id));
}

describe.runIf(hasDatabase)("loyalty", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("earns from the contact's history, not from a call by commerce", async () => {
    // §4.13: "Earning is a listener on spine events, never a call from inside
    // another module … Commerce does not know loyalty exists." Nothing in this
    // test imports catalog, and loyalty's manifest requires only core.
    const program = await activeProgram();
    const contact = await customer();
    await saveEarnRule.call(
      {
        programId: program.id,
        name: "A star per dollar",
        eventType: "order.paid",
        formula: "per_currency_unit",
        points: 1,
      },
      OWNER,
    );

    await orderPaid(contact.id, 4150);

    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    // £41.50 at one per major unit is 41, truncated. A customer who sees 41
    // for 41.50 understands it; one who sees 42 asks where it came from.
    expect(statement?.balance).toBe(41);
    expect(statement?.entries[0]!.reason).toBe("earn");
  });

  it("explains the balance it reports", async () => {
    const program = await activeProgram();
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 10 },
      OWNER,
    );
    await orderPaid(contact.id, 500);

    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    // The balance and its workings come back together, because a number
    // returned without them is the thing customers stop believing.
    expect(statement?.balance).toBe(10);
    expect(statement!.entries).toHaveLength(1);
    expect(statement!.entries[0]!.delta).toBe(10);
    expect(statement!.entries[0]!.ruleName).toBe("Flat");
  });

  it("does not pay twice for one order when a delivery is retried", async () => {
    const program = await activeProgram();
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 10 },
      OWNER,
    );

    await orderPaid(contact.id, 500);
    // The outbox retries. "We paid you twice for one order" is a harder
    // conversation than "we have not paid you yet".
    await onSpineEvent({ orderId: ORDER }, "catalog.orderPaid");
    await onSpineEvent({ orderId: ORDER }, "catalog.orderPaid");

    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    expect(statement?.balance).toBe(10);
  });

  it("caps what one rule can pay one contact in a period", async () => {
    // §4.13: "Fraud is bounded by rules, not vigilance."
    const program = await activeProgram();
    const contact = await customer();
    await saveEarnRule.call(
      {
        programId: program.id,
        name: "Capped",
        eventType: "order.paid",
        formula: "per_currency_unit",
        points: 1,
        capPerPeriod: 30,
        capPeriodDays: 30,
      },
      OWNER,
    );

    await orderPaid(contact.id, 2000, "22222222-2222-4222-8222-222222222222");
    await orderPaid(contact.id, 2000, "33333333-3333-4333-8333-333333333333");

    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    // 20 then 10, not 20 then 20: the second earn is trimmed to the headroom
    // rather than refused outright, because a partial reward is honest and a
    // silent zero is not.
    expect(statement?.balance).toBe(30);
  });

  it("reverses an earn without deleting it", async () => {
    // §4.13: "A refund reverses the earn. Reversal writes a negative row
    // citing the original; it never deletes history."
    const program = await activeProgram();
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 25 },
      OWNER,
    );
    await orderPaid(contact.id, 5000);

    await spineEvent({
      contactId: contact.id,
      eventType: "order.cancelled",
      subjectType: "order",
      subjectId: ORDER,
      topic: "catalog.orderCancelled",
      busPayload: { orderId: ORDER },
    });

    const rows = await ledgerFor(contact.id);
    expect(rows).toHaveLength(2);
    const earn = rows.find((r) => r.reason === "earn")!;
    const reversal = rows.find((r) => r.reason === "reverse")!;
    expect(earn.delta).toBe(25);
    expect(reversal.delta).toBe(-25);
    // It cites what it reversed, so the history reads as what happened.
    expect(reversal.reversesId).toBe(earn.id);

    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    expect(statement?.balance).toBe(0);
  });

  it("does not reverse the same earn twice", async () => {
    const program = await activeProgram();
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 25 },
      OWNER,
    );
    await orderPaid(contact.id, 5000);
    await spineEvent({
      contactId: contact.id,
      eventType: "order.cancelled",
      subjectType: "order",
      subjectId: ORDER,
      topic: "catalog.orderCancelled",
      busPayload: { orderId: ORDER },
    });
    await onSpineEvent({ orderId: ORDER }, "catalog.orderCancelled");

    const rows = await ledgerFor(contact.id);
    expect(rows.filter((r) => r.reason === "reverse")).toHaveLength(1);
  });

  it("refuses an expiry policy that gives no notice", async () => {
    // §4.13: "the platform refuses to configure an expiry with no notice."
    // The refusal is in the contract, so there is no handler to forget it.
    const error = await failure(
      saveProgram.call(
        {
          name: "Stars",
          status: "active",
          expiryPolicy: { kind: "inactivity", days: 365 } as never,
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("gives notice before it expires anything", async () => {
    const program = await activeProgram({
      expiryPolicy: { kind: "inactivity", days: 30, noticeDays: 7 },
    });
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 40 },
      OWNER,
    );
    await orderPaid(contact.id, 1000);

    // Make the account dormant enough to be warned and to be expired.
    const [account] = await db()
      .select({ id: loyaltyAccounts.id })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, contact.id));
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await db()
      .update(loyaltyAccounts)
      .set({ lastActivityAt: longAgo })
      .where(eq(loyaltyAccounts.id, account!.id));

    const first = await runPointsExpiry();
    expect(first.noticed).toBe(1);
    expect(first.expired).toBe(0);

    // Still nothing gone: the notice period has not elapsed since the notice,
    // and a job that noticed and expired in one pass would satisfy the letter
    // of "gives notice first" and none of its purpose.
    let statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    expect(statement?.balance).toBe(40);

    // Age the notice past its period, then run again.
    await db()
      .update(pointsLedger)
      .set({ at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(and(eq(pointsLedger.accountId, account!.id), eq(pointsLedger.delta, 0)));
    await db()
      .update(loyaltyAccounts)
      .set({ lastActivityAt: longAgo })
      .where(eq(loyaltyAccounts.id, account!.id));

    const second = await runPointsExpiry();
    expect(second.expired).toBe(1);
    expect(second.pointsExpired).toBe(40);

    statement = await statementFor.call({ contactId: contact.id, programId: program.id }, OWNER);
    expect(statement?.balance).toBe(0);
    // It fell because a row says so, and the customer can see which row.
    expect(statement!.entries.some((e) => e.reason === "expire" && e.delta === -40)).toBe(true);
  });

  it("will not enrol somebody into an opt-in programme behind their back", async () => {
    const program = await activeProgram({ enrolment: "opt_in" });
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 10 },
      OWNER,
    );

    await orderPaid(contact.id, 5000);

    const accounts = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, contact.id));
    expect(accounts).toHaveLength(0);

    // Once they do opt in, the same programme pays as normal.
    await enrol.call({ contactId: contact.id, programId: program.id }, OWNER);
    await orderPaid(contact.id, 5000, "44444444-4444-4444-8444-444444444444");
    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    expect(statement?.balance).toBe(10);
  });

  it("enrols once, however many times it is asked", async () => {
    const program = await activeProgram({ enrolment: "opt_in" });
    const contact = await customer();
    const first = await enrol.call({ contactId: contact.id, programId: program.id }, OWNER);
    const second = await enrol.call({ contactId: contact.id, programId: program.id }, OWNER);
    expect(first.alreadyEnrolled).toBe(false);
    expect(second.alreadyEnrolled).toBe(true);
    expect(second.accountId).toBe(first.accountId);
  });

  it("shows the owner what the outstanding points would cost", async () => {
    // §4.13: "A loyalty programme whose cost is invisible is how a business
    // gives away a margin it never measured."
    const program = await activeProgram({ redemptionValueCents: 2 });
    const contact = await customer();
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 150 },
      OWNER,
    );
    await orderPaid(contact.id, 1000);

    const owed = await liability.call({ programId: program.id }, OWNER);
    expect(owed.outstandingPoints).toBe(150);
    expect(owed.valueMinor).toBe(300);
    expect(owed.currency).toBe("CAD");
    expect(owed.accounts).toBe(1);
  });

  it("requires a reason for a manual adjustment", async () => {
    const program = await activeProgram({ enrolment: "opt_in" });
    const contact = await customer();
    const account = await enrol.call({ contactId: contact.id, programId: program.id }, OWNER);

    const error = await failure(
      adjustPoints.call({ accountId: account.accountId, delta: 50, note: "" }, OWNER),
    );
    expect(error.code).toBe("validation");

    const ok = await adjustPoints.call(
      { accountId: account.accountId, delta: 50, note: "Goodwill after a late delivery." },
      OWNER,
    );
    expect(ok.balance).toBe(50);
  });

  it("refuses a rule for an event nothing delivers", async () => {
    // A rule naming an undelivered event is a rule that silently never pays,
    // and an owner cannot tell that from one that has simply not triggered.
    const program = await activeProgram();
    const error = await failure(
      saveEarnRule.call(
        {
          programId: program.id,
          name: "Birthday",
          eventType: "contact.birthday",
          formula: "fixed",
          points: 50,
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("keeps a programme's own doors shut to an anonymous caller", async () => {
    const error = await failure(programs.call({}, ANONYMOUS));
    expect(error.code).toBe("permission");
  });

  it("computes points the way the formulas say", () => {
    expect(pointsFor("fixed", 10, 999999)).toBe(10);
    expect(pointsFor("per_currency_unit", 1, 4150)).toBe(41);
    expect(pointsFor("per_currency_unit", 2, 4150)).toBe(82);
    // A refund's negative amount still describes the same size of purchase.
    expect(pointsFor("per_currency_unit", 1, -4150)).toBe(41);
    expect(pointsFor("multiplier", 3, 1000)).toBe(30);
  });

  it("moves the ledger when two contacts merge, so points are not lost", async () => {
    const program = await activeProgram();
    const keep = await customer("rae@example.test");
    const dupe = await customer("rae.other@example.test");
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 10 },
      OWNER,
    );
    await orderPaid(keep.id, 100, "55555555-5555-4555-8555-555555555555");
    await orderPaid(dupe.id, 100, "66666666-6666-4666-8666-666666666666");

    const { mergeContacts } = await import("@/core/contacts/service");
    await mergeContacts.call({ duplicateId: dupe.id, survivingId: keep.id }, OWNER);

    const statement = await statementFor.call(
      { contactId: keep.id, programId: program.id },
      OWNER,
    );
    // Both earns survive on the surviving contact. This is exactly why the
    // ledger is the record and the balance is not.
    expect(statement?.balance).toBe(20);
    expect(statement!.entries).toHaveLength(2);

    const orphaned = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, dupe.id));
    expect(orphaned).toHaveLength(0);

    const stillThere = await db().select().from(contacts).where(eq(contacts.id, keep.id));
    expect(stillThere).toHaveLength(1);
  });
});
