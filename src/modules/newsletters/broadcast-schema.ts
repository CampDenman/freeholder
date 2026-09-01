// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sending one message to many people (MASTER.md §30, §4.14, C9.06).
//
// A broadcast is a template plus an audience plus a moment. It is deliberately
// none of those things itself: the wording is an `EmailTemplate` (C9.05), the
// audience is a `Segment` (§30's "unit of who"), and the sending is
// `core/mail`'s `sendMail`, which already refuses a suppressed address and
// insists on a verified bulk sender.
//
// What this adds is the part that has to be *durable*: which recipients were
// chosen, which have been sent, and what happened to each. §30 wants honest
// local analytics, and honest means counted from rows rather than trusted from
// a provider's dashboard — a provider that loses a webhook should make a
// number stop rising, not make it wrong.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { mailDeliveries } from "@/core/mail/schema";
import { segments } from "@/core/segments/schema";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { emailTemplates } from "./template-schema";

export const BROADCAST_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "paused",
  "cancelled",
] as const;

/** What happened to one person's copy. Counted, never guessed. */
export const RECIPIENT_STATES = [
  "pending",
  "sent",
  "failed",
  "suppressed",
  "bounced",
  "complained",
] as const;

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** The wording. A broadcast never holds blocks of its own (C9.05). */
    templateId: uuid("template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "restrict" }),
    /**
     * Who it goes to. §30: a `Segment` is "the unit of 'who' for campaigns,
     * price lists, automations and reports" — so a broadcast names one rather
     * than growing its own idea of an audience, which is the drift C7.17 is
     * about.
     */
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "restrict" }),
    /**
     * Overrides the template's subject when set.
     *
     * A campaign's subject is the thing an owner rewrites most and tests
     * hardest, and forcing a new template per subject line would make the
     * template list unusable within a month.
     */
    subject: text("subject"),
    status: text("status", { enum: BROADCAST_STATUSES }).notNull().default("draft"),
    /** When it should go. Null means "when somebody presses send". */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /**
     * The audience, frozen at the moment sending began.
     *
     * §30's segments are dynamic queries, so "who is in it" changes as
     * customers do. A broadcast that re-read the segment mid-send would mail
     * people who joined after it started and skip people who left — and could
     * never answer "who did this actually go to". So `broadcast_recipients` is
     * written once, up front, and this is its size.
     */
    audienceCount: integer("audience_count").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("broadcasts_status_idx").on(t.status, t.scheduledAt),
    index("broadcasts_template_idx").on(t.templateId),
  ],
);

/**
 * One person's copy, and what became of it.
 *
 * A row per recipient rather than a counter per broadcast. §30 asks for honest
 * analytics, and a counter cannot answer "did Nils get it", cannot be
 * recomputed after a provider replays a webhook, and cannot resume a send that
 * stopped halfway — all three of which a table can.
 */
export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /**
     * The address as it was when the audience was frozen.
     *
     * Copied rather than read through: a contact who changes their email after
     * a send should not make the record claim the message went somewhere it
     * did not.
     */
    email: text("email").notNull(),
    state: text("state", { enum: RECIPIENT_STATES }).notNull().default("pending"),
    /** Why, when the state is a refusal. */
    detail: text("detail"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /**
     * Which `mail_deliveries` row this copy was.
     *
     * Provider feedback arrives hours or weeks later and names an address, not
     * a campaign. Matching on the address alone would credit a bounce to
     * whichever campaign happened to mail that person most recently — which is
     * precisely the kind of number §30's "honest analytics" is not.
     */
    deliveryId: uuid("delivery_id").references(() => mailDeliveries.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // One copy per person per broadcast. A resumed send must not double up,
    // and under concurrency only the index holds that.
    uniqueIndex("broadcast_recipients_once_idx").on(t.broadcastId, t.contactId),
    // The send loop's own query: the next unsent batch, oldest first.
    index("broadcast_recipients_pending_idx")
      .on(t.broadcastId, t.createdAt)
      .where(sql`${t.state} = 'pending'`),
    index("broadcast_recipients_contact_idx").on(t.contactId),
    // Reverse lookup for provider feedback: given a delivery, whose copy was it.
    index("broadcast_recipients_delivery_idx").on(t.deliveryId),
  ],
);
