// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Password reset (MASTER.md §9, §13 step 1).
//
// The whole design is three sentences:
//
//   - The token is random, stored hashed, single-use, and short-lived.
//   - Asking for a reset tells the asker nothing about who has an account.
//   - Using one signs out every session, because a person resetting their
//     password is a person who thinks somebody else has it.
//
// Everything below is one of those three being enforced somewhere it could
// otherwise be forgotten.
import { z } from "zod";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { okResult } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import { passwordResets, sessions, users } from "@/core/auth/schema";
import { hashPassword } from "@/core/auth/passwords";
import { businessProfile } from "@/core/settings/schema";
import { sendMail } from "@/core/mail/service";
import { db } from "@/core/db";
import { mailSenders } from "@/core/mail/schema";
import {
  connectedAccounts,
  connectionCapabilities,
} from "@/core/connections/schema";
import { env } from "@/core/env";

/** An hour. Long enough to find the email; short enough to matter if leaked. */
const LIFETIME_MINUTES = 60;

/**
 * Hashed the same way a session token is, and for the same reason: what is
 * stored must not be usable. SHA-256 rather than scrypt because the token is
 * already 256 bits of randomness — stretching adds cost against an attack that
 * guessing cannot win anyway.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resetUrl(token: string): string {
  const origin = env().APP_URL.replace(/\/+$/, "");
  return `${origin}/reset?token=${encodeURIComponent(token)}`;
}

export const requestPasswordReset = defineService({
  name: "auth.requestPasswordReset",
  summary: "Send a password reset link, if that address has an account.",
  kind: "mutation",
  permission: "public",
  input: z.object({ email: z.string().trim().toLowerCase().max(320) }),
  rateLimit: {
    limit: 5,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many reset requests for that address. Try again shortly.",
  },
  output: okResult,
  handler: async (input, ctx) => {
    const [user] = await ctx.tx
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    // The answer is the same either way. A reset form that says "no account
    // with that address" is an account-enumeration oracle, and the person who
    // benefits from the honesty is never the person who typed their own email.
    const answer = { ok: true } as const;
    if (!user?.passwordHash) return answer;

    // Any earlier link stops working. Somebody clicking "send it again"
    // expects the newest email to be the one that works, and leaving the old
    // ones live widens the window for no benefit.
    await ctx.tx
      .update(passwordResets)
      .set({ usedAt: sql`now()` })
      .where(
        and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)),
      );

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    await ctx.tx.insert(passwordResets).values({
      userId: user.id,
      tokenHash,
      expiresAt: sql`now() + make_interval(mins => ${LIFETIME_MINUTES})`,
    });

    const [business] = await ctx.tx
      .select({ name: businessProfile.name })
      .from(businessProfile)
      .limit(1);
    const site = business?.name ?? "your Freeholder site";
    const url = resetUrl(token);

    try {
      await sendMail(ctx.tx, {
        to: input.email,
        subject: `Reset your password for ${site}`,
        text: [
          `Somebody asked to reset the password for ${site}.`,
          "",
          "If it was you, open this link within the hour:",
          url,
          "",
          "If it was not you, nothing has changed and you can ignore this. The",
          "link stops working as soon as it is used, or after an hour.",
        ].join("\n"),
      }, {
        requestedBy: actorString(ctx.actor),
        idempotencyKey: `password-reset:${tokenHash}`,
      });
    } catch {
      // A provider or suppression failure must not reveal that this address
      // belongs to an account. Retire the credential and return the same
      // response as an unknown address; the mail ledger/suppression list holds
      // the operator-facing evidence without putting the address in a log.
      await ctx.tx
        .delete(passwordResets)
        .where(eq(passwordResets.tokenHash, tokenHash));
      console.error("password-reset mail delivery failed");
      return answer;
    }

    // The token is never returned, logged or audited — the redaction rule
    // covers the input, and nothing here puts it anywhere else.
    ctx.setSubject("user", user.id);
    ctx.queueEvent("auth.passwordResetRequested", { userId: user.id });
    return answer;
  },
});

export const resetPassword = defineService({
  name: "auth.resetPassword",
  summary: "Set a new password using a reset link.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    token: z.string().min(10).max(200),
    newPassword: z.string().min(12).max(200),
  }),
  rateLimit: {
    limit: 20,
    windowSeconds: 15 * 60,
    subject: () => "reset",
    message: "Too many attempts. Wait a few minutes and try again.",
  },
  output: okResult.extend({ sessionsRevoked: z.number().int() }),
  handler: async (input, ctx) => {
    const [reset] = await ctx.tx
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.tokenHash, hashToken(input.token)))
      .limit(1);

    // One message for every way a link can be no good — expired, spent,
    // invented. Distinguishing them tells somebody probing which of their
    // guesses was closest.
    const refuse = () => {
      throw new ServiceError(
        "permission",
        "That reset link is no longer valid. Ask for a new one.",
      );
    };
    if (!reset || reset.usedAt) refuse();
    if (reset!.expiresAt.getTime() < Date.now()) refuse();

    await ctx.tx
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword) })
      .where(eq(users.id, reset!.userId));

    await ctx.tx
      .update(passwordResets)
      .set({ usedAt: sql`now()` })
      .where(eq(passwordResets.id, reset!.id));

    // Every session, including any the person doing this had. They are about
    // to sign in with the password they just chose, and an attacker's session
    // must not survive the reset that was meant to evict them.
    const revoked = await ctx.tx
      .delete(sessions)
      .where(eq(sessions.userId, reset!.userId))
      .returning({ id: sessions.id });

    ctx.setSubject("user", reset!.userId);
    ctx.queueEvent("auth.passwordReset", { userId: reset!.userId });
    return { ok: true, sessionsRevoked: revoked.length };
  },
});

/**
 * Whether this instance can actually deliver a reset email.
 *
 * The screen asks, so it can tell somebody the truth rather than "check your
 * inbox" when there is no mailer configured and the link went to a log file.
 */
export async function canDeliverMail(): Promise<boolean> {
  try {
    const [sender] = await db()
      .select({ id: mailSenders.id })
      .from(mailSenders)
      .leftJoin(
        connectedAccounts,
        eq(connectedAccounts.id, mailSenders.connectedAccountId),
      )
      .leftJoin(
        connectionCapabilities,
        and(
          eq(
            connectionCapabilities.connectedAccountId,
            connectedAccounts.id,
          ),
          eq(connectionCapabilities.capability, "mail_send"),
        ),
      )
      .where(
        and(
          eq(mailSenders.purpose, "transactional"),
          eq(mailSenders.isDefault, true),
          eq(mailSenders.status, "active"),
          eq(mailSenders.verificationStatus, "verified"),
          ne(mailSenders.provider, "console"),
          sql`(${mailSenders.connectedAccountId} is null or (${connectedAccounts.status} = 'active' and ${connectionCapabilities.enabled} = true))`,
        ),
      )
      .limit(1);
    if (sender) return true;
    const { mail } = await import("@/adapters/mail");
    return mail().delivers;
  } catch {
    return false;
  }
}

export default [requestPasswordReset, resetPassword];
