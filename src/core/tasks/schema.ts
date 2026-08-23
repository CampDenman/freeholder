// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Something a human has to do, attached to anything (MASTER.md §4.14, C7.02).
//
// §4.14 is unusually specific about why this table is shaped the way it is:
// "Tasks are attachable to anything — a contact, a deal, an invoice, a
// booking, a project — because 'chase the deposit' is about the invoice and
// 'confirm the venue' is about the booking, and a task list that only knows
// contacts forces both into the wrong shape."
//
// That sentence is also why this table is in **core** rather than in the CRM
// module, which is where §11's tree first sketched it. A task attaches to a
// contact, a deal, an invoice, a booking and a project — five owners across
// four modules — and putting the one work list inside any one of them would
// make every other module depend on that one to have a to-do list. The
// projects manifest already makes this argument for itself: it links to
// quotes, agreements, bookings and invoices and imports none of them. Tasks
// get the same treatment, from the other side.
//
// So the subject is a *pair*, not a foreign key. That is a deliberate trade:
// the database cannot enforce that `subject_id` points at a real row, and in
// exchange a module can be added without every other module's task list
// growing a column. C6.15's `project_links` made the same trade for the same
// reason, and the same rule applies — the pair is written by services that
// have already loaded the subject, never by a form posting two free strings.
//
// The pair is nullable, both halves together. "Ring the accountant" is a real
// task about nothing in the system, and forcing it to hang off a contact
// record invents a relationship that does not exist.
//
// `contact_id` is separate from the subject and denormalised on purpose. A
// task about somebody's *invoice* is still a thing that happened with that
// person, and their timeline should show it without the timeline having to
// know how to resolve every subject type there will ever be. It carries the
// usual obligations: repointed in `contacts.merge`, registered as a privacy
// source.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CADENCES } from "@/core/dates/cadence";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * What a task can be about.
 *
 * A closed list rather than free text, so a stale subject type is a failing
 * parse rather than a row nobody can render. Adding a kind is one line here
 * and one case in the service's link resolver.
 */
export const TASK_SUBJECTS = [
  "contact",
  "deal",
  "quote",
  "invoice",
  "booking",
  "project",
  "contract",
  "order",
] as const;

/**
 * Four levels, because three is not enough and five is a taxonomy.
 *
 * `urgent` exists as distinct from `high` for the same reason a diary has
 * "today" as distinct from "this week": an owner triaging twenty things needs
 * one band that means *stop reading the list and do this*.
 */
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/**
 * Three live states and two terminal ones.
 *
 * `blocked` is not decoration: a task waiting on somebody else is the one an
 * owner most needs to see and least able to act on, and folding it into "open"
 * hides the only list worth chasing. `doing` came from C6.15's project boards
 * and stays because a plan reads differently from a queue.
 *
 * `cancelled` is not `done`. A task that stopped mattering and a task somebody
 * did are different facts, and collapsing them makes "what did we get through
 * this week" a lie. Both leave the work list; only one counts.
 */
export const TASK_STATUSES = ["open", "doing", "blocked", "done", "cancelled"] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What it is about, or neither half for a task about nothing. */
    subjectType: text("subject_type", { enum: TASK_SUBJECTS }),
    subjectId: uuid("subject_id"),
    /**
     * Who it concerns, whatever the subject is.
     *
     * Set from the subject where the subject knows — a task on an invoice
     * inherits the invoice's contact — so a contact's timeline shows the work
     * about them without resolving every subject type itself.
     */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    details: text("details"),
    /** When it is owed. Null is a real answer: "sometime" is most of a list. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    /**
     * When to say something about it, separate from when it is due.
     *
     * They are different questions — "due Friday, remind me Wednesday" — and a
     * single column would force every reminder to fire at the moment it is
     * already too late to act.
     */
    remindAt: timestamp("remind_at", { withTimezone: true }),
    /** Set when the reminder went out, so it goes out once. */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    /**
     * Null is unassigned, and unassigned is a state worth having.
     *
     * A one-person business assigns nothing and still has a list; a
     * three-person one needs to see what nobody has picked up. Forcing an
     * assignee at creation would make both of those harder.
     */
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("normal"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("open"),
    /** Order within a subject, for the lists that are a plan rather than a queue. */
    position: integer("position").notNull().default(0),
    /**
     * How often it comes back, if it does.
     *
     * The recurrence lives on the task rather than in a separate rule table
     * because there is exactly one live occurrence at a time: completing this
     * one creates the next. A rule table would let a fortnight offline produce
     * a fortnight of identical chores, which is the failure C6.17 spells out.
     */
    cadence: text("cadence", { enum: CADENCES }),
    intervalCount: integer("interval_count").notNull().default(1),
    /** Which occurrence this came from, so a chore has a history. */
    recurredFromId: uuid("recurred_from_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // The work list itself: what is open, soonest first.
    index("tasks_open_idx").on(t.status, t.dueAt),
    index("tasks_assignee_idx").on(t.assigneeUserId, t.status, t.dueAt),
    // Everything about one thing, in the order somebody put it in.
    index("tasks_subject_idx").on(t.subjectType, t.subjectId, t.position),
    index("tasks_contact_idx").on(t.contactId),
    // The reminder sweep's whole work list, and nothing else in the table.
    index("tasks_reminder_idx")
      .on(t.remindAt)
      .where(sql`status = 'open' and remind_at is not null and reminded_at is null`),
    check("tasks_title", sql`char_length(${t.title}) between 1 and 300`),
    // Both halves of the pair or neither: half a subject is a row that cannot
    // be rendered and cannot be found.
    check(
      "tasks_subject_pair",
      sql`(${t.subjectType} is null) = (${t.subjectId} is null)`,
    ),
    // A finished task knows when. Without this, "what did we do this week"
    // silently misses everything closed before the column was populated.
    check(
      "tasks_done_has_time",
      sql`${t.status} <> 'done' or ${t.completedAt} is not null`,
    ),
    // A recurrence needs a date to advance from; a repeating task with no due
    // date has no next occurrence to compute.
    check("tasks_recurrence_needs_due", sql`${t.cadence} is null or ${t.dueAt} is not null`),
    check("tasks_interval", sql`${t.intervalCount} between 1 and 52`),
  ],
);
