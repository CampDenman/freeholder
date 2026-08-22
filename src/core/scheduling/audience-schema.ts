// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Booking audiences (MASTER.md §41, C6.05).
//
// §41 gives the example that settles the whole design: an owner wants
// customers to book them during shop hours, their friends to book them any
// time, and their dentist appointment to block both without telling anybody it
// is a dentist appointment.
//
// Two rules fall out, and they are separable:
//
//   1. **Busy time unions across every connected calendar.** Not optional: a
//      booking system that can double-book its owner is worse than none. That
//      rule belongs to the resolver (C6.03) and is untouched here.
//   2. **Bookability is per audience.** Who may book, when, and for what is a
//      property of the *audience*, not of the calendar.
//
// So this file is the second rule. An audience says who counts as a member,
// which hours apply to them, which services they may book, and which calendar
// the booking is written to — and the same engine answers "can this person
// book me at 8pm on Sunday" for a customer and for a brother-in-law with
// different results.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { calendars } from "@/core/scheduling/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** How somebody proves they are in an audience (§41's "who"). */
export const AUDIENCE_WHO = ["public", "token", "tag", "signed_in"] as const;

/**
 * Which hours apply.
 *
 * `any` is the one that looks surprising and is the whole point: a friend
 * booking at 8pm on Sunday is not constrained by shop hours. Busy time still
 * blocks them, because that rule is not an hours rule.
 */
export const AUDIENCE_HOURS = ["calendar", "custom", "any"] as const;

export const bookingAudiences = pgTable(
  "booking_audiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    who: text("who", { enum: AUDIENCE_WHO }).notNull().default("public"),
    /**
     * The unguessable half of a tokenised link.
     *
     * Held here rather than derived, so revoking an audience's link is
     * rotating one column rather than reissuing anything else.
     */
    token: text("token"),
    /** The contact tag that proves membership, when `who` is `tag`. */
    contactTag: text("contact_tag"),
    hours: text("hours", { enum: AUDIENCE_HOURS }).notNull().default("calendar"),
    /**
     * Per-audience availability rules. Null means "whatever the calendar or
     * the service already says" rather than zero — an audience that stated
     * nothing has not overridden anything.
     */
    minNoticeMin: integer("min_notice_min"),
    bookingHorizonDays: integer("booking_horizon_days"),
    bufferBeforeMin: integer("buffer_before_min"),
    bufferAfterMin: integer("buffer_after_min"),
    enabled: boolean("enabled").notNull().default(true),
    /** Lower first, so the owner controls which audience a person falls into. */
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("booking_audiences_slug_idx").on(t.slug),
    uniqueIndex("booking_audiences_token_idx")
      .on(t.token)
      .where(sql`${t.token} is not null`),
    index("booking_audiences_enabled_idx").on(t.enabled, t.position),
    // Each kind of proof carries exactly what it needs. A tokenised audience
    // with no token is a link nobody can use; a tag audience with no tag is
    // one everybody is in.
    check(
      "booking_audiences_token_present",
      sql`(${t.who} = 'token') = (${t.token} is not null)`,
    ),
    check(
      "booking_audiences_tag_present",
      sql`(${t.who} = 'tag') = (${t.contactTag} is not null)`,
    ),
    check(
      "booking_audiences_notice",
      sql`${t.minNoticeMin} is null or ${t.minNoticeMin} >= 0`,
    ),
    check(
      "booking_audiences_horizon",
      sql`${t.bookingHorizonDays} is null or ${t.bookingHorizonDays} > 0`,
    ),
  ],
);

/**
 * The audience's own opening hours, when `hours` is `custom`.
 *
 * Deliberately the same shape as `availability_rules` rather than a reference
 * to them: these are the audience's hours, not a calendar's, and one audience
 * may draw on several calendars whose hours differ.
 */
export const bookingAudienceHours = pgTable(
  "booking_audience_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => bookingAudiences.id, { onDelete: "cascade" }),
    /** 0 = Sunday, matching everything else that names a weekday. */
    weekday: smallint("weekday").notNull(),
    starts: time("starts").notNull(),
    ends: time("ends").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("booking_audience_hours_idx").on(t.audienceId, t.weekday),
    check("booking_audience_hours_weekday", sql`${t.weekday} between 0 and 6`),
    check("booking_audience_hours_order", sql`${t.ends} > ${t.starts}`),
  ],
);

/**
 * Which services this audience may book.
 *
 * No rows means none: an audience that has been given nothing to book cannot
 * book anything. The alternative — empty meaning "everything" — is the kind of
 * default that hands a tokenised link to the whole catalogue the first time
 * somebody forgets to fill it in.
 */
export const bookingAudienceServices = pgTable(
  "booking_audience_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => bookingAudiences.id, { onDelete: "cascade" }),
    /** Untyped by a foreign key: catalog is a module and core may not depend on one. */
    serviceOfferingId: uuid("service_offering_id").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("booking_audience_services_idx").on(t.audienceId, t.serviceOfferingId),
  ],
);

/** Which calendars a booking made by this audience is written to. */
export const bookingAudienceCalendars = pgTable(
  "booking_audience_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => bookingAudiences.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("booking_audience_calendars_idx").on(t.audienceId, t.calendarId),
  ],
);
