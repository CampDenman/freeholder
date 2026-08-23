// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pipelines, stages and deals (MASTER.md §4.1, C7.01).
//
// §4.1 sets two constraints that shape everything here.
//
// **"A deal is optional."** A retail store never opens one; a wedding
// photographer opens one per enquiry. So the module is inert until an owner
// defines a stage — nothing in core creates a deal, nothing requires one, and
// an instance that never visits this screen behaves exactly as it did.
//
// **"The hardcoded lifecycle_stage becomes a definable pipeline."** That is
// the delicate one, because `contacts.lifecycleStage` is a spine column that
// price lists, segments and reports already read. Two independently editable
// notions of what stage somebody is at would be the exact fork the contact
// spine exists to prevent.
//
// So there is one write path and one direction of derivation: the owner's
// stage is the truth, it lives in `contact_stages`, and **every lifecycle
// stage declares which coarse `lifecycleStage` it corresponds to**. Moving a
// contact writes the fine stage and derives the coarse one. Nothing edits the
// enum independently, and everything that reads it keeps working.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const PIPELINE_KINDS = ["lifecycle", "deal"] as const;
/** The coarse spine values a lifecycle stage can derive (§4.1). */
export const LIFECYCLE_STAGES = ["lead", "prospect", "customer", "repeat"] as const;

export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: PIPELINE_KINDS }).notNull(),
    name: text("name").notNull(),
    /** §4.1: "Multiple pipelines allowed (e.g., a wholesale pipeline beside retail)." */
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("pipelines_kind_idx").on(t.kind, t.position),
    // One default per kind. Two would mean nothing could say which pipeline a
    // deal created by a form belongs in.
    uniqueIndex("pipelines_one_default_idx")
      .on(t.kind)
      .where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    check("pipelines_name", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    /** A semantic token name, never a literal — every colour is one (§ tokens). */
    tone: text("tone"),
    /**
     * How likely a deal in this stage is to close, as a percentage.
     *
     * On the *stage* rather than only on the deal, because "what is my
     * pipeline worth" is a question about where things sit, and an owner who
     * has to set a probability on every deal by hand will not.
     */
    probability: integer("probability"),
    /** Reaching this stage means the deal is won. */
    isWon: boolean("is_won").notNull().default(false),
    /** Reaching this stage means it is lost, and asks for a reason. */
    isLost: boolean("is_lost").notNull().default(false),
    /**
     * The coarse spine value this stage derives, for lifecycle pipelines.
     *
     * This column is what stops the configurable pipeline forking from
     * `contacts.lifecycleStage`: the fine stage is the owner's, the coarse one
     * is derived from it, and nothing writes the enum independently.
     */
    lifecycleStage: text("lifecycle_stage", { enum: LIFECYCLE_STAGES }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("pipeline_stages_pipeline_idx").on(t.pipelineId, t.position),
    check("pipeline_stages_name", sql`char_length(${t.name}) between 1 and 60`),
    check(
      "pipeline_stages_probability",
      sql`${t.probability} is null or ${t.probability} between 0 and 100`,
    ),
    // Won and lost are the two ends. A stage claiming both would make every
    // report ask which it meant.
    check("pipeline_stages_outcome", sql`not (${t.isWon} and ${t.isLost})`),
  ],
);

export const DEAL_STATUSES = ["open", "won", "lost"] as const;

/**
 * A live opportunity worth tracking through stages (§4.1's `Deal`).
 *
 * `quoteId` is untyped by a foreign key: quotes is a module and this one must
 * install without it. §4.1 says a deal is "created by hand, by a form, or by a
 * quote being sent", and the third of those is a pointer rather than a
 * dependency.
 */
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    valueMinor: bigint("value_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency"),
    /**
     * The odds, overriding the stage's own.
     *
     * Null means "whatever the stage says", which is the answer for almost
     * every deal — an owner sets this only when one is unusual, and a column
     * that always held a copy of the stage's number would be a second thing to
     * keep in step.
     */
    probability: integer("probability"),
    expectedCloseOn: date("expected_close_on"),
    source: text("source"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Untyped: quotes is a module this one installs without. */
    quoteId: uuid("quote_id"),
    status: text("status", { enum: DEAL_STATUSES }).notNull().default("open"),
    /** Why it went, which is the only thing a lost deal is still worth. */
    lostReason: text("lost_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("deals_pipeline_idx").on(t.pipelineId, t.stageId),
    index("deals_contact_idx").on(t.contactId),
    index("deals_owner_idx").on(t.ownerUserId, t.status),
    index("deals_status_idx").on(t.status, t.expectedCloseOn),
    check("deals_title", sql`char_length(${t.title}) between 1 and 200`),
    check("deals_value", sql`${t.valueMinor} >= 0`),
    check(
      "deals_probability",
      sql`${t.probability} is null or ${t.probability} between 0 and 100`,
    ),
    // A closed deal has a closing time; a lost one says why. Both are what a
    // pipeline report is made of, and a row missing either is the shape a bug
    // leaves.
    check(
      "deals_closed_has_time",
      sql`${t.status} = 'open' or ${t.closedAt} is not null`,
    ),
    check("deals_lost_has_reason", sql`${t.status} <> 'lost' or ${t.lostReason} is not null`),
  ],
);

/**
 * Where a contact sits in a lifecycle pipeline (C7.01).
 *
 * One row per contact, because a person is at one stage of one lifecycle. The
 * coarse `contacts.lifecycleStage` is *derived* from this by the service that
 * writes it — this is the truth, and that is the projection every existing
 * reader keeps using.
 */
export const contactStages = pgTable(
  "contact_stages",
  {
    contactId: uuid("contact_id")
      .primaryKey()
      .references(() => contacts.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("contact_stages_stage_idx").on(t.stageId)],
);
