// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Hours worked (MASTER.md §4.13's `TimeEntry`, C6.16).
//
// §4.13 puts the case in one sentence: a time entry is "a small table and the
// difference between an owner billing what they worked and billing what they
// remember."
//
// Two columns carry that difference.
//
// **`rateMinor` is resolved once, at the entry**, not looked up when the
// invoice is raised. An owner who puts their rate up in March must not thereby
// re-price February's work, and a rate read at billing time would do exactly
// that — silently, and in the business's favour, which is the worst direction
// for a mistake like this to run.
//
// **`invoiceId` is the guard against billing the same hour twice.** It is set
// when the entry becomes an invoice line and never cleared, so the review list
// is "billable and not yet on an invoice" rather than anybody's memory.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { bookings } from "@/core/scheduling/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { projects } from "./schema";

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Whose work it was. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Who it was for.
     *
     * Carried on the row rather than only reachable through the project,
     * because a time entry can hang off a booking instead — and "how many
     * hours have we spent on the Hendersons" must not depend on which of the
     * two the person happened to attach it to.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    /** When the work started. A running timer has no end yet. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * The billable length, in minutes.
     *
     * Stored rather than derived from the two timestamps, because an owner
     * rounding a 47-minute call to an hour is doing something legitimate that
     * the timestamps would overwrite the moment anybody recomputed it.
     */
    minutes: integer("minutes").notNull().default(0),
    billable: boolean("billable").notNull().default(true),
    /**
     * The hourly rate, resolved when the entry was made (§4.13's `rate_cents`).
     *
     * Frozen here on purpose. Putting a rate up in March must not re-price
     * February's work, and a rate read at billing time would do exactly that.
     */
    rateMinor: bigint("rate_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency"),
    /** Set when this became an invoice line. Never cleared. */
    invoiceId: uuid("invoice_id"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("time_entries_project_idx").on(t.projectId, t.startedAt),
    index("time_entries_booking_idx").on(t.bookingId),
    index("time_entries_contact_idx").on(t.contactId),
    index("time_entries_user_idx").on(t.userId, t.startedAt),
    // The review list, and the reason it is fast: billable work nobody has
    // invoiced yet.
    index("time_entries_unbilled_idx")
      .on(t.billable, t.startedAt)
      .where(sql`${t.invoiceId} is null`),
    // One running timer per person. Two would mean the same hour counted
    // twice against two jobs, which is worse than losing it.
    uniqueIndex("time_entries_one_timer_idx")
      .on(t.userId)
      .where(sql`${t.endedAt} is null`),
    check("time_entries_minutes", sql`${t.minutes} >= 0`),
    check("time_entries_rate", sql`${t.rateMinor} >= 0`),
    check("time_entries_order", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
    check(
      "time_entries_description",
      sql`char_length(${t.description}) between 1 and 500`,
    ),
    // Something has to be finished before it can be billed. A running timer on
    // an invoice is an hour nobody has worked yet.
    check(
      "time_entries_invoiced_is_finished",
      sql`${t.invoiceId} is null or ${t.endedAt} is not null`,
    ),
  ],
);

export const RATE_SCOPES = ["business", "user", "project"] as const;

/**
 * What an hour costs, at three levels of specificity (C6.16).
 *
 * Resolution is most-specific-wins: this project's rate, then this person's,
 * then the business's. Three levels rather than two because the two real cases
 * are a senior charging more than a junior *and* a particular client being
 * charged a particular rate, and a business that has both should not have to
 * choose.
 *
 * A rate that resolves to nothing is not an error — plenty of work is
 * unbillable — it simply produces a zero rate and an entry the owner can price
 * by hand.
 */
export const timeRates = pgTable(
  "time_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope", { enum: RATE_SCOPES }).notNull(),
    /** Null for the business-wide rate; the user or project id otherwise. */
    scopeId: uuid("scope_id"),
    rateMinor: bigint("rate_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One rate per scope. A second would be a second answer to what an hour
    // costs, and nothing could say which was meant.
    //
    // **The index itself is written in the migration**, as `0087`'s exclusion
    // constraint is, because it needs `NULLS NOT DISTINCT` and Drizzle has no
    // expression for it. That clause is load-bearing rather than tidy:
    // Postgres treats two NULLs as *different* by default, so without it the
    // business-wide rate — whose `scopeId` is null — would insert a second row
    // every time somebody changed it, the upsert would never fire, and
    // resolution would return whichever row the query happened to reach first.
    // A test caught exactly that.
    uniqueIndex("time_rates_scope_idx").on(t.scope, t.scopeId),
    check("time_rates_amount", sql`${t.rateMinor} >= 0`),
    check(
      "time_rates_scope_id",
      sql`(${t.scope} = 'business') = (${t.scopeId} is null)`,
    ),
  ],
);
