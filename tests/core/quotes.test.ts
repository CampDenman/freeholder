// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The quote pipeline (C6.12, MASTER.md §4.3).
//
// Three claims, and each one is what turns a quote from a message into a
// document:
//
//   1. **A quote is a sequence of offers.** Revising writes a new version and
//      leaves the old one readable, so "but you quoted me £4,000" is
//      answerable from the database rather than from anybody's memory.
//   2. **A live quote cannot be silently edited.** Once it is with the
//      customer, the only way to change it is a revision they can see.
//   3. **Acceptance freezes what was accepted.** Optional lines make the total
//      a function of what the customer chose, so revising afterwards must not
//      change what they said yes to.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { quoteItems, quotes } from "@/modules/quotes/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  acceptQuote,
  chooseQuoteOptions,
  createQuote,
  declineQuote,
  expireQuotes,
  getQuote,
  listQuotes,
  markQuoteViewed,
  postQuoteMessage,
  quoteByToken,
  reviseQuote,
  sendQuote,
  setQuoteItems,
} from "@/modules/quotes/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ANON = { kind: "anonymous" } as const;

describe.runIf(hasDatabase)("quotes", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function contactId(): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  /** A drafted quote with one required line and one optional extra. */
  async function drafted(overrides: Record<string, unknown> = {}) {
    const quote = await createQuote.call(
      {
        contactId: await contactId(),
        title: "Kitchen refit",
        currency: "GBP",
        ...overrides,
      },
      OWNER,
    );
    await setQuoteItems.call(
      {
        id: quote.id,
        items: [
          { description: "Units and worktop", unitPriceMinor: 400_000 },
          { description: "Splashback tiling", unitPriceMinor: 60_000, optional: true },
        ],
      },
      OWNER,
    );
    return quote;
  }

  async function sent(overrides: Record<string, unknown> = {}) {
    const quote = await drafted(overrides);
    const live = await sendQuote.call({ id: quote.id }, OWNER);
    return { quote, token: live.viewToken };
  }

  it("numbers quotes so an owner can say one out loud", async () => {
    const first = await createQuote.call(
      { contactId: await contactId(), title: "One", currency: "GBP" },
      OWNER,
    );
    const second = await createQuote.call(
      { contactId: await contactId(), title: "Two", currency: "GBP" },
      OWNER,
    );
    expect(first.reference).toBe("Q-0001");
    expect(second.reference).toBe("Q-0002");
  });

  // Three figures rather than one: what they must take, what they have chosen,
  // and what is still on the table. Collapsing them is what makes an owner
  // wonder why the number moved.
  it("counts an optional line only when it is chosen", async () => {
    const quote = await drafted();
    const full = await getQuote.call({ id: quote.id }, OWNER);
    expect(full?.totals).toMatchObject({
      requiredMinor: 400_000,
      optionalSelectedMinor: 60_000,
      totalMinor: 460_000,
    });

    const { token } = await sent();
    await chooseQuoteOptions.call({ token, selectedItemIds: [] }, ANON);
    const after = await quoteByToken.call({ token }, ANON);
    expect(after?.totals).toMatchObject({
      requiredMinor: 400_000,
      optionalSelectedMinor: 0,
      optionalAvailableMinor: 60_000,
      totalMinor: 400_000,
    });
  });

  it("refuses to send an offer with nothing in it", async () => {
    const quote = await createQuote.call(
      { contactId: await contactId(), title: "Empty", currency: "GBP" },
      OWNER,
    );
    const refused = await failure(sendQuote.call({ id: quote.id }, OWNER));
    expect(refused.message).toContain("at least one line");
  });

  // The rule that makes a quote a document: once it is with the customer, the
  // only way to change it is a revision they can see.
  it("will not let a sent quote be edited behind the customer's back", async () => {
    const { quote } = await sent();
    const refused = await failure(
      setQuoteItems.call(
        { id: quote.id, items: [{ description: "Cheaper", unitPriceMinor: 100 }] },
        OWNER,
      ),
    );
    expect(refused.message).toContain("Revise it instead");
  });

  it("keeps the earlier offer readable after a revision", async () => {
    const { quote } = await sent();
    const revised = await reviseQuote.call(
      {
        id: quote.id,
        items: [{ description: "Units and worktop", unitPriceMinor: 380_000 }],
      },
      OWNER,
    );
    expect(revised.version).toBe(2);
    expect(revised.totals.totalMinor).toBe(380_000);

    const full = await getQuote.call({ id: quote.id }, OWNER);
    // The old lines are still there, at the old price, under version 1.
    expect(full?.history.map((line) => line.unitPriceMinor)).toContain(400_000);
    expect(full?.items.every((line) => line.version === 2)).toBe(true);
  });

  it("keeps the link the customer already has working across a revision", async () => {
    const { quote, token } = await sent();
    await reviseQuote.call(
      { id: quote.id, items: [{ description: "Revised", unitPriceMinor: 1_000 }] },
      OWNER,
    );
    const seen = await quoteByToken.call({ token }, ANON);
    // The same link, the new version. A fresh link would strand the email.
    expect(seen).toMatchObject({ version: 2, status: "sent" });
    expect(seen?.items).toHaveLength(1);
  });

  // §4.3's state machine has `viewed` because it is the first signal an owner
  // gets that the offer landed. A false one is worse than none, which is why
  // reading it in the admin never marks it.
  it("records the first view once, and not on every refresh", async () => {
    const { token } = await sent();
    const first = await markQuoteViewed.call({ token }, ANON);
    expect(first.firstView).toBe(true);
    const again = await markQuoteViewed.call({ token }, ANON);
    expect(again.firstView).toBe(false);

    const [row] = await db().select().from(quotes);
    expect(row!.status).toBe("viewed");
    expect(row!.firstViewedAt).toBeTruthy();
  });

  it("moves into negotiation when the customer asks something", async () => {
    const { quote, token } = await sent();
    await postQuoteMessage.call({ token, body: "Can you do it for less?" }, ANON);
    const [row] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row!.status).toBe("negotiating");

    // The owner's reply does not, because a reply is not a new question.
    await postQuoteMessage.call({ quoteId: quote.id, body: "I can revise it." }, OWNER);
    const [after] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(after!.status).toBe("negotiating");
  });

  // A counter-offer is a message. Only the owner turns one into a revision,
  // which is what keeps the price the business's to set.
  it("carries what the customer proposed without applying it", async () => {
    const { quote, token } = await sent();
    await postQuoteMessage.call(
      { token, body: "Drop the tiling?", proposedChanges: { removeOptional: true } },
      ANON,
    );
    const full = await getQuote.call({ id: quote.id }, OWNER);
    expect(full?.messages[0]?.proposedChanges).toMatchObject({ removeOptional: true });
    // The price has not moved.
    expect(full?.totals.totalMinor).toBe(460_000);
  });

  it("freezes what was accepted, and spends the link", async () => {
    const { quote, token } = await sent();
    const accepted = await acceptQuote.call({ token, acceptedName: "Rae Lane" }, ANON);
    expect(accepted.totalMinor).toBe(460_000);

    const [row] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row!.status).toBe("accepted");
    expect(row!.acceptedSnapshot).toMatchObject({
      version: 1,
      acceptedName: "Rae Lane",
    });
    // An offer that has become an agreement is no longer an offer.
    expect(row!.viewToken).toBeNull();
    const spent = await failure(
      acceptQuote.call({ token, acceptedName: "Somebody Else" }, ANON),
    );
    expect(spent.code).toBe("not_found");
  });

  it("holds what was agreed when the quote is revised afterwards", async () => {
    const { quote, token } = await sent();
    await acceptQuote.call({ token, acceptedName: "Rae Lane" }, ANON);
    const refused = await failure(
      reviseQuote.call(
        { id: quote.id, items: [{ description: "More", unitPriceMinor: 900_000 }] },
        OWNER,
      ),
    );
    // What was agreed happened. The honest move is a new quote.
    expect(refused.message).toContain("cannot be revised");
    const [row] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect((row!.acceptedSnapshot as { totals: { totalMinor: number } }).totals.totalMinor)
      .toBe(460_000);
  });

  it("accepts only what the customer actually chose", async () => {
    const { token } = await sent();
    await chooseQuoteOptions.call({ token, selectedItemIds: [] }, ANON);
    const accepted = await acceptQuote.call({ token, acceptedName: "Rae Lane" }, ANON);
    expect(accepted.totalMinor).toBe(400_000);

    const [row] = await db().select().from(quotes);
    const snapshot = row!.acceptedSnapshot as { items: { description: string }[] };
    // The line they turned off is not in what they agreed to.
    expect(snapshot.items.map((line) => line.description)).toEqual(["Units and worktop"]);
  });

  it("lets a declined quote be revised and offered again", async () => {
    const { quote, token } = await sent();
    await declineQuote.call({ token, reason: "Too expensive." }, ANON);
    const [declined] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(declined).toMatchObject({ status: "declined", declineReason: "Too expensive." });
    // The token survives a decline on purpose: a revision is the usual reply
    // to "too expensive", and the link they already have should open it.
    expect(declined!.viewToken).toBeTruthy();

    const revised = await reviseQuote.call(
      { id: quote.id, items: [{ description: "Trimmed", unitPriceMinor: 300_000 }] },
      OWNER,
    );
    expect(revised).toMatchObject({ status: "sent", version: 2, declineReason: null });
    const seen = await quoteByToken.call({ token }, ANON);
    expect(seen?.open).toBe(true);
  });

  // A job that runs hourly must not be what decides whether a price still
  // stands, so acceptance checks the date itself.
  it("refuses an expired quote at the moment somebody accepts it", async () => {
    const { token } = await sent({
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    await db()
      .update(quotes)
      .set({ validUntil: new Date(Date.now() - 60_000) });
    const refused = await failure(acceptQuote.call({ token, acceptedName: "Rae" }, ANON));
    expect(refused.message).toContain("expired");
  });

  it("sweeps lapsed quotes onto a list somebody can follow up", async () => {
    await sent({ validUntil: new Date(Date.now() + 60_000).toISOString() });
    await db()
      .update(quotes)
      .set({ validUntil: new Date(Date.now() - 60_000) });
    const swept = await expireQuotes.call({}, OWNER);
    expect(swept.expired).toBe(1);
    const lapsed = await listQuotes.call({ status: "expired" }, OWNER);
    expect(lapsed).toHaveLength(1);
  });

  it("never puts the view token in a list", async () => {
    await sent();
    const listed = await listQuotes.call({}, OWNER);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("viewToken");
    // The total is there, though: a pipeline with no numbers on it is a list
    // of names.
    expect(listed[0]?.totalMinor).toBe(460_000);
  });

  it("does not show the customer what the business wrote about them", async () => {
    const { token } = await sent({ notes: "Chased twice, slow payer." });
    const seen = await quoteByToken.call({ token }, ANON);
    expect(JSON.stringify(seen)).not.toContain("slow payer");
  });

  it("keeps the offer and forgets the person", async () => {
    const { quote, token } = await sent({ notes: "Private note." });
    await postQuoteMessage.call({ token, body: "A question." }, ANON);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.quotes");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, quote.contactId, { requestId: "t" }));

    const [after] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    // The business's own record of what it offered survives — its pipeline,
    // its win rate, its accounts. What it wrote about them does not.
    expect(after).toMatchObject({ notes: null, viewToken: null });
    const lines = await db().select().from(quoteItems).where(eq(quoteItems.quoteId, quote.id));
    expect(lines).toHaveLength(2);
  });

  it("moves an offer to the record that survives a merge", async () => {
    const { quote } = await sent();
    const [before] = await db()
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, quote.contactId));
    expect(before).toBeTruthy();
    const { contactReferences } = await import("@/core/contacts/service");
    expect(contactReferences().some((one) => one.table === "quotes")).toBe(true);
  });
});
