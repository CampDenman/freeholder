// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Personal session/device controls and privacy-limited login safety (MASTER.md
// §43 C1.04). Active sessions retain bounded metadata only while their sliding
// session remains live; the longer security history contains HMACs/coarse hints
// and has a fixed 90-day expiry.
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { mail } from "@/adapters/mail";
import { loginSecurityEvents, sessions, users } from "@/core/auth/schema";
import {
  describeDevice,
  type ProtectedSessionMetadata,
} from "@/core/auth/sessions";
import { db } from "@/core/db";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";

const MAX_NOTICE_ATTEMPTS = 5;

function sessionActor(actor: Actor) {
  if (actor.kind !== "user" || !actor.sessionId) {
    throw new ServiceError("permission", "Use a signed-in browser session to continue.");
  }
  return actor as Extract<Actor, { kind: "user" }> & { sessionId: string };
}

export async function recordSuccessfulLogin(
  tx: Tx,
  userId: string,
  sessionId: string,
  metadata: ProtectedSessionMetadata,
): Promise<{ id: string; reason: "new_device" | "new_network" | null }> {
  const prior = await tx
    .select({
      deviceHash: loginSecurityEvents.deviceHash,
      networkHash: loginSecurityEvents.networkHash,
    })
    .from(loginSecurityEvents)
    .where(
      and(
        eq(loginSecurityEvents.userId, userId),
        gt(loginSecurityEvents.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(loginSecurityEvents.createdAt))
    .limit(100);

  let reason: "new_device" | "new_network" | null = null;
  if (prior.length > 0) {
    const knownDevice = metadata.deviceHash
      ? prior.some((entry) => entry.deviceHash === metadata.deviceHash)
      : true;
    const knownPair = metadata.networkHash
      ? prior.some(
          (entry) =>
            (!metadata.deviceHash || entry.deviceHash === metadata.deviceHash) &&
            entry.networkHash === metadata.networkHash,
        )
      : true;
    if (!knownDevice) reason = "new_device";
    else if (!knownPair) reason = "new_network";
  }

  const [event] = await tx
    .insert(loginSecurityEvents)
    .values({
      userId,
      sessionId,
      deviceHash: metadata.deviceHash,
      networkHash: metadata.networkHash,
      deviceLabel: metadata.deviceLabel,
      ipHint: metadata.ipHint,
      reason,
      noticeStatus: reason ? "pending" : "not_needed",
    })
    .returning({ id: loginSecurityEvents.id });
  return { id: event!.id, reason };
}

export const listSessions = defineService({
  name: "auth.listSessions",
  summary: "List the calling user's active signed-in devices.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = sessionActor(ctx.actor);
    const rows = await ctx.tx
      .select({
        id: sessions.id,
        ipHint: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        twoFactorVerifiedAt: sessions.twoFactorVerifiedAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, actor.userId),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map(({ userAgent, ...row }) => ({
      ...row,
      deviceLabel: describeDevice(userAgent),
      current: row.id === actor.sessionId,
    }));
  },
});

export const revokeSession = defineService({
  name: "auth.revokeSession",
  summary: "Sign out one of the calling user's devices.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const actor = sessionActor(ctx.actor);
    const [revoked] = await ctx.tx
      .delete(sessions)
      .where(and(eq(sessions.id, input.id), eq(sessions.userId, actor.userId)))
      .returning({ id: sessions.id });
    if (!revoked) throw new ServiceError("not_found", "That session is no longer active.");
    ctx.setSubject("session", input.id);
    ctx.queueEvent("auth.sessionRevoked", {
      userId: actor.userId,
      sessionId: input.id,
      current: input.id === actor.sessionId,
    });
    return { ok: true, current: input.id === actor.sessionId };
  },
});

export const revokeOtherSessions = defineService({
  name: "auth.revokeOtherSessions",
  summary: "Sign out every device except the calling session.",
  kind: "mutation",
  permission: "authenticated",
  stepUp: true,
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = sessionActor(ctx.actor);
    const revoked = await ctx.tx
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, actor.userId),
          ne(sessions.id, actor.sessionId),
        ),
      )
      .returning({ id: sessions.id });
    ctx.setSubject("user", actor.userId);
    ctx.queueEvent("auth.otherSessionsRevoked", {
      userId: actor.userId,
      count: revoked.length,
    });
    return { ok: true, revoked: revoked.length };
  },
});

export const recentLoginSecurity = defineService({
  name: "auth.recentLoginSecurity",
  summary: "Show the calling user's recent privacy-limited login history.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  handler: async (input, ctx) => {
    const actor = sessionActor(ctx.actor);
    return ctx.tx
      .select({
        id: loginSecurityEvents.id,
        sessionId: loginSecurityEvents.sessionId,
        deviceLabel: loginSecurityEvents.deviceLabel,
        ipHint: loginSecurityEvents.ipHint,
        reason: loginSecurityEvents.reason,
        noticeStatus: loginSecurityEvents.noticeStatus,
        createdAt: loginSecurityEvents.createdAt,
      })
      .from(loginSecurityEvents)
      .where(
        and(
          eq(loginSecurityEvents.userId, actor.userId),
          gt(loginSecurityEvents.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(loginSecurityEvents.createdAt))
      .limit(input.limit);
  },
});

/** Deliver pending notices without ever making login depend on mail uptime. */
export async function deliverPendingSecurityNotices(limit = 25): Promise<{
  sent: number;
  failed: number;
  unavailable: number;
}> {
  const candidates = await db()
    .select({
      id: loginSecurityEvents.id,
      email: users.email,
      deviceLabel: loginSecurityEvents.deviceLabel,
      ipHint: loginSecurityEvents.ipHint,
      reason: loginSecurityEvents.reason,
      createdAt: loginSecurityEvents.createdAt,
    })
    .from(loginSecurityEvents)
    .innerJoin(users, eq(loginSecurityEvents.userId, users.id))
    .where(
      and(
        inArray(loginSecurityEvents.noticeStatus, ["pending", "failed"]),
        lt(loginSecurityEvents.noticeAttempts, MAX_NOTICE_ATTEMPTS),
        gt(loginSecurityEvents.expiresAt, new Date()),
      ),
    )
    .orderBy(loginSecurityEvents.createdAt)
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let unavailable = 0;
  for (const event of candidates) {
    let adapter;
    try {
      adapter = mail();
      if (!adapter.delivers) {
        await db()
          .update(loginSecurityEvents)
          .set({
            noticeStatus: "unavailable",
            noticeAttempts: sql`${loginSecurityEvents.noticeAttempts} + 1`,
            noticeError: "Transactional mail is not configured.",
          })
          .where(eq(loginSecurityEvents.id, event.id));
        unavailable += 1;
        continue;
      }
      const reason =
        event.reason === "new_network"
          ? "a familiar device signed in from a new network"
          : "a new device signed in";
      await adapter.send({
        to: event.email,
        subject: "New sign-in to your Freeholder account",
        text:
          `Freeholder noticed that ${reason}.\n\n` +
          `Device: ${event.deviceLabel}\n` +
          `Network: ${event.ipHint ?? "Unavailable"}\n` +
          `Time: ${event.createdAt.toISOString()}\n\n` +
          "If this was not you, open Account security, revoke that session, and change your password.",
      });
      await db()
        .update(loginSecurityEvents)
        .set({
          noticeStatus: "sent",
          noticeAttempts: sql`${loginSecurityEvents.noticeAttempts} + 1`,
          noticeError: null,
          noticeSentAt: new Date(),
        })
        .where(eq(loginSecurityEvents.id, event.id));
      sent += 1;
    } catch (error) {
      await db()
        .update(loginSecurityEvents)
        .set({
          noticeStatus: "failed",
          noticeAttempts: sql`${loginSecurityEvents.noticeAttempts} + 1`,
          noticeError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        })
        .where(eq(loginSecurityEvents.id, event.id));
      failed += 1;
    }
  }
  return { sent, failed, unavailable };
}

export default [listSessions, revokeSession, revokeOtherSessions, recentLoginSecurity];
