// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Outbound webhooks (MASTER.md §11's event bus, §28's integration surface).
//
// The bus already fans committed events out to modules inside this process.
// A webhook is the same fan-out pointed at somebody else's server, and the
// difference is entirely in what can go wrong: their endpoint is down, slow,
// behind a redirect, or answering 500 for an hour. So the delivery is a *row*
// before it is a request. Nothing about "we tried to tell them" lives only in
// a log line or in the memory of a process that may be restarted mid-flight.
//
// Two tables, and the split matters: a subscription is configuration an owner
// manages, a delivery is a fact about one attempt. Keeping attempts on the
// subscription would make "what happened yesterday" unanswerable.
import { sql } from "drizzle-orm";
import {
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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { outboxEvents } from "@/core/events/schema";

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What this is for, in the owner's words: "Zapier", "our warehouse". */
    name: text("name").notNull(),
    url: text("url").notNull(),
    /**
     * Which events to send. Exact names (`contact.created`), families
     * (`contact.*`), or `*` for everything — the same shape as an API key's
     * scopes, because an owner who has learned one should not have to learn a
     * second.
     */
    events: text("events").array().notNull().default(sql`'{}'`),
    /**
     * The shared secret each request is signed with.
     *
     * Stored in the clear, unlike an API key, and the difference is real: a
     * key is something a caller presents to us, so we only ever need to
     * recognise it, and a hash suffices. A signing secret has to be *used* to
     * compute an HMAC on every delivery, and the receiver holds the same
     * value. There is nothing to compare it against and so nothing a hash
     * could do except make signing impossible.
     */
    secret: text("secret").notNull(),
    status: text("status", { enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    /**
     * Why the platform paused it, when the platform did. An endpoint that has
     * failed for a day is almost always gone, and retrying it forever is a
     * way to turn somebody else's outage into a permanent load on this box.
     */
    pausedReason: text("paused_reason"),
    /** Reset by any success. What the auto-pause counts. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("webhook_subscriptions_name_idx").on(t.name),
    index("webhook_subscriptions_status_idx").on(t.status),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    /** Stable source event; makes fan-out replay idempotent per subscription. */
    outboxEventId: uuid("outbox_event_id").references(() => outboxEvents.id, {
      onDelete: "set null",
    }),
    eventName: text("event_name").notNull(),
    /** Exactly what was sent, so a failed delivery can be read and re-sent. */
    payload: jsonb("payload").notNull().default({}),
    status: text("status", {
      enum: ["pending", "sending", "succeeded", "failed"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /**
     * When to try next. The whole retry schedule lives in this one column:
     * a worker asks for rows that are due, which means a restart loses
     * nothing and a backlog drains in order.
     */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    responseStatus: integer("response_status"),
    /** Truncated. Enough to debug with, not enough to store somebody's page. */
    responseBody: text("response_body"),
    error: text("error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("webhook_deliveries_subscription_idx").on(t.subscriptionId),
    uniqueIndex("webhook_deliveries_outbox_event_idx")
      .on(t.subscriptionId, t.outboxEventId)
      .where(sql`${t.outboxEventId} is not null`),
    // The worker's query: everything due, oldest first. Partial, because
    // finished deliveries are the overwhelming majority of the table and none
    // of them are ever due.
    index("webhook_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'sending')`),
    index("webhook_deliveries_created_idx").on(t.createdAt),
  ],
);
