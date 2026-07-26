// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Auth services (MASTER.md §3 core/auth, §13 step 1). registerOwner is the
// first-boot primitive behind the setup wizard: it succeeds exactly once, on
// an empty users table — after that the instance has an owner and the door
// is closed. Email+password now; OTP verification joins in the wizard PR
// (the otp_secret column already exists).
import { z } from "zod";
import { count, eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { isUniqueViolation } from "@/core/db";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";
import {
  createSession,
  revokeSessionByToken,
  validateSession,
} from "@/core/auth/sessions";
import { defineService, ServiceError } from "@/core/service";

const sessionMeta = {
  ip: z.string().optional(),
  userAgent: z.string().optional(),
};

/** Registration is where the password policy lives. */
const registration = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(12, "use at least 12 characters"),
  ...sessionMeta,
});

/**
 * Login deliberately does *not* reuse the registration schema. Validating a
 * policy here would answer "was that even a plausible credential?" before the
 * password is checked — a different response for a malformed email or a short
 * password than for a wrong one — and would lock out every existing user the
 * day the policy is raised. Login accepts any non-empty input and fails one
 * way.
 */
const loginCredentials = z.object({
  email: z.string().min(1).toLowerCase(),
  password: z.string().min(1),
  ...sessionMeta,
});

export const registerOwner = defineService({
  name: "auth.registerOwner",
  summary: "Create the owner account on first boot (works exactly once).",
  kind: "mutation",
  permission: "public",
  input: registration,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select({ n: count() }).from(users);
    if ((row?.n ?? 0) > 0) {
      throw new ServiceError(
        "conflict",
        "This instance already has an owner. Log in instead.",
      );
    }
    // The count above is only the friendly path. Two concurrent first-boot
    // requests both see an empty table, so the partial unique index on
    // role='owner' is the actual guarantee — this catch translates losing that
    // race into the same plain-English conflict.
    const [user] = await ctx.tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: "owner",
      })
      .returning({ id: users.id })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "users_single_owner_idx")) {
          throw new ServiceError(
            "conflict",
            "This instance already has an owner. Log in instead.",
          );
        }
        if (isUniqueViolation(error, "users_email_idx")) {
          throw new ServiceError(
            "conflict",
            "That email address is already registered.",
          );
        }
        throw error;
      });
    ctx.setSubject("user", user!.id);
    const session = await createSession(ctx.tx, user!.id, input);
    return { userId: user!.id, ...session };
  },
});

export const login = defineService({
  name: "auth.login",
  summary: "Exchange email + password for a session.",
  kind: "mutation",
  permission: "public",
  input: loginCredentials,
  handler: async (input, ctx) => {
    const [user] = await ctx.tx
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    // Same failure either way — no user-enumeration oracle.
    const invalid = new ServiceError("permission", "Wrong email or password.");
    if (!user?.passwordHash) throw invalid;
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw invalid;
    }
    ctx.setSubject("user", user.id);
    await ctx.tx
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, user.id));
    const session = await createSession(ctx.tx, user.id, input);
    return { userId: user.id, role: user.role, ...session };
  },
});

export const logout = defineService({
  name: "auth.logout",
  summary: "Revoke the calling session.",
  kind: "mutation",
  // Takes the token, never a session id: naming a row would let any logged-in
  // caller revoke a session that isn't theirs, and no permission level can
  // express "this one is mine". Holding the token is the proof.
  permission: "customer",
  input: z.object({ token: z.string().min(1) }),
  handler: async (input, ctx) => {
    const sessionId = await revokeSessionByToken(ctx.tx, input.token);
    if (sessionId) ctx.setSubject("session", sessionId);
    // Already-gone is a successful logout, not an error.
    return { ok: true };
  },
});

export const whoami = defineService({
  name: "auth.whoami",
  summary: "Resolve a session token to its user, renewing if due.",
  kind: "query",
  permission: "public",
  input: z.object({ token: z.string().min(1) }),
  handler: (input, ctx) => validateSession(ctx.tx, input.token),
});

export default [registerOwner, login, logout, whoami];
