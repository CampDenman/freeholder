// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Referral programmes, codes, touches and invitations
// (MASTER.md §4.3, §4.13, C9.09).
//
// §4.13 states the rule this schema is shaped by: "The attribution model is a
// choice the owner makes and can see … `AttributionTouch` keeps the whole
// chain regardless, so changing the model does not require re-running history
// — it re-reads it."
//
// So nothing here stores a *winner*. Touches are the record, the model is a
// setting on the programme, and who gets the credit is computed at read time.
// An owner who switches from last-touch to first-touch on Tuesday gets a
// different, correct answer about Monday, without a migration and without
// anybody's history being rewritten.
//
// The other rule is structural: "One hop only … Multi-level structures are
// refused by the data model, not by policy — there is no parent link on
// `AffiliateCode` — and that is deliberate." There is no parent column below,
// and `tests/modules/referrals.test.ts` asserts its absence so a later
// well-meaning change has to argue with a test.
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

/** Admin-defined commission scheme (§4.3). */
export const affiliatePrograms = pgTable(
  "affiliate_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** signup / subscription / order / booking / custom. */
    conversionTypes: jsonb("conversion_types").notNull().default([]),
    /** What the referred person gets, if anything. */
    customerDiscount: jsonb("customer_discount").notNull().default({}),
    /** `{ kind: percent|fixed, value, basis, cap?, recurring }` — C9.10 spends it. */
    commission: jsonb("commission").notNull().default({}),
    /**
     * How long a touch counts for. §4.13 requires the window be *stated*
     * rather than implied, because "we did not count that click" is an
     * argument nobody can win without a number both sides agreed to.
     */
    cookieWindowDays: integer("cookie_window_days").notNull().default(30),
    /**
     * How long a commission is held before it may be paid (C9.10).
     *
     * §4.13: "A `CommissionEvent` becomes payable only after the refund window
     * closes." That window is a property of the programme rather than of a
     * sale, because it is a promise the owner makes to affiliates once, in
     * writing, and a per-sale holdback would be a promise nobody could read.
     */
    holdbackDays: integer("holdback_days").notNull().default(30),
    /**
     * Which touch in the chain earns the credit.
     *
     * Stored on the programme rather than baked into a query, and applied at
     * read time — that is what makes it "a choice the owner makes and can
     * see" rather than a decision somebody made once in code.
     */
    attributionModel: text("attribution_model", {
      enum: ["last_touch", "first_touch", "position_based"],
    })
      .notNull()
      .default("last_touch"),
    status: text("status", { enum: ["draft", "active", "closed"] })
      .notNull()
      .default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("affiliate_programs_status_idx").on(t.status)],
);

/**
 * A referrer's code within a programme (§4.3).
 *
 * `contactId` is the referrer — "a Contact like everyone else", which is the
 * spine rule (§4.1) applied to somebody who happens to also send business.
 * There is deliberately no parent code: see the file header.
 */
export const affiliateCodes = pgTable(
  "affiliate_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => affiliatePrograms.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    /** Where the code sends somebody, when it is not the home page. */
    landingPath: text("landing_path"),
    /** Cheap counter for the owner's list. The touches are the record. */
    clicks: integer("clicks").notNull().default(0),
    status: text("status", { enum: ["active", "paused", "revoked"] })
      .notNull()
      .default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One code string, globally. A code is typed at a checkout by somebody
    // reading it off a card, and two meanings for one word is not a conflict
    // anybody can resolve at that moment.
    uniqueIndex("affiliate_codes_code_idx").on(t.code),
    index("affiliate_codes_program_idx").on(t.programId),
    index("affiliate_codes_contact_idx").on(t.contactId),
  ],
);

/**
 * Every recorded contact with a referral code, first-party (§4.13).
 *
 * "Attribution is first-party and survives the cookie. A code on a session, a
 * scanned QR at a market stall, a code typed at checkout, and an invitation
 * accepted by link all land in the same table." One table is the point: four
 * tables would be four answers to "where did this customer come from".
 */
export const attributionTouches = pgTable(
  "attribution_touches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The platform's own visitor id (`fh_v`), not a third party's. */
    anonId: text("anon_id"),
    /**
     * Filled in when the visitor becomes somebody — which is usually after
     * the touch, and is exactly what "survives the cookie" means.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    codeId: uuid("code_id")
      .notNull()
      .references(() => affiliateCodes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["click", "scan", "manual", "invitation"] })
      .notNull()
      .default("click"),
    landingPath: text("landing_path"),
    referrerUrl: text("referrer_url"),
    utm: jsonb("utm").notNull().default({}),
    /**
     * A coarse fingerprint, for self-referral detection only.
     *
     * Deliberately not an identity: it is hashed, it is never joined to a
     * person, and nothing reads it except the check that a referrer is not
     * their own customer.
     */
    deviceHash: text("device_hash"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attribution_touches_contact_idx").on(t.contactId, t.at),
    index("attribution_touches_anon_idx").on(t.anonId, t.at),
    index("attribution_touches_code_idx").on(t.codeId),
  ],
);

/** A named invite, so "invite a friend" is trackable rather than a hope (§4.13). */
export const referralInvitations = pgTable(
  "referral_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerContactId: uuid("referrer_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => affiliatePrograms.id, { onDelete: "cascade" }),
    /** The code the invitation carries, so accepting records a real touch. */
    codeId: uuid("code_id")
      .notNull()
      .references(() => affiliateCodes.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["email", "sms", "link", "qr"] })
      .notNull()
      .default("link"),
    inviteeEmail: text("invitee_email"),
    inviteePhone: text("invitee_phone"),
    /** HMAC of high-entropy random, as gallery guests and quotes are. */
    tokenHash: text("token_hash").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    /** C9.10 moves this on; C9.09 only ever sets "none". */
    rewardState: text("reward_state", {
      enum: ["none", "pending", "granted", "reversed"],
    })
      .notNull()
      .default("none"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("referral_invitations_token_idx").on(t.tokenHash),
    index("referral_invitations_referrer_idx").on(t.referrerContactId),
    index("referral_invitations_program_idx").on(t.programId),
  ],
);

/* ------------------------------------------------- C9.10: paying for it */

/**
 * One earned commission on the ledger (§4.3, §4.13).
 *
 * `sharePpm` is stored, and stored in parts-per-million rather than as a
 * float, because position-based attribution genuinely splits one conversion
 * between several referrers. The split has to be reproducible from the row
 * years later — "why was I paid £4.80 and not £6" is a question with exactly
 * one right answer — and a float share would leave the arithmetic that
 * produced the amount unreconstructable at the third decimal place.
 *
 * `invoiceId` carries no foreign key on purpose. Referrals requires only core
 * (see the manifest), so a business with no invoicing module still earns and
 * settles commissions; a real FK here would make this module unbootable
 * without one. The trade is that a deleted invoice leaves a dangling id, which
 * is the lesser harm and is why the column is nullable anyway — §4.3 notes
 * signups have no invoice at all.
 */
export const commissionEvents = pgTable(
  "commission_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => affiliatePrograms.id, { onDelete: "cascade" }),
    codeId: uuid("code_id")
      .notNull()
      .references(() => affiliateCodes.id, { onDelete: "cascade" }),
    /**
     * The referrer, denormalised from the code.
     *
     * A payout batch groups by person, not by code: somebody with three codes
     * is paid once. Reaching that through the code on every batch build would
     * be a join that exists only to recover a fact which cannot change — a
     * code's owner is fixed at issue — so it is written down.
     */
    affiliateContactId: uuid("affiliate_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    referredContactId: uuid("referred_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversionType: text("conversion_type", {
      enum: ["signup", "subscription", "order", "booking", "custom"],
    }).notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    /** No FK: see the comment above. */
    invoiceId: uuid("invoice_id"),
    /** Parts per million of the conversion this referrer earned. */
    sharePpm: integer("share_ppm").notNull().default(1000000),
    /** What the commission was calculated from, before the share was applied. */
    basisMinor: integer("basis_minor").notNull().default(0),
    amountMinor: integer("amount_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    status: text("status", { enum: ["pending", "approved", "paid", "reversed"] })
      .notNull()
      .default("pending"),
    /**
     * When the holdback closes. §4.13: "A `CommissionEvent` becomes payable
     * only after the refund window closes."
     *
     * A timestamp rather than a flag, because the question a batch asks is
     * "what is payable as of this run", and a flag would only be right if a
     * job had already run correctly.
     */
    payableAt: timestamp("payable_at", { withTimezone: true }).notNull(),
    /**
     * Set on a negative row that undoes an already-paid one. §4.13: reversing
     * after payout "produces a negative line on the next batch rather than an
     * argument".
     */
    reversesId: uuid("reverses_id"),
    /**
     * Which payout line settled it.
     *
     * §4.3 describes the line as carrying `commission_event_ids[]`. The link
     * lives on the event instead: an array column cannot be constrained by a
     * foreign key, and the question that actually gets asked — "is this
     * commission paid, and on which batch" — is asked of the event far more
     * often than of the line.
     */
    payoutLineId: uuid("payout_line_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("commission_events_affiliate_idx").on(t.affiliateContactId, t.status),
    index("commission_events_payable_idx").on(t.status, t.payableAt),
    index("commission_events_subject_idx").on(t.subjectType, t.subjectId),
    index("commission_events_program_idx").on(t.programId),
    /**
     * One commission per code per conversion.
     *
     * Partial, because a reversal is deliberately a second row about the same
     * subject and must not collide with the row it reverses. The bus can
     * deliver an event more than once and a retried job re-runs its handler,
     * so without this a redelivery pays somebody twice for one sale — the
     * expensive direction of this bug.
     */
    uniqueIndex("commission_events_once_idx")
      .on(t.codeId, t.subjectType, t.subjectId)
      .where(sql`${t.reversesId} is null and ${t.subjectId} is not null`),
  ],
);

/** Settling commissions: the batch (§4.13). */
export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    currency: text("currency").notNull().default("GBP"),
    /**
     * §4.13: "v1 is manual and batched with a CSV the owner can hand to their
     * bank or accountant; a payout-provider adapter is a later implementation
     * of the same interface." `provider` is in the enum already so that later
     * adapter needs no migration to become expressible.
     */
    method: text("method", { enum: ["manual", "transfer", "provider"] })
      .notNull()
      .default("manual"),
    status: text("status", { enum: ["draft", "approved", "paid"] })
      .notNull()
      .default("draft"),
    totalMinor: integer("total_minor").notNull().default(0),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("payout_batches_status_idx").on(t.status, t.periodEnd)],
);

/** One person's total on one batch (§4.13). */
export const payoutLines = pgTable(
  "payout_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "cascade" }),
    affiliateContactId: uuid("affiliate_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    /**
     * Copied from the person's tax profile when the batch is built, not read
     * through to it. A batch is a historical document: what the owner knew
     * about somebody's paperwork on the day they paid them does not change
     * because the paperwork arrived the following week.
     */
    taxFormState: text("tax_form_state", {
      enum: ["not_required", "requested", "collected", "expired"],
    })
      .notNull()
      .default("not_required"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("payout_lines_batch_idx").on(t.batchId),
    index("payout_lines_affiliate_idx").on(t.affiliateContactId),
    // One line per person per batch: that is what "somebody with three codes
    // is paid once" means, enforced rather than assumed.
    uniqueIndex("payout_lines_once_idx").on(t.batchId, t.affiliateContactId),
  ],
);

/**
 * What paperwork this affiliate owes, and whether it arrived (§4.13).
 *
 * "Tax paperwork is acknowledged, not automated: `tax_form_state` tracks
 * whether the information a jurisdiction requires above a threshold (1099-NEC,
 * T4A, equivalents) has been collected. The platform prompts and records; it
 * does not file."
 *
 * A table rather than a column on the payout line, because the threshold is a
 * property of a person and a year rather than of a payment: an affiliate
 * crosses it across several batches, and a per-line enum could never answer
 * "have they crossed it yet". The line still carries its own copy — see there
 * for why.
 */
export const affiliateTaxProfiles = pgTable(
  "affiliate_tax_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Free text: the platform does not model the world's tax authorities. */
    jurisdiction: text("jurisdiction").notNull().default(""),
    /** "1099-NEC", "T4A", or whatever the owner's accountant calls it. */
    formKind: text("form_kind").notNull().default(""),
    state: text("state", {
      enum: ["not_required", "requested", "collected", "expired"],
    })
      .notNull()
      .default("not_required"),
    /** Paid-in-year above which the owner must ask. Zero means "always ask". */
    thresholdMinor: integer("threshold_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("affiliate_tax_profiles_contact_idx").on(t.contactId)],
);
