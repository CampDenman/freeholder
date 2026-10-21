// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-authored guided assessments (MASTER.md §4.18, C8.14).
//
// The point of this module is what it *cannot* do. A trade, a clinic and a
// lender all want the same surface — answer some questions, get told roughly
// where you stand — and all three are places where software inventing an
// answer is a real harm rather than a bad user experience. So the outcome is
// not generated, not templated, and not composed: it is a row the owner wrote,
// and a response points at it with a non-null foreign key. No code path in
// this module produces outcome text. That is a stronger guarantee than any
// prompt, disclaimer or review step, and it is the reason the regulated
// editions can ship this at all.
//
// Questions stay jsonb for the same reason form fields do (§4.6): an owner
// adding a question is a database write, not a deploy. Bands are *not* jsonb,
// because a band is the thing the safety property depends on — see below.
import { sql } from "drizzle-orm";
import {
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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { contacts } from "@/core/contacts/schema";

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set = in trash (C11.14). Responses stay live: they are evidence. */
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    /** Stable handle a block points at, so renaming keeps pages working. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Shown above the first question. The owner's framing, not ours. */
    intro: text("intro"),
    /**
     * Question definitions — see questions.ts for the schema they are parsed
     * with. Each option carries the score it contributes.
     */
    questions: jsonb("questions").notNull().default([]),
    /**
     * What a response does to the spine, mirroring forms (§4.6). `contact`
     * resolves the respondent; `none` keeps the response alone, for the
     * self-check that should not quietly build a mailing list.
     */
    destination: text("destination", { enum: ["contact", "none"] })
      .notNull()
      .default("contact"),
    /** Addresses told about a response. Empty means nobody, which is a choice. */
    notify: text("notify").array().notNull().default([]),
    status: text("status", { enum: ["draft", "active", "closed"] })
      .notNull()
      .default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("assessments_slug_idx").on(t.slug),
    index("assessments_trash_idx")
      .on(t.trashedAt)
      .where(sql`${t.trashedAt} is not null`),
  ],
);

/**
 * One authored outcome. The only text a respondent is ever shown.
 *
 * `min_score`/`max_score` are inclusive. Two bands on one assessment may not
 * overlap, and that is enforced by an exclusion constraint in the migration
 * rather than by the service, for the same reason `bookings_no_overlap` is
 * (§4.4): a rule only the application checks is a rule that a second writer, a
 * retry, or a future caller can miss. Overlapping bands would make "which
 * outcome did they get" depend on row order, and an assessment whose answer
 * depends on row order is exactly the invented answer this module exists to
 * make impossible.
 */
export const assessmentBands = pgTable(
  "assessment_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    /** Stable handle so an owner may re-word a band without orphaning responses. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** The authored outcome. Rendered verbatim; nothing composes it. */
    body: text("body").notNull(),
    minScore: integer("min_score").notNull(),
    maxScore: integer("max_score").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("assessment_bands_key_idx").on(t.assessmentId, t.key),
    index("assessment_bands_range_idx").on(t.assessmentId, t.minScore),
    check("assessment_bands_range", sql`${t.maxScore} >= ${t.minScore}`),
  ],
);

/**
 * An answer that outranks the score.
 *
 * "If they can smell gas, stop scoring and tell them to leave." Escalation is
 * not simply a high band: one answer must be able to override a low total, and
 * the instruction is authored per rule so it can name the actual action — call
 * the utility, attend an emergency department — rather than a severity
 * adjective the reader is left to interpret.
 */
export const assessmentEscalations = pgTable(
  "assessment_escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    optionKey: text("option_key").notNull(),
    /** The authored instruction. Rendered verbatim, above the band. */
    instruction: text("instruction").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("assessment_escalations_answer_idx").on(
      t.assessmentId,
      t.questionKey,
      t.optionKey,
    ),
  ],
);

/**
 * What one person answered, and which authored outcome they were shown.
 *
 * `band_id` is NOT NULL and restricts deletion. Both halves matter: the first
 * makes an unauthored outcome unrepresentable, so the safety property is a
 * schema fact rather than a convention; the second stops an owner tidying up a
 * band and silently rewriting what somebody was already told.
 */
export const assessmentResponses = pgTable(
  "assessment_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    /**
     * Null when the assessment does not resolve contacts, or the respondent
     * gave no email. The response is kept either way — discarding what
     * somebody told the business because it does not fit the CRM is the wrong
     * trade (§4.6 makes the same call for submissions).
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    answers: jsonb("answers").notNull().default({}),
    score: integer("score").notNull(),
    bandId: uuid("band_id")
      .notNull()
      .references(() => assessmentBands.id, { onDelete: "restrict" }),
    /** Set when an answer escalated. The instruction shown outranks the band. */
    escalationId: uuid("escalation_id").references(
      () => assessmentEscalations.id,
      { onDelete: "restrict" },
    ),
    /**
     * The nonce the page was rendered with, when it had one.
     *
     * A double-click, a back button and a flaky connection all post twice, and
     * being told a second time that your boiler is urgent is worse than a
     * duplicate row in a table: it is the same judgement arriving twice as if
     * it were two. The unique index makes the second post resolve to the first
     * answer instead of creating another.
     */
    idempotencyKey: text("idempotency_key"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assessment_responses_assessment_idx").on(t.assessmentId, t.createdAt),
    index("assessment_responses_contact_idx").on(t.contactId),
    index("assessment_responses_band_idx").on(t.bandId),
    index("assessment_responses_escalation_idx").on(t.escalationId),
    uniqueIndex("assessment_responses_idempotency_idx")
      .on(t.assessmentId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);
