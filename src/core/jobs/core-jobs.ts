// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Core's own scheduled work.
//
// These jobs close operational debts that existed from the moment each growing
// table was introduced. That is the pattern to expect:
// tables that grow are cheap to write and only become somebody's problem
// months later, on an instance nobody is watching.
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { defineJob } from "@/core/jobs";
import {
  passwordResets,
  loginSecurityEvents,
  sessions,
  staffInvitations,
  twoFactorChallenges,
} from "@/core/auth/schema";
import { rateLimitCounters } from "@/core/security/schema";
import { pruneDispatched, redeliverPending } from "@/core/events/outbox";
import { deliverPendingSecurityNotices } from "@/core/auth/session-management/service";

/**
 * Expired sessions.
 *
 * They were deleted only when revisited, revoked, or cascaded by a user being
 * removed — so a browser that signed in once and never came back left a row
 * for as long as the instance lived. Harmless, and unbounded.
 */
export const sweepSessions = defineJob({
  name: "core.sweepSessions",
  summary: "Delete sessions that have expired.",
  schedule: "17 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(sessions)
      .where(lt(sessions.expiresAt, sql`now()`))
      .returning({ id: sessions.id });
    return { deleted: deleted.length };
  },
});

/** Suspicious-login mail is retried out of band; authentication never waits. */
export const deliverSecurityNotices = defineJob({
  name: "core.deliverSecurityNotices",
  summary: "Deliver pending suspicious-login notices.",
  schedule: "* * * * *",
  handler: () => deliverPendingSecurityNotices(),
});

/** Coarse login history has a hard 90-day retention boundary. */
export const sweepLoginSecurityEvents = defineJob({
  name: "core.sweepLoginSecurityEvents",
  summary: "Delete expired login security history.",
  schedule: "29 4 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(loginSecurityEvents)
      .where(lt(loginSecurityEvents.expiresAt, sql`now()`))
      .returning({ id: loginSecurityEvents.id });
    return { deleted: deleted.length };
  },
});

/**
 * Rate-limit counters whose window has long passed.
 *
 * Bounded by the number of distinct subjects anyone has attempted, which is
 * bounded by nothing on a site somebody is attacking.
 */
export const sweepRateLimits = defineJob({
  name: "core.sweepRateLimits",
  summary: "Delete rate-limit counters from windows that have closed.",
  schedule: "23 * * * *",
  handler: async () => {
    const deleted = await db()
      .delete(rateLimitCounters)
      .where(lt(rateLimitCounters.windowStartedAt, sql`now() - interval '1 day'`))
      .returning({ key: rateLimitCounters.key });
    return { deleted: deleted.length };
  },
});

/**
 * The outbox's crash-recovery path.
 *
 * Everything the fast path already delivered is marked, so on a healthy
 * instance this finds nothing and costs one indexed query a minute. What it
 * catches is the case the outbox exists for: a process that committed a
 * change and died before telling anybody.
 */
export const dispatchOutbox = defineJob({
  name: "core.dispatchOutbox",
  summary: "Redeliver events that were committed but never dispatched.",
  schedule: "* * * * *",
  handler: async () => {
    const result = await redeliverPending();
    if (result.redelivered > 0) {
      console.log(
        `[outbox] redelivered ${result.redelivered} event(s) a crash had stranded`,
      );
    }
    return result;
  },
});

/**
 * Spent and expired reset links.
 *
 * They are harmless — used or out of date, neither can be redeemed — and they
 * accumulate one row per "I forgot my password" forever. The same shape of
 * problem as the sessions above, written down before it becomes somebody's
 * surprise.
 */
export const sweepPasswordResets = defineJob({
  name: "core.sweepPasswordResets",
  summary: "Delete reset links that are spent or expired.",
  schedule: "31 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(passwordResets)
      .where(
        or(
          isNotNull(passwordResets.usedAt),
          lt(passwordResets.expiresAt, sql`now() - interval '1 day'`),
        ),
      )
      .returning({ id: passwordResets.id });
    return { deleted: deleted.length };
  },
});

/** Verification attempts are short-lived credentials, not history. */
export const sweepTwoFactorChallenges = defineJob({
  name: "core.sweepTwoFactorChallenges",
  summary: "Delete spent and expired two-factor verification attempts.",
  schedule: "37 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(twoFactorChallenges)
      .where(
        or(
          isNotNull(twoFactorChallenges.usedAt),
          lt(twoFactorChallenges.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: twoFactorChallenges.id });
    return { deleted: deleted.length };
  },
});

/**
 * Make invitation expiry explicit so the one-pending-per-address constraint
 * releases without depending on somebody opening the old link first.
 */
export const expireStaffInvitations = defineJob({
  name: "core.expireStaffInvitations",
  summary: "Mark pending staff invitations as expired when their links lapse.",
  schedule: "*/15 * * * *",
  handler: async () => {
    const expired = await db()
      .update(staffInvitations)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(staffInvitations.status, "pending"),
          lt(staffInvitations.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: staffInvitations.id });
    return { expired: expired.length };
  },
});

/** The outbox is a delivery mechanism, not a history. */
export const pruneOutbox = defineJob({
  name: "core.pruneOutbox",
  summary: "Forget events that were delivered a week ago.",
  schedule: "41 4 * * *",
  handler: async () => ({ deleted: await pruneDispatched() }),
});

/**
 * Send whatever is due to somebody else's server.
 *
 * Every minute, and also nudged directly by the fan-out so a delivery does not
 * wait for the tick. The schedule is what makes it *guaranteed*: an instance
 * that was restarted between an event committing and its delivery going out
 * picks the row up here, because the work list is a query rather than a
 * message somebody has to still be holding.
 */
export const deliverWebhooks = defineJob({
  name: "core.deliverWebhooks",
  summary: "Send queued webhook deliveries that are due.",
  schedule: "* * * * *",
  handler: async () => {
    const { deliverDue } = await import("@/core/webhooks/deliver");
    return { attempted: await deliverDue() };
  },
});

/** The delivery log is for debugging, not for keeping. */
export const pruneWebhookDeliveries = defineJob({
  name: "core.pruneWebhookDeliveries",
  summary: "Forget webhook deliveries that finished a month ago.",
  schedule: "51 4 * * *",
  handler: async () => {
    const { pruneDeliveries } = await import("@/core/webhooks/deliver");
    return { deleted: await pruneDeliveries() };
  },
});

/**
 * Take work back from agents that went away.
 *
 * A lease is the only way to tell "still working" from "gone" across a
 * network, and an agent that dies mid-task would otherwise hold it forever.
 */
export const reapAgentLeases = defineJob({
  name: "core.reapAgentLeases",
  summary: "Reclaim tasks from agents that stopped reporting.",
  schedule: "* * * * *",
  handler: async () => {
    const { reapExpiredLeases } = await import("@/core/agents/execution");
    return reapExpiredLeases();
  },
});

export default [
  sweepSessions,
  deliverSecurityNotices,
  sweepLoginSecurityEvents,
  sweepRateLimits,
  sweepPasswordResets,
  sweepTwoFactorChallenges,
  expireStaffInvitations,
  dispatchOutbox,
  pruneOutbox,
  deliverWebhooks,
  pruneWebhookDeliveries,
  reapAgentLeases,
];
