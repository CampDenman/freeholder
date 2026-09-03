// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Connected social profiles (MASTER.md §33, C9.24).
//
// Provider is plain text, not a closed enum, so a plugin can add a network
// without a migration on this table — the property C9.31 later proves. The
// unique index is (provider, provider account id) because several profiles
// per network is the normal case, not a workaround.
//
// No account is usable until a person finishes the provider's OAuth *and*
// Freeholder's review step. `pending_review` is that gate. Assignment,
// read/respond/publish and approval policy are owner decisions on the row,
// independent of what the API currently permits (that lives in `capabilities`).
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
import { businessLocations } from "@/core/locations/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import {
  SOCIAL_APPROVAL_POLICIES,
  SOCIAL_ASSIGNMENTS,
  SOCIAL_HEALTH,
  SOCIAL_PROFILE_STATUSES,
} from "./contract";

export const socialOauthStates = pgTable(
  "social_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    returnTo: text("return_to").notNull().default("/admin/social"),
    codeVerifier: text("code_verifier"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_oauth_states_hash_idx").on(t.tokenHash),
    index("social_oauth_states_expiry_idx").on(t.expiresAt),
  ],
);

export const socialProfiles = pgTable(
  "social_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    /** Encrypted under CREDENTIAL_KEY, bound to this row's id. */
    credentials: text("credentials"),
    status: text("status", { enum: SOCIAL_PROFILE_STATUSES })
      .notNull()
      .default("pending_review"),
    assignedTo: text("assigned_to", { enum: SOCIAL_ASSIGNMENTS })
      .notNull()
      .default("business"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    allowRead: boolean("allow_read").notNull().default(true),
    allowRespond: boolean("allow_respond").notNull().default(false),
    allowPublish: boolean("allow_publish").notNull().default(false),
    approvalPolicy: text("approval_policy", { enum: SOCIAL_APPROVAL_POLICIES })
      .notNull()
      .default("required"),
    capabilities: jsonb("capabilities")
      .$type<{
        read: boolean;
        respond: boolean;
        publish: boolean;
        extras: string[];
      }>()
      .notNull()
      .default(sql`'{"read":true,"respond":false,"publish":false,"extras":[]}'::jsonb`),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
    lastHealthStatus: text("last_health_status", { enum: SOCIAL_HEALTH }),
    lastError: text("last_error"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedBy: uuid("connected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("social_profiles_provider_idx").on(t.provider, t.providerAccountId),
    index("social_profiles_status_idx").on(t.status),
    index("social_profiles_assignee_idx").on(t.assigneeUserId),
  ],
);

export const socialProfileLocations = pgTable(
  "social_profile_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_profile_locations_idx").on(t.profileId, t.locationId),
    index("social_profile_locations_location_idx").on(t.locationId),
  ],
);

export type SocialProfile = typeof socialProfiles.$inferSelect;
