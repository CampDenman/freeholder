// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Connected accounts (MASTER.md §41).
//
// The model exists to hold something delicate: an owner's access to their own
// Google, Microsoft or Apple account. Three properties are structural rather
// than promised.
//
// **An account belongs to a person, not to the business.** A staff member who
// connects their calendar has not handed the owner their private life.
// `userId` is the holder; `sharedWithBusiness` is an explicit, revocable act
// for the accounts that genuinely are the business's.
//
// **Several accounts per provider is the normal case.** Nothing keys on
// provider alone — the unique index is on the provider *and* the account id
// within it, because "my personal Gmail and the shop's Workspace address" is
// what everybody actually has.
//
// **Detail is not synced by default.** `detailVisibility` is `busy_only` to
// begin with: an external event's times are stored and its title is not, so
// what leaks in the worst case is that somebody was busy at 3pm.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Whose account this is. Cascades: if the person is removed, their
     * personal connections go with them rather than becoming orphaned
     * credentials nobody can see but the platform still holds.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["google", "microsoft", "apple", "caldav", "imap"],
    }).notNull(),
    /** The provider's own id for the account. Stable across email changes. */
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    /** The owner's own label for what this account is *for*. */
    kind: text("kind", { enum: ["personal", "business"] })
      .notNull()
      .default("personal"),
    /** Exactly what the provider granted, as it said it. */
    scopesGranted: text("scopes_granted").array().notNull().default(sql`'{}'`),
    /**
     * Encrypted under CREDENTIAL_KEY, bound to this row's id (see crypto.ts).
     * Never selected by the list services — a token has no business in a
     * response body, and the only reader is the sync layer.
     */
    credentials: text("credentials"),
    status: text("status", {
      enum: ["active", "needs_reconnect", "revoked"],
    })
      .notNull()
      .default("active"),
    /**
     * A provider revoking a grant is a state, not an error (§41). The account
     * stops being used, the owner is told, and nothing retries into a lockout.
     */
    lastError: text("last_error"),
    /** Deliberate and revocable. Default false: an account is personal first. */
    sharedWithBusiness: boolean("shared_with_business").notNull().default(false),
    detailVisibility: text("detail_visibility", { enum: ["busy_only", "full"] })
      .notNull()
      .default("busy_only"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One row per account per provider. Connecting the same Google account
    // twice is the same connection, not a second one.
    uniqueIndex("connected_accounts_provider_idx").on(
      t.provider,
      t.providerAccountId,
    ),
    index("connected_accounts_user_idx").on(t.userId),
  ],
);

/**
 * What an account is actually being used for.
 *
 * Separate from `scopesGranted` because those two answer different questions:
 * the provider says what it *permitted*, and this says what the owner has
 * *switched on*. §41's incremental authorization means the first is often
 * narrower than a reader expects and the second is narrower still.
 */
export const connectionCapabilities = pgTable(
  "connection_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    capability: text("capability", {
      enum: [
        "calendar_read",
        "calendar_write",
        "mail_read",
        "mail_send",
        "contacts_read",
        "files_read",
      ],
    }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** The provider scope string this required, for the reconnect prompt. */
    scopeString: text("scope_string"),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("connection_capabilities_unique_idx").on(
      t.connectedAccountId,
      t.capability,
    ),
  ],
);

export const externalCalendars = pgTable(
  "external_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    colour: text("colour"),
    timezone: text("timezone"),
    /**
     * §41's split, per calendar. `busy_source` contributes to the union that
     * stops a double booking; `bookable` is one Freeholder may write to;
     * `ignored` is the calendar of a football team nobody needs blocked out.
     */
    role: text("role", { enum: ["busy_source", "bookable", "ignored"] })
      .notNull()
      .default("busy_source"),
    /** The provider's incremental-sync cursor, so a poll is cheap. */
    syncToken: text("sync_token"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("external_calendars_unique_idx").on(
      t.connectedAccountId,
      t.externalId,
    ),
  ],
);

/**
 * A shadow of an external event, kept only as far as it is needed.
 *
 * `title` is nullable and stays null unless the account's `detailVisibility`
 * is `full`. That is the privacy design in one column: the availability engine
 * needs to know somebody is busy from 3 to 4, and needs nothing else.
 */
export const externalEvents = pgTable(
  "external_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalCalendarId: uuid("external_calendar_id")
      .notNull()
      .references(() => externalCalendars.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /** False for a "free" event: on the calendar, but not blocking. */
    busy: boolean("busy").notNull().default(true),
    title: text("title"),
    /** Set when Freeholder created this event, so it can be updated later. */
    bookingId: uuid("booking_id"),
    /** Anything the provider returned that a later feature may want. */
    raw: jsonb("raw"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("external_events_unique_idx").on(
      t.externalCalendarId,
      t.externalId,
    ),
    // The availability query: everything busy overlapping a window.
    index("external_events_window_idx").on(t.startsAt, t.endsAt),
  ],
);
