// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import type { ModuleGrant, RequestMetadata, Tx } from "@/core/service";
import { isPrivilegedGrants } from "@/core/auth/two-factor-crypto";

export const SESSION_COOKIE = "freeholder_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEWAL_WINDOW_MS = SESSION_TTL_MS / 2;
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
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

export interface ProtectedSessionMetadata {
  ipHint?: string;
  userAgent?: string;
  deviceHash?: string;
  networkHash?: string;
  deviceLabel: string;
}

function metadataHash(kind: "device" | "network", value: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`freeholder:${kind}:v1:${value}`)
    .digest("hex");
}

/** A coarse label that remains useful without retaining a fingerprint forever. */
export function describeDevice(userAgent?: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /(?:Chrome|CriOS)\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /curl\//i.test(userAgent)
            ? "Command-line client"
            : "Browser";
  const platform = /iPad/i.test(userAgent)
    ? "iPad"
    : /iPhone/i.test(userAgent)
      ? "iPhone"
      : /Android/i.test(userAgent)
        ? "Android"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? "macOS"
            : /Linux/i.test(userAgent)
              ? "Linux"
              : "unknown system";
  return `${browser} on ${platform}`;
}

function networkIdentity(ip: string): { identity: string; hint: string } {
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return {
      identity: parts.slice(0, 3).join("."),
      hint: `${parts.slice(0, 3).join(".")}.xxx`,
    };
  }
  const [head = "", tail = ""] = ip.split("::", 2);
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  if (right.at(-1)?.includes(".")) {
    const octets = right.pop()!.split(".").map(Number);
    right.push(
      ((octets[0]! << 8) | octets[1]!).toString(16),
      ((octets[2]! << 8) | octets[3]!).toString(16),
    );
  }
  const missing = Math.max(0, 8 - left.length - right.length);
  const expanded = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((part) => part.padStart(4, "0"));
  const prefix = expanded.slice(0, 4);
  const hint = prefix
    .map((part) => part.replace(/^0+/, "") || "0")
    .join(":");
  return { identity: prefix.join(":"), hint: `${hint}::/64` };
}

/**
 * Convert transient request data into bounded active-session metadata and
 * one-way comparison keys. A full IP never reaches persistent storage.
 */
export function protectSessionMetadata(
  request?: RequestMetadata,
): ProtectedSessionMetadata {
  const userAgent = request?.userAgent
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
  const normalizedDevice = userAgent
    ?.toLowerCase()
    .replace(/\d+(?:\.\d+)*/g, "#")
    .replace(/\s+/g, " ");
  const network = request?.ip ? networkIdentity(request.ip) : undefined;
  return {
    userAgent: userAgent || undefined,
    deviceLabel: describeDevice(userAgent),
    deviceHash: normalizedDevice
      ? metadataHash("device", normalizedDevice)
      : undefined,
    networkHash: network
      ? metadataHash("network", network.identity)
      : undefined,
    ipHint: network?.hint,
  };
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
    ipHint?: string;
    userAgent?: string;
    deviceHash?: string;
    networkHash?: string;
    twoFactorVerified?: boolean;
  } = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await tx
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ip: meta.ipHint,
      userAgent: meta.userAgent,
      deviceHash: meta.deviceHash,
      networkHash: meta.networkHash,
      twoFactorVerifiedAt: meta.twoFactorVerified ? new Date() : null,
      stepUpAt: meta.twoFactorVerified ? new Date() : null,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row!.id, expiresAt };
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
      lastSeenAt: sessions.lastSeenAt,
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
  const now = Date.now();
  const renewed =
    row.expiresAt.getTime() - now < RENEWAL_WINDOW_MS
      ? new Date(now + SESSION_TTL_MS)
      : undefined;
  if (renewed || now - row.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS) {
    await tx
      .update(sessions)
      .set({
        ...(renewed ? { expiresAt: renewed } : {}),
        lastSeenAt: new Date(now),
      })
      .where(eq(sessions.id, row.sessionId));
    if (renewed) row.expiresAt = renewed;
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
