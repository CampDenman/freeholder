// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What somebody wrote down (MASTER.md §4.14, C7.03).
//
// §4.14: "`Note` — free text against a contact, deal, project or booking, with
// mentions." Attached the same way a task is, to the same closed list of
// subjects, and in core for the same reason: a note goes on five things owned
// by four modules, so no module should have to depend on another to hold one.
//
// Three decisions the columns encode.
//
// **Visibility is three states, not a boolean.** `team` is the default and what
// almost every note is. `private` is the author's own — the note about a
// difficult conversation that nobody else needs. `shared` is written *to* the
// customer and appears in their portal. Collapsing the last two into "internal"
// would leave an owner with no way to write something down without either
// hiding it from their colleague or showing it to the client.
//
// **An edit is a revision, not an overwrite.** A note is often the only record
// of what somebody agreed on a phone call, and a record that can be silently
// rewritten is not evidence. `note_revisions` keeps what it said before, who
// changed it and when, and the note carries the count so a screen can say "edited"
// without a second query.
//
// **Mentions are an array of user ids, not parsed from the body.** The body is
// what a person typed and stays exactly that; who was meant is a separate fact
// the service records, so renaming somebody never rewrites a note and a mention
// survives the text being edited around it.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { SUBJECT_KINDS } from "@/core/subjects";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** The same list a task attaches to, so the two never diverge. */
export const NOTE_SUBJECTS = SUBJECT_KINDS;

export const NOTE_VISIBILITIES = ["team", "private", "shared"] as const;

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * What it is about. Required, unlike a task's.
     *
     * A task about nothing is a real thing — "ring the accountant" — but a note
     * about nothing is a diary entry, and a CRM that accepts one has quietly
     * become a notebook nobody will search.
     */
    subjectType: text("subject_type", { enum: SUBJECT_KINDS }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** Who it concerns, taken from the subject, for the contact timeline. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /**
     * Who wrote it. Nullable only because an account can be deleted, and a note
     * losing its author is better than a note disappearing with them.
     */
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    visibility: text("visibility", { enum: NOTE_VISIBILITIES }).notNull().default("team"),
    /**
     * Kept at the top of the subject's notes.
     *
     * The one fact about this customer that everybody needs before they open
     * their mouth — the allergy, the deceased spouse, the thing they will not
     * be sold again. That is what pinning is for, and it is why a pin is a
     * column rather than a tag.
     */
    pinned: boolean("pinned").notNull().default(false),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** Whose attention was asked for. User ids, recorded rather than parsed. */
    mentions: uuid("mentions")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** How many times it has been rewritten, so a screen can say so cheaply. */
    editCount: integer("edit_count").notNull().default(0),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // Everything about one thing, pinned first then newest — which is the only
    // order this table is ever read in.
    index("notes_subject_idx").on(t.subjectType, t.subjectId, t.pinned, t.createdAt),
    index("notes_contact_idx").on(t.contactId, t.createdAt),
    index("notes_author_idx").on(t.authorUserId),
    check("notes_body", sql`char_length(${t.body}) between 1 and 20000`),
    // A pin knows when it was pinned, so "who put this at the top and when" is
    // answerable — the note at the top of a customer is the one that shapes
    // every conversation, and an anonymous one is worse than none.
    check("notes_pinned_has_time", sql`${t.pinned} = false or ${t.pinnedAt} is not null`),
    // An edited note has an edit; a note with edits has a time.
    check(
      "notes_edited_has_time",
      sql`${t.editCount} = 0 or ${t.editedAt} is not null`,
    ),
  ],
);

/**
 * What a note said before (§4.14, C7.03).
 *
 * One row per edit, holding the *previous* body — so the note itself is always
 * current and the history reads backwards from it. Keeping the new body here
 * instead would make every read of "what does this say now" a two-table
 * question, which is the wrong trade for a table read constantly and written
 * rarely.
 */
export const noteRevisions = pgTable(
  "note_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    /** What it said before this edit. */
    body: text("body").notNull(),
    /** Who made the change that replaced it. */
    editedBy: uuid("edited_by").references(() => users.id, { onDelete: "set null" }),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
  },
  (t) => [index("note_revisions_note_idx").on(t.noteId, t.editedAt)],
);
