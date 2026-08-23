// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recurring invoices, overdue sweeps and chasing (C6.17, MASTER.md §4.3).
//
// What separates this from C5.08's payment plans is worth stating outright: a
// plan splits *one* invoice into installments; a schedule raises a *new*
// invoice each period. Each month of a retainer is its own debt with its own
// due date and its own overdue clock, and modelling it as a plan would make
// twelve months one enormous permanently part-paid invoice.
//
// Three claims:
//
//   1. **The cadence is calendar arithmetic**, so a retainer billed on the
//      31st lands on the 30th in April rather than drifting earlier forever.
//   2. **A backlog is skipped, not replayed.** An instance that was off for
//      three months resumes; it does not spend the morning firing history.
//   3. **A paid invoice is never chased**, decided at send time rather than at
//      schedule time — somebody paying yesterday is exactly the case a
//      scheduled reminder gets wrong.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { invoices } from "@/modules/invoicing/schema";
import { invoiceReminders, invoiceSchedules } from "@/modules/invoicing/recurring-schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  advance,
  createSchedule,
  listInvoiceReminders,
  listSchedules,
  markInvoicesOverdue,
  nextAfter,
  runSchedules,
  scheduleInvoiceReminders,
  sendDueInvoiceReminders,
  updateSchedule,
} from "@/modules/invoicing/recurring-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("when the next one falls due", () => {
  // Adding 30 days would drift a monthly retainer a day earlier every other
  // month. Calendar arithmetic keeps it on the date the owner chose.
  it("keeps a monthly bill on its own day of the month", () => {
    const march = new Date("2026-03-15T09:00:00.000Z");
    expect(advance(march, "monthly", 1).toISOString()).toBe("2026-04-15T09:00:00.000Z");
    expect(advance(march, "quarterly", 1).toISOString()).toBe("2026-06-15T09:00:00.000Z");
    expect(advance(march, "yearly", 1).toISOString()).toBe("2027-03-15T09:00:00.000Z");
    expect(advance(march, "weekly", 2).toISOString()).toBe("2026-03-29T09:00:00.000Z");
  });

  // A 31st cannot land in April, and must not roll into May either.
  it("clamps a 31st to the last day of a shorter month", () => {
    const jan = new Date("2026-01-31T09:00:00.000Z");
    expect(advance(jan, "monthly", 1).toISOString()).toBe("2026-02-28T09:00:00.000Z");
    const mar = new Date("2026-03-31T09:00:00.000Z");
    expect(advance(mar, "monthly", 1).toISOString()).toBe("2026-04-30T09:00:00.000Z");
  });

  // The rule C4.14's playbooks needed: a job that fell behind must not spend
  // the morning firing history.
  it("resumes after a long gap rather than replaying it", () => {
    const lastRun = new Date("2026-01-15T09:00:00.000Z");
    const now = new Date("2026-06-20T09:00:00.000Z");
    const next = nextAfter(lastRun, now, "monthly", 1);
    // July, not February.
    expect(next.toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
});

describe.runIf(hasDatabase)("recurring invoices", { timeout: 90_000 }, () => {
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

  async function retainer(overrides: Record<string, unknown> = {}) {
    return createSchedule.call(
      {
        contactId: await contactId(),
        name: "Acme retainer",
        currency: "GBP",
        cadence: "monthly",
        lines: [{ description: "Monthly retainer", unitAmountMinor: 50_000 }],
        ...overrides,
      },
      OWNER,
    );
  }

  it("bills the first period straight away rather than a month from now", async () => {
    await retainer();
    const raised = await runSchedules.call({}, OWNER);
    expect(raised.raised).toBe(1);
    // Not issued: nothing goes to a customer unwatched.
    expect(raised.issued).toBe(0);

    const [invoice] = await db().select().from(invoices);
    expect(invoice).toMatchObject({ status: "draft", totalMinor: 50_000 });
  });

  it("issues by itself only when the owner said so", async () => {
    await retainer({ autoIssue: true });
    const raised = await runSchedules.call({}, OWNER);
    expect(raised.issued).toBe(1);
    const [invoice] = await db().select().from(invoices);
    expect(invoice!.status).toBe("sent");
  });

  it("raises one invoice per run, not one per missed period", async () => {
    const schedule = await retainer();
    // Backdate as though the instance had been off for three months.
    await db()
      .update(invoiceSchedules)
      .set({ nextRunAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(invoiceSchedules.id, schedule.id));

    const raised = await runSchedules.call({}, OWNER);
    expect(raised.raised).toBe(1);
    expect(await db().select().from(invoices)).toHaveLength(1);

    // And the next date is in the future, so it is caught up rather than still
    // three months behind.
    const [after] = await db()
      .select()
      .from(invoiceSchedules)
      .where(eq(invoiceSchedules.id, schedule.id));
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(after!.occurrences).toBe(1);
  });

  it("does not raise the same period twice when the job runs again", async () => {
    await retainer();
    await runSchedules.call({}, OWNER);
    const second = await runSchedules.call({}, OWNER);
    // The next one is not due yet, so nothing happens.
    expect(second.raised).toBe(0);
    expect(await db().select().from(invoices)).toHaveLength(1);
  });

  // Editing the schedule changes what the *next* invoice says. An owner who
  // raises their retainer in March has not thereby re-issued February.
  it("leaves an issued invoice alone when the schedule is edited", async () => {
    const schedule = await retainer();
    await runSchedules.call({}, OWNER);
    await updateSchedule.call(
      {
        id: schedule.id,
        lines: [{ description: "Monthly retainer", quantityMicros: 1_000_000, unitAmountMinor: 80_000 }],
      },
      OWNER,
    );
    const [invoice] = await db().select().from(invoices);
    expect(invoice!.totalMinor).toBe(50_000);
  });

  it("stops when it reaches its end date", async () => {
    const schedule = await retainer({
      endsOn: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const run = await runSchedules.call({}, OWNER);
    expect(run).toMatchObject({ raised: 0, ended: 1 });
    const [after] = await db()
      .select()
      .from(invoiceSchedules)
      .where(eq(invoiceSchedules.id, schedule.id));
    expect(after!.status).toBe("ended");
  });

  it("leaves a paused schedule alone", async () => {
    const schedule = await retainer();
    await updateSchedule.call({ id: schedule.id, status: "paused" }, OWNER);
    expect((await runSchedules.call({}, OWNER)).raised).toBe(0);

    const listed = await listSchedules.call({}, OWNER);
    expect(listed[0]).toMatchObject({ status: "paused", contactName: "Rae Lane" });
  });

  // The status existed and nothing ever set it: an invoice went past its due
  // date at midnight and stayed `sent` until somebody pressed something.
  it("marks what has gone past its date", async () => {
    await retainer({ autoIssue: true, dueInDays: 0 });
    await runSchedules.call({}, OWNER);
    await db()
      .update(invoices)
      .set({ dueAt: new Date(Date.now() - 86_400_000) });

    const swept = await markInvoicesOverdue.call({}, OWNER);
    expect(swept.overdue).toBe(1);
    const [invoice] = await db().select().from(invoices);
    expect(invoice!.status).toBe("overdue");
  });

  it("schedules chasing before and after the due date", async () => {
    await retainer({ autoIssue: true });
    await runSchedules.call({}, OWNER);
    const [invoice] = await db().select().from(invoices);

    const scheduled = await scheduleInvoiceReminders.call(
      { invoiceId: invoice!.id, offsetDays: [-3, 7] },
      OWNER,
    );
    expect(scheduled).toHaveLength(2);
    const listed = await listInvoiceReminders.call({ invoiceId: invoice!.id }, OWNER);
    // Ordered by when they go out, so the list reads as a plan.
    expect(listed.map((one) => one.offsetDays)).toEqual([-3, 7]);
  });

  it("moves reminders rather than doubling them when they are set again", async () => {
    await retainer({ autoIssue: true });
    await runSchedules.call({}, OWNER);
    const [invoice] = await db().select().from(invoices);
    await scheduleInvoiceReminders.call({ invoiceId: invoice!.id, offsetDays: [7] }, OWNER);
    await scheduleInvoiceReminders.call({ invoiceId: invoice!.id, offsetDays: [7] }, OWNER);
    expect(await db().select().from(invoiceReminders)).toHaveLength(1);
  });

  it("refuses to chase an invoice with no date to chase against", async () => {
    await retainer();
    await runSchedules.call({}, OWNER);
    const [invoice] = await db().select().from(invoices);
    await db().update(invoices).set({ dueAt: null });
    const refused = await failure(
      scheduleInvoiceReminders.call({ invoiceId: invoice!.id, offsetDays: [7] }, OWNER),
    );
    expect(refused.message).toContain("due date");
  });

  // The one that annoys a customer enough to mention. Checked at send time
  // rather than schedule time, because paying yesterday is exactly the case a
  // scheduled reminder gets wrong.
  it("never chases an invoice that has been paid", async () => {
    await retainer({ autoIssue: true });
    await runSchedules.call({}, OWNER);
    const [invoice] = await db().select().from(invoices);
    await scheduleInvoiceReminders.call({ invoiceId: invoice!.id, offsetDays: [-1] }, OWNER);
    await db()
      .update(invoiceReminders)
      .set({ sendAt: new Date(Date.now() - 60_000) });
    await db()
      .update(invoices)
      .set({ status: "paid", paidMinor: invoice!.totalMinor, paidAt: new Date() });

    const swept = await sendDueInvoiceReminders();
    expect(swept).toMatchObject({ sent: 0, skipped: 1 });
    const [reminder] = await db().select().from(invoiceReminders);
    expect(reminder!.skipReason).toContain("paid");
  });

  it("keeps the schedule and stops the billing when somebody is forgotten", async () => {
    await retainer();
    const forgotten = await contactId();
    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find(
      (one) => one.scope === "contact.invoiceSchedules",
    );
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, forgotten, { requestId: "t" }));

    const [after] = await db().select().from(invoiceSchedules);
    // Ended rather than deleted: what must stop is the billing, and a schedule
    // still running against an erased contact would be exactly that failure.
    expect(after!.status).toBe("ended");
    expect((await runSchedules.call({}, OWNER)).raised).toBe(0);
  });
});
