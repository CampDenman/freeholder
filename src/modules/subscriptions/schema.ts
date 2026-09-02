// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recurring offers and the lives they lead (MASTER.md §4.15, §43 C9.13).
//
// §4.15 draws the line this module is built on: §4.3 owns the *money* of a
// subscription and this owns the *access and the life*, "because 'who may see
// this' is a different question from 'who paid', and conflating them is how
// content ends up gated by a boolean somebody forgot to check". So there is no
// price here and no invoice here. A plan points at a product, the product's
// variant carries the prices (§4.9: priced in a currency or unavailable in
// it), and every period raises an ordinary `Invoice` — §4.6's single money
// object — with `source_type = 'subscription'`.
//
// What this does own is the calendar: which period a subscription is in, when
// that period ends, and every state it has passed through.
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
import { contacts } from "@/core/contacts/schema";
import { products, productVariants } from "@/modules/catalog/schema";
import { invoices } from "@/modules/invoicing/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const PLAN_INTERVALS = ["day", "week", "month", "year"] as const;
export const BILLING_MODES = ["provider", "platform", "manual"] as const;
export const CANCEL_BEHAVIOURS = ["period_end", "immediate"] as const;
export const PRORATION_MODES = ["create_prorations", "none"] as const;
export const PLAN_STATUSES = ["draft", "active", "archived"] as const;

/**
 * Where a subscription is in its life.
 *
 * `past_due` exists here and is written by nothing yet: what happens after a
 * failed renewal is a `DunningPolicy` (C9.16), and inventing a retry schedule
 * in the meantime would be the wrong answer written down twice.
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
] as const;

/** §4.15's list, appended and never edited. */
export const SUBSCRIPTION_EVENT_KINDS = [
  "created",
  "trialing",
  "activated",
  "renewed",
  "payment_failed",
  "dunning",
  "paused",
  "resumed",
  "plan_changed",
  "cancelled",
  "expired",
] as const;

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The thing being sold. A plan is "a `subscription` product's shape"
     * (§4.15), not a second catalogue: the name, the description, the images
     * and the prices are the product's, so a membership appears on the site
     * the way everything else does.
     */
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    interval: text("interval", { enum: PLAN_INTERVALS }).notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    trialDays: integer("trial_days").notNull().default(0),
    /**
     * Whether a trial takes a card up front.
     *
     * Recorded even though this item bills manually, because it is a promise
     * made to the customer at signup and the answer must not change when
     * C9.33 switches the automatic modes on.
     */
    trialRequiresCard: boolean("trial_requires_card").notNull().default(false),
    setupFeeMinor: bigint("setup_fee_minor", { mode: "number" }).notNull().default(0),
    billingMode: text("billing_mode", { enum: BILLING_MODES }).notNull().default("manual"),
    cancelBehaviour: text("cancel_behaviour", { enum: CANCEL_BEHAVIOURS })
      .notNull()
      .default("period_end"),
    /**
     * Stated per plan, as §4.15 insists, "rather than discovered at the first
     * mid-cycle change". Nothing reads it until C9.33 builds plan changes; it
     * is here because the answer belongs to the offer rather than to the
     * moment somebody asks to switch.
     */
    proration: text("proration", { enum: PRORATION_MODES }).notNull().default("create_prorations"),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("plans_product_idx").on(t.productId),
    index("plans_status_idx").on(t.status),
    check("plans_interval_count_positive", sql`${t.intervalCount} >= 1`),
    check("plans_trial_days_nonnegative", sql`${t.trialDays} >= 0`),
    check("plans_setup_fee_nonnegative", sql`${t.setupFeeMinor} >= 0`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    /**
     * The exact thing priced, resolved once at signup.
     *
     * A plan names a product; a product may have variants; money is charged
     * against one of them. Pinning it here means a subscriber keeps paying for
     * what they signed up to even after the shop adds a second size.
     */
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    /**
     * The currency this subscription bills in, fixed at signup.
     *
     * §4.9: money is never auto-converted, and "invoices, payments, and
     * refunds stay in their original currency forever". A subscription is a
     * standing agreement about a price, so it holds its currency the same way.
     */
    currency: text("currency").notNull(),
    /** Copied from the plan, because a plan can be edited and this cannot. */
    billingMode: text("billing_mode", { enum: BILLING_MODES }).notNull(),
    /** Whose schedule this is, once C9.33 gives the answer away to a provider. */
    provider: text("provider"),
    providerRef: text("provider_ref"),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    /** When the next invoice is due. The renewal sweep's only question. */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /**
     * §4.15: "Cancelling ends the grant at the period end by default … access
     * never quietly outlives the money, and never disappears before the period
     * the customer paid for."
     */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * What this subscription grants, as §4.3 describes it.
     *
     * Carried and not yet read: C9.14 builds `Entitlement` and
     * `EntitlementGrant` properly, and access is "computed from grants, never
     * stored on the content". This column exists so a subscription created
     * today can be interpreted then, rather than so anything can gate on it
     * now.
     */
    grants: jsonb("grants").notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("subscriptions_contact_idx").on(t.contactId),
    // The renewal sweep's own query: what is due, oldest first.
    index("subscriptions_due_idx").on(t.status, t.currentPeriodEnd),
    index("subscriptions_plan_idx").on(t.planId),
    uniqueIndex("subscriptions_provider_ref_idx")
      .on(t.provider, t.providerRef)
      .where(sql`${t.providerRef} is not null`),
    check("subscriptions_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("subscriptions_period_order", sql`${t.currentPeriodEnd} > ${t.currentPeriodStart}`),
    // An ended subscription says when. A live one does not pretend to have.
    check(
      "subscriptions_ended_consistent",
      sql`(${t.status} in ('expired', 'cancelled')) or ${t.endedAt} is null`,
    ),
  ],
);

/**
 * The lifecycle, appended.
 *
 * §4.15 lists these kinds and calls the entity "the lifecycle, appended",
 * which is the whole design: a subscription's `status` says where it is now
 * and this says how it got there. An owner asked "why did this customer stop
 * paying in March" needs the second answer, and a status column can never give
 * it.
 */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SUBSCRIPTION_EVENT_KINDS }).notNull(),
    fromPlanId: uuid("from_plan_id").references(() => plans.id, { onDelete: "set null" }),
    toPlanId: uuid("to_plan_id").references(() => plans.id, { onDelete: "set null" }),
    /** The invoice this moment raised, where it raised one. */
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    /** Why, in the owner's language, when the kind alone does not say. */
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscription_events_subscription_idx").on(t.subscriptionId, t.at),
    index("subscription_events_kind_idx").on(t.kind, t.at),
  ],
);
