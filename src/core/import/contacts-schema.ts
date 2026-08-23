// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importing a contact list, reversibly (MASTER.md §4.1, C7.07).
//
// Separate from `import_runs` (C3.21's content importer) on purpose. That one
// pulls pages out of a WordPress site and has no notion of a row; this one
// writes to the **contact spine**, where reversibility means being able to say,
// per person, what the file did to them and what they looked like before. A
// shared table would have to carry both shapes and would end up describing
// neither.
//
// Two decisions the columns encode.
//
// **The file is stored parsed, not raw.** Every row is a row here, with its
// line number, so validation, the dry run and the commit all read the same
// thing. Re-parsing at each step would let a subtle difference between two
// parses turn a preview into a promise the commit does not keep.
//
// **Every applied row keeps what it overwrote.** `before_state` is what makes
// the batch reversible: undoing is restoring those values, not guessing at
// them. Rows the import *created* carry a null before-state and are identified
// by `created`, because undoing a creation is a different act from undoing an
// edit.
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
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const CONTACT_IMPORT_STATUSES = [
  "mapping",
  "validated",
  "committed",
  "reverted",
  "failed",
] as const;

/**
 * What one row will do, decided before anything is written.
 *
 * `skip` is not `error`. A row with no email address cannot be resolved to a
 * person and is skipped; a row whose email is malformed is an error the owner
 * should see and fix. Collapsing them would bury real mistakes in a count of
 * blanks.
 */
export const CONTACT_IMPORT_OUTCOMES = ["create", "update", "unchanged", "skip", "error"] as const;

export const contactImports = pgTable(
  "contact_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    delimiter: text("delimiter").notNull().default(","),
    headers: text("headers")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** One entry per column: which contact field it feeds, or `ignore`. */
    mapping: text("mapping")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * What `source` to record on contacts this file creates (§4.1).
     *
     * First-touch attribution is never rewritten, so this only ever lands on
     * genuinely new people — but it has to be *something*, or an import
     * silently produces contacts nobody can trace.
     */
    source: text("source").notNull().default("import"),
    status: text("status", { enum: CONTACT_IMPORT_STATUSES }).notNull().default("mapping"),
    /** The dry-run summary: how many of each outcome, computed before commit. */
    counts: jsonb("counts").notNull().default({}),
    error: text("error"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("contact_imports_status_idx").on(t.status, t.createdAt),
    check("contact_imports_filename", sql`char_length(${t.filename}) between 1 and 300`),
    // A committed import knows when, and so does a reverted one. Without this,
    // "what did we import last Tuesday" has no answer.
    check(
      "contact_imports_committed_has_time",
      sql`${t.status} <> 'committed' or ${t.committedAt} is not null`,
    ),
    check(
      "contact_imports_reverted_has_time",
      sql`${t.status} <> 'reverted' or ${t.revertedAt} is not null`,
    ),
  ],
);

export const contactImportRows = pgTable(
  "contact_import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => contactImports.id, { onDelete: "cascade" }),
    /** The line in the file, so an error message points at something real. */
    lineNumber: integer("line_number").notNull(),
    /** The parsed cells, exactly as read. */
    cells: text("cells")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** The email this row resolves on, normalised. Null means unresolvable. */
    email: text("email"),
    outcome: text("outcome", { enum: CONTACT_IMPORT_OUTCOMES }).notNull().default("skip"),
    /** Why it cannot be applied, in words an owner can act on. */
    errors: text("errors")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** What the row would change, for the dry-run diff. */
    changes: jsonb("changes").notNull().default({}),
    /** Filled at commit. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** True when this row brought the contact into existence. */
    created: boolean("created").notNull().default(false),
    /** What the contact looked like before, so the batch can be undone. */
    beforeState: jsonb("before_state"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("contact_import_rows_import_idx").on(t.importId, t.lineNumber),
    index("contact_import_rows_outcome_idx").on(t.importId, t.outcome),
    index("contact_import_rows_contact_idx").on(t.contactId),
    // One row per line per import. A commit that ran twice would otherwise
    // double the ledger and make the revert restore the wrong state.
    uniqueIndex("contact_import_rows_line_idx").on(t.importId, t.lineNumber),
  ],
);
