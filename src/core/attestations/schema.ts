// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-supplied facts, with their source and the moment they were true
// (MASTER.md §4.18, principle 13, C8.15).
//
// One table, and the shape of it is the argument. A rate, a metric, an opening
// status and a byline are all the same thing: something the business asserts,
// which somebody stood behind, at a moment that can be named. Storing them as
// one kind of row is what makes "no unattested claim" a rule the codebase can
// actually keep, rather than a promise each module re-makes in its own way.
//
// Nothing here is ever edited. A correction is a *new row* that supersedes the
// old one, and the old one keeps its value and its dates. That is the whole
// correction ledger — it is the storage model rather than a feature beside it,
// which is also why a rate history exists without anybody building one.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const attestations = pgTable(
  "attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * What fact this is: `rate.30-year-fixed`, `status.service`, `metric.arr`.
     *
     * Namespaced by convention rather than by constraint, because the set is
     * open — a module nobody has written yet still needs somewhere to put the
     * one number its industry publishes.
     */
    key: text("key").notNull(),
    /**
     * What it is about, when it is about something. Untyped, as reviews record
     * their subject (§4.6), so a fact may attach to a product, a location, a
     * page — or to nothing, which is the common case for a business-wide rate.
     */
    subjectKind: text("subject_kind"),
    subjectId: text("subject_id"),
    /**
     * The fact itself. jsonb because the shape is owner-defined and varies by
     * key — exactly the case principle 12 permits, and the reason it does.
     */
    value: jsonb("value").notNull(),
    /**
     * Where the owner got it: a rate sheet, a supplier, a licence register.
     *
     * Required, and that is the point. A number with no answer to "says who?"
     * is the thing this table exists to stop being publishable.
     */
    source: text("source").notNull(),
    /** The moment it was true. Not when it was typed. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /**
     * When it stops being current, if the owner knows. Past it the fact
     * renders as stale rather than as current — it is not hidden, because
     * "we last knew this on Tuesday" is honest and silence is not.
     */
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /**
     * Who recorded it: `user:<id>`, `agent:<key-name>`, or `system`.
     *
     * Text rather than a users foreign key, following `audit_log`: an actor is
     * not always a person, and typing the column uuid would assert something
     * untrue of every fact an agent or a scheduled job records.
     */
    recordedBy: text("recorded_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * Unpublished everywhere that reads it — page, feed, sitemap, JSON-LD,
     * export — without deleting the row. A consent withdrawal sets this, which
     * is how a person removes their photograph from a results wall without
     * erasing the record that it was once lawfully published.
     */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    /** The fact this one replaces. Null for the first statement of a key. */
    supersedesId: uuid("supersedes_id"),
    /**
     * Set on the *old* row when a correction replaces it.
     *
     * Denormalized from `supersedes_id` deliberately: "is this row still
     * current" has to be answerable by an index, and a backwards pointer
     * cannot be. It is what makes one-current-fact-per-key a database
     * guarantee rather than a service convention.
     */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    /** Why it changed. Shown in the ledger beside the value it replaced. */
    correctionNote: text("correction_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("attestations_key_idx").on(t.key, t.createdAt),
    index("attestations_subject_idx").on(t.subjectKind, t.subjectId),
    index("attestations_supersedes_idx").on(t.supersedesId),
    check(
      "attestations_not_self_superseding",
      sql`${t.supersedesId} is null or ${t.supersedesId} <> ${t.id}`,
    ),
    check(
      "attestations_validity_after_as_of",
      sql`${t.validUntil} is null or ${t.validUntil} > ${t.asOf}`,
    ),
    // Two corrections of the same fact would fork the ledger, and "which one
    // replaced it" would become a question with two answers.
    uniqueIndex("attestations_one_correction_idx")
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
  ],
);
