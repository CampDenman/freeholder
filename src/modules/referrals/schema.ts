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
