// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Loyalty programmes, earn rules, accounts and the points ledger
// (MASTER.md §4.13, C9.11).
//
// The governing rule is the first one §4.13 states: **points are a ledger, not
// a number** — "the same discipline as stock (§4.2) and for the same reason:
// 'I had 400 points last week' must be answerable, and a balance you cannot
// explain is a balance customers stop believing."
//
// So `points_ledger` is append-only and `loyalty_accounts.points_balance_cached`
// is exactly what its name says: a cache, for display, derived from the rows.
// Nothing in this module decides anything from the cached column — every
// balance that gates a redemption or appears in a liability figure is summed
// from the ledger at the time it is used.
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
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * The programme itself.
 *
 * §4.13: "One per instance in practice; the table allows more." Keeping it a
 * table rather than a settings blob costs nothing and means a business running
 * a second, seasonal programme is a row rather than a rewrite.
 */
export const loyaltyPrograms = pgTable(
  "loyalty_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** What the business calls a point: Stars, Credits, Miles. */
    pointsLabel: text("points_label").notNull().default("points"),
    status: text("status", { enum: ["draft", "active", "closed"] })
      .notNull()
      .default("draft"),
    /** Which currency one point maps to, for reporting and liability. */
    earnCurrency: text("earn_currency").notNull().default("USD"),
    /**
     * What one point is worth when redeemed. This is the number that turns an
     * outstanding balance into a liability the owner can see (§4.13), so it is
     * not optional and not nullable.
     */
    redemptionValueCents: integer("redemption_value_cents").notNull().default(1),
    /**
     * `{ kind: "never" | "inactivity" | "fixed_window", days?, noticeDays }`.
     *
     * Several jurisdictions restrict or forbid expiry on inactivity alone, so
     * §4.13 requires a notice period and the service refuses to store a policy
     * that expires points without one. The shape is jsonb because the fields
     * that matter differ per kind, and §2 principle 12 permits jsonb for
     * genuinely variant configuration.
     */
    expiryPolicy: jsonb("expiry_policy").notNull().default({ kind: "never" }),
    enrolment: text("enrolment", { enum: ["automatic", "opt_in"] })
      .notNull()
      .default("opt_in"),
    /** The page carrying the terms. A programme with no terms is a promise. */
    termsPageId: uuid("terms_page_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("loyalty_programs_status_idx").on(t.status)],
);

/**
 * What earns points, and how many.
 *
 * `eventType` is a **spine** event type (§4.1's TimelineEvent), not a bus
 * topic. That is the difference between "loyalty watches the contact's
 * history" and "loyalty watches commerce", and only the first one survives
 * commerce being swapped out — §4.13: "Commerce does not know loyalty exists."
 */
export const earnRules = pgTable(
  "earn_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A `timeline_events.event_type`, e.g. "order.paid", "contact.created". */
    eventType: text("event_type").notNull(),
    formula: text("formula", {
      enum: ["fixed", "per_currency_unit", "multiplier"],
    })
      .notNull()
      .default("fixed"),
    /**
     * `fixed`: this many points. `per_currency_unit`: this many per major unit
     * of the amount on the event. `multiplier`: this many per major unit, used
     * where a rule stacks on a base rule.
     */
    points: integer("points").notNull().default(0),
    /**
     * Fraud is bounded by rules, not vigilance (§4.13). Null means uncapped;
     * a number caps how many points this rule may award one contact inside
     * `capPeriodDays`.
     */
    capPerPeriod: integer("cap_per_period"),
    capPeriodDays: integer("cap_period_days").notNull().default(30),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Higher runs first, so a seasonal double-points rule can pre-empt. */
    priority: integer("priority").notNull().default(0),
    active: text("active", { enum: ["yes", "no"] })
      .notNull()
      .default("yes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("earn_rules_program_idx").on(t.programId),
    // The listener asks "which rules care about this event type" on every
    // spine event it is registered for, so this is the hot path.
    index("earn_rules_event_idx").on(t.eventType, t.active),
  ],
);

/**
 * A contact's standing in a programme.
 *
 * `contact_id` is the spine (§4.1). One account per contact per programme,
 * enforced by the index rather than by hope, because two accounts is two
 * balances and the customer only believes one of them.
 */
export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id, { onDelete: "cascade" }),
    /** Display only. Every decision sums the ledger; see the file header. */
    pointsBalanceCached: integer("points_balance_cached").notNull().default(0),
    /** Earned ever, never reduced by redemption. Tier basis in C9.12. */
    lifetimePoints: integer("lifetime_points").notNull().default(0),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    /** The last spine event that moved this account, for inactivity expiry. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status", { enum: ["active", "suspended", "closed"] })
      .notNull()
      .default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("loyalty_accounts_contact_program_idx").on(t.contactId, t.programId),
    index("loyalty_accounts_program_idx").on(t.programId),
    index("loyalty_accounts_activity_idx").on(t.lastActivityAt),
  ],
);

/**
 * Append-only. Every movement is a row.
 *
 * There is no update path and no delete path in the service. A refund does not
 * edit the earn it reverses — it writes a negative row citing it, so the
 * history reads as what happened rather than as what is currently true.
 */
export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    /** Signed. Earning is positive; redeeming, expiring and reversing are not. */
    delta: integer("delta").notNull(),
    reason: text("reason", {
      enum: ["earn", "redeem", "expire", "adjust", "reverse"],
    }).notNull(),
    /** Which rule or which reward produced this row, when one did. */
    ruleId: uuid("rule_id").references(() => earnRules.id, { onDelete: "set null" }),
    /** The spine event this came from: "order", "contact", "quote". */
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    /** The row this one reverses. A reversal always cites its original. */
    reversesId: uuid("reverses_id"),
    /** Who or what wrote it, in the same form audit rows use. */
    actor: text("actor").notNull(),
    note: text("note"),
    /** When these specific points expire, for fixed-window policies. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("points_ledger_account_idx").on(t.accountId, t.at),
    // An earn is written at most once per (rule, source). This is what makes
    // the listener safe to re-run: the outbox retries a failed delivery, and
    // without this a retry would pay for the same order twice.
    uniqueIndex("points_ledger_earn_once_idx")
      .on(t.ruleId, t.sourceType, t.sourceId)
      .where(sql`${t.reason} = 'earn'`),
    index("points_ledger_reverses_idx").on(t.reversesId),
    index("points_ledger_expiry_idx").on(t.expiresAt),
  ],
);
