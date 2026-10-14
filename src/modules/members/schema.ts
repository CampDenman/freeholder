// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Members (MASTER.md §44.1, C12.01): one site, many people.
//
// A member is any signed-in user who has claimed a handle. The profile hangs
// off `users`, not `contacts`: a contact is a record the business keeps about
// someone, a member profile is something the person keeps about themselves.
// The link to the spine is the user's own contact row (`contacts.user_id`).
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const MEMBER_STATUSES = ["active", "pending", "suspended"] as const;
export const JOIN_POLICIES = ["open", "approval", "invite"] as const;
/** Lowercase letters, digits and underscores; 3–30 characters. */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export const memberProfiles = pgTable(
  "member_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    /** A self-attestation, never a birthdate: the site needs the answer, not the data. */
    isAdult: boolean("is_adult").notNull().default(false),
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }).notNull(),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    handleChangedAt: timestamp("handle_changed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("member_profiles_handle_idx").on(t.handle),
    index("member_profiles_status_idx").on(t.status, t.createdAt),
    check("member_profiles_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,30}$'`),
    check("member_profiles_status_valid", sql`${t.status} in ('active','pending','suspended')`),
    check("member_profiles_display_name_length", sql`char_length(${t.displayName}) between 1 and 80`),
    check("member_profiles_bio_length", sql`char_length(${t.bio}) <= 1000`),
  ],
);

/** The site's membership rules. One row, id 1. */
export const memberSettings = pgTable(
  "member_settings",
  {
    id: integer("id").primaryKey().default(1),
    joinPolicy: text("join_policy", { enum: JOIN_POLICIES }).notNull().default("open"),
    minimumAge: integer("minimum_age").notNull().default(16),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("member_settings_singleton", sql`${t.id} = 1`),
    check("member_settings_join_policy_valid", sql`${t.joinPolicy} in ('open','approval','invite')`),
    check("member_settings_minimum_age_range", sql`${t.minimumAge} between 13 and 21`),
  ],
);

/** Invitations for invite-only sites, matched on the email the person proves. */
export const memberInvitations = pgTable(
  "member_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("member_invitations_email_idx").on(t.email),
    check("member_invitations_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);
