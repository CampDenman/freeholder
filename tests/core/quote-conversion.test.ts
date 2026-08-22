// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What an accepted quote becomes (C6.13, MASTER.md §4.3).
//
// Three claims, and the middle one is the one the checklist item names:
//
//   1. **Atomically.** One transaction produces the project, the agreement,
//      the bookings and the invoices, or produces none of them.
//   2. **Without copied customer identities.** Every record points at the same
//      contact the quote already had. There is exactly one contact row
//      afterwards — proved by counting, because this is the moment a system is
//      most tempted to invent a "billing contact".
//   3. **Converting twice is refused.** A second conversion is a second
//      invoice for one job, which is the mistake an owner hears about from a
//      customer rather than from a screen.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { bookings } from "@/core/scheduling/schema";
import { contractDocuments } from "@/modules/contracts/schema";
import { invoices } from "@/modules/invoicing/schema";
import { projectLinks, projects } from "@/modules/projects/schema";
import { quotes } from "@/modules/quotes/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createCalendar } from "@/core/scheduling/service";
import { saveTemplate } from "@/modules/contracts/template-service";
import {
  acceptQuote,
  createQuote,
  sendQuote,
  setQuoteItems,
} from "@/modules/quotes/service";
import { convertQuote, setQuoteConversion } from "@/modules/quotes/conversion";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ANON = { kind: "anonymous" } as const;

describe.runIf(hasDatabase)("turning an accepted quote into work", { timeout: 90_000 }, () => {
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

  const PLAN = {
    project: true,
    contractTemplateId: null as string | null,
    deposit: true,
    balance: true,
    bookings: [] as { calendarId: string; startsAt: string; endsAt: string }[],
  };

  /**
   * An accepted quote: £4,000 of work with a £1,000 deposit.
   *
   * Accepting is where conversion happens, so the plan is set *before* the
   * quote goes out — which is how an owner actually works, and why the tests
   * below read the result from the database rather than from a return value.
   */
  async function accepted(
    overrides: Record<string, unknown> = {},
    plan: Partial<typeof PLAN> = {},
  ) {
    const quote = await createQuote.call(
      {
        contactId: await contactId(),
        title: "Kitchen refit",
        currency: "GBP",
        depositMinor: 100_000,
        ...overrides,
      },
      OWNER,
    );
    await setQuoteItems.call(
      {
        id: quote.id,
        items: [{ description: "Units and worktop", unitPriceMinor: 400_000 }],
      },
      OWNER,
    );
    await setQuoteConversion.call({ id: quote.id, plan: { ...PLAN, ...plan } }, OWNER);
    const live = await sendQuote.call({ id: quote.id }, OWNER);
    await acceptQuote.call({ token: live.viewToken, acceptedName: "Rae Lane" }, ANON);
    return quote;
  }

  /** The project acceptance produced, if it produced one. */
  async function projectOf(): Promise<typeof projects.$inferSelect | undefined> {
    const [only] = await db().select().from(projects);
    return only;
  }

  // The line the checklist item names, proved by counting rather than by
  // reading: this is the moment a system is most tempted to invent a second
  // "billing contact".
  it("puts every record on the same person, and makes no second one", async () => {
    await accepted();

    const people = await db().select({ id: contacts.id }).from(contacts);
    expect(people).toHaveLength(1);
    const only = people[0]!.id;

    expect((await projectOf())!.contactId).toBe(only);
    const raised = await db().select({ contactId: invoices.contactId }).from(invoices);
    expect(raised).toHaveLength(2);
    for (const invoice of raised) expect(invoice.contactId).toBe(only);
  });

  it("raises the deposit and the balance, and nothing in between", async () => {
    await accepted();

    const raised = await db()
      .select({
        id: invoices.id,
        sourceType: invoices.sourceType,
        totalMinor: invoices.totalMinor,
      })
      .from(invoices);
    const deposit = raised.find((row) => row.sourceType === "deposit");
    const balance = raised.find((row) => row.sourceType === "balance");
    expect(deposit?.totalMinor).toBe(100_000);
    // £4,000 accepted less the £1,000 deposit. The two add to the total and
    // neither restates it.
    expect(balance?.totalMinor).toBe(300_000);
  });

  it("raises one invoice for the accepted lines when there is no deposit", async () => {
    await accepted({ depositMinor: null });
    const [only] = await db()
      .select({ sourceType: invoices.sourceType, totalMinor: invoices.totalMinor })
      .from(invoices);
    expect(only).toMatchObject({ sourceType: "quote", totalMinor: 400_000 });
  });

  it("gathers the job into a project with the quote attached to it", async () => {
    await accepted();
    const project = await projectOf();
    // A converted quote is work that is going ahead, not an enquiry.
    expect(project).toMatchObject({ title: "Kitchen refit", status: "active" });

    const links = await db()
      .select()
      .from(projectLinks)
      .where(eq(projectLinks.projectId, project!.id));
    // The quote and both invoices, all as pointers.
    expect(links.map((link) => link.kind).sort()).toEqual([
      "invoice",
      "invoice",
      "quote",
    ]);
  });

  it("issues the agreement the plan asked for, against the job", async () => {
    const template = await saveTemplate.call(
      {
        name: "Build terms",
        kind: "agreement",
        title: "Terms for {{customer_name}}",
        body: "The work is as quoted.",
      },
      OWNER,
    );
    await accepted({}, { contractTemplateId: template.id });

    const [document] = await db().select().from(contractDocuments);
    // Hung off the project, so the signed agreement sits with the job.
    expect(document).toMatchObject({ subjectType: "project", status: "issued" });
    expect(document!.bodySnapshot).toContain("as quoted");
  });

  // A quote carries a price and a scope, never a date. Times come from the
  // owner, and a conversion that invented one would put a fiction in the diary.
  it("books only the times the owner actually gave it", async () => {
    const studio = await createCalendar.call(
      { kind: "resource", name: "Workshop", capacityDefault: 1, timezone: "Europe/London" },
      OWNER,
    );
    const startsAt = new Date(Date.now() + 7 * 86_400_000);
    await accepted(
      {},
      {
        bookings: [
          {
            calendarId: studio.id,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
          },
        ],
      },
    );

    const [booked] = await db()
      .select({ contactId: bookings.contactId, status: bookings.status })
      .from(bookings);
    expect(booked!.status).toBe("confirmed");
    // Still the same person: `bookings.create` takes an email because it was
    // written for a stranger, and resolving it returns the contact that
    // already exists rather than a second one.
    const people = await db().select({ id: contacts.id }).from(contacts);
    expect(people).toHaveLength(1);
    expect(booked!.contactId).toBe(people[0]!.id);
  });

  // The whole path, as a customer actually travels it: they click accept, and
  // by the time anybody looks the job exists. On the bus rather than inside
  // the acceptance, so a brief failure in invoicing could never roll back the
  // fact that they said yes.
  it("converts by itself when the customer accepts", async () => {
    const quote = await createQuote.call(
      {
        contactId: await contactId(),
        title: "Kitchen refit",
        currency: "GBP",
        depositMinor: 100_000,
      },
      OWNER,
    );
    await setQuoteItems.call(
      {
        id: quote.id,
        items: [{ description: "Units and worktop", unitPriceMinor: 400_000 }],
      },
      OWNER,
    );
    const live = await sendQuote.call({ id: quote.id }, OWNER);
    await acceptQuote.call({ token: live.viewToken, acceptedName: "Rae Lane" }, ANON);

    // Nothing else is called: the bus delivers `quote.accepted` after the
    // acceptance commits, and the conversion is a consequence of it.
    const [row] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row!.convertedAt).toBeTruthy();
    expect(await db().select().from(projects)).toHaveLength(1);
    expect(await db().select().from(invoices)).toHaveLength(2);
  });

  it("does nothing at all to a quote nobody has accepted", async () => {
    const quote = await createQuote.call(
      { contactId: await contactId(), title: "Not yet", currency: "GBP" },
      OWNER,
    );
    const refused = await failure(convertQuote.call({ id: quote.id }, OWNER));
    expect(refused.message).toContain("still open");
    expect(await db().select().from(invoices)).toHaveLength(0);
    expect(await db().select().from(projects)).toHaveLength(0);
  });

  it("refuses to convert the same quote twice", async () => {
    const quote = await accepted();
    // Acceptance already converted it, so an owner pressing convert is the
    // second attempt — which is exactly the case that must be refused.
    const again = await failure(convertQuote.call({ id: quote.id }, OWNER));
    expect(again.message).toContain("already been turned into work");
    // One job, one set of invoices — not two.
    expect(await db().select().from(invoices)).toHaveLength(2);
    expect(await db().select().from(projects)).toHaveLength(1);
  });

  it("records when it became work", async () => {
    const quote = await accepted();
    const [row] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row!.convertedAt).toBeTruthy();
  });

  // A quote whose plan asks for nothing is a quote an owner wants recorded and
  // invoiced by hand. Refusing it would make the plan a requirement rather
  // than a choice.
  it("converts to nothing when the plan asks for nothing", async () => {
    await accepted({}, { project: false, deposit: false, balance: false });
    expect(await db().select().from(invoices)).toHaveLength(0);
    expect(await db().select().from(projects)).toHaveLength(0);
  });
});
