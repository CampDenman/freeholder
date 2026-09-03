// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Collected customer feedback (MASTER.md §4.6, C8.09).
//
// A `Review` is not a `Testimonial`. §4.5's testimonial is a quote the owner
// chose and attributed to work they are proud of; a review is what a customer
// said, whether or not the owner enjoys reading it. Conflating them would let
// "curate the wall" quietly become "delete the ones under four stars", which
// is exactly what the aggregate rules below exist to prevent.
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
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** §4.6: post_booking / post_order / manual. C9.27 adds google_business. */
export const REVIEW_SOURCES = ["post_order", "post_booking", "manual", "google_business"] as const;

/**
 * `pending` is unread, `approved` is public, `hidden` is read and withheld,
 * `rejected` is spam or abuse.
 *
 * `hidden` and `rejected` are deliberately different. Hiding is an editorial
 * choice about a real customer's real opinion and it still counts toward the
 * rating; rejecting is a judgement that this is not a customer's opinion at
 * all, and it counts toward nothing.
 */
export const REVIEW_STATES = ["pending", "approved", "hidden", "rejected"] as const;

/** What a review is about. Untyped ids: reviews must work with modules off. */
export const REVIEW_SUBJECTS = ["business", "product", "service"] as const;

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullable so privacy erasure can keep the rating and lose the person. */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    /** Kept when the contact goes, so the wall does not become anonymous. */
    displayName: text("display_name"),
    source: text("source", { enum: REVIEW_SOURCES }).notNull(),
    subjectType: text("subject_type", { enum: REVIEW_SUBJECTS })
      .notNull()
      .default("business"),
    /**
     * Untyped on purpose (§11): a review of a product must not make the
     * reviews module depend on catalog being installed.
     */
    subjectId: uuid("subject_id"),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    status: text("status", { enum: REVIEW_STATES }).notNull().default("pending"),
    /** Where the owner has chosen to show it, when approved. */
    displayLocations: text("display_locations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The owner's public answer. One per review: a thread is a conversation. */
    replyBody: text("reply_body"),
    replyAt: timestamp("reply_at", { withTimezone: true }),
    replyByUserId: uuid("reply_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * The coupon offered for writing this, if any (C8.09 incentives).
     * Untyped for the same reason as `subjectId`.
     */
    incentiveCouponId: uuid("incentive_coupon_id"),
    /**
     * Whether the incentive was disclosed to the reader. An incentivised
     * review that does not say so is the kind of thing regulators fine people
     * for, so it is recorded rather than assumed.
     */
    incentiveDisclosed: boolean("incentive_disclosed").notNull().default(false),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedByUserId: uuid("moderated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("reviews_subject_idx").on(t.subjectType, t.subjectId, t.status),
    index("reviews_contact_idx").on(t.contactId),
    index("reviews_status_idx").on(t.status, t.createdAt),
    check("reviews_rating", sql`${t.rating} between 1 and 5`),
    // C9.27: Google Business Profile allows a star rating with no comment.
    check("reviews_body", sql`char_length(${t.body}) between 0 and 5000`),
    check(
      "reviews_reply",
      sql`(${t.replyBody} is null and ${t.replyAt} is null) or (${t.replyBody} is not null and ${t.replyAt} is not null)`,
    ),
    // A moderated review says when. A pending one has not been looked at.
    check(
      "reviews_moderated",
      sql`(${t.status} = 'pending' and ${t.moderatedAt} is null) or (${t.status} <> 'pending' and ${t.moderatedAt} is not null)`,
    ),
    // An incentive that nobody disclosed is not a disclosure.
    check(
      "reviews_incentive",
      sql`${t.incentiveCouponId} is null or ${t.incentiveDisclosed} = true`,
    ),
  ],
);

/**
 * The ask, sent after a purchase or a booking.
 *
 * Separate from the review because most asks are never answered, and a table
 * of empty reviews would poison every count that matters.
 */
export const reviewRequests = pgTable(
  "review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    source: text("source", { enum: REVIEW_SOURCES }).notNull(),
    subjectType: text("subject_type", { enum: REVIEW_SUBJECTS })
      .notNull()
      .default("business"),
    subjectId: uuid("subject_id"),
    /** HMAC of a high-entropy random, the same shape gallery guests use. */
    tokenHash: text("token_hash").notNull(),
    /** The coupon promised for answering, if the owner offered one. */
    incentiveCouponId: uuid("incentive_coupon_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewId: uuid("review_id").references(() => reviews.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("review_requests_token_idx").on(t.tokenHash),
    // One ask per person per thing. Chasing somebody twice for the same
    // purchase is how a review request becomes spam.
    uniqueIndex("review_requests_subject_idx").on(
      t.contactId,
      t.subjectType,
      t.subjectId,
    ),
    index("review_requests_contact_idx").on(t.contactId),
  ],
);

/** Photographs and video a customer attached to what they wrote. */
export const reviewMedia = pgTable(
  "review_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("review_media_unique_idx").on(t.reviewId, t.assetId),
    index("review_media_review_idx").on(t.reviewId, t.position),
  ],
);
