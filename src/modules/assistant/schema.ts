// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The front-site assistant's configuration, its permissions and its meter
// (MASTER.md §31, C9.21).
//
// §31 opens with the two words that shape every column here: "An optional
// module … **off by default, enabled by a setting in admin**". Three tables,
// each answering one question an owner would ask.
//
// **Who answers, and with whose key.** `assistant_settings` is a genuine
// singleton — one deploy is one business (§2 principle 1) — and it holds the
// provider, the model, and the *name of the environment variable* that holds
// the key. Not the key. §17 puts secrets in the environment and configuration
// in the database, and `agent_connections.credential_ref` already established
// exactly this indirection for provider credentials; copying it means a
// database dump of an instance contains no model key at all, and no read
// service has to remember to leave a column out.
//
// **What it is allowed to do.** `assistant_scope_grants` is one row per action
// the platform is willing to offer, switched on or off by the owner. The
// catalogue in `actions.ts` is the hard ceiling: an action absent from it
// cannot be granted, so the worst a compromised prompt can achieve is an
// action the owner already agreed to. The gate lives in the module, outside
// the model, which is what makes it a permission rather than an instruction.
//
// **What it cost and what it did.** `assistant_turns` is one row per attempted
// answer, including the attempts that were refused. Spend is summed from it —
// the same "check before, don't tally after" discipline `core/agents/budget`
// uses — and the refusals are the evidence an owner needs when they ask why
// the assistant went quiet. A refusal that leaves no row is a support ticket.
//
// This is deliberately *not* the transcript. The visitor's words and the
// assistant's reply are ordinary `messages` on the contact's canonical
// conversation (C7.15), because §31 requires every conversation to land on the
// spine and a second copy would be a second truth.
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
import { conversations, messages, siteChatSessions } from "@/core/messaging/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

// `none` is a provider, not an absence: it is the off fallback (§31). The
// value lists live in `contract.ts` so a screen can name one without importing
// a table.
import {
  ASSISTANT_PROVIDERS,
  ASSISTANT_SPEND_PERIODS,
  ASSISTANT_TURN_OUTCOMES,
} from "./contract";

export const assistantSettings = pgTable(
  "assistant_settings",
  {
    /** Always 1. One deploy is one business, and the database says so. */
    id: integer("id").primaryKey().default(1),
    /**
     * The off switch, and the default (§31).
     *
     * False means the public site is exactly what it was before this module
     * existed: the chat widget still works, the owner still answers it, and
     * `assistant.answer` returns "off" without reaching a provider, writing a
     * row or costing a penny.
     */
    enabled: boolean("enabled").notNull().default(false),
    provider: text("provider", { enum: ASSISTANT_PROVIDERS }).notNull().default("none"),
    /** No default: guessing a model is how an owner gets billed for a guess. */
    model: text("model"),
    /** For an OpenAI-compatible gateway — a platform host's, or a proxy. */
    baseUrl: text("base_url"),
    /**
     * The *name* of an environment variable, never a key (§17).
     *
     * Null falls back to the provider's conventional name. Keeping the
     * indirection visible is what lets the admin say "ANTHROPIC_API_KEY is not
     * set on this deploy" instead of failing at the first visitor question.
     */
    credentialRef: text("credential_ref"),
    /**
     * What this model costs, cents per million tokens (§15.4 — integer minor
     * units, even when the money is owed to a provider rather than by a
     * customer). Null falls back to the platform's published-price table; a
     * model in neither is unpriced, and an unpriced model may not spend,
     * because a budget enforced against a guessed price is not a budget.
     */
    inputCentsPerMillion: integer("input_cents_per_million"),
    outputCentsPerMillion: integer("output_cents_per_million"),
    /** A hard ceiling on one answer. Also what the spend estimate assumes. */
    maxOutputTokens: integer("max_output_tokens").notNull().default(700),
    /** What it calls itself to a visitor. Blank falls back to the business name. */
    displayName: text("display_name"),
    /**
     * The cap, in cents, per period. Zero — the default — means the assistant
     * may not spend at all, so switching the module on without setting a
     * budget cannot cost anything.
     */
    spendCapCents: integer("spend_cap_cents").notNull().default(0),
    spendPeriod: text("spend_period", { enum: ASSISTANT_SPEND_PERIODS })
      .notNull()
      .default("month"),
    /**
     * Two rate limits, because they stop different things. The per-conversation
     * cap stops one visitor holding an unbounded conversation; the hourly cap
     * stops a hundred visitors — or one script with a hundred chat sessions —
     * from emptying the budget between two glances at the admin.
     */
    repliesPerConversation: integer("replies_per_conversation").notNull().default(20),
    repliesPerHour: integer("replies_per_hour").notNull().default(60),
    /** The last thing that went wrong, in plain English, for the admin. */
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("assistant_settings_singleton", sql`${t.id} = 1`),
    check("assistant_settings_spend_cap", sql`${t.spendCapCents} >= 0`),
    check(
      "assistant_settings_max_output",
      sql`${t.maxOutputTokens} between 64 and 4000`,
    ),
    check(
      "assistant_settings_replies_per_conversation",
      sql`${t.repliesPerConversation} between 0 and 500`,
    ),
    check("assistant_settings_replies_per_hour", sql`${t.repliesPerHour} between 0 and 5000`),
    check(
      "assistant_settings_prices",
      sql`(${t.inputCentsPerMillion} is null or ${t.inputCentsPerMillion} >= 0)
        and (${t.outputCentsPerMillion} is null or ${t.outputCentsPerMillion} >= 0)`,
    ),
    // A provider with no model cannot be asked anything, and an instance that
    // stored one would fail at the first visitor question instead of at the
    // moment somebody was looking at the form.
    check(
      "assistant_settings_model_present",
      sql`${t.provider} = 'none' or ${t.model} is not null`,
    ),
  ],
);

/**
 * One owner decision per offerable action.
 *
 * A row is the grant; its absence is a refusal. `action` is a plain text key
 * rather than a foreign key to a catalogue table because the catalogue is
 * code — it names services and argument shapes, which a row cannot — and an
 * action removed from a release should stop working immediately rather than
 * keep a stale grant alive.
 *
 * Who granted it is not a column here. Every call to `assistant.setScope`
 * already writes an AuditLog row naming the actor, the service and the input,
 * inside the same transaction — a second copy would be a second answer to the
 * same question, and the one that drifts is always the copy.
 */
export const assistantScopeGrants = pgTable(
  "assistant_scope_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("assistant_scope_grants_action_idx").on(t.action)],
);

/**
 * One attempted answer, whatever became of it.
 *
 * `messageId` is unique, which makes an answer idempotent: a browser that
 * retries, or two tabs racing, produce one attempt against one visitor
 * message. A refused attempt occupies the slot too, on purpose — a visitor
 * clicking again should not spend the next penny of a budget that was already
 * exhausted a second ago. The way to another answer is another question.
 */
export const assistantTurns = pgTable(
  "assistant_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    chatSessionId: uuid("chat_session_id").references(() => siteChatSessions.id, {
      onDelete: "set null",
    }),
    /** The visitor message this was an attempt to answer. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    outcome: text("outcome", { enum: ASSISTANT_TURN_OUTCOMES }).notNull(),
    /** Why, for a person reading the admin. Never a provider body. */
    detail: text("detail"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    /** The catalogue action the model asked for, if it asked for one. */
    action: text("action"),
    /** Whether that ask was inside the owner's grants. Null when none was made. */
    actionAllowed: boolean("action_allowed"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("assistant_turns_message_idx")
      .on(t.messageId)
      .where(sql`message_id is not null`),
    index("assistant_turns_conversation_idx").on(t.conversationId, t.createdAt),
    // The spend query: everything since the start of the current period.
    index("assistant_turns_created_idx").on(t.createdAt),
    check("assistant_turns_cost", sql`${t.costCents} >= 0`),
    check(
      "assistant_turns_tokens",
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0`,
    ),
    check(
      "assistant_turns_detail",
      sql`${t.detail} is null or char_length(${t.detail}) <= 1000`,
    ),
  ],
);

export type AssistantTurn = typeof assistantTurns.$inferSelect;
export type AssistantSettings = typeof assistantSettings.$inferSelect;
