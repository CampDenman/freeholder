// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One piece of work, from enquiry to done (MASTER.md §4.7, C6.15).
//
// **This is the same entity C8.01 will publish**, not a second one. §4.7's
// `Project` already carries `client_contact_id`, `services[]` and
// `occurred_on` — operational facts — because a case study *is* a job that got
// finished, and modelling those as two tables would fork exactly the way the
// contact spine exists to prevent: the wedding in the portfolio and the
// wedding in the diary would stop being the same wedding the first time
// somebody edited one.
//
// So C6.15 builds the working half — who it is for, what state it is in, what
// it is made of — and C8.01 adds the publishing half (blocks, cover, SEO,
// featured) to the same row. The seam is additive, which is what lets a
// business decide *after* the job whether it becomes a case study.
//
// The other decision worth reading: **what a project is made of is a link
// table, not columns.** A job has many quotes, many bookings and many
// invoices, and C6.13 will add more kinds; a column per kind would be a
// migration every time the business does something new.
import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { businessLocations } from "@/core/locations/schema";
import { assets } from "@/core/media/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const PROJECT_STATUSES = [
  "enquiry",
  "quoted",
  "active",
  "on_hold",
  "complete",
  "cancelled",
] as const;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Who it is for. Nullable, because internal work is real work: a rebrand of
     * your own site is a project with no client, and refusing to record it
     * would push it onto a whiteboard.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "restrict",
    }),
    /**
     * What to call the client publicly (§4.7).
     *
     * "A Fortune 500 retailer" is a first-class option rather than a fib, and
     * it exists so a business can publish work it is not allowed to name.
     */
    clientDisplayName: text("client_display_name"),
    title: text("title").notNull(),
    /** Stable once set: C8.01 publishes at this address (§5's slug rule). */
    slug: text("slug").notNull(),
    summary: text("summary"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("enquiry"),
    /** Whose job it is inside the business. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    /** The services this work used — product ids, untyped: catalog is a module. */
    serviceProductIds: uuid("service_product_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    startedOn: date("started_on"),
    /** When the work happened, which is what a case study dates itself by. */
    occurredOn: date("occurred_on"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** The owner's own notes. Never shown to the client (C8.01 publishes blocks). */
    notes: text("notes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("projects_slug_idx").on(t.slug),
    index("projects_contact_idx").on(t.contactId),
    index("projects_status_idx").on(t.status, t.occurredOn),
    check("projects_title", sql`char_length(${t.title}) between 1 and 200`),
    check("projects_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // A finished job has a finishing time. A row claiming otherwise is the
    // shape a bug leaves, and it is the column every report dates from.
    check(
      "projects_complete_has_time",
      sql`${t.status} <> 'complete' or ${t.completedAt} is not null`,
    ),
  ],
);

/**
 * What a project is made of (§4.7, C6.15).
 *
 * Polymorphic on purpose. A job has many quotes, many bookings and many
 * invoices, and C6.13 will attach more; a column per kind would be a migration
 * every time the business does something new. The `kind` is a closed set here
 * and the id is untyped, because half the things a project links to live in
 * modules this one must not depend on (§11).
 */
export const PROJECT_LINK_KINDS = [
  "quote",
  "contract",
  "booking",
  "invoice",
  "rental",
  "form_submission",
] as const;

export const projectLinks = pgTable(
  "project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: PROJECT_LINK_KINDS }).notNull(),
    /** Untyped by a foreign key: these live in modules projects may not import. */
    targetId: uuid("target_id").notNull(),
    /** What to call it on screen, so a list reads without ten more queries. */
    label: text("label"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("project_links_unique_idx").on(t.projectId, t.kind, t.targetId),
    index("project_links_target_idx").on(t.kind, t.targetId),
  ],
);

export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;

/**
 * The work inside the work.
 *
 * Deliberately thin: a list with an order, a state and somebody's name on it.
 * A project tracker with dependencies, burndown and sub-tasks is a different
 * product, and an owner who needs one already has it open in another tab —
 * what they do not have is those tasks sitting beside the quote, the bookings
 * and the invoice for the same job.
 */
export const projectTasks = pgTable(
  "project_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueOn: date("due_on"),
    position: integer("position").notNull().default(0),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("project_tasks_project_idx").on(t.projectId, t.position),
    index("project_tasks_assignee_idx").on(t.assigneeUserId, t.status),
    check("project_tasks_title", sql`char_length(${t.title}) between 1 and 300`),
    check(
      "project_tasks_done_has_time",
      sql`${t.status} <> 'done' or ${t.doneAt} is not null`,
    ),
  ],
);

/**
 * The measurable claim, if there is one (§4.7's `ProjectOutcome`).
 *
 * `method` is not decoration. "Traffic up 40%" is a number somebody will ask
 * about, and a business that cannot say how it was measured is a business
 * making it up — so the column that holds the answer is beside the one that
 * holds the claim, and C8.01 renders both.
 */
export const projectOutcomes = pgTable(
  "project_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    method: text("method"),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("project_outcomes_project_idx").on(t.projectId, t.position),
    check("project_outcomes_label", sql`char_length(${t.label}) between 1 and 120`),
    check("project_outcomes_value", sql`char_length(${t.value}) between 1 and 120`),
  ],
);

export const PROJECT_FILE_ROLES = [
  "hero",
  "gallery",
  "before",
  "after",
  "process",
  "detail",
  "document",
] as const;

/**
 * Ordered media and documents, with before/after pairing (§4.7's `ProjectMedia`).
 *
 * §4.7: "Before/after is a pairing, not two uploads." `pairKey` is what lets a
 * renderer show a slider rather than two pictures side by side, and it has to
 * exist from the first version because retrofitting it means asking an owner
 * to re-upload work they have already filed.
 */
export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    role: text("role", { enum: PROJECT_FILE_ROLES }).notNull().default("gallery"),
    /** Ties a `before` to its `after`. Null for everything else. */
    pairKey: text("pair_key"),
    caption: text("caption"),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("project_files_project_idx").on(t.projectId, t.position),
    uniqueIndex("project_files_unique_idx").on(t.projectId, t.assetId, t.role),
    // A pairing needs a key, and a key means nothing on anything else.
    check(
      "project_files_pairing",
      sql`(${t.role} in ('before','after')) = (${t.pairKey} is not null)`,
    ),
  ],
);
