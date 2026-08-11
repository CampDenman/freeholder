// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Identity & access tables (MASTER.md §4.1). A User is a login linked to one
// named role; customers may be magic-link-only (null password_hash).
// Sessions are server-side per §9: hand-rolled Lucia-style, token hashed at
// rest so a database leak never yields a usable session.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * A role is a named bundle of stored grants, never a rank embedded in code.
 * `key` is stable because users and audit history refer to it; the owner may
 * change the human name without changing what those records mean.
 */
export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  assignable: boolean("assignable").notNull().default(true),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * Per-module access. `view` admits queries and `manage` admits both queries
 * and mutations. A `*` module is stored like any other grant; the permission
 * engine never infers it from a role name.
 */
export const roleGrants = pgTable(
  "role_grants",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    module: text("module").notNull(),
    access: text("access", { enum: ["view", "manage"] }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: "role_grants_role_module_pk",
      columns: [t.roleKey, t.module],
    }),
    index("role_grants_module_idx").on(t.module),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    role: text("role")
      .notNull()
      .references(() => roles.key),
    otpSecret: text("otp_secret"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    // One owner, enforced by the database. The setup wizard's registerOwner is
    // a public unauthenticated endpoint (§13), so "check then insert" in the
    // service layer is not enough: two concurrent first-boot requests both
    // read an empty table and both insert. This index is what actually makes
    // first boot happen exactly once.
    uniqueIndex("users_single_owner_idx")
      .on(t.role)
      .where(sql`${t.role} = 'owner'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
  ],
);

/**
 * A password reset in flight (MASTER.md §9, §13).
 *
 * The token is stored **hashed**, exactly as a session token is: a database
 * leak must not hand somebody a working reset link for every account. The row
 * is the record that a reset was asked for; the token itself exists only in
 * the email and in the URL the person clicks.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when spent. A reset link is worth exactly one use. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("password_resets_token_idx").on(t.tokenHash),
    index("password_resets_user_idx").on(t.userId),
  ],
);
