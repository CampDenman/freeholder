// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Server-side sessions (MASTER.md §4.1, §9). The raw token exists only in
// the caller's cookie; the database stores an HMAC of it keyed by
// SESSION_SECRET, so neither a DB leak nor a secret leak alone forges a
// session. Sliding expiration: validating within the renewal window extends
// the session rather than logging the user out mid-work.
import { createHmac, randomBytes } from "node:crypto";
import { count, eq } from "drizzle-orm";
import {
  roleGrants,
  sessions,
  totpFactors,
  users,
  webauthnCredentials,
} from "@/core/auth/schema";
import { env } from "@/core/env";
import type { ModuleGrant, Tx } from "@/core/service";
import { isPrivilegedGrants } from "@/core/auth/two-factor-crypto";

export const SESSION_COOKIE = "freeholder_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEWAL_WINDOW_MS = SESSION_TTL_MS / 2;
export const STEP_UP_TTL_MS = 10 * 60 * 1000;

function sessionSecret(): string {
  const secret = env().SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Generate one (32+ random chars) and add it to .env — see .env.example.",
    );
  }
  return secret;
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export interface SessionUser {
  userId: string;
  role: string;
  grants: ModuleGrant[];
  email: string;
  sessionId: string;
  expiresAt: Date;
  security: {
    twoFactorRequired: boolean;
    twoFactorEnrolled: boolean;
    twoFactorVerified: boolean;
    stepUpValid: boolean;
  };
}

export async function createSession(
  tx: Tx,
  userId: string,
  meta: {
    ip?: string;
    userAgent?: string;
    twoFactorVerified?: boolean;
  } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await tx.insert(sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
    twoFactorVerifiedAt: meta.twoFactorVerified ? new Date() : null,
    stepUpAt: meta.twoFactorVerified ? new Date() : null,
  });
  return { token, expiresAt };
}

export async function validateSession(
  tx: Tx,
  token: string,
): Promise<SessionUser | undefined> {
  const rows = await tx
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      role: users.role,
      email: users.email,
      twoFactorVerifiedAt: sessions.twoFactorVerifiedAt,
      stepUpAt: sessions.stepUpAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  if (row.expiresAt.getTime() <= Date.now()) {
    await tx.delete(sessions).where(eq(sessions.id, row.sessionId));
    return undefined;
  }
  if (row.expiresAt.getTime() - Date.now() < RENEWAL_WINDOW_MS) {
    const renewed = new Date(Date.now() + SESSION_TTL_MS);
    await tx
      .update(sessions)
      .set({ expiresAt: renewed })
      .where(eq(sessions.id, row.sessionId));
    row.expiresAt = renewed;
  }
  const grants = await tx
    .select({ module: roleGrants.module, access: roleGrants.access })
    .from(roleGrants)
    .where(eq(roleGrants.roleKey, row.role));
  const [[totp], [webauthn]] = await Promise.all([
    tx.select({ n: count() }).from(totpFactors).where(eq(totpFactors.userId, row.userId)),
    tx.select({ n: count() }).from(webauthnCredentials).where(eq(webauthnCredentials.userId, row.userId)),
  ]);
  const twoFactorEnrolled = (totp?.n ?? 0) + (webauthn?.n ?? 0) > 0;
  return {
    ...row,
    grants,
    security: {
      twoFactorRequired: isPrivilegedGrants(grants),
      twoFactorEnrolled,
      twoFactorVerified: Boolean(row.twoFactorVerifiedAt),
      stepUpValid: Boolean(
        row.stepUpAt && Date.now() - row.stepUpAt.getTime() <= STEP_UP_TTL_MS,
      ),
    },
  };
}

export async function markSessionStepUp(tx: Tx, sessionId: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ twoFactorVerifiedAt: new Date(), stepUpAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function revokeSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Log out by presenting the token, not by naming a row. Holding the token is
 * the only proof of ownership a session has, so this is the primitive that
 * cannot revoke somebody else's session. Returns the id it deleted, if any —
 * absent means the session was already gone, which is a successful logout.
 */
export async function revokeSessionByToken(
  tx: Tx,
  token: string,
): Promise<string | undefined> {
  const [deleted] = await tx
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .returning({ id: sessions.id });
  return deleted?.id;
}
