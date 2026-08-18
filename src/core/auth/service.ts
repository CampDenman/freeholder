// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Auth services (MASTER.md §3 core/auth, §13 step 1). registerOwner is the
// first-boot primitive behind the setup wizard: it succeeds exactly once, on
// an empty users table — after that the instance has an owner and the door
// is closed. Email+password now; OTP verification joins in the wizard PR
// (the otp_secret column already exists).
import { z } from "zod";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { sessions, users } from "@/core/auth/schema";
import { isUniqueViolation } from "@/core/db";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";
import {
  createSession,
  hashSessionToken,
  protectSessionMetadata,
  revokeSessionByToken,
  validateSession,
} from "@/core/auth/sessions";
import { okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";

const sessionIssued = row({
  token: z.string(),
  sessionId: uuid,
  expiresAt: timestamp,
});
const loginResult = row({
  userId: uuid,
  role: z.string(),
  twoFactorRequired: z.boolean(),
  token: z.string(),
  expiresAt: timestamp,
});
const sessionUser = row({
  userId: uuid,
  role: z.string(),
  email: z.string(),
  sessionId: uuid,
  expiresAt: timestamp,
});
import { rateLimitKey, reset as resetRateLimit } from "@/core/security/rate-limit";
import { seedDefaultRoles } from "@/core/roles/defaults";
import { seedCoreGuidanceFlows } from "@/core/guidance/definitions";
import { createLoginChallenge } from "@/core/auth/two-factor";
import { recordSuccessfulLogin } from "@/core/auth/session-management/service";

/** Registration is where the password policy lives. */
const registration = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(12, "use at least 12 characters"),
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
});

export const registerOwner = defineService({
  name: "auth.registerOwner",
  summary: "Create the owner account on first boot (works exactly once).",
  kind: "mutation",
  permission: "public",
  input: registration,
  // One global bucket, not one per caller — deliberately, and worth saying
  // plainly. This endpoint succeeds exactly once in an instance's life, so
  // there is no account to count against and nothing to take over; what it
  // protects is the cost of hashing a password on an unauthenticated public
  // URL. Per-IP counting would be better, but nothing populates `ip` on this
  // path yet (threading a trusted client address through Server Actions needs
  // a proxy-trust decision this PR does not make), and a per-IP limit keyed on
  // a value that is always undefined is a global limit wearing a costume.
  //
  // The cost of a shared bucket is that a stranger can delay an owner's first
  // boot by up to fifteen minutes. The window expires on its own, so it is a
  // delay and never a lockout.
  rateLimit: {
    limit: 20,
    windowSeconds: 15 * 60,
    subject: () => "first-boot",
    message: "Too many setup attempts. Wait a few minutes and try again.",
  },
  output: row({ userId: uuid }).and(sessionIssued),
  handler: async (input, ctx) => {
    // Migrations seed these too, but first boot is deliberately self-healing:
    // a test database or a restored pre-role database still gets the same
    // data-backed permission catalogue before the owner row refers to it.
    await seedDefaultRoles(ctx.tx);
    await seedCoreGuidanceFlows(ctx.tx);
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
    const metadata = protectSessionMetadata(ctx.actor.request);
    const session = await createSession(ctx.tx, user!.id, metadata);
    await recordSuccessfulLogin(
      ctx.tx,
      user!.id,
      session.sessionId,
      metadata,
    );
    return { userId: user!.id, ...session };
  },
});

export const login = defineService({
  name: "auth.login",
  summary: "Exchange email + password for a session.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  input: loginCredentials,
  // Counted per email address rather than per IP: the attack this stops is
  // guessing one account's password, and an attacker with a proxy pool changes
  // IP freely while the target address stays the same. Ten tries in fifteen
  // minutes is far past honest mistyping and far short of a useful guess rate.
  //
  // It is not a lockout — the window expires on its own, so nobody can lock an
  // owner out of their own instance by failing to log in as them on purpose.
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many sign-in attempts. Wait a few minutes and try again.",
  },
  output: loginResult,
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
    // Clear the budget on success, so four fumbled attempts followed by the
    // right password do not leave someone one mistake from being throttled for
    // the rest of the window. Only a run of *failures* is suspicious.
    await resetRateLimit(rateLimitKey("auth.login", input.email));
    const metadata = protectSessionMetadata(ctx.actor.request);
    const twoFactor = await createLoginChallenge(ctx.tx, user.id, metadata);
    if (twoFactor) {
      return {
        userId: user.id,
        role: user.role,
        twoFactorRequired: true as const,
        // Compatibility fields keep the service result ergonomic for callers
        // that know they are password-only. They are never cookies and name
        // no session: an enrolled account still has no session at this point.
        token: "",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ...twoFactor,
      };
    }
    await ctx.tx
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, user.id));
    const session = await createSession(ctx.tx, user.id, metadata);
    await recordSuccessfulLogin(
      ctx.tx,
      user.id,
      session.sessionId,
      metadata,
    );
    return {
      userId: user.id,
      role: user.role,
      twoFactorRequired: false as const,
      challengeToken: "",
      methods: { totp: false, recovery: false, webauthn: false },
      webauthnOptions: undefined,
      ...session,
    };
  },
});

export const logout = defineService({
  name: "auth.logout",
  summary: "Revoke the calling session.",
  kind: "mutation",
  // Takes the token, never a session id: naming a row would let any logged-in
  // caller revoke a session that isn't theirs, and no permission level can
  // express "this one is mine". Holding the token is the proof.
  permission: "authenticated",
  input: z.object({ token: z.string().min(1) }),
  output: okResult,
  handler: async (input, ctx) => {
    const sessionId = await revokeSessionByToken(ctx.tx, input.token);
    if (sessionId) ctx.setSubject("session", sessionId);
    // Already-gone is a successful logout, not an error.
    return { ok: true };
  },
});

/**
 * Change your own password (MASTER.md §9, §13 step 1).
 *
 * The current password is required even though the caller is signed in, and
 * that is not ceremony: a session left open on a shared machine is the ordinary
 * way an account is taken over, and knowing the old password is the cheapest
 * proof that the person typing is the person the account belongs to.
 *
 * Every *other* session is revoked. Changing a password is what somebody does
 * when they think someone else has it — leaving the intruder's session alive
 * would make the act pointless. The caller's own session survives, because
 * signing somebody out of the screen they just used is a bug, not security.
 */
export const changePassword = defineService({
  name: "auth.changePassword",
  summary: "Change your own password.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    currentPassword: z.string().min(1),
    // §9's floor. Length rather than character classes: a passphrase somebody
    // can remember beats a short string with a punctuation mark bolted on.
    newPassword: z.string().min(12).max(200),
    /** The session doing the changing, so it is the one left standing. */
    keepSessionToken: z.string().optional(),
  }),
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (_input) => "change-password",
    message: "Too many attempts. Wait a few minutes and try again.",
  },
  output: okResult.extend({ otherSessionsRevoked: z.number().int() }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to change your password.");
    }
    if (
      ctx.actor.security?.twoFactorEnrolled &&
      !ctx.actor.security.stepUpValid
    ) {
      throw new ServiceError(
        "step_up_required",
        "Confirm your identity with two-factor authentication before changing your password.",
      );
    }
    const userId = ctx.actor.userId;

    const [user] = await ctx.tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.passwordHash) {
      // A magic-link-only customer has no password to change (§9).
      throw new ServiceError(
        "validation",
        "This account signs in without a password.",
      );
    }

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new ServiceError("permission", "That is not your current password.");
    }
    if (input.currentPassword === input.newPassword) {
      throw new ServiceError(
        "validation",
        "The new password is the same as the old one.",
      );
    }

    await ctx.tx
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword) })
      .where(eq(users.id, userId));

    const keepHash = input.keepSessionToken
      ? hashSessionToken(input.keepSessionToken)
      : undefined;
    const revoked = await ctx.tx
      .delete(sessions)
      .where(
        keepHash
          ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepHash))
          : eq(sessions.userId, userId),
      )
      .returning({ id: sessions.id });

    ctx.setSubject("user", userId);
    ctx.queueEvent("auth.passwordChanged", { userId });
    return { ok: true, otherSessionsRevoked: revoked.length };
  },
});

export const whoami = defineService({
  name: "auth.whoami",
  summary: "Resolve a session token to its user, renewing if due.",
  kind: "query",
  permission: "public",
  input: z.object({ token: z.string().min(1) }),
  output: sessionUser.optional(),
  handler: (input, ctx) => validateSession(ctx.tx, input.token),
});

export default [
  changePassword,registerOwner, login, logout, whoami];
