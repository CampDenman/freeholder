// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Identity & access tables (MASTER.md §4.1). A User is a login linked to one
// named role; customers may be magic-link-only (null password_hash).
// Sessions are server-side per §9: hand-rolled Lucia-style, token hashed at
// rest so a database leak never yields a usable session.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
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
    /** HMAC fingerprints support new-device/network detection without raw IP history. */
    deviceHash: text("device_hash"),
    networkHash: text("network_hash"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The factor was proven for this session; null means password-only. */
    twoFactorVerifiedAt: timestamp("two_factor_verified_at", {
      withTimezone: true,
    }),
    /** Fresh factor proof used by services that declare `stepUp: true`. */
    stepUpAt: timestamp("step_up_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
  ],
);

/**
 * Privacy-limited successful-login history and suspicious-login delivery.
 * Raw IPs and full user agents never land here: only HMAC fingerprints and
 * owner-readable coarse labels survive after the active session is gone.
 */
export const loginSecurityEvents = pgTable(
  "login_security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Deliberately not a foreign key. Revoking a session must not erase the
    // security notice that explains why the owner revoked it.
    sessionId: uuid("session_id").notNull(),
    deviceHash: text("device_hash"),
    networkHash: text("network_hash"),
    deviceLabel: text("device_label").notNull(),
    ipHint: text("ip_hint"),
    reason: text("reason", { enum: ["new_device", "new_network"] }),
    noticeStatus: text("notice_status", {
      enum: ["not_needed", "pending", "sent", "failed", "unavailable"],
    })
      .notNull()
      .default("not_needed"),
    noticeAttempts: integer("notice_attempts").notNull().default(0),
    noticeError: text("notice_error"),
    noticeSentAt: timestamp("notice_sent_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '90 days'`),
  },
  (t) => [
    index("login_security_events_user_created_idx").on(t.userId, t.createdAt),
    index("login_security_events_notice_idx").on(t.noticeStatus, t.createdAt),
    index("login_security_events_expiry_idx").on(t.expiresAt),
  ],
);

/** One encrypted TOTP seed per user. The legacy users.otp_secret stays unused. */
export const totpFactors = pgTable("totp_factors", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  encryptedSecret: text("encrypted_secret").notNull(),
  lastUsedStep: integer("last_used_step"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/** Passkeys/security keys. Public keys are credentials, but not secrets. */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    // Authenticator counters are unsigned 32-bit values; PostgreSQL integer
    // stops halfway through that range, while bigint safely covers it.
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(sql`ARRAY[]::text[]`),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("webauthn_credentials_credential_idx").on(t.credentialId),
    index("webauthn_credentials_user_idx").on(t.userId),
  ],
);

/** Random, one-use recovery codes. Only HMACs are retained. */
export const twoFactorRecoveryCodes = pgTable(
  "two_factor_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("two_factor_recovery_codes_hash_idx").on(t.codeHash),
    index("two_factor_recovery_codes_user_idx").on(t.userId),
  ],
);

/** Short-lived, single-purpose state for login and factor enrollment. */
export const twoFactorChallenges = pgTable(
  "two_factor_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", {
      enum: ["login", "totp-enrollment", "webauthn-registration", "webauthn-step-up"],
    }).notNull(),
    tokenHash: text("token_hash").notNull(),
    challenge: text("challenge"),
    pendingSecret: text("pending_secret"),
    /** Protected request metadata carried across password → second factor. */
    ipHint: text("ip_hint"),
    userAgent: text("user_agent"),
    deviceHash: text("device_hash"),
    networkHash: text("network_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("two_factor_challenges_token_idx").on(t.tokenHash),
    index("two_factor_challenges_user_expiry_idx").on(t.userId, t.expiresAt),
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

/**
 * A one-person business still needs a deliberate way to add the second
 * person. The bearer token is stored only as a hash; status is explicit so a
 * partial unique index can guarantee one live invitation per address even
 * when two owners or agents act concurrently.
 *
 * `roleKey` is an intentional snapshot rather than a foreign key. Invitation
 * history must survive deleting a custom role, while acceptance revalidates
 * that the role still exists, is assignable, and can enter the admin shell.
 */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    roleKey: text("role_key").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").notNull(),
    sendCount: integer("send_count").notNull().default(1),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    deliveryAdapter: text("delivery_adapter"),
    providerRef: text("provider_ref"),
    acceptedUserId: uuid("accepted_user_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("staff_invitations_token_idx").on(t.tokenHash),
    uniqueIndex("staff_invitations_pending_email_idx")
      .on(t.email)
      .where(sql`${t.status} = 'pending'`),
    index("staff_invitations_status_expiry_idx").on(t.status, t.expiresAt),
    index("staff_invitations_created_idx").on(t.createdAt),
  ],
);
