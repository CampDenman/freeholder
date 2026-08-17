// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events and classes (MASTER.md C6.11, C2.21).

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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { contacts } from "@/core/contacts/schema";
import { businessLocations } from "@/core/locations/schema";

export const EVENT_STATUSES = ["draft", "published", "cancelled"] as const;
export const REGISTRATION_STATUSES = [
  "reserved",
  "confirmed",
  "waitlisted",
  "cancelled",
  "checked_in",
] as const;

export interface EventSeo {
  title?: string;
  description?: string;
}

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    venueName: text("venue_name"),
    venueAddress: text("venue_address"),
    venueLocationId: uuid("venue_location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: EVENT_STATUSES }).notNull().default("draft"),
    seo: jsonb("seo").$type<EventSeo>().notNull().default({}),
    workingName: text("working_name"),
    workingSummary: text("working_summary"),
    workingVenueName: text("working_venue_name"),
    workingVenueAddress: text("working_venue_address"),
    workingSeo: jsonb("working_seo").$type<EventSeo>(),
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("events_slug_idx").on(t.slug),
    index("events_status_updated_idx").on(t.status, t.updatedAt),
    check(
      "events_slug_valid",
      sql`char_length(${t.slug}) between 1 and 180 and ${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("events_name_valid", sql`char_length(${t.name}) between 1 and 240`),
    check("events_status_valid", sql`${t.status} in ('draft','published','cancelled')`),
    check("events_version_positive", sql`${t.version} > 0`),
  ],
);

export const eventSessions = pgTable(
  "event_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    capacity: integer("capacity").notNull().default(0),
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("event_sessions_event_starts_idx").on(t.eventId, t.startsAt),
    check("event_sessions_capacity_nonneg", sql`${t.capacity} >= 0`),
    check("event_sessions_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const eventTickets = pgTable(
  "event_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("CAD"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("event_tickets_event_idx").on(t.eventId),
    check("event_tickets_name_valid", sql`char_length(${t.name}) between 1 and 120`),
    check("event_tickets_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("event_tickets_currency_valid", sql`char_length(${t.currency}) = 3`),
  ],
);

export const eventRegistrations = pgTable(
  "event_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => eventSessions.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => eventTickets.id, { onDelete: "set null" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    status: text("status", { enum: REGISTRATION_STATUSES }).notNull().default("confirmed"),
    quantity: integer("quantity").notNull().default(1),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("event_registrations_session_idx").on(t.sessionId, t.status),
    index("event_registrations_contact_idx").on(t.contactId),
    index("event_registrations_event_idx").on(t.eventId),
    check("event_registrations_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "event_registrations_status_valid",
      sql`${t.status} in ('reserved','confirmed','waitlisted','cancelled','checked_in')`,
    ),
  ],
);
