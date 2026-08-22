// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Negotiable offers (MASTER.md §4.3's `Quote`, C6.12).
//
// §4.3's state machine, exactly:
//
//   draft → sent → viewed → (negotiating ⇄) → accepted | declined | expired
//
// The design decision that shapes every table here is **versioning**. A quote
// is not one offer that gets edited; it is a sequence of offers, and the one
// somebody accepted has to still be readable afterwards. So line items carry
// the version they belong to, revising writes a new set rather than updating
// the old, and `quotes.version` says which set is live. A customer who says
// "but you quoted me £4,000" is right or wrong on the evidence rather than on
// anybody's memory.
//
// The second is **optional items the client can toggle** (§4.3's
// `QuoteItem.optional`). That makes the total a function of what they chose,
// which is why acceptance snapshots the selection rather than recomputing it
// later from rows somebody may since have edited.
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "negotiating",
  "accepted",
  "declined",
  "expired",
] as const;

/** The statuses a customer can still act on. Everything else is history. */
export const OPEN_STATUSES = ["sent", "viewed", "negotiating"] as const;

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    /** Human-facing, sequential, and the thing an owner says on the phone. */
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    /** Which set of line items is live. Revising increments it. */
    version: integer("version").notNull().default(1),
    currency: text("currency").notNull(),
    /**
     * After this, the offer lapses on its own.
     *
     * A quote that stays open forever is a price the business is still bound
     * by two years later, which is exactly what a validity date exists to
     * prevent — so expiry is swept by a job rather than judged on a screen.
     */
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /** In minor units when set: what must be paid before work starts. */
    depositMinor: bigint("deposit_minor", { mode: "number" }),
    /** The terms as they stood when this version was sent. A snapshot. */
    terms: text("terms"),
    notes: text("notes"),
    /** Signed, so a prospect reads and accepts with no account (§4.3). */
    viewToken: text("view_token"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Who accepted, when it was somebody signed in rather than the token. */
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    /**
     * What was actually agreed, frozen at acceptance.
     *
     * Optional items make the total a function of what the customer chose, so
     * recomputing it later from rows somebody may since have revised would
     * answer a different question from the one they said yes to.
     */
    acceptedSnapshot: jsonb("accepted_snapshot"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("quotes_reference_idx").on(t.reference),
    index("quotes_contact_idx").on(t.contactId),
    index("quotes_status_idx").on(t.status, t.validUntil),
    uniqueIndex("quotes_view_token_idx")
      .on(t.viewToken)
      .where(sql`${t.viewToken} is not null`),
    check("quotes_version", sql`${t.version} > 0`),
    check("quotes_deposit", sql`${t.depositMinor} is null or ${t.depositMinor} >= 0`),
    check("quotes_title", sql`char_length(${t.title}) between 1 and 200`),
    // An accepted quote without the thing it accepted is a number nobody can
    // defend — the shape a bug leaves.
    check(
      "quotes_accepted_complete",
      sql`${t.status} <> 'accepted'
        or (${t.acceptedAt} is not null and ${t.acceptedSnapshot} is not null)`,
    ),
  ],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /**
     * The version these words and this price belong to.
     *
     * Rows are never edited across versions; a revision writes a new set. That
     * is what makes "you quoted me £4,000" answerable from the database rather
     * than from anybody's memory.
     */
    version: integer("version").notNull(),
    description: text("description").notNull(),
    /** Six-decimal fixed point, as everywhere else money meets quantity. */
    quantityMicros: bigint("quantity_micros", { mode: "number" })
      .notNull()
      .default(1_000_000),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    /** §4.3: the client can toggle these. Everything else is the offer. */
    optional: boolean("optional").notNull().default(false),
    /** Whether an optional line is currently chosen. Meaningless when required. */
    selected: boolean("selected").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("quote_items_quote_idx").on(t.quoteId, t.version, t.sortOrder),
    check("quote_items_version", sql`${t.version} > 0`),
    check("quote_items_quantity", sql`${t.quantityMicros} > 0`),
    check("quote_items_price", sql`${t.unitPriceMinor} >= 0`),
    check(
      "quote_items_description",
      sql`char_length(${t.description}) between 1 and 500`,
    ),
  ],
);

export const QUOTE_AUTHORS = ["owner", "contact"] as const;

/**
 * The negotiation, kept where the quote is (§4.3's `QuoteMessage`).
 *
 * A thread rather than an email chain, because "what did we agree about the
 * second bathroom" is a question about *this quote* and the answer should not
 * live in somebody's inbox. `proposedChanges` carries what a customer asked
 * for without applying it — a counter-offer is a message, and only the owner
 * turns one into a revision.
 */
export const quoteMessages = pgTable(
  "quote_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /** Which version they were looking at, so a reply reads in context. */
    version: integer("version").notNull(),
    author: text("author", { enum: QUOTE_AUTHORS }).notNull(),
    /** Set when the author was signed in; null for the token path. */
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    proposedChanges: jsonb("proposed_changes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("quote_messages_quote_idx").on(t.quoteId, t.createdAt),
    check("quote_messages_body", sql`char_length(${t.body}) between 1 and 10000`),
  ],
);

/** Sequence for the human-facing reference, one per instance (single-tenant). */
export const quoteSequences = pgTable("quote_sequences", {
  id: text("id").primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
  updatedAt: updatedAtColumn(),
});
