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
import { MESSAGE_PURPOSES } from "./purpose";

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
    /** The assistant explicitly asked a person to take over this thread. */
    assistantEscalatedAt: timestamp("assistant_escalated_at", { withTimezone: true }),
    assistantEscalationReason: text("assistant_escalation_reason"),
    /** Kept separately so the handoff remains visible as evidence after resolution. */
    assistantEscalationResolvedAt: timestamp("assistant_escalation_resolved_at", {
      withTimezone: true,
    }),
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
    check(
      "conversations_assistant_escalation_reason",
      sql`${t.assistantEscalationReason} is null or char_length(${t.assistantEscalationReason}) <= 1000`,
    ),
    check(
      "conversations_assistant_escalation_state",
      sql`${t.assistantEscalationResolvedAt} is null or ${t.assistantEscalatedAt} is not null`,
    ),
  ],
);

/**
 * One browser's bounded window onto a canonical Contact conversation.
 *
 * The raw bearer token never reaches the database. Messages carry this id so
 * the visitor can read exactly this session, not email/SMS/history that happens
 * to share the same Contact thread.
 */
export const siteChatSessions = pgTable(
  "site_chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    locale: text("locale").notNull().default("en"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("site_chat_sessions_token_idx").on(t.tokenHash),
    index("site_chat_sessions_contact_idx").on(t.contactId, t.createdAt),
    index("site_chat_sessions_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("site_chat_sessions_one_open_idx")
      .on(t.conversationId)
      .where(sql`closed_at is null`),
    check("site_chat_sessions_token_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "site_chat_sessions_expiry",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check("site_chat_sessions_locale", sql`char_length(${t.locale}) between 2 and 35`),
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
    /** Why it was sent. Inbound messages have no purpose. */
    purpose: text("purpose", { enum: MESSAGE_PURPOSES }),
    /** A system-only reason that deliberately crossed recipient quiet hours. */
    policyException: text("policy_exception"),
    /** The booking/security/support record that justifies the exception. */
    policyExceptionRef: text("policy_exception_ref"),
    body: text("body").notNull(),
    /** MMS and attachments come from `core/media` — one library, one pipeline. */
    mediaAssetIds: uuid("media_asset_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Limits a public chat bearer to the messages created in its own session. */
    chatSessionId: uuid("chat_session_id").references(() => siteChatSessions.id, {
      onDelete: "set null",
    }),
    templateId: uuid("template_id"),
    sentBy: text("sent_by", { enum: MESSAGE_AUTHORS }).notNull(),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** The provider's id for this message. The idempotency key for ingest. */
    providerRef: text("provider_ref"),
    /** The exact outbound address, so a later hard failure cannot poison a changed number. */
    recipientAddress: text("recipient_address"),
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
    index("messages_chat_session_idx").on(t.chatSessionId, t.occurredAt),
    // One message per provider reference. Every provider retries its webhooks,
    // and a duplicate here is a duplicate in somebody's inbox and in the bill.
    uniqueIndex("messages_provider_ref_idx")
      .on(t.providerRef)
      .where(sql`provider_ref is not null`),
    check("messages_body", sql`char_length(${t.body}) between 1 and 100000`),
    check("messages_cost", sql`${t.costMinor} is null or ${t.costMinor} >= 0`),
    check(
      "messages_recipient_address_length",
      sql`${t.recipientAddress} is null or char_length(${t.recipientAddress}) <= 320`,
    ),
    check(
      "messages_policy_exception_pair",
      sql`(${t.policyException} is null and ${t.policyExceptionRef} is null)
        or (${t.policyException} is not null and ${t.policyExceptionRef} is not null)`,
    ),
    // A cost with no currency is a number nobody can add up (§15.4).
    check(
      "messages_cost_currency",
      sql`${t.costMinor} is null or ${t.costCurrency} is not null`,
    ),
  ],
);

export const SMS_COMPLIANCE_INTENTS = ["stop", "start", "help"] as const;

/**
 * A carrier control word is compliance evidence, not an inbox message.
 *
 * Keeping it separate lets STOP take effect before a message event, automation,
 * or human inbox sees anything. The provider reference is the idempotency guard
 * because carriers retry the same webhook until they receive a success.
 */
export const smsComplianceEvents = pgTable(
  "sms_compliance_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    providerRef: text("provider_ref").notNull(),
    intent: text("intent", { enum: SMS_COMPLIANCE_INTENTS }).notNull(),
    keyword: text("keyword").notNull(),
    locale: text("locale").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("sms_compliance_events_provider_ref_idx").on(t.providerRef),
    index("sms_compliance_events_contact_idx").on(t.contactId, t.occurredAt),
    check("sms_compliance_events_keyword", sql`char_length(${t.keyword}) between 1 and 100`),
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

export const KEYWORD_MATCH_KINDS = ["exact", "prefix"] as const;
export const KEYWORD_ACTIONS = [
  "opt_out",
  "opt_in",
  "help",
  "auto_reply",
  "tag",
  "route",
  "booking_confirm",
] as const;

/** Owner rules run only after the non-configurable STOP/START/HELP vocabulary. */
export const keywordRules = pgTable(
  "keyword_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyword: text("keyword").notNull(),
    normalizedKeyword: text("normalized_keyword").notNull(),
    match: text("match", { enum: KEYWORD_MATCH_KINDS }).notNull().default("exact"),
    action: text("action", { enum: KEYWORD_ACTIONS }).notNull(),
    /** Tag text or a routing user id, depending on `action`. */
    actionValue: text("action_value"),
    replyBody: text("reply_body"),
    /** BCP-47 language, or `*` for every contact locale. */
    locale: text("locale").notNull().default("*"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("keyword_rules_match_idx").on(t.normalizedKeyword, t.match, t.locale),
    index("keyword_rules_active_idx").on(t.active, t.locale),
    check("keyword_rules_keyword_length", sql`char_length(${t.keyword}) between 1 and 100`),
    check(
      "keyword_rules_action_value",
      sql`(${t.action} in ('tag', 'route') and ${t.actionValue} is not null)
        or (${t.action} not in ('tag', 'route') and ${t.actionValue} is null)`,
    ),
    check("keyword_rules_match_allowed", sql`${t.match} in ('exact', 'prefix')`),
    check(
      "keyword_rules_action_allowed",
      sql`${t.action} in ('opt_out','opt_in','help','auto_reply','tag','route','booking_confirm')`,
    ),
    check(
      "keyword_rules_reply_required",
      sql`${t.action} not in ('help', 'auto_reply') or ${t.replyBody} is not null`,
    ),
  ],
);

/** Idempotency and human-readable evidence for one applied owner keyword. */
export const keywordRuleEvents = pgTable(
  "keyword_rule_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerRef: text("provider_ref").notNull(),
    ruleId: uuid("rule_id").references(() => keywordRules.id, { onDelete: "set null" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    action: text("action", { enum: KEYWORD_ACTIONS }).notNull(),
    outcome: text("outcome", { enum: ["applied", "refused", "noop"] }).notNull(),
    detail: text("detail"),
    bookingId: uuid("booking_id"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("keyword_rule_events_provider_idx").on(t.providerRef),
    index("keyword_rule_events_contact_idx").on(t.contactId, t.createdAt),
    index("keyword_rule_events_rule_idx").on(t.ruleId, t.createdAt),
    check(
      "keyword_rule_events_action_allowed",
      sql`${t.action} in ('opt_out','opt_in','help','auto_reply','tag','route','booking_confirm')`,
    ),
    check(
      "keyword_rule_events_outcome_allowed",
      sql`${t.outcome} in ('applied','refused','noop')`,
    ),
  ],
);
