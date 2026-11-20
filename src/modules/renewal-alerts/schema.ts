// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Renewal alerts: a register of charges a person expects, and a record of
// every time we warned them about one.
//
// It is NOT `modules/subscriptions`, and the distinction is worth stating
// because the names collide: that module is *our* billing — plans, invoices, proration,
// dunning, a payment provider — and it answers "what do we charge this
// customer?". This module holds no money, charges nobody and integrates no
// provider. It answers "what is about to charge *you*, somewhere else?".
//
// The governing decision, taken from the behaviour of the original and
// deliberately reversed:
//
// **An alert is a row, not a timestamp.** The obvious build keeps one
// `last_alert_sent` column per subscription and decides whether it has already
// warned you by comparing that column against a window derived from the
// renewal date and the alert lead time. That arithmetic is correct only near
// the middle of its window: shift the renewal date, change `alertDays`, or run
// the pass twice around a boundary, and it either warns twice or goes quiet.
// Worse, it is unanswerable afterwards — "did you tell me about the March
// charge?" has no row to point at.
//
// So `renewal_alerts` is append-only, one row per (subscription, renewal
// date), with a unique index making a second alert for the same charge
// impossible rather than unlikely. Suppression is then a lookup, not a
// calculation, and the question "were we told?" is answered by a row.
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const RENEWAL_CYCLES = ["monthly", "annual", "custom"] as const;
export type RenewalCycle = (typeof RENEWAL_CYCLES)[number];

export const TRACKED_STATUSES = ["active", "archived"] as const;

/**
 * One third-party charge a person wants warning about.
 *
 * Keyed to a `contacts` row rather than to a bespoke user table: Freeholder
 * already owns identity, and a subscription register that invented its own
 * notion of "person" would be a second one to keep in step.
 */
export const trackedSubscriptions = pgTable(
  "tracked_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Minor units, with the currency beside it. The original stored
     * `numeric(10,2)` and no currency at all, which is fine until somebody
     * tracks a charge in euros and the alert says "$". Money here is only ever
     * displayed, never arithmetic, but it is still money.
     */
    costMinor: bigint("cost_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    cycle: text("cycle", { enum: RENEWAL_CYCLES }).notNull().default("monthly"),
    /** Only meaningful when `cycle` is `custom`; validated in the service. */
    customIntervalDays: integer("custom_interval_days"),
    /**
     * When the charge first happened. Kept because it is the only thing that
     * lets a missed renewal be rolled forward deterministically rather than
     * guessed from "now".
     */
    firstChargeAt: timestamp("first_charge_at", { withTimezone: true }).notNull(),
    nextRenewalAt: timestamp("next_renewal_at", { withTimezone: true }).notNull(),
    /** How many days of warning this person wants for this charge. */
    alertDays: integer("alert_days").notNull().default(3),
    notes: text("notes"),
    status: text("status", { enum: TRACKED_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("tracked_subscriptions_contact_idx").on(table.contactId),
    // The look-ahead pass selects on status and renewal date together, and
    // this table is read once a day for every row in it.
    index("tracked_subscriptions_due_idx").on(table.status, table.nextRenewalAt),
  ],
);

/**
 * One row per charge we warned about. Append-only.
 *
 * `renewalAt` is the renewal this alert was *about*, not the time it was sent
 * — that is `createdAt`. Storing the subject rather than the moment is what
 * makes the unique index below mean "this charge has been covered", which is
 * the question the job actually asks.
 */
export const renewalAlerts = pgTable(
  "renewal_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => trackedSubscriptions.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** The renewal this alert covers. */
    renewalAt: timestamp("renewal_at", { withTimezone: true }).notNull(),
    /** Days of warning actually given, which may differ from today's setting. */
    daysAhead: integer("days_ahead").notNull(),
    /**
     * The queued mail this alert became. Nullable because the row is written
     * in the same transaction as the send is staged, and the delivery is the
     * mail subsystem's to own from there — an alert we recorded and could not
     * hand over is a fact worth keeping, not a row to withhold.
     */
    mailDeliveryId: uuid("mail_delivery_id"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    // The whole suppression rule, enforced by the database rather than by
    // arithmetic in the job: one alert per charge.
    uniqueIndex("renewal_alerts_subscription_renewal_key").on(
      table.subscriptionId,
      table.renewalAt,
    ),
    index("renewal_alerts_contact_idx").on(table.contactId),
  ],
);
