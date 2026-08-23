// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Invoices that come round again, and the chasing that follows (C6.17).
//
// What is *not* here matters as much as what is. A payment plan (C5.08) splits
// one invoice into installments; a schedule raises a **new** invoice each
// period. The retainer client owes £500 every month, and each month is its own
// debt with its own due date, its own receipt and its own overdue clock —
// modelling that as one enormous permanently part-paid invoice would make the
// aged-debtors report meaningless.
//
// Two rules run through every service below.
//
// **Nothing goes to a customer unwatched.** An occurrence produces a *draft*
// unless the owner explicitly turned auto-issue on, and even then it is one
// invoice at a time rather than a catch-up run: an instance that was off for a
// fortnight must not send a fortnight of invoices when it wakes up.
//
// **The cadence advances to the next occurrence after now, never by one step
// per missed period.** The same rule C4.14's scheduled playbooks needed, for
// the same reason: a job that fell behind must not spend the morning firing
// history.
import { z } from "zod";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { sendMail } from "@/core/mail/service";
import { currentBusiness } from "@/core/settings/read";
import { defineService, getService, ServiceError } from "@/core/service";
import { invoices } from "./schema";
import {
  REMINDER_STATUSES,
  SCHEDULE_CADENCES,
  SCHEDULE_STATUSES,
  invoiceReminders,
  invoiceSchedules,
} from "./recurring-schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

const scheduleLine = z.object({
  description: z.string().trim().min(1).max(1_000),
  quantityMicros: z.number().int().min(1).max(1_000_000_000_000).default(1_000_000),
  unitAmountMinor: z.number().int().min(0),
});

const scheduleRow = row({
  id: uuid,
  contactId: uuid,
  name: z.string(),
  currency: z.string(),
  cadence: z.enum(SCHEDULE_CADENCES),
  intervalCount: z.number().int(),
  lines: z.unknown(),
  memo: z.string().nullable(),
  dueInDays: z.number().int(),
  autoIssue: z.boolean(),
  status: z.enum(SCHEDULE_STATUSES),
  nextRunAt: timestamp,
  endsOn: timestamp.nullable(),
  lastRunAt: timestamp.nullable(),
  lastInvoiceId: uuid.nullable(),
  occurrences: z.number().int(),
});

/**
 * One step of a cadence from a given moment.
 *
 * Calendar arithmetic rather than a fixed number of days: a monthly retainer
 * billed on the 31st should land on the 30th in April rather than drifting a
 * day earlier every other month, which is what adding 30 days would do.
 */
export function advance(
  from: Date,
  cadence: (typeof SCHEDULE_CADENCES)[number],
  intervalCount: number,
): Date {
  const next = new Date(from.getTime());
  if (cadence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7 * intervalCount);
    return next;
  }
  const months =
    cadence === "monthly" ? intervalCount : cadence === "quarterly" ? 3 * intervalCount : 12 * intervalCount;
  const day = next.getUTCDate();
  // Move to the first before adding months, so a 31st never rolls into the
  // next month on its way past February, then clamp back to the last real day.
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * The next occurrence strictly after `now`.
 *
 * Loops the cadence forward rather than adding one step, so a schedule that
 * fell three months behind resumes at the next real date rather than raising
 * three invoices and then still being behind. The bound is a guard against a
 * pathological interval rather than a business rule.
 */
export function nextAfter(
  from: Date,
  now: Date,
  cadence: (typeof SCHEDULE_CADENCES)[number],
  intervalCount: number,
): Date {
  let next = advance(from, cadence, intervalCount);
  for (let step = 0; step < 1_000 && next <= now; step++) {
    next = advance(next, cadence, intervalCount);
  }
  return next;
}

export const createSchedule = defineService({
  name: "invoicing.createSchedule",
  summary: "Bill somebody the same thing every period.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    contactId: id,
    name: z.string().trim().min(1).max(120),
    currency: currency.default("GBP"),
    cadence: z.enum(SCHEDULE_CADENCES).default("monthly"),
    intervalCount: z.number().int().min(1).max(24).default(1),
    lines: z.array(scheduleLine).min(1).max(100),
    memo: z.string().trim().max(4_000).nullish(),
    dueInDays: z.number().int().min(0).max(365).default(14),
    autoIssue: z.boolean().default(false),
    startsOn: z.iso.datetime().optional(),
    endsOn: z.iso.datetime().nullish(),
  }),
  output: scheduleRow,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to manage recurring invoices.");
    }
    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "No such contact.");

    const [created] = await ctx.tx
      .insert(invoiceSchedules)
      .values({
        contactId: input.contactId,
        name: input.name,
        currency: input.currency,
        cadence: input.cadence,
        intervalCount: input.intervalCount,
        lines: input.lines,
        memo: input.memo ?? null,
        dueInDays: input.dueInDays,
        autoIssue: input.autoIssue,
        // Starting today means the first one is raised on the next run rather
        // than a period from now — an owner setting up a retainer in March
        // expects to bill March.
        nextRunAt: input.startsOn ? new Date(input.startsOn) : new Date(),
        endsOn: input.endsOn ? new Date(input.endsOn) : null,
      })
      .returning();
    ctx.setSubject("invoiceSchedule", created!.id);
    return created!;
  },
});

export const updateSchedule = defineService({
  name: "invoicing.updateSchedule",
  summary: "Change what a recurring invoice says, from next time.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    id,
    name: z.string().trim().min(1).max(120).optional(),
    lines: z.array(scheduleLine).min(1).max(100).optional(),
    memo: z.string().trim().max(4_000).nullish(),
    dueInDays: z.number().int().min(0).max(365).optional(),
    autoIssue: z.boolean().optional(),
    status: z.enum(SCHEDULE_STATUSES).optional(),
    endsOn: z.iso.datetime().nullish(),
  }),
  output: scheduleRow,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to manage recurring invoices.");
    }
    // Lines are a snapshot per occurrence, so changing them here changes what
    // the *next* invoice says and never what an issued one said. An owner who
    // raises their retainer in March has not thereby re-issued February.
    const [updated] = await ctx.tx
      .update(invoiceSchedules)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.lines !== undefined ? { lines: input.lines } : {}),
        ...(input.memo !== undefined ? { memo: input.memo ?? null } : {}),
        ...(input.dueInDays !== undefined ? { dueInDays: input.dueInDays } : {}),
        ...(input.autoIssue !== undefined ? { autoIssue: input.autoIssue } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.endsOn !== undefined
          ? { endsOn: input.endsOn ? new Date(input.endsOn) : null }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(invoiceSchedules.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That schedule is not here.");
    ctx.setSubject("invoiceSchedule", updated.id);
    return updated;
  },
});

export const listSchedules = defineService({
  name: "invoicing.listSchedules",
  summary: "What is being billed again, and when it next goes out.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(SCHEDULE_STATUSES).optional() }),
  output: listed(scheduleRow.extend({ contactName: z.string().nullable() })),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ schedule: invoiceSchedules, contactName: contacts.name })
      .from(invoiceSchedules)
      .innerJoin(contacts, eq(contacts.id, invoiceSchedules.contactId))
      .where(input.status ? eq(invoiceSchedules.status, input.status) : undefined)
      .orderBy(asc(invoiceSchedules.nextRunAt));
    return rows.map(({ schedule, contactName }) => ({ ...schedule, contactName }));
  },
});

/**
 * Raise the invoices that have come due.
 *
 * One occurrence per schedule per run, deliberately. An instance that was off
 * for a fortnight must not send a fortnight of invoices when it wakes up, and
 * `nextRunAt` advancing to the next date *after now* means the backlog is
 * skipped rather than replayed — the rule C4.14's playbooks needed, for the
 * same reason.
 */
export const runSchedules = defineService({
  name: "invoicing.runSchedules",
  summary: "Raise the recurring invoices that are due.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "money",
  input: z.object({}),
  output: row({ raised: z.number().int(), issued: z.number().int(), ended: z.number().int() }),
  handler: async (_input, ctx) => {
    const now = new Date();
    const due = await ctx.tx
      .select()
      .from(invoiceSchedules)
      .where(
        and(eq(invoiceSchedules.status, "active"), lte(invoiceSchedules.nextRunAt, now)),
      )
      .limit(100);

    let raised = 0;
    let issued = 0;
    let ended = 0;
    for (const schedule of due) {
      if (schedule.endsOn && schedule.endsOn <= now) {
        await ctx.tx
          .update(invoiceSchedules)
          .set({ status: "ended", updatedAt: sql`now()` })
          .where(eq(invoiceSchedules.id, schedule.id));
        ended += 1;
        continue;
      }

      const lines = z.array(scheduleLine).parse(schedule.lines);
      const occurrence = schedule.occurrences + 1;
      const draft = (await ctx.call(getService("invoicing.createDraft"), {
        contactId: schedule.contactId,
        currency: schedule.currency,
        sourceType: "manual",
        sourceId: schedule.id,
        // Stable per occurrence, so a job that runs twice raises one invoice.
        idempotencyKey: `schedule:${schedule.id}:${occurrence}`,
        lines: lines.map((line) => ({
          description: line.description,
          quantityMicros: line.quantityMicros,
          unitAmountMinor: line.unitAmountMinor,
        })),
        ...(schedule.memo ? { memo: schedule.memo } : {}),
        dueAt: new Date(now.getTime() + schedule.dueInDays * 86_400_000),
        tax: {
          mode: "not_applicable" as const,
          reason: `Recurring invoice "${schedule.name}"; tax applied when issued.`,
        },
      })) as { invoice: { id: string } };
      raised += 1;

      if (schedule.autoIssue) {
        await ctx.call(getService("invoicing.issue"), { id: draft.invoice.id });
        issued += 1;
      }

      await ctx.tx
        .update(invoiceSchedules)
        .set({
          lastRunAt: now,
          lastInvoiceId: draft.invoice.id,
          occurrences: occurrence,
          // The next date *after now*, not one step on. A schedule three
          // months behind resumes rather than firing history.
          nextRunAt: nextAfter(schedule.nextRunAt, now, schedule.cadence, schedule.intervalCount),
          updatedAt: sql`now()`,
        })
        .where(eq(invoiceSchedules.id, schedule.id));
    }
    return { raised, issued, ended };
  },
});

/**
 * Mark every invoice that has gone past its date.
 *
 * A sweep rather than a computed status, and it calls the existing
 * per-invoice `invoicing.markOverdue` for each one rather than issuing a bulk
 * UPDATE — that service owns the state machine, takes the row lock and writes
 * the money-state event, and a second implementation would be a second opinion
 * about what "overdue" does to a ledger.
 *
 * Without this the status existed and nothing ever set it: an invoice went
 * past its due date at midnight and stayed `sent` until somebody pressed
 * something, which is not an accounts-receivable system.
 */
export const markInvoicesOverdue = defineService({
  name: "invoicing.markOverdueSweep",
  summary: "Mark every issued invoice that is past its due date.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({}),
  output: row({ overdue: z.number().int() }),
  handler: async (_input, ctx) => {
    const now = new Date();
    const late = await ctx.tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, ["sent", "viewed", "partially_paid"]),
          lte(invoices.dueAt, now),
        ),
      )
      .limit(500);
    for (const invoice of late) {
      await ctx.call(getService("invoicing.markOverdue"), { id: invoice.id, asOf: now });
    }
    return { overdue: late.length };
  },
});

export const scheduleInvoiceReminders = defineService({
  name: "invoicing.scheduleReminders",
  summary: "Decide when to chase an invoice, before and after it is due.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    invoiceId: id,
    /** Negative before the due date, positive after. */
    offsetDays: z.array(z.number().int().min(-60).max(180)).min(1).max(6),
  }),
  output: listed(
    row({
      id: uuid,
      offsetDays: z.number().int(),
      sendAt: timestamp,
      status: z.enum(REMINDER_STATUSES),
    }),
  ),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx
      .select({ id: invoices.id, dueAt: invoices.dueAt, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (!invoice.dueAt) {
      // An invoice with no due date has nothing to be early or late for.
      throw new ServiceError(
        "validation",
        "Give this invoice a due date before scheduling reminders.",
      );
    }

    const written = [];
    for (const offsetDays of new Set(input.offsetDays)) {
      const sendAt = new Date(invoice.dueAt.getTime() + offsetDays * 86_400_000);
      // Upserted on (invoice, offset): re-dating an invoice moves its
      // reminders rather than doubling them.
      const [saved] = await ctx.tx
        .insert(invoiceReminders)
        .values({ invoiceId: invoice.id, offsetDays, sendAt })
        .onConflictDoUpdate({
          target: [invoiceReminders.invoiceId, invoiceReminders.offsetDays],
          set: { sendAt, updatedAt: sql`now()` },
          where: eq(invoiceReminders.status, "scheduled"),
        })
        .returning({
          id: invoiceReminders.id,
          offsetDays: invoiceReminders.offsetDays,
          sendAt: invoiceReminders.sendAt,
          status: invoiceReminders.status,
        });
      if (saved) written.push(saved);
    }
    ctx.setSubject("invoice", invoice.id);
    return written;
  },
});

export const listInvoiceReminders = defineService({
  name: "invoicing.reminders",
  summary: "What has been sent about an invoice, and what is still to come.",
  kind: "query",
  permission: "scoped",
  input: z.object({ invoiceId: id }),
  output: listed(
    row({
      id: uuid,
      offsetDays: z.number().int(),
      sendAt: timestamp,
      sentAt: timestamp.nullable(),
      status: z.enum(REMINDER_STATUSES),
      skipReason: z.string().nullable(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: invoiceReminders.id,
        offsetDays: invoiceReminders.offsetDays,
        sendAt: invoiceReminders.sendAt,
        sentAt: invoiceReminders.sentAt,
        status: invoiceReminders.status,
        skipReason: invoiceReminders.skipReason,
      })
      .from(invoiceReminders)
      .where(eq(invoiceReminders.invoiceId, input.invoiceId))
      .orderBy(asc(invoiceReminders.sendAt)),
});

/**
 * Send the invoice reminders that have come due.
 *
 * On its own connection rather than a caller's transaction: each reminder is
 * independent, and one unreachable address must not roll back the fifty that
 * went out fine — the same shape the booking reminders use (C6.09).
 *
 * A paid invoice is never chased. That check is at *send* time rather than
 * schedule time because somebody paying yesterday is exactly the case a
 * scheduled reminder gets wrong, and it is the one that annoys a customer
 * enough to mention.
 */
export async function sendDueInvoiceReminders(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  const due = await db()
    .select({
      id: invoiceReminders.id,
      offsetDays: invoiceReminders.offsetDays,
      invoiceId: invoices.id,
      number: invoices.number,
      status: invoices.status,
      dueAt: invoices.dueAt,
      totalMinor: invoices.totalMinor,
      paidMinor: invoices.paidMinor,
      currency: invoices.currency,
      contactEmail: contacts.email,
      contactName: contacts.name,
    })
    .from(invoiceReminders)
    .innerJoin(invoices, eq(invoices.id, invoiceReminders.invoiceId))
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(
      and(
        eq(invoiceReminders.status, "scheduled"),
        lte(invoiceReminders.sendAt, new Date()),
        isNull(invoiceReminders.sentAt),
      ),
    )
    .limit(500);

  const business = await currentBusiness();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const reminder of due) {
    const skip = async (reason: string): Promise<void> => {
      skipped += 1;
      await db()
        .update(invoiceReminders)
        .set({ status: "skipped", skipReason: reason, updatedAt: sql`now()` })
        .where(eq(invoiceReminders.id, reminder.id));
    };

    // Nothing is owed, or nothing is owed any more. Chasing a paid invoice is
    // the mistake a customer remembers.
    if (["paid", "void", "refunded", "draft"].includes(reminder.status)) {
      await skip(`The invoice is ${reminder.status}.`);
      continue;
    }
    if (reminder.paidMinor >= reminder.totalMinor) {
      await skip("The invoice has been paid in full.");
      continue;
    }
    if (!reminder.contactEmail) {
      await skip("No email address on the contact.");
      continue;
    }

    const outstanding = reminder.totalMinor - reminder.paidMinor;
    const overdue = reminder.offsetDays > 0;
    const lines = [
      `${overdue ? "A reminder about" : "A note about"} invoice ${reminder.number ?? ""}`.trim(),
      "",
      `Outstanding: ${(outstanding / 100).toString()} ${reminder.currency}`,
      reminder.dueAt ? `Due: ${reminder.dueAt.toISOString().slice(0, 10)}` : "",
      "",
      `${env().APP_URL.replace(/\/+$/, "")}/portal`,
    ].filter(Boolean);

    try {
      await db().transaction((tx) =>
        sendMail(
          tx,
          {
            to: reminder.contactEmail!,
            subject: overdue
              ? `Overdue: invoice ${reminder.number ?? ""} from ${business?.name ?? ""}`.trim()
              : `Invoice ${reminder.number ?? ""} from ${business?.name ?? ""}`.trim(),
            text: lines.join("\n"),
          },
          {
            purpose: "transactional",
            // Stable per reminder row, so a retried job never sends twice.
            idempotencyKey: `invoice-reminder:${reminder.id}`,
          },
        ),
      );
      sent += 1;
      await db()
        .update(invoiceReminders)
        .set({ status: "sent", sentAt: new Date(), updatedAt: sql`now()` })
        .where(eq(invoiceReminders.id, reminder.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sending failed.";
      // A suppressed address is a skip with a reason, not a failure to retry:
      // the whole point of suppression is that trying again is wrong.
      if (/suppress/i.test(message)) {
        await skip(message);
        continue;
      }
      failed += 1;
      await db()
        .update(invoiceReminders)
        .set({ status: "failed", skipReason: message.slice(0, 500), updatedAt: sql`now()` })
        .where(eq(invoiceReminders.id, reminder.id));
    }
  }

  return { sent, skipped, failed };
}

/**
 * What a merge means for a recurring invoice (CLAUDE.md's non-negotiable).
 *
 * Unconditional. A retainer belongs to whoever the surviving record is, and
 * one pointing at a contact that no longer exists is money that stops being
 * billed without anybody noticing.
 */
registerContactReference({
  table: "invoice_schedules",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(invoiceSchedules)
      .set({ contactId: survivingId })
      .where(eq(invoiceSchedules.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: invoiceSchedules.id, contactId: invoiceSchedules.contactId })
      .from(invoiceSchedules)
      .where(inArray(invoiceSchedules.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((schedule) => schedule.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(invoiceSchedules)
        .set({ contactId: duplicateId })
        .where(inArray(invoiceSchedules.id, moved.map((schedule) => schedule.id)));
    }
  },
});

/**
 * What a recurring invoice means for the person's own data (§30).
 *
 * Ended rather than deleted, and the person unlinked. A schedule is the
 * business's own record of an agreement it had; what must stop is the billing,
 * and a schedule that kept running against an erased contact would be exactly
 * that failure.
 */
registerContactPrivacySource({
  scope: "contact.invoiceSchedules",
  tables: ["invoice_schedules"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(invoiceSchedules)
      .where(eq(invoiceSchedules.contactId, contactId))
      .orderBy(asc(invoiceSchedules.createdAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(invoiceSchedules)
      .set({ status: "ended", memo: null, updatedAt: sql`now()` })
      .where(eq(invoiceSchedules.contactId, contactId))
      .returning({ id: invoiceSchedules.id });
    return { affected: rows.length };
  },
});

export default [
  markInvoicesOverdue,
  createSchedule,
  updateSchedule,
  listSchedules,
  runSchedules,
  scheduleInvoiceReminders,
  listInvoiceReminders,
];
