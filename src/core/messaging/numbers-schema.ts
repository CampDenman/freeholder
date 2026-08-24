// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The numbers a business sends and receives on (§4.14's `MessagingNumber`, C7.10).
//
// The credentials that reach a provider live in the environment (§17); this is
// everything else, and it is in the database because it is configuration an
// owner changes rather than a secret. Which number is the default for
// transactional messages is a decision, not a deployment.
//
// **Capabilities are per number, not per provider.** The same account can hold
// a long code that cannot send pictures and a toll-free number that can, and
// offering MMS on the wrong one fails at the carrier rather than at the door.
//
// **Health is stored with the moment it was checked, and with whether the check
// itself worked.** §4.14 names the failure this exists for: "an unregistered
// number silently filtered by carriers is the most common way an SMS launch
// fails". A number that *looks* fine because nobody could reach the provider is
// exactly that failure wearing a green tick, so `health_unknown` is a column
// rather than an assumption.
//
// C7.11 adds the registration states — 10DLC brand and campaign, toll-free
// verification — on top of this row.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const NUMBER_KINDS = ["long_code", "toll_free", "short_code", "alphanumeric"] as const;

/**
 * What a number is *for*.
 *
 * §4.14 separates transactional from marketing because consent does: a booking
 * confirmation rides the existing relationship, a campaign does not. Keeping
 * them on different numbers is how a business protects the number its customers
 * actually reply to from the one that gets complaints.
 */
export const NUMBER_PURPOSES = ["transactional", "marketing", "support"] as const;

export const messagingNumbers = pgTable(
  "messaging_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which adapter owns it: `twilio`, and later others. */
    provider: text("provider").notNull(),
    /** The provider's own id, so health can be re-asked without guessing. */
    providerRef: text("provider_ref").notNull(),
    /** E.164, or the sender ID for an alphanumeric one. */
    e164: text("e164").notNull(),
    label: text("label"),
    /** ISO-3166-1 alpha-2: what is legal depends on where the number is. */
    country: text("country"),
    kind: text("kind", { enum: NUMBER_KINDS }).notNull().default("long_code"),
    capabilities: jsonb("capabilities")
      .notNull()
      .default({})
      .$type<{ sms?: boolean; mms?: boolean; inbound?: boolean }>(),
    purpose: text("purpose", { enum: NUMBER_PURPOSES }).notNull().default("transactional"),
    /** The one used when nothing names another, per purpose. */
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    /** What the last health check found, and when, and whether it worked. */
    healthy: boolean("healthy").notNull().default(true),
    healthUnknown: boolean("health_unknown").notNull().default(false),
    healthProblem: text("health_problem"),
    providerStatus: text("provider_status"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
    /**
     * What this number is registered for, and how far along each one is (§4.14,
     * C7.11).
     *
     * A list rather than a single status because a US toll-free number can need
     * verification while a long code beside it needs a 10DLC brand *and*
     * campaign, and collapsing them loses which one an owner has to chase.
     *
     * What is *required* is never stored — it is derived from country and kind
     * in `registration.ts`. A stored requirement is one an owner could clear,
     * and the whole point is that carrier policy is not theirs to waive.
     */
    registrations: jsonb("registrations")
      .notNull()
      .default([])
      .$type<
        Array<{
          kind: string;
          state: string;
          brand?: string | null;
          campaign?: string | null;
          providerRef?: string | null;
          submittedAt?: string | null;
          decidedAt?: string | null;
          reason?: string | null;
        }>
      >(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One row per number per provider. The same number added twice would give
    // two defaults and two health answers.
    uniqueIndex("messaging_numbers_ref_idx").on(t.provider, t.providerRef),
    index("messaging_numbers_e164_idx").on(t.e164),
    // One default per purpose. Without this, which number a booking
    // confirmation goes out on becomes whichever the planner returned first.
    uniqueIndex("messaging_numbers_default_idx")
      .on(t.purpose)
      .where(sql`is_default`),
    check("messaging_numbers_e164", sql`char_length(${t.e164}) between 1 and 40`),
    // A number that failed its check has to say why, or the owner has a red
    // light and nothing to act on.
    check(
      "messaging_numbers_problem",
      sql`${t.healthy} = true or ${t.healthProblem} is not null`,
    ),
  ],
);
