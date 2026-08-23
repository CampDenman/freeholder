// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Tracking hours, and billing them once (C6.16, MASTER.md §4.13).
//
// §4.13: a time entry is "the difference between an owner billing what they
// worked and billing what they remember." Three properties make that true:
//
//   1. **The rate is frozen at the entry.** Putting a rate up in March must
//      not re-price February's work.
//   2. **An hour is billed once.** `invoiceId` is set and never cleared, and
//      the conversion refuses anything that already has one.
//   3. **The timer cannot double-count.** One running entry per person,
//      enforced in the database rather than by the screen.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { invoices } from "@/modules/invoicing/schema";
import { timeEntries } from "@/modules/projects/time-schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createProject } from "@/modules/projects/service";
import {
  amountFor,
  hoursAndMinutes,
  invoiceTime,
  listTimeEntries,
  logTime,
  removeTimeEntry,
  setTimeRate,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from "@/modules/projects/time-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("what an hour comes to", () => {
  it("charges minutes at an hourly rate without floating point", () => {
    // £60/hour: half an hour is £30, ninety minutes is £90.
    expect(amountFor(30, 6_000)).toBe(3_000);
    expect(amountFor(90, 6_000)).toBe(9_000);
    // Rounded once, at the end: 7 minutes at £60 is £7.00, not £6.999…
    expect(amountFor(7, 6_000)).toBe(700);
  });

  it("charges nothing for no time and no rate", () => {
    expect(amountFor(0, 6_000)).toBe(0);
    expect(amountFor(60, 0)).toBe(0);
  });

  // "1h 45m" is what somebody checks against their own notes; 1.75 is what
  // they have to convert first.
  it("says hours the way a person reads their own week", () => {
    expect(hoursAndMinutes(105)).toBe("1h 45m");
    expect(hoursAndMinutes(120)).toBe("2h");
    expect(hoursAndMinutes(45)).toBe("45m");
  });
});

describe.runIf(hasDatabase)("tracked time", { timeout: 90_000 }, () => {
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

  async function project() {
    return createProject.call(
      { title: "Henderson kitchen", contactId: await contactId() },
      OWNER,
    );
  }

  it("resolves the most specific rate there is", async () => {
    const job = await project();
    await setTimeRate.call({ scope: "business", rateMinor: 5_000 }, OWNER);
    const business = await logTime.call(
      { description: "Admin", minutes: 60 },
      OWNER,
    );
    expect(business.rateMinor).toBe(5_000);

    await setTimeRate.call(
      { scope: "user", scopeId: OWNER.userId, rateMinor: 7_500 },
      OWNER,
    );
    const mine = await logTime.call({ description: "Design", minutes: 60 }, OWNER);
    expect(mine.rateMinor).toBe(7_500);

    await setTimeRate.call(
      { scope: "project", scopeId: job.id, rateMinor: 9_000 },
      OWNER,
    );
    const onJob = await logTime.call(
      { description: "Fitting", minutes: 60, projectId: job.id },
      OWNER,
    );
    // Project beats person beats business.
    expect(onJob.rateMinor).toBe(9_000);
  });

  it("takes no rate at all as an entry to price by hand", async () => {
    const logged = await logTime.call({ description: "Favour", minutes: 30 }, OWNER);
    expect(logged.rateMinor).toBe(0);
  });

  // The property §4.13 is really about: putting a rate up in March must not
  // re-price February's work.
  it("holds the rate an entry was made at when the rate changes", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 5_000 }, OWNER);
    const february = await logTime.call({ description: "Early work", minutes: 60 }, OWNER);
    await setTimeRate.call({ scope: "business", rateMinor: 9_000 }, OWNER);

    const [stored] = await db()
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, february.id));
    expect(stored!.rateMinor).toBe(5_000);
    // And a new entry gets the new rate, so the change did happen.
    const march = await logTime.call({ description: "Later work", minutes: 60 }, OWNER);
    expect(march.rateMinor).toBe(9_000);
  });

  it("carries the customer through from either end", async () => {
    const job = await project();
    const onProject = await logTime.call(
      { description: "Fitting", minutes: 60, projectId: job.id },
      OWNER,
    );
    // "How many hours on the Hendersons" must not depend on which end
    // somebody attached the entry to.
    expect(onProject.contactId).toBe(await contactId());
  });

  it("runs one timer at a time, and refuses a second", async () => {
    const first = await startTimer.call({ description: "Measuring" }, OWNER);
    expect(first.endedAt).toBeNull();
    const second = await failure(startTimer.call({ description: "Something else" }, OWNER));
    expect(second.message).toContain("already have a timer running");

    const stopped = await stopTimer.call({}, OWNER);
    expect(stopped?.endedAt).toBeTruthy();
    // Stopping again finds nothing, which is an answer rather than an error.
    expect(await stopTimer.call({}, OWNER)).toBeNull();
  });

  // A business that bills in fifteens is saying a twenty-minute call costs
  // thirty. Rounding down would quietly give the work away.
  it("rounds a stopped timer up to the owner's increment", async () => {
    await startTimer.call({ description: "A short call" }, OWNER);
    const stopped = await stopTimer.call({ roundToMinutes: 15 }, OWNER);
    expect(stopped?.minutes).toBe(15);
  });

  it("shows what is still to bill, and what it comes to", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const job = await project();
    await logTime.call(
      { description: "Fitting", minutes: 90, projectId: job.id },
      OWNER,
    );
    await logTime.call(
      { description: "Travel", minutes: 60, projectId: job.id, billable: false },
      OWNER,
    );

    const review = await listTimeEntries.call({ unbilledOnly: true }, OWNER);
    expect(review).toHaveLength(1);
    // Ninety minutes at £60.
    expect(review[0]?.amountMinor).toBe(9_000);

    const everything = await listTimeEntries.call({ projectId: job.id }, OWNER);
    expect(everything).toHaveLength(2);
    // Unbillable work is tracked and worth nothing, which is the point of
    // recording it at all.
    expect(everything.find((entry) => !entry.billable)?.amountMinor).toBe(0);
  });

  it("turns tracked hours into invoice lines in one step", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const job = await project();
    const first = await logTime.call(
      { description: "Fitting", minutes: 90, projectId: job.id },
      OWNER,
    );
    const second = await logTime.call(
      { description: "Snagging", minutes: 30, projectId: job.id },
      OWNER,
    );

    const billed = await invoiceTime.call(
      { entryIds: [first.id, second.id], currency: "GBP", projectId: job.id },
      OWNER,
    );
    expect(billed).toMatchObject({ lines: 2, totalMinor: 12_000 });

    const [invoice] = await db().select().from(invoices);
    expect(invoice!.totalMinor).toBe(12_000);
    // Every entry now names the invoice it went on.
    const entries = await db().select().from(timeEntries);
    expect(entries.every((entry) => entry.invoiceId === billed.invoiceId)).toBe(true);
  });

  // The guard the whole table exists for.
  it("refuses to bill the same hour twice", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const job = await project();
    const entry = await logTime.call(
      { description: "Fitting", minutes: 60, projectId: job.id },
      OWNER,
    );
    await invoiceTime.call({ entryIds: [entry.id], currency: "GBP" }, OWNER);

    const again = await failure(
      invoiceTime.call({ entryIds: [entry.id], currency: "GBP" }, OWNER),
    );
    expect(again.message).toContain("already been invoiced");
    expect(await db().select().from(invoices)).toHaveLength(1);
  });

  it("will not bill a timer that is still running", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const running = await startTimer.call({ description: "In progress" }, OWNER);
    const refused = await failure(
      invoiceTime.call({ entryIds: [running.id], currency: "GBP" }, OWNER),
    );
    expect(refused.message).toContain("Stop the timer");
  });

  it("will not quietly bill work marked unbillable", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const entry = await logTime.call(
      { description: "Goodwill", minutes: 60, billable: false },
      OWNER,
    );
    const refused = await failure(
      invoiceTime.call({ entryIds: [entry.id], currency: "GBP" }, OWNER),
    );
    expect(refused.message).toContain("unbillable");
  });

  // One invoice is for one customer. Splitting the list silently, or picking
  // one of them, would both be worse than saying so.
  it("refuses to put two customers' hours on one invoice", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const first = await project();
    const other = (await getService("contacts.resolve").call(
      { email: "sam@example.test", name: "Sam Okonjo", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    const second = await createProject.call(
      { title: "Okonjo studio", contactId: other.contact.id },
      OWNER,
    );

    const a = await logTime.call(
      { description: "Fitting", minutes: 60, projectId: first.id },
      OWNER,
    );
    const b = await logTime.call(
      { description: "Fitting", minutes: 60, projectId: second.id },
      OWNER,
    );
    const refused = await failure(
      invoiceTime.call({ entryIds: [a.id, b.id], currency: "GBP" }, OWNER),
    );
    expect(refused.message).toContain("different customers");
    expect(await db().select().from(invoices)).toHaveLength(0);
  });

  // Work with nobody to bill is work an owner tracked for themselves. Refusing
  // it is the honest answer rather than inventing a customer for the invoice.
  it("will not invoice hours that belong to no customer", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const internal = await logTime.call({ description: "Our own admin", minutes: 60 }, OWNER);
    expect(internal.contactId).toBeNull();
    const refused = await failure(
      invoiceTime.call({ entryIds: [internal.id], currency: "GBP" }, OWNER),
    );
    expect(refused.message).toContain("for none");
  });

  it("lets an entry be corrected before it is billed, and not after", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const job = await project();
    const entry = await logTime.call(
      { description: "Fitting", minutes: 60, projectId: job.id },
      OWNER,
    );
    const fixed = await updateTimeEntry.call({ id: entry.id, minutes: 45 }, OWNER);
    expect(fixed.minutes).toBe(45);

    await invoiceTime.call({ entryIds: [entry.id], currency: "GBP" }, OWNER);
    const late = await failure(updateTimeEntry.call({ id: entry.id, minutes: 30 }, OWNER));
    // The customer may already have the invoice. The honest move is a credit
    // note, not a quiet edit.
    expect(late.message).toContain("Adjust it on the invoice");

    const gone = await failure(removeTimeEntry.call({ id: entry.id }, OWNER));
    expect(gone.code).toBe("conflict");
  });

  it("keeps the hours and forgets the person", async () => {
    await setTimeRate.call({ scope: "business", rateMinor: 6_000 }, OWNER);
    const job = await project();
    await logTime.call(
      { description: "Fitting the Hendersons' units", minutes: 60, projectId: job.id },
      OWNER,
    );

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find(
      (one) => one.scope === "contact.timeEntries",
    );
    expect(source).toBeTruthy();
    const forgotten = await contactId();
    await db().transaction((tx) => source!.erase(tx, forgotten, { requestId: "t" }));

    const [after] = await db().select().from(timeEntries);
    // The business's own record of what was worked and what it was worth
    // survives; what was written about them does not.
    expect(after).toMatchObject({ contactId: null, minutes: 60, rateMinor: 6_000 });
    expect(after!.description).not.toContain("Hendersons");
    expect(await db().select({ id: contacts.id }).from(contacts)).toHaveLength(1);
  });
});
