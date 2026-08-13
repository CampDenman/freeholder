// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Business identity and module toggles (MASTER.md §4.8, §13). One deploy is
// one business (§2 principle 1), so the profile is a genuine singleton and the
// database says so — a second row is not "unlikely", it is rejected.
//
// These are known fields, so they are columns. jsonb here would be the shadow
// store §2 principle 12 forbids; it is reserved for the per-module config
// below, whose shape only that module knows.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const businessProfile = pgTable(
  "business_profile",
  {
    /** Always 1. Single-tenant is a constraint here, not a convention. */
    id: integer("id").primaryKey().default(1),
    name: text("name").notNull(),
    tagline: text("tagline"),
    /**
     * schema.org type the owner picks in setup (§13 step 2) — Photographer,
     * HairSalon, ProfessionalService… It drives the JSON-LD every public page
     * emits, so it is identity, not decoration.
     */
    schemaType: text("schema_type").notNull().default("LocalBusiness"),
    /** ISO-3166-1 alpha-2. Tax follows location, not locale (§4.9). */
    country: text("country").notNull(),
    /** BCP-47. Unprefixed in URLs; others are path-prefixed (§4.9). */
    defaultLocale: text("default_locale").notNull().default("en"),
    enabledLocales: text("enabled_locales")
      .array()
      .notNull()
      .default(sql`'{"en"}'`),
    /** ISO-4217. Money is never auto-converted at charge time (§4.9). */
    baseCurrency: text("base_currency").notNull(),
    /** IANA zone. Store UTC, display here (§4.9 timezone discipline). */
    timezone: text("timezone").notNull(),
    units: text("units", { enum: ["metric", "imperial"] })
      .notNull()
      .default("metric"),
    /** 0 = Sunday, matching Date#getDay, so no translation layer is needed. */
    firstDayOfWeek: integer("first_day_of_week").notNull().default(1),
    /** Set once the wizard finishes; /setup locks itself after this (§13). */
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("business_profile_singleton", sql`${t.id} = 1`),
    check(
      "business_profile_country_alpha2",
      sql`${t.country} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "business_profile_currency_alpha3",
      sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "business_profile_first_day",
      sql`${t.firstDayOfWeek} between 0 and 6`,
    ),
  ],
);

export const moduleSettings = pgTable("module_settings", {
  /** The module's manifest name — one row per module, so it is the key. */
  module: text("module").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  /** Validated against the module's settingsSchema (§11) before write. */
  config: jsonb("config").notNull().default({}),
  updatedAt: updatedAtColumn(),
});
