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
import { invoices, paymentMethods } from "@/modules/invoicing/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const PLAN_INTERVALS = ["day", "week", "month", "year"] as const;
export const BILLING_MODES = ["provider", "platform", "manual"] as const;
export const CANCEL_BEHAVIOURS = ["period_end", "immediate"] as const;
export const PRORATION_MODES = ["create_prorations", "none"] as const;
export const PLAN_STATUSES = ["draft", "active", "archived"] as const;
export const DUNNING_CHANNELS = ["email", "sms", "in_app"] as const;
export const DUNNING_FINAL_ACTIONS = ["pause", "cancel", "downgrade"] as const;

/**
 * Where a subscription is in its life.
 *
 * `past_due` is a dunning state (C9.16): a renewal failed or its invoice is
 * unpaid, a `DunningPolicy` is running, and access continues until
 * `grace_ends_at`. Without a policy the status is never written — a failure
 * stays on the history and the period does not move.
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
  /** A card-setup session was opened. Detail is the provider customer reference, not a card number. */
  "card_setup",
  /** A customer's plan change waiting for its proration invoice. Detail is the target variant id. */
  "plan_change_pending",
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
     * Recorded because it is a promise made to the customer at signup:
     * platform and provider billing honour it when they take a card.
     */
    trialRequiresCard: boolean("trial_requires_card").notNull().default(false),
    setupFeeMinor: bigint("setup_fee_minor", { mode: "number" }).notNull().default(0),
    billingMode: text("billing_mode", { enum: BILLING_MODES }).notNull().default("manual"),
    cancelBehaviour: text("cancel_behaviour", { enum: CANCEL_BEHAVIOURS })
      .notNull()
      .default("period_end"),
    /**
     * Stated per plan, as §4.15 insists, "rather than discovered at the first
     * mid-cycle change".
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
    /** Whose schedule this is, when billing mode is `provider`. */
    provider: text("provider"),
    providerRef: text("provider_ref"),
    /** Stored method used by platform charges and provider schedules. */
    paymentMethodId: uuid("payment_method_id").references(
      () => paymentMethods.id,
      { onDelete: "set null" },
    ),
    /** Plan waiting for period end when proration is `none`. */
    signupPending: boolean("signup_pending").notNull().default(false),
    signupInvoiceId: uuid("signup_invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    publicRequestKey: uuid("public_request_key"),
    publicTermsHash: text("public_terms_hash"),
    pendingPlanId: uuid("pending_plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
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
    /**
     * Dunning clock (C9.16). Null until a policy starts. `dunning_next_at`
     * is when the next retry or the final action is due; `grace_ends_at` is
     * how long access continues after the failure.
     */
    dunningStartedAt: timestamp("dunning_started_at", { withTimezone: true }),
    dunningAttempt: integer("dunning_attempt").notNull().default(0),
    dunningNextAt: timestamp("dunning_next_at", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    dunningInvoiceId: uuid("dunning_invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("subscriptions_public_request_idx").on(t.contactId, t.publicRequestKey).where(sql`${t.publicRequestKey} is not null`),
    index("subscriptions_signup_idx").on(t.signupPending, t.signupInvoiceId),
    index("subscriptions_contact_idx").on(t.contactId),
    // The renewal sweep's own query: what is due, oldest first.
    index("subscriptions_due_idx").on(t.status, t.currentPeriodEnd),
    index("subscriptions_dunning_idx").on(t.status, t.dunningNextAt),
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
/** C12.38: private agreement routing, excluded from public subscription rows. */
export const subscriptionMarketPolicies = pgTable("subscription_market_policies", {
  subscriptionId: uuid("subscription_id").primaryKey().references(() => subscriptions.id, { onDelete: "cascade" }),
  model: text("model", { enum: ["hold", "instant", "seller_merchant"] }).notNull(),
  adapter: text("adapter").notNull(),
  siteFeeBps: integer("site_fee_bps").notNull(),
  holdDays: integer("hold_days").notNull(),
  sellerUserId: uuid("seller_user_id"),
  merchantName: text("merchant_name"),
  providerAccountId: text("provider_account_id"),
  createdAt: createdAtColumn(),
}, (t) => [
  check("subscription_market_policies_model_check", sql`${t.model} in ('hold','instant','seller_merchant')`),
  check("subscription_market_policies_fee_bps_check", sql`${t.siteFeeBps} between 0 and 10000`),
  check("subscription_market_policies_hold_days_check", sql`${t.holdDays} between 0 and 365`),
  check("subscription_market_policies_merchant_check", sql`${t.model} <> 'seller_merchant' or (${t.adapter} = 'stripe_connect' and ${t.sellerUserId} is not null and ${t.merchantName} is not null and ${t.providerAccountId} is not null)`),
]);

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

/**
 * What happens when a renewal fails (MASTER.md §4.15, C9.16).
 *
 * One policy per plan: retries at stated day offsets, a grace window during
 * which grants stay live, notices on the channels the contact consented to,
 * and a final action the owner chose. Involuntary churn is a retry-schedule
 * problem; this is the schedule.
 */
export const dunningPolicies = pgTable(
  "dunning_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    /** Days after dunning starts. `[3, 7, 14]` means notices on those days. */
    retries: jsonb("retries").$type<number[]>().notNull().default([3, 7, 14]),
    graceDays: integer("grace_days").notNull().default(14),
    notifyChannels: jsonb("notify_channels")
      .$type<Array<(typeof DUNNING_CHANNELS)[number]>>()
      .notNull()
      .default(["email"]),
    finalAction: text("final_action", { enum: DUNNING_FINAL_ACTIONS })
      .notNull()
      .default("pause"),
    downgradeToPlanId: uuid("downgrade_to_plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("dunning_policies_plan_idx").on(t.planId),
    check("dunning_policies_grace_nonnegative", sql`${t.graceDays} >= 0`),
  ],
);

/** C12.38: the exact first card-setup request commits before provider I/O.
 * Identity follows the parent subscription's existing contact merge reference.
 */
export const subscriptionCardSetups = pgTable("subscription_card_setups", {
  id:uuid("id").primaryKey().defaultRandom(),
  subscriptionId:uuid("subscription_id").notNull().references(()=>subscriptions.id,{onDelete:"cascade"}),
  provider:text("provider").notNull(),
  providerAccountId:text("provider_account_id").notNull().default(""),
  request:jsonb("request").$type<Record<string,unknown>>().notNull(),
  requestHash:text("request_hash").notNull(),
  providerCheckoutRef:text("provider_checkout_ref"),
  providerCustomerRef:text("provider_customer_ref"),
  providerSetupIntentRef:text("provider_setup_intent_ref"),
  checkoutUrl:text("checkout_url"),
  expiresAt:timestamp("expires_at",{withTimezone:true}),
  // Historical proof survives card erasure; activation still joins the exact live method.
  confirmedMethodId:uuid("confirmed_method_id"),
  confirmedAt:timestamp("confirmed_at",{withTimezone:true}),
  closedAt:timestamp("closed_at",{withTimezone:true}),
  closedReason:text("closed_reason"),
  erasureRequestId:uuid("erasure_request_id"),
  erasureJobId:uuid("erasure_job_id"),
  cleanupCompletedAt:timestamp("cleanup_completed_at",{withTimezone:true}),
  createdAt:createdAtColumn(),
},t=>[
  uniqueIndex("subscription_card_setups_pending_idx").on(t.subscriptionId).where(sql`${t.confirmedAt} is null and ${t.closedAt} is null`),
  uniqueIndex("subscription_card_setups_checkout_idx").on(t.provider,t.providerAccountId,t.providerCheckoutRef),
  check("subscription_card_setups_provider_check",sql`length(trim(${t.provider})) between 1 and 100`),
  check("subscription_card_setups_account_check",sql`${t.providerAccountId}='' or (${t.provider}='stripe' and ${t.providerAccountId} ~ '^acct_[A-Za-z0-9]+$')`),
  check("subscription_card_setups_request_check",sql`jsonb_typeof(${t.request})='object' and length(${t.requestHash})=64`),
  check("subscription_card_setups_erasure_pair_check",sql`(${t.erasureRequestId} is null and ${t.erasureJobId} is null) or (${t.erasureRequestId} is not null and ${t.erasureJobId} is not null)`),
  check("subscription_card_setups_cleanup_check",sql`${t.cleanupCompletedAt} is null or (${t.erasureRequestId} is not null and ${t.erasureJobId} is not null)`),
  check("subscription_card_setups_closure_check",sql`(${t.closedAt} is null and ${t.closedReason} is null) or (${t.closedAt} is not null and ${t.confirmedAt} is null and ${t.closedReason} is not null and ((${t.closedReason}='expired' and ${t.providerCheckoutRef} is not null and ${t.providerCustomerRef} is not null) or ${t.closedReason}='provider_cancelled'))`),
  check("subscription_card_setups_confirmation_check",sql`(${t.confirmedMethodId} is null and ${t.confirmedAt} is null) or (${t.confirmedMethodId} is not null and ${t.confirmedAt} is not null and ${t.providerCheckoutRef} is not null and ${t.providerCustomerRef} is not null and ${t.providerSetupIntentRef} is not null)`),
]);

/** Every physical provider POST remains visible until its actual outcome settles. */
export const subscriptionSetupDispatches=pgTable("subscription_setup_dispatches",{
 id:uuid("id").primaryKey().defaultRandom(),
 setupId:uuid("setup_id").notNull().references(()=>subscriptionCardSetups.id,{onDelete:"cascade"}),
 kind:text("kind",{enum:["customer","session"]}).notNull(),
 state:text("state",{enum:["running","succeeded","unknown","provider_completed","provider_cancelled"]}).notNull().default("running"),
 requestHash:text("request_hash").notNull(),
 customerAtStart:text("customer_at_start"),
 initiatedBy:text("initiated_by").notNull(),
 providerRef:text("provider_ref"),
 providerCustomerRef:text("provider_customer_ref"),
 unverifiedEvidence:jsonb("unverified_evidence").$type<Record<string,unknown>>().notNull().default({}),
 resolution:jsonb("resolution").$type<Record<string,unknown>>().notNull().default({}),
 startedAt:timestamp("started_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
 finishedAt:timestamp("finished_at",{withTimezone:true}),
},t=>[
 index("subscription_setup_dispatches_setup_idx").on(t.setupId,t.startedAt,t.id),
 check("subscription_setup_dispatches_kind_check",sql`${t.kind} in ('customer','session')`),
 check("subscription_setup_dispatches_state_check",sql`${t.state} in ('running','succeeded','unknown','provider_completed','provider_cancelled')`),
 check("subscription_setup_dispatches_request_check",sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
 check("subscription_setup_dispatches_resolution_check",sql`${t.state} not in ('provider_completed','provider_cancelled') or coalesce((jsonb_typeof(${t.resolution})='object' and ${t.resolution}->>'source'='human_provider_confirmation' and length(${t.resolution}->>'providerOperationRef')>=8 and length(${t.resolution}->>'providerEvidence')>=20 and length(${t.resolution}->>'callerStopEvidence')>=20 and ${t.resolution}->>'originalRequestHash'=${t.requestHash} and ${t.resolution}->>'actor' like 'user:%'),false)`),
 check("subscription_setup_dispatches_completion_check",sql`(${t.state}='running' and ${t.finishedAt} is null) or (${t.state}<>'running' and ${t.finishedAt} is not null)`),
 check("subscription_setup_dispatches_success_check",sql`${t.state} not in ('succeeded','provider_completed') or (${t.providerCustomerRef} is not null and (${t.kind}='customer' or ${t.providerRef} is not null))`),
]);
