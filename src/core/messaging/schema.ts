// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One conversation with one person, whatever it arrived on (§4.14, C7.08).
//
// §4.14 says two things about a conversation that do not obviously agree, and
// this file is where the disagreement had to be settled.
//
// The entity table calls a `Conversation` "one thread with one person on one
// channel". The rule twenty lines earlier says: "The inbox threads by contact,
// not by channel. A form submission, a reply to it by email, and a text message
// about the same job belong in one conversation — that is the entire promise of
// a spine, made visible."
//
// Both are true of different things, and the resolution is to say which:
//
//   * **A message carries its own channel.** How it arrived is a fact about
//     that message, and it never changes.
//   * **A conversation carries a *reply* channel.** How you would answer is a
//     fact about the thread, and it can change — somebody who emailed you may
//     ask to be texted.
//
// So a thread can hold a form submission, the email reply to it and a text
// about the same job, which is what the rule promises, while replying still has
// one unambiguous route, which is what the entity row was protecting. MASTER's
// entity row is amended in the same change to say so.
//
// The other decision here: **`contact_id` is on the message as well as the
// thread.** It is denormalised on purpose — a contact's timeline, an export and
// an erasure all ask "what did this person say", and none of them should have
// to join through a thread that a merge may since have repointed.
import { sql } from "drizzle-orm";
import {
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
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * Every door a message can come through (§4.14, C7.08).
 *
 * `form` is a channel like any other, which is the point: a contact form is how
 * most conversations with a small business actually start, and a platform that
 * treats submissions as a separate species ends up with two inboxes.
 *
 * `assistant` is the site's own chat answering on the business's behalf — kept
 * distinct from `chat` (a person typing) because "who said this" is the first
 * thing anybody reading the thread needs to know.
 */
export const MESSAGE_CHANNELS = [
  "form",
  "email",
  "sms",
  "mms",
  "chat",
  "assistant",
  "social",
] as const;

export const CONVERSATION_STATUSES = ["open", "snoozed", "closed"] as const;

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;

/** Who put the words there. `contact` is the person themselves. */
export const MESSAGE_AUTHORS = ["contact", "user", "system", "automation", "agent"] as const;

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Always a real contact, never an orphan thread.
     *
     * §4.14: "An inbound message resolves to a Contact, always." A thread with
     * nobody attached is a thread nobody can act on — no history, no consent
     * record, no way to answer "who is this".
     */
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    subject: text("subject"),
    /** How a reply would go out. Changeable; the messages keep their own. */
    replyChannel: text("reply_channel", { enum: MESSAGE_CHANNELS }).notNull(),
    /**
     * The number this runs on, once there are numbers (C7.11).
     *
     * Untyped by a foreign key for now, the same trade C6.15's `project_links`
     * makes: the table that will own it does not exist yet, and a column added
     * later would mean a second migration on a table already in use.
     */
    numberId: uuid("number_id"),
    status: text("status", { enum: CONVERSATION_STATUSES }).notNull().default("open"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Something the provider calls this thread, if it has a name for it.
     *
     * An email thread arrives with `References` headers, a chat with a session
     * id. Storing it is what lets the second message land in the first one's
     * thread rather than starting a new one beside it.
     */
    threadKey: text("thread_key"),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    /** Waiting on somebody here. Set by an inbound message, cleared by reading. */
    unread: boolean("unread").notNull().default(false),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // The inbox: what is open, most recently active first.
    index("conversations_status_idx").on(t.status, t.updatedAt),
    // Everything with one person, which is §4.14's "threads by contact".
    index("conversations_contact_idx").on(t.contactId, t.updatedAt),
    index("conversations_assignee_idx").on(t.assigneeUserId, t.status),
    // One thread per provider thread id. Without this a retried webhook opens a
    // second conversation beside the first and the reply goes to the wrong one.
    uniqueIndex("conversations_thread_key_idx")
      .on(t.threadKey)
      .where(sql`thread_key is not null`),
    check("conversations_subject", sql`${t.subject} is null or char_length(${t.subject}) <= 500`),
    // A snoozed thread knows when it comes back. Otherwise it is closed with
    // extra steps, and the one thing snoozing promises is that it returns.
    check(
      "conversations_snoozed_has_time",
      sql`${t.status} <> 'snoozed' or ${t.snoozedUntil} is not null`,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Denormalised so a timeline, an export and an erasure need no join. */
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    /** How *this* message arrived or went. Never changes. */
    channel: text("channel", { enum: MESSAGE_CHANNELS }).notNull(),
    body: text("body").notNull(),
    /** MMS and attachments come from `core/media` — one library, one pipeline. */
    mediaAssetIds: uuid("media_asset_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    templateId: uuid("template_id"),
    sentBy: text("sent_by", { enum: MESSAGE_AUTHORS }).notNull(),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** The provider's id for this message. The idempotency key for ingest. */
    providerRef: text("provider_ref"),
    /**
     * What it cost, in integer minor units (§15.4).
     *
     * §4.14: "Cost is visible per message and per campaign… SMS is the one
     * channel where an owner can spend real money by accident." Recorded per
     * message so the answer is arithmetic rather than an estimate.
     */
    segments: integer("segments"),
    costMinor: integer("cost_minor"),
    costCurrency: text("cost_currency"),
    /** When it actually happened, which is not when the row was written. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.occurredAt),
    index("messages_contact_idx").on(t.contactId, t.occurredAt),
    // One message per provider reference. Every provider retries its webhooks,
    // and a duplicate here is a duplicate in somebody's inbox and in the bill.
    uniqueIndex("messages_provider_ref_idx")
      .on(t.providerRef)
      .where(sql`provider_ref is not null`),
    check("messages_body", sql`char_length(${t.body}) between 1 and 100000`),
    check("messages_cost", sql`${t.costMinor} is null or ${t.costMinor} >= 0`),
    // A cost with no currency is a number nobody can add up (§15.4).
    check(
      "messages_cost_currency",
      sql`${t.costMinor} is null or ${t.costCurrency} is not null`,
    ),
  ],
);

export const DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "undelivered",
  "read",
] as const;

/**
 * What the carrier said happened (§4.14, C7.08).
 *
 * A separate table rather than a column, because delivery is a *sequence*:
 * queued, then sent, then delivered, then read — and a hard failure between any
 * two of them is the thing an owner needs to see. §4.14: "Delivery is observed,
 * not assumed."
 */
export const messageDeliveries = pgTable(
  "message_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull(),
    /** The provider's own code, kept verbatim so support can quote it. */
    errorCode: text("error_code"),
    errorText: text("error_text"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("message_deliveries_message_idx").on(t.messageId, t.occurredAt),
    // One report per message per status. Providers resend the same callback,
    // and a doubled "delivered" turns a history into noise.
    uniqueIndex("message_deliveries_once_idx").on(t.messageId, t.status),
  ],
);
