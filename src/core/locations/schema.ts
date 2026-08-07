// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Locations and NAP (MASTER.md §4.10).
//
// "NAP (Name, Address, Phone) consistency is the backbone of local SEO. It's
// captured once, structured, and emitted everywhere." Structured is the load-
// bearing word: a single `address` text column would render fine and be
// useless, because PostalAddress JSON-LD needs the parts separately and a
// crawler comparing this instance against a directory listing compares parts.
//
// Every address component is nullable except the country, because §4.10 makes
// locations optional in two directions at once: a business may have none at
// all, and a go-to-customer business has a real location with no street
// address to show. A NOT NULL on `street` would force that business to invent
// one, which is exactly the inconsistent NAP this table exists to prevent.
//
// Deviation from §4.10 as written, updated there in this same commit: the doc
// specified `OpeningHours.special_dates (jsonb: holidays, seasonal)`. Special
// dates are rows here instead. A Christmas closure is a known field with a
// known shape, so jsonb would be the shadow store §2 principle 12 forbids —
// and rows are what OpeningHoursSpecification actually wants, since a date
// override emits `validFrom`/`validThrough` while a weekly rule emits
// `dayOfWeek`. One table, one row per interval, discriminated by which of the
// two it fills in.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const businessLocations = pgTable(
  "business_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The N in NAP. Usually the business name, sometimes qualified — "Aurora
     * Coast Photography (Studio)" — and it is stored rather than derived
     * because a directory listing an owner cannot edit may already say
     * something slightly different, and matching it exactly is the point.
     */
    name: text("name").notNull(),
    /** Its address on the site: /locations/<slug>. */
    slug: text("slug").notNull(),
    /**
     * The one whose NAP is the business's own — the footer's, the home page's
     * LocalBusiness. Enforced by a partial unique index rather than by
     * convention, because "primary" that can be true twice is not a fact.
     */
    isPrimary: boolean("is_primary").notNull().default(false),
    /**
     * schema.org subtype for this location, when it differs from the
     * business's own (§4.10: "LocalBusiness or subtype: Photographer,
     * HairSalon"). Null means inherit — a business with one type does not
     * restate it per location, and changing it changes every location.
     */
    schemaType: text("schema_type"),

    // The A in NAP, in parts. All optional: see the file comment.
    street: text("street"),
    unit: text("unit"),
    city: text("city"),
    /** State, province, county — whatever the country calls its subdivision. */
    region: text("region"),
    postalCode: text("postal_code"),
    /** ISO-3166-1 alpha-2. Tax follows location, not locale (§4.9). */
    country: text("country").notNull(),

    /**
     * Coordinates, as numeric rather than float: a longitude is a decimal
     * value people compare for equality and copy between systems, and binary
     * floating point makes both of those subtly wrong.
     */
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    // The P in NAP, plus the rest of what LocalBusiness JSON-LD carries.
    phone: text("phone"),
    email: text("email"),
    googleBusinessProfileUrl: text("google_business_profile_url"),
    /** §4.10: "sameAs links" — the profiles that corroborate this NAP. */
    sameAs: text("same_as").array().notNull().default(sql`'{}'`),
    /** schema.org priceRange, a free-text band like "$$" or "$80–$400". */
    priceRange: text("price_range"),
    /** IANA zone, when this location keeps different time from the business. */
    timezone: text("timezone"),
    /**
     * Hidden locations keep their row and their page stops being published —
     * a seasonal studio closing for winter is not a deletion, and deleting it
     * would break every inbound link to its page.
     */
    status: text("status", { enum: ["visible", "hidden"] })
      .notNull()
      .default("visible"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("business_locations_slug").on(t.slug),
    // At most one primary. Partial, so any number of locations may be
    // non-primary while the flag stays a fact rather than a hope.
    uniqueIndex("business_locations_one_primary")
      .on(t.isPrimary)
      .where(sql`${t.isPrimary}`),
    check("business_locations_country_alpha2", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check(
      "business_locations_latitude",
      sql`${t.latitude} is null or ${t.latitude} between -90 and 90`,
    ),
    check(
      "business_locations_longitude",
      sql`${t.longitude} is null or ${t.longitude} between -180 and 180`,
    ),
    // Coordinates are a pair or they are nothing. Half of one renders no map
    // and emits no geo, but looks set in the admin.
    check(
      "business_locations_geo_pair",
      sql`(${t.latitude} is null) = (${t.longitude} is null)`,
    ),
  ],
);

export const openingHours = pgTable(
  "opening_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "cascade" }),
    /**
     * 0 = Sunday, matching Date#getDay and businessProfile.firstDayOfWeek, so
     * no translation layer sits between the three. Null on a date override.
     */
    weekday: smallint("weekday"),
    /** Set instead of `weekday` for a holiday or a one-off change. */
    onDate: date("on_date"),
    /** Null when closed — see the check constraint below. */
    opens: time("opens"),
    closes: time("closes"),
    /**
     * Closed all day. A distinct fact from "no row": no row for Sunday means
     * nobody has said anything about Sunday, and a *stated* closure is what
     * emits `opens: 00:00, closes: 00:00` and stops a search result promising
     * a visitor the door will be open.
     */
    closed: boolean("closed").notNull().default(false),
    /** Shown beside a date override: "Boxing Day", "summer hours". */
    label: text("label"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("opening_hours_location").on(t.locationId),
    // Exactly one of the two forms. A row that is both a Tuesday rule and a
    // Christmas override has no defined meaning, and picking one at render
    // time would be the platform guessing at an owner's hours.
    check(
      "opening_hours_weekly_or_dated",
      sql`(${t.weekday} is null) != (${t.onDate} is null)`,
    ),
    check(
      "opening_hours_weekday_range",
      sql`${t.weekday} is null or ${t.weekday} between 0 and 6`,
    ),
    // Open means both times; closed means neither. Anything else is a row
    // that cannot be rendered or emitted.
    check(
      "opening_hours_times_present",
      sql`case when ${t.closed} then ${t.opens} is null and ${t.closes} is null
           else ${t.opens} is not null and ${t.closes} is not null end`,
    ),
  ],
);

/**
 * §4.10: "For go-to-customer businesses (no storefront address shown)."
 *
 * One per location, because a location either serves an area or does not.
 * Two rows would be two answers to `areaServed`, and the JSON-LD would have
 * to pick.
 */
export const serviceAreas = pgTable(
  "service_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["radius", "regions"] }).notNull(),
    centerLatitude: numeric("center_latitude", { precision: 9, scale: 6 }),
    centerLongitude: numeric("center_longitude", { precision: 9, scale: 6 }),
    radiusKm: numeric("radius_km", { precision: 8, scale: 2 }),
    /** Named places: "Comox Valley", "Vancouver Island", "Greater London". */
    regions: text("regions").array().notNull().default(sql`'{}'`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("service_areas_location").on(t.locationId),
    // Each kind carries its own data or it describes nothing. A radius with
    // no centre is a circle somewhere on Earth.
    check(
      "service_areas_shape",
      sql`case ${t.kind}
            when 'radius' then ${t.centerLatitude} is not null and ${t.centerLongitude} is not null and ${t.radiusKm} is not null
            when 'regions' then array_length(${t.regions}, 1) is not null
            else false
          end`,
    ),
  ],
);
