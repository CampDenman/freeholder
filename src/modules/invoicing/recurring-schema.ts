// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Invoices that come round again, and the chasing that follows (C6.17).
//
// Two tables, and the distinction between them and what already exists is the
// point:
//
// A **payment plan** (C5.08) splits *one* invoice into installments — the
// customer owes £4,000 and pays it in four. A **schedule** here raises a *new*
// invoice on a cadence — the retainer client owes £500 every month, forever,
// and each month is its own debt with its own due date and its own receipt.
// Modelling the second as the first would make twelve months of a retainer one
// enormous invoice that is permanently part-paid.
//
// A **reminder** is the other half of getting paid. §4.3's invoice states go
// as far as `overdue`, and an overdue invoice nobody chases is a state rather
// than a cash flow.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { invoices } from "./schema";

export const SCHEDULE_CADENCES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "ended"] as const;

export const invoiceSchedules = pgTable(
  "invoice_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    /** What the owner calls it: "Acme retainer", not "schedule #3". */
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    cadence: text("cadence", { enum: SCHEDULE_CADENCES }).notNull().default("monthly"),
    /** Every N of the cadence. Two-monthly is monthly with an interval of two. */
    intervalCount: integer("interval_count").notNull().default(1),
    /**
     * The lines every occurrence carries.
     *
     * A snapshot, like a quote's accepted lines: editing the schedule changes
     * what the *next* invoice says and never what an issued one said. An owner
     * who raises their retainer in March has not thereby re-issued February.
     */
    lines: jsonb("lines").notNull(),
    memo: text("memo"),
    /** How long after issue the money is due. */
    dueInDays: integer("due_in_days").notNull().default(14),
    /**
     * Whether each occurrence issues itself or waits to be checked.
     *
     * Off by default, and deliberately: an invoice going to a customer without
     * anybody looking is the one automation an owner cannot take back, and a
     * draft they glance at costs them ten seconds a month.
     */
    autoIssue: boolean("auto_issue").notNull().default(false),
    status: text("status", { enum: SCHEDULE_STATUSES }).notNull().default("active"),
    /** When the next one is due to be raised. The whole work list is this column. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    endsOn: timestamp("ends_on", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastInvoiceId: uuid("last_invoice_id"),
    /** How many have been raised, which is what an owner counts. */
    occurrences: integer("occurrences").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("invoice_schedules_due_idx").on(t.status, t.nextRunAt),
    index("invoice_schedules_contact_idx").on(t.contactId),
    check("invoice_schedules_interval", sql`${t.intervalCount} between 1 and 24`),
    check("invoice_schedules_due_days", sql`${t.dueInDays} between 0 and 365`),
    check("invoice_schedules_name", sql`char_length(${t.name}) between 1 and 120`),
  ],
);

export const REMINDER_STATUSES = ["scheduled", "sent", "skipped", "failed"] as const;

/**
 * Chasing an invoice, before and after it is due (C6.17).
 *
 * Offsets are relative to the due date and signed: −3 is three days before,
 * +7 is a week after. That is how an owner thinks about it — "a nudge before,
 * and again a week later" — and computing an absolute date at schedule time
 * means a re-dated invoice re-computes rather than silently keeping the old
 * one.
 */
export const invoiceReminders = pgTable(
  "invoice_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** Negative before the due date, positive after. */
    offsetDays: integer("offset_days").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: text("status", { enum: REMINDER_STATUSES }).notNull().default("scheduled"),
    /** Why it was not sent, in words an owner can act on. */
    skipReason: text("skip_reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("invoice_reminders_due_idx").on(t.status, t.sendAt),
    // One reminder per invoice and offset. Re-issuing an invoice must move its
    // reminders rather than double them.
    uniqueIndex("invoice_reminders_unique_idx").on(t.invoiceId, t.offsetDays),
    check("invoice_reminders_offset", sql`${t.offsetDays} between -60 and 180`),
  ],
);
