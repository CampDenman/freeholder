// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Calendars: anything whose time can be spent (MASTER.md §4.4, C6.01).
//
// The model separates three things every simplistic booking tool conflates:
// who or what is being booked (a calendar), what may be booked on it
// (availability, C6.02), and what was booked (a booking, C6.07). This file is
// the first of those.
//
// **A person's calendar and the business's calendar are different objects, and
// both exist from day one.** A solo owner has one of each and never notices;
// the moment they hire somebody, buy a second chair, or start renting the
// studio out, nothing has to be restructured. §4.4 calls this the single most
// expensive assumption to retrofit, and it costs a `kind` column to get right.
//
// **Resources are calendars too.** A massage room, a photo studio, a rental
// lens and a bookable van all behave identically: they have hours, they can be
// double-booked by mistake, and they need to be free at the same moment the
// person is. Making them one entity is what turns "this service needs a
// therapist *and* a room" into a query rather than a feature.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { businessLocations } from "@/core/locations/schema";
import { externalCalendars } from "@/core/connections/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const CALENDAR_KINDS = ["person", "business", "resource"] as const;
export const CALENDAR_STATUSES = ["active", "archived"] as const;
/** How a calendar takes part in a service (§4.4's `CalendarMembership`). */
export const MEMBERSHIP_ROLES = ["primary", "assistant", "resource"] as const;

export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: CALENDAR_KINDS }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * Whose calendar this is. Null for the business itself and for every
     * resource — a kiln has no login, and a booking names a calendar rather
     * than a user precisely so that stays true.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    /**
     * The calendar's own zone, not the business's. A second location in
     * another country is a calendar, and its hours are local to it (§4.9).
     */
    timezone: text("timezone").notNull(),
    /** 1:1, a class of twelve, or a webinar. Per slot, and per calendar. */
    capacityDefault: integer("capacity_default").notNull().default(1),
    colour: text("colour"),
    /**
     * The synced calendar whose busy time blocks this one (C4.12).
     *
     * A reference rather than §4.4's `external_sync`/`sync_token` pair: that
     * machinery already exists on `external_calendars`, and a second copy of a
     * provider cursor is a second thing to get out of step. What this column
     * adds is the mapping — which real calendar this bookable one *is*.
     */
    externalCalendarId: uuid("external_calendar_id").references(
      () => externalCalendars.id,
      { onDelete: "set null" },
    ),
    /** No bookings more than this far out (§4.4). */
    bookingHorizonDays: integer("booking_horizon_days").notNull().default(180),
    /** No bookings sooner than this (§4.4's lead time). */
    minNoticeMin: integer("min_notice_min").notNull().default(120),
    /** Burnout is a scheduling bug, so the ceiling is a column. */
    maxPerDay: integer("max_per_day"),
    status: text("status", { enum: CALENDAR_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("calendars_slug_idx").on(t.slug),
    index("calendars_kind_idx").on(t.kind, t.status),
    index("calendars_user_idx").on(t.userId),
    // Exactly one business calendar. A second one is not a configuration an
    // owner meant to make; it is two answers to "when is the business open".
    uniqueIndex("calendars_one_business_idx")
      .on(t.kind)
      .where(sql`${t.kind} = 'business'`),
    check("calendars_capacity_positive", sql`${t.capacityDefault} > 0`),
    check("calendars_horizon_positive", sql`${t.bookingHorizonDays} > 0`),
    check("calendars_notice_not_negative", sql`${t.minNoticeMin} >= 0`),
    check("calendars_max_per_day_positive", sql`${t.maxPerDay} is null or ${t.maxPerDay} > 0`),
    // A person's calendar belongs to a person; the other two do not.
    check(
      "calendars_person_has_holder",
      sql`(${t.kind} = 'person') = (${t.userId} is not null)`,
    ),
  ],
);

/**
 * Which calendars a service may draw on, and how.
 *
 * This is the row that makes "a therapist *and* a room" answerable: a service
 * with a `primary` membership and a `resource` membership needs both free at
 * once, and the resolver (C6.03) reads that from here rather than from a
 * special case per service type.
 *
 * `serviceOfferingId` is deliberately untyped by a foreign key: catalog is a
 * module and core may not depend on one (§11). The service that writes these
 * rows checks the offering exists; the column is the join, not the guarantee.
 */
export const calendarMemberships = pgTable(
  "calendar_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    serviceOfferingId: uuid("service_offering_id").notNull(),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull().default("primary"),
    /** Lower first, for assignment that prefers somebody without excluding others. */
    priority: integer("priority").notNull().default(0),
    /** Free text an owner uses, not an enum the platform pretends to understand. */
    skillLevel: text("skill_level"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("calendar_memberships_unique_idx").on(
      t.serviceOfferingId,
      t.calendarId,
      t.role,
    ),
    index("calendar_memberships_service_idx").on(t.serviceOfferingId, t.priority),
    index("calendar_memberships_calendar_idx").on(t.calendarId),
    check("calendar_memberships_priority", sql`${t.priority} between 0 and 1000`),
  ],
);
